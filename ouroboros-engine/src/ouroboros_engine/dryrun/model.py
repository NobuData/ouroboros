"""One model call of a dry-run stage, through the invocation gateway (AF.2, #235).

**The models are real — that is what a dry run tests.** A stage sends its prompt and the alias
routing resolved for it to ``POST /internal/llm/invoke`` and reads the NDJSON answer, exactly
as the Workflow Copilot and the investigation loop do: the same
:class:`~ouroboros_engine.control_plane.client.ControlPlaneClient` builds the request and the
same :class:`~ouroboros_engine.copilot.gateway.Gateway` sends it. The harness holds no
provider credential and names no provider.

**The call is attributed to the dry run.** ``runCtx.run`` carries ``dry_runs.id`` and
``stage`` the stage's key, and the cap sent with each call is what is left of the tighter of
the stage's and the run's spend caps — so the gateway can stop a stream that crosses it.

The usage, answer and failure types are the investigation loop's
(:mod:`ouroboros_engine.investigation.model`): one gateway, one vocabulary.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from ouroboros_engine.control_plane.client import ControlPlaneClient, ControlPlaneError
from ouroboros_engine.control_plane.contract import (
    DeltaEvent,
    ErrorEvent,
    RunContext,
    UsageEvent,
)
from ouroboros_engine.copilot.gateway import Gateway, GatewayError
from ouroboros_engine.investigation.model import (
    CallUsage,
    ModelAnswer,
    ModelFailureError,
)

#: The most output tokens one turn of a stage may ask for.
MAX_OUTPUT_TOKENS = 8_000


@dataclass(frozen=True)
class StageCall:
    """One turn a stage wants made.

    Attributes:
        dry_run: ``dry_runs.id`` — what the call is attributed to.
        stage_key: The stage calling.
        alias: The routing alias.
        system: The system prompt.
        messages: The conversation so far, ``{"role", "content"}`` each.
        cost_cap_cents: What is left of the spend cap, or ``None`` for none.
        resolution_version: The resolution the alias came from.
    """

    dry_run: str
    stage_key: str
    alias: str
    system: str
    messages: tuple[dict[str, str], ...]
    cost_cap_cents: int | None = None
    resolution_version: str | None = None


class StageCaller(Protocol):
    """Anything that can make a :class:`StageCall`. Tests substitute a recorded model."""

    def call(self, call: StageCall) -> ModelAnswer:
        """Make one call.

        Args:
            call: The call.

        Returns:
            The answer and its usage.

        Raises:
            ModelFailureError: When there is no answer.
        """
        ...


class GatewayStageCaller:
    """Makes stage calls through the control plane's invocation gateway."""

    def __init__(self, client: ControlPlaneClient, gateway: Gateway) -> None:
        """Hold the two collaborators.

        Args:
            client: Builds the invocation and reads its events.
            gateway: Puts it on a socket.
        """
        self._client = client
        self._gateway = gateway

    def call(self, call: StageCall) -> ModelAnswer:
        """See :meth:`StageCaller.call`."""
        outgoing = self._client.invoke_request(
            RunContext(
                run=call.dry_run,
                stage=call.stage_key,
                cost_cap_cents=call.cost_cap_cents,
                resolution_version=call.resolution_version,
            ),
            {
                "system": call.system,
                "messages": list(call.messages),
                "max_output_tokens": MAX_OUTPUT_TOKENS,
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
