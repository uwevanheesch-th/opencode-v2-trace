# Project overview: OpenCode Sequence Trace

## Goal

This project helps explain which data a coding agent exchanges with the LLM and
its tools. The trace plugin works independently and writes self-contained HTML
files that can be opened directly in a browser.

The **optional Sequence Viewer** adds a live UML diagram with lifelines for the
**user, agent, LLM, and tools**. Requests can be explored down to individual
prompt components, including their recorded text and JSON.

## Data flow

```text
OpenCode v2
  │ Session/tool hooks
  ▼
index.ts
  │ HTML with an embedded renderer + JSON lines in the trailing comment
  ▼
~/opencode-trace/*.html
  ├─ Open directly in a browser
  │    └─ Embedded viewer.js: expandable trace tree, no server required
  │
  └─ Optional live sequence view
       │ Incremental reads, polling every 750 ms
       ▼
     sequence/server.mjs
       │ Server-Sent Events (/events)
       ▼
     sequence/app.js + sequence/model.mjs
       └─ SVG sequence diagram and detail dialog with text/JSON views
```

### Capture

- `http.request` / `http.response` capture HTTP payloads.
- `experimental.ws.send` / `experimental.ws.receive` capture WebSocket payloads.
- Streaming responses are consolidated for OpenAI Responses, Chat Completions,
  and Anthropic Messages.
- `prompt` and `execute.before` / `execute.after` capture user input and actual
  tool executions. Registration is attempted automatically, but failures for these
  optional hooks are caught. No separate activation flag is needed.
- Request/response rows contain `_id`, `_session`, `_agent`, `_purpose`, and `_ts`.
  `_id` is a plugin-generated per-session sequence number, not a provider request ID.
  Tool rows include `_call_id`, `_tool`, and inputs/outputs, among other fields.
- Changes in the agent names of consecutive primary requests are logged as
  `agent-switch`. These markers are derived from request metadata, not a dedicated
  agent-selection event. Auxiliary calls such as title generation do not trigger a switch.

### Storage

By default, the plugin writes full payloads to HTML traces. It reads `viewer.js`
at runtime and embeds it in each file. This makes the renderer a plugin runtime
dependency. Saved traces remain viewable without OpenCode or the Sequence Viewer
running; reload an open HTML file to see subsequently appended rows.

Full mode disables delta compression of the captured data. Streaming responses are
still consolidated by format-specific handlers rather than stored as an exact
reproduction of every transport frame.

The file size limit defaults to 5 MB and is configurable through
`OPENCODE_TRACE_MAX_MB`. It is a soft limit checked before each append; individual
rows remain complete, but a complete final request/response pair is not guaranteed.
See [ADR 0002](0002-per-file-size-limit.md) for the exact stopping behavior.
The older delta mode is still available in the trace plugin, but does not provide
the full payloads needed for the sequence view's prompt components.

### Optional live view

The local server follows the most recently updated HTML file and transmits its rows
over SSE. On the initial connection, the file must have been updated within the last
two minutes. Once attached, a file continues to be followed; a newer active recording
can replace the source. The server binds to `127.0.0.1` and accepts files up to 64 MB.

The browser maps events directly from trace rows. If an older trace lacks a user
row, it can infer the initial task from a request; this is explicitly marked as
**inferred**. Content alone is not treated as proof that text originated in `AGENTS.md`.

**Clear** sets a local display cutoff. Stored traces and the active SSE connection
are unaffected. The cutoff lasts for the current page and source; reloading the
page or switching sources resets it. Stopping the viewer does not stop recording.

## Tests and getting started

- [README.md](../README.md): Installation, usage, configuration, troubleshooting,
  and development commands.
- `sequence/model.test.mjs`: Parsing the existing `example.html`, prompt components,
  tool events, response payloads, and incomplete trace lines.
- `sequence/server.test.mjs`: Local HTTP/SSE server with newly written and appended
  test data, including verification that file serving is restricted.

## Architecture decisions

- [0001: Full mode by default](0001-full-trace-mode-default.md)
- [0002: File size limit](0002-per-file-size-limit.md)
- [0003: Request sections in the embedded HTML renderer](0003-viewer-request-sections.md)
- [0004: WebSocket capture](0004-websocket-transport-capture.md)
- [0005: Agent attribution and switches](0005-agent-attribution-and-switch.md)
- [0006: Live sequence view](0006-sequence-live-viewer.md)
