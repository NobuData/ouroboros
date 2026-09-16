"""Drafting a batch of tickets — the contract, the parser behind it, and the seam between.

Epic AL (`#269 <https://github.com/NobuData/ouroboros/issues/269>`_), issue AL.1
(`#277 <https://github.com/NobuData/ouroboros/issues/277>`_). Four modules, and the split
between them is the same one :mod:`ouroboros_engine.estimation` makes, for the same reason:

* :mod:`~ouroboros_engine.planning.contract` is what ``ouroboros-rest`` is written against
  and is not allowed to change. It is published as ``schemas/plan/v0.json``.
* :mod:`~ouroboros_engine.planning.planner` is the seam — a one-method
  :class:`~ouroboros_engine.planning.planner.Planner` protocol, and the check that holds
  every batch to the caller's own vocabulary.
* :mod:`~ouroboros_engine.planning.outline` is the parser: a markdown outline in, the
  bullets and the annotations that were written on them out. Five rules, kept apart so a
  reviewer can argue with one at a time.
* :mod:`~ouroboros_engine.planning.outline_planner` is
  :class:`~ouroboros_engine.planning.outline_planner.OutlinePlanner` — ``outline-v0``, what
  ``create_app`` installs, and what decides what the parser's reading *means*.

**The point of the package is that it will be replaced and the contract will not.** Roadmap
decision **N2**: the planning page's headline promise — a narrative decomposed into tickets
— needs a model, the model needs AF.2
(`#235 <https://github.com/NobuData/ouroboros/issues/235>`_), and that is v2. Rather than
wait, or fake it with canned templates, ``/v0/plan`` is specified once and implemented
twice. AN.1 (`#289 <https://github.com/NobuData/ouroboros/issues/289>`_) answers this same
contract with a real planner, and the API, the UI, the sizing pipeline and the push path are
untouched by its arrival.

What keeps that promise checkable is ``schemas/plan/``: the JSON Schema both implementations
answer, and the recorded cases — the mockup's own OTA outline among them — that say what
this one answers today. ``tests/test_planning_golden.py`` holds it to them.

The route that calls into here is :mod:`ouroboros_engine.api.plan`.
"""

from ouroboros_engine.planning.contract import (
    Draft,
    Plan,
    PlanningContext,
    PlanRequest,
)
from ouroboros_engine.planning.outline import (
    Outline,
    OutlineItem,
    parse_outline,
)
from ouroboros_engine.planning.outline_planner import (
    NARRATIVE_ONLY_NOTE,
    OUTLINE_PLANNER,
    OutlinePlanner,
)
from ouroboros_engine.planning.planner import (
    Planner,
    PlannerContractError,
    honours_context,
)

__all__ = [
    "NARRATIVE_ONLY_NOTE",
    "OUTLINE_PLANNER",
    "Draft",
    "Outline",
    "OutlineItem",
    "OutlinePlanner",
    "Plan",
    "PlanRequest",
    "Planner",
    "PlannerContractError",
    "PlanningContext",
    "honours_context",
    "parse_outline",
]
