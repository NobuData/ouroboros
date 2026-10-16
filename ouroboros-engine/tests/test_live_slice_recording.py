"""The live slice's recorded exchange (DI.5, #1314) — made with, and held to, the pinned harness.

Two standing assertions, both over the real bundled CLI:

1. The committed recording (``tests/e2e/fixtures/provider-fixture/recordings/live-slice.json``)
   is exactly what the pinned ``claude-agent-sdk`` produces over the scripts in
   :mod:`live_slice_recording`. A bumped SDK that changes what the harness sends fails here,
   naming the fix (``OURO_RECORD_LIVE_SLICE=1`` rewrites the file), so the e2e stack never
   replays a recording the engine no longer matches.
2. The provider fixture that replays it (``tests/e2e/fixtures/provider-fixture/server.mjs``)
   drives a harness session to completion — plan and implement, the fixture's working tree
   ending fixed — and a recording made with a different harness is refused with a message
   that names the version it was made with. Skipped where ``node`` is absent.
"""

from __future__ import annotations

import http.client
import json
import os
import shutil
import socket
import subprocess
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from claude_agent_fixtures import CLI, needs_cli
from live_slice_recording import (
    FIXED_LINE,
    IMPLEMENT_PROMPT,
    PLAN_PROMPT,
    RECORDING_PATH,
    REPO_ROOT,
    make_tree,
    record,
    run_session,
    sha256_of,
    without_timestamp,
)

pytestmark = needs_cli

#: The replaying fixture.
FIXTURE_SERVER = REPO_ROOT / "tests/e2e/fixtures/provider-fixture/server.mjs"

#: Where `node` is, or None.
NODE = shutil.which("node")

needs_node = pytest.mark.skipif(NODE is None, reason="node is not on PATH")


def test_the_committed_recording_is_what_the_pinned_harness_produces(
    tmp_path: Path,
) -> None:
    produced = record(tmp_path)

    if os.environ.get("OURO_RECORD_LIVE_SLICE") == "1":
        RECORDING_PATH.parent.mkdir(parents=True, exist_ok=True)
        RECORDING_PATH.write_text(json.dumps(produced, indent=2) + "\n")

    assert RECORDING_PATH.is_file(), (
        f"{RECORDING_PATH} is missing; record it with OURO_RECORD_LIVE_SLICE=1"
    )
    committed = json.loads(RECORDING_PATH.read_text())
    assert without_timestamp(committed) == without_timestamp(produced), (
        "the committed live-slice recording is not what the pinned harness produces "
        f"(SDK {produced['harness']['sdk']}, CLI {produced['harness']['cli']}); "
        "re-record it: OURO_RECORD_LIVE_SLICE=1 uv run pytest "
        "tests/test_live_slice_recording.py"
    )


def test_the_recording_carries_the_deliberate_failure_and_its_correction() -> None:
    recording = json.loads(RECORDING_PATH.read_text())
    turns = recording["sessions"]["implement"]["turns"]
    flags = [
        [result["is_error"] for result in turn["expect"]["tool_results"]]
        for turn in turns
    ]
    assert flags == [[], [False], [False], [True], [False]], flags
    edits = [
        block
        for turn in turns
        for block in turn["content"]
        if block["type"] == "tool_use" and block["name"] == "Edit"
    ]
    assert len(edits) == 2 and edits[1]["input"]["new_string"] == FIXED_LINE
    assert recording["harness"]["sdk"] and recording["harness"]["cli"]
    assert recording["harness"]["anthropic_beta"], "no beta set was captured"


# --- the fixture replays it to a real session ----------------------------------------------


def _free_port() -> int:
    """A loopback port nothing is listening on.

    Returns:
        The port.
    """
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _get(port: int, path: str) -> tuple[int, Any]:
    """One GET to the fixture.

    Args:
        port: Its port.
        path: The path.

    Returns:
        The status and the parsed JSON body.
    """
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    try:
        connection.request("GET", path)
        response = connection.getresponse()
        return response.status, json.loads(response.read() or b"null")
    finally:
        connection.close()


class Fixture:
    """A provider fixture process over one recording file."""

    def __init__(
        self, recording: Path, log: Path, key_prefix: str = "ouro_hrn_"
    ) -> None:
        """Start it and wait for its health route.

        Args:
            recording: The recording to replay.
            log: Where its output goes — what a failure to start is reported from.
            key_prefix: The accepted key prefix — the run-scoped credential's here, as
                no facade stands between the harness and the fixture in this test.

        Raises:
            RuntimeError: When the server did not come up within ten seconds.
        """
        assert NODE is not None
        self.port = _free_port()
        self.log = log
        self.output = log.open("w")
        self.process = subprocess.Popen(  # noqa: S603 — our own fixture, fixed arguments
            [NODE, str(FIXTURE_SERVER)],
            env={
                **os.environ,
                "PROVIDER_FIXTURE_RECORDING": str(recording),
                "PROVIDER_FIXTURE_PORT": str(self.port),
                "PROVIDER_FIXTURE_KEY_PREFIX": key_prefix,
            },
            stdout=self.output,
            stderr=subprocess.STDOUT,
        )
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            if self.process.poll() is not None:
                self.output.close()
                raise RuntimeError(f"the fixture exited: {log.read_text()}")
            try:
                status, _ = _get(self.port, "/healthz")
                if status == 200:
                    return
            except OSError:
                time.sleep(0.1)
        raise RuntimeError("the fixture did not answer /healthz in ten seconds")

    @property
    def url(self) -> str:
        """The address the executor is given.

        Returns:
            Loopback, this port.
        """
        return f"http://127.0.0.1:{self.port}"

    def requests(self) -> list[dict[str, Any]]:
        """What the fixture saw.

        Returns:
            Its request log.
        """
        status, body = _get(self.port, "/__fixture/requests")
        assert status == 200, body
        return body if isinstance(body, list) else body["requests"]

    def close(self) -> None:
        """Stop it, and close what it wrote to."""
        self.process.terminate()
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait(timeout=5)
        finally:
            self.output.close()


@pytest.fixture
def fixtures(tmp_path: Path) -> Iterator[Any]:
    """Start fixtures; every one is stopped afterwards."""
    made: list[Fixture] = []

    def make(recording: Path) -> Fixture:
        made.append(Fixture(recording, tmp_path / f"fixture-{len(made)}.log"))
        return made[-1]

    yield make
    for each in made:
        each.close()


@needs_node
def test_the_fixture_drives_both_sessions_to_completion(
    tmp_path: Path, fixtures
) -> None:
    assert CLI is not None
    fixture = fixtures(RECORDING_PATH)
    recording = json.loads(RECORDING_PATH.read_text())

    plan_tree = make_tree(tmp_path, "plan")
    _events, planner = run_session(
        plan_tree, "plan", PLAN_PROMPT, rest_url=fixture.url, cli_path=CLI
    )
    assert planner.outcome is not None and planner.outcome.status == "completed", (
        planner.outcome
    )
    assert (plan_tree / "bin" / "greet").read_text() == (
        make_tree(tmp_path, "untouched") / "bin" / "greet"
    ).read_text(), "the plan session must change nothing"

    implement_tree = make_tree(tmp_path, "implement")
    _events, coder = run_session(
        implement_tree,
        "implement",
        IMPLEMENT_PROMPT,
        rest_url=fixture.url,
        cli_path=CLI,
    )
    assert coder.outcome is not None and coder.outcome.status == "completed", (
        coder.outcome
    )
    greeter = implement_tree / "bin" / "greet"
    assert FIXED_LINE in greeter.read_text()
    assert (
        sha256_of(greeter)
        == recording["sessions"]["implement"]["files_after"]["bin/greet"]
    )

    seen = fixture.requests()
    main = [entry for entry in seen if entry.get("main")]
    assert {entry["session"] for entry in main} == {"plan", "implement"}, seen
    assert all(entry.get("mismatch") is None for entry in seen), seen


@needs_node
def test_a_recording_from_another_harness_is_refused_by_name(
    tmp_path: Path, fixtures
) -> None:
    assert CLI is not None
    recording = json.loads(RECORDING_PATH.read_text())
    recording["harness"]["sdk"] = "0.0.1"
    recording["harness"]["cli"] = "0.0.1"
    recording["harness"]["anthropic_beta"] = [
        *recording["harness"]["anthropic_beta"][1:],
        "another-harness-2099-01-01",
    ]
    tampered = tmp_path / "other-harness.json"
    tampered.write_text(json.dumps(recording))
    fixture = fixtures(tampered)

    tree = make_tree(tmp_path, "implement")
    _events, coder = run_session(
        tree, "implement", IMPLEMENT_PROMPT, rest_url=fixture.url, cli_path=CLI
    )

    assert coder.outcome is not None and coder.outcome.status == "failed", coder.outcome
    assert "Claude Agent SDK 0.0.1" in (coder.outcome.error or ""), coder.outcome.error
    assert any(entry.get("mismatch") == "harness" for entry in fixture.requests())
    assert FIXED_LINE not in (tree / "bin" / "greet").read_text()
