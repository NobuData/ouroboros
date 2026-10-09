"""``/v0/code/*`` — the code & git mining tool's routes (CL.4, #617).

The operations are :mod:`tests.test_code_mining`'s and :mod:`tests.test_code_deps`'s. What is
left for the routes: each answers its model with the commit it read at and the clone it read
from; each failure answers its ``code_*`` envelope; a ref the clone lacks forces one fetch before
it is a ``404``; the token is never echoed; and the routes are behind the internal key.
"""

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from code_fixtures import SeededRepo, add_commit, build_repo
from ouroboros_engine.api.code import (
    BISECT_COMMITS_ROUTE,
    BLAME_ROUTE,
    CHANGED_BETWEEN_ROUTE,
    DEP_GRAPH_ROUTE,
    HISTORY_ROUTE,
)
from ouroboros_engine.api.v0 import V0_PREFIX
from ouroboros_engine.code.clones import CloneStore
from ouroboros_engine.core.errors import VALIDATION_FAILED

WORKSPACE = "5eed0617-0000-4000-8000-000000000001"
TOKEN = "ghp_never-echoed-0617"


@pytest.fixture
def seeded(tmp_path: Path) -> SeededRepo:
    """The fixture repository — the remote."""
    return build_repo(tmp_path / "remote" / "helios-firmware.git")


@pytest.fixture
def code_client(client: TestClient, tmp_path: Path) -> Iterator[TestClient]:
    """The authenticated client, over a clone store that reads local remotes."""
    client.app.state.code_clones = CloneStore(  # type: ignore[attr-defined]
        tmp_path / "clones", refresh_seconds=3600, allow_local=True
    )
    yield client


def _repository(seeded: SeededRepo, *, token: str | None = TOKEN) -> dict:
    return {
        "workspace": WORKSPACE,
        "slug": "acme/helios-firmware",
        "remote": str(seeded.path),
        "token": token,
    }


def _post(client: TestClient, route: str, body: dict) -> object:
    return client.post(f"{V0_PREFIX}{route}", json=body)


def test_blame_answers_the_fact_and_the_commit_it_was_read_at(
    code_client: TestClient, seeded: SeededRepo
) -> None:
    response = _post(
        code_client,
        BLAME_ROUTE,
        {
            "repository": _repository(seeded),
            "ref": "nightly",
            "path": "src/dock/dock_ctrl.c",
            "start": 200,
            "end": 230,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["sha"] == seeded.sha("c7")
    assert body["unchanged"]["phrase"] == "unchanged in 14 months"
    assert body["clone"]["repository"] == "acme/helios-firmware"
    assert body["clone"]["stale"] is False
    assert TOKEN not in response.text


def test_history_changed_between_dep_graph_and_bisect_commits_answer(
    code_client: TestClient, seeded: SeededRepo
) -> None:
    repository = _repository(seeded)

    history = _post(
        code_client,
        HISTORY_ROUTE,
        {
            "repository": repository,
            "ref": "nightly",
            "path": "src/motor",
            "window_days": 365,
        },
    )
    between = _post(
        code_client,
        CHANGED_BETWEEN_ROUTE,
        {
            "repository": repository,
            "base": "v2.0.4",
            "head": "nightly",
            "scope": "src/motor",
        },
    )
    graph = _post(
        code_client,
        DEP_GRAPH_ROUTE,
        {"repository": repository, "ref": "nightly", "module": "src", "stack": "c"},
    )
    unsupported = _post(
        code_client,
        DEP_GRAPH_ROUTE,
        {"repository": repository, "ref": "nightly", "module": "src"},
    )
    commits = _post(
        code_client,
        BISECT_COMMITS_ROUTE,
        {"repository": repository, "good": "v2.0.4", "bad": "nightly"},
    )

    assert history.json()["total_commits"] == 3
    assert between.json()["total_commits"] == 3
    assert graph.json()["status"] == "ok"
    assert len(graph.json()["edges"]) == 5
    assert unsupported.json()["status"] == "unsupported"
    assert unsupported.json()["edges"] == []
    assert commits.json()["max_steps"] == 3
    assert len(commits.json()["commits"]) == 6


def test_a_ref_the_clone_lacks_forces_one_fetch(
    code_client: TestClient, seeded: SeededRepo
) -> None:
    body = {
        "repository": _repository(seeded),
        "ref": "main",
        "path": "VERSION",
        "start": 1,
        "end": 1,
    }
    assert _post(code_client, BLAME_ROUTE, body).status_code == 200
    newer = add_commit(seeded, "Release", "2026-09-01", {"VERSION": b"2.1.0\n"})

    response = _post(code_client, BLAME_ROUTE, {**body, "ref": newer})

    assert response.status_code == 200
    assert response.json()["sha"] == newer


@pytest.mark.parametrize(
    ("route", "extra", "status", "code"),
    [
        (
            BLAME_ROUTE,
            {"ref": "gone", "path": "VERSION", "start": 1, "end": 1},
            404,
            "code_ref_not_found",
        ),
        (
            BLAME_ROUTE,
            {"ref": "nightly", "path": "nope.c", "start": 1, "end": 1},
            404,
            "code_path_not_found",
        ),
        (
            BLAME_ROUTE,
            {"ref": "nightly", "path": "VERSION", "start": 9, "end": 9},
            422,
            "code_range_outside_file",
        ),
        (
            BLAME_ROUTE,
            {"ref": "nightly", "path": "VERSION", "start": 1, "end": 900},
            422,
            "code_range_too_wide",
        ),
        (
            BISECT_COMMITS_ROUTE,
            {"good": "nightly", "bad": "v2.0.4"},
            409,
            "code_not_ancestor",
        ),
        (
            DEP_GRAPH_ROUTE,
            {"ref": "nightly", "module": "nope", "stack": "c"},
            404,
            "code_path_not_found",
        ),
    ],
)
def test_each_failure_answers_its_code(
    code_client: TestClient,
    seeded: SeededRepo,
    route: str,
    extra: dict,
    status: int,
    code: str,
) -> None:
    response = _post(code_client, route, {"repository": _repository(seeded), **extra})

    assert response.status_code == status
    assert response.json()["code"] == code


def test_an_http_remote_is_refused(code_client: TestClient) -> None:
    response = _post(
        code_client,
        BLAME_ROUTE,
        {
            "repository": {
                "workspace": WORKSPACE,
                "slug": "acme/helios-firmware",
                "remote": "http://github.com/acme/helios-firmware.git",
            },
            "ref": "main",
            "path": "VERSION",
            "start": 1,
            "end": 1,
        },
    )

    assert response.status_code == 422
    assert response.json()["code"] == "code_remote_refused"


def test_an_unreachable_remote_answers_502_with_a_constant_message(
    code_client: TestClient, tmp_path: Path
) -> None:
    empty = tmp_path / "empty"
    empty.mkdir()
    response = _post(
        code_client,
        BLAME_ROUTE,
        {
            "repository": {
                "workspace": WORKSPACE,
                "slug": "acme/empty",
                "remote": str(empty),
                "token": TOKEN,
            },
            "ref": "main",
            "path": "VERSION",
            "start": 1,
            "end": 1,
        },
    )

    assert response.status_code == 502
    assert response.json()["code"] == "code_remote_unreachable"
    assert response.json()["message"] == "The repository could not be fetched."
    assert TOKEN not in response.text


@pytest.mark.parametrize(
    "body",
    [
        {"ref": "main~1", "path": "VERSION", "start": 1, "end": 1},
        {"ref": "main", "path": "../etc/passwd", "start": 1, "end": 1},
        {"ref": "main", "path": "VERSION", "start": 5, "end": 1},
    ],
)
def test_a_malformed_request_is_the_validation_envelope(
    code_client: TestClient, seeded: SeededRepo, body: dict
) -> None:
    response = _post(
        code_client, BLAME_ROUTE, {"repository": _repository(seeded), **body}
    )

    assert response.status_code == 422
    assert response.json()["code"] == VALIDATION_FAILED


def test_history_needs_a_path_or_a_symbol(
    code_client: TestClient, seeded: SeededRepo
) -> None:
    response = _post(
        code_client, HISTORY_ROUTE, {"repository": _repository(seeded), "ref": "main"}
    )

    assert response.status_code == 422


def test_the_routes_are_behind_the_internal_key(anonymous_client: TestClient) -> None:
    response = anonymous_client.post(f"{V0_PREFIX}{BLAME_ROUTE}", json={})

    assert response.status_code == 401
