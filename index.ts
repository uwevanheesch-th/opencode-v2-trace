/**
 * OpenCode server plugin which captures raw LLM HTTP payloads to `~/opencode-trace`.
 *
 * Each trace is an interactive html file whose trailing unterminated html-comment contains
 * one json object per line. To read the logs programmatically, strip everything up to that
  * final comment. To browse them interactively, open the html file directly in a browser.
  *
 * The plugin loads `./viewer.js` at runtime and embeds it into each new html trace, while also
 * preferring a sibling `viewer.js` if one exists next to the saved html file.
 */
import type { Plugin } from "@opencode/plugin"
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs"
import { createHash } from "node:crypto"
import os from "node:os"
import path from "node:path"

const root = path.join(os.homedir(), "opencode-trace")
const PREAMBLE = `<!DOCTYPE html>
<html>
<head>
    <style>
        body {font-family: system-ui, -apple-system, sans-serif; margin: 0;}
        body>details {margin-top: 1ex; padding-top: 1ex; border-top: 1px solid lightgray;}
        details {position: relative; padding-left: 1.25em;}
        summary {list-style: none; cursor: pointer;}
        summary::-webkit-details-marker {display: none;}
        summary::before {content: '▷';position: absolute;left: 0;color: #666;}
        details[open]>summary::before {content: '▽';}
        details>div {margin-left: 1.25em;}
        details[open]>summary output {display: none;}
    </style>
    <script src="viewer.js"></script>
    <script>
        if (window.buildNode === undefined) {
          // {viewer.js}
        }
    </script>
</head>
<body>
</body>
</html>
${"<!" + "--"}
`

/**
 * Config: whether to log full, uncompressed request/response bodies (default) or delta-compressed ones.
 * Controlled by `OPENCODE_TRACE_FULL`. Any value other than "0" means full mode (the didactic default),
 * so students can see the entire context — system prompt, tools, and whole history — that the agent
 * re-sends to the LLM on every single turn. `OPENCODE_TRACE_FULL=0` restores the compact delta view.
 */
const FULL_MODE = process.env.OPENCODE_TRACE_FULL !== "0"

/**
 * Config: maximum size of a single trace html file, in megabytes. Controlled by `OPENCODE_TRACE_MAX_MB`.
 * Default is 5 MB. A value of -1 disables the limit entirely. An invalid/unparseable value falls back to
 * the 5 MB default (rather than unbounded) so a typo can't silently produce huge files. When a file reaches
 * the limit, the current row is still written, a final "[limit]" notice row is appended, and no further
 * rows are written for that session.
 */
const MAX_BYTES = ((): number => {
  const raw = process.env.OPENCODE_TRACE_MAX_MB
  if (raw === undefined || raw.trim() === "") return 5 * 1024 * 1024
  const mb = Number(raw)
  if (!Number.isFinite(mb)) return 5 * 1024 * 1024
  if (mb < 0) return Infinity
  return mb * 1024 * 1024
})()

/** Mutable global state: session ids whose logfile has hit the size limit; no further rows are written. */
const capped = new Set<string>()

/** Mutable global state: maps OpenCode session ids to the html logfile path for that session. */
const files = new Map<string, string>()

/** Mutable global state: maps `session\nmethod\nurl\n_kind\nmeta|real` to the previous raw body used as the delta base. */
const prevs = new Map<string, object>()

/** Mutable global state: maps OpenCode session ids to the next per-session request sequence number. */
const ids = new Map<string, number>()

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v)
}

function isArray(v: unknown): v is unknown[] {
  return Array.isArray(v);
}

/**
 * Given a parsed LLM request body, returns the first user prompt text if one is present, e.g.
 * {input:[{role:"user",content:[{type:"input_text",text:"why is the sky blue?"}]}]}
 * ==> "why is the sky blue?"
 */
function extractPromptFromRequestBody(v: Record<string, unknown>): string | undefined {
  const usable = (text: string | undefined): string | undefined => {
    const trimmed = text?.trim()
    return trimmed && trimmed !== "Generate a title for this conversation:" ? trimmed : undefined
  }
  const text = (part: unknown): string | undefined => {
    if (typeof part === "string") return usable(part)
    if (!isRecord(part)) return
    if (typeof part.text === "string") return usable(part.text)
    if (typeof part.input_text === "string") return usable(part.input_text)
    return undefined
  }
  const content = (v: unknown): string | undefined => {
    if (typeof v === "string") return usable(v)
    if (!Array.isArray(v)) return undefined
    for (const part of v) {
      const found = text(part)
      if (found) return found
    }
    return undefined
  }
  const first = (list: unknown, key: "input" | "messages"): string | undefined => {
    if (!Array.isArray(list)) return undefined
    for (const item of list) {
      if (!isRecord(item)) continue
      if (item.role !== "user") continue
      const found = content(item.content) ?? (key === "input" ? text(item) : undefined)
      if (found) return found
    }
    return undefined
  }
  return first(v.input, "input") ?? first(v.messages, "messages") ?? (typeof v.prompt === "string" ? v.prompt : undefined)
}

/**
 * Appends one row to the session logfile. If logging fails, them skips silently.
 * Session logfiles are like `~/opencode-trace/2024.6.10 15.30.45 why is the sky blue.html`
 * In the vanishingly rare case of filename collision (because a user asked two different sessions
 * the same prompt at the exact same second) then there'll be a clash, and that's the user's fault:
 * we tradeoff theoretical perfection for user convenience in the common case.
 *
 * Honors the `OPENCODE_TRACE_MAX_MB` size cap: the row that pushes the file to/over the limit is still
 * written in full, then a single `_kind:"limit"` notice row is appended and the session is marked capped
 * so no further rows are written. The viewer renders that notice as a banner at the bottom of the file.
 */
function writeNoThrow(id: string, name: string, row: Record<string, unknown>): void {
  try {
    if (capped.has(id)) return
    const prev = files.get(id)
    const d = new Date()
    const file = prev ?? path.join(
      root,
      `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()} ${d.getHours()}.${d.getMinutes()}.${d.getSeconds()} ${name}.html`,
    )
    mkdirSync(root, { recursive: true })
    if (!existsSync(file)) {
      const html = PREAMBLE.replace(
        "// {viewer.js}",
        () => readFileSync(new URL("./viewer.js", import.meta.url), "utf8"),
      )
      appendFileSync(
        file,
        html,
      )
    }
    files.set(id, file)
    // Check the real on-disk size (preamble + embedded viewer + all rows so far) before appending.
    // If we're already at/over the limit, still write this row (so the last turn stays intact), then
    // append a one-time limit notice and stop logging this session.
    const atLimit = MAX_BYTES !== Infinity && existsSync(file) && statSync(file).size >= MAX_BYTES
    appendFileSync(file, `${JSON.stringify(row).replace(/-->/g, "--\\u003e")}\n`)
    if (atLimit) {
      capped.add(id)
      const mb = MAX_BYTES / (1024 * 1024)
      const notice = {
        _kind: "limit",
        _ts: now(),
        _limit_mb: mb,
        _error: `Trace file reached the ${mb} MB size limit — logging stopped for this session. Set OPENCODE_TRACE_MAX_MB=-1 (or a higher value) to capture more.`,
      }
      appendFileSync(file, `${JSON.stringify(notice).replace(/-->/g, "--\\u003e")}\n`)
    }
  } catch {
    // Intentionally swallow tracing I/O failures so plugin logging can't crash OpenCode.
  }
}

/**
 * Given two json values, returns a bool for whether they are identical, plus a
 * (lossy) representation of the difference intended for humans to read, which
 * still roughly captures the shape even of unchanged objects.
 *
 * The representation always has the same type as `next`.
 *
 * For changed lists, the representation is either the full new list, or, when shorter,
 * `[changedRecords, '...', additions, '---', removals]`.
 *
 * For dicts, removed keys appear as `-k: null`, added keys as `+k: v`, and changed keys as
 * `*k: v`. If a changed dict field is itself a compact list diff, that is rendered as
 * `k+: [...]` and `k-: [...]` for readability.
 */
function delta(prev: unknown, next: unknown): [unknown, boolean] {
  const hash = (v: unknown): string => {
    const sort = (v: unknown): unknown => {
      if (isArray(v)) {
        return v.map(sort);
      }
      if (!v || typeof v !== 'object') {
        return v;
      }
      return Object.fromEntries(
        Object.keys(v)
          .sort()
          .map(k => [k, sort((v as Record<string, unknown>)[k])]),
      );
    };
    return createHash("blake2b512").update(JSON.stringify(sort(v))).digest("hex")
  };
  if (isRecord(prev) && isRecord(next)) {
    // RECORDS: Overall resulting record is just {"[repeat]":"[repeat]"} if it's unchanged. This is the only case
    // where the result has a different structure from the input (well it's still a record, just with keys lost).
    // Otherwise the result is a record with
    // - `{"-k":null}` for keys that were in prev but absent in next
    // - `{"+k":v}` for keys that were absent in prev and present in next
    // - `{"k":v}` for keys present in both, and v is unchanged in prev and next, and fairly short
    //    - `{"k":["..."]}` for keys present in both, and v is an unchanged longish array
    //    - `{"k":{"[unchanged]":"[unchanged]"}}` for keys present in both, and v is an unchanged longish object
    //    - `{"k":"[unchanged]"}` for keys present in both, and v is an unchanged longish string
    //    - `{"k":v}` for keys present in both, and v is an unchanged longish anything else
    // - `{"*k":v}` for keys present in both, and v is a changed non-record non-array
    // - `{"*k":delta}` for keys present in both, and v is a changed record
    // - `{"*k":[...v]}` for keys present in both, and v is a changed array best represented as new array, or changes followed by remainder, or changes followed by adds+dels
    // - `{"k+":[...adds], "k-":[...dels]}` for keys present in both, and v is a changed array best represented just with adds and dels (skip either if absent)
    let isSame = true;
    const out: Record<string, unknown> = {};
    const prevKeys = new Set(Object.keys(prev));
    const nextKeys = new Set(Object.keys(next));
    for (const k of [...prevKeys].filter(k => !nextKeys.has(k)).sort()) {
      out[`-${k}`] = null;
      isSame = false;
    }
    for (const k of [...nextKeys].filter(k => !prevKeys.has(k)).sort()) {
      out[`+${k}`] = next[k];
      isSame = false;
    }
    for (const k of [...prevKeys].filter(k => nextKeys.has(k)).sort()) {
      const [sub, same] = delta(prev[k], next[k]);
      if (same) {
        const raw = JSON.stringify(next[k]) ?? '';
        out[k] =
          raw.length < 128
            ? next[k]
            : isArray(next[k])
              ? ['...']
              : isRecord(next[k])
                ? {'[unchanged]': '[unchanged]'}
                : typeof next[k] === 'string'
                  ? '[unchanged]'
                  : next[k];
        continue;
      }
      isSame = false;
      if (!isArray(sub) || (sub[0] !== '...' && sub[0] !== '---')) {
        out[`*${k}`] = sub;
        continue;
      }
      const cut = sub.findIndex(item => item === '---');
      const cut2 = cut === -1 ? undefined : cut;
      const add = cut2 === 0 ? [] : cut2 == null ? sub.slice(1) : sub.slice(1, cut2);
      const del = cut2 == null ? [] : sub.slice(cut2 + 1);
      if (del.length > 0) {
        out[`${k}-`] = del;
      }
      if (add.length > 0) {
        out[`${k}+`] = add;
      }
    }
    return isSame ? [{'[repeat]': '[repeat]'}, true] : [out, false];
  } else if (isArray(prev) && isArray(next)) {
    // ARRAYS: Overall resulting array is `[...changedRecordsPrefix, "...", ...adds, "---", ...dels]`
    // or, if more compact, `[...changedRecordsPrefix, ...nextRemainder]`
    // - The adds/dels themselves have a greedy algorithm: in prev=[c,d,e,f] next=[d,e,c] then we greedily match c, hence adds=[d,e] and dels=[d,e,f]
    // - The changedRecordsPrefix deliberately skips identical record elements, just like identical non-array elements get skipped too
    const changedRecordsPrefix: Array<unknown> = [];
    let shownEllipsis = false;
    let i = 0;
    for (; i < prev.length && i < next.length; i++) {
      if (!isRecord(prev[i]) || !isRecord(next[i])) {
        break;
      }
      const [elDif, elIsSame] = delta(prev[i], next[i]);
      if (elIsSame && !shownEllipsis) {
        changedRecordsPrefix.push('...*');
        shownEllipsis = true;
      }
      if (!elIsSame) {
        changedRecordsPrefix.push(elDif);
      }
    }
    const left: Array<readonly [unknown, string]> = prev.slice(i).map(v => [v, hash(v)] as const);
    let right: Array<readonly [unknown, string]> = next.slice(i).map(v => [v, hash(v)] as const);
    const add: unknown[] = [];
    const del: unknown[] = [];
    for (const [value, sig] of left) {
      const ix = right.findIndex(item => item[1] === sig);
      if (ix === -1) {
        del.push(value);
        continue;
      }
      add.push(...right.slice(0, ix).map(item => item[0]));
      right = right.slice(ix + 1);
    }
    add.push(...right.map(item => item[0]));
    if (add.length === 0 && del.length === 0) {
      return [
        [...changedRecordsPrefix, ...next.slice(i)],
        changedRecordsPrefix.length === 0 || (changedRecordsPrefix.length === 1 && shownEllipsis),
      ];
    }
    const additionalEllipsis = shownEllipsis ? [] : ['...'];
    if (add.length + del.length < next.length - i) {
      return del.length === 0
        ? [[...changedRecordsPrefix, ...additionalEllipsis, ...add], false]
        : add.length === 0
          ? [[...changedRecordsPrefix, '---', ...del], false]
          : [[...changedRecordsPrefix, ...additionalEllipsis, ...add, '---', ...del], false];
    }
    return [[...changedRecordsPrefix, ...next.slice(i)], false];
  } else {
    // PRIMITIVES: Overall resulting primitive is just `next`, the new value itself.
    return [next, prev === next];
  }
}

/** Given two objects, returns their shallow merge, else just returns the right-hand side. */
function merge(a: unknown, b: unknown): unknown {
  if (!isRecord(a) || !isRecord(b)) return b
  return { ...a, ...b }
}

/**
 * Given an SSE response body, returns parsed `{event?, data}` blocks.
 * Returns undefined if the body is not parseable SSE json.
 */
function events(text: string): Array<{ event: string | undefined; data: unknown }> | undefined {
  const out: Array<{ event: string | undefined; data: unknown }> = []
  for (const block of text.split(/\r?\n\r?\n/)) {
    if (!block.trim()) continue
    let name: string | undefined
    const data = block
      .split(/\r?\n/)
      .flatMap((line) => {
        if (line.startsWith("event:")) {
          name = line.slice(6).trim()
          return []
        }
        if (line.startsWith("data:")) return [line.slice(5).trimStart()]
        return []
      })
      .join("\n")
    if (!data || data === "[DONE]") continue
    try {
      out.push({ event: name, data: JSON.parse(data) as unknown })
    } catch {
      return
    }
  }
  return out.length > 0 ? out : undefined
}

/** Given parsed OpenAI `/responses` SSE blocks, reconstructs the final response object. */
function openaiResponses(list: Array<{ data: unknown }>): Record<string, unknown> {
  let base: Record<string, unknown> = { object: "response" }
  const ids: string[] = []
  const items = new Map<string, Record<string, unknown>>()
  const sums = new Map<string, string>()
  for (const row of list) {
    if (!isRecord(row.data) || typeof row.data.type !== "string") continue
    if (isRecord(row.data.response)) base = merge(base, row.data.response) as Record<string, unknown>
    if (row.data.type === "response.output_item.added" && isRecord(row.data.item) && typeof row.data.item.id === "string") {
      const id = row.data.item.id
      const item = { ...row.data.item }
      if (item.type === "message") item.content = (items.get(id)?.content as unknown[]) ?? []
      if (!ids.includes(id)) ids.push(id)
      items.set(id, item)
      continue
    }
    if (row.data.type === "response.output_text.delta" && typeof row.data.item_id === "string") {
      const prev = items.get(row.data.item_id) ?? { id: row.data.item_id, type: "message", role: "assistant", content: [] }
      const content: unknown[] = Array.isArray(prev.content) ? [...(prev.content as unknown[])] : []
      const last = content[content.length - 1]
      if (isRecord(last) && last.type === "output_text" && typeof last.text === "string") {
        last.text += typeof row.data.delta === "string" ? row.data.delta : ""
      } else {
        content.push({ type: "output_text", text: typeof row.data.delta === "string" ? row.data.delta : "" })
      }
      items.set(row.data.item_id, { ...prev, content })
      if (!ids.includes(row.data.item_id)) ids.push(row.data.item_id)
      continue
    }
    if (row.data.type === "response.function_call_arguments.delta" && typeof row.data.item_id === "string") {
      const prev = items.get(row.data.item_id) ?? { id: row.data.item_id, type: "function_call", arguments: "" }
      items.set(row.data.item_id, {
        ...prev,
        arguments: `${typeof prev.arguments === "string" ? prev.arguments : ""}${typeof row.data.delta === "string" ? row.data.delta : ""}`,
      })
      if (!ids.includes(row.data.item_id)) ids.push(row.data.item_id)
      continue
    }
    if (row.data.type === "response.function_call_arguments.done" && typeof row.data.item_id === "string") {
      const prev = items.get(row.data.item_id) ?? { id: row.data.item_id, type: "function_call" }
      items.set(row.data.item_id, {
        ...prev,
        arguments: typeof row.data.arguments === "string" ? row.data.arguments : prev.arguments,
      })
      if (!ids.includes(row.data.item_id)) ids.push(row.data.item_id)
      continue
    }
    if (row.data.type === "response.reasoning_summary_text.delta" && typeof row.data.item_id === "string") {
      sums.set(row.data.item_id, `${sums.get(row.data.item_id) ?? ""}${typeof row.data.delta === "string" ? row.data.delta : ""}`)
      continue
    }
    if (row.data.type === "response.output_item.done" && isRecord(row.data.item) && typeof row.data.item.id === "string") {
      const prev = items.get(row.data.item.id) ?? {}
      const next = { ...prev, ...row.data.item }
      if (Array.isArray(prev.content) && !Array.isArray(next.content)) next.content = prev.content
      if (typeof prev.arguments === "string" && typeof next.arguments !== "string") next.arguments = prev.arguments
      items.set(row.data.item.id, next)
      if (!ids.includes(row.data.item.id)) ids.push(row.data.item.id)
    }
  }
  const output = ids.map((id) => {
    const item = { ...(items.get(id) ?? { id }) }
    if (item.type === "reasoning" && sums.has(id)) item.summary = [{ type: "summary_text", text: sums.get(id) }]
    return item
  })
  return { ...base, output }
}

/** Given parsed OpenAI chat-completions SSE blocks, reconstructs the final completion json. */
function openaiChat(list: Array<{ data: unknown }>): Record<string, unknown> {
  const choices = new Map<number, Record<string, unknown>>()
  let id = ""
  let model = ""
  let created = 0
  let usage: unknown
  for (const row of list) {
    if (!isRecord(row.data)) continue
    if (typeof row.data.id === "string") id = row.data.id
    if (typeof row.data.model === "string") model = row.data.model
    if (typeof row.data.created === "number") created = row.data.created
    if (isRecord(row.data.usage)) usage = row.data.usage
    if (!Array.isArray(row.data.choices)) continue
    for (const part of row.data.choices) {
      if (!isRecord(part)) continue
      const ix = typeof part.index === "number" ? part.index : 0
      const prev = choices.get(ix) ?? { index: ix, message: { role: "assistant" }, finish_reason: null }
      const msg: Record<string, unknown> = isRecord(prev.message) ? { ...prev.message } : { role: "assistant" }
      if (isRecord(part.delta)) {
        if (typeof part.delta.role === "string") msg.role = part.delta.role
        if (typeof part.delta.content === "string") msg.content = `${typeof msg.content === "string" ? msg.content : ""}${part.delta.content}`
        if (typeof part.delta.reasoning_content === "string") {
          msg.reasoning_content = `${typeof msg.reasoning_content === "string" ? msg.reasoning_content : ""}${part.delta.reasoning_content}`
        }
        if (Array.isArray(part.delta.tool_calls)) {
          const calls: unknown[] = Array.isArray(msg.tool_calls) ? [...(msg.tool_calls as unknown[])] : []
          for (const call of part.delta.tool_calls) {
            if (!isRecord(call)) continue
            const jx = typeof call.index === "number" ? call.index : calls.length
            const prevCall = isRecord(calls[jx])
              ? { ...calls[jx] }
              : { index: jx, id: call.id, type: call.type ?? "function", function: { name: "", arguments: "" } }
            const fn = isRecord(prevCall.function) ? { ...prevCall.function } : { name: "", arguments: "" }
            if (isRecord(call.function) && typeof call.function.name === "string") fn.name = call.function.name
            if (isRecord(call.function) && typeof call.function.arguments === "string") {
              fn.arguments = `${typeof fn.arguments === "string" ? fn.arguments : ""}${call.function.arguments}`
            }
            calls[jx] = { ...prevCall, ...call, function: fn }
          }
          msg.tool_calls = calls
        }
      }
      choices.set(ix, {
        ...prev,
        message: msg,
        finish_reason: part.finish_reason ?? prev.finish_reason ?? null,
      })
    }
  }
  return {
    id,
    object: "chat.completion",
    created,
    model,
    choices: [...choices.values()].sort((a, b) => Number(a.index) - Number(b.index)),
    ...(usage ? { usage } : {}),
  }
}

/** Given parsed Anthropic SSE blocks, reconstructs the final message json. */
function anthropic(list: Array<{ data: unknown }>): Record<string, unknown> {
  let base: Record<string, unknown> = { type: "message", role: "assistant" }
  const blocks = new Map<number, Record<string, unknown>>()
  const json = new Map<number, string>()
  for (const row of list) {
    if (!isRecord(row.data) || typeof row.data.type !== "string") continue
    if (row.data.type === "message_start" && isRecord(row.data.message)) {
      base = { ...base, ...row.data.message }
      continue
    }
    if (row.data.type === "content_block_start" && typeof row.data.index === "number" && isRecord(row.data.content_block)) {
      blocks.set(row.data.index, { ...row.data.content_block })
      continue
    }
    if (row.data.type === "content_block_delta" && typeof row.data.index === "number" && isRecord(row.data.delta)) {
      const prev = blocks.get(row.data.index) ?? { type: "text", text: "" }
      if (row.data.delta.type === "text_delta") blocks.set(row.data.index, { ...prev, text: `${typeof prev.text === "string" ? prev.text : ""}${typeof row.data.delta.text === "string" ? row.data.delta.text : ""}` })
      if (row.data.delta.type === "input_json_delta") json.set(row.data.index, `${json.get(row.data.index) ?? ""}${typeof row.data.delta.partial_json === "string" ? row.data.delta.partial_json : ""}`)
      continue
    }
    if (row.data.type === "message_delta") {
      if (isRecord(row.data.delta)) base = { ...base, ...row.data.delta }
      if (isRecord(row.data.usage)) base.usage = merge(base.usage, row.data.usage)
      continue
    }
    if (isRecord(row.data.usage)) base.usage = merge(base.usage, row.data.usage)
  }
  const content = [...blocks.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ix, block]) => {
      if (block.type !== "tool_use" || !json.has(ix)) return block
      const raw = json.get(ix) ?? ""
      try {
        return { ...block, input: JSON.parse(raw) as unknown }
      } catch {
        return { ...block, input: raw }
      }
    })
  return { ...base, content }
}

/**
 * Given a raw response body and url, returns the final json to log.
 * Plain json is returned directly; known SSE formats are consolidated; failures become `{_body}`.
 */
function responseAsJson(text: string, url: string): Record<string, unknown> {
  try {
    const body = JSON.parse(text) as unknown
    return isRecord(body) ? body : { _body: text }
  } catch {
    const list = events(text)
    if (!list) return { _body: text }
    const path = ((): string => {
      try {
        return new URL(url).pathname
      } catch {
        return url
      }
    })()
    const first = list[0]?.data
    if (path.endsWith("/responses") || (isRecord(first) && typeof first.type === "string" && first.type.startsWith("response."))) {
      return openaiResponses(list)
    }
    if (path.endsWith("/chat/completions") || (isRecord(first) && first.object === "chat.completion.chunk")) {
      return openaiChat(list)
    }
    if (path.endsWith("/messages") || (isRecord(first) && typeof first.type === "string" && (first.type === "message_start" || first.type === "content_block_start"))) {
      return anthropic(list)
    }
    return { _body: text }
  }
}

/** Returns the current time as an ISO-8601 string, used for the `_ts` field on every logged row. */
function now(): string {
  return new Date().toISOString()
}

/** Normalizes a thrown value into a loggable `{_error, _stack?}` record. */
function errorInfo(err: unknown): { _error: string; _stack?: string } {
  return err instanceof Error
    ? err.stack === undefined
      ? { _error: err.message }
      : { _error: err.message, _stack: err.stack }
    : { _error: String(err) }
}

/** Parses a raw request/response body into a record, falling back to `{_body}` when it isn't json. */
function parseBody(text: string): Record<string, unknown> {
  try {
    const body = JSON.parse(text) as unknown
    return isRecord(body) ? body : { _body: text }
  } catch {
    return { _body: text }
  }
}

/**
 * The `_purpose` tag for a row: "" for the main agent loop, "[meta]" for auxiliary calls.
 * OpenCode tells us the kind directly ("primary" | "compaction" | "title" | "generate"), which is far more
 * reliable than the old "does the request carry tools?" heuristic. The viewer keys off this field, treating
 * "" as the primary conversation (rendered bold) and anything else as a de-emphasized meta call.
 */
function purposeOf(kind: string): string {
  return kind === "primary" ? "" : "[meta]"
}

/** Allocates the next per-session sequence number, used as `_id` to pair a request with its response. */
function nextSeq(session: string): number {
  const seq = (ids.get(session) ?? 0) + 1
  ids.set(session, seq)
  return seq
}

/** Derives a filesystem-friendly logfile name from the first user prompt, falling back to the session id. */
function deriveName(title: string | undefined, session: string): string {
  return (
    (title ?? session ?? "")
      .replace(/[^A-Za-z0-9 _-]+/g, " ")
      .trim()
      .split(/\s+/)
      .slice(0, 10)
      .join(" ")
      .slice(0, 50)
      .trim() || "session"
  )
}

/**
 * Per-request state carried from the `http.request` hook to the matching `http.response` hook.
 * Keyed by the `Request` object, whose identity OpenCode preserves across both hooks, so a response is
 * paired with its request (via `_id`) even when several requests of a session are in flight at once.
 */
const pending = new WeakMap<Request, { seq: number; purpose: string; name: string }>()

/** Handles an outgoing LLM request: logs its (delta-compressed) body and records state for the response. */
async function handleRequest(request: Request, session: string, kind: string): Promise<void> {
  const text = await request.clone().text().catch(() => "")
  const raw = parseBody(text)
  const title = typeof raw._body !== "string" ? extractPromptFromRequestBody(raw) : undefined
  const purpose = purposeOf(kind)
  const seq = nextSeq(session)
  const name = deriveName(title, session)
  pending.set(request, { seq, purpose, name })
  const common = { _id: seq, _purpose: purpose, _url: request.url }
  const requestKey = `${session}\n${request.method}\n${request.url}\nrequest\n${purpose}`
  // Full mode (default): log the complete body every time, so the whole re-sent context is visible.
  // Delta mode (OPENCODE_TRACE_FULL=0): log only what changed versus the previous request of this session.
  const requestRow = FULL_MODE ? raw : delta(prevs.get(requestKey), raw as object)[0]
  prevs.set(requestKey, raw as object)
  writeNoThrow(session, name, {
    ...(requestRow as Record<string, unknown>),
    ...common,
    _kind: "request",
    _ts: now(),
  })
}

/** Handles an LLM response: consolidates any SSE stream and logs its (delta-compressed) body in the background. */
function handleResponse(request: Request, response: Response, session: string, kind: string): void {
  // Clone synchronously, before the hook returns, so the body is still unconsumed when we tee it off.
  const clone = response.clone()
  const st = pending.get(request)
  const seq = st?.seq ?? nextSeq(session)
  const purpose = st?.purpose ?? purposeOf(kind)
  const name = st?.name ?? "session"
  const url = request.url
  const method = request.method
  const status = response.status
  const statusText = response.statusText
  const ok = response.ok
  const common = { _id: seq, _purpose: purpose, _url: url }
  // Read the body in the background so streaming to the TUI is never blocked on us buffering the whole response.
  void clone
    .text()
    .then((body) => {
      const json = responseAsJson(body, url)
      const detail = isRecord(json) && isRecord(json.error) && typeof json.error.message === "string"
        ? json.error.message
        : isRecord(json) && typeof json.error === "string"
          ? json.error
          : `${status} ${statusText}`
      const responseNext = (!ok
        ? { ...json, _status: status, _status_text: statusText, _error: detail }
        : json) as object
      const responseKey = `${session}\n${method}\n${url}\nresponse\n${purpose}`
      const responseRow = FULL_MODE ? responseNext : delta(prevs.get(responseKey), responseNext)[0]
      prevs.set(responseKey, responseNext)
      writeNoThrow(session, name, {
        ...(responseRow as Record<string, unknown>),
        ...common,
        _kind: "response",
        _ts: now(),
      })
    })
    .catch((err) => {
      writeNoThrow(session, name, {
        ...common,
        _kind: "error",
        _ts: now(),
        ...errorInfo(err),
      })
    })
}

/** Handles a final (non-retried) LLM request failure by logging an error row, mirroring the old fetch-reject path. */
function handleRetry(session: string, retry: boolean, error: unknown): void {
  if (retry) return // transient failure OpenCode will retry; wait for the eventual response or final failure
  const message = isRecord(error) && typeof error.message === "string"
    ? error.message
    : isRecord(error) && typeof error.name === "string"
      ? error.name
      : String(error)
  writeNoThrow(session, "session", {
    _purpose: "",
    _kind: "error",
    _ts: now(),
    _error: message,
  })
}

/* Plugin model (OpenCode v2):
 * - OpenCode imports this module and reads its default export: a `{ id, setup }` plugin object.
 * - `setup(ctx)` runs once when the plugin initializes. Registering `session.hook("http.request" | "http.response", …)`
 *   is exactly what makes OpenCode route its native provider traffic through us, so no `globalThis.fetch` patching is
 *   needed (that was the v1 approach, and v1 plugins do not run under v2 at all).
 * - `http.request` fires with the outgoing `Request`; `http.response` fires with the *same* `Request` object plus the
 *   `Response`. Both carry `sessionID` and `kind` ("primary" | "compaction" | "title" | "generate").
 * - `setup` returns a cleanup that disposes the hook registrations when the plugin is torn down.
 * `Plugin.define(x)` just returns `x`, so we export the plain object it would produce and import `@opencode/plugin`
 * for types only — keeping this plugin free of any runtime dependency, exactly as the v1 version was.
 */
const plugin: Plugin.Plugin = {
  id: "ljw1004.opencode-trace",
  async setup(ctx) {
    const registrations = await Promise.all([
      ctx.session.hook("http.request", (event) =>
        handleRequest(event.request, String(event.sessionID), event.kind),
      ),
      ctx.session.hook("http.response", (event) =>
        handleResponse(event.request, event.response, String(event.sessionID), event.kind),
      ),
      ctx.session.hook("retry", (event) =>
        handleRetry(String(event.sessionID), event.decision.retry, event.error),
      ),
    ])
    return async () => {
      await Promise.all(registrations.map((registration) => registration.dispose()))
    }
  },
}

export default plugin
