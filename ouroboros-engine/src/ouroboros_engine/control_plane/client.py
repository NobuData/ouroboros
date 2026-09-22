"""The client stub for ``ouroboros-rest``'s internal surface — request in, answer out.

AD.3's (`#224 <https://github.com/NobuData/ouroboros/issues/224>`_) last piece of scope:
*engine client stubs for both surfaces, so the FastAPI side compiles against the contract
before the executor exists.* This is that stub, and what it deliberately is **not** is a
transport.

**Why it sends nothing.** There is no executor yet — AF.2
(`#235 <https://github.com/NobuData/ouroboros/issues/235>`_) is what walks a chain, and the
worker that would take a lease is INTAKE-O.2
(`#123 <https://github.com/NobuData/ouroboros/issues/123>`_) or WF-T.6
(`#160 <https://github.com/NobuData/ouroboros/issues/160>`_). Adding an HTTP library to
this service's *runtime* dependencies for a caller that does not exist would be shipping a
dependency on speculation, and choosing sync or async on its behalf would be making the
executor's first architectural decision from the outside. So this builds a
:class:`ControlPlaneRequest` and reads what came back, and whoever writes the executor
brings the thing that puts one on a socket.

What that leaves is the whole of what a contract-first stub is for, and all of it is
testable with no network anywhere::

    client = ControlPlaneClient(base_url, shared_secret)

    request = client.lease_request("ollama", run)  # url, headers, body — ready to send
    lease = client.read_lease(status, body)  # parsed, or a named refusal

    request = client.invoke_request(alias=..., payload=..., run_ctx=...)
    for event in client.read_events(lines):  # delta · usage · hop · done
        ...

**The first sender is development tooling.** The simulated-run driver (AP.5,
`#307 <https://github.com/NobuData/ouroboros/issues/307>`_) puts these requests on a socket
with the standard library, from a package the production wheel does not contain. It builds
every request here, so the driver and the future executor share one client and differ only
in their transport.

**The key travels on every request.** :attr:`ControlPlaneRequest.headers` carries
``X-Ouro-Internal-Key``, and there is no way to build a request without it — the same
posture ``ouroboros-rest``'s engine client keeps in the other direction, and the reason a
misconfigured stack fails at the boundary rather than halfway through a run.

**A refusal is an exception, not a return value.** :class:`ControlPlaneError` carries the
control plane's own ``code``, so an executor branches on ``provider_not_leasable`` versus
``local_provider_not_configured`` — a decision and an absence, which want different
handling — rather than on a status code that conflates them.
"""

import json
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from http import HTTPStatus
from typing import Any
from urllib.parse import urljoin

from pydantic import BaseModel

from ouroboros_engine.control_plane.contract import (
    EVENT_MODELS,
    INTERNAL_KEY_HEADER,
    INVOKE_MEDIA_TYPE,
    INVOKE_PATH,
    LEASE_PATH,
    RUN_CONTROL_ACK_PATH,
    RUN_CONTROLS_FETCH_PATH,
    AckedControl,
    ControlAck,
    ControlsFetched,
    ErrorEnvelope,
    InvokeEvent,
    InvokeRequest,
    Lease,
    LeaseRequest,
    RunContext,
)
from ouroboros_engine.control_plane.ingest import (
    RUN_COMMITS_PATH,
    RUN_EVENTS_PATH,
    RUN_FILES_PATH,
    RUN_RESOURCES_PATH,
    RUN_STAGE_TRANSITIONS_PATH,
    RUNS_PATH,
    ChangeSet,
    CommitsAppended,
    EventsAppended,
    IngestEventsRequest,
    OpenRunRequest,
    ReportCommitsRequest,
    ReportFilesRequest,
    ReportResourcesRequest,
    ResourcesReported,
    RunOpened,
    StageTransition,
    StageTransitionRequest,
)

#: What a request that carries a JSON body says it is.
JSON_MEDIA_TYPE = "application/json"


class ControlPlaneError(RuntimeError):
    """The control plane refused, or answered something this client cannot read.

    Attributes:
        code: The control plane's own stable code — ``provider_not_leasable``,
            ``local_provider_not_configured``, ``run_not_found``, ``unauthenticated``,
            ``invocation_not_implemented``. What an executor branches on: a *decision* and
            an *absence* look the same in a status code and want opposite handling.
        status: The HTTP status it arrived with.
        details: Whatever the envelope carried — the provider that was refused, the run
            that was not found.
    """

    def __init__(
        self,
        code: str,
        message: str,
        status: int,
        details: dict[str, Any] | None = None,
    ) -> None:
        """Record a refusal.

        Args:
            code: The stable code from the error envelope.
            message: The sentence the control plane wrote for a person.
            status: The HTTP status.
            details: The envelope's details, if any.
        """
        super().__init__(message)
        self.code = code
        self.status = status
        self.details = details or {}


@dataclass(frozen=True)
class ControlPlaneRequest:
    """One request, ready for whatever AF.2 chooses to send it with.

    A description rather than a call, which is the point of this module: it is complete —
    method, absolute URL, headers including the shared secret, and the JSON body — and it
    depends on nothing that opens a socket.

    Attributes:
        method: ``POST``, or ``PUT`` for the change-set report, whose verb is its
            semantics. Carried rather than assumed so a reader of a log line does not have
            to know which.
        url: The absolute URL, resolved against the control plane's base.
        headers: What to send, including :data:`~ouroboros_engine.control_plane.contract.INTERNAL_KEY_HEADER`.
        json: The body, already in the control plane's ``camelCase``.
        accept: What the answer is expected to be framed as — JSON for a lease, NDJSON for
            an invocation, which is what tells a transport whether to stream.
    """

    method: str
    url: str
    headers: dict[str, str]
    json: dict[str, Any]
    accept: str = JSON_MEDIA_TYPE


class ControlPlaneClient:
    """Builds requests for ``ouroboros-rest``'s internal surface, and reads its answers.

    Attributes:
        base_url: Where the control plane is, from the executor's point of view — a
            container's address (``http://rest:4000``) rather than a browser's.
    """

    def __init__(self, base_url: str, shared_secret: str) -> None:
        """Point a client at a control plane.

        Args:
            base_url: The control plane's base URL. A trailing slash is added if it is
                missing, so that a base carrying a path — a deployment behind a reverse
                proxy — keeps it: ``urljoin("http://host/api", "/internal/...")`` would
                drop the ``/api``.
            shared_secret: The value of ``OURO_ENGINE_SHARED_SECRET``. The same variable
                this service already reads for the *inbound* direction
                (:mod:`ouroboros_engine.core.security`); both sides of the boundary hold
                one value, and a stack where they disagree fails in both directions at
                once. The simulated-run driver passes ``OURO_RUN_SIMULATOR_SECRET`` instead,
                which is how the control plane knows to mark its runs simulated (#303).
        """
        self.base_url = base_url if base_url.endswith("/") else f"{base_url}/"
        self._secret = shared_secret

    def _headers(self, accept: str) -> dict[str, str]:
        """The headers every request carries.

        Args:
            accept: What the answer is expected to be framed as.

        Returns:
            The key, the content type and the accept type. The key is not optional and has
            no way of being left out: a request that could be built without it is a request
            that would be sent without it.
        """
        return {
            INTERNAL_KEY_HEADER: self._secret,
            "Content-Type": JSON_MEDIA_TYPE,
            "Accept": accept,
        }

    def _url(self, path: str) -> str:
        """Resolve a path against the control plane's base.

        Args:
            path: One of the contract's paths, with its leading slash.

        Returns:
            The absolute URL.
        """
        return urljoin(self.base_url, path.lstrip("/"))

    def lease_request(self, provider: str, run: str) -> ControlPlaneRequest:
        """Build the request that asks where a local provider is.

        Args:
            provider: The provider kind. A cloud kind is deliberately **not** refused here:
                the control plane answers ``403 provider_not_leasable`` by policy, and a
                client that pre-empted it would be a second implementation of the policy —
                one that a stale copy of this file could disagree with.
            run: The run this work belongs to. The control plane resolves the workspace
                from it, which is what makes the grant attributable.

        Returns:
            The request to send.
        """
        body = LeaseRequest(provider=provider, run=run)

        return ControlPlaneRequest(
            method="POST",
            url=self._url(LEASE_PATH),
            headers=self._headers(JSON_MEDIA_TYPE),
            json=body.model_dump(by_alias=True),
        )

    def read_lease(self, status: int, body: dict[str, Any]) -> Lease:
        """Read the answer to a lease request.

        Args:
            status: The HTTP status the control plane answered with.
            body: The parsed JSON body.

        Returns:
            The granted lease — an address, a scope and two times. Never a credential;
            there is no field for one.

        Raises:
            ControlPlaneError: On any status but ``200``, carrying the control plane's own
                code so that a *decision* (``provider_not_leasable``) and an *absence*
                (``local_provider_not_configured``) can be told apart by an executor
                deciding whether to retry.
        """
        if status != HTTPStatus.OK:
            raise _refusal(status, body)

        return Lease.model_validate(body)

    def invoke_request(
        self,
        run_ctx: RunContext,
        payload: dict[str, Any],
        *,
        connection: str | None = None,
        alias: str | None = None,
    ) -> ControlPlaneRequest:
        """Build the request that asks the control plane to make a model call.

        Args:
            run_ctx: Which run this belongs to, and the policy that applies to it.
            payload: The model call, in the adapter's own vocabulary. Opaque.
            connection: A concrete provider connection, or ``None``.
            alias: A routing alias, or ``None``.

        Returns:
            The request to send. Its ``Accept`` is NDJSON, which is what tells a transport
            that the answer is a stream rather than a body.

        Raises:
            ValueError: If neither or both of ``connection`` and ``alias`` are given.
                Refused here rather than sent, because the control plane's own answer to
                *which did you mean* would be a ``422`` at the end of a round trip — and
                because a request naming both is a caller with two ideas about which
                provider to use.
        """
        if (connection is None) == (alias is None):
            raise ValueError(
                "an invocation names exactly one of connection or alias: a connection is "
                "this provider, an alias is whatever routing resolves it to"
            )

        body = InvokeRequest(
            connection=connection, alias=alias, payload=payload, run_ctx=run_ctx
        )

        return ControlPlaneRequest(
            method="POST",
            url=self._url(INVOKE_PATH),
            headers=self._headers(INVOKE_MEDIA_TYPE),
            json=body.model_dump(by_alias=True, exclude_none=True),
            accept=INVOKE_MEDIA_TYPE,
        )

    def fetch_controls_request(self, run: str) -> ControlPlaneRequest:
        """Build the request that claims a run's pending controls (AP.4, #306).

        Args:
            run: The run — ``runs.id``.

        Returns:
            The request to send. Its body is empty: claiming is the whole of the request.
        """
        return ControlPlaneRequest(
            method="POST",
            url=self._url(RUN_CONTROLS_FETCH_PATH.format(id=run)),
            headers=self._headers(JSON_MEDIA_TYPE),
            json={},
        )

    def read_controls(self, status: int, body: dict[str, Any]) -> ControlsFetched:
        """Read the answer to a fetch.

        Args:
            status: The HTTP status the control plane answered with.
            body: The parsed JSON body.

        Returns:
            The claimed controls, oldest first — now ``delivered``, and this executor's to
            acknowledge.

        Raises:
            ControlPlaneError: On any status but ``200``.
        """
        if status != HTTPStatus.OK:
            raise _refusal(status, body)

        return ControlsFetched.model_validate(body)

    def ack_control_request(
        self,
        run: str,
        control: str,
        *,
        effect: str | None = None,
        attempt: int | None = None,
    ) -> ControlPlaneRequest:
        """Build the request that acknowledges one control.

        Args:
            run: The run.
            control: The control, as the fetch handed it over.
            effect: What was done, in this executor's words. Optional.
            attempt: For a steer, the attempt it was applied to. Optional.

        Returns:
            The request to send.
        """
        body = ControlAck(effect=effect, attempt=attempt)

        return ControlPlaneRequest(
            method="POST",
            url=self._url(RUN_CONTROL_ACK_PATH.format(id=run, control_id=control)),
            headers=self._headers(JSON_MEDIA_TYPE),
            json=body.model_dump(by_alias=True, exclude_none=True),
        )

    def read_ack(self, status: int, body: dict[str, Any]) -> AckedControl:
        """Read the answer to an acknowledgment.

        Args:
            status: The HTTP status the control plane answered with.
            body: The parsed JSON body.

        Returns:
            The control, acknowledged.

        Raises:
            ControlPlaneError: On any status but ``200``. ``control_not_delivered`` carries
                the control's state in :attr:`ControlPlaneError.details`.
        """
        if status != HTTPStatus.OK:
            raise _refusal(status, body)

        return AckedControl.model_validate(body)

    def read_events(self, lines: Iterable[str]) -> Iterator[InvokeEvent]:
        """Read a streamed answer, one line at a time.

        A generator rather than a list, because that is the shape the surface exists for:
        an executor renders deltas as they arrive, and buffering the stream to parse it
        would give away the streaming this contract is written around.

        Args:
            lines: The response body's lines. Blank ones are skipped — a stream that ends
                with a newline is not a stream with an empty event on the end.

        Yields:
            Each parsed event, in order.

        Raises:
            ControlPlaneError: On a line that is not one of the five kinds. A control plane
                emitting a sixth is a version mismatch, and saying so by name is more use
                than a validation trace about a union.
        """
        for line in lines:
            if not line.strip():
                continue

            parsed: dict[str, Any] = json.loads(line)
            kind = parsed.get("kind")
            model = EVENT_MODELS.get(str(kind))

            if model is None:
                raise ControlPlaneError(
                    "unknown_event_kind",
                    f"the control plane streamed an event this build does not know: {kind!r}",
                    status=HTTPStatus.OK,
                )

            yield model.model_validate(parsed)

    # --- run ingestion (AP.1, #303) ---------------------------------------------------------
    #
    # One builder and one reader per operation. The builders share `_write` and the readers
    # share `_read`, so every write carries the key and its idempotency key in one way.

    def open_run_request(self, body: OpenRunRequest) -> ControlPlaneRequest:
        """Build the request that opens a run.

        Args:
            body: The run to open. Its ``idempotency_key`` names this submission.

        Returns:
            The request to send.
        """
        return self._write("POST", RUNS_PATH, body)

    def read_run_opened(self, status: int, body: dict[str, Any]) -> RunOpened:
        """Read the answer to an open.

        Args:
            status: The HTTP status the control plane answered with.
            body: The parsed JSON body.

        Returns:
            The run, with the ``loop_seq`` the database allocated and the ``simulated``
            watermark that follows the caller's secret.

        Raises:
            ControlPlaneError: On any status but ``201``.
        """
        return _read(status, body, RunOpened, expected=HTTPStatus.CREATED)

    def transition_stage_request(
        self, run: str, body: StageTransitionRequest
    ) -> ControlPlaneRequest:
        """Build the request that moves one stage attempt.

        Args:
            run: The run.
            body: The transition.

        Returns:
            The request to send.
        """
        return self._write("POST", RUN_STAGE_TRANSITIONS_PATH.format(id=run), body)

    def read_stage_transition(
        self, status: int, body: dict[str, Any]
    ) -> StageTransition:
        """Read the answer to a transition.

        Args:
            status: The HTTP status.
            body: The parsed JSON body.

        Returns:
            Where the stage stands, with the note the database composed.

        Raises:
            ControlPlaneError: On any status but ``200``. ``stage_transition_invalid``
                carries the stage, the attempt and both statuses in ``details``.
        """
        return _read(status, body, StageTransition)

    def append_events_request(
        self, run: str, body: IngestEventsRequest
    ) -> ControlPlaneRequest:
        """Build the request that appends a batch to the transcript.

        Args:
            run: The run.
            body: The batch.

        Returns:
            The request to send.
        """
        return self._write("POST", RUN_EVENTS_PATH.format(id=run), body)

    def read_events_appended(self, status: int, body: dict[str, Any]) -> EventsAppended:
        """Read the answer to an append.

        Args:
            status: The HTTP status.
            body: The parsed JSON body.

        Returns:
            What was stored, and the sequence numbers the store allocated.

        Raises:
            ControlPlaneError: On any status but ``200``. ``events_out_of_order``
                carries ``accepted`` and ``offered`` in ``details``.
        """
        return _read(status, body, EventsAppended)

    def report_files_request(
        self, run: str, body: ReportFilesRequest
    ) -> ControlPlaneRequest:
        """Build the request that reports the whole change-set.

        Args:
            run: The run.
            body: The change-set.

        Returns:
            The request to send. A ``PUT``, because the report replaces the stored set.
        """
        return self._write("PUT", RUN_FILES_PATH.format(id=run), body)

    def read_change_set(self, status: int, body: dict[str, Any]) -> ChangeSet:
        """Read the answer to a change-set report.

        Args:
            status: The HTTP status.
            body: The parsed JSON body.

        Returns:
            The totals and the guardrail verdicts the control plane computed.

        Raises:
            ControlPlaneError: On any status but ``200``.
        """
        return _read(status, body, ChangeSet)

    def report_commits_request(
        self, run: str, body: ReportCommitsRequest
    ) -> ControlPlaneRequest:
        """Build the request that appends commits.

        Args:
            run: The run.
            body: The commits, oldest first.

        Returns:
            The request to send.
        """
        return self._write("POST", RUN_COMMITS_PATH.format(id=run), body)

    def read_commits_appended(
        self, status: int, body: dict[str, Any]
    ) -> CommitsAppended:
        """Read the answer to a commit report.

        Args:
            status: The HTTP status.
            body: The parsed JSON body.

        Returns:
            How many commits were new and how many were already known.

        Raises:
            ControlPlaneError: On any status but ``200``.
        """
        return _read(status, body, CommitsAppended)

    def report_resources_request(
        self, run: str, body: ReportResourcesRequest
    ) -> ControlPlaneRequest:
        """Build the request that attributes spend or moves a reservation.

        Args:
            run: The run.
            body: The report. ``reserved_build_job`` is sent as ``null`` only when it was
                set to ``None``, which releases the job held; left unset, it is absent and
                says nothing. Every other ``None`` is left out, so an unpriced spend has no
                ``costCents`` rather than a ``null`` one.

        Returns:
            The request to send.
        """
        request = self._write("POST", RUN_RESOURCES_PATH.format(id=run), body)
        if "reserved_build_job" in body.model_fields_set:
            request.json["reservedBuildJob"] = body.reserved_build_job
        return request

    def read_resources_reported(
        self, status: int, body: dict[str, Any]
    ) -> ResourcesReported:
        """Read the answer to a resources report.

        Args:
            status: The HTTP status.
            body: The parsed JSON body.

        Returns:
            The run's totals and the job it holds.

        Raises:
            ControlPlaneError: On any status but ``200``.
        """
        return _read(status, body, ResourcesReported)

    def _write(self, method: str, path: str, body: BaseModel) -> ControlPlaneRequest:
        """Build one ingestion request.

        Args:
            method: ``POST`` or ``PUT``.
            path: The contract path, with the run already substituted.
            body: The request model. ``None`` fields are left out.

        Returns:
            The request to send.
        """
        return ControlPlaneRequest(
            method=method,
            url=self._url(path),
            headers=self._headers(JSON_MEDIA_TYPE),
            json=body.model_dump(by_alias=True, exclude_none=True),
        )


def _read[T: BaseModel](
    status: int,
    body: dict[str, Any],
    model: type[T],
    *,
    expected: int = HTTPStatus.OK,
) -> T:
    """Read one answer: the model on the expected status, a refusal on any other.

    Args:
        status: The HTTP status.
        body: The parsed JSON body.
        model: What a success parses as.
        expected: The one status that means success.

    Returns:
        The parsed answer.

    Raises:
        ControlPlaneError: On any other status, carrying the envelope's code.
    """
    if status != expected:
        raise _refusal(status, body)

    return model.model_validate(body)


def _refusal(status: int, body: dict[str, Any]) -> ControlPlaneError:
    """Turn an error envelope into the exception an executor catches.

    Args:
        status: The HTTP status.
        body: The parsed body, which should be an error envelope.

    Returns:
        The error to raise. A body that is *not* an envelope — a proxy's HTML page, a
        gateway's own JSON — still produces one, named for the status, because a worker
        that got something unexpected needs an exception rather than a parse failure three
        frames away from the request that caused it.
    """
    try:
        envelope = ErrorEnvelope.model_validate(body)
    except ValueError:
        return ControlPlaneError(
            "unreadable_answer",
            f"the control plane answered {status} outside the error envelope",
            status=status,
        )

    return ControlPlaneError(
        envelope.code, envelope.message, status=status, details=envelope.details
    )
