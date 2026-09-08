"""The four rules, one at a time, and the two classifications beside them.

Testing the rules apart from the estimator is what makes the estimator's own suite readable:
here is where "a ``migrate`` in the title reads as ``xl``" is asserted, so
:mod:`tests.test_estimation_heuristic` can be about aggregation, provenance and determinism
rather than about re-deriving every table.

Three properties get more attention than the tables do, because they are the ones a plausible
rewrite would quietly break: a rule votes for the **strongest** thing it saw rather than the
first or the average, ties break **alphabetically** so the answer does not depend on the order
GitHub returned the labels in, and a rule that has nothing to say **abstains** rather than
guessing — which is the input the estimator's confidence is computed from.
"""

import pytest

from ouroboros_engine.estimation.contract import EFFORTS, IssueContext
from ouroboros_engine.estimation.signals import (
    BODY_EFFORT,
    BODY_RULE,
    CHECKLIST_EFFORT,
    CHECKLIST_RULE,
    DEPS_REFRESH,
    DOCS_LOOP,
    EFFORT_RULES,
    FEATURE_LOOP,
    LABEL_EFFORT,
    LABEL_RULE,
    RISK_LOWERING_LABELS,
    RISK_RAISING_LABELS,
    STANDARD_FIX,
    TITLE_EFFORT,
    TITLE_RULE,
    WORKFLOW_HINTS,
    body_effort,
    checklist_effort,
    effort_ordinal,
    has_description,
    label_effort,
    label_keys,
    normalise,
    risk_label,
    strongest,
    title_effort,
    title_words,
    workflow_signal,
)


def issue(
    *,
    title: str = "Something happened",
    body: str | None = "A description long enough to be read as a description.",
    labels: tuple[str, ...] = (),
) -> IssueContext:
    """Build an issue with only the parts a rule under test cares about.

    Args:
        title: The issue title.
        body: The description, or ``None`` for an issue opened without one.
        labels: The label names.

    Returns:
        A valid :class:`~ouroboros_engine.estimation.contract.IssueContext`.
    """
    return IssueContext(
        number=485,
        title=title,
        body=body,
        labels=list(labels),
        repo="acme-robotics/helios-firmware",
    )


# ---------------------------------------------------------------------------
# Normalising what GitHub actually sends
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("label", "expected"),
    [
        ("good first issue", "good-first-issue"),
        ("Good-First-Issue", "good-first-issue"),
        ("GOOD_FIRST_ISSUE", "good-first-issue"),
        ("kind/bug", "kind-bug"),
        ("Type: Bug", "type-bug"),
        ("  bug  ", "bug"),
        (":::", ""),
    ],
)
def test_a_label_normalises_to_the_form_the_tables_are_keyed_by(
    label: str, expected: str
) -> None:
    # GitHub's own default label is `good first issue`, with spaces. A table keyed by one
    # spelling would be a table that missed the most common one.
    assert normalise(label) == expected


def test_a_namespaced_label_is_looked_up_under_its_last_segment_too() -> None:
    assert label_keys("kind/bug") == ("kind-bug", "bug")


def test_a_single_word_label_has_only_itself_to_be_looked_up_under() -> None:
    assert label_keys("bug") == ("bug",)


def test_the_whole_label_is_offered_before_its_tail() -> None:
    # Order matters more than the pair does: `tech-debt` is in the table and `debt` is not,
    # so the whole form is what answers — and it would still answer first if `debt` were
    # ever added, because `label_effort` reads the keys in the order this returns them.
    assert label_keys("tech-debt") == ("tech-debt", "debt")
    assert (
        label_effort(issue(labels=("tech-debt",))).effort == LABEL_EFFORT["tech-debt"]
    )


def test_a_label_of_pure_punctuation_has_no_keys() -> None:
    assert label_keys("///") == ()


def test_a_title_becomes_lower_case_words() -> None:
    assert title_words("Watchdog reset on I²C bus lockup") == (
        "watchdog",
        "reset",
        "on",
        "i",
        "c",
        "bus",
        "lockup",
    )


@pytest.mark.parametrize("body", [None, "", "   \n\t  "])
def test_a_blank_description_is_no_description(body: str | None) -> None:
    # K.1's column is nullable because GitHub makes no distinction between an empty
    # description and no description, and neither does anything that has to read one.
    assert not has_description(issue(body=body))


# ---------------------------------------------------------------------------
# The scale
# ---------------------------------------------------------------------------


def test_the_scale_is_the_contracts_own_order() -> None:
    assert [effort_ordinal(effort) for effort in EFFORTS] == [0, 1, 2, 3, 4]


def test_the_strongest_of_several_efforts_is_the_largest() -> None:
    assert strongest(["s", "xl", "m"]) == "xl"


def test_the_strongest_of_none_is_a_bug_rather_than_a_default() -> None:
    with pytest.raises(ValueError, match="strongest"):
        strongest([])


# ---------------------------------------------------------------------------
# label-effort
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(("label", "expected"), sorted(LABEL_EFFORT.items()))
def test_every_label_in_the_table_is_reachable(label: str, expected: str) -> None:
    # An entry nothing can produce is an entry nobody maintains.
    signal = label_effort(issue(labels=(label,)))

    assert signal is not None
    assert signal.effort == expected
    assert signal.rule == LABEL_RULE


def test_an_unknown_label_leaves_the_rule_silent() -> None:
    assert label_effort(issue(labels=("i2c", "watchdog"))) is None


def test_no_labels_at_all_leaves_the_rule_silent() -> None:
    assert label_effort(issue(labels=())) is None


def test_the_strongest_label_wins_rather_than_the_first() -> None:
    signal = label_effort(issue(labels=("good-first-issue", "epic")))

    assert signal is not None
    assert signal.effort == "xl"
    assert "epic" in signal.observation


def test_the_answer_does_not_depend_on_the_order_the_labels_arrived_in() -> None:
    forwards = label_effort(issue(labels=("bug", "defect")))
    backwards = label_effort(issue(labels=("defect", "bug")))

    assert forwards == backwards
    assert forwards is not None
    # Alphabetical among equals, so a re-sync that reorders labels does not re-write a
    # trace that says which label was read.
    assert "bug" in forwards.observation


def test_a_namespaced_label_is_read_as_the_label_it_namespaces() -> None:
    signal = label_effort(issue(labels=("kind/bug",)))

    assert signal is not None
    assert signal.effort == "m"
    # Reported under the name the caller sent, not the key it matched.
    assert signal.observation == 'the "kind/bug" label'


def test_the_signal_line_is_the_rule_the_observation_and_the_vote() -> None:
    signal = label_effort(issue(labels=("bug",)))

    assert signal is not None
    assert signal.line == 'label-effort: the "bug" label -> m'


# ---------------------------------------------------------------------------
# title-verb
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(("word", "expected"), sorted(TITLE_EFFORT.items()))
def test_every_title_word_in_the_table_is_reachable(word: str, expected: str) -> None:
    signal = title_effort(issue(title=f"Please {word} the thing"))

    assert signal is not None
    assert signal.effort == expected
    assert signal.rule == TITLE_RULE


def test_a_title_with_no_size_word_leaves_the_rule_silent() -> None:
    # The common case: most titles name a symptom, not a size.
    assert title_effort(issue(title="Watchdog reset on I²C bus lockup")) is None


def test_the_strongest_title_word_wins() -> None:
    signal = title_effort(issue(title="Rewrite the typo checker"))

    assert signal is not None
    assert signal.effort == "xl"


def test_a_title_word_is_matched_whatever_its_casing_or_punctuation() -> None:
    signal = title_effort(issue(title="MIGRATE: build system → Zephyr 4.2"))

    assert signal is not None
    assert signal.effort == "xl"


def test_a_size_word_inside_a_longer_word_is_not_a_match() -> None:
    # `pin` is in the table; `pinout` is a different word, and a rule matching substrings
    # would fire on half the firmware backlog.
    assert title_effort(issue(title="Document the pinout")) is None


# ---------------------------------------------------------------------------
# body-length
# ---------------------------------------------------------------------------


def test_the_body_rule_never_abstains() -> None:
    # The one rule that always votes, which is what guarantees the estimator always has a
    # denominator to compute agreement over.
    assert body_effort(issue(body=None)) is not None


def test_an_issue_with_no_description_is_reported_as_such() -> None:
    signal = body_effort(issue(body=None))

    assert signal.observation == "no description"
    assert signal.effort == EFFORTS[0]
    assert signal.rule == BODY_RULE


@pytest.mark.parametrize(("threshold", "expected"), BODY_EFFORT)
def test_every_body_length_band_is_reachable(threshold: int, expected: str) -> None:
    # One character under the threshold is the band the row names.
    signal = body_effort(issue(body="x" * (threshold - 1)))

    assert signal.effort == expected


def test_a_body_longer_than_every_band_reads_as_the_largest() -> None:
    longest, _ = BODY_EFFORT[-1]

    assert body_effort(issue(body="x" * longest)).effort == "xl"


def test_the_body_signal_counts_characters_rather_than_quoting_them() -> None:
    # A trace is persisted and rendered; mirrored GitHub content does not belong in one.
    secret = "correct-horse-battery-staple"
    signal = body_effort(issue(body=secret))

    assert secret not in signal.line
    assert f"{len(secret)} characters" in signal.line


# ---------------------------------------------------------------------------
# checklist
# ---------------------------------------------------------------------------


def test_an_issue_with_no_checklist_leaves_the_rule_silent() -> None:
    assert checklist_effort(issue(body="Prose, and no boxes.")) is None


def test_an_issue_with_no_description_leaves_the_rule_silent() -> None:
    assert checklist_effort(issue(body=None)) is None


@pytest.mark.parametrize(("count", "expected"), CHECKLIST_EFFORT)
def test_every_checklist_band_is_reachable(count: int, expected: str) -> None:
    body = "\n".join(f"- [ ] step {index}" for index in range(count))

    signal = checklist_effort(issue(body=body))

    assert signal is not None
    assert signal.effort == expected


def test_a_checklist_longer_than_every_band_reads_as_the_largest() -> None:
    longest, _ = CHECKLIST_EFFORT[-1]
    body = "\n".join(f"- [ ] step {index}" for index in range(longest + 1))

    signal = checklist_effort(issue(body=body))

    assert signal is not None
    assert signal.effort == "xl"


@pytest.mark.parametrize("marker", ["-", "*", "+"])
def test_every_bullet_github_renders_is_counted(marker: str) -> None:
    signal = checklist_effort(issue(body=f"{marker} [ ] one\n{marker} [x] two"))

    assert signal is not None
    assert signal.observation == "2 checklist items"


def test_a_single_item_is_reported_in_the_singular() -> None:
    signal = checklist_effort(issue(body="- [ ] the only step"))

    assert signal is not None
    assert signal.observation == "1 checklist item"
    assert signal.rule == CHECKLIST_RULE


def test_an_indented_item_is_still_an_item() -> None:
    signal = checklist_effort(issue(body="- [ ] one\n    - [ ] one a"))

    assert signal is not None
    assert signal.observation == "2 checklist items"


def test_a_bullet_that_is_not_a_checkbox_is_not_counted() -> None:
    assert checklist_effort(issue(body="- one\n- two\n- [not a box] three")) is None


# ---------------------------------------------------------------------------
# The rule set
# ---------------------------------------------------------------------------


def test_the_rules_run_in_the_order_their_lines_appear_in_a_trace() -> None:
    # The estimator iterates `EFFORT_RULES`, so this tuple is what fixes the trace's order —
    # and a trace whose lines moved between releases would be a diff nobody could read.
    assert [rule.__name__ for rule in EFFORT_RULES] == [
        "label_effort",
        "title_effort",
        "body_effort",
        "checklist_effort",
    ]


# ---------------------------------------------------------------------------
# workflow
# ---------------------------------------------------------------------------


def test_an_issue_matching_nothing_runs_the_standard_fix() -> None:
    signal = workflow_signal(issue(title="Watchdog reset", labels=("i2c",)))

    assert signal.tag == STANDARD_FIX
    assert signal.observation == "no docs, dependency or feature signal"


@pytest.mark.parametrize(
    ("tag", "label"),
    [(tag, labels[0]) for tag, labels, _ in WORKFLOW_HINTS],
)
def test_every_classification_is_reachable_from_a_label(tag: str, label: str) -> None:
    assert workflow_signal(issue(labels=(label,))).tag == tag


@pytest.mark.parametrize(
    ("tag", "word"),
    [(tag, words[0]) for tag, _, words in WORKFLOW_HINTS],
)
def test_every_classification_is_reachable_from_a_title(tag: str, word: str) -> None:
    assert workflow_signal(issue(title=f"Please {word} it")).tag == tag


def test_the_narrowest_classification_wins() -> None:
    # A documentation issue that also asks for a feature runs the docs loop: the order of
    # `WORKFLOW_HINTS` is the precedence, and it is read narrowest first.
    assert workflow_signal(issue(labels=("enhancement", "docs"))).tag == DOCS_LOOP


def test_a_label_is_read_before_a_title_word_within_a_classification() -> None:
    signal = workflow_signal(issue(title="Bump the docs", labels=("documentation",)))

    assert signal.tag == DOCS_LOOP
    assert signal.observation == 'the "documentation" label'


def test_the_mockups_migration_issue_classifies_from_its_title() -> None:
    # `#490` carries `tech-debt` and `zephyr`, neither of which is a dependency label — the
    # design's `deps-refresh` comes from the verb.
    signal = workflow_signal(
        issue(title="Migrate build system to Zephyr RTOS 4.2", labels=("tech-debt",))
    )

    assert signal.tag == DEPS_REFRESH
    assert signal.line == 'workflow: "migrate" in the title -> deps-refresh'


def test_the_mockups_feature_issue_classifies_from_its_label() -> None:
    signal = workflow_signal(
        issue(
            title="Expose battery health over BLE GATT service", labels=("enhancement",)
        )
    )

    assert signal.tag == FEATURE_LOOP


def test_the_classification_does_not_depend_on_label_order() -> None:
    forwards = workflow_signal(issue(labels=("dependencies", "deps")))
    backwards = workflow_signal(issue(labels=("deps", "dependencies")))

    assert forwards == backwards


# ---------------------------------------------------------------------------
# risk labels
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("label", RISK_RAISING_LABELS)
def test_every_risk_raising_label_is_reachable(label: str) -> None:
    assert risk_label(issue(labels=(label,)), RISK_RAISING_LABELS) == label


@pytest.mark.parametrize("label", RISK_LOWERING_LABELS)
def test_every_risk_lowering_label_is_reachable(label: str) -> None:
    assert risk_label(issue(labels=(label,)), RISK_LOWERING_LABELS) == label


def test_an_issue_with_no_risk_label_matches_nothing() -> None:
    assert risk_label(issue(labels=("i2c",)), RISK_RAISING_LABELS) is None


def test_the_named_risk_label_does_not_depend_on_label_order() -> None:
    forwards = risk_label(issue(labels=("security", "data-loss")), RISK_RAISING_LABELS)
    backwards = risk_label(issue(labels=("data-loss", "security")), RISK_RAISING_LABELS)

    assert forwards == backwards == "data-loss"
