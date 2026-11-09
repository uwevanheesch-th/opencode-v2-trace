/** Pure, dependency-free helpers shared by the live sequence viewer and its tests. */
const META = new Set(['_kind', '_id', '_purpose', '_url', '_agent', '_ts', '_session', '_from', '_to']);
const asObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function parseTraceHtml(contents) {
  const marker = '\n<!--\n';
  const at = contents.lastIndexOf(marker);
  if (at === -1) return { rows: [], invalid: 0, ready: false };
  const lines = contents.slice(at + marker.length).split(/\r?\n/);
  const rows = []; let invalid = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line);
      if (asObject(value) && typeof value._kind === 'string') rows.push(value);
      else invalid += 1;
    } catch { invalid += 1; }
  }
  return { rows, invalid, ready: true };
}

export function extractText(v) {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(extractText).filter(Boolean).join('\n');
  if (!asObject(v)) return '';
  if (typeof v.text === 'string') return v.text;
  if (typeof v.input_text === 'string') return v.input_text;
  if (typeof v.output_text === 'string') return v.output_text;
  if (typeof v.content === 'string' || Array.isArray(v.content)) return extractText(v.content);
  if (typeof v.value === 'string') return v.value;
  return '';
}

function responseText(r) {
  const candidates = [r.output, r.content, r.choices, r.message];
  for (const item of candidates) {
    const text = extractText(item);
    if (text) return text;
  }
  const arr = Array.isArray(r.output) ? r.output : [];
  for (const item of arr) {
    if (asObject(item) && item.type === 'function_call') return `Tool-Aufruf: ${item.name ?? 'unbekannt'}`;
  }
  if (typeof r._error === 'string') return r._error;
  return r.status || r._status || 'Antwort empfangen';
}
export const preview = (v, len = 74) => {
  const str = typeof v === 'string' ? v : String(v ?? '');
  const one = str.replace(/\s+/g, ' ').trim();
  return one.length > len ? `${one.slice(0, len - 1)}…` : one;
};

function latestUserFromInput(r) {
  for (const item of [...(Array.isArray(r.input) ? r.input : Array.isArray(r.messages) ? r.messages : [])].reverse()) {
    if (asObject(item) && item.role === 'user') {
      const text = extractText(item.content ?? item);
      if (text) return text;
    }
  }
  return typeof r.prompt === 'string' ? r.prompt : '';
}

/** Every item corresponds to an observed trace row; only user fallbacks are clearly marked. */
export function buildSequence(rows, { inferInitialUser = true } = {}) {
  const result = []; let requestNumber = 0; let seenUser = false;
  let previousUserText = null;
  for (const [index, r] of rows.entries()) {
    if (!asObject(r)) continue;
    const id = `${index}:${r._kind}:${r._id ?? ''}`;
    const base = { id, row: r, rowIndex: index, time: r._ts || '', session: r._session || '', agent: r._agent || '' };
    if (r._kind === 'user') {
      const t = typeof r._text === 'string' ? r._text : '';
      result.push({ ...base, from: 'user', to: 'agent', kind: 'user', label: 'Benutzer-Auftrag', detail: preview(t), text: t });
      seenUser = true;
      previousUserText = t;
    } else if (r._kind === 'request') {
      const purpose = r._purpose || '';
      if (!seenUser && !purpose) {
        const t = latestUserFromInput(r);
        if (inferInitialUser && t && t !== previousUserText) {
          result.push({ ...base, id: `${id}:fallback-user`, from: 'user', to: 'agent', kind: 'user', label: 'Benutzer-Auftrag (abgeleitet)', detail: preview(t), text: t, inferred: true });
          previousUserText = t;
        }
        seenUser = true;
      }
      requestNumber += 1;
      result.push({ ...base, from: 'agent', to: 'llm', kind: 'request', label: `LLM Request ${requestNumber}${purpose ? ` · ${purpose}` : ''}`, detail: r.model ?? r._agent ?? '', ordinal: requestNumber });
    } else if (r._kind === 'response') {
      result.push({ ...base, from: 'llm', to: 'agent', kind: 'response', label: `LLM Response${r._id !== undefined ? ` #${r._id}` : ''}`, detail: preview(responseText(r)) });
    } else if (r._kind === 'tool-call') {
      result.push({ ...base, from: 'agent', to: 'tools', kind: 'tool-call', label: `Tool: ${r._tool || 'unbekannt'}`, detail: r._call_id || '' });
    } else if (r._kind === 'tool-result') {
      result.push({ ...base, from: 'tools', to: 'agent', kind: 'tool-result', label: `${r._tool || 'Tool'}: ${r._status === 'error' ? 'Fehler' : 'Ergebnis'}`, detail: r._call_id || '' });
    } else if (r._kind === 'agent-switch') {
      result.push({ ...base, from: 'agent', to: 'agent', kind: 'agent-switch', label: `Agent: ${r._from || '?'} → ${r._to || '?'}`, detail: '' });
    } else if (r._kind === 'limit' || r._kind === 'error') {
      result.push({ ...base, from: 'agent', to: 'agent', kind: 'error', label: r._kind === 'limit' ? 'Aufzeichnungslimit erreicht' : 'Transportfehler', detail: preview(r._error) });
    }
  }
  return result;
}

function contentAsText(value) {
  const extracted = extractText(value);
  return extracted || (typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}
function mkBlock(id, name, category, value, description = '') {
  return { id, name, category, description, value, text: contentAsText(value), raw: JSON.stringify(value, null, 2) };
}

/** Uses ONLY fields of the wire request. Unknown origin is never labeled AGENTS.md. */
export function buildPromptBlocks(row) {
  if (!row || row._kind !== 'request') return [];
  const blocks = []; let index = 0;
  const add = (label, category, value, description) => blocks.push(mkBlock(`b${index++}`, label, category, value, description));
  if (row.instructions !== undefined) add('System Prompt', 'system', row.instructions, 'API-Feld: instructions');
  if (row.system !== undefined) {
    if (Array.isArray(row.system)) row.system.forEach((v, i) => add(`System Prompt ${i + 1}`, 'system', v, `API-Feld: system[${i}]`));
    else add('System Prompt', 'system', row.system, 'API-Feld: system');
  }
  if (row.developer !== undefined) add('Developer Instructions', 'system', row.developer, 'API-Feld: developer');
  const messages = Array.isArray(row.input) ? row.input : Array.isArray(row.messages) ? row.messages : [];
  messages.forEach((m, i) => {
    const role = asObject(m) ? (m.role ?? m.type ?? 'message') : 'message';
    const category = role === 'user' ? 'user' : role === 'assistant' || role === 'message' ? 'assistant' : role === 'system' || role === 'developer' ? 'system' : 'tool';
    const readable = role === 'function_call' ? `Assistant · Tool Call` : role === 'function_call_output' ? 'Tool Response' : `${String(role).charAt(0).toUpperCase() + String(role).slice(1)} Message`;
    add(`${i + 1}. ${readable}`, category, m, `API-Feld: ${Array.isArray(row.input) ? 'input' : 'messages'}[${i}]`);
  });
  if (!messages.length && row.prompt !== undefined) add('User Prompt', 'user', row.prompt, 'API-Feld: prompt');
  if (typeof row._body === 'string') add('Originaler Request-Body', 'parameters', row._body, 'Nicht als JSON interpretierbarer Provider-Body');
  if (row.tools !== undefined) add('Tool Specs', 'tools', row.tools, `Originale Tool-Definitionen (${Array.isArray(row.tools) ? row.tools.length : Object.keys(row.tools ?? {}).length})`);
  const known = new Set(['instructions', 'system', 'developer', 'input', 'messages', 'prompt', 'tools', 'type']);
  const extra = Object.fromEntries(Object.entries(row).filter(([key]) => !META.has(key) && !known.has(key) && !key.startsWith('_')));
  if (Object.keys(extra).length) add('Request-Parameter', 'parameters', extra, 'Modell, Tool-Auswahl und weitere API-Parameter');
  if (row.type !== undefined) add('Transporttyp', 'parameters', row.type, 'API-Feld: type');
  return blocks;
}

export function buildResponseBlocks(row) {
  if (!row) return [];
  const payload = Object.fromEntries(Object.entries(row).filter(([k]) => !META.has(k)));
  const blocks = [];
  if (Array.isArray(payload.output)) {
    payload.output.forEach((item, i) => blocks.push(mkBlock(`response${i}`, `Output ${i + 1} · ${item?.type ?? item?.role ?? 'message'}`, 'assistant', item)));
  } else if (Array.isArray(payload.choices)) {
    payload.choices.forEach((item, i) => blocks.push(mkBlock(`choice${i}`, `Choice ${i + 1}`, 'assistant', item)));
  } else if (payload.content) {
    blocks.push(mkBlock('content', 'Antwortinhalt', 'assistant', payload.content));
  }
  blocks.push(mkBlock('full', 'Vollständige Response (JSON)', 'parameters', payload));
  return blocks;
}
