"""``dep_graph`` over the seeded fixture — three stacks, and an honest ``unsupported`` (#617)."""

from collections.abc import Iterator
from datetime import UTC, datetime

import pytest

from code_fixtures import SeededRepo, build_repo
from ouroboros_engine.code.clones import CloneStore, RepositoryRef
from ouroboros_engine.code.contract import CloneInfo
from ouroboros_engine.code.deps import dep_graph
from ouroboros_engine.code.repo import PathNotFoundError, ReadOnlyRepo

CLONE = CloneInfo(
    repository="acme/helios-firmware",
    fetched_at=datetime(2026, 10, 9, tzinfo=UTC),
    stale=False,
)


@pytest.fixture(scope="module")
def seeded(tmp_path_factory: pytest.TempPathFactory) -> SeededRepo:
    """The fixture repository."""
    return build_repo(tmp_path_factory.mktemp("remote") / "helios-firmware.git")


@pytest.fixture(scope="module")
def repo(
    seeded: SeededRepo, tmp_path_factory: pytest.TempPathFactory
) -> Iterator[ReadOnlyRepo]:
    """A read-only clone of it."""
    store = CloneStore(tmp_path_factory.mktemp("clones"), allow_local=True)
    opened = store.open(
        RepositoryRef(
            "5eed0617-0000-4000-8000-000000000001",
            "acme/helios-firmware",
            str(seeded.path),
        )
    )
    yield opened.repo
    opened.repo.close()


def _edges(graph: object) -> list[tuple[str, str]]:
    return [(edge.source, edge.target) for edge in graph.edges]  # type: ignore[attr-defined]


def test_c_includes_resolve_beside_the_file_and_by_suffix(repo: ReadOnlyRepo) -> None:
    graph = dep_graph(repo, CLONE, "nightly", "src", "c")

    assert graph.status == "ok"
    assert graph.nodes == [
        "src/dock/dock_ctrl.c",
        "src/dock/dock_ctrl.h",
        "src/motor/pid.c",
        "src/motor/pid.h",
    ]
    assert _edges(graph) == [
        ("src/dock/dock_ctrl.c", "include/app/motor.h"),
        ("src/dock/dock_ctrl.c", "src/dock/dock_ctrl.h"),
        ("src/dock/dock_ctrl.h", "src/motor/pid.h"),
        ("src/motor/pid.c", "include/app/motor.h"),
        ("src/motor/pid.c", "src/motor/pid.h"),
    ]
    assert graph.external == ["<zephyr/kernel.h>"]


def test_module_edges_roll_file_edges_up_to_directories(repo: ReadOnlyRepo) -> None:
    graph = dep_graph(repo, CLONE, "nightly", "src", "c")

    assert [(e.source, e.target, e.weight) for e in graph.module_edges] == [
        ("src/dock", "include/app", 1),
        ("src/dock", "src/motor", 1),
        ("src/motor", "include/app", 1),
    ]


def test_python_imports_resolve_absolute_and_relative(repo: ReadOnlyRepo) -> None:
    graph = dep_graph(repo, CLONE, "nightly", "tools", "python")

    assert _edges(graph) == [
        ("tools/sim/run.py", "tools/sim/plant.py"),
        ("tools/sim/run.py", "tools/sim/util.py"),
        ("tools/sim/util.py", "tools/sim/plant.py"),
    ]
    assert graph.external == ["math", "numpy"]


def test_js_and_ts_imports_resolve_relative_specifiers(repo: ReadOnlyRepo) -> None:
    graph = dep_graph(repo, CLONE, "nightly", "web", "javascript")

    assert _edges(graph) == [
        ("web/src/chart.ts", "web/src/lib/axes.ts"),
        ("web/src/index.ts", "web/src/chart.ts"),
    ]
    assert graph.external == ["@acme/theme", "d3", "react"]


def test_an_unknown_stack_is_unsupported_not_an_empty_graph(repo: ReadOnlyRepo) -> None:
    graph = dep_graph(repo, CLONE, "nightly", "src", None)

    assert graph.status == "unsupported"
    assert graph.reason is not None
    assert "repository detection" in graph.reason


def test_a_module_with_no_sources_of_the_stack_is_unsupported(
    repo: ReadOnlyRepo,
) -> None:
    graph = dep_graph(repo, CLONE, "nightly", "docs", "python")

    assert graph.status == "unsupported"
    assert graph.reason == "there are no Python sources under docs"


def test_a_module_that_is_not_a_directory_is_named(repo: ReadOnlyRepo) -> None:
    with pytest.raises(PathNotFoundError):
        dep_graph(repo, CLONE, "nightly", "src/nope", "c")
    with pytest.raises(PathNotFoundError):
        dep_graph(repo, CLONE, "nightly", "VERSION", "c")


def test_the_graph_is_the_same_at_the_same_commit(
    repo: ReadOnlyRepo, seeded: SeededRepo
) -> None:
    first = dep_graph(repo, CLONE, "nightly", None, "c")
    again = dep_graph(repo, CLONE, seeded.sha("c7"), None, "c")

    assert first.model_dump(exclude={"ref"}) == again.model_dump(exclude={"ref"})
