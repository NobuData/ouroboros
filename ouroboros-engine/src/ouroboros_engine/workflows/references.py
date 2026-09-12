"""Decision **P7**: skill, model and task-route references are strings, and unknown ones warn.

The Python half of ``ouroboros-rest/src/modules/workflows/dsl.references.ts``.

The model registry (mockups 06/21) and the skills catalogue (mockup 14) do not exist. A foreign
key to a table nobody has written is not a stricter design, it is a design that cannot be
built; and refusing a workflow because it names a skill the workspace has not defined yet would
make the editor unusable during exactly the period the skill is being defined. So the reference
is stored as written, and whether it resolves is asked at validation, answered as a warning, and
rendered as a flag on the field rather than a block on the Publish button.

**The caller supplies the vocabulary.** This module holds no list of skills and no list of
models, so it cannot invent one — the same shape :class:`.estimation.contract.EstimationContext`
takes for the same reason (decisions K5 and K6). A caller that supplies no catalogue gets no
warnings of this kind, which is the honest answer to *is this reference known?* when nothing in
the system knows.

``runner_pool`` is deliberately not checked. Which pools exist is a property of a deployment's
build farm (mockup 08), not of the workspace's catalogues, and a warning against a list this
service does not have would be noise on every document.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from .dsl import LlmConfig, WorkflowDocument
from .errors import Diagnostic, DslWarningCode, pointer


@dataclass(frozen=True, slots=True)
class Catalogue:
    """The names that exist, as the caller knows them.

    Every member is optional and an absent one means *not checked*, which is different from an
    empty one meaning *nothing is known*. A caller that can enumerate skills but not models says
    so by supplying only ``skills``.
    """

    #: Every skill the workspace has defined.
    skills: Sequence[str] | None = None
    #: Every model identifier the registry resolves.
    models: Sequence[str] | None = None
    #: Every task name the routing table has a route for.
    tasks: Sequence[str] | None = None


def check_references(
    document: WorkflowDocument,
    catalogue: Catalogue | None,
) -> list[Diagnostic]:
    """Report every reference the catalogue does not list.

    Args:
        document: A document the schema and structural stages both accepted.
        catalogue: What the caller knows. ``None`` and nothing is reported.

    Returns:
        The warnings, unsorted — :mod:`ouroboros_engine.workflows.validate` orders the verdict.
    """
    if catalogue is None:
        return []

    warnings: list[Diagnostic] = []
    known_skills = None if catalogue.skills is None else set(catalogue.skills)
    known_models = None if catalogue.models is None else set(catalogue.models)
    known_tasks = None if catalogue.tasks is None else set(catalogue.tasks)

    for index, node in enumerate(document.nodes):
        config = node.config
        if not isinstance(config, LlmConfig):
            continue

        skill = config.skill
        if skill is not None and known_skills is not None and skill not in known_skills:
            warnings.append(
                Diagnostic(
                    code=DslWarningCode.REFERENCE_UNKNOWN_SKILL,
                    path=pointer("nodes", index, "config", "skill"),
                    message=f"No skill named `{skill}` is defined in this workspace yet.",
                    node=node.id,
                )
            )

        pinned = config.routing.pinned_model
        if (
            pinned is not None
            and known_models is not None
            and pinned not in known_models
        ):
            warnings.append(
                Diagnostic(
                    code=DslWarningCode.REFERENCE_UNKNOWN_MODEL,
                    path=pointer("nodes", index, "config", "routing", "pinned_model"),
                    message=f"No model named `{pinned}` is in the registry.",
                    node=node.id,
                )
            )

        inherited = config.routing.inherit_task
        if (
            inherited is not None
            and known_tasks is not None
            and inherited not in known_tasks
        ):
            warnings.append(
                Diagnostic(
                    code=DslWarningCode.REFERENCE_UNKNOWN_TASK,
                    path=pointer("nodes", index, "config", "routing", "inherit_task"),
                    message=f"No route is configured for the task `{inherited}`.",
                    node=node.id,
                )
            )

    return warnings
