"""Shared pieces of the Claude Agent executor's suites (DH.3, #1308).

The real bundled CLI runs against :mod:`harness_stub_facade` on loopback, with the run-scoped
credential minted by :class:`FakeCredentials` instead of ``ouroboros-rest``.
"""

from __future__ import annotations

import os
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pytest

from harness_stub_facade import Facade, Turn, serve
from ouroboros_engine.control_plane.harness import (
    HarnessCredential,
    HarnessCredentialRequest,
    HarnessReconcileRequest,
    HarnessReconciliation,
)
from ouroboros_engine.execution.executors.claude_agent import ClaudeAgentExecutor
from ouroboros_engine.execution.executors.claude_agent_env import bundled_cli
from ouroboros_engine.execution.policy import ToolPolicy
from ouroboros_engine.execution.spi import StageContext
from ouroboros_engine.workflows.dsl import LlmPermissions

#: The bundled CLI, or ``None`` where the SDK wheel is not installed.
CLI = bundled_cli()

#: Skips a test that needs the real CLI where it is absent.
needs_cli = pytest.mark.skipif(
    CLI is None, reason="the bundled Claude Agent CLI is absent"
)

#: The token the fake mints — the shape REST's has.
TOKEN = "ouro_hrn_" + "T" * 43


@dataclass
class FakeCredentials:
    """The control plane's credential routes, recorded.

    Attributes:
        minted: Every mint body.
        reconciled: Every ``(credential, body)`` reconciled.
        revoked: Every credential revoked.
        refuse_mint: Make minting raise.
    """

    minted: list[HarnessCredentialRequest] = field(default_factory=list)
    reconciled: list[tuple[str, HarnessReconcileRequest]] = field(default_factory=list)
    revoked: list[str] = field(default_factory=list)
    refuse_mint: bool = False
    lock: threading.Lock = field(default_factory=threading.Lock)

    def mint_credential(self, body: HarnessCredentialRequest) -> HarnessCredential:
        """Mint one, or refuse.

        Args:
            body: The binding.

        Returns:
            A credential carrying :data:`TOKEN`.

        Raises:
            RuntimeError: When ``refuse_mint`` is set.
        """
        if self.refuse_mint:
            raise RuntimeError("run_finished")
        with self.lock:
            self.minted.append(body)
            number = len(self.minted)
        return HarnessCredential.model_validate(
            {
                "id": f"00000000-0000-4000-8000-{number:012d}",
                "token": TOKEN,
                "run": body.run,
                "stage": body.stage,
                "alias": body.alias,
                "attempt": body.attempt,
                "expiresAt": "2026-10-15T14:00:00.000Z",
            }
        )

    def reconcile_credential(
        self, credential: str, body: HarnessReconcileRequest
    ) -> HarnessReconciliation:
        """Record a reconcile.

        Args:
            credential: The id.
            body: The totals.

        Returns:
            A matching comparison.
        """
        with self.lock:
            self.reconciled.append((credential, body))
        return HarnessReconciliation(
            id=credential, matches=True, reconciled_at="2026-10-15T12:00:00.000Z"
        )

    def revoke_credential(self, credential: str) -> None:
        """Record a revoke.

        Args:
            credential: The id.
        """
        with self.lock:
            self.revoked.append(credential)


def make_tree(tmp_path: Path) -> Path:
    """A run directory with its tree, laid out as DI.1 lays them out.

    Args:
        tmp_path: The test's directory.

    Returns:
        ``<tmp>/runs/run-1/tree``, holding ``README.md``.
    """
    tree = tmp_path / "runs" / "run-1" / "tree"
    tree.mkdir(parents=True)
    (tree / "README.md").write_text("# sandbox\n\nAdd greet() to src/greet.py.\n")
    return tree


def context(tree: Path, *, touch_ci: bool = False, attempt: int = 1) -> StageContext:
    """An ``implement`` attempt over ``tree`` with ``boot/**`` protected.

    Args:
        tree: The working tree.
        touch_ci: The stage's ``touch_ci``.
        attempt: The attempt number.

    Returns:
        The context.
    """
    return StageContext(
        run_id="0b5e0160-0000-4000-8000-000000000001",
        stage_key="implement",
        attempt=attempt,
        prompt="Add greet() to src/greet.py.",
        model="coder-max",
        policy=ToolPolicy(
            working_tree=str(tree),
            permissions=LlmPermissions(push_fixup=False, touch_ci=touch_ci),
            protected_paths=("boot/**",),
        ),
    )


def write(tree: Path, relative: str, content: str = "x = 1\n") -> tuple[str, dict]:
    """A scripted ``Write`` call.

    Args:
        tree: The tree the path is under.
        relative: The path, relative to the tree (may climb out with ``..``).
        content: What to write.

    Returns:
        The tool call.
    """
    return ("Write", {"file_path": f"{tree}/{relative}", "content": content})


def read(tree: Path, relative: str = "README.md") -> tuple[str, dict]:
    """A scripted ``Read`` call.

    Args:
        tree: The tree.
        relative: The path.

    Returns:
        The tool call.
    """
    return ("Read", {"file_path": f"{tree}/{relative}"})


class Bench:
    """A stub facade and the executors that talk to it, for one test."""

    def __init__(self, script: list[Turn], **executor: Any) -> None:
        """Start the facade.

        Args:
            script: The model.
            **executor: Extra executor arguments.
        """
        self.facade = Facade(script)
        self.server = serve(self.facade)
        self.credentials = FakeCredentials()
        self.options = executor
        self.made: list[ClaudeAgentExecutor] = []

    @property
    def url(self) -> str:
        """The REST URL the executor is given; the facade is under it.

        Returns:
            The loopback address.
        """
        return f"http://127.0.0.1:{self.server.server_address[1]}"

    def executor(self, **overrides: Any) -> ClaudeAgentExecutor:
        """A fresh executor.

        Args:
            **overrides: Executor arguments for this one.

        Returns:
            The executor.
        """
        assert CLI is not None
        made = ClaudeAgentExecutor(
            self.credentials,
            rest_url=self.url,
            cli_path=CLI,
            **(self.options | overrides),
        )
        self.made.append(made)
        return made

    def close(self) -> None:
        """Stop the facade."""
        self.server.shutdown()
        self.server.server_close()


def descendants(root: int) -> list[int]:
    """Every process under ``root``, read from ``/proc``.

    Args:
        root: The ancestor's pid.

    Returns:
        The pids.
    """
    parents: dict[int, int] = {}
    for entry in Path("/proc").iterdir():
        if entry.name.isdigit():
            try:
                fields = (entry / "stat").read_text().rsplit(")", 1)[1].split()
                parents[int(entry.name)] = int(fields[1])
            except (OSError, IndexError, ValueError):
                continue
    found: list[int] = []
    frontier = [root]
    while frontier:
        parent = frontier.pop()
        children = [pid for pid, ppid in parents.items() if ppid == parent]
        found += children
        frontier += children
    return found


def environments() -> dict[int, dict[str, str]]:
    """The environment of every process under this one.

    Returns:
        Per pid, its variables.
    """
    found: dict[int, dict[str, str]] = {}
    for pid in descendants(os.getpid()):
        try:
            raw = (Path("/proc") / str(pid) / "environ").read_bytes()
        except OSError:
            continue
        pairs = [item.split(b"=", 1) for item in raw.split(b"\0") if b"=" in item]
        found[pid] = {
            k.decode(errors="replace"): v.decode(errors="replace") for k, v in pairs
        }
    return found
