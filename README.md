# OpenCode Sequence Trace

A trace plugin for **OpenCode v2** with an **optional live sequence viewer**.
The plugin captures HTTP and WebSocket requests, consolidates streamed responses,
and records user and tool events. Recordings are stored as HTML files under
`~/opencode-trace/`.

**The trace plugin works independently.** Every HTML trace includes an embedded
interactive viewer and can be opened directly in a browser. You can continue using
this workflow without cloning the repository or running a viewer server.

For live classroom demonstrations, the optional Sequence Viewer adds a UML diagram
of the communication between the **user, agent, LLM, and tools**. Clicking a request
opens its actual transmitted prompt components, including the original text and JSON.

[Installation](#install-from-git-v3) · [Usage](#usage) ·
[Configuration](#configuration) · [Troubleshooting](#troubleshooting) ·
[Development](#development-and-tests)

## Install from Git (V3)

**Trace plugin requirements:** Git, a configured OpenCode v2 installation, and a
browser to inspect the HTML traces. The plugin types are pinned to
`@opencode/plugin` **2.0.19**.

**Optional Sequence Viewer:** Also requires Node.js 22+ (including npm).

These instructions target the Git tag **`V3`** (uppercase, case-sensitive).

### 1. Install the trace plugin

```bash
opencode plugin add "git+https://github.com/uwevanheesch-th/opencode-v2-trace.git#V3"
opencode service restart
opencode plugin list
```

`plugin add` downloads the plugin from Git and adds it to your global OpenCode
configuration. The plugin ID is `uwevanheesch-th.opencode-trace`.
No manual clone or `npm install` is needed for the plugin itself.
If you have an older installation, follow [Upgrading to V3](#upgrading-to-v3) first.

### 2. Record a task and open its HTML trace

Use OpenCode in the project you want to inspect and submit a new task. The plugin
writes traces under `~/opencode-trace/`. Open that folder in your file manager and
open an `.html` file in your browser to inspect its requests and responses.

**That is all you need for the standalone trace workflow.** Each file contains its
own viewer; no separate `viewer.js` download or local HTTP server is required.

The `V3` plugin includes user and tool hooks. Events from before the plugin was
loaded cannot be captured retroactively. You can inspect the active plugin
configuration with `opencode debug config`.

### Optional: Download and start the Sequence Viewer

If you also want the live sequence diagram, clone the same release to a local directory:

```bash
git clone --branch V3 --depth 1 https://github.com/uwevanheesch-th/opencode-v2-trace.git
cd opencode-v2-trace
npm run sequence
```

Then open **http://127.0.0.1:4177**. The viewer requires neither `npm install`
nor a build step. It reads the HTML traces written by the installed plugin;
do not also register the cloned directory as another plugin.

These commands work on Windows PowerShell, Linux, and macOS. Initially, the viewer
displays a waiting message until OpenCode writes an active trace. For subsequent
launches, run `npm run sequence` from this checkout. Press `Ctrl+C` in the viewer
terminal to stop it.

Keep the viewer terminal running and submit a new OpenCode task. The sequence
diagram updates as the plugin writes traces. OpenCode and the Sequence Viewer
must run on the same machine and use the same home directory. Stopping the
Sequence Viewer does not stop the plugin from recording HTML traces.

### Upgrading to V3

Check `opencode plugin list` and `opencode debug config` for an existing installation.
Remove the old Git entry before adding `V3`. For example, when upgrading from `v2`:

```bash
opencode plugin remove "git+https://github.com/uwevanheesch-th/opencode-v2-trace.git#v2"
opencode plugin add "git+https://github.com/uwevanheesch-th/opencode-v2-trace.git#V3"
opencode service restart
opencode plugin list
```

Use the exact old entry if its tag or URL differs. If the previous installation used
a local directory or a project configuration, remove that entry from the relevant
`plugins` array as well. Preserve unrelated settings and other plugins.

Start a new OpenCode task after upgrading. Earlier plugin tags may not include the
user/tool hooks. **If you use the optional Sequence Viewer**, also download its `V3`
release into a fresh directory using the clone command above. Updating the installed
plugin does not update an existing viewer checkout.

## Usage

### Standalone HTML traces

Open any recorded `.html` file from `~/opencode-trace/` directly in your browser.
The embedded viewer displays the trace as an expandable tree of requests, responses,
and recorded data. Saved files remain inspectable after the OpenCode session ends.
Reload the page to see newly appended data if the plugin is still writing that file.

### Optional live sequence diagram

- **Blue:** Agent → LLM. Click to inspect system/developer instructions,
  transmitted messages, tool specifications, and request parameters.
- **Prompt component:** Click to view its full recorded text or unmodified JSON.
  Use the copy button to copy the displayed content.
- **Green:** LLM → Agent. Click to inspect the consolidated response.
- **Yellow:** Tool calls and results with their recorded inputs and outputs.
- **Clear:** Clears the browser display; the live connection stays active and new
  events continue to appear. The stored trace file is not modified.

The viewer follows the most recently updated HTML recording. On the initial connection,
only files updated within the last two minutes are considered. The actual source and,
where recorded, the session ID appear at the top. The viewer automatically switches
to a more recently updated active recording.

The view is live-only, with no replay, sample data, or file selection. `example.html`
is used only in automated tests. Prompt text provenance is not guessed: for example,
there is no separate `AGENTS.md` component without evidence of that origin. Its text
may be included in the system prompt.

## Configuration

### In the OpenCode service/agent process

| Variable | Default | Meaning |
| --- | --- | --- |
| `OPENCODE_TRACE_FULL` | `1` | Complete payloads. `0` enables the older, lossy delta logging. Use full mode for the sequence view's prompt components. |
| `OPENCODE_TRACE_MAX_MB` | `5` | Size limit per trace in MB; `-1` disables the limit. Invalid values fall back to 5 MB. |

These variables must be set in the environment of the OpenCode process that is
actually running. An existing background service does not automatically inherit
the environment of a new client terminal. At the size limit, the plugin writes
a notice and stops recording that session.

### In the viewer process

These settings apply only to the optional Sequence Viewer.

| Variable | Default | Meaning |
| --- | --- | --- |
| `SEQUENCE_PORT` | `4177` | Local HTTP port |
| `OPENCODE_TRACE_DIR` | `~/opencode-trace` | Directory from which the viewer reads HTML traces; does not change the plugin's output directory |

Example for macOS/Linux:

```bash
SEQUENCE_PORT=4180 npm run sequence
```

Windows PowerShell:

```powershell
$env:SEQUENCE_PORT = '4180'
npm run sequence
```

The server binds to `127.0.0.1` and reads traces up to **64 MB**. For longer
classroom demonstrations, the plugin limit can be set to 50 MB, for example.

## Troubleshooting

- **Waiting for OpenCode:** Check whether new `.html` files are being created under
  `~/opencode-trace/` using the commands below. On the initial connection, files
  last updated more than two minutes ago are not selected as active recordings.
- **No new HTML files:** Check `opencode debug config` to confirm that OpenCode
  loads the plugin, then restart OpenCode, including its background service.
- **LLM arrows but no tool arrows:** Check for an older plugin installation,
  install `V3`, restart OpenCode and its service, and submit a new task that uses tools.
- **Git cannot find `V3`:** Tag names are case-sensitive. Use uppercase `V3` and
  confirm that the release tag has been pushed to GitHub.
- **Recording limit reached:** The plugin stops at 5 MB per trace by default.
  For longer teaching sessions, set `OPENCODE_TRACE_MAX_MB=50` in the OpenCode
  process environment. Use `OPENCODE_TRACE_FULL=1` (the default) for complete
  prompt components. See [Configuration](#configuration).
- **A different session is displayed:** The viewer follows the most recently
  updated local HTML recording. For an unambiguous classroom demonstration, only
  one OpenCode session should produce new requests at a time.
- **Port in use:** Set `SEQUENCE_PORT=4180` in the viewer's environment and open
  `http://127.0.0.1:4180`. See the platform-specific commands under
  [In the viewer process](#in-the-viewer-process).

List recent traces on macOS/Linux:

```bash
ls -lt ~/opencode-trace/*.html
```

Windows PowerShell:

```powershell
Get-ChildItem "$HOME/opencode-trace/*.html" | Sort-Object LastWriteTime -Descending | Select-Object -First 5
```

## Project structure

| Path | Purpose |
| --- | --- |
| `index.ts` | OpenCode plugin: hooks, stream consolidation, storage, and metadata |
| `sequence/server.mjs` | Local server, incremental file reading, and live SSE stream |
| `sequence/model.mjs` | HTML trace parser, sequence events, and prompt/response components |
| `sequence/app.js`, `sequence/index.html`, `sequence/style.css` | Browser UI with an SVG sequence diagram and detail dialog |
| `sequence/*.test.mjs` | Model tests and HTTP/SSE integration test |
| `viewer.js` | Renderer required by the plugin for standalone HTML traces |
| `example.html` | Existing HTML trace used as a test fixture |
| `docs/` | Architecture overview and decisions for trace capture and the sequence view |

For details on the data flow, see the [project overview](docs/OVERVIEW.md) and
[sequence architecture](docs/0006-sequence-live-viewer.md).

## Development and tests

### Load a local development checkout

For plugin development, replace the Git installation with the absolute path to your
checkout in the OpenCode configuration actually in use, `opencode.json(c)`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/ABSOLUTE/PATH/opencode-v2-trace"]
}
```

Use a **directory**, not `index.ts`. Preserve other configuration fields and plugins,
and keep only one installation of this plugin active. Restart OpenCode, including
its background service, after switching to the checkout.

Install the development dependencies once:

```bash
npm install
```

Run the checks:

```bash
npm run typecheck
npm run lint
npm test
```

TypeScript and ESLint check the TypeScript plugin. `npm test` runs the sequence tests
(also available directly through `npm run test:sequence`). The integration test starts
its own local server and writes test data to a temporary directory.

For a manual end-to-end test, load the local plugin version, restart OpenCode,
run `npm run sequence`, and submit a new task that uses tools. Check the request
components, tool inputs and outputs, and subsequent events after clicking **Clear**.

## Recordings

Traces contain full prompts, responses, and tool data in plain text and may include
secrets. Use suitable test data and review recordings before sharing them. Both
viewers process traces locally. HTML files can be opened independently using their
embedded viewer. The optional Sequence Viewer server listens only on `127.0.0.1`
and does not allow arbitrary file access.

## License and origin

MIT; see [LICENSE](LICENSE).

The trace plugin is based on [ljw1004/opencode-trace](https://github.com/ljw1004/opencode-trace)
and the OpenCode v2 migration [Heaven-Rajan/ASE-Plugin-Fix](https://github.com/Heaven-Rajan/ASE-Plugin-Fix).
This fork adds teaching-oriented trace capture and the live sequence view.
It is distributed through the Git repository, not npm.
