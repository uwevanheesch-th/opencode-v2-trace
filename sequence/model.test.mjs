import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseTraceHtml, buildSequence, buildPromptBlocks, buildResponseBlocks } from './model.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the actual stored HTML example contains real wire requests and responses', () => {
  const data = parseTraceHtml(readFileSync(path.join(root, 'example.html'), 'utf8'));
  assert.ok(data.ready);
  const steps = buildSequence(data.rows);
  assert.ok(steps.some(x => x.kind === 'request'));
  assert.ok(steps.some(x => x.kind === 'response'));
  assert.ok(steps.some(x => x.kind === 'user'));
});
test('one block per input message, with full original prompt and tool spec', () => {
  const wire = { _kind: 'request', _id: 7, instructions: 'BASE SYSTEM\nAGENTS maybe inside', tools: [{ type: 'function', name: 'read', parameters: { type: 'object' } }], input: [
    { role: 'user', content: [{ type: 'input_text', text: 'Mach es!' }] },
    { type: 'function_call', name: 'read', call_id: 'c1', arguments: '{"file":"x"}' },
    { type: 'function_call_output', call_id: 'c1', output: 'Datei X' },
  ], temperature: 0.1 };
  const blocks = buildPromptBlocks(wire);
  assert.deepEqual(blocks.map(x => x.name), ['System Prompt', '1. User Message', '2. Assistant · Tool Call', '3. Tool Response', 'Tool Specs', 'Request-Parameter']);
  assert.equal(blocks[0].text, wire.instructions);
  assert.ok(blocks.find(x=>x.name==='Tool Specs').raw.includes('"read"'));
  assert.ok(blocks.find(x=>x.name==='3. Tool Response').raw.includes('Datei X'));
  assert.ok(blocks.every(x => x.raw && x.text));
  assert.ok(!blocks.some(x=>x.name==='AGENTS.md'));
});
test('real tool events appear in sequence with unchanged original args and results', () => {
  const rows = [
    { _kind:'user', _session:'ses1', _text:'Aufgabe' },
    { _kind:'request', _id:1, _agent:'build', instructions:'system', input:[] },
    { _kind:'response', _id:1, output:[{ type:'function_call', name:'read', arguments:'{}' }] },
    { _kind:'tool-call', _tool:'read', _call_id:'c1', _input:{ filename:'a.ts' } },
    { _kind:'tool-result', _tool:'read', _call_id:'c1', _status:'completed', _result:'source code' },
    { _kind:'request', _id:2, input:[{ type:'function_call_output', output:'source code' }] },
  ];
  const seq = buildSequence(rows);
  assert.deepEqual(seq.map(x=>x.kind), ['user','request','response','tool-call','tool-result','request']);
  const blocks = buildPromptBlocks(rows.at(-1));
  assert.ok(blocks[0].raw.includes('source code'));
});
test('no original response content is hidden by a derived summary', () => {
  const b = buildResponseBlocks({ _kind:'response', _id:3, output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'Hallo'}]}], status:'completed' });
  assert.equal(b.length, 2);
  assert.ok(b[0].raw.includes('Hallo'));
  assert.ok(b[1].raw.includes('completed'));
});
test('parses incomplete appended trace defensively', () => {
  const html = '<html></html>\n<!--\n{"_kind":"request","_id":1}\n{"_kind":"response","_id":';
  const result = parseTraceHtml(html);
  assert.equal(result.rows.length, 1);
  assert.equal(result.invalid, 1);
});
