# ADR 0002: Per-file size limit with a visible bottom notice

- Status: Accepted
- Date: 2026-09-30

## Problem

In full mode ([ADR 0001](0001-full-trace-mode-default.md)), trace files can grow quadratically
when each turn resends a steadily growing conversation history. In long sessions the HTML
files can become large (tens of megabytes or more), which slows the browser viewer that
renders all rows into the DOM. Without an upper
bound, an accidentally long session can produce unusably large files.

## Decision

Introduce an `OPENCODE_TRACE_MAX_MB` environment variable.

- Default is 5 MB.
- A non-negative numeric value sets the limit (decimal values allowed). The implementation
  uses 1,048,576 bytes per unit, conventionally labeled MB in the configuration.
- `-1` disables the limit; the current implementation treats any finite negative value this way.
- An unset, blank, non-numeric, or non-finite value falls back to 5 MB.

This is a **soft limit**, not a strict maximum file size. `writeNoThrow()` checks the
existing on-disk size, including the HTML preamble and embedded viewer, **before**
appending the next row:

1. If the file is below the limit, the row is written in full, even if it crosses the limit.
2. On the next append attempt, if the file is already at or above the limit, that row is
   also written in full. A `_kind:"limit"` notice is appended and the session is marked capped.
3. Later rows for that session are skipped by this plugin instance.

The file can therefore contain both the row that crosses the limit and one further row,
plus the notice. If no subsequent append occurs, there is no limit notice yet. If the
preamble already exceeds the limit (including a limit of `0`), the first row is followed
by the notice. Complete JSON rows are preserved; a complete final turn or matching
request/response pair is **not** guaranteed.

The embedded HTML viewer displays the notice at the end of the trace. The optional
Sequence Viewer represents it as a limit event.

## Alternatives considered

For the behavior at the limit:

1. Hard cut-off: drop any further rows.
2. Write the current row, then stop and append a visible notice. (chosen)
3. Rotate: start a new file and spread the session across several files.

## Rationale

Why a limit as the default. The full-mode default makes large files likely. A default limit
protects against a slow or unloadable viewer without requiring the user to configure anything.
5 MB provides a conservative default for short demonstrations; usable session length
depends on prompt sizes and the amount of tool output.

Why configurable with `-1` for unbounded. Some users deliberately want to capture complete
long sessions. A single numeric value plus `-1` covers both ends without adding more options.

Why fall back to the default on an invalid value rather than unbounded. A typo should not
remove the safety net. Falling back to 5 MB is the conservative choice.

Why alternative 2 (write the row, then stop and notice). Writing complete rows keeps the
JSONL data parseable. The notice explains why logging stopped and how to raise the limit.
This favors row integrity over a strict byte ceiling; it does not wait for a whole turn
to finish, and the pre-append check allows the overshoot described above.

Why the notice only at the bottom. The notice appears where logging actually ends, at the end
of the file. A top notice was considered and rejected: the viewer builds its content
dynamically from the trailing HTML comment, so a "top" notice would require a viewer-side
special case with no real benefit over the end-of-file notice.

Why not alternative 3 (rotate). Spreading one session across multiple files is more work and
more confusing for the teaching use case. One file per session keeps the mapping clear.

Why check the real file size. The check measures the actual on-disk size (including the HTML
preamble and embedded viewer, whose size varies with the renderer), not just the sum of the JSONL
bytes. This keeps the limit honest relative to the file size the user sees.

## Consequences

The default stopping threshold is 5 MB; users who want more set `OPENCODE_TRACE_MAX_MB`
higher or to `-1`. The capped state is held in memory per session, so no further rows
are written after the notice during that plugin instance's lifetime. It is not a
persistent cap across process restarts.

The optional Sequence Viewer has its own 64 MB read limit. Disabling the plugin's
limit does not disable the viewer's limit.
