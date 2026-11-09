# ADR 0005: Agent attribution per row and agent-switch markers

- Status: Accepted
- Date: 2026-10-17

## Problem

OpenCode runs different agents (e.g. `build`, `plan`, and sub-agents started via the `task` tool).
Each agent sends a different prompt: different system prompt and different tools. The trace did not
record which agent made a request, so the same-looking rows could not be told apart, and a change of
agent — which is exactly why the next prompt looks different — was invisible. This was the user-visible
symptom of "does not work well when switching agents".

## Decision

Attach the agent where the relevant hook provides it, and derive switch markers
from consecutive primary requests.

- `request`, `response`, and `agent-switch` rows carry `_agent`. Request agents come
  from `event.agent`; responses reuse the captured request agent where available.
- HTTP response-processing errors retain the request's `_agent`, but final retry-error
  rows and limit notices do not carry it. User rows also have no agent field. The
  subsequently added `tool-call` and `tool-result` rows take `_agent` from their tool hooks.
- A per-session record of the last seen agent (`agents` map) detects a change between consecutive
  requests. On change, a one-line `agent-switch` row is written (`_from`, `_to`).
- Only primary turns (`purpose === ""`) participate in switch detection. Auxiliary `[meta]` calls
  (title/compaction/generate) run under their own internal agent (e.g. `title`) and are excluded, so
  they neither set the baseline nor appear as a switch.
- The embedded HTML viewer shows the agent as a label in REQUEST/RESPONSE titles and
  renders `agent-switch` as a distinct entry. The optional Sequence Viewer shows a
  self-message on the agent lifeline and includes the agent in event details.

## Alternatives considered

1. Do not record the agent; leave rows undifferentiated. (the prior behavior)
2. Infer the agent from the system prompt content.
3. Subscribe to a dedicated agent-switch event from the SDK.
4. Read `event.agent` on each request and derive switches from consecutive values. (chosen)

## Rationale

Why attribute requests and responses. "Which prompt does the agent send" cannot be answered
without knowing which agent sent it, because the system prompt and tools differ per agent.
The label is part of the answer,
not decoration.

Why derive switches from `event.agent` rather than a dedicated event (against alternative 3). The HTTP
and WebSocket hooks already carry `agent` on every call, so a change between consecutive requests of a
session produces a switch marker. This needs no extra event subscription or correlation
with a separate event stream. It detects changes only when another primary request is
observed; it does not capture every UI selection or prove what caused a change. Sub-agent
requests are attributed within their own sessions rather than creating a parent/child
handoff graph.

Why not alternative 2 (infer from system prompt). The agent name is provided directly and reliably by
the event. Guessing it from prompt content would be fragile and redundant.

Why not alternative 1 (no attribution). It leaves the original problem unsolved: agents are
indistinguishable and switches are invisible.

Why a separate `agent-switch` row. The switch is itself a meaningful event that explains why the next
prompt differs. A dedicated row makes the trace readable as a narrative and is cheap to produce. The
first agent seen on a session is not a switch and produces no row.

## Consequences

Each request/response records its agent, and inferred switches appear as explicit rows.
Sub-agents are traced the same way, distinguished by agent and session. Switch detection
considers only primary turns (`purpose === ""`); auxiliary `[meta]` calls such as title
generation neither set the baseline nor trigger a switch, but remain in the trace.
The first primary request establishes the baseline and emits no switch marker.
