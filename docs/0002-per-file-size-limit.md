# ADR 0002: Per-file size limit with a visible bottom notice

- Status: Accepted
- Date: 2026-09-30

## Problem

In full mode (ADR 0001) each trace file grows quadratically, because every turn contains the
entire prior context. In long sessions the HTML files can become large (tens of megabytes or
more), which slows the browser viewer that renders all rows into the DOM. Without an upper
bound, an accidentally long session can produce unusably large files.

## Decision

Introduce an `OPENCODE_TRACE_MAX_MB` environment variable.

- Default is 5 MB.
- A numeric value sets the limit in MB (decimal values allowed).
- `-1` disables the limit.
- An invalid value falls back to 5 MB, so a typo does not silently enable unbounded logging.

When the limit is reached, the current row is still written in full (the last turn stays
intact), a `_kind:"limit"` notice row is appended, and logging stops for that session. The
viewer renders this notice as a banner at the bottom of the file. The size check reads the
real on-disk file size before appending, so the file can exceed the limit by at most one row.

## Alternatives considered

For the behavior at the limit:

1. Hard cut-off: drop any further rows.
2. Write the current row, then stop and append a visible notice. (chosen)
3. Rotate: start a new file and spread the session across several files.

## Rationale

Why a limit as the default. The full-mode default makes large files likely. A default limit
protects against a slow or unloadable viewer without requiring the user to configure anything.
5 MB covers typical demo sessions completely and loads smoothly in any browser.

Why configurable with `-1` for unbounded. Some users deliberately want to capture complete
long sessions. A single numeric value plus `-1` covers both ends without adding more options.

Why fall back to the default on an invalid value rather than unbounded. A typo should not
remove the safety net. Falling back to 5 MB is the conservative choice.

Why alternative 2 (write the row, then stop and notice). A hard cut-off (alternative 1) can
leave half a turn and look as if the session ended, when only logging stopped. Alternative 2
keeps the file internally consistent (last turn complete) and uses the notice to make clear
why the log ends and how to raise the limit. Because the check happens before appending, the
file exceeds the limit by at most one row, which is acceptable.

Why the notice only at the bottom. The notice appears where logging actually ends, at the end
of the file. A top notice was considered and rejected: the viewer builds its content
dynamically from the trailing HTML comment, so a "top" notice would require a viewer-side
special case with no real benefit over the end-of-file notice.

Why not alternative 3 (rotate). Spreading one session across multiple files is more work and
more confusing for the teaching use case. One file per session keeps the mapping clear.

Why check the real file size. The check measures the actual on-disk size (including the HTML
preamble and embedded viewer, about 11 KB of fixed overhead), not just the sum of the JSONL
bytes. This keeps the limit honest relative to the file size the user sees.

## Consequences

Very long full-mode sessions are truncated at 5 MB by default; users who want more set
`OPENCODE_TRACE_MAX_MB` higher or to `-1`. The capped state is tracked per session, so no
further rows are written after the notice.
