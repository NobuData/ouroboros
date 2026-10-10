"""The virtual workspace: lazy pinned reads, the cache, the overlay and its diff (CD.2, #560)."""

from urllib import error

import pytest

from dryrun_fakes import ARBITRATION, FILES, PATCHED, SHA, RecordingReader
from ouroboros_engine.dryrun.workspace import (
    LIST_LIMIT,
    MAX_FILE_BYTES,
    SEARCH_FETCH_LIMIT,
    SEARCH_MATCH_LIMIT,
    GithubReader,
    ReadCache,
    Tree,
    VirtualWorkspace,
    WorkspaceError,
    glob_matches,
)


def space(reader=None, cache=None, sha=SHA) -> tuple[VirtualWorkspace, RecordingReader]:
    reader = reader or RecordingReader()
    held = cache if cache is not None else ReadCache()
    return VirtualWorkspace(reader, held, "o/r", sha), reader


# -- reads ------------------------------------------------------------------------------


def test_a_read_is_fetched_once_and_then_served_from_the_cache():
    workspace, reader = space()

    assert workspace.read(ARBITRATION) == FILES[ARBITRATION]
    assert workspace.read(ARBITRATION) == FILES[ARBITRATION]

    assert reader.calls == [("blob", ARBITRATION)]
    assert workspace.fetches == 1
    assert workspace.read_log == (ARBITRATION, ARBITRATION)


def test_nothing_is_fetched_until_it_is_asked_for():
    workspace, reader = space()

    assert reader.calls == []
    workspace.list_dir()
    assert reader.calls == [("tree", "")]
    workspace.list_dir("drivers")
    assert reader.calls == [("tree", "")]


def test_the_cache_is_shared_by_workspaces_of_the_same_commit_only():
    cache = ReadCache()
    first, reader = space(cache=cache)
    first.read(ARBITRATION)

    same, _ = space(reader=reader, cache=cache)
    same.read(ARBITRATION)
    assert reader.blobs(ARBITRATION) == 1
    assert same.fetches == 0

    other, _ = space(reader=reader, cache=cache, sha="b" * 40)
    other.read(ARBITRATION)
    assert reader.blobs(ARBITRATION) == 2


def test_a_missing_file_is_not_found_and_not_logged_as_read():
    workspace, _ = space()

    with pytest.raises(WorkspaceError) as refused:
        workspace.read("nope.c")

    assert refused.value.code == "not_found"
    assert workspace.read_log == ()


def test_a_binary_or_oversized_file_is_refused():
    reader = RecordingReader()
    reader.blob = lambda path: (
        b"\xff\xfe\x00" if path == "bin" else b"x" * (MAX_FILE_BYTES + 1)
    )
    workspace, _ = space(reader=reader)

    with pytest.raises(WorkspaceError) as binary:
        workspace.read("bin")
    with pytest.raises(WorkspaceError) as large:
        workspace.read("big")

    assert (binary.value.code, large.value.code) == ("binary", "too_large")


def test_list_dir_shows_immediate_children_with_directories_marked():
    workspace, _ = space()

    assert workspace.list_dir() == ["README.md", "drivers/", "tests/"]
    assert workspace.list_dir("drivers/can") == ["Kconfig", "arbitration.c", "can.h"]
    assert workspace.list_dir("drivers/can/") == workspace.list_dir("drivers/can")
    with pytest.raises(WorkspaceError) as missing:
        workspace.list_dir("nope")
    assert missing.value.code == "not_found"


def test_list_dir_is_bounded():
    reader = RecordingReader({f"f{n:04}.c": "" for n in range(LIST_LIMIT + 50)})
    workspace, _ = space(reader=reader)

    assert len(workspace.list_dir()) == LIST_LIMIT


def test_search_finds_paths_and_lines_case_insensitively():
    workspace, _ = space()

    found = [(m.path, m.line, m.text) for m in workspace.search("lostarb")]

    assert found == [
        (ARBITRATION, 3, "if (err & CAN_ERR_LOSTARB) {"),
        ("drivers/can/can.h", 1, "#define CAN_ERR_LOSTARB 0x02"),
    ]
    assert [(m.path, m.line) for m in workspace.search("kconfig")] == [
        ("drivers/can/Kconfig", 0)
    ]
    assert workspace.search("no such text anywhere") == []


def test_search_can_be_scoped_to_a_directory():
    workspace, reader = space()

    found = workspace.search("zassert", "tests")

    assert [m.path for m in found] == ["tests/can/test_arbitration.c"]
    assert reader.blobs(ARBITRATION) == 0


def test_search_does_not_count_as_a_stage_reading_a_file():
    workspace, _ = space()
    workspace.search("retry")

    assert workspace.read_log == ()


def test_a_deep_search_stops_at_its_fetch_bound_and_says_so():
    files = {f"src/f{n:03}.c": f"int v{n};\n" for n in range(SEARCH_FETCH_LIMIT + 25)}
    workspace, reader = space(reader=RecordingReader(files))

    workspace.search("needle")

    assert sum(kind == "blob" for kind, _ in reader.calls) == SEARCH_FETCH_LIMIT
    assert workspace.notes == [
        f"search read {SEARCH_FETCH_LIMIT} of {SEARCH_FETCH_LIMIT + 25} unread files "
        "(a lazy workspace bounds deep searches)"
    ]
    # What a search fetched is held, so the next one reaches the rest — and is whole.
    workspace.search("needle again")
    assert sum(kind == "blob" for kind, _ in reader.calls) == SEARCH_FETCH_LIMIT + 25
    assert len(workspace.notes) == 1


def test_search_results_are_bounded():
    files = {"a.txt": "hit\n" * (SEARCH_MATCH_LIMIT + 40)}
    workspace, _ = space(reader=RecordingReader(files))

    assert len(workspace.search("hit")) == SEARCH_MATCH_LIMIT


def test_a_truncated_tree_is_noted_once():
    workspace, _ = space(reader=RecordingReader(truncated=True))
    workspace.list_dir()
    workspace.list_dir()

    assert len(workspace.notes) == 1
    assert workspace.notes[0].startswith("the git host truncated the file listing")


# -- the overlay ------------------------------------------------------------------------


def test_reads_go_through_the_overlay():
    workspace, reader = space()
    workspace.write(ARBITRATION, PATCHED)
    workspace.write("docs/new.md", "# New\n")

    assert workspace.read(ARBITRATION) == PATCHED
    assert workspace.read("docs/new.md") == "# New\n"
    assert "docs/" in workspace.list_dir()
    assert [m.path for m in workspace.search("backoff_us <<")] == [ARBITRATION]
    # The pinned text was never needed for an overlaid read.
    assert reader.blobs(ARBITRATION) == 0


def test_a_deleted_file_is_gone_from_reads_listings_and_searches():
    workspace, _ = space()
    workspace.delete("README.md")

    with pytest.raises(WorkspaceError) as gone:
        workspace.read("README.md")
    assert gone.value.code == "not_found"
    assert "README.md" not in workspace.list_dir()
    assert workspace.search("helios-firmware") == []
    with pytest.raises(WorkspaceError):
        workspace.delete("never-existed.c")


def test_the_diff_is_a_unified_diff_of_the_overlay_in_path_order():
    workspace, _ = space()
    workspace.write("z/new.c", "int z;\n")
    workspace.write(ARBITRATION, PATCHED)
    workspace.delete("README.md")

    diff = workspace.diff()

    assert diff.index("--- a/README.md") < diff.index(f"--- a/{ARBITRATION}")
    assert diff.index(f"--- a/{ARBITRATION}") < diff.index("--- /dev/null")
    assert "+++ /dev/null\n" in diff
    assert "+++ b/z/new.c\n@@ -0,0 +1 @@\n+int z;\n" in diff
    assert workspace.changed_paths() == ["README.md", ARBITRATION, "z/new.c"]
    assert workspace.line_counts() == [
        ("README.md", 0, 1),
        (ARBITRATION, 3, 1),
        ("z/new.c", 1, 0),
    ]


def test_a_file_written_back_to_what_it_was_is_not_a_change():
    workspace, _ = space()
    workspace.write(ARBITRATION, FILES[ARBITRATION])

    assert workspace.changed_paths() == []
    assert workspace.diff() == ""
    assert workspace.line_counts() == []


def test_an_empty_overlay_asks_the_git_host_nothing():
    workspace, reader = space()

    assert (workspace.diff(), workspace.changed_paths(), workspace.line_counts()) == (
        "",
        [],
        [],
    )
    assert reader.calls == []


def test_a_new_empty_file_and_a_missing_final_newline_still_diff():
    workspace, _ = space()
    workspace.write("empty.txt", "")
    workspace.write("README.md", "# helios-firmware\nno newline")

    assert workspace.changed_paths() == ["README.md", "empty.txt"]
    assert workspace.diff().endswith("\n")
    assert "+no newline\n" in workspace.diff()


def test_an_oversized_write_is_refused():
    workspace, _ = space()

    with pytest.raises(WorkspaceError) as refused:
        workspace.write("big.bin", "x" * (MAX_FILE_BYTES + 1))

    assert refused.value.code == "too_large"
    assert workspace.changed_paths() == []


# -- the cache --------------------------------------------------------------------------


def test_the_cache_evicts_the_least_recently_used_past_its_bound():
    cache = ReadCache(max_bytes=10)
    cache.put(("r", "s", "a"), "aaaa", 4)
    cache.put(("r", "s", "b"), "bbbb", 4)
    assert cache.get(("r", "s", "a")) == "aaaa"  # a is now the most recent
    cache.put(("r", "s", "c"), "cccc", 4)

    assert cache.get(("r", "s", "b")) is None
    assert cache.get(("r", "s", "a")) == "aaaa"
    assert cache.get(("r", "s", "c")) == "cccc"
    assert len(cache) == 2


def test_the_cache_does_not_hold_what_would_not_fit_and_replaces_in_place():
    cache = ReadCache(max_bytes=10)
    cache.put(("r", "s", "huge"), "x" * 11, 11)
    cache.put(("r", "s", "a"), "one", 3)
    cache.put(("r", "s", "a"), "two", 3)

    assert cache.get(("r", "s", "huge")) is None
    assert cache.get(("r", "s", "a")) == "two"
    assert len(cache) == 1


# -- the GitHub reader ------------------------------------------------------------------


class _Opener:
    def __init__(self, answer):
        self.answer = answer

    def open(self, prepared, timeout=None):  # noqa: ARG002 - urllib's signature
        if isinstance(self.answer, Exception):
            raise self.answer
        body = self.answer

        class _Answer:
            def read(self, _limit=None):
                return body

            def __enter__(self):
                return self

            def __exit__(self, *_exc):
                return False

        return _Answer()


def _reader(answer) -> GithubReader:
    return GithubReader(
        "https://api.github.com/", "o/r", SHA, None, opener=_Opener(answer)
    )


def test_the_tree_keeps_files_and_reports_truncation():
    listing = (
        b'{"tree": [{"path": "a.c", "type": "blob", "size": 3},'
        b' {"path": "dir", "type": "tree"}, {"path": "dir/b.c", "type": "blob"}],'
        b' "truncated": true}'
    )

    tree = _reader(listing).tree()

    assert isinstance(tree, Tree)
    assert [(e.path, e.size) for e in tree.entries] == [("a.c", 3), ("dir/b.c", 0)]
    assert tree.truncated is True


@pytest.mark.parametrize("body", [b"not json", b"[]", b'{"tree": [{"type": "blob"}]}'])
def test_a_tree_outside_the_contract_is_unavailable(body):
    with pytest.raises(WorkspaceError) as refused:
        _reader(body).tree()

    assert refused.value.code == "unavailable"


def test_http_failures_are_named():
    def http(status):
        return error.HTTPError("https://x", status, "nope", {}, None)

    with pytest.raises(WorkspaceError) as missing:
        _reader(http(404)).blob("a.c")
    with pytest.raises(WorkspaceError) as denied:
        _reader(http(403)).blob("a.c")
    with pytest.raises(WorkspaceError) as down:
        _reader(error.URLError("no route")).tree()
    with pytest.raises(WorkspaceError) as slow:
        _reader(TimeoutError()).tree()

    assert missing.value.code == "not_found"
    assert (denied.value.code, denied.value.message) == (
        "unavailable",
        "the git host answered 403",
    )
    assert down.value.code == slow.value.code == "unavailable"


# -- globs ------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("glob", "path", "matches"),
    [
        ("drivers/can/**", "drivers/can/arbitration.c", True),
        ("drivers/can/**", "drivers/can/sub/deep.c", True),
        ("drivers/can/**", "drivers/i2c/bus.c", False),
        ("drivers/*/Kconfig", "drivers/can/Kconfig", True),
        ("drivers/*/Kconfig", "drivers/can/sub/Kconfig", False),
        ("**/*.c", "main.c", True),
        ("**/*.c", "a/b/main.c", True),
        ("**/*.c", "a/b/main.h", False),
        ("*.md", "README.md", True),
        ("*.md", "docs/README.md", False),
        ("src/ma?n.c", "src/main.c", True),
        ("src/ma?n.c", "src/ma/n.c", False),
        ("a.b", "aXb", False),
        ("README.md", "README.md", True),
    ],
)
def test_glob_matching(glob, path, matches):
    assert glob_matches(glob, path) is matches
