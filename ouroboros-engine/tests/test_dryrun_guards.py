"""The guard suite: every forbidden capability provably absent, and the overlay never flushed.

CD.2 (#560) rests on this file. Each test names one sentence of the guarantee and fails if it
stops being true; the last section removes each guard in turn and asserts the suite's own
checks go red, so a refactor cannot hollow the guards out and stay green.
"""

import ast
import inspect
from pathlib import Path
from urllib import request as urllib_request

import pytest

import ouroboros_engine.dryrun as dryrun_package
from dryrun_fakes import (
    ARBITRATION,
    DRY_RUN,
    FILES,
    PATCHED,
    SHA,
    Bench,
    RecordedEstimates,
    RecordingReader,
    ScriptedModel,
    happy,
    result,
    tool,
)
from ouroboros_engine.dryrun import guard, tools, workspace
from ouroboros_engine.dryrun.contract import GuardBlocked
from ouroboros_engine.dryrun.guard import (
    ALLOW_LIST,
    ALLOWED_TOOLS,
    FORBIDDEN_CAPABILITIES,
    WORKSPACE_BOUNDARY,
    GuardAudit,
    capability_of,
    is_allowed,
)
from ouroboros_engine.dryrun.protocol import system_prompt
from ouroboros_engine.dryrun.tools import TOOL_SPECS, ToolSet, render_manifest
from ouroboros_engine.dryrun.workspace import (
    GithubReader,
    ReadCache,
    RepositoryReader,
    VirtualWorkspace,
)

FORBIDDEN = [
    (capability, name)
    for capability, names in FORBIDDEN_CAPABILITIES.items()
    for name in names
]

#: What the issue promises is absent — every one must have names listed against it.
PROMISED_ABSENT = {
    "network_egress",
    "repository_write",
    "farm_dispatch",
    "pull_request",
    "ticket_source_write",
    "credential_access",
    "shell",
}

PACKAGE_DIR = Path(dryrun_package.__file__).parent


def _toolset(audit: GuardAudit | None = None, reader: RecordingReader | None = None):
    reader = reader or RecordingReader()
    space = VirtualWorkspace(reader, ReadCache(), "o/r", SHA)
    estimates = RecordedEstimates()
    audit = audit if audit is not None else GuardAudit()
    return (
        ToolSet(space, estimates, audit, dry_run=DRY_RUN, stage_key="implement"),
        space,
        reader,
        estimates,
        audit,
    )


# -- the allow-list ---------------------------------------------------------------------


def test_the_allow_list_is_exactly_the_six_tools():
    assert {
        "read_file",
        "search",
        "edit_file",
        "list_dir",
        "run_tests",
        "build",
    } == ALLOWED_TOOLS


def test_the_manifest_offers_exactly_the_allow_list():
    assert {spec.name for spec in TOOL_SPECS} == set(ALLOWED_TOOLS)
    assert len(TOOL_SPECS) == len(ALLOWED_TOOLS)
    for name in ALLOWED_TOOLS:
        assert f"- {name}(" in render_manifest()


def test_the_dispatch_table_holds_exactly_the_allow_list():
    toolset, *_ = _toolset()

    assert set(toolset._handlers) == set(ALLOWED_TOOLS)


def test_every_promised_capability_is_named_in_the_catalogue():
    assert set(FORBIDDEN_CAPABILITIES) == PROMISED_ABSENT
    assert all(names for names in FORBIDDEN_CAPABILITIES.values())


@pytest.mark.parametrize(("capability", "name"), FORBIDDEN)
def test_a_forbidden_tool_is_not_on_the_allow_list_or_in_the_manifest(capability, name):
    assert name not in ALLOWED_TOOLS
    assert not is_allowed(name)
    assert capability_of(name) == capability
    assert f"- {name}(" not in render_manifest()
    assert f"`{name}`" not in system_prompt().replace("`build` and `run_tests`", "")


@pytest.mark.parametrize(("capability", "name"), FORBIDDEN)
def test_a_forbidden_call_is_refused_recorded_and_touches_nothing(capability, name):
    assert capability in PROMISED_ABSENT
    toolset, space, reader, estimates, audit = _toolset()

    outcome = toolset.call(
        name, {"path": ARBITRATION, "content": "pwned", "url": "https://example.com"}
    )

    assert outcome.ok is False
    assert outcome.content == f"There is no tool named `{name}` in a dry run."
    assert outcome.blocked is not None
    assert (outcome.blocked.guard, outcome.blocked.call) == (ALLOW_LIST, name)
    assert [(e.guard, e.call, e.count, e.stage_key) for e in audit.entries()] == [
        (ALLOW_LIST, name, 1, "implement")
    ]
    # Nothing was read, estimated or written on its behalf.
    assert reader.calls == []
    assert estimates.asked == []
    assert space.changed_paths() == []
    assert toolset.writes == 0


@pytest.mark.parametrize(
    "name",
    [
        "",
        "READ_FILE",
        "read_file ",
        "edit_file\n",
        "__class__",
        "call",
        "_replay",
        "x" * 500,
    ],
)
def test_a_name_nobody_listed_is_refused_just_the_same(name):
    toolset, _, reader, _, audit = _toolset()

    outcome = toolset.call(name, {})

    assert outcome.ok is False
    assert outcome.blocked is not None
    assert len(audit) == 1
    assert len(audit.entries()[0].call) <= 80
    assert reader.calls == []


@pytest.mark.parametrize("arguments", [None, [], "path", 7])
def test_arguments_that_are_not_an_object_run_nothing(arguments):
    toolset, space, reader, _, audit = _toolset()

    outcome = toolset.call("edit_file", arguments)

    assert outcome.ok is False
    assert space.changed_paths() == []
    assert reader.calls == []
    assert audit.clean


# -- the workspace boundary -------------------------------------------------------------


OUTSIDE = [
    "../../etc/passwd",
    "/etc/passwd",
    "/",
    "drivers/../../secrets",
    "./.git/config/../../../x",
    "a//b",
    "a\\..\\b",
    ".",
    "..",
    "ok/\x00null",
]


@pytest.mark.parametrize(
    ("name", "path"),
    [
        (name, path)
        for name in ("read_file", "edit_file", "list_dir", "search")
        for path in OUTSIDE
    ]
    # An empty path is the root for a listing or a search, and no file at all for the rest.
    + [("read_file", ""), ("edit_file", "")],
)
def test_a_path_outside_the_repository_is_refused_and_recorded(name, path):
    toolset, space, reader, _, audit = _toolset()

    outcome = toolset.call(name, {"path": path, "content": "x", "query": "x"})

    assert outcome.ok is False
    assert outcome.blocked is not None
    assert outcome.blocked.guard == WORKSPACE_BOUNDARY
    assert [e.guard for e in audit.entries()] == [WORKSPACE_BOUNDARY]
    assert space.changed_paths() == []
    assert not any(kind == "blob" for kind, _ in reader.calls)


# -- the overlay never flushes ----------------------------------------------------------


def test_the_reader_interface_can_only_read():
    public = {
        name
        for name, member in vars(RepositoryReader).items()
        if callable(member) and not name.startswith("_")
    }

    assert public == {"tree", "blob"}


def test_the_workspace_has_no_way_to_hand_its_overlay_to_anything():
    public = {
        name
        for name, member in inspect.getmembers(VirtualWorkspace)
        if not name.startswith("_")
        and (callable(member) or isinstance(member, property))
    }

    assert public == {
        "read",
        "list_dir",
        "search",
        "write",
        "delete",
        "read_log",
        "changed_paths",
        "diff",
        "line_counts",
    }
    # Its only collaborators are the reader and the cache.
    space = VirtualWorkspace(RecordingReader(), ReadCache(), "o/r", SHA)
    held = {name for name in space.__dict__ if not name.startswith("__")}
    assert held == {
        "_reader",
        "_cache",
        "_key",
        "_overlay",
        "_read",
        "notes",
        "fetches",
    }


def test_writes_reach_the_reader_never_and_the_cache_never():
    reader = RecordingReader()
    cache = ReadCache()
    space = VirtualWorkspace(reader, cache, "o/r", SHA)
    space.read(ARBITRATION)
    held = len(cache)

    space.write(ARBITRATION, PATCHED)
    space.write("new/file.c", "int x;\n")
    space.delete("README.md")
    space.diff()
    space.line_counts()

    # Only reads were ever made, and the pinned text in the cache is still the commit's.
    assert {kind for kind, _ in reader.calls} <= {"tree", "blob"}
    assert reader.files == FILES
    assert cache.get(("o/r", SHA, ARBITRATION)) == FILES[ARBITRATION]
    assert len(cache) >= held
    # A fresh workspace over the same cache sees no trace of the overlay.
    fresh = VirtualWorkspace(reader, cache, "o/r", SHA)
    assert fresh.read(ARBITRATION) == FILES[ARBITRATION]
    assert fresh.changed_paths() == []
    assert (
        "new/file.c" not in fresh.list_dir("new")
        if "new/" in fresh.list_dir()
        else True
    )


def test_a_whole_run_leaves_the_repository_exactly_as_it_was():
    bench = Bench()
    _, done = bench.run()

    assert bench.reader.files == FILES
    assert {kind for kind, _ in bench.reader.calls} == {"tree", "blob"}
    assert any(a.kind == "overlay_diff" for a in done.artifacts)


class _SpyOpener:
    """Stands in for urllib's opener and records every request it is handed."""

    def __init__(self, body: bytes) -> None:
        self.body = body
        self.requests: list[urllib_request.Request] = []

    def open(self, prepared, timeout=None):  # noqa: ARG002 - urllib's signature
        self.requests.append(prepared)
        body = self.body

        class _Answer:
            def read(self, _limit=None):
                return body

            def __enter__(self):
                return self

            def __exit__(self, *_exc):
                return False

        return _Answer()


def test_the_github_reader_only_ever_sends_get_to_two_read_endpoints():
    opener = _SpyOpener(b'{"tree": [], "truncated": false}')
    reader = GithubReader("https://api.github.com", "o/r", SHA, "tok", opener=opener)

    reader.tree()
    reader.blob("src/a b.c")

    assert [r.get_method() for r in opener.requests] == ["GET", "GET"]
    assert all(r.data is None for r in opener.requests)
    assert [r.full_url for r in opener.requests] == [
        f"https://api.github.com/repos/o/r/git/trees/{SHA}?recursive=1",
        f"https://api.github.com/repos/o/r/contents/src/a%20b.c?ref={SHA}",
    ]
    assert opener.requests[0].get_header("Authorization") == "Bearer tok"
    assert "tok" not in repr(reader)
    assert GithubReader.METHOD == "GET"


def test_the_github_reader_sends_no_credential_for_a_public_repository():
    opener = _SpyOpener(b"x")
    GithubReader("https://api.github.com", "o/r", SHA, None, opener=opener).blob("a")

    assert opener.requests[0].get_header("Authorization") is None


# -- nothing in the package can do the forbidden things ---------------------------------


def _sources() -> dict[str, ast.Module]:
    return {
        path.name: ast.parse(path.read_text(encoding="utf-8"))
        for path in sorted(PACKAGE_DIR.glob("*.py"))
    }


def test_the_package_imports_nothing_that_could_run_a_process_or_touch_a_disk():
    banned = {
        "subprocess",
        "os",
        "shutil",
        "socket",
        "pathlib",
        "tempfile",
        "pty",
        "ctypes",
    }
    imported: dict[str, set[str]] = {}
    for name, tree in _sources().items():
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported.setdefault(name, set()).update(
                    a.name.split(".")[0] for a in node.names
                )
            elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                imported.setdefault(name, set()).add(node.module.split(".")[0])

    for name, modules in imported.items():
        assert not modules & banned, f"{name} imports {modules & banned}"
    # The network is reached from exactly two modules: reads, and the estimator.
    assert {name for name, modules in imported.items() if "urllib" in modules} == {
        "workspace.py",
        "estimates.py",
    }


def test_the_package_never_opens_evals_or_executes():
    for name, tree in _sources().items():
        called = {
            node.func.id
            for node in ast.walk(tree)
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
        }
        assert not called & {"open", "eval", "exec", "compile", "__import__"}, name


def test_the_only_http_methods_in_the_package_are_one_get_and_one_post():
    methods: dict[str, list[str]] = {}
    for name, tree in _sources().items():
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            for keyword in node.keywords:
                if keyword.arg != "method":
                    continue
                value = keyword.value
                methods.setdefault(name, []).append(
                    value.value
                    if isinstance(value, ast.Constant)
                    else ast.unparse(value)
                )

    # workspace.py: the reader's one request, always METHOD (GET).
    # estimates.py: the replay estimate, a POST that the control plane answers without
    # writing anything (#561).
    assert methods == {"workspace.py": ["self.METHOD"], "estimates.py": ["POST"]}


def test_the_harness_talks_to_no_execution_plane():
    banned = (
        "ouroboros_engine.code",
        "ouroboros_engine.control_plane.ingest",
        "ouroboros_engine.analysis",
    )
    for name, tree in _sources().items():
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.module:
                assert not node.module.startswith(banned), (
                    f"{name} imports {node.module}"
                )


# -- a blocked call is evidence, and fails the run --------------------------------------


def test_a_blocked_call_is_streamed_audited_and_fails_the_run():
    script = happy()
    script["implement"] = [
        tool("git_push", branch="main") + "\n" + tool("open_pr", title="fix"),
        tool("git_push", branch="main"),
        result(summary="I tried to push."),
    ]
    bench = Bench(model=ScriptedModel(script))
    events, done = bench.run()
    blocked = [e for e in events if isinstance(e, GuardBlocked)]

    assert [(b.guard, b.call, b.stage_key) for b in blocked] == [
        (ALLOW_LIST, "git_push", "implement"),
        (ALLOW_LIST, "open_pr", "implement"),
        (ALLOW_LIST, "git_push", "implement"),
    ]
    assert [(e.guard, e.call, e.count, e.stage_key) for e in done.guard_audit] == [
        (ALLOW_LIST, "git_push", 2, "implement"),
        (ALLOW_LIST, "open_pr", 1, "implement"),
    ]
    assert done.guards_clean is False
    assert done.status == "failed"
    assert done.failure_reason == (
        "the tool boundary refused 3 calls; a dry run whose guards had to hold is not trusted"
    )
    assert bench.reader.files == FILES


def test_the_model_is_told_the_tool_does_not_exist():
    seen = {}

    def after(call):
        seen["told"] = call.messages[-1]["content"]
        return result(summary="ok")

    script = happy()
    script["analyze"] = [tool("fetch_url", url="https://evil.example"), after]
    Bench(model=ScriptedModel(script)).run()

    assert seen["told"] == (
        "[fetch_url] refused\nThere is no tool named `fetch_url` in a dry run."
    )


def test_a_guard_failure_outranks_a_budget_stop_and_keeps_both_reasons():
    script = happy()
    script["analyze"] = [tool("run_shell", command="rm -rf /"), result(summary="x")]
    _, done = Bench(model=ScriptedModel(script)).run(budget={"run_tokens": 2000})

    assert done.status == "failed"
    assert done.failure_reason.startswith("the tool boundary refused 1 call; ")
    assert done.failure_reason.endswith(
        "stopped: run token cap reached (2k of 2k tokens)"
    )


def test_a_clean_run_has_an_empty_audit():
    _, done = Bench().run()

    assert (done.guard_audit, done.guards_clean) == ([], True)


def test_the_audit_counts_repeats_per_guard_call_and_stage():
    audit = GuardAudit()
    for stage in ("a", "a", "b"):
        audit.record(ALLOW_LIST, "git_push", stage)
    audit.record(WORKSPACE_BOUNDARY, "read_file", "a")
    audit.record(ALLOW_LIST, "", "a")

    assert [(e.guard, e.call, e.count, e.stage_key) for e in audit.entries()] == [
        (ALLOW_LIST, "git_push", 2, "a"),
        (ALLOW_LIST, "git_push", 1, "b"),
        (WORKSPACE_BOUNDARY, "read_file", 1, "a"),
        (ALLOW_LIST, "(unnamed)", 1, "a"),
    ]
    assert (len(audit), audit.clean) == (5, False)
    assert GuardAudit().clean


# -- removing a guard turns the suite red -----------------------------------------------


def _leaks(toolset_factory=_toolset) -> list[str]:
    """Every forbidden tool that a tool set would run instead of refusing."""
    leaked = []
    for _, name in FORBIDDEN:
        toolset, _, _, _, audit = toolset_factory()
        outcome = toolset.call(name, {"path": ARBITRATION, "content": "pwned"})
        if outcome.blocked is None or audit.clean:
            leaked.append(name)
    return leaked


def test_the_leak_probe_is_green_with_the_guards_in_place():
    assert _leaks() == []


def test_removing_the_allow_list_check_is_caught(monkeypatch):
    monkeypatch.setattr(tools, "is_allowed", lambda _name: True)
    # With the check gone, a forbidden name that is also a handler would run. None is — the
    # dispatch table is the second lock — so add one, as a careless refactor would.
    original = ToolSet.__init__

    def with_shell(self, *args, **kwargs):
        original(self, *args, **kwargs)
        self._handlers["run_shell"] = lambda _arguments: "ran"

    monkeypatch.setattr(ToolSet, "__init__", with_shell)

    assert "run_shell" in _leaks()
    toolset, *_ = _toolset()
    with pytest.raises(AssertionError):
        assert set(toolset._handlers) == set(ALLOWED_TOOLS)


def test_widening_the_allow_list_is_caught(monkeypatch):
    monkeypatch.setattr(guard, "ALLOWED_TOOLS", ALLOWED_TOOLS | {"git_push"})

    assert is_allowed("git_push")  # the guard has been loosened…
    with pytest.raises(AssertionError):  # …and the suite's own check sees it
        assert {
            "read_file",
            "search",
            "edit_file",
            "list_dir",
            "run_tests",
            "build",
        } == guard.ALLOWED_TOOLS
    # A name on the list with no handler still runs nothing and is still recorded.
    assert _leaks() == []


def test_removing_the_path_check_is_caught(monkeypatch):
    monkeypatch.setattr(workspace, "_checked", lambda path: path)
    toolset, space, _, _, audit = _toolset()

    outcome = toolset.call("edit_file", {"path": "../../etc/cron.d/x", "content": "x"})

    # Without the guard the write is accepted and nothing is audited — exactly what
    # test_a_path_outside_the_repository_is_refused_and_recorded asserts never happens.
    assert outcome.ok is True
    assert audit.clean
    assert space.changed_paths() == ["../../etc/cron.d/x"]


def test_removing_the_run_failure_on_a_dirty_audit_is_caught(monkeypatch):
    monkeypatch.setattr(GuardAudit, "clean", property(lambda _self: True))
    script = happy()
    script["implement"] = [tool("git_push"), result(summary="x")]
    _, done = Bench(model=ScriptedModel(script)).run()

    # The audit still lists the call, so a run reported complete with a populated audit is
    # visibly inconsistent — which is what the assertion on a real run pins down.
    assert done.status == "complete"
    assert [e.call for e in done.guard_audit] == ["git_push"]
    with pytest.raises(AssertionError):
        assert (done.status == "failed") == bool(done.guard_audit)


def test_a_reader_that_grew_a_write_would_be_caught(monkeypatch):
    monkeypatch.setattr(
        RepositoryReader, "push", lambda *_arguments: None, raising=False
    )

    with pytest.raises(AssertionError):
        test_the_reader_interface_can_only_read()
