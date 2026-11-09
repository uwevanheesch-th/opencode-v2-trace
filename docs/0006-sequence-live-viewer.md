# ADR 0006: Live sequence view based on HTML transport traces

- Status: Accepted

## Goal

Provide an easy-to-start teaching interface that shows the actual communication
between the user, agent, LLM, and tools. Each request must be inspectable down
to its transmitted prompt components.

## Decision

The sequence view is an **optional** interface that reads the plugin's HTML traces directly.
The plugin continues to record without this server running, and each trace can be opened
independently in a browser using its embedded viewer. User and tool hooks add
`user`, `tool-call`, and `tool-result` rows to these files. Model
communication, tool execution, and user tasks therefore share a single recording.

### Server

- `sequence/server.mjs` uses only built-in Node.js modules.
- Start with `npm run sequence` under Node.js 22+, without an installation or build step.
- Poll every 750 ms, read appended data incrementally, and transmit it over SSE.
- Transmit only complete JSON lines. Buffer partial lines until the next read.
- Use the most recently modified HTML file as the live source. On the initial
  connection, consider only files updated within the last two minutes.
- Bind to `127.0.0.1`, serve a fixed list of UI files, check the host/origin,
  and enforce a 64 MB read limit per trace.

### Browser

- HTML, CSS, and JavaScript without a framework; the diagram is rendered as SVG.
- `sequence/model.mjs` contains independently testable data-processing helpers.
- Request components come from the API fields actually recorded:
  system/developer instructions, messages, tools, and parameters.
- The detail dialog offers text and JSON views, plus copying.
- The source name and available session ID are visible. The view does not
  automatically load demo data and has no replay or file selection controls.
- Attaching to a recent trace sends its existing complete rows before subsequent
  additions, so a live view can include the current session's earlier events.
- **Clear** hides all rows received so far. New rows continue to appear;
  retransmitted old rows from the same source are deduplicated using their line numbers.
  This display cutoff is local to the current page and source. A page reload or source
  change resets it; the saved file is never modified.

## Rationale

The stored transport payloads provide the original content needed for classroom
inspection. No additional collector with its own data format is required.
The same trace now also contains observed tool executions.

A dependency-free interface keeps setup and distribution simple. The parser and
data-processing helpers can be checked with Node's test runner; the integration
test exercises a real HTTP/SSE server against temporary trace files.

## Consequences and limitations

- The plugin runtime still requires `viewer.js`, because every HTML trace includes
  a standalone renderer.
- Complete prompt components require full mode, which is enabled by default.
  Lossy delta traces are not reconstructed into complete requests.
- Older traces without tool hooks do not produce separate tool-execution arrows.
- A user task inferred from a request is marked as inferred. The origin of
  individual texts in files or skills is not invented.
- When several sessions are writing concurrently, the live source may switch.
- The plugin file size limit and the viewer read limit are separate constraints;
  both must be considered for long teaching sessions. The plugin limit is soft
  ([ADR 0002](0002-per-file-size-limit.md)), so allow room for overshoot below the
  viewer's 64 MB read threshold.
