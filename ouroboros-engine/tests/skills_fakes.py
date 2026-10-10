"""Fakes for the skill-execution suites (CM.5, #624): a model that answers from a script."""

from __future__ import annotations

import json
from typing import Any

from ouroboros_engine.dryrun.model import StageCall
from ouroboros_engine.investigation.model import (
    CallUsage,
    ModelAnswer,
    ModelFailureError,
)
from ouroboros_engine.skills.contract import SkillRunRequest

DOC = "5eed0097-0000-4000-8000-000000000124"

#: RS-124's roadmap, as `create-roadmap` answers it.
ROADMAP: dict[str, Any] = {
    "title": "Helios — Q4 Improvement Roadmap",
    "milestones": [
        {
            "key": "m1",
            "name": "Docking parity",
            "target_date": "2026-10-15",
            "items": [
                {
                    "key": "dock-mpc",
                    "title": "Wind-feedforward MPC in final approach",
                    "mvp": True,
                    "effort": "l",
                },
                {
                    "key": "dock-retry",
                    "title": "Re-planned abort & retry vectors",
                    "mvp": True,
                    "effort": "m",
                },
            ],
        },
        {
            "key": "m2",
            "name": "Fleet reliability",
            "target_date": None,
            "items": [
                {
                    "key": "fleet-battery",
                    "title": "Battery health model v2",
                    "mvp": False,
                    "effort": None,
                }
            ],
        },
    ],
}

USAGE = CallUsage(
    hop=0,
    connection="anthropic-main",
    model="claude-fable-5",
    input_tokens=1200,
    output_tokens=300,
    cost_cents=1.5,
)


class ScriptedModel:
    """Answers each call with the next scripted text, and records what it was sent."""

    def __init__(self, *answers: str | ModelFailureError) -> None:
        """Hold the script.

        Args:
            answers: One per expected call: the text, or the failure to raise.
        """
        self._answers = list(answers)
        self.calls: list[StageCall] = []

    def call(self, call: StageCall) -> ModelAnswer:
        """Answer the next scripted entry.

        Args:
            call: The call, recorded.

        Returns:
            The scripted answer with one usage row.

        Raises:
            ModelFailureError: When the script says so.
        """
        self.calls.append(call)
        answer = self._answers.pop(0)
        if isinstance(answer, ModelFailureError):
            raise answer
        return ModelAnswer(text=answer, usage=[USAGE])


def roadmap_request(**changes: Any) -> SkillRunRequest:
    """A `create-roadmap` run over a brief.

    Args:
        changes: Fields to replace.

    Returns:
        The request.
    """
    body: dict[str, Any] = {
        "run": DOC,
        "skill": {
            "slug": "create-roadmap",
            "version": 3,
            "body": "Turn the brief into a roadmap of dated milestones.",
        },
        "output": "roadmap",
        "input": {"brief": "# RS-124", "suggestions": []},
        "alias": "research",
        "resolution_version": "r1",
        "cost_cap_cents": 100,
    }
    body.update(changes)
    return SkillRunRequest.model_validate(body)


def issues_request(keys: list[str] | None = None) -> SkillRunRequest:
    """A `create-issues` run over roadmap items.

    Args:
        keys: The item keys to ask about; two by default.

    Returns:
        The request.
    """
    return roadmap_request(
        skill={"slug": "create-issues", "version": 1, "body": "Describe each item."},
        output="issue_bodies",
        input={
            "items": [
                {"key": key, "title": key}
                for key in (keys or ["dock-mpc", "dock-retry"])
            ]
        },
    )


def fenced(value: dict[str, Any]) -> str:
    """An answer the way a model writes one: a sentence and a fenced object.

    Args:
        value: The object.

    Returns:
        The text.
    """
    return f"Here it is.\n```json\n{json.dumps(value)}\n```"
