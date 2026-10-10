"""The control plane, as the investigation loop sees it — five calls and their shapes.

Everything durable about an investigation lives in ``ouroboros-rest``: the lifecycle row, the
citation ledger, the checkpoint, the usage rows. The loop reaches it through
``/internal/research/*`` and nothing else:

* ``POST …/investigations/{id}/start`` — claim the run (or resume it) and read back the
  checkpoint and the ledger so far.
* ``POST …/tools/{slug}/{op}`` — one tool operation (CL.1, #614); its sources are archived in
  the ledger before the answer returns.
* ``PUT …/investigations/{id}/checkpoint`` — save the state after a step; the answer says
  whether a person asked for the run to stop.
* ``POST …/investigations/{id}/brief`` — deliver the brief, its claims and deliverable inputs.
* ``POST …/investigations/{id}/finish`` — end as ``failed`` or ``cancelled``, partials kept.

:class:`InvestigationControl` is the port the loop is written against; a test substitutes a
fake. :class:`HttpInvestigationControl` is the standard-library transport, the same choice
:mod:`ouroboros_engine.copilot.gateway` made: no runtime dependency for one JSON round trip.

**Two failures, told apart.** :class:`ControlRefusalError` is the control plane answering *no* in
its error envelope — a decision the loop reacts to by code. :class:`ControlUnavailableError` is no
answer at all; the loop stops where it is and the checkpoint is what the next attempt resumes
from.
"""

from __future__ import annotations

import json
from http import HTTPStatus
from typing import Any, Literal, Protocol
from urllib import error, request
from urllib.parse import quote, urljoin

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from ouroboros_engine.control_plane.contract import (
    INTERNAL_KEY_HEADER,
    RESEARCH_INVESTIGATION_BRIEF_PATH,
    RESEARCH_INVESTIGATION_CHECKPOINT_PATH,
    RESEARCH_INVESTIGATION_FINISH_PATH,
    RESEARCH_INVESTIGATION_START_PATH,
    RESEARCH_TOOL_PATH,
)

from .contract import FailureReason, Stage

#: The control plane's refusal when a checkpoint comes from a worker that was replaced.
CHECKPOINT_STALE = "investigation_checkpoint_stale"

#: … when the investigation is no longer running (cancelled, failed or delivered elsewhere).
NOT_RUNNING = "investigation_not_running"

#: … when it cannot be started or resumed from the status it is in.
NOT_RUNNABLE = "investigation_not_runnable"

#: … when the tool surface judges the remaining budget spent.
BUDGET_EXHAUSTED = "research_budget_exhausted"

#: Seconds one control-plane call may take. A tool operation can clone a repository or read
#: a slow page, so this is generous; a checkpoint answers in milliseconds.
DEFAULT_TIMEOUT_SECONDS = 180.0

_WIRE = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="ignore")
_SENT = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")


class ControlRefusalError(RuntimeError):
    """The control plane refused a call.

    Attributes:
        code: Its stable code — ``research_tool_failed``, ``investigation_checkpoint_stale``.
        status: The HTTP status.
        message: Its sentence.
    """

    def __init__(self, code: str, status: int, message: str) -> None:
        """Record a refusal.

        Args:
            code: The envelope's code.
            status: The HTTP status.
            message: The envelope's message.
        """
        super().__init__(f"{code}: {message}")
        self.code = code
        self.status = status
        self.message = message


class ControlUnavailableError(RuntimeError):
    """The control plane did not answer, or answered outside its contract."""


class LedgerSource(BaseModel):
    """One archived source, as the loop needs it.

    Attributes:
        id: ``source_records.id`` — what a claim links to.
        cite_no: The ``07`` of ``[07]``.
        cite_key: The ``git`` of ``[git]``, when the record has one.
        tool: The tool that read it.
        kind: The record kind.
        title: The sources panel's title.
        locator: Where it came from.
        excerpt: The archived passage a claim may lean on.
    """

    model_config = _WIRE

    id: str
    cite_no: int
    cite_key: str | None = None
    tool: str = ""
    kind: str = ""
    title: str
    locator: str
    excerpt: str


class Started(BaseModel):
    """The answer to ``start``.

    Attributes:
        investigation: ``RS-127``.
        attempt: 1 on the first start, one more on every resume.
        checkpoint: The state the last attempt saved, or ``None`` on a first start.
        checkpoint_seq: How many checkpoints exist; the next write is one more.
        duration_ms: Working time recorded so far.
        cancel_requested: Whether a person already asked for it to stop.
        sources: The ledger so far.
    """

    model_config = _WIRE

    investigation: str
    attempt: int
    checkpoint: dict[str, Any] | None = None
    checkpoint_seq: int = 0
    duration_ms: int = 0
    cancel_requested: bool = False
    sources: list[LedgerSource] = Field(default_factory=list)


class ToolAnswer(BaseModel):
    """The answer to one tool operation.

    Attributes:
        payload: What the tool answered — hits, a document, rows — or ``None``.
        sources: The sources it archived, with their ledger numbering.
        skipped: A page the tool declined to read, or ``None``.
    """

    model_config = _WIRE

    payload: Any = None
    sources: list[LedgerSource] = Field(default_factory=list)
    skipped: dict[str, Any] | None = None


class UsageEntry(BaseModel):
    """One model call's usage, as the gateway reported it.

    Attributes:
        seq: The call's number within the investigation.
        stage: Which step of the loop made it.
        alias: The routing alias it was made on.
        hop: The hop of the resolved chain that served it.
        connection: The provider connection.
        model: The model, as the provider names it.
        input_tokens: Tokens sent.
        output_tokens: Tokens received.
        cost_cents: What it cost, or ``None`` when nothing prices it.
    """

    model_config = _SENT

    seq: int
    stage: Stage
    alias: str
    hop: int
    connection: str
    model: str
    input_tokens: int
    output_tokens: int
    cost_cents: float | None = None


class CheckpointAck(BaseModel):
    """The answer to ``checkpoint``.

    Attributes:
        cancel_requested: Whether a person asked for the run to stop.
    """

    model_config = _WIRE

    cancel_requested: bool = False


class Span(BaseModel):
    """One span of a brief paragraph.

    Attributes:
        text: The words.
        claim: The claim this span states, by ref; ``None`` for connective text.
    """

    model_config = _SENT

    text: str
    claim: str | None = None


class Paragraph(BaseModel):
    """One paragraph of a brief.

    Attributes:
        spans: Its spans, in reading order.
    """

    model_config = _SENT

    spans: list[Span]


class BriefBody(BaseModel):
    """A brief's structured body — V108's ``briefs.body``.

    Attributes:
        paragraphs: Its paragraphs.
    """

    model_config = _SENT

    paragraphs: list[Paragraph]


class Claim(BaseModel):
    """One claim of the brief.

    Attributes:
        ref: The span ref that states it.
        type: ``finding`` (cited) or ``open_question``.
        text: The claim.
        sources: The ledger records that back it — never empty for a finding.
        demoted: ``True`` when the model offered it as a finding and it could not point
            at a ledger record.
    """

    model_config = _SENT

    ref: str
    type: Literal["finding", "open_question"]
    text: str
    sources: list[str] = Field(default_factory=list)
    demoted: bool = False


class Delivery(BaseModel):
    """The body of ``brief`` — everything the investigation produced.

    Attributes:
        attempt: The attempt delivering it.
        duration_ms: Working time, all attempts.
        usage: Usage not yet sent with a checkpoint.
        body: The brief.
        claims: Its claims.
        deliverables: The playbook's other deliverable inputs, by deliverable.
    """

    model_config = _SENT

    attempt: int
    duration_ms: int
    usage: list[UsageEntry]
    body: BriefBody
    claims: list[Claim]
    deliverables: dict[str, dict[str, Any]]


class Finish(BaseModel):
    """The body of ``finish`` — a designed end that is not a brief.

    Attributes:
        attempt: The attempt ending it.
        outcome: ``failed`` or ``cancelled``.
        reason: Why, when ``failed``.
        detail: A sentence for a person, when ``failed``.
        duration_ms: Working time, all attempts.
        usage: Usage not yet sent with a checkpoint.
        seq: The final checkpoint's number.
        checkpoint: The state at the end — the partial that is kept.
    """

    model_config = _SENT

    attempt: int
    outcome: Literal["failed", "cancelled"]
    reason: FailureReason | None = None
    detail: str | None = None
    duration_ms: int
    usage: list[UsageEntry]
    seq: int
    checkpoint: dict[str, Any]


class InvestigationControl(Protocol):
    """What the loop asks of the control plane. Tests substitute a fake."""

    def start(
        self,
        investigation: str,
        *,
        loop_version: str,
        alias: str,
        resolution_ref: str | None,
        task: str,
    ) -> Started:
        """Claim or resume an investigation.

        Args:
            investigation: ``investigations.id``.
            loop_version: The researcher.
            alias: The alias synthesis runs on.
            resolution_ref: The resolution the alias came from.
            task: The engine task reference.

        Returns:
            The attempt, the checkpoint and the ledger so far.

        Raises:
            ControlRefusalError: ``investigation_not_runnable`` and the like.
            ControlUnavailableError: When there was no answer.
        """
        ...

    def tool(
        self,
        investigation: str,
        slug: str,
        operation: str,
        tool_input: dict[str, Any],
        *,
        operations_left: int,
    ) -> ToolAnswer:
        """Run one tool operation.

        Args:
            investigation: ``investigations.id``.
            slug: The tool.
            operation: ``search``, ``fetch`` or ``query``.
            tool_input: The operation's input.
            operations_left: The remaining operation budget, this one included.

        Returns:
            The payload and the archived sources.

        Raises:
            ControlRefusalError: A classified tool failure or a refusal.
            ControlUnavailableError: When there was no answer.
        """
        ...

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
        """Save the loop's state.

        Args:
            investigation: ``investigations.id``.
            attempt: The attempt writing it.
            seq: This checkpoint's number — one more than the last.
            state: The state.
            duration_ms: Working time, all attempts.
            usage: Model usage since the last checkpoint.

        Returns:
            Whether a cancel was requested.

        Raises:
            ControlRefusalError: ``investigation_checkpoint_stale`` when a newer attempt owns
                the run; ``investigation_not_running`` when it has ended.
            ControlUnavailableError: When there was no answer.
        """
        ...

    def deliver(self, investigation: str, delivery: Delivery) -> None:
        """Deliver the brief; the investigation becomes ``brief_ready``.

        Args:
            investigation: ``investigations.id``.
            delivery: The brief, claims and deliverable inputs.

        Raises:
            ControlRefusalError: When the control plane rejects the brief.
            ControlUnavailableError: When there was no answer.
        """
        ...

    def finish(self, investigation: str, finish: Finish) -> None:
        """End the investigation as ``failed`` or ``cancelled``.

        Args:
            investigation: ``investigations.id``.
            finish: The outcome and the partial to keep.

        Raises:
            ControlRefusalError: When the control plane rejects it.
            ControlUnavailableError: When there was no answer.
        """
        ...


class HttpInvestigationControl:
    """:class:`InvestigationControl` over ``urllib``.

    Attributes:
        base_url: Where ``ouroboros-rest`` is, with a trailing slash.
        timeout: Seconds one call may take.
    """

    def __init__(
        self,
        base_url: str,
        shared_secret: str,
        *,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
    ) -> None:
        """Point at a control plane.

        Args:
            base_url: ``OURO_REST_URL``.
            shared_secret: ``OURO_ENGINE_SHARED_SECRET`` — sent on every call.
            timeout: Seconds one call may take.
        """
        self.base_url = base_url if base_url.endswith("/") else f"{base_url}/"
        self.timeout = timeout
        self._secret = shared_secret
        # No proxy handler: the control plane is a service on the same network.
        self._opener = request.build_opener(request.ProxyHandler({}))

    def start(
        self,
        investigation: str,
        *,
        loop_version: str,
        alias: str,
        resolution_ref: str | None,
        task: str,
    ) -> Started:
        """See :meth:`InvestigationControl.start`."""
        body = {
            "loopVersion": loop_version,
            "alias": alias,
            "resolutionRef": resolution_ref,
            "task": task,
        }
        return Started.model_validate(
            self._send(
                "POST",
                RESEARCH_INVESTIGATION_START_PATH.format(id=quote(investigation)),
                body,
            )
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
        """See :meth:`InvestigationControl.tool`."""
        path = RESEARCH_TOOL_PATH.format(
            slug=quote(slug, safe=""), op=quote(operation, safe="")
        )
        body = {
            "investigation": investigation,
            "input": tool_input,
            "budget": {"operations": operations_left},
        }
        return ToolAnswer.model_validate(self._send("POST", path, body))

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
        """See :meth:`InvestigationControl.checkpoint`."""
        body = {
            "attempt": attempt,
            "seq": seq,
            "checkpoint": state,
            "durationMs": duration_ms,
            "usage": [entry.model_dump(by_alias=True) for entry in usage],
        }
        return CheckpointAck.model_validate(
            self._send(
                "PUT",
                RESEARCH_INVESTIGATION_CHECKPOINT_PATH.format(id=quote(investigation)),
                body,
            )
        )

    def deliver(self, investigation: str, delivery: Delivery) -> None:
        """See :meth:`InvestigationControl.deliver`."""
        self._send(
            "POST",
            RESEARCH_INVESTIGATION_BRIEF_PATH.format(id=quote(investigation)),
            delivery.model_dump(by_alias=True, exclude_none=True),
        )

    def finish(self, investigation: str, finish: Finish) -> None:
        """See :meth:`InvestigationControl.finish`."""
        self._send(
            "POST",
            RESEARCH_INVESTIGATION_FINISH_PATH.format(id=quote(investigation)),
            finish.model_dump(by_alias=True, exclude_none=True),
        )

    def _send(self, method: str, path: str, body: dict[str, Any]) -> dict[str, Any]:
        """Make one JSON call.

        Args:
            method: ``POST`` or ``PUT``.
            path: The path, parameters substituted.
            body: The JSON body.

        Returns:
            The parsed answer of a ``2xx``.

        Raises:
            ControlRefusalError: On an error envelope.
            ControlUnavailableError: On no answer, or one that is not JSON.
        """
        prepared = request.Request(  # noqa: S310 - the URL is the configured control plane's
            urljoin(self.base_url, path.lstrip("/")),
            data=json.dumps(body).encode("utf-8"),
            headers={
                INTERNAL_KEY_HEADER: self._secret,
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            method=method,
        )
        try:
            with self._opener.open(prepared, timeout=self.timeout) as answer:
                raw = answer.read()
        except error.HTTPError as refused:
            raise _refusal(refused) from refused
        except (error.URLError, TimeoutError, ConnectionError, OSError) as failure:
            raise ControlUnavailableError(
                f"the control plane did not answer {method} {path}"
            ) from failure

        try:
            parsed = json.loads(raw.decode("utf-8")) if raw.strip() else {}
        except ValueError as failure:
            raise ControlUnavailableError(
                f"the control plane answered {method} {path} with something that is not JSON"
            ) from failure
        if not isinstance(parsed, dict):
            raise ControlUnavailableError(
                f"the control plane answered {method} {path} outside its contract"
            )
        return parsed


def _refusal(refused: error.HTTPError) -> ControlRefusalError | ControlUnavailableError:
    """Name a non-2xx answer.

    Args:
        refused: What ``urllib`` raised.

    Returns:
        A :class:`ControlRefusalError` carrying the envelope's code, or
        :class:`ControlUnavailableError` for a ``5xx`` with no envelope (a proxy's page, a crash).
    """
    code = ""
    message = ""
    try:
        envelope = json.loads(refused.read().decode("utf-8"))
        if isinstance(envelope, dict):
            code = str(envelope.get("code", ""))
            message = str(envelope.get("message", ""))
    except (ValueError, OSError):
        pass

    if not code:
        if refused.code >= HTTPStatus.INTERNAL_SERVER_ERROR:
            return ControlUnavailableError(f"the control plane answered {refused.code}")
        code = f"http_{refused.code}"
    return ControlRefusalError(code, refused.code, message or f"HTTP {refused.code}")
