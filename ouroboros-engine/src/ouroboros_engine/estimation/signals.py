"""The rules ``heuristic-v0`` reads an issue with — one signal each, or silence.

L.2 (`#106 <https://github.com/NobuData/ouroboros/issues/106>`_). Every rule below answers
the same question — *how much work is this?* — from a different part of the issue, and the
estimator beside it (:mod:`ouroboros_engine.estimation.heuristic`) is only the arithmetic
that combines them. The split is what makes a heuristic reviewable at all: a rule is a
table and a threshold, so an argument about whether ``tech-debt`` really means ``l`` is an
argument about one line of this file rather than about an estimator.

**A rule may abstain, and the silence is information.** Most titles carry no verb about
size and most issues have no checklist, so :func:`title_effort` and :func:`checklist_effort`
return ``None`` far more often than not. The estimator counts how many rules spoke and how
many of them agreed, which is what decision **K10**'s "confidence from signal agreement"
means in practice — an answer three rules reached together is worth more than the same
answer one rule reached alone. :func:`body_effort` is the exception and never abstains:
every issue has a description or conspicuously does not, and both are readings.

**A rule votes for the *strongest* thing it saw, never an average.** A title that says
``migrate`` has said something about the whole job, and a second word saying ``typo`` does
not cancel it. The estimator aggregates the same way, for the same reason: a heuristic that
cannot see the code should not size work below its loudest signal, and the confidence it
reports is where the hedging belongs.

**Ties break alphabetically, on purpose.** GitHub's label order is not meaningful and a
caller may send it in any order, so a rule that took "the first matching label" would answer
differently for the same issue depending on how the list arrived. Every rule here sorts its
matches, so the answer is a function of the *set* of labels rather than of their sequence —
which is a stronger determinism than the ticket asks for and the only one that survives a
re-sync.

**Nothing here reads a clock, a random number, an environment variable or a file.** That is
what "deterministic by construction" is, and ``tests/test_estimation_heuristic.py`` asserts
it by parsing this module's imports rather than by trusting this paragraph.
"""

import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass

from ouroboros_engine.estimation.contract import EFFORTS, Effort, IssueContext

# ---------------------------------------------------------------------------
# The vocabularies this module produces
# ---------------------------------------------------------------------------

#: The four workflow tags decision **K5** fixed, spelled as the mockup's tag chips spell
#: them (``docs/mockups/03-issues.html``). They are *preferences*, not a vocabulary this
#: service owns: the caller sends the tags that exist and
#: :func:`ouroboros_engine.estimation.heuristic.offered_tag` falls back when one of these
#: is not among them.
DOCS_LOOP = "docs-loop"
DEPS_REFRESH = "deps-refresh"
FEATURE_LOOP = "feature-loop"
STANDARD_FIX = "standard-fix"

#: The rule names that reach ``trace.signals``. Decision **K10** asks for rule-name signals,
#: and these are the names — stable strings a reader can grep this module for, rather than
#: sentences that get reworded.
LABEL_RULE = "label-effort"
TITLE_RULE = "title-verb"
BODY_RULE = "body-length"
CHECKLIST_RULE = "checklist"
WORKFLOW_RULE = "workflow"

# ---------------------------------------------------------------------------
# The tables
# ---------------------------------------------------------------------------

#: What a label says about size. Keys are *normalised* labels — see :func:`normalise` — so
#: GitHub's own ``good first issue`` and a repository's ``Good-First-Issue`` are the same
#: key here.
#:
#: The values are arguable and meant to be argued with; what is not arguable is that the
#: whole table is seventeen lines a reviewer can read. ``tech-debt`` sits with ``bug`` at
#: ``m`` rather than higher because the mockup carries it on both a small change and an
#: enormous one (``#491`` and ``#490``) — it says *this is not the feature you think it is*,
#: not *this is large*. What made ``#490`` an ``xl`` is the ``migrate`` in its title, which
#: is :data:`TITLE_EFFORT`'s job.
LABEL_EFFORT: Mapping[str, Effort] = {
    "good-first-issue": "xs",
    "docs": "xs",
    "documentation": "xs",
    "typo": "xs",
    "chore": "s",
    "dependencies": "s",
    "deps": "s",
    "bug": "m",
    "defect": "m",
    "enhancement": "l",
    "feature": "l",
    "refactor": "l",
    "tech-debt": "m",
    "technical-debt": "m",
    "breaking-change": "xl",
    "epic": "xl",
    "migration": "xl",
}

#: What a word in the title says about size. Only words that carry a size on their own are
#: here: ``add`` and ``fix`` appear in half of all issue titles and would be a signal that
#: fires everywhere and means nothing, so they are deliberately absent.
TITLE_EFFORT: Mapping[str, Effort] = {
    "typo": "xs",
    "typos": "xs",
    "spelling": "xs",
    "wording": "xs",
    "rename": "xs",
    "bump": "s",
    "pin": "s",
    "unpin": "s",
    "extract": "l",
    "redesign": "l",
    "refactor": "l",
    "migrate": "xl",
    "migration": "xl",
    "overhaul": "xl",
    "replatform": "xl",
    "rewrite": "xl",
}

#: How long a description has to be before it stops looking like the effort below it, and
#: the effort it reads as under that length. Read in order: the first row whose length the
#: body is *under* wins, and a body longer than every row is :data:`LONGEST_BODY_EFFORT`.
#:
#: Characters rather than words or lines because it is the one measure that means the same
#: thing for a paragraph of prose, a stack trace and a table — and because an estimator
#: that tokenised a body would be doing the thing v0 exists to not do.
BODY_EFFORT: tuple[tuple[int, Effort], ...] = (
    (80, "xs"),
    (400, "s"),
    (1_200, "m"),
    (3_000, "l"),
)

#: What a body longer than every row of :data:`BODY_EFFORT` reads as.
LONGEST_BODY_EFFORT: Effort = "xl"

#: How many checklist items an effort looks like. Read in order: the first row the count is
#: at or under wins, and a longer list is :data:`LONGEST_CHECKLIST_EFFORT`. A checklist is
#: the closest thing an issue has to a plan, so a rule that counts one is reading the
#: author's own estimate rather than guessing at it.
CHECKLIST_EFFORT: tuple[tuple[int, Effort], ...] = (
    (3, "s"),
    (8, "m"),
    (15, "l"),
)

#: What a checklist longer than every row of :data:`CHECKLIST_EFFORT` reads as.
LONGEST_CHECKLIST_EFFORT: Effort = "xl"

#: A markdown checklist item: ``- [ ]`` or ``- [x]`` at the start of a line, with ``*`` and
#: ``+`` accepted because GitHub renders all three. Indented items count — a nested list is
#: still a list of things somebody has to do.
CHECKLIST_ITEM = re.compile(r"^[ \t]*[-*+][ \t]+\[[ xX]\]", re.MULTILINE)

#: Labels whose presence points at :data:`DOCS_LOOP`, :data:`DEPS_REFRESH` and
#: :data:`FEATURE_LOOP`, and the title words that point at the same three. Read in the order
#: written: the narrowest classification wins, so an issue labelled both ``docs`` and
#: ``enhancement`` runs the docs loop rather than the feature loop. Anything matching none
#: of them is :data:`STANDARD_FIX`, which is the default rather than a fourth guess.
WORKFLOW_HINTS: tuple[tuple[str, tuple[str, ...], tuple[str, ...]], ...] = (
    (
        DOCS_LOOP,
        ("docs", "documentation", "typo", "readme"),
        ("typo", "typos", "spelling", "wording", "readme", "changelog"),
    ),
    (
        DEPS_REFRESH,
        ("dependencies", "deps", "dependabot", "migration", "renovate"),
        ("bump", "migrate", "upgrade", "dependency", "dependencies", "pin", "unpin"),
    ),
    (
        FEATURE_LOOP,
        ("enhancement", "feature", "feature-request"),
        ("introduce", "expose", "implement"),
    ),
)

#: Labels that make a change more likely to break something than its size alone suggests,
#: and labels that make it less likely. A raiser beats a lowerer — a ``security`` issue
#: labelled ``good-first-issue`` is still a security issue — and that precedence is the
#: whole of the interaction between the two lists.
RISK_RAISING_LABELS: tuple[str, ...] = (
    "breaking-change",
    "critical",
    "data-loss",
    "migration",
    "production",
    "regression",
    "security",
)
RISK_LOWERING_LABELS: tuple[str, ...] = (
    "chore",
    "docs",
    "documentation",
    "good-first-issue",
    "test",
    "tests",
    "typo",
)

#: Anything that is not a letter or a digit, which is what :func:`normalise` collapses. One
#: pattern rather than a chain of ``replace`` calls, so ``Type: Bug``, ``type_bug`` and
#: ``type/bug`` all normalise the same way.
_SEPARATORS = re.compile(r"[^a-z0-9]+")

#: A word in a title. Digits are kept inside a word so ``rtos`` and ``4`` do not become one
#: token, and the pattern is applied to a lower-cased title so the table needs no casing.
_WORDS = re.compile(r"[a-z0-9]+")


# ---------------------------------------------------------------------------
# Signals
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class EffortSignal:
    """One rule's reading of how much work an issue is.

    Frozen because a signal is a record of what a rule saw: something that rewrote one
    after the fact would be rewriting the trace, which is the one part of an estimate that
    exists to be checked against the answer.

    Attributes:
        rule: The rule's name — one of :data:`LABEL_RULE`, :data:`TITLE_RULE`,
            :data:`BODY_RULE`, :data:`CHECKLIST_RULE`.
        observation: What the rule saw, in the fewest words that identify it again — a
            label's name, a title's word, a character count. Never the issue's text: a
            trace is persisted and rendered, and mirrored GitHub content does not belong
            in either.
        effort: What it votes for.
    """

    rule: str
    observation: str
    effort: Effort

    @property
    def line(self) -> str:
        """The signal as it appears in ``trace.signals``.

        Returns:
            ``"<rule>: <observation> -> <effort>"`` — the shape every line in a
            heuristic trace has, so a reader scanning one sees the same three parts each
            time.
        """
        return f"{self.rule}: {self.observation} -> {self.effort}"


@dataclass(frozen=True)
class WorkflowSignal:
    """Which workflow tag the issue points at, and what pointed there.

    Attributes:
        tag: The tag this rule *prefers*. It is not necessarily the answer: decision **K5**
            makes the set of tags the caller's, so
            :func:`ouroboros_engine.estimation.heuristic.offered_tag` is what turns a
            preference into one of the tags the request offered.
        observation: What produced the preference — a label, a title word, or the absence
            of both.
    """

    tag: str
    observation: str

    @property
    def line(self) -> str:
        """The signal as it appears in ``trace.signals``.

        Returns:
            ``"workflow: <observation> -> <tag>"``.
        """
        return f"{WORKFLOW_RULE}: {self.observation} -> {self.tag}"


# ---------------------------------------------------------------------------
# Reading the parts of an issue
# ---------------------------------------------------------------------------


def normalise(label: str) -> str:
    """Reduce a label to the form :data:`LABEL_EFFORT` and the hint lists are keyed by.

    Lower case, every run of non-alphanumeric characters collapsed to a single hyphen, and
    no leading or trailing hyphen. So ``good first issue`` (GitHub's own default label),
    ``Good-First-Issue`` and ``good/first/issue`` are one key, and a repository's house
    style stops being something every table here has to enumerate.

    Args:
        label: A label name as GitHub holds it.

    Returns:
        The normalised name, which is ``""`` for a label made entirely of punctuation.
    """
    return _SEPARATORS.sub("-", label.lower()).strip("-")


def label_keys(label: str) -> tuple[str, ...]:
    """The keys a label is looked up under, in the order they are tried.

    Two of them, and the second is what makes the tables survive a repository that
    namespaces its labels. ``kind/bug`` normalises to ``kind-bug``, which is in no table;
    its last segment is ``bug``, which is in all of them. The whole label is always tried
    first, so ``tech-debt`` is read as ``tech-debt`` rather than as ``debt``.

    Args:
        label: A label name as GitHub holds it.

    Returns:
        The normalised label, then its last hyphen-separated segment when that differs.
        Empty for a label that normalises to nothing.
    """
    normalised = normalise(label)
    if not normalised:
        return ()
    tail = normalised.rsplit("-", 1)[-1]
    return (normalised,) if tail == normalised else (normalised, tail)


def title_words(title: str) -> tuple[str, ...]:
    """The words of a title, lower-cased, in the order they were written.

    Args:
        title: The issue title.

    Returns:
        Every run of letters and digits in it. Punctuation, casing and the ``I²C`` in the
        mockup's own ``#485`` all fall away, which is the point: a table of sixteen verbs
        should not also have to be a table of sixteen spellings.
    """
    return tuple(_WORDS.findall(title.lower()))


def has_description(issue: IssueContext) -> bool:
    """Whether the issue was opened with anything to read.

    ``None`` and whitespace are the same answer here, for the reason K.1's column is
    nullable at all: GitHub makes no distinction between an empty description and no
    description, and neither does an estimator that has to read one.

    Args:
        issue: The issue being sized.

    Returns:
        ``True`` if the body holds a non-blank character.
    """
    return bool(issue.body and issue.body.strip())


def effort_ordinal(effort: Effort) -> int:
    """Where an effort sits on the scale, as a number rules can be compared with.

    Args:
        effort: One of the contract's five values.

    Returns:
        Its index in :data:`~ouroboros_engine.estimation.contract.EFFORTS` — ``0`` for
        ``xs``, ``4`` for ``xl``. Derived from the contract's own tuple rather than from a
        second table here, so an effort added there cannot be silently unranked.
    """
    return EFFORTS.index(effort)


def strongest(efforts: Iterable[Effort]) -> Effort:
    """The largest of some efforts.

    Args:
        efforts: At least one effort. The estimator always has one, because
            :func:`body_effort` never abstains.

    Returns:
        The one furthest up the scale.

    Raises:
        ValueError: If ``efforts`` is empty. A caller with no signals at all has a bug
            rather than an unsized issue, and an exception says so where a default would
            hide it.
    """
    ranked = sorted(efforts, key=effort_ordinal)
    if not ranked:
        message = "no efforts to choose the strongest of"
        raise ValueError(message)
    return ranked[-1]


def _strongest_key(
    candidates: Iterable[tuple[str, str]], table: Mapping[str, Effort]
) -> tuple[str, Effort] | None:
    """Pick the strongest table hit, breaking ties alphabetically on what was observed.

    Args:
        candidates: ``(observation, key)`` pairs — what to report, and what to look up.
            One observation may appear more than once; the strongest hit for it wins.
        table: The lookup, :data:`LABEL_EFFORT` or :data:`TITLE_EFFORT`.

    Returns:
        The observation and the effort it voted for, or ``None`` if nothing matched.
    """
    hits = sorted(
        (-effort_ordinal(table[key]), observation)
        for observation, key in candidates
        if key in table
    )
    if not hits:
        return None
    rank, observation = hits[0]
    return observation, EFFORTS[-rank]


# ---------------------------------------------------------------------------
# The four effort rules
# ---------------------------------------------------------------------------


def label_effort(issue: IssueContext) -> EffortSignal | None:
    """Read the labels — the strongest signal there is, and the one most issues carry.

    Args:
        issue: The issue being sized.

    Returns:
        A signal for the strongest label in :data:`LABEL_EFFORT`, or ``None`` when no label
        is in the table. The estimator penalises that silence rather than ignoring it: an
        unlabelled issue is one this rule engine has barely read.
    """
    # Both forms of every label are offered and the strongest hit wins, which is what
    # makes `kind/bug` and `bug` the same signal without `kind-bug` having to be in the
    # table. Whichever form matched, the label is reported under the name it was sent as.
    candidates = [(label, key) for label in issue.labels for key in label_keys(label)]
    match = _strongest_key(candidates, LABEL_EFFORT)
    if match is None:
        return None
    label, effort = match
    return EffortSignal(LABEL_RULE, f'the "{label}" label', effort)


def title_effort(issue: IssueContext) -> EffortSignal | None:
    """Read the title for a verb that carries a size.

    Args:
        issue: The issue being sized.

    Returns:
        A signal for the strongest word in :data:`TITLE_EFFORT`, or ``None`` — which is the
        common case, because most titles name a symptom rather than a size.
    """
    candidates = [(word, word) for word in title_words(issue.title)]
    match = _strongest_key(candidates, TITLE_EFFORT)
    if match is None:
        return None
    word, effort = match
    return EffortSignal(TITLE_RULE, f'"{word}" in the title', effort)


def body_effort(issue: IssueContext) -> EffortSignal:
    """Read how much was written, which is the one rule that always has an answer.

    Args:
        issue: The issue being sized.

    Returns:
        A signal, always. An issue opened with no description reads as ``xs`` and is
        reported as *no description* rather than as zero characters, because the two are
        different things to a reader of a trace — and the estimator takes a separate
        confidence penalty for it, so the absence is never mistaken for a small job
        confidently sized.
    """
    if not has_description(issue):
        return EffortSignal(BODY_RULE, "no description", EFFORTS[0])

    # `issue.body` is not None here: `has_description` is what said so.
    length = len(issue.body or "")
    effort = LONGEST_BODY_EFFORT
    for threshold, under in BODY_EFFORT:
        if length < threshold:
            effort = under
            break
    return EffortSignal(BODY_RULE, f"{length} characters", effort)


def checklist_effort(issue: IssueContext) -> EffortSignal | None:
    """Count the checklist, which is the author's own plan if they wrote one.

    Args:
        issue: The issue being sized.

    Returns:
        A signal sized from the number of ``- [ ]`` items, or ``None`` when there are none.
    """
    count = len(CHECKLIST_ITEM.findall(issue.body or ""))
    if count == 0:
        return None

    effort = LONGEST_CHECKLIST_EFFORT
    for threshold, under in CHECKLIST_EFFORT:
        if count <= threshold:
            effort = under
            break
    plural = "item" if count == 1 else "items"
    return EffortSignal(CHECKLIST_RULE, f"{count} checklist {plural}", effort)


#: The effort rules, in the order their signals appear in a trace. The estimator iterates
#: this rather than naming four functions, so a fifth rule is a line here and a row in the
#: fixture table — and ``tests/test_estimation_signals.py`` asserts every one of them is
#: reachable.
EFFORT_RULES = (label_effort, title_effort, body_effort, checklist_effort)


# ---------------------------------------------------------------------------
# Workflow
# ---------------------------------------------------------------------------


def workflow_signal(issue: IssueContext) -> WorkflowSignal:
    """Classify the issue into one of the four workflow tags.

    Labels are read before title words within a classification, and the classifications
    are read in :data:`WORKFLOW_HINTS` order — narrowest first. Nothing matching is
    :data:`STANDARD_FIX`, which is a default rather than a fourth classification: the
    mockup's own table shows it on five of its nine issues.

    Args:
        issue: The issue being sized.

    Returns:
        The preferred tag and what pointed at it. Always a signal — every issue classifies,
        even if only as the default.
    """
    labels = sorted({key for label in issue.labels for key in label_keys(label)})
    words = sorted(set(title_words(issue.title)))

    for tag, label_hints, title_hints in WORKFLOW_HINTS:
        matched_labels = [label for label in labels if label in label_hints]
        if matched_labels:
            return WorkflowSignal(tag, f'the "{matched_labels[0]}" label')
        matched_words = [word for word in words if word in title_hints]
        if matched_words:
            return WorkflowSignal(tag, f'"{matched_words[0]}" in the title')

    return WorkflowSignal(STANDARD_FIX, "no docs, dependency or feature signal")


# ---------------------------------------------------------------------------
# Risk
# ---------------------------------------------------------------------------


def risk_label(issue: IssueContext, names: tuple[str, ...]) -> str | None:
    """The first of ``names`` the issue carries, alphabetically.

    Args:
        issue: The issue being sized.
        names: :data:`RISK_RAISING_LABELS` or :data:`RISK_LOWERING_LABELS`.

    Returns:
        The matching label in its normalised form, or ``None``. Alphabetical rather than
        label order for the same reason every rule here sorts: which of two ``security``
        and ``data-loss`` labels gets named in the risk note should not depend on how
        GitHub happened to return them.
    """
    matched = sorted(
        {key for label in issue.labels for key in label_keys(label) if key in names}
    )
    return matched[0] if matched else None
