# OpenCode Sequence Trace

This project captures OpenCode v2 LLM traffic and tool executions and displays them
in a live UML sequence diagram for teaching. Read `README.md` for usage and
`docs/OVERVIEW.md` for the data flow.

## Structure

- `index.ts`: OpenCode v2 plugin (`{ id, setup }`), using session HTTP/WebSocket hooks
  and optional prompt/tool hooks. `@opencode/plugin` is imported for types only.
- `viewer.js`: runtime dependency of the plugin, embedded in every HTML trace.
- `sequence/`: dependency-free Node server, browser UI, model helpers and tests.
- `example.html`: existing HTML trace used by the sequence model tests.
- `docs/`: architecture decisions for the trace plugin and sequence viewer.

The plugin writes to `~/opencode-trace/`. The sequence server reads those HTML files
directly and streams rows over SSE. Keep the full-payload default and preserve original
request/response data. Label inferred information explicitly; do not invent provenance
such as `AGENTS.md` or skill origins. Clear only resets the browser display.

## Development

- Node.js 22+. `npm run sequence` starts the UI at `http://127.0.0.1:4177`, with no
  installation or build step. `SEQUENCE_PORT` and `OPENCODE_TRACE_DIR` configure the server.
- Run `npm install` once for development dependencies, then `npm run typecheck`,
  `npm run lint` and `npm test` after changes. Typecheck/lint cover the TypeScript plugin;
  the tests cover the sequence model and HTTP/SSE integration.
- Load the checkout through `plugins` in OpenCode's config, using the absolute
  **directory** path, not `index.ts`. Use only one registration of this plugin.
- After plugin changes, restart OpenCode with the local plugin loaded and exercise
  a new task, e.g. `opencode run --auto "why is the sky blue?"`. For UI changes, also
  check request details, tool events and Clear in the live view.

## Distribution

This fork is distributed from Git, not published to npm. Keep the package's `files`
list consistent with the plugin runtime and the sequence viewer. Existing release
tags may predate sequence/tool support. The installation guides target the planned
`V3` tag (uppercase); it must be pushed before those installation commands work.
Releases use a version bump and a new Git tag;
do not commit, tag or push unless requested.
