"""Recorded fixtures for the investigation loop: a control plane and a model, in memory.

:class:`FakeControl` behaves as ``ouroboros-rest``'s internal research surface does — it
numbers attempts, deduplicates ledger sources, refuses a stale checkpoint, keeps usage rows
by sequence number and holds findings to the citation rule — so the loop's tests assert on
what the control plane would actually hold. :class:`RecordedModel` answers each step from a
recording, with usage, and can be scripted to plant an uncited claim or to fail.

RS-127 (mockup 22) is the recording: *why do rivals dock in wind and we do not* — the gap is
control, not sensors.
"""

from __future__ import annotations

import copy
import json
from collections.abc import Callable
from typing import Any

from ouroboros_engine.investigation.contract import InvestigateRequest
from ouroboros_engine.investigation.control import (
    BUDGET_EXHAUSTED,
    CHECKPOINT_STALE,
    NOT_RUNNING,
    CheckpointAck,
    ControlRefusalError,
    ControlUnavailableError,
    Delivery,
    Finish,
    LedgerSource,
    Started,
    ToolAnswer,
    UsageEntry,
)
from ouroboros_engine.investigation.model import (
    CallUsage,
    ModelAnswer,
    ModelCall,
    ModelFailureError,
)

INVESTIGATION = "5eed0091-0000-4000-8000-000000000127"

#: What each recorded tool operation answers: the payload and the sources it read.
TOOL_RECORDINGS: dict[tuple[str, str, str], dict[str, Any]] = {
    ("web", "search", "skylink docking wind"): {
        "payload": {"hits": [{"title": "Skylink S4 teardown", "rank": 1}]},
        "sources": [
            {
                "kind": "web",
                "title": "Skylink S4 docking module — teardown & sensor BOM",
                "locator": "https://droneanalysts.example.com/s4-teardown",
                "excerpt": "The S4 uses the same optical-flow sensor class as Helios.",
            }
        ],
    },
    ("web", "fetch", "https://skylink.example.com/releases/4.2"): {
        "payload": {"text": "4.2 adds wind-feedforward MPC in the final 2 m."},
        "sources": [
            {
                "kind": "web",
                "title": "Skylink 4.2 release notes",
                "locator": "https://skylink.example.com/releases/4.2",
                "excerpt": "Wind-feedforward MPC is applied in the final 2 m.",
            }
        ],
    },
    ("code", "query", "blame"): {
        "payload": {"unchanged_months": 14},
        "sources": [
            {
                "kind": "code",
                "title": "dock_ctrl.c blame — gains last tuned 14 months ago",
                "locator": "git://helios-firmware@8c1b2e4/src/dock/dock_ctrl.c#L214",
                "excerpt": "approach gains unchanged in 14 months",
            }
        ],
    },
    ("tickets", "query", "search"): {
        "payload": {"rows": 9},
        "sources": [
            {
                "kind": "ticket",
                "title": "Churn interviews Q2 — 9 of 14 cite docking reliability",
                "locator": "issue-index://support/churn-2026-q2",
                "excerpt": "9 of 14 churned accounts cite docking reliability.",
            }
        ],
    },
}

#: The operations the recorded selection step chooses, one list per iteration.
SELECTIONS: list[list[dict[str, Any]]] = [
    [
        {
            "tool": "web",
            "op": "search",
            "input": {"query": "skylink docking wind", "limit": 3},
        },
        {
            "tool": "web",
            "op": "fetch",
            "input": {"locator": "https://skylink.example.com/releases/4.2"},
        },
    ],
    [
        {
            "tool": "code",
            "op": "query",
            "input": {"op": "blame", "path": "dock_ctrl.c"},
        },
        {"tool": "tickets", "op": "query", "input": {"op": "search", "query": "dock"}},
    ],
]

#: The recorded synthesis answers, one per pass. Cite keys are ledger numbers.
SYNTHESES: list[dict[str, Any]] = [
    {
        "claims": [
            {"text": "The gap is control, not sensors.", "cites": ["01"]},
            {
                "text": "Skylink applies wind-feedforward MPC in the final 2 m.",
                "cites": ["[02]"],
            },
        ],
        "open_questions": ["Does AeroMesh use a beacon?"],
    },
    {
        "claims": [
            {
                "text": "Our approach controller has been unchanged in 14 months.",
                "cites": [3],
            },
            {
                "text": "9 of 14 churned accounts cite docking reliability.",
                "cites": ["04"],
            },
        ],
        "open_questions": [],
    },
]

#: The recorded deliverable inputs, by deliverable.
DELIVERABLES: dict[str, dict[str, Any]] = {
    "matrix": {
        "title": "Docking in wind",
        "us": "Helios",
        "rivals": ["Skylink"],
        "rows": [
            {
                "capability": "Docking in >8 m/s gusts",
                "gap": "high",
                "cells": [
                    {"subject": "Helios", "status": "partial", "cites": ["03"]},
                    {"subject": "Skylink", "status": "shipping", "cites": ["02"]},
                    {"subject": "Novum", "status": "none", "cites": []},
                ],
            }
        ],
        "epic": "Docking parity",
        "tickets": [
            {
                "key": "DOCK-1",
                "title": "wind-feedforward MPC",
                "effort": "m",
                "capability": "Docking in >8 m/s gusts",
                "cites": ["02"],
            },
            {
                "key": "DOCK-2",
                "title": "gust estimator",
                "effort": "s",
                "capability": "Docking in >8 m/s gusts",
                "cites": [],
            },
        ],
    },
    "fix_draft": {
        "title": "Retune approach gains",
        "hypothesis": "Stale gains",
        "suspects": [{"where": "dock_ctrl.c", "why": "untuned", "cites": ["03"]}],
        "fix": "Add feedforward",
        "repro": "HIL gust profile",
        "cites": ["03"],
    },
    "roadmap_doc": {
        "title": "Docking parity",
        "themes": [
            {"title": "Wind docking", "rationale": "Churn", "cites": ["04"]},
            {"title": "Beacons", "rationale": "A hunch", "cites": []},
        ],
        "milestones": [
            {"title": "M1", "themes": ["Wind docking"], "outcome": "Parity"}
        ],
    },
}

#: The four built-in kinds' v1 playbooks, as V106 seeds them.
PLAYBOOKS: dict[str, dict[str, Any]] = {
    "gap_analysis": {
        "version": 1,
        "default_tools": ["web", "competitor", "code", "tickets", "telemetry"],
        "synthesis_template": "gap_analysis@1",
        "deliverables": ["brief", "matrix"],
    },
    "bug_root_cause": {
        "version": 1,
        "default_tools": ["code", "tickets", "telemetry"],
        "synthesis_template": "bug_root_cause@1",
        "deliverables": ["brief", "fix_draft"],
    },
    "regression_forensics": {
        "version": 1,
        "default_tools": ["code", "telemetry", "tickets"],
        "synthesis_template": "regression_forensics@1",
        "deliverables": ["brief", "fix_draft"],
    },
    "roadmap_improvements": {
        "version": 1,
        "default_tools": ["tickets", "web", "competitor"],
        "synthesis_template": "roadmap_improvements@1",
        "deliverables": ["brief", "roadmap_doc"],
    },
}


def request_for(
    kind: str = "gap_analysis",
    *,
    depth: str = "standard",
    spend_cents: int | None = 600,
    operations: int = 8,
    sources: int = 12,
) -> InvestigateRequest:
    """An investigation request under a built-in kind's playbook.

    Args:
        kind: The kind's slug.
        depth: The depth preset.
        spend_cents: The spend ceiling.
        operations: The operation budget.
        sources: The source budget.

    Returns:
        The request.
    """
    return InvestigateRequest.model_validate(
        {
            "investigation": INVESTIGATION,
            "kind": {"slug": kind, "playbook": PLAYBOOKS[kind]},
            "question": "Why do rivals dock in wind and we do not?",
            "tools": [
                {"slug": "web", "operations": ["search", "fetch"]},
                {"slug": "code", "operations": ["query"]},
                {"slug": "tickets", "operations": ["query"]},
            ],
            "depth": depth,
            "budget": {
                "operations": operations,
                "sources": sources,
                "spend_cents": spend_cents,
            },
            "alias": "researcher-long-ctx",
            "plan_alias": "sizer",
            "resolution_version": "r1",
        }
    )


class FakeControl:
    """The control plane's internal research surface, in memory."""

    def __init__(self) -> None:
        """Start with a queued investigation and nothing archived."""
        self.status = "queued"
        self.attempt = 0
        self.seq = 0
        self.checkpoint_state: dict[str, Any] | None = None
        self.duration_ms = 0
        self.cancel_requested = False
        self.sources: list[LedgerSource] = []
        self.usage: dict[int, UsageEntry] = {}
        self.provenance: dict[str, Any] | None = None
        self.delivered: Delivery | None = None
        self.finished: Finish | None = None
        self.tool_calls: list[tuple[str, str, dict[str, Any]]] = []
        self.checkpoints = 0
        #: Raise ``ControlUnavailableError`` on the Nth checkpoint write — a killed worker.
        self.die_at_checkpoint: int | None = None
        #: Answer ``cancelRequested`` from the Nth checkpoint write on.
        self.cancel_at_checkpoint: int | None = None
        #: Tool slugs whose every operation fails with this code.
        self.failing_tools: dict[str, str] = {}
        #: Called before each tool operation — a hook for a test to interfere.
        self.before_tool: Callable[[], None] | None = None

    def start(
        self,
        investigation: str,
        *,
        loop_version: str,
        alias: str,
        resolution_ref: str | None,
        task: str,
    ) -> Started:
        """Claim or resume, as the control plane does."""
        if self.status not in ("queued", "running"):
            raise ControlRefusalError("investigation_not_runnable", 409, self.status)
        self.status = "running"
        self.attempt += 1
        self.provenance = {
            "researcher": loop_version,
            "alias": alias,
            "resolution_ref": resolution_ref,
            "task": task,
            "investigation": investigation,
        }
        return Started(
            investigation="RS-127",
            attempt=self.attempt,
            checkpoint=copy.deepcopy(self.checkpoint_state),
            checkpoint_seq=self.seq,
            duration_ms=self.duration_ms,
            cancel_requested=self.cancel_requested,
            sources=list(self.sources),
        )

    def tool(
        self,
        investigation: str,
        slug: str,
        operation: str,
        tool_input: dict[str, Any],
        *,
        operations_left: int,
    ) -> ToolAnswer:
        """Answer a recorded operation and archive its sources, deduplicated."""
        del investigation
        if self.before_tool is not None:
            self.before_tool()
        if self.status != "running":
            raise ControlRefusalError(NOT_RUNNING, 409, self.status)
        if operations_left < 1:
            raise ControlRefusalError(BUDGET_EXHAUSTED, 409, "no operations left")
        self.tool_calls.append((slug, operation, dict(tool_input)))
        if slug in self.failing_tools:
            raise ControlRefusalError(self.failing_tools[slug], 502, "the tool failed")

        key = tool_input.get("query") or tool_input.get("locator") or tool_input["op"]
        if operation == "query":
            key = tool_input["op"]
        recording = TOOL_RECORDINGS.get((slug, operation, key))
        if recording is None:
            raise ControlRefusalError("research_tool_failed", 502, "nothing recorded")

        answered: list[LedgerSource] = []
        for source in recording["sources"]:
            existing = next(
                (held for held in self.sources if held.locator == source["locator"]),
                None,
            )
            if existing is None:
                existing = LedgerSource(
                    id=f"src-{len(self.sources) + 1}",
                    cite_no=len(self.sources) + 1,
                    tool=slug,
                    **source,
                )
                self.sources.append(existing)
            answered.append(existing)
        return ToolAnswer(payload=recording["payload"], sources=answered)

    def checkpoint(
        self,
        investigation: str,
        *,
        attempt: int,
        seq: int,
        state: dict[str, Any],
        duration_ms: int,
        usage: list[UsageEntry],
    ) -> CheckpointAck:
        """Store a checkpoint, refusing one from an attempt that was replaced."""
        del investigation
        self.checkpoints += 1
        if (
            self.die_at_checkpoint is not None
            and self.checkpoints == self.die_at_checkpoint
        ):
            self.die_at_checkpoint = None
            raise ControlUnavailableError("the worker was killed")
        if self.status != "running":
            raise ControlRefusalError(NOT_RUNNING, 409, self.status)
        if attempt != self.attempt or seq <= self.seq:
            raise ControlRefusalError(CHECKPOINT_STALE, 409, "a newer attempt owns it")
        # A checkpoint is JSON on the wire: prove the state survives the trip.
        self.checkpoint_state = json.loads(json.dumps(state))
        self.seq = seq
        self.duration_ms = duration_ms
        self._record(usage)
        if (
            self.cancel_at_checkpoint is not None
            and self.checkpoints >= self.cancel_at_checkpoint
        ):
            self.cancel_requested = True
        return CheckpointAck(cancel_requested=self.cancel_requested)

    def deliver(self, investigation: str, delivery: Delivery) -> None:
        """Accept a brief, holding it to the citation rule."""
        del investigation
        if self.status != "running":
            raise ControlRefusalError(NOT_RUNNING, 409, self.status)
        known = {source.id for source in self.sources}
        for claim in delivery.claims:
            if claim.type == "finding" and not claim.sources:
                raise ControlRefusalError("brief_claim_uncited", 422, claim.ref)
            if not set(claim.sources) <= known:
                raise ControlRefusalError("brief_source_unknown", 422, claim.ref)
        self._record(delivery.usage)
        self.duration_ms = delivery.duration_ms
        self.delivered = delivery
        self.status = "brief_ready"

    def finish(self, investigation: str, finish: Finish) -> None:
        """End as failed or cancelled, keeping the partial."""
        del investigation
        if self.status != "running":
            raise ControlRefusalError(NOT_RUNNING, 409, self.status)
        if finish.attempt != self.attempt:
            raise ControlRefusalError(CHECKPOINT_STALE, 409, "a newer attempt owns it")
        self._record(finish.usage)
        self.checkpoint_state = json.loads(json.dumps(finish.checkpoint))
        self.seq = finish.seq
        self.duration_ms = finish.duration_ms
        self.finished = finish
        self.status = finish.outcome

    def spend_cents(self) -> float:
        """What the usage rows add up to."""
        return sum(entry.cost_cents or 0 for entry in self.usage.values())

    def _record(self, usage: list[UsageEntry]) -> None:
        for entry in usage:
            self.usage.setdefault(entry.seq, entry)


class RecordedModel:
    """Answers each step of the loop from a recording."""

    def __init__(self, *, cost_cents: float | None = 10.0) -> None:
        """Start a recording.

        Args:
            cost_cents: What every call costs.
        """
        self.cost_cents = cost_cents
        self.calls: list[ModelCall] = []
        self.syntheses = copy.deepcopy(SYNTHESES)
        self.selections = copy.deepcopy(SELECTIONS)
        self.deliverables = copy.deepcopy(DELIVERABLES)
        #: Stages that fail, and the gateway code they fail with.
        self.failing: dict[str, str] = {}
        #: Stages that answer prose instead of JSON, and how many times.
        self.garbled: dict[str, int] = {}

    def call(self, call: ModelCall) -> ModelAnswer:
        """Answer one call from the recording."""
        self.calls.append(call)
        usage = [
            CallUsage(
                hop=0,
                connection="conn-anthropic",
                model="claude-sonnet-4-6",
                input_tokens=1_000,
                output_tokens=100,
                cost_cents=self.cost_cents,
            )
        ]
        if call.stage in self.failing:
            raise ModelFailureError(self.failing[call.stage], "no answer", [])
        if self.garbled.get(call.stage, 0) > 0:
            self.garbled[call.stage] -= 1
            return ModelAnswer(text="I could not decide.", usage=usage)
        return ModelAnswer(text=json.dumps(self._answer(call)), usage=usage)

    def stages(self) -> list[str]:
        """The stage of every call made, in order."""
        return [call.stage for call in self.calls]

    def _answer(self, call: ModelCall) -> dict[str, Any]:
        if call.stage == "plan":
            return {"questions": ["What do rivals ship?", "What does our side show?"]}
        if call.stage == "select":
            # Chosen from what the prompt shows is archived, as a model would: asked the
            # same thing again after a restart, it answers the same thing again.
            archived = call.user.count("\n- [")
            if archived == 0:
                return {"operations": self.selections[0]}
            return {"operations": self.selections[1] if archived < 4 else []}
        if call.stage == "digest":
            return {"notes": []}
        if call.user.startswith("Produce the "):
            deliverable = call.user.removeprefix("Produce the ").split(" ", 1)[0]
            return self.deliverables[deliverable]
        # By the research questions the pass covers, so a pass asked for again after a
        # restart is answered the same way.
        first = "1. What do rivals ship?" in call.user
        return self.syntheses[0 if first else len(self.syntheses) - 1]
