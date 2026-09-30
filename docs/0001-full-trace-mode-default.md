# ADR 0001: Full trace mode as the default, delta mode opt-in

- Status: Accepted
- Date: 2026-09-30

## Problem

OpenCode uses a stateless LLM model. The model does not retain prior turns; the application
must resend the entire state on every request: the system prompt (the instructions that
define the agent), all tool definitions, and the complete prior conversation. A ten-turn
conversation therefore sends the system prompt ten times.

The original plugin delta-compressed each request against its predecessor and folded the
repeated parts into placeholders such as `[unchanged]` and `[repeat]`. This saves space but
hides the fact a teaching tool is meant to show: that the full context is transmitted again
on every turn.

## Decision

Introduce an `OPENCODE_TRACE_FULL` environment variable.

- Unset or any value other than `"0"` produces full mode (the default): every request and
  response body is logged complete and uncompressed.
- `OPENCODE_TRACE_FULL=0` restores the previous delta behavior.

In `handleRequest` / `handleResponse`, the `delta(...)` call is skipped in full mode and the
raw parsed body is logged instead.

## Alternatives considered

1. Keep delta as the default and have the viewer reconstruct the full state.
2. Always use full mode, with no switch.
3. Provide a viewer-side toggle between "changes only" and "full".

## Rationale

Why full mode as the default. The purpose of this fork is didactic (classroom use). The
core lesson is that LLMs are stateless and that context is therefore repeated on every turn.
That lesson is invisible if the tool compresses the repetition away. A default that hides the
main point would force every instructor to perform a manual configuration step just to make
the tool serve its intended purpose. The default should serve the most common use case, which
here is teaching rather than space-efficient archival.

Why a switch rather than full-only. Delta mode has a real use: in long sessions full mode
grows quadratically (each turn contains the entire prior context), producing large files.
Anyone using the tool for compact capture rather than teaching can restore the old behavior
with a single variable and no code change.

Why not alternative 1 (viewer reconstructs). This would keep files small but has two
drawbacks. Reconstructing the full state from deltas is error-prone. The result would also be
misleading: the displayed data would no longer be the bytes actually written and sent, but a
derivation of them. The didactic value depends on pointing at the real sent data. Otherwise
each viewing requires the explanation that the viewer reassembled the state after the fact.

Why not alternative 2 (always full). This would remove the legitimate delta use case for no
reason. The switch costs almost nothing (one conditional at each of two log sites) and
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
This motivates the file-size limit in ADR 0002. `prevs` is still populated in full mode
(though unused for output) to keep the code paths uniform; the memory cost is negligible for
teaching-sized sessions.
