"""Run a skill: the procedure as the system prompt, the input as the question (CM.5, #624).

The model is reached exactly as a dry-run stage reaches it — the same
:class:`~ouroboros_engine.dryrun.model.StageCaller`, so the same gateway, attribution and
spend cap. Until the invocation gateway exists (AF.2, #235) every run fails with
``gateway_unavailable``; nothing here pretends otherwise.

**The answer is validated, and re-asked once.** A model that answers outside the contract is
told what was wrong and asked again; a second miss is :class:`SkillOutputError`. The runner
never repairs an answer itself — a roadmap that the procedure did not produce is not one.

**The input bounds the output.** ``issue_bodies`` must describe exactly the items the input
names (``input["items"][*]["key"]``): no item skipped, none invented.
"""

from __future__ import annotations

import json
from typing import Any

from pydantic import ValidationError

from ouroboros_engine.dryrun.model import StageCall, StageCaller
from ouroboros_engine.investigation.model import (
    CallUsage,
    ModelFailureError,
    json_object,
    remaining_cap,
)
from ouroboros_engine.skills.contract import (
    MAX_INPUT_BYTES,
    IssueBody,
    Roadmap,
    SkillRunRequest,
    SkillRunResult,
    SkillUsage,
)

#: How many answers a run asks for at most: the first, and one correction.
MAX_ATTEMPTS = 2

#: What each output must look like — appended to the skill's body, so a workspace's edit of
#: the procedure cannot change the shape the control plane stores.
OUTPUT_RULES: dict[str, str] = {
    "roadmap": (
        "Answer with one JSON object and nothing else:\n"
        '{"title": string, "milestones": [{"key": string, "name": string, '
        '"target_date": "YYYY-MM-DD" | null, "items": [{"key": string, "title": string, '
        '"mvp": boolean, "effort": "xs" | "s" | "m" | "l" | "xl" | null}]}]}\n'
        "Keys are lower-case letters, digits, `-` and `_`, at most 32 characters, unique "
        "among milestones and unique among items. When the input carries `previous`, keep "
        "the key of every milestone and item that survives, and give a new key only to "
        "something new. When the input carries `suggestions`, apply every one of them."
    ),
    "issue_bodies": (
        "Answer with one JSON object and nothing else:\n"
        '{"issues": [{"key": string, "body": string}]}\n'
        "One entry for every item in the input's `items`, under that item's `key`, and no "
        "other entry. `body` is the issue description in Markdown."
    ),
}


class SkillInputError(ValueError):
    """The input cannot be run — too large, or missing what the output needs."""


class SkillOutputError(RuntimeError):
    """The model answered every attempt outside the contract.

    Attributes:
        problem: What was wrong with the last answer.
        usage: What the attempts consumed.
    """

    def __init__(self, problem: str, usage: list[CallUsage]) -> None:
        """Name the problem.

        Args:
            problem: What was wrong with the last answer.
            usage: What the attempts consumed.
        """
        super().__init__(problem)
        self.problem = problem
        self.usage = usage


def system_prompt(request: SkillRunRequest) -> str:
    """The system prompt of a run: the procedure, then the output rule.

    Args:
        request: The run.

    Returns:
        The prompt.
    """
    return f"{request.skill.body.strip()}\n\n---\n{OUTPUT_RULES[request.output]}"


def item_keys(request: SkillRunRequest) -> list[str]:
    """The item keys an ``issue_bodies`` run must describe.

    Args:
        request: The run.

    Returns:
        The keys, in input order.

    Raises:
        SkillInputError: When ``input.items`` is not a non-empty list of keyed objects.
    """
    items = request.input.get("items")
    if not isinstance(items, list) or not items:
        raise SkillInputError("an issue_bodies run needs a non-empty `items` list")
    keys: list[str] = []
    for item in items:
        key = item.get("key") if isinstance(item, dict) else None
        if not isinstance(key, str) or not key:
            raise SkillInputError("every item of `items` needs a `key`")
        keys.append(key)
    if len(set(keys)) != len(keys):
        raise SkillInputError("the keys of `items` must be unique")
    return keys


def read_roadmap(answer: dict[str, Any]) -> Roadmap:
    """Validate a ``roadmap`` answer.

    Args:
        answer: The object the model answered with.

    Returns:
        The roadmap.

    Raises:
        ValueError: Naming what is wrong.
    """
    try:
        return Roadmap.model_validate(answer)
    except ValidationError as invalid:
        raise ValueError(_problems(invalid)) from invalid


def read_issue_bodies(answer: dict[str, Any], keys: list[str]) -> list[IssueBody]:
    """Validate an ``issue_bodies`` answer against the items asked about.

    Args:
        answer: The object the model answered with.
        keys: The item keys the input named.

    Returns:
        The bodies, in the input's order.

    Raises:
        ValueError: Naming what is wrong — a malformed entry, a missing item, an extra one.
    """
    raw = answer.get("issues")
    if not isinstance(raw, list):
        raise ValueError("`issues` must be a list")
    try:
        bodies = [IssueBody.model_validate(entry) for entry in raw]
    except ValidationError as invalid:
        raise ValueError(_problems(invalid)) from invalid
    by_key = {body.key: body for body in bodies}
    if len(by_key) != len(bodies):
        raise ValueError("an item is described twice")
    missing = [key for key in keys if key not in by_key]
    extra = sorted(set(by_key) - set(keys))
    if missing or extra:
        raise ValueError(
            f"`issues` must describe exactly the input's items; missing {missing}, "
            f"not asked for {extra}"
        )
    return [by_key[key] for key in keys]


def _problems(invalid: ValidationError) -> str:
    """A validation error as one line a model can act on.

    Args:
        invalid: The error.

    Returns:
        ``path: message`` for the first few problems.
    """
    return "; ".join(
        f"{'.'.join(str(part) for part in error['loc']) or 'answer'}: {error['msg']}"
        for error in invalid.errors()[:8]
    )


class SkillRunner:
    """Runs skills through a model caller. A test installs one over a scripted model."""

    def __init__(self, caller: StageCaller) -> None:
        """Hold the caller.

        Args:
            caller: Makes each model call.
        """
        self._caller = caller

    def run(self, request: SkillRunRequest) -> SkillRunResult:
        """Run one skill.

        Args:
            request: The skill, its input and the output wanted.

        Returns:
            The validated result and what it consumed.

        Raises:
            SkillInputError: When the input cannot be run; no model is called.
            ModelFailureError: When a call produced no answer.
            SkillOutputError: When no attempt answered inside the contract.
        """
        question = json.dumps(request.input, ensure_ascii=False, sort_keys=True)
        if len(question.encode()) > MAX_INPUT_BYTES:
            raise SkillInputError(f"the input is larger than {MAX_INPUT_BYTES} bytes")
        keys = item_keys(request) if request.output == "issue_bodies" else []

        messages: list[dict[str, str]] = [{"role": "user", "content": question}]
        usage: list[CallUsage] = []
        problem = "the model did not answer"

        for attempt in range(1, MAX_ATTEMPTS + 1):
            spent = sum(entry.cost_cents or 0 for entry in usage)
            try:
                answer = self._caller.call(
                    StageCall(
                        dry_run=request.run,
                        stage_key=request.skill.slug,
                        alias=request.alias,
                        system=system_prompt(request),
                        messages=tuple(messages),
                        cost_cap_cents=remaining_cap(request.cost_cap_cents, spent),
                        resolution_version=request.resolution_version,
                    )
                )
            except ModelFailureError as failed:
                raise ModelFailureError(
                    failed.code, failed.message, usage + failed.usage
                ) from failed
            usage.extend(answer.usage)

            parsed = json_object(answer.text)
            try:
                if parsed is None:
                    raise ValueError("the answer holds no JSON object")
                if request.output == "roadmap":
                    return self._result(
                        request, attempt, usage, roadmap=read_roadmap(parsed)
                    )
                return self._result(
                    request, attempt, usage, issues=read_issue_bodies(parsed, keys)
                )
            except ValueError as invalid:
                problem = str(invalid)
                messages.append({"role": "assistant", "content": answer.text})
                messages.append(
                    {
                        "role": "user",
                        "content": (
                            f"That answer was not accepted: {problem}. Answer again with "
                            "only the JSON object, following the rule exactly."
                        ),
                    }
                )

        raise SkillOutputError(problem, usage)

    @staticmethod
    def _result(
        request: SkillRunRequest,
        attempts: int,
        usage: list[CallUsage],
        roadmap: Roadmap | None = None,
        issues: list[IssueBody] | None = None,
    ) -> SkillRunResult:
        """Assemble the answer.

        Args:
            request: The run.
            attempts: How many answers it took.
            usage: What they consumed.
            roadmap: The roadmap, for a ``roadmap`` run.
            issues: The bodies, for an ``issue_bodies`` run.

        Returns:
            The result.
        """
        return SkillRunResult(
            skill=request.skill.slug,
            version=request.skill.version,
            output=request.output,
            roadmap=roadmap,
            issues=issues,
            attempts=attempts,
            usage=[
                SkillUsage(
                    hop=entry.hop,
                    connection=entry.connection,
                    model=entry.model,
                    input_tokens=entry.input_tokens,
                    output_tokens=entry.output_tokens,
                    cost_cents=entry.cost_cents,
                )
                for entry in usage
            ],
        )
