"""``dep_graph(module)`` — language-aware where the stack is known, ``unsupported`` otherwise.

Three stacks, each read the way its own toolchain resolves a dependency, statically and without
running anything:

* ``c`` — ``#include "…"`` and ``#include <…>`` in ``.c .h .cc .cpp .cxx .hh .hpp``. A quoted
  include is looked for beside the file first; any include is then matched against the
  repository's files by path suffix (``#include <app/dock.h>`` finds ``include/app/dock.h``).
  What matches nothing is external — a toolchain or SDK header.
* ``python`` — ``import`` and ``from … import`` (relative ones included) parsed with
  :mod:`ast`; ``a.b`` matches ``…/a/b.py`` or ``…/a/b/__init__.py``.
* ``javascript`` — ``import … from``, ``export … from``, bare ``import``, ``require()`` and
  ``import()`` in ``.js .jsx .mjs .cjs .ts .tsx``; a relative specifier resolves with the usual
  extensions and ``index`` files, a bare one is an external package.

**Unsupported is an answer, not an empty graph.** With no stack (repository detection does not
know one) or a module holding no file of its stack, the answer is ``status: unsupported`` with
the reason — a graph with no edges would read as "no dependencies".
"""

import ast
import posixpath
import re
from collections import Counter
from collections.abc import Callable, Iterable

from ouroboros_engine.code.contract import CloneInfo, DepEdge, DepGraph, DepStack
from ouroboros_engine.code.repo import ReadOnlyRepo

#: The most files under a module one graph reads.
MAX_FILES = 2000

#: The most files of the stack the whole-repository index holds, for resolution.
MAX_INDEX = 50_000

#: Files larger than this are listed as nodes but not parsed.
MAX_FILE_BYTES = 524_288

#: Each stack's file extensions.
EXTENSIONS: dict[str, tuple[str, ...]] = {
    "c": (".c", ".h", ".cc", ".cpp", ".cxx", ".hh", ".hpp"),
    "python": (".py",),
    "javascript": (".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"),
}

#: How each stack is named in a reason.
LABELS: dict[str, str] = {"c": "C/C++", "python": "Python", "javascript": "JS/TS"}

_INCLUDE = re.compile(r'^[ \t]*#[ \t]*include[ \t]*([<"])([^>"\n]+)[>"]', re.MULTILINE)
_JS_SPECIFIERS = re.compile(
    r"""(?:\bimport\s+(?:[^'";]*?\s+from\s+)?|\bexport\s+[^'";]*?\s+from\s+|"""
    r"""\brequire\s*\(\s*|\bimport\s*\(\s*)(['"])([^'"\n]+)\1"""
)
_JS_RESOLVE = ("", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs")
_JS_INDEX = ("/index.ts", "/index.tsx", "/index.js", "/index.jsx")


def dep_graph(
    repo: ReadOnlyRepo,
    clone: CloneInfo,
    ref: str,
    module: str | None,
    stack: DepStack | None,
) -> DepGraph:
    """A module's dependency graph at a ref.

    Args:
        repo: The clone.
        clone: Where it was read, echoed.
        ref: The ref.
        module: The directory to graph, or ``None`` for the whole tree.
        stack: The stack repository detection reports, or ``None``.

    Returns:
        The graph, or ``status: unsupported`` with the reason.

    Raises:
        PathNotFoundError: The module is not a directory at the ref.
    """
    sha = repo.resolve(ref)
    directory = module or ""
    under = list(repo.files_under(sha, directory))  # PathNotFoundError for a bad module

    def unsupported(reason: str) -> DepGraph:
        return DepGraph(
            clone=clone,
            ref=ref,
            sha=sha,
            module=module,
            stack=stack,
            status="unsupported",
            reason=reason,
            nodes=[],
            edges=[],
            module_edges=[],
            external=[],
            truncated=False,
        )

    if stack is None:
        return unsupported(
            "dependency graphs are read for C/C++, Python and JS/TS; repository "
            "detection does not report one of those stacks for this repository"
        )
    extensions = EXTENSIONS[stack]
    mine = sorted(path for path, _ in under if path.endswith(extensions))
    if not mine:
        place = module or "the repository"
        return unsupported(f"there are no {LABELS[stack]} sources under {place}")

    index = sorted(
        path
        for path, _ in _bounded(repo.files_under(sha, ""), MAX_INDEX)
        if path.endswith(extensions)
    )
    resolver = _Resolver(index)
    blobs = dict(under)
    truncated = len(mine) > MAX_FILES
    nodes = mine[:MAX_FILES]

    edges: set[tuple[str, str]] = set()
    external: set[str] = set()
    parse = _PARSERS[stack]
    for path in nodes:
        content = repo.blob_by_id(blobs[path]) or b""
        if len(content) > MAX_FILE_BYTES:
            continue
        text = content.decode("utf-8", "replace")
        for target, outside in parse(path, text, resolver):
            if target is not None and target != path:
                edges.add((path, target))
            elif outside is not None:
                external.add(outside)

    rolled = Counter(
        (posixpath.dirname(source) or ".", posixpath.dirname(target) or ".")
        for source, target in edges
    )
    return DepGraph(
        clone=clone,
        ref=ref,
        sha=sha,
        module=module,
        stack=stack,
        status="ok",
        reason=None,
        nodes=nodes,
        edges=[DepEdge(source=s, target=t) for s, t in sorted(edges)],
        module_edges=[
            DepEdge(source=s, target=t, weight=w)
            for (s, t), w in sorted(rolled.items())
            if s != t
        ],
        external=sorted(external),
        truncated=truncated,
    )


class _Resolver:
    """Finds the repository file an import names."""

    def __init__(self, files: list[str]) -> None:
        """Index the stack's files.

        Args:
            files: Every file of the stack in the repository, sorted.
        """
        self.files = set(files)
        self._by_name: dict[str, list[str]] = {}
        for path in files:
            self._by_name.setdefault(posixpath.basename(path), []).append(path)

    def exact(self, path: str) -> str | None:
        """A path, if it is a file of the stack.

        Args:
            path: Repository-relative, normalised.

        Returns:
            The path, or ``None``.
        """
        return path if path in self.files else None

    def suffix(self, spec: str, near: str) -> str | None:
        """The file whose path ends with ``spec`` — the nearest when several do.

        Args:
            spec: ``app/dock.h`` or ``pkg/mod.py``.
            near: The importing file, to break ties by shared directory.

        Returns:
            The file, or ``None``.
        """
        spec = spec.lstrip("/")
        found = [
            path
            for path in self._by_name.get(posixpath.basename(spec), [])
            if path == spec or path.endswith(f"/{spec}")
        ]
        if not found:
            return None
        return min(found, key=lambda path: (-_shared(path, near), len(path), path))


def _shared(left: str, right: str) -> int:
    """How many leading directories two paths share.

    Args:
        left: A path.
        right: Another.

    Returns:
        The count.
    """
    count = 0
    for a, b in zip(left.split("/")[:-1], right.split("/")[:-1], strict=False):
        if a != b:
            break
        count += 1
    return count


Found = tuple[str | None, str | None]


def _c(path: str, text: str, resolver: _Resolver) -> Iterable[Found]:
    """C/C++ includes.

    Args:
        path: The file.
        text: Its content.
        resolver: The repository's files.

    Yields:
        ``(file, None)`` for an include in the repository, ``(None, "<spec>")`` otherwise.
    """
    for quote, spec in _INCLUDE.findall(text):
        target = None
        if quote == '"':
            target = resolver.exact(_join(posixpath.dirname(path), spec))
        target = target or resolver.suffix(spec, path)
        yield (target, None) if target else (None, f"<{spec}>")


def _python(path: str, text: str, resolver: _Resolver) -> Iterable[Found]:
    """Python imports.

    Args:
        path: The file.
        text: Its content.
        resolver: The repository's files.

    Yields:
        ``(file, None)`` for a module in the repository, ``(None, top-level name)`` otherwise.
    """
    try:
        tree = ast.parse(text)
    except (SyntaxError, ValueError):
        return
    package = posixpath.dirname(path)
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                yield _python_module(alias.name, resolver, path)
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                base = package
                for _ in range(node.level - 1):
                    base = posixpath.dirname(base)
                stem = _join(base, (node.module or "").replace(".", "/"))
                for alias in node.names:
                    candidates = [f"{stem}/{alias.name}", stem] if stem else []
                    target = next(
                        (hit for c in candidates if (hit := _python_file(c, resolver))),
                        None,
                    )
                    if target:
                        yield (target, None)
            elif node.module:
                names = [f"{node.module}.{alias.name}" for alias in node.names]
                for name in names:
                    target, _ = _python_module(name, resolver, path)
                    if target:
                        yield (target, None)
                        break
                else:
                    yield _python_module(node.module, resolver, path)


def _python_module(name: str, resolver: _Resolver, near: str) -> Found:
    """A dotted module, resolved.

    Args:
        name: ``a.b.c``.
        resolver: The repository's files.
        near: The importing file.

    Returns:
        ``(file, None)`` or ``(None, top-level name)``.
    """
    stem = name.replace(".", "/")
    target = resolver.suffix(f"{stem}.py", near) or resolver.suffix(
        f"{stem}/__init__.py", near
    )
    return (target, None) if target else (None, name.split(".")[0])


def _python_file(stem: str, resolver: _Resolver) -> str | None:
    """A relative module's file.

    Args:
        stem: The repository-relative path without extension.
        resolver: The repository's files.

    Returns:
        ``stem.py`` or ``stem/__init__.py`` when it exists.
    """
    return resolver.exact(f"{stem}.py") or resolver.exact(f"{stem}/__init__.py")


def _javascript(path: str, text: str, resolver: _Resolver) -> Iterable[Found]:
    """JS/TS imports, exports-from and requires.

    Args:
        path: The file.
        text: Its content.
        resolver: The repository's files.

    Yields:
        ``(file, None)`` for a relative specifier that resolves, ``(None, package)`` for a
        bare one.
    """
    for _, spec in _JS_SPECIFIERS.findall(text):
        if spec.startswith("."):
            base = _join(posixpath.dirname(path), spec)
            target = next(
                (
                    hit
                    for candidate in [base + ext for ext in _JS_RESOLVE]
                    + [base + index for index in _JS_INDEX]
                    if (hit := resolver.exact(candidate))
                ),
                None,
            )
            if target:
                yield (target, None)
        else:
            parts = spec.split("/")
            package = "/".join(parts[:2]) if spec.startswith("@") else parts[0]
            yield (None, package)


_PARSERS: dict[str, Callable[[str, str, _Resolver], Iterable[Found]]] = {
    "c": _c,
    "python": _python,
    "javascript": _javascript,
}


def _join(directory: str, relative: str) -> str:
    """A relative path joined and normalised.

    Args:
        directory: The base, repository-relative.
        relative: The path to join.

    Returns:
        The normalised path; ``""`` when it would leave the repository.
    """
    joined = posixpath.normpath(posixpath.join(directory, relative))
    return "" if joined.startswith("..") or joined == "." else joined


def _bounded(
    items: Iterable[tuple[str, bytes]], limit: int
) -> Iterable[tuple[str, bytes]]:
    """At most ``limit`` items.

    Args:
        items: The items.
        limit: The bound.

    Yields:
        The first ``limit`` of them.
    """
    for count, item in enumerate(items):
        if count >= limit:
            return
        yield item
