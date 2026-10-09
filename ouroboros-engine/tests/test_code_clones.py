"""The clone cache — made, refreshed, isolated, credential-free (CL.4, #617)."""

import shutil
from pathlib import Path

import pytest

from code_fixtures import SeededRepo, add_commit, build_repo
from ouroboros_engine.code.clones import (
    FETCHED_STAMP,
    CloneStore,
    RemoteRefusedError,
    RemoteUnreachableError,
    RepositoryRef,
)
from ouroboros_engine.code.repo import RefNotFoundError

WORKSPACE = "5eed0617-0000-4000-8000-000000000001"
OTHER_WORKSPACE = "5eed0617-0000-4000-8000-000000000002"
TOKEN = "ghp_never-written-down-0617"


class Clock:
    """A clock a test moves."""

    def __init__(self) -> None:
        """Start at a fixed moment."""
        self.now = 1_800_000_000.0

    def __call__(self) -> float:
        """The time.

        Returns:
            Unix seconds.
        """
        return self.now


@pytest.fixture
def seeded(tmp_path: Path) -> SeededRepo:
    """A fresh fixture repository per test — some tests move it."""
    return build_repo(tmp_path / "remote" / "helios-firmware.git")


@pytest.fixture
def clock() -> Clock:
    """The store's clock."""
    return Clock()


@pytest.fixture
def store(tmp_path: Path, clock: Clock) -> CloneStore:
    """A store reading local remotes, fresh for five minutes."""
    return CloneStore(
        tmp_path / "clones", refresh_seconds=300, allow_local=True, clock=clock
    )


def _ref(
    seeded: SeededRepo, workspace: str = WORKSPACE, token: str | None = None
) -> RepositoryRef:
    return RepositoryRef(workspace, "acme/helios-firmware", str(seeded.path), token)


def test_a_first_open_makes_a_bare_clone_of_branches_and_tags(
    store: CloneStore, seeded: SeededRepo
) -> None:
    opened = store.open(_ref(seeded))

    path = store.path_of(_ref(seeded))
    assert path == store.root / WORKSPACE / "acme__helios-firmware.git"
    assert (path / FETCHED_STAMP).exists()
    assert not (path / ".git").exists()  # bare: no working tree
    assert opened.repo.resolve("nightly") == seeded.sha("c7")
    assert opened.repo.resolve("v2.0.4") == seeded.sha("c1")
    assert opened.stale is False
    opened.repo.close()


def test_a_fresh_clone_is_read_without_fetching(
    store: CloneStore, seeded: SeededRepo, clock: Clock
) -> None:
    store.open(_ref(seeded)).repo.close()
    newer = add_commit(seeded, "Later", "2026-09-01", {"VERSION": b"2.1.0\n"})
    clock.now += 60

    opened = store.open(_ref(seeded))

    assert opened.repo.resolve("main") == seeded.sha("c7")
    with pytest.raises(RefNotFoundError):
        opened.repo.resolve(newer)
    opened.repo.close()


def test_a_stale_clone_is_fetched_first(
    store: CloneStore, seeded: SeededRepo, clock: Clock
) -> None:
    store.open(_ref(seeded)).repo.close()
    newer = add_commit(seeded, "Later", "2026-09-01", {"VERSION": b"2.1.0\n"})
    clock.now += 301

    opened = store.open(_ref(seeded))

    assert opened.repo.resolve("main") == newer
    opened.repo.close()


def test_force_fetches_a_fresh_clone(
    store: CloneStore, seeded: SeededRepo, clock: Clock
) -> None:
    store.open(_ref(seeded)).repo.close()
    newer = add_commit(seeded, "Later", "2026-09-01", {"VERSION": b"2.1.0\n"})
    clock.now += 1

    opened = store.open(_ref(seeded), force=True)

    assert opened.repo.resolve("main") == newer
    assert opened.fetched is True
    opened.repo.close()


def test_a_failed_refresh_reads_the_clone_as_it_was(
    store: CloneStore, seeded: SeededRepo, clock: Clock
) -> None:
    store.open(_ref(seeded)).repo.close()
    fetched = store.open(_ref(seeded))
    fetched.repo.close()
    _remove(seeded.path)
    clock.now += 301

    opened = store.open(_ref(seeded))

    assert opened.stale is True
    assert opened.fetched_at == fetched.fetched_at
    assert opened.repo.resolve("nightly") == seeded.sha("c7")
    opened.repo.close()


def test_a_failed_first_clone_leaves_nothing_behind(
    store: CloneStore, tmp_path: Path
) -> None:
    missing = tmp_path / "missing.git"
    missing.mkdir()  # a directory, but not a repository
    ref = RepositoryRef(WORKSPACE, "acme/gone", str(missing))

    with pytest.raises(RemoteUnreachableError):
        store.open(ref)

    assert not store.path_of(ref).exists()


def test_an_organization_id_names_the_workspace_directory(
    store: CloneStore, seeded: SeededRepo
) -> None:
    ref = RepositoryRef("org-acme_7Kq2", "acme/helios-firmware", str(seeded.path))

    assert store.path_of(ref).parent.name == "org-acme_7Kq2"


def test_workspaces_never_share_a_clone(store: CloneStore, seeded: SeededRepo) -> None:
    first = store.path_of(_ref(seeded))
    second = store.path_of(_ref(seeded, OTHER_WORKSPACE))

    assert first != second
    assert first.parent.name == WORKSPACE
    assert second.parent.name == OTHER_WORKSPACE


def test_the_token_is_never_written_into_the_clone(
    store: CloneStore, seeded: SeededRepo
) -> None:
    store.open(_ref(seeded, token=TOKEN)).repo.close()

    for path in store.root.rglob("*"):
        if path.is_file():
            assert TOKEN.encode() not in path.read_bytes(), path
    assert TOKEN not in repr(_ref(seeded, token=TOKEN))


@pytest.mark.parametrize(
    "remote",
    [
        "http://github.com/acme/helios-firmware.git",
        "https://x-access-token:secret@github.com/acme/helios-firmware.git",
        "git@github.com:acme/helios-firmware.git",
        "file:///etc",
        "ssh://github.com/acme/helios-firmware.git",
    ],
)
def test_only_https_remotes_are_read(tmp_path: Path, remote: str) -> None:
    store = CloneStore(tmp_path / "clones")

    with pytest.raises(RemoteRefusedError):
        store.open(RepositoryRef(WORKSPACE, "acme/helios-firmware", remote))


def test_a_local_path_is_refused_unless_the_store_allows_it(
    tmp_path: Path, seeded: SeededRepo
) -> None:
    with pytest.raises(RemoteRefusedError):
        CloneStore(tmp_path / "clones").open(_ref(seeded))


@pytest.mark.parametrize(
    ("workspace", "slug"),
    [
        ("../../etc", "acme/helios-firmware"),
        ("", "acme/helios-firmware"),
        ("org.acme", "acme/helios-firmware"),
        (WORKSPACE, "acme/../../etc"),
        (WORKSPACE, "helios-firmware"),
        (WORKSPACE, "acme/helios/firmware"),
    ],
)
def test_a_malformed_workspace_or_slug_never_names_a_path(
    store: CloneStore, workspace: str, slug: str
) -> None:
    with pytest.raises(RemoteRefusedError):
        store.path_of(RepositoryRef(workspace, slug, "https://github.com/x/y.git"))


def _remove(path: Path) -> None:
    """Empty the remote, so the next fetch fails (the path is still a directory).

    Args:
        path: The remote repository.
    """
    shutil.rmtree(path)
    path.mkdir()
