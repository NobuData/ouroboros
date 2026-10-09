"""One model turn, end to end: payload out, events back.

:class:`CopilotTurnRunner` is what the route hands a request to. It builds the invocation with
the control-plane client (so the request carries the internal key and names exactly one target,
the alias), sends it through a :class:`~.gateway.Gateway`, reads the NDJSON answer with the
client's own event reader, and turns the gateway's events into the copilot's: text deltas go
through the :class:`~.parser.TurnParser`, usage is forwarded, a gateway error ends the turn as
an ``error`` event, ``done`` closes it.

**The invocation is attributed to the session.** AD.3's ``runCtx.run`` is *which run this call
belongs to*; a copilot conversation is not a run (decision W4 keeps the copilot domain out of the
run plane), so the session id is what is sent — the one thing every token of the exchange can be
attributed to — and ``stage`` names the task kind.
"""

from __future__ import annotations

from collections.abc import Iterator

from ouroboros_engine.control_plane.client import ControlPlaneClient, ControlPlaneError
from ouroboros_engine.control_plane.contract import (
    DeltaEvent,
    DoneEvent,
    ErrorEvent,
    RunContext,
    UsageEvent,
)

from .contract import (
    GATEWAY_REFUSED,
    CopilotDone,
    CopilotError,
    CopilotEvent,
    CopilotTurnRequest,
    CopilotUsage,
)
from .gateway import Gateway, GatewayError
from .parser import TurnParser
from .prompt import payload

#: The task kind the copilot is routed as — the ``stage`` the invocation is attributed to, and
#: the ``task_kinds.name`` ``ouroboros-rest`` resolves for the alias it sends.
COPILOT_TASK_KIND = "copilot-workflow"

#: What a turn reports when the gateway closed the stream without saying why.
FINISHED_WITHOUT_REASON = "stop"


class CopilotTurnRunner:
    """Runs turns through one client and one gateway."""

    def __init__(self, client: ControlPlaneClient, gateway: Gateway) -> None:
        """Hold the two collaborators.

        Args:
            client: Builds the request and reads the answer; see its module.
            gateway: Puts the request on a socket.
        """
        self._client = client
        self._gateway = gateway

    def run(self, request: CopilotTurnRequest) -> Iterator[CopilotEvent]:
        """Make one turn.

        Args:
            request: The turn.

        Yields:
            The copilot's events, in order. A turn always ends with exactly one ``error`` or
            one ``done``.
        """
        run_ctx = RunContext(
            run=request.session,
            stage=COPILOT_TASK_KIND,
            cost_cap_cents=request.cost_cap_cents,
            resolution_version=request.resolution_version,
        )
        outgoing = self._client.invoke_request(
            run_ctx, payload(request), alias=request.alias
        )
        parser = TurnParser()
        finish_reason = FINISHED_WITHOUT_REASON

        try:
            for event in self._client.read_events(self._gateway.stream(outgoing)):
                if isinstance(event, DeltaEvent):
                    yield from parser.feed(event.text)
                elif isinstance(event, UsageEvent):
                    yield CopilotUsage(
                        kind="usage",
                        input_tokens=event.input_tokens,
                        output_tokens=event.output_tokens,
                        cost_cents=event.cost_cents,
                        model=event.model,
                        connection=event.connection,
                    )
                elif isinstance(event, ErrorEvent):
                    yield from parser.finish()
                    yield CopilotError(
                        kind="error", code=event.code, message=event.message
                    )
                    return
                elif isinstance(event, DoneEvent):
                    finish_reason = event.finish_reason
        except GatewayError as failed:
            yield from parser.finish()
            yield CopilotError(kind="error", code=failed.code, message=failed.message)
            return
        except ControlPlaneError as refused:
            yield from parser.finish()
            yield CopilotError(
                kind="error",
                code=GATEWAY_REFUSED,
                message=f"the invocation gateway answered outside its contract ({refused.code})",
            )
            return

        yield from parser.finish()
        yield CopilotDone(kind="done", finish_reason=finish_reason)
