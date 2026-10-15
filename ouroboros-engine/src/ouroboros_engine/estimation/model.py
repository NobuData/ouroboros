"""The model estimator — O.2's core (`#123 <https://github.com/NobuData/ouroboros/issues/123>`_).

The issue estimator runs on a model **the workspace chooses**: ``ouroboros-rest`` resolves the
workspace's route for the ``estimate`` task kind (Model routing) — or, with none, its Ollama
connection and ``llama3.1:8b`` — and sends the choice as
:attr:`~ouroboros_engine.estimation.contract.EstimateRequest.model`. This estimator asks that
model through the invocation gateway (AF.2), exactly as a dry-run stage or the investigation
loop does: the engine holds no credential and names no provider.

```
request.model            → prompt the model through the gateway → one JSON object
                             → validated, held to the request's vocabularies → the estimate
no model, or any failure → the heuristic's estimate, with a trace that says why
```

**The heuristic is the floor, never an error.** A workspace with no model, a provider that is
down, an answer that is not JSON, a value outside the contract or a workflow the caller did not
offer: each is an estimate from ``heuristic-v0`` whose signals say the fallback ran and why. A
model problem never becomes a ``500`` — sizing an issue is not worth failing over the model.

**What the model decides, and what it does not.** Effort, confidence, the workflow, the model
the work should run on, the cycle range, the minutes and the risk. Not ``files`` — file-touch
prediction needs repository context this request does not carry, and an invented path list
would be worse than the honest empty one — and not ``est_tokens``, which is the heuristic's
figure for what the *work* would cost. Both come from the heuristic's answer for the same issue.
"""

from __future__ import annotations

import logging
from typing import Any, Protocol

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from ouroboros_engine.control_plane.client import ControlPlaneClient
from ouroboros_engine.control_plane.contract import RunContext
from ouroboros_engine.copilot.gateway import Gateway
from ouroboros_engine.estimation.contract import (
    MAX_ESTIMATOR_LENGTH,
    MAX_MINUTES,
    MAX_RISK_NOTE_LENGTH,
    MAX_SIGNAL_LENGTH,
    MAX_SIGNALS,
    Breakdown,
    Effort,
    Estimate,
    EstimateModel,
    EstimateRequest,
    Risk,
    Trace,
)
from ouroboros_engine.estimation.estimator import (
    Estimator,
    EstimatorContractError,
    honours_context,
)
from ouroboros_engine.estimation.heuristic import HeuristicEstimator
from ouroboros_engine.investigation.model import (
    ModelAnswer,
    ModelFailureError,
    collect_answer,
    json_object,
)

_logger = logging.getLogger(__name__)

#: The task kind a sizing call is routed and metered as — ``runCtx.stage``.
ESTIMATE_STAGE = "estimate"

#: The most output tokens one sizing call may ask for: one small JSON object.
MAX_OUTPUT_TOKENS = 1_000

#: The longest issue body the prompt carries. The rest is cut, and the prompt says so.
MAX_PROMPT_BODY = 12_000

#: How long the gateway may take to start answering, and between reads. Shorter than
#: ``ouroboros-rest``'s deadline on the estimate (150 s), so a silent model ends here — in the
#: heuristic's answer — and never in the caller's timeout.
ESTIMATE_GATEWAY_TIMEOUT_SECONDS = 90.0

#: How the trace names the estimator when no model is configured.
NO_MODEL = "no model configured"

SYSTEM_PROMPT = """You size software issues for an autonomous coding loop.

Answer with ONE JSON object and nothing else, with exactly these keys:
  "effort": one of "xs", "s", "m", "l", "xl" — how big the change is
  "confidence": an integer 0-100 — how sure you are of the effort
  "suggested_workflow": one of the workflow tags you are given, copied exactly
  "routed_model": one of the models you are given, copied exactly
  "cycle_min": integer minutes, the optimistic end of how long one loop cycle takes
  "cycle_max": integer minutes, the pessimistic end (>= cycle_min)
  "est_minutes": integer minutes the whole change is expected to take
  "risk": one of "low", "medium", "high"
  "risk_note": one or two sentences on what could go wrong

Never invent a workflow tag or a model that is not in the lists you are given."""


class SizingCaller(Protocol):
    """Anything that can ask the chosen model one question. Tests substitute a recorded one."""

    def call(self, model: EstimateModel, system: str, user: str) -> ModelAnswer:
        """Ask the model.

        Args:
            model: Which model, and what the call is metered against.
            system: The system prompt.
            user: The question.

        Returns:
            The answer and its usage.

        Raises:
            ModelFailureError: When there is no answer.
        """
        ...


class GatewaySizingCaller:
    """Asks the chosen model through the control plane's invocation gateway."""

    def __init__(self, client: ControlPlaneClient, gateway: Gateway) -> None:
        """Hold the two collaborators.

        Args:
            client: Builds the invocation and reads its events.
            gateway: Puts it on a socket.
        """
        self._client = client
        self._gateway = gateway

    def call(self, model: EstimateModel, system: str, user: str) -> ModelAnswer:
        """See :meth:`SizingCaller.call`.

        An alias is sent as one, and the gateway walks the route's chain behind it; a
        connection is sent with ``payload.model`` — *this provider, this model*, no fallback.
        """
        payload: dict[str, Any] = {
            "system": system,
            "messages": [{"role": "user", "content": user}],
            "max_output_tokens": MAX_OUTPUT_TOKENS,
        }
        if model.connection is not None:
            payload["model"] = model.model_id
        try:
            outgoing = self._client.invoke_request(
                RunContext(
                    run=model.subject.id,
                    stage=ESTIMATE_STAGE,
                    cost_cap_cents=model.cost_cap_cents,
                    resolution_version=model.resolution_version,
                ),
                payload,
                connection=model.connection,
                alias=model.alias,
            )
        except ValueError as refused:
            raise ModelFailureError("gateway_refused", str(refused)) from refused
        return collect_answer(self._client, self._gateway, outgoing)


class _ModelSizing(BaseModel):
    """What the model is asked to answer — validated before any of it is believed."""

    model_config = ConfigDict(extra="ignore")

    effort: Effort
    confidence: int = Field(ge=0, le=100)
    suggested_workflow: str = Field(min_length=1)
    routed_model: str = Field(min_length=1)
    cycle_min: int = Field(ge=0, le=MAX_MINUTES)
    cycle_max: int = Field(ge=0, le=MAX_MINUTES)
    est_minutes: int = Field(ge=0, le=MAX_MINUTES)
    risk: Risk
    risk_note: str = Field(min_length=1, max_length=MAX_RISK_NOTE_LENGTH)


class ModelEstimator:
    """Sizes an issue on the workspace's model, with the heuristic as the floor.

    Attributes:
        name: What the route logs when no model answered — the fallback's name.
    """

    def __init__(self, caller: SizingCaller, fallback: Estimator | None = None) -> None:
        """Hold the model caller and the fallback.

        Args:
            caller: Asks the chosen model.
            fallback: What answers when no model can — ``heuristic-v0`` by default.
        """
        self._caller = caller
        self._fallback = fallback or HeuristicEstimator()
        self.name = self._fallback.name

    def estimate(self, request: EstimateRequest) -> Estimate:
        """Size one issue: on the request's model when it names one, else the heuristic.

        Args:
            request: The issue, the vocabularies, and the model to ask.

        Returns:
            The model's estimate, or the heuristic's with the reason it answered instead.
        """
        floor = self._fallback.estimate(request)

        if request.model is None:
            return _with_signal(
                floor, f"model: none — {request.model_unavailable or NO_MODEL}"
            )

        model = request.model
        try:
            answer = self._caller.call(model, SYSTEM_PROMPT, _question(request))
        except ModelFailureError as failed:
            return self._fell_back(
                floor, model, f"{failed.code}: {failed.message}", _tokens(failed.usage)
            )

        tokens = _tokens(answer.usage)
        parsed = json_object(answer.text)
        if parsed is None:
            return self._fell_back(
                floor, model, "the answer was not a JSON object", tokens
            )
        try:
            sizing = _ModelSizing.model_validate(parsed)
            estimate = Estimate(
                effort=sizing.effort,
                confidence=sizing.confidence,
                suggested_workflow=sizing.suggested_workflow,
                routed_model=sizing.routed_model,
                breakdown=Breakdown(
                    files=floor.breakdown.files,
                    est_tokens=floor.breakdown.est_tokens,
                    cycle_min=sizing.cycle_min,
                    cycle_max=sizing.cycle_max,
                    est_minutes=sizing.est_minutes,
                ),
                risk=sizing.risk,
                risk_note=sizing.risk_note,
                trace=Trace(
                    estimator=model.label[:MAX_ESTIMATOR_LENGTH],
                    tokens_used=tokens,
                    signals=[_signal(f"model: {model.label}")],
                ),
            )
            honours_context(estimate, request.context)
        except (ValidationError, EstimatorContractError) as refused:
            return self._fell_back(floor, model, _refusal(refused), tokens)

        return estimate

    def _fell_back(
        self, floor: Estimate, model: EstimateModel, reason: str, tokens: int
    ) -> Estimate:
        """The heuristic's answer, saying the model did not size this and why.

        Args:
            floor: The heuristic's estimate.
            model: The model that was asked.
            reason: Why its answer was not used.
            tokens: What asking it cost anyway.

        Returns:
            The heuristic's estimate with the fallback in its trace and the tokens counted.
        """
        _logger.warning(
            "model estimator fell back to %s",
            floor.trace.estimator,
            extra={"model": model.label, "reason": reason},
        )
        fallback = _with_signal(
            floor, f"fallback: {floor.trace.estimator} — {model.label}: {reason}"
        )
        return fallback.model_copy(
            update={
                "trace": fallback.trace.model_copy(
                    update={"tokens_used": floor.trace.tokens_used + tokens}
                )
            }
        )


def _question(request: EstimateRequest) -> str:
    """The issue and the vocabularies, as the model reads them.

    Args:
        request: The request.

    Returns:
        The user message.
    """
    issue = request.issue
    body = issue.body or "(no description)"
    if len(body) > MAX_PROMPT_BODY:
        body = body[:MAX_PROMPT_BODY] + "\n…(description cut here)"
    lines = [
        f"Repository: {issue.repo}",
        f"Issue #{issue.number}: {issue.title}",
        f"Labels: {', '.join(issue.labels) or '(none)'}",
        "",
        "Description:",
        body,
        "",
        "Workflow tags you may choose from: "
        + ", ".join(request.context.workflow_tags),
        "Models you may choose from: "
        + ", ".join(sorted(set(request.context.model_defaults.values()))),
    ]
    if request.context.facts:
        lines += ["", "Known facts about this repository:"]
        lines += [f"- {fact.text}" for fact in request.context.facts]
    return "\n".join(lines)


def _tokens(usage: list[Any]) -> int:
    """Every token one call consumed, across its hops."""
    return sum(hop.input_tokens + hop.output_tokens for hop in usage)


def _signal(text: str) -> str:
    """A signal, cut to the contract's bound."""
    return text[:MAX_SIGNAL_LENGTH]


def _with_signal(estimate: Estimate, signal: str) -> Estimate:
    """An estimate with one more signal, first, inside the contract's bound.

    Args:
        estimate: The estimate.
        signal: What to add.

    Returns:
        The estimate, its signals led by ``signal``.
    """
    signals = [_signal(signal), *estimate.trace.signals][:MAX_SIGNALS]
    return estimate.model_copy(
        update={"trace": estimate.trace.model_copy(update={"signals": signals})}
    )


def _refusal(refused: Exception) -> str:
    """Why an answer was not used, in a few words."""
    if isinstance(refused, ValidationError):
        fields = sorted(
            {".".join(map(str, e["loc"])) or "answer" for e in refused.errors()}
        )
        return f"the answer was outside the contract ({', '.join(fields)})"
    return f"the answer named something the request did not offer ({refused})"
