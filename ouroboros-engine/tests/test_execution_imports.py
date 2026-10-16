"""Core engine code imports the SPI only — ruff's banned-api rule, proven to fire."""

import ast
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
RUFF = Path(sys.executable).parent / "ruff"
ADAPTER_IMPORT = (
    "from ouroboros_engine.execution.executors import claude_sdk\n"
    "import claude_agent_sdk\n"
)


def _ruff(stdin_filename: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(  # noqa: S603 — a fixed binary and fixed arguments
        [
            str(RUFF),
            "check",
            "--select",
            "TID251",
            "--stdin-filename",
            stdin_filename,
            "-",
        ],
        input=ADAPTER_IMPORT,
        capture_output=True,
        text=True,
        cwd=ROOT,
        check=False,
    )


@pytest.mark.skipif(
    not RUFF.exists(), reason="ruff is not installed beside this python"
)
@pytest.mark.parametrize(
    "where",
    ["src/ouroboros_engine/api/runs.py", "src/ouroboros_engine/execution/spi.py"],
)
def test_core_code_may_not_import_an_adapter(where: str) -> None:
    result = _ruff(where)
    assert result.returncode == 1
    assert "`ouroboros_engine.execution.executors` is banned" in result.stdout
    assert "`claude_agent_sdk` is banned" in result.stdout


@pytest.mark.skipif(
    not RUFF.exists(), reason="ruff is not installed beside this python"
)
def test_an_adapter_may_import_its_sdk() -> None:
    result = _ruff("src/ouroboros_engine/execution/executors/claude_sdk.py")
    assert result.returncode == 0, result.stdout


#: The composition root (DH.3, #1308): the one core module that registers adapters.
COMPOSITION_ROOT = ROOT / "src" / "ouroboros_engine" / "execution" / "compose.py"


@pytest.mark.skipif(
    not RUFF.exists(), reason="ruff is not installed beside this python"
)
def test_the_composition_root_may_import_an_adapter() -> None:
    result = _ruff("src/ouroboros_engine/execution/compose.py")
    assert result.returncode == 0, result.stdout


def test_no_core_module_but_the_composition_root_imports_an_adapter() -> None:
    """The same rule without ruff, so a container without dev tools still checks it."""
    package = ROOT / "src" / "ouroboros_engine"
    adapters = package / "execution" / "executors"
    for module in package.rglob("*.py"):
        if module.is_relative_to(adapters) or module == COMPOSITION_ROOT:
            continue
        for node in ast.walk(ast.parse(module.read_text())):
            names: list[str] = []
            if isinstance(node, ast.Import):
                names = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom):
                base = node.module or ""
                names = [base, *(f"{base}.{alias.name}" for alias in node.names)]
            for name in names:
                assert not name.startswith(
                    ("ouroboros_engine.execution.executors", "claude_agent_sdk")
                ), f"{module.relative_to(ROOT)} imports {name}"
