# ADR 0003: Structural request sections in the viewer (System / Tools / History)

- Status: Accepted
- Date: 2026-09-30

## Problem

In full mode each request contains the complete, repeated context. Shown as a flat list of
messages, this makes "a lot" visible but not why it is a lot: the parts (system prompt, tool
definitions, conversation history) are not recognizable as such. The didactic goal is for
students to see the anatomy of an LLM request and which parts are repeated on every turn.

## Decision

Add a `requestSections()` function in the viewer that splits each request into labeled,
collapsible sections: System-Prompt, Tools, and History (Verlauf). The split is purely
structural, derived from a single request with no comparison to previous requests. The system
prompt is read from the top-level `instructions` / `system` field; if that is absent
(chat-completions format), the leading `role:"system"` messages are extracted from the history
and shown as their own section, and the remaining history is shown without that prefix.

## Alternatives considered

1. Flat payload list with no sectioning (the prior behavior).
2. Sectioning with a "new vs. repeated" marker per message.
3. Sectioning by System / Tools / History, without "new vs. repeated". (chosen)

## Rationale

Why section at all. The teaching effect comes from the visible contrast between the large,
always-repeated part (system prompt and tools) and the small new message. Named sections make
this structure recognizable immediately; an undifferentiated list of messages does not.

Why purely structural, without "new vs. repeated" (against alternative 2). Whether a message
is "new" or "repeated" can only be determined by comparison with the previous request, which
is the delta logic deliberately disabled in full mode. Such a marker in full mode would either
be reconstructed (error-prone) or misleading. Sectioning by role/type is correctly derivable
from a single request and stays truthful in every mode. The contrast between repeated and new
content is still visible when clicking through two consecutive requests.

Why not alternative 1 (flat list). It misses the didactic goal: the parts of a request remain
indistinguishable and the repetition is not made tangible.

Why extract the system prompt from `role:"system"` messages. Inspecting real traces showed
that the provider in use uses the chat-completions format: no top-level `instructions` /
`system`, but the system prompt as a leading `role:"system"` message. Without this extraction
the system prompt would not appear as its own section and would be buried in the history. The
extraction covers both forms (top-level field and in-messages).

## Consequences

The viewer shows three clearly named sections per request; the History section carries a note
that it is resent in full on every turn. The sectioning uses `deltaField`, so it also works in
delta mode with renamed keys. Additional or unknown top-level fields remain accessible through
the `raw` child node.
