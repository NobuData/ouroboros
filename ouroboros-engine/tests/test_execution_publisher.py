"""The branch publisher (DI.2, #1310) — attributed commits, one fast-forward push, refusals.

The "host" is the fixture repository itself, a bare repository on disk reached through the
same dulwich transport the engine uses for https, in its local form. Every refusal is
asserted by counting the transport's ``connect`` calls: a refused push never opens one.
"""

from __future__ import annotations

import asyncio
import logging
import os
import subprocess
from pathlib import Path
from typing import Any

import pytest
from dulwich.errors import GitProtocolError, HangupException
from dulwich.objects import Commit
from dulwich.repo import Repo

from code_fixtures import SeededRepo, build_repo
from execution_fakes import (
    ISSUE,
    PUSH_TOKEN,
    RUN,
    Executors,
    FakeControl,
    Recording,
    chain,
    infra,
    llm,
    never,
    refusal,
    term,
    trigger,
)
from ouroboros_engine.code.clones import CloneStore, RepositoryRef
from ouroboros_engine.control_plane.execution import (
    PUSH_REFUSALS,
    PushGrant,
    StartedBy,
)
from ouroboros_engine.execution.interpreter import Interpreter
from ouroboros_engine.execution.publisher import (
    CommitIdentity,
    DulwichPushTransport,
    Publisher,
    PublishError,
    PublishRun,
    check_refspec,
    commit_message,
)
from ouroboros_engine.execution.registry import ExecutorRegistry
from ouroboros_engine.execution.reporter import RunReporter
from ouroboros_engine.execution.workspace import (
    CheckpointCommit,
    RunSpec,
    RunWorkspace,
    RunWorkspaces,
)
from stage_executor_fakes import Call, Say, Script

BRANCH = f"ouro/run-{RUN}-{ISSUE}"
TARGET = f"refs/heads/{BRANCH}".encode()
IDENTITY = CommitIdentity(name="Ouroboros", email="loop@ouroboros.invalid")
STARTER = StartedBy(name="Ken Suenobu", email="ken@acme-robotics.dev")


class CountingTransport:
    """The real local transport, counting every connection and the credential it got."""

    def __init__(self, inner: Any = None) -> None:
        """Wrap a transport (dulwich's local one by default)."""
        self.inner = inner or DulwichPushTransport(allow_local=True)
        self.calls: list[tuple[str, str, str]] = []

    def connect(self, remote: str, username: str, password: str) -> Any:
        """Count, then connect."""
        self.calls.append((remote, username, password))
        return self.inner.connect(remote, username, password)


class FailingClient:
    """A host that fails the push the way a transport error does."""

    def __init__(self, error: BaseException) -> None:
        """Hold the error."""
        self.error = error

    def send_pack(self, *_args: Any, **_kwargs: Any) -> Any:
        """Fail."""
        raise self.error


class FailingTransport:
    """Connects, then the host fails."""

    def __init__(self, error: BaseException) -> None:
        """Hold the error."""
        self.error = error
        self.calls = 0

    def connect(self, remote: str, username: str, password: str) -> Any:
        """Hand back a failing client."""
        del remote, username, password
        self.calls += 1
        return FailingClient(self.error), b"/acme/helios-firmware.git"


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


class Run:
    """One run's tree, reporter and publisher over the fixture host."""

    def __init__(
        self, seeded: SeededRepo, workspaces: RunWorkspaces, transport: Any = None
    ) -> None:
        """Open the tree at ``c3`` and take the run."""
        self.seeded = seeded
        self.control = FakeControl({}, remote=str(seeded.path))
        started = self.control.start(RUN, "engine-test")
        self.reporter = RunReporter(self.control, RUN, started.epoch)
        self.workspace: RunWorkspace = workspaces.open(
            RunSpec(
                RUN,
                ISSUE,
                seeded.sha("c3"),
                RepositoryRef("org-acme", "acme/helios-firmware", str(seeded.path)),
            )
        )
        self.transport = transport or CountingTransport()
        self.publisher = Publisher(IDENTITY, self.transport)
        self.run = PublishRun(
            run_id=RUN,
            issue_number=ISSUE,
            issue_title="Execute the pinned workflow",
            branch=BRANCH,
            workflow_tag="docs-loop",
            workflow_version=1,
            default_alias="claude-sonnet-5-5",
            aliases={"implement": "coder-max"},
            started_by=STARTER,
        )

    def edit(self, path: str, text: str, stage: str = "implement", attempt: int = 1):
        """Write a file and checkpoint it as one stage attempt."""
        target = self.workspace.path / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)
        return self.workspace.checkpoint(stage, attempt)

    def publish(self) -> Any:
        """Publish."""
        return asyncio.run(
            self.publisher.publish(self.workspace, self.run, self.reporter)
        )

    def host_refs(self) -> dict[bytes, bytes]:
        """The host's refs."""
        return host_refs(self.seeded)

    def host_commit(self, sha: bytes) -> Commit:
        """A commit on the host."""
        with Repo(str(self.seeded.path)) as host:
            found = host[sha]
        assert isinstance(found, Commit)
        return found

    def set_host_ref(self, ref: bytes, sha: bytes) -> None:
        """Move a ref on the host."""
        with Repo(str(self.seeded.path)) as host:
            host.refs[ref] = sha


def host_refs(seeded: SeededRepo) -> dict[bytes, bytes]:
    """The host's refs, read and closed."""
    with Repo(str(seeded.path)) as host:
        return dict(host.refs.as_dict())


def host_message(seeded: SeededRepo, sha: bytes) -> str:
    """A host commit's message."""
    with Repo(str(seeded.path)) as host:
        found = host[sha]
    assert isinstance(found, Commit)
    return found.message.decode()


@pytest.fixture
def run(seeded: SeededRepo, workspaces: RunWorkspaces):
    """A run over the fixture host."""
    made = Run(seeded, workspaces)
    yield made
    made.workspace.close()


# --- attributed commits on one branch ----------------------------------------------------------


def test_a_run_arrives_on_the_host_as_one_branch_with_its_authorship(
    run: Run,
) -> None:
    main_before = run.host_refs()[b"refs/heads/main"]
    checkpoint = run.edit("docs/guide.md", "# Guide\n")

    published = run.publish()

    assert published is not None and published.commits == 1
    refs = run.host_refs()
    assert refs[TARGET].decode() == published.head
    assert refs[b"refs/heads/main"] == main_before, "the default branch is untouched"
    commit = run.host_commit(refs[TARGET])
    assert commit.author == commit.committer == b"Ouroboros <loop@ouroboros.invalid>"
    assert commit.parents == [run.seeded.sha("c3").encode()]
    assert commit.tree == run.workspace.git[checkpoint.encode()].tree
    message = commit.message.decode()
    assert message.startswith("implement: Execute the pinned workflow (#160)\n\n")
    assert f"Generated by an automated Ouroboros loop for run {RUN}" in message
    assert message.endswith(
        f"Ouroboros-Run: {RUN}\n"
        "Ouroboros-Workflow: docs-loop@v1\n"
        "Ouroboros-Model: coder-max\n"
        "Ouroboros-Stage: implement attempt 1\n"
        "Co-authored-by: Ken Suenobu <ken@acme-robotics.dev>\n"
    )
    assert b"gpgsig" not in commit.as_raw_string(), "no signature is claimed"


def test_the_change_set_is_judged_before_the_push_and_the_push_is_reported(
    run: Run,
) -> None:
    run.edit("docs/guide.md", "# Guide\n")

    published = run.publish()

    assert published is not None
    assert run.control.ops()[-4:] == ["files", "push", "commits", "push_result"]
    push = run.control.bodies("push")[0]
    assert push.branch == BRANCH and push.head_sha == published.head
    assert push.change_set_seq == 1
    assert push.force is None, "this engine never asks to force"
    commits = run.control.bodies("commits")[0].commits
    assert [commit.sha for commit in commits] == [published.head]
    result = run.control.bodies("push_result")[0]
    assert (result.outcome, result.pushed_sha) == ("pushed", published.head)


def test_nothing_new_is_nothing_pushed(run: Run) -> None:
    assert run.publish() is None
    assert run.transport.calls == []
    assert "push" not in run.control.ops()


def test_a_second_attempt_after_a_correction_adds_a_commit_without_force(
    run: Run,
) -> None:
    run.edit("docs/guide.md", "# Guide\n", attempt=1)
    first = run.publish()
    run.edit("docs/guide.md", "# Guide\n\nCorrected.\n", attempt=2)

    second = run.publish()

    assert first is not None and second is not None and second.commits == 1
    tip = run.host_commit(run.host_refs()[TARGET])
    assert tip.id.decode() == second.head
    assert tip.parents == [first.head.encode()], "fast-forward on the same branch"
    assert b"Ouroboros-Stage: implement attempt 2" in tip.message


def test_a_commit_without_a_starter_names_no_co_author() -> None:
    checkpoint = CheckpointCommit("a" * 40, b"t" * 20, "plan", None, 0, 0)
    run = PublishRun(
        run_id=RUN,
        issue_number=ISSUE,
        issue_title="  A   very long title " + "x" * 120,
        branch=BRANCH,
        workflow_tag="live-slice",
        workflow_version=3,
        default_alias="slice-planner",
        aliases={},
        started_by=None,
    )

    message = commit_message(run, checkpoint)

    assert "Co-authored-by" not in message
    assert "Ouroboros-Stage: plan\n" in message
    assert "Ouroboros-Model: slice-planner\n" in message
    subject = message.split("\n", 1)[0]
    assert subject.startswith("plan: A very long title ") and "…" in subject


# --- refusals: none of them reaches the network -----------------------------------------------


@pytest.mark.parametrize("code", PUSH_REFUSALS)
def test_every_control_plane_refusal_stops_before_the_network(
    run: Run, code: str
) -> None:
    run.edit("docs/guide.md", "# Guide\n")
    run.control.refusals["push"] = [refusal(code, 422)]

    with pytest.raises(PublishError) as refused:
        run.publish()

    assert refused.value.code == code
    assert code in refused.value.reason
    assert run.transport.calls == [], "no connection was opened"
    assert "push_result" not in run.control.ops()
    assert "commits" not in run.control.ops()
    assert run.workspace.published() is None
    assert len(run.workspace.unpublished_checkpoints()) == 1, "kept for the retry"


@pytest.mark.parametrize(
    "refspec",
    [
        f"+refs/heads/{BRANCH}:refs/heads/{BRANCH}",
        f"refs/heads/{BRANCH}:refs/heads/{BRANCH} refs/heads/main:refs/heads/main",
        "refs/heads/main:refs/heads/main",
        f"refs/heads/{BRANCH}:refs/heads/main",
        "refs/heads/feature/x:refs/heads/feature/x",
        f"refs/heads/{BRANCH}",
    ],
)
def test_a_refspec_other_than_the_run_branch_is_refused_here(
    run: Run, refspec: str
) -> None:
    run.edit("docs/guide.md", "# Guide\n")
    run.control.push_refspec = refspec
    main_before = run.host_refs()[b"refs/heads/main"]

    with pytest.raises(PublishError):
        run.publish()

    assert run.transport.calls == []
    assert run.host_refs()[b"refs/heads/main"] == main_before


def test_check_refspec_accepts_exactly_the_run_branch() -> None:
    assert check_refspec(f"refs/heads/{BRANCH}:refs/heads/{BRANCH}", BRANCH) == TARGET
    with pytest.raises(PublishError, match="force"):
        check_refspec(f"+refs/heads/{BRANCH}:refs/heads/{BRANCH}", BRANCH)
    with pytest.raises(PublishError, match="run branch"):
        check_refspec("refs/heads/main:refs/heads/main", "main")


def test_a_branch_the_run_did_not_make_is_never_overwritten(run: Run) -> None:
    # c7 is not an ancestor of the run's head.
    run.set_host_ref(TARGET, run.seeded.sha("c7").encode())
    run.edit("docs/guide.md", "# Guide\n")

    with pytest.raises(PublishError) as refused:
        run.publish()

    assert "never force-pushed" in refused.value.reason
    assert run.host_refs()[TARGET] == run.seeded.sha("c7").encode()
    result = run.control.bodies("push_result")[0]
    assert result.outcome == "failed" and "never force-pushed" in (result.reason or "")


@pytest.mark.parametrize(
    ("error", "reason"),
    [
        (GitProtocolError("unexpected http resp 403 for /x"), "HTTP 403"),
        (GitProtocolError("unexpected http resp 404 for /x"), "no such repository"),
        (HangupException(), "could not be reached"),
        (OSError("Connection refused"), "could not be reached"),
    ],
)
def test_a_host_failure_ends_with_the_hosts_reason_and_keeps_the_tree(
    seeded: SeededRepo, workspaces: RunWorkspaces, error: BaseException, reason: str
) -> None:
    run = Run(seeded, workspaces, FailingTransport(error))
    try:
        run.edit("docs/guide.md", "# Guide\n")

        with pytest.raises(PublishError) as failed:
            run.publish()

        assert reason in failed.value.reason
        result = run.control.bodies("push_result")[0]
        assert result.outcome == "failed" and reason in (result.reason or "")
        assert (run.workspace.path / "docs" / "guide.md").is_file()
        assert len(run.workspace.unpublished_checkpoints()) == 1
        assert "commits" not in run.control.ops()
    finally:
        run.workspace.close()


def test_a_retry_after_a_failure_pushes_the_same_commit(
    seeded: SeededRepo, workspaces: RunWorkspaces
) -> None:
    failing = FailingTransport(HangupException())
    run = Run(seeded, workspaces, failing)
    try:
        run.edit("docs/guide.md", "# Guide\n")
        with pytest.raises(PublishError):
            run.publish()
        attempted = run.control.bodies("push")[0].head_sha

        run.publisher = Publisher(IDENTITY, CountingTransport())
        published = run.publish()

        assert published is not None and published.head == attempted
    finally:
        run.workspace.close()


# --- the credential ---------------------------------------------------------------------------


def test_the_credential_is_written_nowhere(
    run: Run, caplog: pytest.LogCaptureFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    spawned: list[Any] = []
    real_popen = subprocess.Popen.__init__

    def record(self: Any, *args: Any, **kwargs: Any) -> None:
        spawned.append(args)
        real_popen(self, *args, **kwargs)

    run.edit("docs/guide.md", "# Guide\n")
    # Watched from here: the publish, not the checkpoint the test set up.
    monkeypatch.setattr(subprocess.Popen, "__init__", record)
    caplog.set_level(logging.DEBUG)

    published = run.publish()

    assert published is not None
    assert run.transport.calls[0][2] == PUSH_TOKEN, (
        "the push used the granted credential"
    )
    assert spawned == [], "no process was started"
    for path in run.workspace.directory.rglob("*"):
        if path.is_file():
            assert PUSH_TOKEN.encode() not in path.read_bytes(), path
    config = (run.workspace.path / ".git" / "config").read_text()
    assert "[remote" not in config and "url" not in config
    assert all(PUSH_TOKEN not in value for value in os.environ.values())
    assert all(PUSH_TOKEN not in record.getMessage() for record in caplog.records)
    assert PUSH_TOKEN not in "".join(str(body) for _, body in run.control.calls[1:])


def test_the_grant_never_prints_its_credential() -> None:
    grant = PushGrant.model_validate(
        {
            "refspec": f"refs/heads/{BRANCH}:refs/heads/{BRANCH}",
            "remote": "https://github.com/acme/helios-firmware",
            "username": "x-access-token",
            "password": PUSH_TOKEN,
        }
    )

    assert PUSH_TOKEN not in repr(grant)
    assert PUSH_TOKEN not in str(grant)
    assert PUSH_TOKEN not in grant.model_dump_json()
    assert grant.secret() == PUSH_TOKEN


def test_an_https_remote_with_credentials_in_it_is_refused() -> None:
    transport = DulwichPushTransport()

    with pytest.raises(Exception, match="https://host/owner/name"):
        transport.connect("https://user:pw@github.com/acme/x", "x", PUSH_TOKEN)
    with pytest.raises(Exception, match="https://host/owner/name"):
        transport.connect("http://github.com/acme/x", "x", PUSH_TOKEN)


# --- through the interpreter --------------------------------------------------------------------


def writes(*paths: str) -> Recording:
    """A native fake that writes each path."""
    steps: list[Any] = [Say("Writing.")]
    steps += [Call("write_file", path, f"{path}\n") for path in paths]
    return Recording(Script(steps))


def interpreter(
    seeded: SeededRepo,
    workspaces: RunWorkspaces,
    doc: dict[str, Any],
    transport: Any,
    *executors: Any,
) -> tuple[Interpreter, FakeControl]:
    """An interpreter with a publisher over the fixture host."""
    control = FakeControl(doc, remote=str(seeded.path))
    registry = ExecutorRegistry()
    registry.register("native", Executors(*executors))
    return (
        Interpreter(
            control,
            workspaces.clones,
            workspaces,
            registry,
            worker="engine-test",
            heartbeat_seconds=5,
            sleep=never,
            poll_sleep=never,
            publisher=Publisher(IDENTITY, transport),
        ),
        control,
    )


def test_the_pull_request_terminal_pushes_then_finishes_review_and_removes_the_tree(
    seeded: SeededRepo, workspaces: RunWorkspaces
) -> None:
    doc = chain(trigger(), llm("write-docs"), term("done", "open_pr_automerge"))
    transport = CountingTransport()
    engine, control = interpreter(
        seeded, workspaces, doc, transport, writes("docs/guide.md")
    )

    asyncio.run(engine.execute(RUN))

    finished = control.finished()
    assert finished is not None and finished.outcome == "review"
    assert len(transport.calls) == 1
    message = host_message(seeded, host_refs(seeded)[TARGET])
    assert "Ouroboros-Stage: write-docs attempt 1" in message
    assert "Ouroboros-Model: claude-sonnet-5-5" in message
    assert "Co-authored-by: Ken Suenobu <ken@acme-robotics.dev>" in message
    assert not workspaces.path_of(RUN).exists(), "pushed: the tree is removed"


def test_a_build_stage_pushes_the_branch_before_it_runs(
    seeded: SeededRepo, workspaces: RunWorkspaces
) -> None:
    doc = chain(
        trigger(), llm("implement"), infra("build"), term("done", "open_pr_automerge")
    )
    transport = CountingTransport()
    engine, control = interpreter(seeded, workspaces, doc, transport, writes("a.md"))

    asyncio.run(engine.execute(RUN))

    assert len(transport.calls) == 1
    assert TARGET in host_refs(seeded)
    ops = control.ops()
    assert ops.index("push_result") < ops.index("finish")
    finished = control.finished()
    assert finished is not None and finished.reason.startswith("infra_unavailable")


def test_a_refused_push_fails_the_run_with_the_reason_and_keeps_the_tree(
    seeded: SeededRepo, workspaces: RunWorkspaces
) -> None:
    doc = chain(trigger(), llm("write-docs"), term("done", "open_pr_automerge"))
    transport = CountingTransport()
    engine, control = interpreter(seeded, workspaces, doc, transport, writes("a.md"))
    control.refusals["push"] = [refusal("protected_branch", 422)]

    asyncio.run(engine.execute(RUN))

    finished = control.finished()
    assert finished is not None and finished.outcome == "failed"
    assert "protected_branch" in finished.reason
    assert transport.calls == []
    assert (workspaces.path_of(RUN) / "tree" / "a.md").is_file(), "kept for retry"
    assert TARGET not in host_refs(seeded)
