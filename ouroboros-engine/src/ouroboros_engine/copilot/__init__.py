"""The Workflow Copilot's model turn — CD.1 (`#559 <https://github.com/NobuData/ouroboros/issues/559>`_).

Mockup 20's caption is a structural claim: *Copilot edits compile to the same graph as the
canvas and the code editor — nothing is a special case.* This package is where that claim is
enforced on the engine's side, and the enforcement is a shape rather than a promise. The
copilot's **only write path is the typed operation vocabulary** in :mod:`.tools` — the same
``add_stage`` / ``set_stage`` / ``remove_stage`` / ``add_edge`` / ``remove_edge`` /
``set_trigger`` that ``ouroboros-db``'s ``draft_operations`` records (V110, #556) — plus the
``set_guard`` the mockup's *"$5 a run"* needs, which ``ouroboros-rest`` records as a proposal
until the DSL has a guard construct. A model that can only speak operations cannot produce a
graph the canvas could not.

**The division with ``ouroboros-rest``.** This service runs one *model turn*: it assembles the
system context, invokes the routed model through the invocation gateway
(``POST /internal/llm/invoke`` — AD.3's contract, AF.2's executor), and parses what came back
into reply text and structured tool calls. ``ouroboros-rest`` runs the *loop*: it executes the
tools where the data lives, validates every operation against the DSL before application,
applies it under the draft's etag with ``copilot`` provenance, bounces an invalid one back as
a tool result the model can correct from, persists the conversation and meters its cost. So the
engine is stateless and a turn is a pure function of the transcript it was sent.

**Until AF.2 lands the gateway answers ``501``**, and this turn says so with an honest
``gateway_unavailable`` error event rather than a reply that looks like a model answered
(decision W1's *"the page ships whole or not at all"* is kept by the service, not hollowed by it).
"""
