"""The draft pull request at the ``open_pr_automerge`` terminal (DI.3, #1311).

After the branch publisher pushed the run branch (DI.2), the interpreter asks
``ouroboros-rest`` to open the branch's draft pull request through
``POST /internal/runs/{id}/pull-request``, then finishes ``review`` naming it. The fake control
plane opens one pull request per run and answers it again afterwards, counting how many it
created, so a resumed terminal is shown to open no second one.

The workflows here have no infra stage: the engine fails every infra stage
``infra_unavailable`` until #265, so only such a workflow reaches the terminal.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import pytest

from code_fixtures import SeededRepo, build_repo
from execution_fakes import (
    RUN,
    Executors,
    FakeControl,
    chain,
    llm,
    never,
    refusal,
    term,
    trigger,
)
from ouroboros_engine.code.clones import CloneStore
from ouroboros_engine.control_plane.client import ControlPlaneClient, ControlPlaneError
from ouroboros_engine.control_plane.execution import (
    EXECUTION_PATHS,
    LOST_RUN_CODES,
    PULL_REQUEST_REFUSALS,
    RUN_PULL_REQUEST_PATH,
    PullRequestOpened,
    PullRequestRequest,
)
from ouroboros_engine.control_plane.ingest_client import IdempotencyKeys, IngestClient
from ouroboros_engine.control_plane.transport import Response, TransportError
from ouroboros_engine.execution.interpreter import Interpreter, _refusal_text
from ouroboros_engine.execution.registry import ExecutorRegistry
from ouroboros_engine.execution.workspace import RunWorkspaces
from test_execution_publisher import (
    TARGET,
    CountingTransport,
    host_refs,
    interpreter,
    writes,
)

#: A workflow that reaches the pull-request terminal: no infra stage on the way.
DOC = chain(trigger(), llm("write-docs"), term("done", "open_pr_automerge"))

#: The fake control plane's pull request.
PR_URL = "https://github.com/acme/helios-firmware/pull/42"

#: The host's sentence on a refused draft, as REST carries it in ``details``.
HOST_MESSAGE = "Draft pull requests are not supported in this repository."


@pytest.fixture
def seeded(tmp_path: Path) -> SeededRepo:
    """The fixture repository — the run's remote, and the host it pushes to."""
    return build_repo(tmp_path / "remote" / "helios-firmware.git")


@pytest.fixture
def workspaces(tmp_path: Path) -> RunWorkspaces:
    """Run trees over a local clone store."""
    return RunWorkspaces(
        tmp_path / "runs",
        CloneStore(tmp_path / "clones", allow_local=True),
        max_bytes=64 * 1024 * 1024,
        idle_seconds=3600.0,
        disk_free=lambda _path: 1024 * 1024 * 1024,
    )


def _engine(
    seeded: SeededRepo, workspaces: RunWorkspaces
) -> tuple[Interpreter, FakeControl, CountingTransport]:
    """An interpreter with a publisher, over a run that writes one file."""
    transport = CountingTransport()
    engine, control = interpreter(seeded, workspaces, DOC, transport, writes("a.md"))
    return engine, control, transport


def _kept(workspaces: RunWorkspaces) -> bool:
    """Whether the run's tree, with the file the stage wrote, is still on disk."""
    return (workspaces.path_of(RUN) / "tree" / "a.md").is_file()


# --- the terminal ---------------------------------------------------------------------------


def test_the_terminal_opens_the_draft_pull_request_and_finishes_review_naming_it(
    seeded: SeededRepo, workspaces: RunWorkspaces
) -> None:
    engine, control, transport = _engine(seeded, workspaces)

    asyncio.run(engine.execute(RUN))

    finished = control.finished()
    assert finished is not None and finished.outcome == "review"
    assert finished.stage_key == "done"
    assert f"draft pull request #42 opened: {PR_URL}" in finished.reason
    assert control.pull_requests_created == 1
    (asked,) = control.bodies("pull_request")
    assert asked.epoch == control.epoch
    assert asked.idempotency_key.startswith("test-run.pull_request-")
    assert len(transport.calls) == 1 and TARGET in host_refs(seeded)
    assert not workspaces.path_of(RUN).exists(), "pushed and opened: the tree is gone"


def test_the_branch_is_pushed_before_the_pull_request_and_review_comes_last(
    seeded: SeededRepo, workspaces: RunWorkspaces
) -> None:
    engine, control, _ = _engine(seeded, workspaces)

    asyncio.run(engine.execute(RUN))

    ops = control.ops()
    assert ops.index("push") < ops.index("push_result") < ops.index("pull_request")
    assert ops.index("pull_request") < ops.index("finish")
    assert ops.count("finish") == 1


def test_no_pull_request_is_asked_for_when_the_push_was_refused(
    seeded: SeededRepo, workspaces: RunWorkspaces
) -> None:
    engine, control, _ = _engine(seeded, workspaces)
    control.refusals["push"] = [refusal("protected_branch", 422)]

    asyncio.run(engine.execute(RUN))

    assert "pull_request" not in control.ops()
    finished = control.finished()
    assert finished is not None and finished.outcome == "failed"
    assert "protected_branch" in finished.reason
    assert control.pull_requests_created == 0


@pytest.mark.parametrize("code", PULL_REQUEST_REFUSALS)
def test_every_refusal_fails_the_run_with_its_cause_and_keeps_the_tree(
    seeded: SeededRepo, workspaces: RunWorkspaces, code: str
) -> None:
    engine, control, _ = _engine(seeded, workspaces)
    status = 502 if code == "pr_create_failed" else 409
    control.refusals["pull_request"] = [
        refusal(code, status, message=HOST_MESSAGE, url=PR_URL, flag=True)
    ]

    asyncio.run(engine.execute(RUN))

    finished = control.finished()
    assert finished is not None and finished.outcome == "failed"
    assert finished.stage_key == "done"
    assert f"refused the draft pull request ({code})" in finished.reason
    assert HOST_MESSAGE in finished.reason, "the host's message is named"
    assert PR_URL in finished.reason
    assert len(finished.reason) <= 500
    assert control.ops().count("finish") == 1
    assert control.pull_requests_created == 0
    assert _kept(workspaces), "kept for a retry"


def test_an_unlisted_refusal_also_fails_the_run(
    seeded: SeededRepo, workspaces: RunWorkspaces
) -> None:
    engine, control, _ = _engine(seeded, workspaces)
    control.refusals["pull_request"] = [refusal("run_not_found", 404)]

    asyncio.run(engine.execute(RUN))

    finished = control.finished()
    assert finished is not None and finished.outcome == "failed"
    assert "(run_not_found)" in finished.reason
    assert _kept(workspaces)


@pytest.mark.parametrize("code", sorted(LOST_RUN_CODES))
def test_a_lost_run_takes_the_stop_path_and_sends_no_finish(
    seeded: SeededRepo, workspaces: RunWorkspaces, code: str
) -> None:
    engine, control, _ = _engine(seeded, workspaces)
    control.refusals["pull_request"] = [refusal(code)]

    asyncio.run(engine.execute(RUN))

    assert control.finished() is None
    assert control.ops()[-1] == "pull_request"
    assert _kept(workspaces), "closed, not removed"


def test_an_answer_that_is_not_a_draft_fails_the_run(
    seeded: SeededRepo, workspaces: RunWorkspaces
) -> None:
    engine, control, _ = _engine(seeded, workspaces)
    control.pull_request_draft = False

    asyncio.run(engine.execute(RUN))

    finished = control.finished()
    assert finished is not None and finished.outcome == "failed"
    assert "not a draft" in finished.reason and PR_URL in finished.reason
    assert _kept(workspaces)


def test_a_resumed_terminal_asks_again_and_opens_no_second_pull_request(
    seeded: SeededRepo, workspaces: RunWorkspaces
) -> None:
    engine, control, _ = _engine(seeded, workspaces)
    # The worker loses the control plane after the pull request opened, before `review`.
    control.refusals["finish"] = [TransportError("connection reset")]  # type: ignore[list-item]

    asyncio.run(engine.execute(RUN))

    assert control.pull_requests_created == 1
    assert _kept(workspaces), "paused, not finished: the tree stays"

    asyncio.run(engine.execute(RUN))

    assert control.ops().count("pull_request") == 2
    assert control.pull_requests_created == 1, "the existing pull request is answered"
    finished = control.finished()
    assert finished is not None and finished.outcome == "review"
    assert f"draft pull request #42 already open: {PR_URL}" in finished.reason
    keys = {body.idempotency_key for body in control.bodies("pull_request")}
    assert len(keys) == 2, "each ask is its own submission; REST answers by run"


def test_without_a_publisher_no_pull_request_is_asked_for(
    seeded: SeededRepo, workspaces: RunWorkspaces
) -> None:
    control = FakeControl(DOC, remote=str(seeded.path))
    registry = ExecutorRegistry()
    registry.register("native", Executors(writes("a.md")))
    engine = Interpreter(
        control,
        workspaces.clones,
        workspaces,
        registry,
        worker="engine-test",
        heartbeat_seconds=5,
        sleep=never,
        poll_sleep=never,
    )

    asyncio.run(engine.execute(RUN))

    assert "pull_request" not in control.ops()
    finished = control.finished()
    assert finished is not None and finished.outcome == "review"
    assert "ready for its pull request" in finished.reason


# --- the refusal sentence -------------------------------------------------------------------


def test_the_refusal_text_names_the_scalar_details_only() -> None:
    refused = ControlPlaneError(
        "draft_refused",
        "The host refused a draft.",
        409,
        {"message": HOST_MESSAGE, "status": 422, "nested": {"a": 1}, "flag": True},
    )

    assert _refusal_text(refused) == (
        f"The host refused a draft. (message: {HOST_MESSAGE}, status: 422)"
    )


def test_a_refusal_without_details_is_its_sentence() -> None:
    assert _refusal_text(ControlPlaneError("not_pushed", "Never pushed.", 409)) == (
        "Never pushed."
    )


# --- the client -----------------------------------------------------------------------------


class Recorded:
    """A transport that records requests and answers from a script."""

    def __init__(self, *answers: Response) -> None:
        """Hold the answers, in order."""
        self.answers = list(answers)
        self.sent: list[Any] = []

    def send(self, outgoing: Any) -> Response:
        """Record the request; answer the next response."""
        self.sent.append(outgoing)
        return self.answers.pop(0)


def _client(*answers: Response) -> tuple[IngestClient, Recorded]:
    transport = Recorded(*answers)
    return (
        IngestClient(
            ControlPlaneClient("http://rest.invalid", "k"),
            transport,
            IdempotencyKeys("engine-a"),
        ),
        transport,
    )


def test_the_route_sits_between_the_push_and_the_finish() -> None:
    assert RUN_PULL_REQUEST_PATH == "/internal/runs/{id}/pull-request"
    paths = list(EXECUTION_PATHS)
    assert paths.index("/internal/runs/{id}/push/result") < paths.index(
        RUN_PULL_REQUEST_PATH
    )
    assert paths.index(RUN_PULL_REQUEST_PATH) < paths.index(
        "/internal/runs/{id}/finish"
    )


def test_the_refusals_are_the_routes_own_after_the_lost_run_codes() -> None:
    assert PULL_REQUEST_REFUSALS == (
        "not_pushed",
        "pr_source_unavailable",
        "draft_refused",
        "pr_create_failed",
    )
    assert LOST_RUN_CODES.isdisjoint(PULL_REQUEST_REFUSALS)


def test_the_request_is_snake_case_and_carries_only_the_epoch_and_key() -> None:
    ingest, transport = _client(
        Response(
            200,
            {
                "pull_request_id": "pr-1",
                "number": 7,
                "url": "https://github.com/acme/helios-firmware/pull/7",
                "draft": True,
                "created": True,
            },
        )
    )

    opened = ingest.pull_request(
        RUN, PullRequestRequest(epoch=3, idempotency_key="k-pr")
    )

    (sent,) = transport.sent
    assert sent.method == "POST"
    assert sent.url.endswith(f"/internal/runs/{RUN}/pull-request")
    assert sent.json == {"idempotency_key": "k-pr", "epoch": 3}
    assert opened == PullRequestOpened(
        pull_request_id="pr-1",
        number=7,
        url="https://github.com/acme/helios-firmware/pull/7",
        draft=True,
        created=True,
    )


def test_the_answer_reads_either_spelling() -> None:
    ingest, _ = _client(
        Response(
            200,
            {
                "pullRequestId": "pr-1",
                "number": 7,
                "url": "u",
                "draft": True,
                "created": False,
            },
        )
    )

    opened = ingest.pull_request(RUN, PullRequestRequest(epoch=1, idempotency_key="k"))

    assert opened.pull_request_id == "pr-1" and opened.created is False


def test_the_request_refuses_extra_fields_and_a_zero_epoch() -> None:
    with pytest.raises(ValueError, match="extra"):
        PullRequestRequest.model_validate(
            {"epoch": 1, "idempotency_key": "k", "draft": False}
        )
    with pytest.raises(ValueError, match="greater than or equal"):
        PullRequestRequest(epoch=0, idempotency_key="k")


def test_a_host_failure_is_a_refusal_carrying_its_class() -> None:
    ingest, _ = _client(
        Response(
            502,
            {
                "code": "pr_create_failed",
                "message": "The host failed to open the pull request.",
                "details": {"class": "transient"},
            },
        )
    )

    with pytest.raises(ControlPlaneError) as refused:
        ingest.pull_request(RUN, PullRequestRequest(epoch=1, idempotency_key="k"))

    assert refused.value.code == "pr_create_failed"
    assert refused.value.status == 502
    assert refused.value.details == {"class": "transient"}
