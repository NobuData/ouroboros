"""One model call of the investigation loop, through the invocation gateway (AF.2, #235).

The loop never holds a credential and never names a provider: it sends a prompt and a routing
alias to ``POST /internal/llm/invoke`` and reads the NDJSON answer, exactly as the Workflow
Copilot does — the same :class:`~ouroboros_engine.control_plane.client.ControlPlaneClient`
builds the request and the same :class:`~ouroboros_engine.copilot.gateway.Gateway` sends it.

**The invocation is attributed to the investigation.** ``runCtx.run`` is *which run this call
belongs to*; an investigation is not a run, so its id is what is sent — the one thing every
token it spends can be attributed to — and ``stage`` names the routed task kind.

**A call that produced no answer is a named failure.** :class:`ModelFailureError` carries whether
the cause was the spend cap (``cost_cap_exceeded`` — a budget breach) or anything else (the
gateway absent, unreachable, a chain exhausted — a synthesis failure). Usage the gateway
reported before failing is kept on the failure: it was paid for.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from typing import Any, Protocol

from ouroboros_engine.control_plane.client import ControlPlaneClient, ControlPlaneError
from ouroboros_engine.control_plane.contract import (
    DeltaEvent,
    ErrorEvent,
    RunContext,
    UsageEvent,
)
from ouroboros_engine.copilot.gateway import Gateway, GatewayError

from .contract import Stage

#: The gateway's code for a run whose spend cap is spent.
COST_CAP_EXCEEDED = "cost_cap_exceeded"

#: The task kind each stage is routed as — the ``stage`` an invocation is attributed to.
#: Planning and choosing operations are the cheap ``research-plan`` kind; reading and
#: synthesising are ``research``.
STAGE_TASK_KINDS: dict[str, str] = {
    "plan": "research-plan",
    "select": "research-plan",
    "digest": "research",
    "synthesize": "research",
}

#: The most output tokens a stage may ask for.
MAX_OUTPUT_TOKENS: dict[str, int] = {
    "plan": 1_500,
    "select": 2_000,
    "digest": 1_500,
    "synthesize": 8_000,
}


@dataclass(frozen=True)
class CallUsage:
    """What one hop of one call consumed.

    Attributes:
        hop: The hop of the resolved chain.
        connection: The provider connection.
        model: The model.
        input_tokens: Tokens sent.
        output_tokens: Tokens received.
        cost_cents: What it cost, or ``None`` when unpriced.
    """

    hop: int
    connection: str
    model: str
    input_tokens: int
    output_tokens: int
    cost_cents: float | None


@dataclass(frozen=True)
class ModelAnswer:
    """A completed call.

    Attributes:
        text: Everything the model wrote.
        usage: What each hop consumed.
    """

    text: str
    usage: list[CallUsage] = field(default_factory=list)


class ModelFailureError(RuntimeError):
    """A call that produced no answer.

    Attributes:
        code: The gateway's code — ``gateway_unavailable``, ``chain_exhausted``,
            ``cost_cap_exceeded``.
        message: A sentence for a person.
        usage: What was consumed before it failed.
    """

    def __init__(
        self, code: str, message: str, usage: list[CallUsage] | None = None
    ) -> None:
        """Name the failure.

        Args:
            code: The code.
            message: The sentence.
            usage: What was consumed before it failed.
        """
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message
        self.usage = usage or []

    @property
    def over_budget(self) -> bool:
        """Whether the cause was the spend cap."""
        return self.code == COST_CAP_EXCEEDED


@dataclass(frozen=True)
class ModelCall:
    """One call the loop wants made.

    Attributes:
        investigation: ``investigations.id`` — what the call is attributed to.
        stage: Which step of the loop is calling.
        alias: The routing alias.
        system: The system prompt.
        user: The user message.
        cost_cap_cents: What is left of the spend ceiling, or ``None`` for no ceiling.
        resolution_version: The resolution the alias came from.
    """

    investigation: str
    stage: Stage
    alias: str
    system: str
    user: str
    cost_cap_cents: int | None = None
    resolution_version: str | None = None


class ModelCaller(Protocol):
    """Anything that can make a :class:`ModelCall`. Tests substitute a recorded fixture."""

    def call(self, call: ModelCall) -> ModelAnswer:
        """Make one call.

        Args:
            call: The call.

        Returns:
            The answer and its usage.

        Raises:
            ModelFailureError: When there is no answer.
        """
        ...


class GatewayModelCaller:
    """Makes calls through the control plane's invocation gateway."""

    def __init__(self, client: ControlPlaneClient, gateway: Gateway) -> None:
        """Hold the two collaborators.

        Args:
            client: Builds the invocation and reads its events.
            gateway: Puts it on a socket.
        """
        self._client = client
        self._gateway = gateway

    def call(self, call: ModelCall) -> ModelAnswer:
        """See :meth:`ModelCaller.call`."""
        run_ctx = RunContext(
            run=call.investigation,
            stage=STAGE_TASK_KINDS[call.stage],
            cost_cap_cents=call.cost_cap_cents,
            resolution_version=call.resolution_version,
        )
        outgoing = self._client.invoke_request(
            run_ctx,
            {
                "system": call.system,
                "messages": [{"role": "user", "content": call.user}],
                "max_output_tokens": MAX_OUTPUT_TOKENS[call.stage],
            },
            alias=call.alias,
        )
        text: list[str] = []
        usage: list[CallUsage] = []

        try:
            for event in self._client.read_events(self._gateway.stream(outgoing)):
                if isinstance(event, DeltaEvent):
                    text.append(event.text)
                elif isinstance(event, UsageEvent):
                    usage.append(
                        CallUsage(
                            hop=event.hop,
                            connection=event.connection,
                            model=event.model,
                            input_tokens=event.input_tokens,
                            output_tokens=event.output_tokens,
                            cost_cents=event.cost_cents,
                        )
                    )
                elif isinstance(event, ErrorEvent):
                    raise ModelFailureError(event.code, event.message, usage)
        except GatewayError as failed:
            raise ModelFailureError(failed.code, failed.message, usage) from failed
        except (ControlPlaneError, ValueError) as refused:
            raise ModelFailureError(
                "gateway_refused",
                "the invocation gateway answered outside its contract",
                usage,
            ) from refused

        return ModelAnswer(text="".join(text), usage=usage)


def remaining_cap(spend_cents: int | None, spent: float) -> int | None:
    """What is left of a spend ceiling, as the gateway's whole-cent cap.

    Args:
        spend_cents: The ceiling, or ``None`` for none.
        spent: Cents spent so far.

    Returns:
        The whole cents left (never negative), or ``None`` when there is no ceiling.
    """
    if spend_cents is None:
        return None
    return max(0, math.floor(spend_cents - spent))


def json_object(text: str) -> dict[str, Any] | None:
    """Read the JSON object a model was asked to answer with.

    Models wrap JSON in a code fence or a sentence often enough that refusing those would
    fail calls that did the work; so this takes the outermost ``{…}`` of the text. Anything
    that still is not an object is ``None`` — the caller re-asks or fails, it never guesses.

    Args:
        text: The model's answer.

    Returns:
        The object, or ``None`` when the text holds none.
    """
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        parsed = json.loads(text[start : end + 1])
    except (ValueError, RecursionError):
        # RecursionError: an answer nested thousands deep is not one the template asked for.
        return None
    return parsed if isinstance(parsed, dict) else None
