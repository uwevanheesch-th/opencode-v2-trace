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

Attach the agent to every traced row and mark switches.

- Every `request`, `response`, `agent-switch`, `error`, and `limit` row carries an `_agent` field.
  The value comes directly from the session hook event (`event.agent`), which the HTTP and WebSocket
  hooks already receive, so no inference is needed.
- A per-session record of the last seen agent (`agents` map) detects a change between consecutive
  requests. On change, a one-line `agent-switch` row is written (`_from`, `_to`).
- Only primary turns (`purpose === ""`) participate in switch detection. Auxiliary `[meta]` calls
  (title/compaction/generate) run under their own internal agent (e.g. `title`) and are excluded, so
  they neither set the baseline nor appear as a switch.
- The viewer shows the agent as a label in the REQUEST/RESPONSE title and renders `agent-switch` as a
  distinct banner.

## Alternatives considered

1. Do not record the agent; leave rows undifferentiated. (the prior behavior)
2. Infer the agent from the system prompt content.
3. Subscribe to a dedicated agent-switch event from the SDK.
4. Read `event.agent` on each request and derive switches from consecutive values. (chosen)

## Rationale

Why attribute every row. "Which prompt does the agent send" cannot be answered without knowing which
agent sent it, because the system prompt and tools differ per agent. The label is part of the answer,
not decoration.

Why derive switches from `event.agent` rather than a dedicated event (against alternative 3). The HTTP
and WebSocket hooks already carry `agent` on every call, so a change between consecutive requests of a
session is a switch. This needs no extra event subscription, has no correlation or ordering problem
against a separate event stream, and stays correct for sub-agents, which simply appear with their own
agent name (and their own session id) on their own requests.

Why not alternative 2 (infer from system prompt). The agent name is provided directly and reliably by
the event. Guessing it from prompt content would be fragile and redundant.

Why not alternative 1 (no attribution). It leaves the original problem unsolved: agents are
indistinguishable and switches are invisible.

Why a separate `agent-switch` row. The switch is itself a meaningful event that explains why the next
prompt differs. A dedicated row makes the trace readable as a narrative and is cheap to produce. The
first agent seen on a session is not a switch and produces no row.

## Consequences

Each request/response shows its agent, and switches appear as explicit rows. Sub-agents are traced the
same way, distinguished by their agent name. Switch detection considers only primary turns
(`purpose === ""`); auxiliary `[meta]` calls such as the `title` agent neither set the baseline nor
trigger a switch, so the first row is the first real primary agent and switches reflect only
user-visible agent changes.
