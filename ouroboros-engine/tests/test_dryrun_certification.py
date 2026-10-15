"""The dry-run certification suite: the guard matrix and its own negative control (CD.6, #564).

``test_dryrun_guards.py`` holds the tool boundary to its guarantee one sentence at a time.
This file certifies it as a *matrix*, driven through the real harness:

* every capability the issue promises is absent has rows — an attempt a model might make, the
  guard that must refuse it, and the stage that makes it — and one check, :func:`certify`,
  that the attempt was blocked, audited, failed the run and left nothing behind;
* every tool that *does* exist is probed through the harness and held to the effect its
  :class:`~ouroboros_engine.dryrun.tools.ToolSpec` declares;
* the registries are swept: a new guard, capability, effect or tool with no row is red;
* **the suite proves itself.** Each guard of :data:`~ouroboros_engine.dryrun.guard.GUARDS` is
  switched off in turn and the matrix's own check must then fail for exactly that guard's
  rows.

The rest certifies what the harness hands back: the estimator's answer passed on untouched
(the arithmetic is ``ouroboros-rest``'s, CD.3), the rendered diff equal to the overlay, the
git host only ever read, and every cut flagged at its real limit.
"""

from __future__ import annotations

import ast
import inspect
import json
import re
import shutil
import subprocess
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib import error as urllib_error
from urllib import request as urllib_request
from urllib.parse import unquote, urlsplit

import pytest

from dryrun_fakes import (
    ARBITRATION,
    DRY_RUN,
    FILES,
    PATCHED,
    SHA,
    SLUG,
    TOKEN,
    Bench,
    RecordedEstimates,
    RecordingReader,
    ScriptedModel,
    happy,
    result,
    tool,
)
from ouroboros_engine.dryrun import estimates as estimates_module
from ouroboros_engine.dryrun import guard, tools, workspace
from ouroboros_engine.dryrun.contract import (
    MAX_ARTIFACT_BYTES,
    DryRunResult,
    GuardBlocked,
)
from ouroboros_engine.dryrun.describe import describe_harness
from ouroboros_engine.dryrun.estimates import EstimateUnavailableError, ReplayedStage
from ouroboros_engine.dryrun.guard import ALLOW_LIST, WORKSPACE_BOUNDARY, GuardAudit
from ouroboros_engine.dryrun.harness import MAX_CONTEXT_DIFF
from ouroboros_engine.dryrun.model import StageCall
from ouroboros_engine.dryrun.tools import MAX_READ_CHARS, ToolSet, ToolSpec
from ouroboros_engine.dryrun.workspace import (
    GithubReader,
    ReadCache,
    VirtualWorkspace,
)

# -- the matrix ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Row:
    """One forbidden attempt, and what must stop it.

    Attributes:
        promise: The capability as the issue words it.
        capability: Its key in :data:`~ouroboros_engine.dryrun.guard.FORBIDDEN_CAPABILITIES`.
        guard: The guard that must refuse the attempt.
        stage: The model stage that makes it.
        tool: The tool the model names.
        arguments: What it calls the tool with.
    """

    promise: str
    capability: str
    guard: str
    stage: str
    tool: str
    arguments: dict[str, Any] = field(default_factory=dict)

    @property
    def label(self) -> str:
        """The row's test id."""
        return f"{self.promise}:{self.tool}@{self.stage}"


#: What #564 says a dry run must not be able to do, in its words.
PROMISED: tuple[str, ...] = (
    "repository write",
    "farm dispatch",
    "PR create",
    "merge",
    "ticket-source SPI write",
    "network egress",
    "credential access beyond scope",
)

#: The matrix. The first seven promises are the issue's; ``shell`` is the catalogue's own.
ROWS: tuple[Row, ...] = (
    # -- repository write: by a tool that would write, or by a path that leaves the tree
    Row("repository write", "repository_write", ALLOW_LIST, "implement", "git_push"),
    Row(
        "repository write",
        "repository_write",
        ALLOW_LIST,
        "implement",
        "write_file",
        {"path": ARBITRATION, "content": "pwned\n"},
    ),
    Row(
        "repository write",
        "repository_write",
        ALLOW_LIST,
        "review-primary",
        "apply_patch",
        {"patch": "--- a/x\n+++ b/x\n"},
    ),
    Row(
        "repository write",
        "repository_write",
        WORKSPACE_BOUNDARY,
        "implement",
        "edit_file",
        {"path": "../outside/repo.c", "content": "pwned\n"},
    ),
    Row(
        "repository write",
        "repository_write",
        WORKSPACE_BOUNDARY,
        "plan",
        "edit_file",
        {"path": "/etc/cron.d/dry-run", "content": "* * * * * root true\n"},
    ),
    Row(
        "repository write",
        "repository_write",
        WORKSPACE_BOUNDARY,
        "review-second",
        "edit_file",
        {"path": "drivers/../../sibling/README.md", "delete": True},
    ),
    # -- farm dispatch
    Row("farm dispatch", "farm_dispatch", ALLOW_LIST, "implement", "dispatch_build"),
    Row(
        "farm dispatch",
        "farm_dispatch",
        ALLOW_LIST,
        "analyze",
        "farm_submit",
        {"pool": "pool-a", "command": "west build"},
    ),
    # -- PR create
    Row(
        "PR create",
        "pull_request",
        ALLOW_LIST,
        "implement",
        "open_pr",
        {"title": "Back off before retrying"},
    ),
    Row("PR create", "pull_request", ALLOW_LIST, "plan", "create_pull_request"),
    # -- merge
    Row("merge", "pull_request", ALLOW_LIST, "review-primary", "merge_pr"),
    Row(
        "merge",
        "pull_request",
        ALLOW_LIST,
        "review-second",
        "merge_pull_request",
        {"method": "squash"},
    ),
    Row("merge", "pull_request", ALLOW_LIST, "review-primary", "approve_pr"),
    # -- ticket-source SPI write
    Row(
        "ticket-source SPI write",
        "ticket_source_write",
        ALLOW_LIST,
        "analyze",
        "comment_issue",
        {"issue": "#489", "body": "On it."},
    ),
    Row(
        "ticket-source SPI write",
        "ticket_source_write",
        ALLOW_LIST,
        "plan",
        "create_issue",
    ),
    Row(
        "ticket-source SPI write",
        "ticket_source_write",
        ALLOW_LIST,
        "review-second",
        "close_issue",
    ),
    # -- network egress: by a tool that would fetch, or by a URL passed off as a path
    Row(
        "network egress",
        "network_egress",
        ALLOW_LIST,
        "analyze",
        "fetch_url",
        {"url": "https://evil.example/exfil"},
    ),
    Row("network egress", "network_egress", ALLOW_LIST, "implement", "http_request"),
    Row(
        "network egress",
        "network_egress",
        WORKSPACE_BOUNDARY,
        "analyze",
        "read_file",
        {"path": "https://evil.example/exfil"},
    ),
    Row(
        "network egress",
        "network_egress",
        WORKSPACE_BOUNDARY,
        "plan",
        "search",
        {"query": "token", "path": "//evil.example/share"},
    ),
    # -- credential access beyond scope: by a tool, or by reading outside the repository
    Row(
        "credential access beyond scope",
        "credential_access",
        ALLOW_LIST,
        "implement",
        "read_secret",
        {"secret": "GITHUB_TOKEN"},
    ),
    Row(
        "credential access beyond scope",
        "credential_access",
        ALLOW_LIST,
        "analyze",
        "lease_credential",
    ),
    Row(
        "credential access beyond scope",
        "credential_access",
        WORKSPACE_BOUNDARY,
        "analyze",
        "read_file",
        {"path": "/proc/self/environ"},
    ),
    Row(
        "credential access beyond scope",
        "credential_access",
        WORKSPACE_BOUNDARY,
        "review-primary",
        "read_file",
        {"path": "../../.env"},
    ),
    Row(
        "credential access beyond scope",
        "credential_access",
        WORKSPACE_BOUNDARY,
        "implement",
        "list_dir",
        {"path": "../../.ssh"},
    ),
    # -- shell: not one of the issue's seven, but the catalogue promises it too
    Row(
        "shell",
        "shell",
        ALLOW_LIST,
        "implement",
        "run_shell",
        {"command": "git push origin HEAD"},
    ),
    Row("shell", "shell", ALLOW_LIST, "analyze", "bash", {"command": "env"}),
)

#: Every name the catalogue lists, swept through the harness one stage after another.
CATALOGUED: tuple[Row, ...] = tuple(
    Row("catalogue", capability, ALLOW_LIST, list(happy())[index % len(happy())], name)
    for index, (capability, name) in enumerate(
        (capability, name)
        for capability, names in guard.FORBIDDEN_CAPABILITIES.items()
        for name in names
    )
)


def _run(script: dict[str, list[Any]] | None = None, **bench: Any) -> Bench:
    """Run the seeded dry run over fresh fakes and keep its events and result on the bench."""
    made = Bench(model=ScriptedModel(script or happy()), **bench)
    made.events, made.done = made.run()
    return made


def certify(row: Row) -> None:
    """Hold one row of the matrix: the attempt is refused, audited, and leaves nothing.

    The offending call is the stage's first turn; the stage then goes on as the seeded run
    does, so everything the run produced can be compared with a run that never tried.

    Args:
        row: The attempt.

    Raises:
        AssertionError: When the attempt was not blocked by the row's guard, was not recorded
            in the audit, did not fail the run, or changed anything a clean run does not.
    """
    clean = _run()
    script = happy()
    script[row.stage] = [tool(row.tool, **row.arguments), *script[row.stage]]
    tried = _run(script)
    done: DryRunResult = tried.done

    # Blocked, as it happened…
    assert [
        (event.guard, event.call, event.stage_key)
        for event in tried.events
        if isinstance(event, GuardBlocked)
    ] == [(row.guard, row.tool, row.stage)], f"{row.label} was not blocked"
    # …recorded in the audit…
    assert [
        (entry.guard, entry.call, entry.count, entry.stage_key)
        for entry in done.guard_audit
    ] == [(row.guard, row.tool, 1, row.stage)], f"{row.label} was not audited"
    # …and the run it happened in is not trusted.
    assert done.guards_clean is False, f"{row.label} left the audit clean"
    assert done.status == "failed", f"{row.label} did not fail the run"
    assert done.failure_reason is not None
    assert done.failure_reason.startswith("the tool boundary refused 1 call; ")
    # The model was told, not humoured.
    retry = [call for call in tried.model.calls if call.stage_key == row.stage][1]
    assert retry.messages[-1]["content"].startswith(f"[{row.tool}] refused\n")
    # Nothing was read, estimated, drafted or sent on the attempt's behalf.
    assert tried.reader.files == FILES
    assert tried.reader.calls == clean.reader.calls, f"{row.label} reached the reader"
    assert tried.estimates.asked == clean.estimates.asked
    assert done.artifacts == clean.done.artifacts, f"{row.label} changed the overlay"
    assert [(r.stage_key, r.verdict, r.how) for r in done.stages] == [
        (r.stage_key, r.verdict, r.how) for r in clean.done.stages
    ]


@pytest.mark.parametrize("row", ROWS, ids=lambda row: row.label)
def test_a_forbidden_attempt_is_blocked_audited_and_leaves_nothing(row: Row) -> None:
    """Every row of the matrix holds against the real harness."""
    certify(row)


@pytest.mark.parametrize("row", CATALOGUED, ids=lambda row: row.label)
def test_every_catalogued_name_is_blocked_in_a_real_run(row: Row) -> None:
    """Every tool name the catalogue lists is refused when a stage of a real run calls it."""
    certify(row)


def test_the_seeded_run_is_the_matrixs_clean_baseline() -> None:
    """The run every row is compared with is complete, with an empty audit."""
    clean = _run()

    assert (clean.done.status, clean.done.guard_audit, clean.done.guards_clean) == (
        "complete",
        [],
        True,
    )
    assert not [event for event in clean.events if isinstance(event, GuardBlocked)]


# -- what exists is held to the effect it declares ----------------------------------------

#: A legitimate call of every tool on the allow-list.
PROBES: dict[str, dict[str, Any]] = {
    "read_file": {"path": "drivers/can/can.h"},
    "list_dir": {"path": "drivers/can"},
    "search": {"query": "LOSTARB"},
    "edit_file": {"path": "docs/backoff.md", "content": "# Backoff\n"},
    "build": {},
    "run_tests": {},
}

#: The stage that makes the probe: one that otherwise calls no tool at all.
PROBE_STAGE = "plan"


def _drafted(bench: Bench) -> list[str]:
    """The paths a run's diff artifact changes."""
    diff = next(a for a in bench.done.artifacts if a.kind == "overlay_diff")
    return [change.path for change in diff.path_summary]


def _read_effect(spec: ToolSpec, probed: Bench, clean: Bench) -> None:
    """A read leaves no trace: the overlay and the estimator are as a clean run left them."""
    assert _drafted(probed) == [ARBITRATION], f"{spec.name} drafted a change"
    assert probed.done.artifacts == clean.done.artifacts, (
        f"{spec.name} drafted a change"
    )
    assert probed.estimates.asked == clean.estimates.asked


def _simulated_write_effect(spec: ToolSpec, probed: Bench, clean: Bench) -> None:
    """A simulated write lands in the diff artifact, and nowhere else."""
    path = PROBES[spec.name]["path"]
    diff = next(a for a in probed.done.artifacts if a.kind == "overlay_diff")

    assert f"+++ b/{path}\n" in diff.content
    assert _drafted(clean) == [ARBITRATION]
    assert _drafted(probed) == sorted([ARBITRATION, path])
    assert path not in probed.reader.files
    assert probed.estimates.asked == clean.estimates.asked


def _replay_effect(spec: ToolSpec, probed: Bench, clean: Bench) -> None:
    """A replay asks the estimator once, and builds, tests and drafts nothing."""
    kind = {"build": "build", "run_tests": "test"}[spec.name]
    extra = Counter(probed.estimates.asked) - Counter(clean.estimates.asked)

    assert extra == Counter({(DRY_RUN, kind, None, None): 1})
    assert _drafted(probed) == [ARBITRATION], f"{spec.name} drafted a change"
    assert probed.done.artifacts == clean.done.artifacts
    assert probed.reader.calls == clean.reader.calls


#: What each effect a tool may declare is allowed to leave behind.
EFFECTS: dict[str, Callable[[ToolSpec, Bench, Bench], None]] = {
    "read": _read_effect,
    "simulated_write": _simulated_write_effect,
    "replay": _replay_effect,
}


def contained(spec: ToolSpec) -> None:
    """Hold one tool to its declared effect, through the harness.

    Args:
        spec: The tool.

    Raises:
        AssertionError: When calling it tripped a guard, touched the repository, or left
            behind anything its ``effect`` does not allow.
    """
    clean = _run()
    script = happy()
    script[PROBE_STAGE] = [
        tool(spec.name, **PROBES[spec.name]),
        *script[PROBE_STAGE],
    ]
    probed = _run(script)

    assert (probed.done.status, probed.done.guard_audit) == ("complete", [])
    after = [call for call in probed.model.calls if call.stage_key == PROBE_STAGE][1]
    assert after.messages[-1]["content"].startswith(f"[{spec.name}] ok\n")
    # Whatever the effect, the repository is only ever read and holds what it held.
    assert probed.reader.files == FILES, f"{spec.name} wrote to the repository"
    assert {kind for kind, _ in probed.reader.calls} <= {"tree", "blob"}
    EFFECTS[spec.effect](spec, probed, clean)


@pytest.mark.parametrize("spec", tools.TOOL_SPECS, ids=lambda spec: spec.name)
def test_every_tool_does_only_what_its_effect_declares(spec: ToolSpec) -> None:
    """Each tool of the registry, called in a real run, stays inside its declared effect."""
    contained(spec)


def test_no_tool_has_an_effect_that_reaches_outside_the_process() -> None:
    """The registry and the harness description name no effect but the three contained ones."""
    described = describe_harness()

    assert {spec.effect for spec in tools.TOOL_SPECS} == set(EFFECTS)
    assert [(t.name, t.effect) for t in described.tools] == [
        (spec.name, spec.effect) for spec in tools.TOOL_SPECS
    ]
    assert (described.writes, described.reads) == (
        "memory_overlay",
        "provider_api_at_pinned_sha",
    )
    # A capability the description forbids is, by construction, no tool it offers.
    forbidden = {n for names in guard.FORBIDDEN_CAPABILITIES.values() for n in names}
    assert not forbidden & {t.name for t in described.tools}
    assert described.forbidden_capabilities == list(guard.FORBIDDEN_CAPABILITIES)
    assert [g.name for g in described.guards] == list(guard.GUARDS)


def test_the_terminal_is_described_and_never_performed() -> None:
    """Opening or merging a PR is a row a dry run never reaches, not an action it takes."""
    clean = _run()
    terminal = clean.done.stages[-1]

    assert (terminal.stage_key, terminal.verdict, terminal.how) == (
        "open-pr",
        "not_reached",
        "deterministic",
    )
    assert "open-pr" not in clean.model.stages_called()
    assert terminal.metrics == {}


def test_the_read_token_reaches_the_reader_and_nothing_else() -> None:
    """The one credential of a dry run is never shown to a model or written to the stream."""
    clean = _run()
    seen_by_models = json.dumps(
        [[call.system, call.alias, *call.messages] for call in clean.model.calls]
    )
    streamed = json.dumps([event.model_dump(mode="json") for event in clean.events])

    assert TOKEN not in seen_by_models
    assert TOKEN not in streamed
    assert TOKEN not in repr(clean.repositories)
    # It is scoped to the one repository the run reads.
    assert [(r.slug, r.token) for r in clean.repositories] == [(SLUG, TOKEN)]


# -- completeness: a registry entry with no row is red ------------------------------------


def uncovered() -> list[str]:
    """Name everything in the product's registries that this suite has no row for.

    Returns:
        One line per guard, forbidden capability, tool effect, tool, promise or model stage
        the matrix does not exercise; empty when the matrix is complete.
    """
    missing = [
        f"guard {name}"
        for name in guard.GUARDS
        if name not in {row.guard for row in ROWS} or name not in DISABLED
    ]
    missing += [
        f"capability {name}"
        for name in guard.FORBIDDEN_CAPABILITIES
        if name not in {row.capability for row in ROWS}
    ]
    missing += [
        f"effect {effect}"
        for effect in sorted({spec.effect for spec in tools.TOOL_SPECS})
        if effect not in EFFECTS
    ]
    missing += [
        f"tool {spec.name}" for spec in tools.TOOL_SPECS if spec.name not in PROBES
    ]
    missing += [
        f"promise {promise}"
        for promise in PROMISED
        if promise not in {row.promise for row in ROWS}
    ]
    missing += [
        f"stage {stage}"
        for stage in happy()
        if stage not in {row.stage for row in ROWS}
    ]
    return missing


def test_every_guard_capability_effect_and_tool_has_a_row() -> None:
    """Nothing in the guard, capability or tool registries is left out of the matrix."""
    assert uncovered() == []
    # Rows name real registry entries: a renamed guard cannot leave a row pointing nowhere.
    assert {row.guard for row in ROWS} == set(guard.GUARDS)
    assert {row.capability for row in ROWS} == set(guard.FORBIDDEN_CAPABILITIES)
    assert set(PROBES) == set(guard.ALLOWED_TOOLS)


def test_a_new_guard_without_a_row_is_caught(monkeypatch: pytest.MonkeyPatch) -> None:
    """Registering a guard the matrix does not exercise turns the completeness check red."""
    monkeypatch.setitem(guard.GUARDS, "egress_filter", "Refuses a socket.")

    assert uncovered() == ["guard egress_filter"]


def test_a_new_capability_without_a_row_is_caught(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Promising a capability absent without a row for it turns the check red."""
    monkeypatch.setitem(guard.FORBIDDEN_CAPABILITIES, "deploy", ("deploy_release",))

    assert uncovered() == ["capability deploy"]


def test_a_new_tool_or_effect_without_a_row_is_caught(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A tool nobody probes, or an effect nobody holds, turns the check red."""
    dispatch = ToolSpec("dispatch", {}, "Run the build on the farm.", effect="farm")  # type: ignore[arg-type]
    monkeypatch.setattr(tools, "TOOL_SPECS", (*tools.TOOL_SPECS, dispatch))

    assert uncovered() == ["effect farm", "tool dispatch"]


# -- the negative control: switch a guard off, and its rows go red ------------------------


class _AnyHandler(dict):
    """A dispatch table with a handler for every name — the allow-list's second lock, gone."""

    def __contains__(self, name: object) -> bool:
        """Every name has a handler."""
        return True

    def __missing__(self, name: str) -> Callable[[dict[str, Any]], str]:
        """Answer an unlisted name as if a tool had run."""
        return lambda _arguments: f"{name} ran"


def _open_the_allow_list(monkeypatch: pytest.MonkeyPatch) -> None:
    """Remove the allow-list's first lock: every name is allowed."""
    monkeypatch.setattr(tools, "is_allowed", lambda _name: True)


def _open_the_dispatch_table(monkeypatch: pytest.MonkeyPatch) -> None:
    """Remove the allow-list's second lock: every name dispatches."""
    original = ToolSet.__init__

    def permissive(self: ToolSet, *args: Any, **kwargs: Any) -> None:
        original(self, *args, **kwargs)
        self._handlers = _AnyHandler(self._handlers)

    monkeypatch.setattr(ToolSet, "__init__", permissive)


def _without_the_allow_list(monkeypatch: pytest.MonkeyPatch) -> None:
    """Switch the allow-list off: both of its locks."""
    _open_the_allow_list(monkeypatch)
    _open_the_dispatch_table(monkeypatch)


def _without_the_workspace_boundary(monkeypatch: pytest.MonkeyPatch) -> None:
    """Switch the path check off: any string is a path."""
    monkeypatch.setattr(workspace, "_checked", lambda path: path)


#: How to switch each guard off. A guard with no entry here fails the completeness test.
DISABLED: dict[str, Callable[[pytest.MonkeyPatch], None]] = {
    ALLOW_LIST: _without_the_allow_list,
    WORKSPACE_BOUNDARY: _without_the_workspace_boundary,
}


@pytest.mark.parametrize("name", list(guard.GUARDS))
def test_removing_a_guard_turns_its_rows_red_and_only_its_rows(
    name: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """With one guard switched off, the matrix's own check fails for each of its rows."""
    DISABLED[name](monkeypatch)

    for row in ROWS:
        if row.guard == name:
            with pytest.raises(AssertionError):
                certify(row)
        else:
            certify(row)


@pytest.mark.parametrize("name", list(guard.GUARDS))
def test_every_guard_has_rows_for_its_removal_to_turn_red(name: str) -> None:
    """The negative control is never vacuous: each guard guards at least two rows."""
    assert len([row for row in ROWS if row.guard == name]) >= 2


@pytest.mark.parametrize("lock", [_open_the_allow_list, _open_the_dispatch_table])
def test_either_lock_of_the_allow_list_holds_alone(
    lock: Callable[[pytest.MonkeyPatch], None], monkeypatch: pytest.MonkeyPatch
) -> None:
    """Removing one of the allow-list's two locks blocks every row all the same."""
    lock(monkeypatch)

    for row in ROWS:
        certify(row)


def test_a_run_that_stopped_failing_on_its_audit_turns_every_row_red(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A harness that reports a blocked run as trustworthy fails the whole matrix."""
    monkeypatch.setattr(GuardAudit, "clean", property(lambda _self: True))

    for row in ROWS:
        with pytest.raises(AssertionError):
            certify(row)


def test_a_read_tool_that_drafts_a_change_is_caught(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A tool whose declared effect is a lie fails its own containment check."""
    original = ToolSet._read_file

    def leaky(self: ToolSet, arguments: dict[str, Any]) -> str:
        self._workspace.write("leak.txt", "read\n")
        return original(self, arguments)

    monkeypatch.setattr(ToolSet, "_read_file", leaky)

    with pytest.raises(AssertionError):
        contained(next(s for s in tools.TOOL_SPECS if s.name == "read_file"))


def test_a_simulated_write_that_reaches_the_repository_is_caught(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An overlay that flushed to its reader fails the write tool's containment check."""
    original = VirtualWorkspace.write

    def flushing(self: VirtualWorkspace, path: str, content: str) -> None:
        original(self, path, content)
        self._reader.files[path] = content  # type: ignore[attr-defined]

    monkeypatch.setattr(VirtualWorkspace, "write", flushing)

    with pytest.raises(AssertionError):
        contained(next(s for s in tools.TOOL_SPECS if s.name == "edit_file"))


def test_a_replay_that_answers_without_history_is_caught(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A build tool that makes its own figure up fails the replay containment check."""
    monkeypatch.setattr(
        ToolSet, "_replay", lambda _self, _kind: "Replayed from history: est. 1m 00s"
    )

    with pytest.raises(AssertionError):
        contained(next(s for s in tools.TOOL_SPECS if s.name == "build"))


# -- the estimator's answer is passed on, never computed ----------------------------------


class FixedEstimates(RecordedEstimates):
    """An estimator that answers every question with one recorded answer."""

    def __init__(self, answer: ReplayedStage) -> None:
        """Hold the answer."""
        super().__init__()
        self.answer = answer

    def estimate(
        self,
        dry_run: str,
        kind: estimates_module.InfraKind,
        *,
        runner_pool: str | None,
        command: str | None,
    ) -> ReplayedStage:
        """Answer with the recorded answer, and remember the question."""
        self.asked.append((dry_run, kind, runner_pool, command))
        return self.answer


#: Answers as ``ouroboros-rest``'s estimator (CD.3, #561) gives them. Its formula's inputs
#: and outputs are opaque here: the engine is certified on carrying them, not on the sums.
ANSWERS: dict[str, ReplayedStage] = {
    "a healthy sample": ReplayedStage(
        note="est. 4m 02s (214 similar builds, +/-20s)",
        metrics={
            "estimate_ms": 242000,
            "spread_ms": 20000,
            "sample_count": 214,
            "similarity_class": "pool-a / helios-firmware",
            "window_days": 30,
        },
    ),
    "a sample below the floor": ReplayedStage(
        note="insufficient history (3 similar builds found)",
        metrics={
            "insufficient_history": True,
            "sample_count": 3,
            "similarity_class": "pool-a / helios-firmware",
            "window_days": 30,
        },
    ),
    "fields this build has never heard of": ReplayedStage(
        note="est. 0m 41s (12 similar builds, +/-3s)",
        metrics={
            "estimate_ms": 41000,
            "spread_ms": 3000,
            "sample_count": 12,
            "formula": {"id": "replay-median", "version": 2},
            "quantiles": [38000.5, 41000, 47000],
        },
    ),
}


@pytest.mark.parametrize("name", list(ANSWERS))
def test_an_estimate_is_recorded_exactly_as_the_estimator_gave_it(name: str) -> None:
    """The row of a replayed stage is the estimator's note and metrics, unchanged."""
    answer = ANSWERS[name]
    given = json.dumps(answer.metrics, sort_keys=True)
    first = _run(estimates=FixedEstimates(answer))
    second = _run(estimates=FixedEstimates(answer))

    for bench in (first, second):
        for key in ("build", "test"):
            row = next(r for r in bench.done.stages if r.stage_key == key)
            assert (row.verdict, row.how, row.note) == ("ok", "replayed", answer.note)
            assert json.dumps(row.metrics, sort_keys=True) == given
    assert first.done.stages == second.done.stages
    assert json.dumps(answer.metrics, sort_keys=True) == given


def test_a_sample_below_the_floor_gains_no_number_on_the_way_through() -> None:
    """Insufficient history reaches the row and the model with no estimate attached."""
    answer = ANSWERS["a sample below the floor"]
    told: list[str] = []

    def after(call: StageCall) -> str:
        told.append(call.messages[-1]["content"])
        return result(summary="Drafted.")

    script = happy()
    script["implement"] = [tool("build") + "\n" + tool("run_tests"), after]
    bench = _run(script, estimates=FixedEstimates(answer))

    for key in ("build", "test"):
        row = next(r for r in bench.done.stages if r.stage_key == key)
        assert "estimate_ms" not in row.metrics and "spread_ms" not in row.metrics
    assert told == [
        f"[build] ok\nReplayed from history, nothing was run: {answer.note}\n\n"
        f"[run_tests] ok\nReplayed from history, nothing was run: {answer.note}"
    ]


@pytest.mark.parametrize(
    "code", ["estimator_unreachable", "estimator_contract", "replay_pool_required"]
)
def test_an_estimator_that_fails_leaves_a_row_with_no_figure_at_all(code: str) -> None:
    """A failed estimate is a failed row with empty metrics, and a tool that says so."""
    failing = RecordedEstimates()
    failing.fail = EstimateUnavailableError(code, "no answer")
    told: list[str] = []

    def after(call: StageCall) -> str:
        told.append(call.messages[-1]["content"])
        return result(summary="Drafted.")

    script = happy()
    script["implement"] = [tool("build"), after]
    bench = _run(script, estimates=failing)
    build = next(r for r in bench.done.stages if r.stage_key == "build")

    assert told == [f"[build] refused\nNo estimate is available ({code})."]
    assert (build.verdict, build.how, build.metrics) == ("failed", "deterministic", {})
    assert build.note == f"no replay estimate: {code}"
    assert not any(character.isdigit() for character in build.note)
    assert bench.done.status == "failed"


def test_the_engine_holds_no_estimate_arithmetic_of_its_own() -> None:
    """``estimates.py`` relays: no statistics, no aggregation, no arithmetic on a sample."""
    tree = ast.parse(inspect.getsource(estimates_module))
    imported = {
        (node.module or "").split(".")[0]
        for node in ast.walk(tree)
        if isinstance(node, ast.ImportFrom)
    } | {
        alias.name.split(".")[0]
        for node in ast.walk(tree)
        if isinstance(node, ast.Import)
        for alias in node.names
    }
    called = {
        node.func.id
        for node in ast.walk(tree)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
    }
    arithmetic = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.BinOp)
        and isinstance(node.op, ast.Sub | ast.Mult | ast.Div | ast.FloorDiv | ast.Mod)
    ]

    assert not imported & {"statistics", "math", "numpy", "decimal", "fractions"}
    assert not called & {"sum", "sorted", "min", "max", "round", "abs", "len"}
    assert arithmetic == []


# -- overlay fidelity: the rendered diff is the overlay -----------------------------------

_HUNK = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@$")

#: The marker after a line whose file does not end in a newline, as ``git diff`` writes it.
_NO_NEWLINE = "\\ No newline at end of file"


def _lines(text: str) -> list[str]:
    r"""Split text into its lines at ``\n`` only, each keeping its line end.

    The last line keeps none when the file does not end in a newline, and a lone ``\r`` stays
    inside its line — so ``"".join(_lines(text)) == text`` for every text, empty included.
    """
    return re.findall(r"[^\n]*\n|[^\n]+\Z", text)


def apply_unified(
    diff: str, base: dict[str, str]
) -> tuple[dict[str, str], dict[str, tuple[int, int]]]:
    r"""Apply a unified diff to a set of files, strictly and byte for byte.

    Every context line and every removed line must be exactly what the base holds at the
    place the hunk names — its line end included, so a line the diff marks
    ``\ No newline at end of file`` must really have none — and every hunk must be as long
    as its header says: a diff that does not describe the base is refused rather than
    applied loosely. Every file opens with ``diff --git``; a created or deleted one says so
    (``new file mode`` / ``deleted file mode``), and only such a file, created or deleted
    empty, may have no hunk.

    Args:
        diff: The diff, as :meth:`VirtualWorkspace.diff` renders it.
        base: The files it is against, by path.

    Returns:
        The files after the diff, and ``(added, removed)`` line counts per file it names.

    Raises:
        AssertionError: When the diff is malformed or does not match the base.
    """
    state = dict(base)
    counts: dict[str, tuple[int, int]] = {}
    rows = diff.split("\n")
    assert rows.pop() == "", "a diff ends at a line end"
    at = 0
    while at < len(rows):
        # git's header: every file opens with one, and a creation or deletion says so.
        assert rows[at].startswith("diff --git a/"), "a file opens with diff --git"
        named = rows[at][len("diff --git a/") :].split(" b/")[0]
        at += 1
        extended = None
        if rows[at] in ("new file mode 100644", "deleted file mode 100644"):
            extended = rows[at]
            at += 1
        assert rows[at].startswith("--- ") and rows[at + 1].startswith("+++ ")
        source, target = rows[at][4:], rows[at + 1][4:]
        at += 2
        path = (target if target != "/dev/null" else source)[2:]
        assert path == named, f"{path} is announced as {named}"
        assert (extended == "new file mode 100644") == (source == "/dev/null")
        assert (extended == "deleted file mode 100644") == (target == "/dev/null")
        assert source == (f"a/{path}" if path in base else "/dev/null")
        assert target in (f"b/{path}", "/dev/null")
        assert path not in counts, f"{path} appears twice"
        before = _lines(base.get(path, ""))
        after: list[str] = []
        cursor = added = removed = 0
        if at >= len(rows) or not _HUNK.match(rows[at]):
            # No hunk: an empty file appearing or disappearing, and nothing else.
            assert extended is not None, f"{path} has no hunk"
            assert before == [], f"{path} is deleted with lines the diff does not show"
        while at < len(rows) and (header := _HUNK.match(rows[at])) is not None:
            at += 1
            old_left = 1 if header[2] is None else int(header[2])
            new_left = 1 if header[4] is None else int(header[4])
            start = int(header[1]) - 1 if old_left else int(header[1])
            assert cursor <= start <= len(before), "hunks overlap or overrun"
            after += before[cursor:start]
            cursor = start
            assert len(after) == (int(header[3]) - 1 if new_left else int(header[3]))
            while old_left or new_left:
                mark, text = rows[at][:1], rows[at][1:]
                at += 1
                ending = "\n"
                if at < len(rows) and rows[at] == _NO_NEWLINE:
                    ending = ""
                    at += 1
                line = text + ending
                if mark in (" ", "-"):
                    assert before[cursor] == line, f"{path}:{cursor + 1} differs"
                    cursor += 1
                    old_left -= 1
                if mark in (" ", "+"):
                    after.append(line)
                    new_left -= 1
                assert mark in (" ", "-", "+") and old_left >= 0 and new_left >= 0
                added += mark == "+"
                removed += mark == "-"
        after += before[cursor:]
        if target == "/dev/null":
            assert after == [], f"{path} is deleted but lines remain"
            del state[path]
        else:
            state[path] = "".join(after)
        counts[path] = (added, removed)
    return state, counts


#: A file long enough for two changes to land in two hunks.
LONG = "".join(f"line {number}\n" for number in range(1, 41))
TWO_HUNKS = LONG.replace("line 3\n", "line three\n").replace("line 37\n", "")

#: A file the pinned commit holds empty.
EMPTY = "docs/empty.txt"

#: A file whose last line has no newline.
UNTERMINATED = "docs/unterminated.txt"

#: Shapes of a stage's drafting: ``(path, content)`` writes a file, ``(path,)`` deletes it.
SHAPES: dict[str, list[tuple[str, ...]]] = {
    "a new file": [("docs/backoff.md", "# Backoff\n\nExponential, capped.\n")],
    "an edit": [(ARBITRATION, PATCHED)],
    "a deletion": [("README.md",)],
    "an edit in two hunks": [("docs/long.txt", TWO_HUNKS)],
    "several files at once": [
        (ARBITRATION, PATCHED),
        ("drivers/can/backoff.h", "#define CAN_ARB_BACKOFF_MAX_US 800\n"),
        ("README.md",),
        (
            "drivers/can/can.h",
            "#define CAN_ERR_LOSTARB 0x02\n#define CAN_ERR_ACK 0x04\n",
        ),
        ("docs/long.txt", TWO_HUNKS),
    ],
    "a file rewritten whole": [(ARBITRATION, "/* moved to backoff.c */\n")],
    "a draft that is edited again": [
        ("docs/backoff.md", "# Backoff\n"),
        (ARBITRATION, "first try\n"),
        ("docs/backoff.md", "# Backoff\n\nSecond thoughts.\n"),
        (ARBITRATION, PATCHED),
    ],
    "a new file that is dropped again": [
        ("scratch.txt", "never mind\n"),
        ("scratch.txt",),
        ("README.md", "# helios-firmware\n\nNow with backoff.\n"),
    ],
    "a write back to what the commit holds": [
        (ARBITRATION, PATCHED),
        (ARBITRATION, FILES[ARBITRATION]),
        ("drivers/can/Kconfig", 'config CAN\n\tbool "CAN bus (with backoff)"\n'),
    ],
    "lines that look like diff syntax": [
        ("docs/backoff.md", "--- a/not-a-header\n+++ b/nor-this\n@@ -1 +1 @@\n-- \n"),
        ("README.md", "# helios-firmware\n--- rule\n+++ plus\n"),
    ],
    # #1746: the four shapes the diff used to misstate.
    "a new file with no final newline": [("docs/note.txt", "first\nno newline")],
    "an edit to a file with no final newline": [(UNTERMINATED, "first\nchanged")],
    "adding only the final newline": [(UNTERMINATED, "first\nno newline\n")],
    "removing only the final newline": [("docs/long.txt", LONG[:-1])],
    "an empty new file": [("docs/empty-new.txt", "")],
    "deleting an empty file": [(EMPTY,)],
    "emptying a file": [("README.md", "")],
    "filling an empty file": [(EMPTY, "now there is something\n")],
    "a lone carriage return": [
        ("docs/cr.txt", "a\rb\n"),
        (UNTERMINATED, "first\rstill first\nno newline"),
    ],
    "every edge at once": [
        ("docs/empty-new.txt", ""),
        (EMPTY,),
        ("README.md", ""),
        (UNTERMINATED, "first\r\nno newline\n"),
        ("docs/long.txt", LONG + "tail"),
    ],
}

#: The repository the fidelity runs read: the seeded files, one long one, an empty one and
#: one that does not end in a newline.
REPOSITORY = {
    **FILES,
    "docs/long.txt": LONG,
    EMPTY: "",
    UNTERMINATED: "first\nno newline",
}


def faithful(ops: list[tuple[str, ...]]) -> None:
    """Hold one drafting to the guarantee: the diff a run renders *is* its overlay.

    The implementer makes the edits through ``edit_file`` in a real run. What the overlay
    must then hold is worked out here from the edits alone, and the run's diff artifact,
    applied to the pinned files, has to reproduce exactly that — and nothing has to have
    been written to the repository to get there.

    Args:
        ops: The edits, in order.

    Raises:
        AssertionError: When the diff applied to the base is not the overlay's contents.
    """
    expected = dict(REPOSITORY)
    for path, *content in ops:
        if content:
            expected[path] = content[0]
        else:
            del expected[path]
    script = happy()
    script["implement"] = [
        "\n".join(
            tool("edit_file", path=path, content=content[0])
            if content
            else tool("edit_file", path=path, delete=True)
            for path, *content in ops
        ),
        result(summary="Drafted."),
    ]
    bench = _run(script, reader=RecordingReader(REPOSITORY))
    diff = next(a for a in bench.done.artifacts if a.kind == "overlay_diff")

    assert bench.done.status == "complete"
    assert diff.truncated is False
    applied, counts = apply_unified(diff.content, REPOSITORY)
    assert applied == expected
    # The per-file summary beside the diff counts the same lines the diff shows.
    changed = sorted(
        path
        for path in expected.keys() | REPOSITORY.keys()
        if expected.get(path) != REPOSITORY.get(path)
    )
    assert list(counts) == changed
    assert [(c.path, (c.added, c.removed)) for c in diff.path_summary] == [
        (path, counts[path]) for path in changed
    ]
    # And the overlay stayed an overlay.
    assert bench.reader.files == REPOSITORY
    assert {kind for kind, _ in bench.reader.calls} <= {"tree", "blob"}


@pytest.mark.parametrize("shape", list(SHAPES))
def test_the_rendered_diff_applied_to_the_base_is_the_overlay(shape: str) -> None:
    """For each shape of drafting, applying the run's diff reproduces the overlay exactly."""
    faithful(SHAPES[shape])


#: The git executable, when the machine has one.
GIT = shutil.which("git")


@pytest.mark.skipif(GIT is None, reason="git is not installed")
@pytest.mark.parametrize("shape", list(SHAPES))
def test_git_applies_the_rendered_diff_to_the_base_as_the_overlay(
    shape: str, tmp_path: Path
) -> None:
    """``git apply`` itself, not only this file's applier, takes each diff to the overlay (#1746)."""
    space = VirtualWorkspace(RecordingReader(dict(REPOSITORY)), ReadCache(), SLUG, SHA)
    expected = dict(REPOSITORY)
    for path, *content in SHAPES[shape]:
        if content:
            space.write(path, content[0])
            expected[path] = content[0]
        else:
            space.delete(path)
            del expected[path]
    for path, text in REPOSITORY.items():
        (tmp_path / path).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / path).write_bytes(text.encode("utf-8"))

    applied = subprocess.run(  # noqa: S603 — a fixed binary and fixed arguments
        [str(GIT), "apply", "--whitespace=nowarn", "-"],
        cwd=tmp_path,
        input=space.diff().encode("utf-8"),
        capture_output=True,
        check=False,
    )

    assert applied.returncode == 0, applied.stderr.decode()
    assert {
        file.relative_to(tmp_path).as_posix(): file.read_bytes().decode("utf-8")
        for file in tmp_path.rglob("*")
        if file.is_file()
    } == expected


def test_every_splice_of_a_file_diffs_back_to_what_the_overlay_reads() -> None:
    """Every replacement of a run of lines round-trips through the diff, hunk maths included."""
    base = [f"line {number}" for number in range(1, 7)]
    text = "".join(line + "\n" for line in base)
    checked = 0
    for start in range(len(base) + 1):
        for stop in range(start, len(base) + 1):
            for new in ([], ["new a"], ["new a", "new b"]):
                after = base[:start] + new + base[stop:]
                if after == base or not after:
                    continue
                space = VirtualWorkspace(
                    RecordingReader({"f.txt": text, "other.txt": "kept\n"}),
                    ReadCache(),
                    SLUG,
                    SHA,
                )
                space.write("f.txt", "".join(line + "\n" for line in after))

                applied, _ = apply_unified(
                    space.diff(), {"f.txt": text, "other.txt": "kept\n"}
                )

                assert applied == {
                    "f.txt": space.read("f.txt"),
                    "other.txt": space.read("other.txt"),
                }
                checked += 1
    assert checked == 76


def test_a_diff_that_leaves_a_file_out_is_caught(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A renderer that drops part of the overlay fails the fidelity check."""
    original = VirtualWorkspace._changes
    monkeypatch.setattr(VirtualWorkspace, "_changes", lambda self: original(self)[:-1])

    with pytest.raises(AssertionError):
        faithful(SHAPES["several files at once"])


def test_a_diff_that_misstates_a_line_is_caught() -> None:
    """The applier refuses a diff whose context is not the base, and exposes a wrong line."""
    space = VirtualWorkspace(RecordingReader(), ReadCache(), SLUG, SHA)
    space.write(ARBITRATION, PATCHED)
    diff = space.diff()

    assert apply_unified(diff, FILES)[0][ARBITRATION] == PATCHED
    with pytest.raises(AssertionError):
        apply_unified(diff, {**FILES, ARBITRATION: "something else entirely\n"})
    tampered = diff.replace("+\t\tcan_retry_tx(dev, frame);\n", "+\t\treturn;\n")
    assert tampered != diff
    assert apply_unified(tampered, FILES)[0][ARBITRATION] != PATCHED


# -- the overlay is never flushed: the git host only ever sees reads ----------------------


class RecordingHost:
    """A git host behind ``urllib``'s opener: it serves the files and records every request."""

    def __init__(self) -> None:
        """Hold the seeded repository."""
        self.files = dict(FILES)
        self.requests: list[urllib_request.Request] = []

    def open(self, prepared: urllib_request.Request, timeout: float | None = None):  # noqa: ARG002 - urllib's signature
        """Record one request and answer it as GitHub's read API would."""
        self.requests.append(prepared)
        url = urlsplit(prepared.full_url)
        prefix = f"/repos/{SLUG}/contents/"
        if url.path == f"/repos/{SLUG}/git/trees/{SHA}":
            body = json.dumps(
                {
                    "truncated": False,
                    "tree": [
                        {"path": path, "type": "blob", "size": len(text.encode())}
                        for path, text in sorted(self.files.items())
                    ],
                }
            ).encode()
        elif url.path.startswith(prefix) and unquote(url.path[len(prefix) :]) in (
            self.files
        ):
            body = self.files[unquote(url.path[len(prefix) :])].encode()
        else:
            raise urllib_error.HTTPError(
                prepared.full_url,
                404,
                "Not Found",
                None,
                None,  # type: ignore[arg-type]
            )
        return _Answer(body)


class _Answer:
    """One response body, as ``urllib`` hands it over."""

    def __init__(self, body: bytes) -> None:
        """Hold the body."""
        self.body = body

    def read(self, _limit: int | None = None) -> bytes:
        """Read the body."""
        return self.body

    def __enter__(self) -> _Answer:
        """Open."""
        return self

    def __exit__(self, *_exc: object) -> bool:
        """Close."""
        return False


def test_a_run_that_writes_sends_the_git_host_nothing_but_reads() -> None:
    """Across a whole run that drafts, edits and deletes, every request is a GET of a read."""
    host = RecordingHost()
    reader = GithubReader("https://api.github.com", SLUG, SHA, TOKEN, opener=host)
    script = happy()
    script["implement"] = [
        tool("read_file", path=ARBITRATION),
        tool("edit_file", path=ARBITRATION, content=PATCHED)
        + "\n"
        + tool("edit_file", path="drivers/can/backoff.h", content="#define MAX 800\n")
        + "\n"
        + tool("edit_file", path="README.md", delete=True)
        + "\n"
        + tool("build"),
        result(summary="Drafted the backoff."),
    ]
    bench = _run(script, reader=reader)
    diff = next(a for a in bench.done.artifacts if a.kind == "overlay_diff")
    read_endpoint = re.compile(
        rf"^https://api\.github\.com/repos/{re.escape(SLUG)}/"
        rf"(?:git/trees/{SHA}\?recursive=1|contents/[^?]+\?ref={SHA})$"
    )

    # The run really did write — three files' worth — and finished clean.
    assert bench.done.status == "complete"
    assert [change.path for change in diff.path_summary] == [
        "README.md",
        ARBITRATION,
        "drivers/can/backoff.h",
    ]
    # Everything the host was sent: a GET, with no body, of the tree or a file at the pin.
    assert host.requests
    assert {sent.get_method() for sent in host.requests} == {GithubReader.METHOD}
    assert GithubReader.METHOD == "GET"
    assert all(sent.data is None for sent in host.requests)
    assert all(read_endpoint.match(sent.full_url) for sent in host.requests)
    assert bench.done.fetches == len(host.requests)
    # Nothing that was drafted is in anything that was sent, and the host holds what it held.
    sent_text = "".join(
        sent.full_url + json.dumps(sent.header_items()) for sent in host.requests
    )
    assert "backoff.h" not in sent_text
    assert host.files == FILES
    assert apply_unified(diff.content, FILES)[0] != FILES


# -- a cut is flagged, at the limit the product really has --------------------------------


def _diff_of(path: str, content: str) -> str:
    """Render the diff a workspace gives for one new file."""
    space = VirtualWorkspace(RecordingReader(), ReadCache(), SLUG, SHA)
    space.write(path, content)
    return space.diff()


def _new_file_whose_diff_is(path: str, size: int) -> str:
    """Compose a new file whose rendered diff is exactly ``size`` characters of ASCII."""
    line = "x" * 63 + "\n"
    content = line * (size // (len(line) + 1) - 2)
    padded = "y" * (size - len(_diff_of(path, content))) + content

    assert len(_diff_of(path, padded)) == size
    return padded


@pytest.mark.parametrize("over", [0, 1])
def test_the_diff_artifact_is_whole_at_its_bound_and_flagged_one_byte_past(
    over: int,
) -> None:
    """The artifact says ``truncated`` exactly when the diff exceeds the real byte bound."""
    content = _new_file_whose_diff_is("gen/table.c", MAX_ARTIFACT_BYTES + over)
    whole = _diff_of("gen/table.c", content)
    script = happy()
    script["implement"] = [
        tool("edit_file", path="gen/table.c", content=content),
        result(summary="Generated."),
    ]
    diff = next(a for a in _run(script).done.artifacts if a.kind == "overlay_diff")

    assert diff.original_bytes == len(whole.encode()) == MAX_ARTIFACT_BYTES + over
    assert diff.truncated is bool(over)
    assert (diff.content == whole) is not bool(over)
    # What is kept is the head of the real diff, cut where a line ends; the next line is
    # the one that did not fit, and the summary still counts the whole file.
    assert whole.startswith(diff.content) and diff.content.endswith("\n")
    dropped = whole[len(diff.content) :]
    if over:
        assert len(diff.content) + len(dropped.split("\n")[0]) + 1 > MAX_ARTIFACT_BYTES
    assert [(c.path, c.added, c.removed) for c in diff.path_summary] == [
        ("gen/table.c", content.count("\n"), 0)
    ]


@pytest.mark.parametrize("over", [0, 1])
def test_a_read_is_whole_at_its_bound_and_says_so_one_character_past(
    over: int,
) -> None:
    """A model reading a long file is told it was cut, and how long it really is."""
    text = "r" * (MAX_READ_CHARS + over)
    told: list[str] = []

    def after(call: StageCall) -> str:
        told.append(call.messages[-1]["content"])
        return result(summary="Read it.")

    script = happy()
    script["analyze"] = [tool("read_file", path="docs/long.log"), after]
    _run(script, reader=RecordingReader({**FILES, "docs/long.log": text}))
    flag = f"\n[cut: {len(text)} characters in all]" if over else ""

    assert told == [f"[read_file] ok\n{text[:MAX_READ_CHARS]}{flag}"]


@pytest.mark.parametrize("over", [0, 1])
def test_the_diff_shown_to_a_later_stage_says_when_it_was_cut(over: int) -> None:
    """A stage shown only the head of the diff so far is told to read the files."""
    content = _new_file_whose_diff_is("gen/table.c", MAX_CONTEXT_DIFF + over)
    whole = _diff_of("gen/table.c", content)
    script = happy()
    script["implement"] = [
        tool("edit_file", path="gen/table.c", content=content),
        result(summary="Generated."),
    ]
    bench = _run(script)
    shown = next(c for c in bench.model.calls if c.stage_key == "review-primary")
    flag = "\n[diff cut; read the files]" if over else ""

    assert shown.messages[0]["content"].endswith(
        "# Simulated diff so far (in memory; reads show these changes)\n\n"
        + whole[:MAX_CONTEXT_DIFF]
        + flag
    )
