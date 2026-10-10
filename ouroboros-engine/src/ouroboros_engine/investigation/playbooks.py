"""Synthesis templates — the wording a kind's playbook selects (decision V10).

A playbook (``investigation_kinds.playbook``) names a ``synthesis_template`` such as
``gap_analysis@1`` and a set of deliverables. This module is the registry those names resolve
in. A template is **words and shapes, never behaviour**: how to decompose a question of this
kind, what a brief of this kind argues, and what JSON each deliverable input takes. The loop
(:mod:`.loop`) runs every kind through the same steps and reads a template only to fill its
prompts — which is what lets four kinds ship on one engine and a fifth arrive as a template.

Templates are versioned in their key. Changing a template's wording is a new ``@<n>`` entry
and a playbook version bump, so *which words produced RS-127's brief* stays answerable.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .contract import InvestigationPlaybook

#: How a deliverable's items say what they lean on, and what happens when they cannot.
_CITES_RULE = (
    'Every item carries "cites": the cite keys of the ledger sources that support it. '
    "An item with no supporting source is not dropped: give it an empty cites list."
)


@dataclass(frozen=True)
class SynthesisTemplate:
    """The wording of one investigation kind.

    Attributes:
        plan: How to decompose a question of this kind into research questions.
        brief: What a brief of this kind sets out to establish.
        deliverables: For each deliverable besides the brief this template can produce,
            the JSON object the model is asked for.
    """

    plan: str
    brief: str
    deliverables: dict[str, str] = field(default_factory=dict)


#: The templates, by ``<name>@<version>``. The four built-in kinds' v1 playbooks (V106) name
#: the four entries below.
TEMPLATES: dict[str, SynthesisTemplate] = {
    "gap_analysis@1": SynthesisTemplate(
        plan=(
            "This is a gap analysis: where does our product stand against named rivals, "
            "and why. Ask one research question per capability area the question touches, "
            "one about what each rival ships, and one about what our own code, tickets and "
            "telemetry say about our side."
        ),
        brief=(
            "State where the gap is and what causes it. Compare what rivals demonstrably "
            "ship with what our own code, tickets and telemetry show, capability by "
            "capability."
        ),
        deliverables={
            "matrix": (
                '{"title": string, "us": string, "rivals": [string], "rows": '
                '[{"capability": string, "gap": "high"|"med"|"low"|"wip"|"lead", '
                '"cells": [{"subject": string, "status": '
                '"shipping"|"partial"|"beta"|"in_flight"|"none"|"unknown", "cites": '
                "[string]}]}]} — one cell per subject (us and every rival) in every row. "
                'A cell you have no source for has status "unknown". ' + _CITES_RULE
            ),
        },
    ),
    "bug_root_cause@1": SynthesisTemplate(
        plan=(
            "This is a bug root-cause investigation. Ask what the symptom is and when it "
            "appears, which code paths are involved, what changed in them, and what "
            "tickets or telemetry corroborate each candidate cause."
        ),
        brief=(
            "Name the most likely root cause and the evidence for it, the causes that "
            "were ruled out, and what would confirm the diagnosis."
        ),
        deliverables={
            "fix_draft": (
                '{"title": string, "hypothesis": string, "suspects": [{"where": string, '
                '"why": string, "cites": [string]}], "fix": string, "repro": string, '
                '"cites": [string]} — what a fix ticket needs. ' + _CITES_RULE
            ),
        },
    ),
    "regression_forensics@1": SynthesisTemplate(
        plan=(
            "This is regression forensics: a metric moved between a baseline and now. "
            "Ask what moved and by how much, which commits landed in the window, which of "
            "them touch the affected path, and what a bisect or telemetry comparison says."
        ),
        brief=(
            "Name the change that caused the regression, the measurements that show it, "
            "and what was excluded."
        ),
        deliverables={
            "fix_draft": (
                '{"title": string, "hypothesis": string, "culprit": {"commit": string, '
                '"why": string, "cites": [string]}, "fix": string, "repro": string, '
                '"cites": [string]} — what a fix ticket needs. ' + _CITES_RULE
            ),
        },
    ),
    "roadmap_improvements@1": SynthesisTemplate(
        plan=(
            "This is a roadmap investigation: what should be built next, and why. Ask "
            "what customers and tickets ask for, how often, what rivals already offer, "
            "and what each candidate would cost us."
        ),
        brief=(
            "Group the evidence into themes, rank them by how strongly the sources "
            "support them, and propose an order to build them in."
        ),
        deliverables={
            "roadmap_doc": (
                '{"title": string, "themes": [{"title": string, "rationale": string, '
                '"cites": [string]}], "milestones": [{"title": string, "themes": '
                '[string], "outcome": string}]} — the input of a roadmap document. '
                + _CITES_RULE
            ),
        },
    ),
}


class UnsupportedPlaybookError(ValueError):
    """A playbook names a template, or a deliverable, this build cannot produce."""


def template_for(playbook: InvestigationPlaybook) -> SynthesisTemplate:
    """Resolve a playbook's template, and check it covers the playbook's deliverables.

    Args:
        playbook: The kind's playbook.

    Returns:
        The template.

    Raises:
        UnsupportedPlaybookError: When the template is unknown, or the playbook asks for a
            deliverable the template has no shape for. Refused when the investigation is
            submitted, so it never starts work it cannot deliver.
    """
    template = TEMPLATES.get(playbook.synthesis_template)
    if template is None:
        raise UnsupportedPlaybookError(
            f'this engine has no synthesis template "{playbook.synthesis_template}"'
        )
    missing = [
        deliverable
        for deliverable in playbook.deliverables
        if deliverable != "brief" and deliverable not in template.deliverables
    ]
    if missing:
        raise UnsupportedPlaybookError(
            f'synthesis template "{playbook.synthesis_template}" does not produce '
            + ", ".join(missing)
        )
    return template
