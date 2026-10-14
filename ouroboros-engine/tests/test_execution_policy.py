"""The tool policy: each rule, its order, and one verdict whichever executor kind asks."""

from pathlib import Path

import pytest

from ouroboros_engine.execution.policy import (
    L5_TOOLS,
    ToolPolicy,
    ToolRequest,
    evaluate,
    resolve_in_tree,
)
from ouroboros_engine.workflows.dsl import LlmPermissions
from stage_executor_fakes import (
    Call,
    FakeHarnessExecutor,
    FakeNativeExecutor,
    Script,
)
from stage_executor_fixtures import make_context


def _policy(
    tree: Path,
    *,
    push_fixup: bool = False,
    touch_ci: bool = False,
    protected: tuple[str, ...] = ("boot/**",),
    tools: frozenset[str] = L5_TOOLS,
) -> ToolPolicy:
    return ToolPolicy(
        working_tree=str(tree),
        permissions=LlmPermissions(push_fixup=push_fixup, touch_ci=touch_ci),
        protected_paths=protected,
        allowed_tools=tools,
    )


def _ask(policy: ToolPolicy, tool: str, *paths: str):
    return evaluate(policy, ToolRequest(call_id="c1", tool=tool, paths=paths))


def test_l5_is_file_tools_only() -> None:
    assert (
        frozenset({"read_file", "list_dir", "search", "write_file", "edit_file"})
        == L5_TOOLS
    )


@pytest.mark.parametrize(
    "tool",
    ["bash", "run_shell", "web_fetch", "mcp__github__push", "git_push", "delete_file"],
)
def test_a_tool_off_the_allow_list_is_denied(tmp_path: Path, tool: str) -> None:
    verdict = _ask(_policy(tmp_path), tool, "src/a.py")
    assert verdict.decision == "deny"
    assert verdict.rule == "allow_list"
    assert verdict.halts


def test_an_ordinary_write_is_allowed(tmp_path: Path) -> None:
    verdict = _ask(_policy(tmp_path), "write_file", "src/a.py")
    assert verdict.decision == "allow"
    assert verdict.rule is None
    assert not verdict.halts


def test_a_search_naming_no_path_is_allowed(tmp_path: Path) -> None:
    assert _ask(_policy(tmp_path), "search").decision == "allow"


@pytest.mark.parametrize("path", ["../outside.txt", "/etc/passwd", "a/../../b"])
def test_a_path_outside_the_working_tree_is_denied(tmp_path: Path, path: str) -> None:
    tree = tmp_path / "tree"
    tree.mkdir()
    verdict = _ask(_policy(tree), "read_file", path)
    assert (verdict.decision, verdict.rule) == ("deny", "working_tree")
    assert verdict.path == path


def test_an_absolute_path_inside_the_tree_is_relativised(tmp_path: Path) -> None:
    verdict = _ask(_policy(tmp_path), "write_file", str(tmp_path / "boot" / "x.c"))
    assert (verdict.rule, verdict.path, verdict.glob) == (
        "protected_path",
        "boot/x.c",
        "boot/**",
    )


@pytest.mark.parametrize("path", [".git/hooks/pre-commit", ".git/config", ".git"])
def test_the_git_directory_is_outside_the_working_tree(
    tmp_path: Path, path: str
) -> None:
    assert _ask(_policy(tmp_path), "write_file", path).rule == "working_tree"
    assert _ask(_policy(tmp_path), "read_file", path).rule == "working_tree"


def test_a_file_merely_named_git_something_is_inside(tmp_path: Path) -> None:
    assert _ask(_policy(tmp_path), "write_file", ".gitignore").decision == "allow"


def test_a_symlink_pointing_out_of_the_tree_is_out(tmp_path: Path) -> None:
    tree = tmp_path / "tree"
    tree.mkdir()
    (tmp_path / "secret").mkdir()
    (tree / "link").symlink_to(tmp_path / "secret")
    verdict = _ask(_policy(tree), "read_file", "link/key.pem")
    assert verdict.rule == "working_tree"


def test_a_write_must_name_its_path(tmp_path: Path) -> None:
    assert _ask(_policy(tmp_path), "write_file").rule == "working_tree"


def test_the_working_tree_must_be_absolute() -> None:
    with pytest.raises(ValueError, match="absolute"):
        ToolPolicy(
            working_tree="relative/tree",
            permissions=LlmPermissions(push_fixup=False, touch_ci=False),
        )


def test_a_nul_byte_is_not_a_path(tmp_path: Path) -> None:
    assert resolve_in_tree(str(tmp_path), "a\x00b") is None
    assert resolve_in_tree(str(tmp_path), "") is None


def test_a_ci_write_needs_touch_ci(tmp_path: Path) -> None:
    denied = _ask(_policy(tmp_path), "edit_file", ".github/workflows/ci.yml")
    assert (denied.rule, denied.glob) == ("stage_permission", ".github/workflows/**")
    allowed = _ask(
        _policy(tmp_path, touch_ci=True), "edit_file", ".github/workflows/ci.yml"
    )
    assert allowed.decision == "allow"


def test_reading_ci_configuration_needs_no_permission(tmp_path: Path) -> None:
    assert _ask(
        _policy(tmp_path), "read_file", ".github/workflows/ci.yml"
    ).decision == ("allow")


def test_a_protected_path_refuses_writes_and_admits_reads(tmp_path: Path) -> None:
    assert (
        _ask(_policy(tmp_path), "write_file", "boot/start.s").rule == "protected_path"
    )
    assert _ask(_policy(tmp_path), "read_file", "boot/start.s").decision == "allow"


def test_touch_ci_does_not_lift_a_protected_path(tmp_path: Path) -> None:
    policy = _policy(tmp_path, touch_ci=True, protected=(".github/**",))
    assert (
        _ask(policy, "write_file", ".github/workflows/ci.yml").rule == "protected_path"
    )


def test_push_fixup_follows_the_stage_permission(tmp_path: Path) -> None:
    tools = L5_TOOLS | {"push_fixup"}
    assert _ask(_policy(tmp_path, tools=tools), "push_fixup").rule == "stage_permission"
    assert (
        _ask(_policy(tmp_path, tools=tools, push_fixup=True), "push_fixup").decision
        == "allow"
    )


def test_the_allow_list_is_checked_before_the_permission(tmp_path: Path) -> None:
    verdict = _ask(_policy(tmp_path, push_fixup=True), "push_fixup")
    assert verdict.rule == "allow_list"


def test_the_first_offending_path_decides(tmp_path: Path) -> None:
    verdict = _ask(_policy(tmp_path), "write_file", "src/ok.py", "boot/x.s", "../out")
    assert verdict.rule == "working_tree"


@pytest.mark.parametrize(
    ("call", "decision", "rule"),
    [
        (Call("write_file", "src/a.py"), "allow", None),
        (Call("read_file", "README.md"), "allow", None),
        (Call("write_file", "boot/start.s"), "deny", "protected_path"),
        (Call("edit_file", ".github/workflows/ci.yml"), "deny", "stage_permission"),
        (Call("write_file", "../escape.txt"), "deny", "working_tree"),
        (Call("write_file", ".git/hooks/pre-commit"), "deny", "working_tree"),
        (Call("bash"), "deny", "allow_list"),
    ],
)
def test_two_executor_kinds_receive_the_same_verdict(
    tmp_path: Path, call: Call, decision: str, rule: str | None
) -> None:
    """The acceptance criterion: one policy, one verdict, whichever kind asks.

    The native fake names the call in the neutral vocabulary with a relative path; the
    harness fake receives it as a harness would — ``Write`` with an absolute
    ``file_path`` — and translates at its pre-tool hook. Both reach :func:`evaluate`.
    """
    ctx = make_context(tmp_path)
    native = FakeNativeExecutor(Script()).native_request(ctx, call, "c1")
    harness = FakeHarnessExecutor(Script()).native_request(ctx, call, "c1")
    if call.path is not None:  # the two kinds really did describe it differently
        assert native.paths != harness.paths
    native_verdict = evaluate(ctx.policy, native)
    harness_verdict = evaluate(ctx.policy, harness)
    assert native_verdict.decision == harness_verdict.decision == decision
    assert native_verdict.rule == harness_verdict.rule == rule
    assert native_verdict.glob == harness_verdict.glob
