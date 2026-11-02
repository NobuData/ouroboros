"""The build stage's pieces (AJ.3, #265): argv, phase sentences, and the run-build contract."""

from __future__ import annotations

from typing import Any

import pytest

from execution_fakes import farm_job
from ouroboros_engine.control_plane.builds import (
    BUILD_PATHS,
    RunBuild,
    RunBuildCancelRequest,
    RunBuildRequest,
)
from ouroboros_engine.control_plane.client import ControlPlaneClient, ControlPlaneError
from ouroboros_engine.control_plane.contract import INTERNAL_KEY_HEADER
from ouroboros_engine.execution.build import command_argv, describe
from ouroboros_engine.workflows.dsl import InfraConfig, Position, WorkflowNode
from ouroboros_engine.workflows.infra import infra_kind

RUN = "5eed0009-0000-4000-8000-000000000482"
JOB = "5eed0028-0000-4000-8000-000000000483"
COMMIT = "3f9c2ae0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6"


def job(phase: str, **over: Any) -> RunBuild:
    """One read of a farm job."""
    return RunBuild.model_validate(farm_job(phase, **over))


# --- argv -----------------------------------------------------------------------------------


def test_a_command_is_split_the_way_a_shell_would_without_expansion() -> None:
    assert command_argv("west build -b 'helios mainboard' $HOME") == [
        "west",
        "build",
        "-b",
        "helios mainboard",
        "$HOME",
    ]


def test_no_command_is_the_pools_default() -> None:
    assert command_argv(None) is None


@pytest.mark.parametrize("command", ["make 'oops", "   "])
def test_a_command_that_does_not_split_is_refused(command: str) -> None:
    with pytest.raises(ValueError):
        command_argv(command)


# --- what the transcript says ---------------------------------------------------------------


@pytest.mark.parametrize(
    ("read", "said"),
    [
        (
            job("waiting", queueState="queued_runner_available"),
            "Build #483 is waiting for a runner in pool `pool-a`.",
        ),
        (
            job("waiting", queueState="queued_no_eligible_runner"),
            "Build #483 is waiting in pool `pool-a`: no runner can take it right now.",
        ),
        (job("offered"), "Build #483 was offered to forge-02."),
        (job("accepted"), "forge-02 accepted build #483."),
        (job("running"), "Build #483 is running on forge-02."),
        (job("succeeded"), "Build #483 passed on forge-02 (exit 0 · ccache 78.4%)."),
        (
            job("failed", ccache=None),
            "Build #483 failed on forge-02 (exit 2 · ccache not measured).",
        ),
        (job("canceled"), "Build #483 was cancelled."),
    ],
)
def test_each_phase_is_one_sentence(read: RunBuild, said: str) -> None:
    assert describe(read) == said


def test_a_finished_phase_is_terminal_and_a_live_one_is_not() -> None:
    assert job("failed").finished and job("canceled").finished
    assert not job("running").finished and not job("waiting").finished


# --- build or test --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("node_id", "title", "kind"),
    [
        ("build", "Build farm", "build"),
        ("test", "Run tests", "test"),
        ("hil", "HIL tests", "test"),
        ("latest", "Latest firmware", "build"),
    ],
)
def test_an_infra_stage_is_a_test_run_only_when_its_name_says_so(
    node_id: str, title: str, kind: str
) -> None:
    node = WorkflowNode(
        id=node_id,
        type="infra",
        title=title,
        position=Position(x=0, y=0),
        config=InfraConfig(),
    )

    assert infra_kind(node) == kind


# --- the contract ---------------------------------------------------------------------------


@pytest.fixture
def client() -> ControlPlaneClient:
    """A client against a local control plane."""
    return ControlPlaneClient("http://rest:3001", "shared-secret")


def test_a_submission_is_camel_case_fenced_and_keyed(
    client: ControlPlaneClient,
) -> None:
    request = client.build_request(
        RUN,
        RunBuildRequest(
            idempotency_key="run-482-build-1",
            epoch=3,
            stage_key="build",
            attempt=1,
            pool="pool-a",
            commit=COMMIT,
            command=["make", "all"],
        ),
    )

    assert (request.method, request.url) == (
        "POST",
        f"http://rest:3001/internal/runs/{RUN}/builds",
    )
    assert request.headers[INTERNAL_KEY_HEADER] == "shared-secret"
    assert request.json == {
        "idempotencyKey": "run-482-build-1",
        "epoch": 3,
        "stageKey": "build",
        "attempt": 1,
        "pool": "pool-a",
        "commit": COMMIT,
        "command": ["make", "all"],
    }


def test_a_submission_without_a_command_leaves_it_out(
    client: ControlPlaneClient,
) -> None:
    request = client.build_request(
        RUN,
        RunBuildRequest(
            idempotency_key="k",
            stage_key="build",
            attempt=1,
            pool="pool-a",
            commit=COMMIT,
        ),
    )

    assert "command" not in request.json and "epoch" not in request.json


def test_a_read_is_a_get_with_no_body(client: ControlPlaneClient) -> None:
    request = client.build_read_request(RUN, JOB)

    assert (request.method, request.url, request.json) == (
        "GET",
        f"http://rest:3001/internal/runs/{RUN}/builds/{JOB}",
        {},
    )


def test_a_cancellation_names_the_job(client: ControlPlaneClient) -> None:
    request = client.build_cancel_request(
        RUN, JOB, RunBuildCancelRequest(idempotency_key="k", epoch=3, reason="grace")
    )

    assert request.url == f"http://rest:3001/internal/runs/{RUN}/builds/{JOB}/cancel"
    assert request.json == {"idempotencyKey": "k", "epoch": 3, "reason": "grace"}


def test_an_answer_is_read_as_the_latest_attempt(client: ControlPlaneClient) -> None:
    read = client.read_build(200, {"job": farm_job("failed", retries=1)})

    assert (read.phase, read.exit_code, read.retries) == ("failed", 2, 1)
    assert read.ccache is not None and read.ccache.hit_rate_pct == 78.4


def test_a_refusal_carries_its_code_and_sentence(client: ControlPlaneClient) -> None:
    with pytest.raises(ControlPlaneError) as refused:
        client.read_build(
            409,
            {
                "code": "build_no_eligible_runner",
                "message": "No runner in pool `pool-a` can take this build.",
                "details": {"pool": "pool-a"},
            },
        )

    assert refused.value.code == "build_no_eligible_runner"
    assert str(refused.value) == "No runner in pool `pool-a` can take this build."


def test_a_submission_refuses_a_shape_the_control_plane_would() -> None:
    with pytest.raises(ValueError):
        RunBuildRequest(
            idempotency_key="k",
            stage_key="Build Stage",
            attempt=1,
            pool="pool-a",
            commit=COMMIT,
        )
    with pytest.raises(ValueError):
        RunBuildRequest(
            idempotency_key="k",
            stage_key="build",
            attempt=1,
            pool="pool-a",
            commit="HEAD",
        )


def test_the_three_build_paths_are_the_ones_the_contract_names() -> None:
    assert BUILD_PATHS == (
        "/internal/runs/{id}/builds",
        "/internal/runs/{id}/builds/{job}",
        "/internal/runs/{id}/builds/{job}/cancel",
    )
