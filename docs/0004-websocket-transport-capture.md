# ADR 0004: Capture the WebSocket transport, not just HTTP

- Status: Accepted
- Date: 2026-10-17

## Problem

The plugin only registered the `http.request` / `http.response` session hooks. With some providers
this captured almost nothing useful: only short auxiliary calls such as title generation went over
HTTP, while the main agent turn produced no trace rows at all. Users saw title requests but never the
actual prompts the agent sent, for any agent.

Diagnosis on a real provider (AcademicCloud/GWDG, OpenAI-style `/responses`) confirmed the cause:
the `http.request` hook fired exactly once per session with `kind=title`. The primary turn never
reached the HTTP hook. The agent loop runs over a WebSocket instead: one outgoing `response.create`
frame carries the prompt (`experimental.ws.send`), and the answer streams back as many `response.*`
frames (`experimental.ws.receive`).

## Decision

Register the `experimental.ws.send` and `experimental.ws.receive` session hooks in addition to the
HTTP ones.

- `ws.send`: parse the outgoing frame and log it as a `request` row, reusing the same prompt-title
  extraction, agent attribution, delta/full handling, and size cap as HTTP requests.
- `ws.receive`: buffer the streamed frames per session and, when the stream ends, consolidate them
  into one `response` row.

Consolidation is provider-agnostic. The frames' shape selects the consolidator rather than assuming
OpenAI: Anthropic (`message_start` / `content_block_*` / `message_stop`), OpenAI chat-completions
(`chat.completion.chunk`), or OpenAI `/responses` (default). Stream end is detected across dialects
via `isWsResponseEnd` (`response.completed` / `response.failed`, `message_stop`, or a chunk carrying
`finish_reason`). The outgoing-prompt detector likewise accepts any shape: `response.create`,
`input`, `messages`, or a `prompt` field.

## Alternatives considered

1. Keep HTTP-only. (the prior behavior)
2. Use the generic `event` hook (`message.updated` / `message.part.updated`) to reconstruct prompts
   and responses from OpenCode's internal message model.
3. Capture the WebSocket frames directly via the `experimental.ws.*` hooks. (chosen)
4. Hard-code the OpenAI `/responses` consolidator for WebSocket frames.

## Rationale

Why capture the WebSocket at all. The main agent turn is the thing the user asked to see. On a
WebSocket provider it never touches HTTP, so an HTTP-only plugin cannot show it. Capturing the socket
is the only way to trace the real prompts for these providers.

Why the `experimental.ws.*` hooks rather than the `event` hook (against alternative 2). The event
hook exposes OpenCode's internal message model, not the bytes sent to the model. Reconstructing the
prompt from it would be a second, lossy representation that can drift from what actually went over the
wire, and it would duplicate state that the frames already carry. The `ws.send` frame is the prompt as
sent; the `ws.receive` frames are the answer as received. This matches the project's existing approach
of tracing the real payloads, and it reuses the frames' own identifiers and ordering.

Why provider-agnostic consolidation (against alternative 4). The plugin must work regardless of the
selected model, not only OpenAI. The three streaming dialects already have consolidators in the code
(`anthropic`, `openaiChat`, `openaiResponses`); selecting among them by frame shape — the same way the
HTTP path's `responseAsJson` does — keeps WebSocket and HTTP behavior consistent and avoids locking the
feature to one provider.

Why not alternative 1 (HTTP-only). It leaves WebSocket providers with no trace of the agent loop,
which is the whole point of the tool.

Why `experimental.*` is acceptable. These hooks are marked experimental in the SDK, so the risk is
that they change. That risk is contained: the HTTP path still works independently, failures in tracing
are swallowed and never crash OpenCode, and the feature degrades to "no WebSocket rows" rather than
breaking.

## Consequences

WebSocket providers now produce `request` and consolidated `response` rows for the primary agent loop,
with the same agent attribution, delta/full modes, and size cap as HTTP. If `ws.send` was missed (e.g.
the plugin loaded mid-stream), `ws.receive` still flushes a best-effort response under a fresh id.

Verified against two providers and two streaming dialects: OpenAI `/responses` (frames typed
`response.*`) and the chat-completions dialect (`chat.completion.chunk`, reconstructed via the
`choices` path). In both cases the shape-based selection chose the correct consolidator and the
answer text was reconstructed. The Anthropic path shares the same mechanism but has not yet been
exercised against real Anthropic frames.
