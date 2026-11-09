# ADR 0001: Full trace mode as the default, delta mode opt-in

- Status: Accepted
- Date: 2026-09-30

## Problem

In a full-context LLM request, OpenCode sends the system prompt, tool definitions,
and conversation history needed for that call. Repeated context can therefore appear
in every turn. The plugin records the actual transport payload; it does not reconstruct
history omitted through compaction or provider-side context reuse.

The original plugin delta-compressed each request against its predecessor and folded the
repeated parts into placeholders such as `[unchanged]` and `[repeat]`. This saves space but
hides the fact a teaching tool is meant to show: that the full context is transmitted again
on every turn.

## Decision

Introduce an `OPENCODE_TRACE_FULL` environment variable.

- Unset or any value other than `"0"` produces full mode (the default): captured requests
  and parsed/consolidated responses are logged without delta compression.
- `OPENCODE_TRACE_FULL=0` restores the previous delta behavior.

At each point where a request or response body is logged, the `delta(...)` call is skipped in full
mode and the parsed request or consolidated response is logged instead. This applies
uniformly to the HTTP handlers
(`handleRequest` / `handleResponse`) and the WebSocket handlers (`handleWsSend` / `handleWsReceive`,
see [ADR 0004](0004-websocket-transport-capture.md)). Full mode is not a byte-for-byte
network capture: JSON is reserialized and known streaming response formats are consolidated.
User and tool event rows are recorded independently of this full/delta switch.

## Alternatives considered

1. Keep delta as the default and have the viewer reconstruct the full state.
2. Always use full mode, with no switch.
3. Provide a viewer-side toggle between "changes only" and "full".

## Rationale

Why full mode as the default. The purpose of this fork is didactic (classroom use). The
core lesson is that the harness supplies the model's context and can repeat it on every turn.
That lesson is invisible if the tool compresses the repetition away. A default that hides the
main point would force every instructor to perform a manual configuration step just to make
the tool serve its intended purpose. The default should serve the most common use case, which
here is teaching rather than space-efficient archival.

Why a switch rather than full-only. Delta mode has a real use: in long sessions full mode
can grow quadratically when each turn resends a history that grows at a roughly constant
rate, producing large files.
Anyone using the tool for compact capture rather than teaching can restore the old behavior
with a single variable and no code change.

Why not alternative 1 (viewer reconstructs). This would keep files small but has two
drawbacks. Reconstructing the full state from deltas is error-prone. The result would also be
misleading: the displayed request would be a reconstruction from a lossy diff rather than
the captured payload for that call. The didactic value depends on inspecting the sent data.
Otherwise each viewing requires the explanation that the viewer reassembled the state after the fact.

Why not alternative 2 (always full). This would remove the legitimate delta use case for no
reason. The switch adds a conditional at each HTTP and WebSocket request/response log site and
preserves both usage modes.

Why not alternative 3 (viewer toggle). A UI toggle between "changes only" and "full" would be
convenient but inherits the same complexity and truthfulness problem as alternative 1 (the
viewer would have to reconstruct the full state from deltas), and is not needed to meet the
goal. Full-at-write is simpler and truthful.

Additional reasons. The decision is reversible: it adds only a branch, and the old behavior
remains reachable through the variable. It also respects the project constraint of no extra
setup steps: configuration is through an environment variable only, with no config file or
installation change.

## Consequences

Trace files are larger by default and grow faster, since the repetition recurs on every turn.
This motivates the file-size limit in [ADR 0002](0002-per-file-size-limit.md).
`prevs` is still populated in full mode, retaining the latest payload per delta key
even though it is unused for output in that mode.

The optional Sequence Viewer requires full mode for complete prompt components;
it does not reconstruct lossy delta traces. The embedded HTML viewer can display
both full and delta recordings.
