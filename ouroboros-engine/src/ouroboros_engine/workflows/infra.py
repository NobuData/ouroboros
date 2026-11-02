"""Whether an infrastructure stage builds or tests — one rule for the dry run and the live run.

The DSL has one ``infra`` node type for both (``build({farm})`` and a test stage alike), so the
stage's own name decides: a stage whose id or title has ``test`` as a word is a test run, and
anything else is a build. The deep dry run (CD.2, #560) asks the replay estimator with it, and
the live build stage (AJ.3, #265) names a failed one ``failed_tests`` or ``failed_build`` when
its gate loops back.
"""

from __future__ import annotations

import re
from typing import Literal

from ouroboros_engine.workflows.dsl import WorkflowNode

#: What an infrastructure stage does.
InfraKind = Literal["build", "test"]

_WORD = re.compile(r"[a-z0-9]+")


def infra_kind(node: WorkflowNode) -> InfraKind:
    """Decide whether an infrastructure stage is a build or a test run.

    Args:
        node: An infrastructure stage.

    Returns:
        ``test`` or ``build``.
    """
    words = _WORD.findall(f"{node.id} {node.title}".lower())
    return "test" if any(word in ("test", "tests") for word in words) else "build"
