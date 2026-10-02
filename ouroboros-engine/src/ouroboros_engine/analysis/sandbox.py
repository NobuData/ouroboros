"""The process one analyzer runs in (#511): ``python -m ouroboros_engine.analysis.sandbox``.

The harness starts one of these per analyzer per run, writes a request to its stdin and reads
one JSON result from its stdout. Everything an analyzer must not do is made impossible *here*,
before its module is even imported, rather than asked of it:

* **No network, no subprocess** — the tenant-locality rule (decision A2). A
  :func:`sys.addaudithook` hook, which cannot be removed once installed, refuses every socket
  creation, connection and name lookup, and every way of starting another program (which would
  otherwise be a way round the first). A refused attempt raises :class:`SandboxViolationError`, and
  the run is reported ``failed`` even if the analyzer caught the exception and carried on.
  The hook sees Python-level access; a C extension making raw system calls would need a
  network namespace or seccomp, which is the container's layer, not this one.
* **A memory budget** — ``RLIMIT_AS`` set to the request's ``memory_bytes``. Exhausting it is
  a ``MemoryError`` here and ``memory_exceeded`` in the report.
* **Fixed seeds** — :mod:`random` and numpy's global generator are seeded to
  :data:`~ouroboros_engine.analysis.spi.ANALYSIS_SEED`.
* **A clean environment** — the harness starts this process with an allow-listed
  environment, so no shared secret, proxy or credential is visible to analyzer code.
* **Its own stdout** — the analyzer's ``print`` goes to stderr; stdout carries exactly one JSON
  document, so a chatty analyzer cannot corrupt its own result.

The time budget is the harness's: it kills this process when the budget runs out.

Request ``{analyzer: "module:qualname", corpus: {…}, memory_bytes: n}``; result ``{status:
completed, findings: […]}`` or ``{status: failed | memory_exceeded, error: {type, message,
traceback}}``.
"""

import json
import os
import random
import resource
import sys
import traceback
from typing import Any

import numpy as np

from ouroboros_engine.analysis.contract import Corpus, Finding
from ouroboros_engine.analysis.spi import ANALYSIS_SEED

#: Audit events that reach the network or start another program. ``os.exec`` and friends are
#: here because a child process is a way round the socket ban.
BLOCKED_EVENTS = frozenset(
    {
        "socket.__new__",
        "socket.bind",
        "socket.connect",
        "socket.getaddrinfo",
        "socket.gethostbyaddr",
        "socket.gethostbyname",
        "socket.sendmsg",
        "socket.sendto",
        "subprocess.Popen",
        "os.exec",
        "os.fork",
        "os.forkpty",
        "os.posix_spawn",
        "os.spawn",
        "os.system",
    }
)


class SandboxViolationError(PermissionError):
    """An analyzer tried to reach the network or start a process."""


#: The first violation seen, kept even if the analyzer swallows the exception.
_violations: list[str] = []


def _audit(event: str, _args: tuple[Any, ...]) -> None:
    """Refuse a blocked audit event.

    Args:
        event: The audit event name.
        _args: Its arguments — not inspected; every instance is refused.

    Raises:
        SandboxViolationError: The event is in :data:`BLOCKED_EVENTS`.
    """
    if event in BLOCKED_EVENTS:
        _violations.append(event)
        raise SandboxViolationError(
            f"analyzers may not reach the network or start processes ({event})"
        )


def _confine(memory_bytes: int) -> None:
    """Apply the memory budget, the network and process ban, and the seeds.

    Args:
        memory_bytes: The address-space limit.
    """
    resource.setrlimit(resource.RLIMIT_AS, (memory_bytes, memory_bytes))
    random.seed(ANALYSIS_SEED)
    # The legacy global generator, seeded on purpose: it is what unseeded code would draw on.
    np.random.seed(ANALYSIS_SEED)
    sys.addaudithook(_audit)


def _error(status: str, error: BaseException) -> dict[str, Any]:
    """A result describing an exception.

    Args:
        status: ``failed`` or ``memory_exceeded``.
        error: What was raised.

    Returns:
        The result document.
    """
    return {
        "status": status,
        "error": {
            "type": type(error).__qualname__,
            "message": str(error)[:2000],
            "traceback": "".join(traceback.format_exception(error)),
        },
    }


def run(request: dict[str, Any]) -> dict[str, Any]:
    """Confine this process, then load and run one analyzer.

    Args:
        request: ``{analyzer, corpus, memory_bytes}``.

    Returns:
        The result document.
    """
    _confine(int(request["memory_bytes"]))
    # Imported after confinement: the analyzer's module-level code is analyzer code too.
    from ouroboros_engine.analysis.registry import load_analyzer

    try:
        cls = load_analyzer(request["analyzer"])
        corpus = Corpus.model_validate(request["corpus"])
        findings = cls().analyze(corpus)
        for finding in findings:
            if not isinstance(finding, Finding):
                raise TypeError(
                    f"analyze() returned {type(finding).__name__}, not Finding"
                )
            if (finding.analyzer, finding.analyzer_version) != (cls.id, cls.version):
                raise ValueError(
                    f"a finding claims {finding.analyzer}@v{finding.analyzer_version}, "
                    f"not {cls.id}@v{cls.version}"
                )
        if _violations:
            raise SandboxViolationError(
                f"the analyzer attempted {_violations[0]} and carried on; its findings are void"
            )
        return {
            "status": "completed",
            "findings": [f.model_dump(mode="json") for f in findings],
        }
    except MemoryError as error:
        return _error("memory_exceeded", error)
    except Exception as error:  # isolation is the point: any failure is this analyzer's
        return _error("failed", error)


def main() -> None:
    """Read a request from stdin, run it, write one JSON result to the real stdout."""
    request = json.load(sys.stdin)
    result_stream = os.fdopen(os.dup(sys.stdout.fileno()), "w", encoding="utf-8")
    sys.stdout = sys.stderr
    result = run(request)
    result_stream.write(json.dumps(result, ensure_ascii=False))
    result_stream.flush()


if __name__ == "__main__":
    main()
