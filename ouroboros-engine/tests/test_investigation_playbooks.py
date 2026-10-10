"""The synthesis templates a playbook selects, and the refusal of one this build lacks."""

import pytest

from investigation_fakes import PLAYBOOKS
from ouroboros_engine.investigation.contract import DEPTH_PRESETS, InvestigationPlaybook
from ouroboros_engine.investigation.playbooks import (
    TEMPLATES,
    UnsupportedPlaybookError,
    template_for,
)


@pytest.mark.parametrize("kind", sorted(PLAYBOOKS))
def test_every_built_in_playbook_resolves_and_covers_its_deliverables(
    kind: str,
) -> None:
    playbook = InvestigationPlaybook.model_validate(PLAYBOOKS[kind])

    template = template_for(playbook)

    assert template.plan and template.brief
    for deliverable in playbook.deliverables:
        if deliverable != "brief":
            assert '"cites"' in template.deliverables[deliverable]


def test_the_four_built_in_kinds_are_four_templates_and_nothing_else() -> None:
    assert sorted(TEMPLATES) == sorted(
        playbook["synthesis_template"] for playbook in PLAYBOOKS.values()
    )


def test_an_unknown_template_is_refused_by_name() -> None:
    playbook = InvestigationPlaybook.model_validate(
        {**PLAYBOOKS["gap_analysis"], "synthesis_template": "gap_analysis@2"}
    )
    with pytest.raises(UnsupportedPlaybookError, match="gap_analysis@2"):
        template_for(playbook)


def test_a_deliverable_the_template_cannot_shape_is_refused() -> None:
    playbook = InvestigationPlaybook.model_validate(
        {**PLAYBOOKS["gap_analysis"], "deliverables": ["brief", "matrix", "fix_draft"]}
    )
    with pytest.raises(UnsupportedPlaybookError, match="fix_draft"):
        template_for(playbook)


def test_a_brief_only_playbook_needs_no_deliverable_shape() -> None:
    playbook = InvestigationPlaybook.model_validate(
        {**PLAYBOOKS["bug_root_cause"], "deliverables": ["brief"]}
    )
    assert template_for(playbook) is TEMPLATES["bug_root_cause@1"]


def test_the_depth_presets_are_the_scope_estimates_calibration() -> None:
    # estimate.calibration.ts, version 1: rounds and synthesis passes per depth.
    assert {
        depth: (preset.iterations, preset.synthesis_passes)
        for depth, preset in DEPTH_PRESETS.items()
    } == {"quick": (1, 1), "standard": (2, 2), "deep_dive": (4, 4)}
