"""An in-memory ``ouroboros-rest`` for the simulated-run driver's tests.

It answers the eight internal operations the driver calls, with the same shapes and the same
refusals, and it enforces the rules that make the driver's behaviour worth testing:

* **idempotency**: a replayed key returns the first answer, and a key reused with a
  different body is ``409 idempotency_key_reused``;
* **the stage machine**: a stage opens in ``pending``, ``active`` or ``skipped``; only
  ``active`` ends; attempt *N* needs attempt *N-1* ended; ``returnedFrom`` is only for a
  retry;
* **transcript order**: hints strictly increase within a batch and across batches;
* **guardrails**: a ``.github/workflows/`` path fails ``ci_config`` and an ``AKIA`` key in an
  ``add`` line fails ``secrets``, which is enough of AP.3 to see the driver read a verdict
  rather than write one;
* **controls**: a test queues a control, optionally to be released when a given stage
  attempt starts, and the fake delivers it on the next fetch and records the ack. An
  acknowledged abort cancels the run.

The live stack is the real proof (see the pull request); this is what keeps the driver's
behaviour pinned down on every commit, without a database.
"""

import itertools
import json
import re
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any

from ouroboros_engine.control_plane.client import ControlPlaneRequest
from ouroboros_simulator.transport import Response

if TYPE_CHECKING:
    from ouroboros_simulator.session import RunSession
    from ouroboros_simulator.settings import SimulatorSettings

SIMULATOR_SECRET = "test-simulator-secret-7c1d"
ENGINE_SECRET = "test-internal-key-1f3c9a"
BASE_URL = "http://control-plane.test:4000"

_AWS_KEY = re.compile(r"\b(?:AKIA|ASIA)[A-Z2-7]{16}\b")


@dataclass
class QueuedControl:
    """A control waiting to be delivered.

    Attributes:
        kind: ``pause``, ``resume``, ``abort`` or ``steer``.
        payload: The steer's text.
        release_on: ``(stage_key, attempt)``: deliver only once that attempt is active.
        refused_as: Answer the ack with ``409 control_not_delivered`` and this state:
            ``expired`` for an ack that came too late, ``acked`` for one whose first
            answer was lost.
        retry_stage: A correction round (#332): a steer that also asks for the stage's
            next attempt.
    """

    kind: str
    payload: str | None = None
    release_on: tuple[str, int] | None = None
    refused_as: str | None = None
    retry_stage: bool = False
    id: str = field(default_factory=lambda: str(uuid.uuid4()))


class FakeClock:
    """A clock that never sleeps and remembers what it was asked to wait."""

    def __init__(self) -> None:
        """Start at a fixed instant."""
        self._now = datetime(2026, 9, 22, 14, 0, 0, tzinfo=UTC)
        self.speed = 1.0
        self.scripted_total = 0.0
        self.sleeps: list[float] = []
        self.on_sleep: list[Any] = []

    def now(self) -> datetime:
        """The current fake instant."""
        return self._now

    def iso_now(self) -> str:
        """The current fake instant, as the contract writes it."""
        self._now += timedelta(milliseconds=1)
        return self._now.isoformat(timespec="milliseconds").replace("+00:00", "Z")

    def scripted(self, seconds: float) -> None:
        """Record a scripted wait and advance time by it."""
        self.scripted_total += seconds
        self._now += timedelta(seconds=seconds)

    def sleep(self, seconds: float) -> None:
        """Record a real wait, and run whatever a test hooked onto it."""
        self.sleeps.append(seconds)
        self._now += timedelta(seconds=seconds)
        for hook in list(self.on_sleep):
            hook()


@dataclass
class _Stage:
    status: str
    returned_from: dict[str, str] | None = None
    note: str | None = None


class FakeControlPlane:
    """The fake. Implements the driver's ``Transport``.

    Attributes:
        requests: Every request received, in order.
        events: Every transcript entry stored, in order, as sent.
        stages: ``(stage_key, attempt) → status``.
        stage_log: Every accepted transition as ``(stage_key, attempt, status)``.
        files: The last change-set reported.
        commits: Every commit reported.
        spends: Every spend reported.
        acks: Every ack body received, with its control's kind.
        status: The run's status. An acked abort makes it ``canceled``.
        simulated: What an open answers with. A test sets ``False`` to play a control
            plane that took the secret for the executor's.
        fail_on: ``(method, path fragment) → (status, code)``: refuse a matching request.
        flag_violations: Whether change-sets are judged at all. ``False`` plays a control
            plane whose guardrails pass everything.
    """

    def __init__(self, *, simulated: bool = True) -> None:
        """Make an empty control plane.

        Args:
            simulated: The ``simulated`` flag an open answers with.
        """
        self.simulated = simulated
        self.requests: list[ControlPlaneRequest] = []
        self.run_id: str | None = None
        self.events: list[dict[str, Any]] = []
        self.stages: dict[tuple[str, int], _Stage] = {}
        self.stage_log: list[tuple[str, int, str]] = []
        self.files: list[dict[str, Any]] = []
        self.commits: list[dict[str, Any]] = []
        self.spends: list[dict[str, Any]] = []
        self.acks: list[tuple[str, dict[str, Any]]] = []
        self.status = "coding"
        self.fail_on: dict[tuple[str, str], tuple[int, str]] = {}
        self.flag_violations = True
        self._hint = 0
        self._change_set_seq = 0
        self._receipts: dict[str, tuple[str, Response]] = {}
        self._queue: list[QueuedControl] = []
        self._delivered: dict[str, QueuedControl] = {}

    # --- test controls -----------------------------------------------------------------------

    def queue(self, control: QueuedControl) -> QueuedControl:
        """Queue a control for the next fetch (or for when ``release_on`` starts).

        Args:
            control: The control.

        Returns:
            The same control, for its id.
        """
        self._queue.append(control)
        return control

    def active(self, stage_key: str, attempt: int) -> bool:
        """Has that attempt started?"""
        stage = self.stages.get((stage_key, attempt))
        return stage is not None and stage.status != "pending"

    # --- transport ---------------------------------------------------------------------------

    def send(self, outgoing: ControlPlaneRequest) -> Response:
        """Answer one request, as ``ouroboros-rest`` would."""
        self.requests.append(outgoing)
        # A body round-tripped through JSON, as it would be on the wire.
        body = json.loads(json.dumps(outgoing.json))
        path = outgoing.url.removeprefix(BASE_URL)

        if outgoing.headers.get("X-Ouro-Internal-Key") not in (
            SIMULATOR_SECRET,
            ENGINE_SECRET,
        ):
            return _error(401, "unauthenticated")

        for (method, fragment), (status, code) in self.fail_on.items():
            if outgoing.method == method and fragment in path:
                return _error(status, code)

        key = body.get("idempotencyKey")
        if key is not None:
            digest = json.dumps(body, sort_keys=True)
            if key in self._receipts:
                seen, answer = self._receipts[key]
                return (
                    answer if seen == digest else _error(409, "idempotency_key_reused")
                )
            answer = self._route(outgoing.method, path, body)
            if answer.status < 400:
                self._receipts[key] = (digest, answer)
            return answer

        return self._route(outgoing.method, path, body)

    def _route(self, method: str, path: str, body: dict[str, Any]) -> Response:
        if method == "POST" and path == "/internal/runs":
            return self._open(body)

        match = re.fullmatch(r"/internal/runs/([^/]+)/(.+)", path)
        if match is None or match.group(1) != self.run_id:
            return _error(404, "run_not_found")
        rest = match.group(2)

        routes = {
            ("POST", "stage-transitions"): self._transition,
            ("POST", "events"): self._events,
            ("PUT", "files"): self._files,
            ("POST", "commits"): self._commits,
            ("POST", "resources"): self._resources,
            ("POST", "controls/fetch"): self._fetch,
        }
        handler = routes.get((method, rest))
        if handler is not None:
            return handler(body)

        ack = re.fullmatch(r"controls/([^/]+)/ack", rest)
        if method == "POST" and ack is not None:
            return self._ack(ack.group(1), body)
        return _error(404, "not_found")

    # --- operations --------------------------------------------------------------------------

    def _open(self, body: dict[str, Any]) -> Response:
        forbidden = {"simulated", "organizationId"} & set(body)
        if forbidden:
            return _error(422, "validation_failed")
        self.run_id = str(uuid.uuid4())
        self.opened_with = body
        return Response(
            201,
            {
                "id": self.run_id,
                "loopSeq": 1848,
                "organizationId": "org-acme",
                "issueNumber": 482,
                "issueTitle": "Fix flaky CAN-bus telemetry test",
                "workflowTag": body["workflow"]["tag"],
                "workflowVersionPin": body["workflow"]["version"],
                "branchName": body.get("branchName"),
                "mergeStrategy": body.get("mergeStrategy"),
                "model": body["model"],
                "simulated": self.simulated,
                "status": "coding",
                "startedAt": "2026-09-22T14:00:00.000Z",
            },
        )

    def _transition(self, body: dict[str, Any]) -> Response:
        if "note" in body:
            return _error(422, "validation_failed")
        key, status = body["stageKey"], body["status"]
        attempt = body.get("attempt", 1)
        current = self.stages.get((key, attempt))
        returned = body.get("returnedFrom")

        if returned is not None and attempt == 1:
            return _error(409, "stage_return_not_a_retry")
        if current is None:
            if status not in ("pending", "active", "skipped"):
                return _invalid(key, attempt, None, status)
            if attempt > 1:
                previous = self.stages.get((key, attempt - 1))
                if previous is None or previous.status not in ("succeeded", "failed"):
                    return _invalid(key, attempt, None, status)
            note = None
            if returned is not None:
                note = (
                    f"attempt {attempt - 1} {returned['reason'].replace('_', ' ')} — "
                    f"loop returned from {returned['kind']} ↺"
                )
            current = self.stages[(key, attempt)] = _Stage(status, returned, note)
        else:
            allowed = {
                "pending": ("active", "skipped"),
                "active": ("succeeded", "failed"),
            }
            if status not in allowed.get(current.status, ()):
                return _invalid(key, attempt, current.status, status)
            current.status = status

        self.stage_log.append((key, attempt, status))
        return Response(
            200,
            {
                "runStageId": str(uuid.uuid4()),
                "stageKey": key,
                "stageLabel": key.title(),
                "position": 1,
                "attempt": attempt,
                "maxAttempts": 3,
                "tokenBudget": 400000,
                "status": status,
                "note": current.note,
                "startedAt": None,
                "finishedAt": None,
                "returnedFrom": current.returned_from,
            },
        )

    def _events(self, body: dict[str, Any]) -> Response:
        hints = [event["hint"] for event in body["events"]]
        if hints[0] <= self._hint or any(b <= a for a, b in itertools.pairwise(hints)):
            return _error(409, "events_out_of_order")
        for event in body["events"]:
            if event["actor"] == "model" and not (
                event.get("modelId") and event.get("stageKey") and event.get("attempt")
            ):
                return _error(422, "validation_failed")
            if "seq" in event or "simulated" in event:
                return _error(422, "validation_failed")
        first = len(self.events) + 1
        self.events.extend(body["events"])
        self._hint = hints[-1]
        return Response(
            200,
            {
                "submitted": len(hints),
                "stored": len(hints),
                "firstSeq": first,
                "lastSeq": len(self.events),
                "hint": self._hint,
                "elided": False,
            },
        )

    def _files(self, body: dict[str, Any]) -> Response:
        self.files = body["files"]
        failures: list[str] = []
        if not self.files:
            return Response(200, _change_set(self._change_set_seq, [], 0, failures))
        self._change_set_seq += 1
        if not self.flag_violations:
            return Response(200, _change_set(self._change_set_seq, self.files, 4, []))
        if any(f["path"].startswith(".github/workflows/") for f in self.files):
            failures.append("ci_config")
        added = [
            line["text"]
            for f in self.files
            for hunk in f.get("hunks", [])
            for line in hunk["lines"]
            if line["kind"] == "add"
        ]
        if any(_AWS_KEY.search(text) for text in added):
            failures.append("secrets")
        return Response(200, _change_set(self._change_set_seq, self.files, 4, failures))

    def _commits(self, body: dict[str, Any]) -> Response:
        self.commits.extend(body["commits"])
        return Response(
            200,
            {
                "submitted": len(body["commits"]),
                "appended": len(body["commits"]),
                "duplicates": 0,
                "lastSeq": len(self.commits),
            },
        )

    def _resources(self, body: dict[str, Any]) -> Response:
        if "spend" in body:
            self.spends.append(body["spend"])
        return Response(
            200,
            {
                "tokensIn": sum(s["tokensIn"] for s in self.spends),
                "tokensOut": sum(s["tokensOut"] for s in self.spends),
                "costCents": "1.0000",
                "unpricedEvents": 0,
                "reservedBuildJobId": None,
            },
        )

    def _fetch(self, _body: dict[str, Any]) -> Response:
        ready = [
            c for c in self._queue if c.release_on is None or self.active(*c.release_on)
        ]
        for control in ready:
            self._queue.remove(control)
            self._delivered[control.id] = control
        return Response(
            200,
            {
                "controls": [
                    {
                        "id": c.id,
                        "kind": c.kind,
                        "payload": c.payload,
                        "remember": False,
                        "retryStage": c.retry_stage,
                        "requestedAt": "2026-09-22T14:04:40.000Z",
                        "expiresAt": "2026-09-22T14:09:40.000Z",
                    }
                    for c in ready
                ]
            },
        )

    def _ack(self, control_id: str, body: dict[str, Any]) -> Response:
        control = self._delivered.get(control_id)
        if control is None:
            return _error(404, "control_not_found")
        if control.refused_as is not None:
            return _error(409, "control_not_delivered", {"state": control.refused_as})
        self.acks.append((control.kind, body))
        if control.kind == "abort":
            self.status = "canceled"
        detail = body.get("effect") or (
            f"steering applied to attempt {body['attempt']}"
            if "attempt" in body
            else f"{control.kind} applied"
        )
        return Response(
            200,
            {
                "id": control.id,
                "runId": self.run_id,
                "kind": control.kind,
                "state": "acked",
                "requestedBy": "user",
                "requestedAt": "2026-09-22T14:04:40.000Z",
                "deliveredAt": "2026-09-22T14:04:43.000Z",
                "ackedAt": "2026-09-22T14:04:51.000Z",
                "expiresAt": "2026-09-22T14:09:40.000Z",
                "detail": detail,
                "hasPayload": control.payload is not None,
                "remember": False,
                "retryStage": control.retry_stage,
            },
        )


def _change_set(
    seq: int, files: list[dict[str, Any]], checks: int, failures: list[str]
) -> dict[str, Any]:
    return {
        "changeSetSeq": seq,
        "files": len(files),
        "additions": sum(f.get("additions", 0) for f in files),
        "deletions": sum(f.get("deletions", 0) for f in files),
        "guardrailChecks": checks,
        "guardrailFailures": failures,
        "needsHuman": bool(failures),
    }


def _invalid(key: str, attempt: int, current: str | None, wanted: str) -> Response:
    return _error(
        409,
        "stage_transition_invalid",
        {"stageKey": key, "attempt": attempt, "from": current, "to": wanted},
    )


def _error(status: int, code: str, details: dict[str, Any] | None = None) -> Response:
    return Response(status, {"code": code, "message": code, "details": details or {}})


def make_session(
    fake: FakeControlPlane, clock: FakeClock, **options: Any
) -> "RunSession":
    """A session wired to the fake, with the simulator's secret.

    Args:
        fake: The control plane.
        clock: The clock.
        **options: Passed to :class:`RunSession` (``max_pause``, ``poll_interval``).

    Returns:
        The session, not yet open.
    """
    from ouroboros_engine.control_plane.client import ControlPlaneClient
    from ouroboros_simulator.session import RunSession

    options.setdefault("poll_interval", 1.0)
    return RunSession(
        ControlPlaneClient(BASE_URL, SIMULATOR_SECRET),
        fake,
        clock,  # duck-typed: the session reads now, iso_now, scripted and sleep
        key_prefix="sim-test",
        **options,
    )


def simulator_settings() -> "SimulatorSettings":
    """Settings pointing the driver at the fake.

    Returns:
        The settings.
    """
    from ouroboros_simulator.settings import SimulatorSettings

    return SimulatorSettings(
        OURO_REST_URL=BASE_URL,
        OURO_RUN_SIMULATOR_SECRET=SIMULATOR_SECRET,
        OURO_ENGINE_SHARED_SECRET=ENGINE_SECRET,
    )
