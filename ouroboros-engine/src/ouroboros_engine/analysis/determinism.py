"""The determinism check registration runs over an analyzer's source (#511).

An analyzer that reads the clock or an entropy source produces findings that depend on *when*
it ran, which makes "identical corpus → identical findings" false in a way no single test run
can see. So registration reads the source of the module an analyzer is defined in and refuses
any of these:

* **clock reads** — ``time.time``, ``time.monotonic``, ``time.perf_counter`` and their
  ``_ns`` forms, ``time.localtime``/``gmtime``/``ctime``/``strftime``, and ``now``,
  ``utcnow`` or ``today`` called on anything (``datetime.now()``, ``date.today()``,
  ``pd.Timestamp.now()``);
* **entropy** — ``uuid.uuid1``/``uuid4``, ``os.urandom``/``getrandom``, any import of
  :mod:`secrets`, ``random.SystemRandom``;
* **an unseeded generator** — ``default_rng()`` with no seed. (numpy's legacy global
  generator and :mod:`random` are seeded by the sandbox, so drawing from them is
  reproducible.)

The check is syntactic: it sees what the module's text calls, which is what a reviewer would
look for, and catches the honest mistake. It is not a proof against an analyzer determined
to hide a clock read — the repeat-run test, under two hash seeds, is the backstop.
"""

import ast
import inspect

#: ``module.function`` calls that read a clock or an entropy source.
FORBIDDEN_CALLS = frozenset(
    {
        "time.time",
        "time.time_ns",
        "time.monotonic",
        "time.monotonic_ns",
        "time.perf_counter",
        "time.perf_counter_ns",
        "time.localtime",
        "time.gmtime",
        "time.ctime",
        "time.strftime",
        "uuid.uuid1",
        "uuid.uuid4",
        "os.urandom",
        "os.getrandom",
        "random.SystemRandom",
    }
)

#: Method names that read the clock whatever they are called on.
FORBIDDEN_METHODS = frozenset({"now", "utcnow", "today"})

#: Names that, imported bare (``from time import time``), are clock or entropy reads.
FORBIDDEN_IMPORTS = frozenset(name.rsplit(".", 1)[1] for name in FORBIDDEN_CALLS)


def _dotted(node: ast.expr) -> str | None:
    """The dotted name an expression spells, if it is a plain name or attribute chain.

    Args:
        node: The expression.

    Returns:
        ``"a.b.c"``, or ``None`` for anything else.
    """
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        base = _dotted(node.value)
        return f"{base}.{node.attr}" if base else None
    return None


def violations(source: str) -> list[str]:
    """Every clock, entropy or unseeded-generator use in a module's source.

    Args:
        source: The module's text.

    Returns:
        ``"line N: <what>"`` per violation, in source order; empty for a clean module.
    """
    found: list[tuple[int, str]] = []
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import | ast.ImportFrom):
            module = node.module if isinstance(node, ast.ImportFrom) else None
            for alias in node.names:
                name = f"{module}.{alias.name}" if module else alias.name
                if (
                    name == "secrets"
                    or name.startswith("secrets.")
                    or module == "secrets"
                ):
                    found.append((node.lineno, "imports secrets"))
                elif module and name in FORBIDDEN_CALLS:
                    found.append((node.lineno, f"imports {name}"))
        elif isinstance(node, ast.Call):
            name = _dotted(node.func)
            if name is None:
                continue
            tail = name.rsplit(".", 1)[-1]
            if name in FORBIDDEN_CALLS or any(
                name.endswith(f".{c}") for c in FORBIDDEN_CALLS
            ):
                found.append((node.lineno, f"calls {name}()"))
            elif tail in FORBIDDEN_METHODS and "." in name:
                found.append((node.lineno, f"reads the clock with {name}()"))
            elif tail == "default_rng" and not node.args and not node.keywords:
                found.append(
                    (node.lineno, f"builds an unseeded generator with {name}()")
                )
    return [f"line {line}: {what}" for line, what in sorted(found)]


def check_class(cls: type) -> list[str]:
    """Run :func:`violations` over the module an analyzer class is defined in.

    Args:
        cls: The analyzer class.

    Returns:
        The violations; ``["source unavailable"]`` when the module's text cannot be read — an
        analyzer nobody can inspect is not admitted.
    """
    module = inspect.getmodule(cls)
    try:
        source = inspect.getsource(module) if module else None
    except (OSError, TypeError):
        source = None
    if source is None:
        return ["source unavailable"]
    return violations(source)
