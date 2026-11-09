import { buildSequence, buildPromptBlocks, buildResponseBlocks, preview } from './model.mjs';
const $ = (id) => document.getElementById(id);
const state = { source: null, rows: [], seen: new Set(), maxLine: -1, clearBefore: 0, events: [], selected: null, blocks: [], block: null, jsonMode: false, stream: null, follow: true };
const ns = 'http://www.w3.org/2000/svg';
const colors = { request: '#2873d6', response: '#009b88', user: '#64748b', 'tool-call': '#d28a21', 'tool-result': '#d28a21', 'agent-switch': '#9b79bd', error: '#c75050' };
const lanes = { user: 104, agent: 370, llm: 646, tools: 916 };
function svg(name, attrs = {}, parent) {
  const node = document.createElementNS(ns, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  if (parent) parent.appendChild(node);
  return node;
}
function text(node, value) { node.textContent = String(value ?? ''); return node; }
function setStatus(label, type = '') { $('status-text').textContent = label; $('status').className = `live-state ${type}`; }
function empty(title, message) {
  $('empty-title').textContent = title;
  $('empty-message').textContent = message;
  $('empty').hidden = false;
  $('sequence').setAttribute('hidden', '');
}
function updateDiagram() {
  state.events = buildSequence(state.rows, { inferInitialUser: state.clearBefore === 0 });
  $('count').textContent = `${state.events.length} Ereignisse`;
  const root = $('sequence'); root.replaceChildren();
  if (!state.events.length) {
    empty('Warte auf Live-Ereignisse', 'In der aktuellen Aufzeichnung gibt es noch keine Modell- oder Tool-Kommunikation.');
    return;
  }
  $('empty').hidden = true; root.removeAttribute('hidden');
  const width = 1020, head = 124, step = 86, height = Math.max(470, head + state.events.length * step + 54);
  root.setAttribute('viewBox', `0 0 ${width} ${height}`);
  root.setAttribute('width', width); root.setAttribute('height', height);
  for (const [actor, x] of Object.entries(lanes)) {
    const labels = { user: ['Benutzer', 'Auftrag'], agent: ['Coding Agent', 'Harness'], llm: ['LLM', 'Modell'], tools: ['Tools', 'Ausführung'] };
    svg('rect', { x: x - 100, y: 16, width: 200, height: 66, rx: 10, class: 'lane-header' }, root);
    text(svg('text', { x, y: 43, 'text-anchor': 'middle', class: 'lane-text' }, root), labels[actor][0]);
    text(svg('text', { x, y: 62, 'text-anchor': 'middle', class: 'lane-sub' }, root), labels[actor][1]);
    svg('line', { x1: x, y1: 82, x2: x, y2: height - 24, class: 'lifeline' }, root);
  }
  for (const [i, event] of state.events.entries()) {
    const y = head + i * step;
    const from = lanes[event.from], to = lanes[event.to];
    const col = colors[event.kind] || '#64748b';
    if (event.id === state.selected) svg('rect', { x: 8, y: y - 36, width: width - 16, height: step - 1, class: 'row-selected', rx: 9 }, root);
    if (i) svg('line', { x1: 22, y1: y - 42, x2: width - 22, y2: y - 42, class: 'row-sep' }, root);
    const g = svg('g', { class: `arrow-hit ${event.id === state.selected ? 'selected' : ''}`, tabindex: '0', role: 'button', 'aria-label': `${event.label}. Details anzeigen.` }, root);
    const left = Math.min(from, to), right = Math.max(from, to);
    const yArrow = y + 14;
    if (from === to) {
      svg('path', { d: `M ${from} ${yArrow} h 64 v 26 h -64`, fill: 'none', stroke: col, 'stroke-width': 2.4 }, g);
      svg('polygon', { points: `${from},${yArrow+26} ${from+9},${yArrow+20} ${from+9},${yArrow+32}`, fill: col }, g);
    } else {
      svg('line', { x1: from, y1: yArrow, x2: to, y2: yArrow, stroke: col, class: 'arrow-line', 'stroke-dasharray': ['response', 'tool-result'].includes(event.kind) ? '8 5' : 'none' }, g);
      const dir = to > from ? 1 : -1;
      svg('polygon', { points: `${to},${yArrow} ${to - dir*10},${yArrow-6} ${to - dir*10},${yArrow+6}`, fill: col }, g);
    }
    const cx = from === to ? from + 35 : (from + to) / 2;
    let label = event.label;
    if (event.kind === 'request') label += '  ◇ Prompt öffnen';
    text(svg('text', { x: cx, y: y - 11, 'text-anchor': 'middle', class: 'arrow-label' }, g), preview(label, 62));
    text(svg('text', { x: cx, y: y + 42, 'text-anchor': 'middle', class: 'arrow-detail' }, g), preview(event.detail, event.kind === 'tool-call' ? 65 : 76));
    svg('rect', { x: left - 10, y: y - 34, width: right - left + (from === to ? 90 : 20), height: 76, fill: 'transparent' }, g);
    const activate = () => openEvent(event);
    g.addEventListener('click', activate);
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } });
  }
  if (state.follow) {
    requestAnimationFrame(() => { const scroller = $('diagram-scroll'); scroller.scrollTop = scroller.scrollHeight; });
  }
}
let frameScheduled = false;
function scheduleRender() { if (frameScheduled) return; frameScheduled = true; requestAnimationFrame(() => { frameScheduled = false; updateDiagram(); }); }
function onSource(evt) {
  if (state.source === evt.source) return;
  state.source = evt.source;
  state.rows = []; state.seen.clear(); state.maxLine = -1; state.clearBefore = 0;
  state.follow = true;
  $('source').textContent = evt.source;
  $('session').textContent = evt.sessionId ? `Session ${evt.sessionId}` : '(ältere Traces ohne Session-ID)';
  setStatus('Live verbunden', 'connected');
  scheduleRender();
}
function receiveRows(evt) {
  if (evt.source !== state.source) onSource(evt);
  let changed = false;
  for (const { lineNo, row } of evt.entries) {
    if (state.seen.has(lineNo)) continue;
    state.seen.add(lineNo);
    state.maxLine = Math.max(state.maxLine, lineNo);
    if (lineNo < state.clearBefore) continue;
    state.rows.push(row);
    changed = true;
    if (row._session) $('session').textContent = `Session ${row._session}`;
  }
  if (changed) scheduleRender();
}
function connect() {
  setStatus('Verbinde…');
  const source = new EventSource('/events');
  state.stream = source;
  source.onopen = () => { setStatus('Verbunden · warte auf Daten', 'connected'); };
  source.onmessage = (message) => {
    let e; try { e = JSON.parse(message.data); } catch { return; }
    if (e.type === 'source') onSource(e);
    else if (e.type === 'rows') receiveRows(e);
    else if (e.type === 'waiting') { if (!state.source) empty('Warte auf OpenCode', e.message); setStatus('Warte auf OpenCode', 'warning'); }
    else if (e.type === 'warning') { setStatus('Hinweis zur Aufzeichnung', 'warning'); $('footnote').textContent = e.message; }
  };
  source.onerror = () => setStatus('Verbindung unterbrochen · verbinde erneut', 'warning');
}
$('clear').addEventListener('click', () => {
  state.clearBefore = state.maxLine + 1;
  state.rows = []; state.selected = null;
  state.follow = true;
  $('footnote').textContent = 'Anzeige geleert. Neue Live-Ereignisse erscheinen automatisch. Die Aufzeichnungsdatei bleibt unverändert.';
  scheduleRender();
  closeModal();
});
$('diagram-scroll').addEventListener('scroll', () => {
  const scroller = $('diagram-scroll');
  state.follow = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 90;
}, { passive: true });

let priorFocus = null;
function openEvent(event) {
  priorFocus = document.activeElement;
  state.selected = event.id;
  const r = event.row;
  let blocks = [];
  if (event.kind === 'request') blocks = buildPromptBlocks(r);
  else if (event.kind === 'response') blocks = buildResponseBlocks(r);
  else if (event.kind === 'user') blocks = [{ id: 'user', name: 'Benutzertext', category: 'user', description: 'Originaltext der Benutzereingabe', text: event.text, raw: JSON.stringify(event.text, null, 2) }];
  else if (event.kind === 'tool-call') blocks = [{ id: 'input', name: 'Tool-Eingabe', category: 'tool', description: r._tool || '', text: typeof r._input === 'string' ? r._input : JSON.stringify(r._input ?? '(nicht aufgezeichnet)', null, 2), raw: JSON.stringify(r._input ?? null, null, 2) }];
  else if (event.kind === 'tool-result') blocks = [{ id: 'result', name: 'Tool-Ergebnis', category: 'tool', description: r._status || '', text: typeof (r._result ?? r._error) === 'string' ? (r._result ?? r._error) : JSON.stringify(r._result ?? r._error ?? '(nicht aufgezeichnet)', null, 2), raw: JSON.stringify(r._result ?? r._error ?? null, null, 2) }];
  else blocks = [{ id: 'event', name: 'Ereignis', category: 'parameters', description: '', text: JSON.stringify(r, null, 2), raw: JSON.stringify(r, null, 2) }];
  state.blocks = blocks;
  $('modal-title').textContent = event.kind === 'request' ? `${event.label} · Prompt-Zusammensetzung` : event.label;
  $('modal-overline').textContent = ({ request: 'LLM REQUEST', response: 'LLM RESPONSE', 'tool-call': 'TOOL AUSFÜHRUNG', 'tool-result': 'TOOL ERGEBNIS' })[event.kind] || 'LIVE-EREIGNIS';
  $('modal-subtitle').textContent = `Agent: ${r._agent || 'unbekannt'} · ${event.time ? new Date(event.time).toLocaleTimeString('de-DE') : ''} · ID: ${r._id ?? r._call_id ?? '–'}`;
  $('modal-info').textContent = event.kind === 'request' ? 'Original-Payload des aktuellen LLM-Requests. AGENTS.md kann Teil des System-Prompts sein; ohne eindeutige Herkunft wird kein separater Baustein behauptet.' : 'Die Daten stammen aus der aufgezeichneten Kommunikation bzw. den Tool-Hooks.';
  const area = $('blocks'); area.replaceChildren();
  for (const block of blocks) {
    const item = document.createElement('button'); item.type = 'button'; item.className = `block ${block.category}`; item.dataset.id = block.id;
    const icon = document.createElement('span'); icon.className = 'block-icon'; icon.textContent = ({ system: '§', user: 'U', assistant: 'A', tool: 'T', tools: '⚙', parameters: '≡' })[block.category] || '•';
    const name = document.createElement('span'); name.className = 'block-title'; name.textContent = block.name;
    const desc = document.createElement('span'); desc.className = 'block-desc'; desc.textContent = block.description;
    item.append(icon, name, desc);
    item.addEventListener('click', () => showBlock(block.id)); area.appendChild(item);
  }
  $('block-count').textContent = `${blocks.length} Bausteine`;
  state.jsonMode = false;
  showBlock(blocks[0]?.id);
  $('modal').hidden = false;
  $('close').focus();
  // Keep the timeline accessible behind the modal without forcing it to scroll.
  const svgRoot = $('sequence');
  for (const node of svgRoot.querySelectorAll('.arrow-hit')) node.classList.toggle('selected', node.getAttribute('aria-label')?.startsWith(event.label));
}
function showBlock(id) {
  state.block = state.blocks.find(b => b.id === id) || null;
  for (const button of $('blocks').children) button.classList.toggle('active', button.dataset.id === id);
  $('block-title').textContent = state.block?.name || 'Keine Daten';
  $('block-description').textContent = state.block?.description || '';
  refreshContent();
}
function refreshContent() {
  $('view-text').classList.toggle('active', !state.jsonMode);
  $('view-json').classList.toggle('active', state.jsonMode);
  $('block-text').textContent = state.block ? (state.jsonMode ? state.block.raw : state.block.text) : 'Kein Inhalt aufgezeichnet.';
}
$('view-text').addEventListener('click', () => { state.jsonMode = false; refreshContent(); });
$('view-json').addEventListener('click', () => { state.jsonMode = true; refreshContent(); });
$('copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('block-text').textContent); $('copy').textContent = 'Kopiert ✓'; setTimeout(() => { $('copy').textContent = 'Kopieren'; }, 1300); }
  catch { $('copy').textContent = 'Kopieren nicht verfügbar'; }
});
function closeModal() {
  $('modal').hidden = true; state.selected = null;
  if (priorFocus?.isConnected) priorFocus.focus();
}
$('close').addEventListener('click', closeModal);
$('modal-backdrop').addEventListener('click', closeModal);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('modal').hidden) closeModal(); });
connect();
