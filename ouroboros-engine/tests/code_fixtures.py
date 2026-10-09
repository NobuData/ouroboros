"""A seeded fixture repository for the code & git mining tool (CL.4, #617).

Built with dulwich's object layer, every author, message and timestamp fixed, so every commit
id is the same on every machine and a test can name one. It is the mockup's
``helios-firmware`` in miniature:

```
2025-06-02  c0  Tune approach controller gains     dock_ctrl.c 200-230 written — never again
2025-07-01  c1  Add motor PID loop                 ← tag v2.0.4 (annotated)
2025-12-10  c2  Log dock state transitions         dock_ctrl.c line 12
2026-03-04  c3  Raise PID integral clamp           src/motor/pid.c
2026-05-20  c4  Gust feed-forward in PID           src/motor/pid.c, uses approach_kp  ← culprit
2026-06-11  c5  Docs: motor tuning notes           docs/motor.md
2026-07-09  c6  Retune PID derivative              src/motor/pid.c
2026-08-15  c7  Bump version                       VERSION    ← branches main, nightly
```

So ``blame(src/dock/dock_ctrl.c, 200-230)`` at ``nightly`` is *"unchanged in 14 months"*
(2025-06-02 → 2026-08-15), ``changed_between(v2.0.4, nightly, src/motor)`` is c3, c4 and c6,
and a bisect from v2.0.4 to nightly walks the six candidates c2…c7. The tree also carries a
little Python (``tools/sim``) and TypeScript (``web/src``) for the dependency graph.
"""

from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from dulwich.index import commit_tree
from dulwich.object_store import iter_tree_contents
from dulwich.objects import Blob, Commit, Tag
from dulwich.repo import Repo

AUTHOR = b"Ana Ortiz <ana@example.invalid>"
OTHER = b"Bo Chen <bo@example.invalid>"


def _dock_ctrl(state_log: bool) -> bytes:
    """``src/dock/dock_ctrl.c`` — 300 lines, the gains block at 200-230.

    Args:
        state_log: Whether line 12 logs state transitions (c2 onwards).

    Returns:
        The file.
    """
    lines = [f"/* dock_ctrl line {n} */" for n in range(1, 301)]
    lines[0] = '#include "dock_ctrl.h"'
    lines[1] = "#include <app/motor.h>"
    lines[2] = "#include <zephyr/kernel.h>"
    if state_log:
        lines[11] = 'LOG_INF("dock state %d", state);'
    for n in range(200, 231):
        lines[n - 1] = f"static const float approach_gain_{n} = 0.{n};"
    lines[213] = "static const float approach_kp = 1.40f; /* tuned 2025-06 */"
    return ("\n".join(lines) + "\n").encode()


def _pid(version: int) -> bytes:
    """``src/motor/pid.c`` at successive versions.

    Args:
        version: 1 (c1) to 4 (c6).

    Returns:
        The file.
    """
    lines = [
        '#include "pid.h"',
        "#include <app/motor.h>",
        "",
        "float pid_step(float e) {",
    ]
    lines.append("  integral += e;")
    if version >= 2:
        lines.append("  integral = clamp(integral, -8.0f, 8.0f);")
    if version >= 3:
        lines.append("  e += approach_kp * gust_estimate();")
    derivative = "0.02f" if version >= 4 else "0.01f"
    lines.append(f"  return 0.6f * e + 0.1f * integral + {derivative} * (e - last);")
    lines.append("}")
    return ("\n".join(lines) + "\n").encode()


_BASE: dict[str, bytes] = {
    "src/dock/dock_ctrl.h": b'#pragma once\n#include "../motor/pid.h"\n',
    "src/motor/pid.h": b"#pragma once\nfloat pid_step(float e);\n",
    "include/app/motor.h": b"#pragma once\n",
    "tools/sim/__init__.py": b"",
    "tools/sim/run.py": b"import numpy\nfrom tools.sim import plant\nfrom . import util\n",
    "tools/sim/plant.py": b"import math\n",
    "tools/sim/util.py": b"from tools.sim.plant import step\n",
    "web/src/index.ts": b"import { chart } from './chart';\nimport React from 'react';\n",
    "web/src/chart.ts": b"export * from './lib/axes';\nconst d3 = require('d3');\n",
    "web/src/lib/axes.ts": b"import '@acme/theme/tokens';\n",
    "VERSION": b"2.0.0\n",
}


@dataclass(frozen=True)
class SeededRepo:
    """The fixture, and the ids a test names.

    Attributes:
        path: The repository (bare) on disk — usable as a local remote.
        commits: ``c0`` … ``c7`` → 40-hex id.
    """

    path: Path
    commits: dict[str, str]

    def sha(self, name: str) -> str:
        """A commit's id.

        Args:
            name: ``c0`` … ``c7``.

        Returns:
            The 40-hex id.
        """
        return self.commits[name]


def _when(day: str) -> int:
    """Noon UTC on a day, as Unix seconds.

    Args:
        day: ``YYYY-MM-DD``.

    Returns:
        The timestamp.
    """
    return int(
        datetime.fromisoformat(f"{day}T12:00:00").replace(tzinfo=UTC).timestamp()
    )


def build_repo(path: Path) -> SeededRepo:
    """Write the fixture repository at ``path``.

    Args:
        path: An empty directory to create the bare repository in.

    Returns:
        The repository and its commit ids.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    repo = Repo.init_bare(str(path), mkdir=True)
    files = dict(_BASE)
    history = [
        (
            "c0",
            "2025-06-02",
            AUTHOR,
            "Tune approach controller gains",
            {"src/dock/dock_ctrl.c": _dock_ctrl(False)},
        ),
        (
            "c1",
            "2025-07-01",
            AUTHOR,
            "Add motor PID loop",
            {"src/motor/pid.c": _pid(1)},
        ),
        (
            "c2",
            "2025-12-10",
            OTHER,
            "Log dock state transitions",
            {"src/dock/dock_ctrl.c": _dock_ctrl(True)},
        ),
        (
            "c3",
            "2026-03-04",
            OTHER,
            "Raise PID integral clamp",
            {"src/motor/pid.c": _pid(2)},
        ),
        (
            "c4",
            "2026-05-20",
            AUTHOR,
            "Gust feed-forward in PID",
            {"src/motor/pid.c": _pid(3)},
        ),
        (
            "c5",
            "2026-06-11",
            OTHER,
            "Docs: motor tuning notes",
            {"docs/motor.md": b"# Motor tuning\n"},
        ),
        (
            "c6",
            "2026-07-09",
            AUTHOR,
            "Retune PID derivative",
            {"src/motor/pid.c": _pid(4)},
        ),
        ("c7", "2026-08-15", OTHER, "Bump version", {"VERSION": b"2.1.0-rc1\n"}),
    ]
    commits: dict[str, str] = {}
    parent: bytes | None = None
    for name, day, author, message, changes in history:
        files.update(changes)
        blobs = []
        for file_path, content in sorted(files.items()):
            blob = Blob.from_string(content)
            repo.object_store.add_object(blob)
            blobs.append((file_path.encode(), blob.id, 0o100644))
        commit = Commit()
        commit.tree = commit_tree(repo.object_store, blobs)
        commit.parents = [parent] if parent else []
        commit.author = commit.committer = author
        commit.author_time = commit.commit_time = _when(day)
        commit.author_timezone = commit.commit_timezone = 0
        commit.encoding = b"UTF-8"
        commit.message = message.encode() + b"\n"
        repo.object_store.add_object(commit)
        commits[name] = commit.id.decode()
        parent = commit.id
        if name == "c1":
            tag = Tag()
            tag.tagger = AUTHOR
            tag.message = b"v2.0.4\n"
            tag.name = b"v2.0.4"
            tag.object = (Commit, commit.id)
            tag.tag_time = _when(day)
            tag.tag_timezone = 0
            repo.object_store.add_object(tag)
            repo.refs[b"refs/tags/v2.0.4"] = tag.id
    repo.refs[b"refs/heads/main"] = parent
    repo.refs[b"refs/heads/nightly"] = parent
    repo.refs.set_symbolic_ref(b"HEAD", b"refs/heads/main")
    repo.close()
    return SeededRepo(path=path, commits=commits)


def add_commit(
    seeded: SeededRepo, message: str, day: str, changes: dict[str, bytes]
) -> str:
    """Push one more commit onto ``main`` of the fixture (as the remote moving on).

    Args:
        seeded: The fixture.
        message: The message.
        day: ``YYYY-MM-DD``.
        changes: Files to write.

    Returns:
        The new commit's id.
    """
    repo = Repo(str(seeded.path))
    head = repo.refs[b"refs/heads/main"]
    parent = repo[head]
    blobs = []
    for entry in iter_tree_contents(repo.object_store, parent.tree):
        blobs.append((entry.path, entry.sha, entry.mode))
    blobs = [item for item in blobs if item[0].decode() not in changes]
    for file_path, content in changes.items():
        blob = Blob.from_string(content)
        repo.object_store.add_object(blob)
        blobs.append((file_path.encode(), blob.id, 0o100644))
    commit = Commit()
    commit.tree = commit_tree(repo.object_store, blobs)
    commit.parents = [head]
    commit.author = commit.committer = AUTHOR
    commit.author_time = commit.commit_time = _when(day)
    commit.author_timezone = commit.commit_timezone = 0
    commit.message = message.encode() + b"\n"
    repo.object_store.add_object(commit)
    repo.refs[b"refs/heads/main"] = commit.id
    repo.close()
    return commit.id.decode()
