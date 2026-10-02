"""The shapes an analyzer reads and writes.

BV.2 (`#511 <https://github.com/NobuData/ouroboros/issues/511>`_). Two halves:

* **What goes in — the corpus.** A bounded, snapshotted read of one repository's history
  (decision A2). BV.1 (`#510 <https://github.com/NobuData/ouroboros/issues/510>`_) assembles
  it in ``ouroboros-rest``; this module is the shape it must produce. A source the corpus does
  not carry is ``None`` — *absent*, which is different from an empty list (present, and
  nothing happened). The harness skips an analyzer whose required sources are absent rather
  than running it on nothing.
* **What comes out — findings.** One :class:`Finding` is one row of BU.2's
  ``ouroboros.analysis_findings`` (``V081``, `#507
  <https://github.com/NobuData/ouroboros/issues/507>`_), and the validators below mirror that
  table's checks: the analyzer id and version, the finding-type vocabulary, a one-line
  ``subject_key``, a non-empty list of distinct kinded ``evidence_refs``, confidence 0-100 and
  its basis. A finding the database would refuse is refused here first, inside the analyzer's
  own sandbox, where the failure is that analyzer's alone.

:func:`canonical_json` is the one serialization findings are compared in. *Identical corpus →
identical findings, byte for byte* is an acceptance criterion, and it is only checkable if
"the bytes" are defined.
"""

import json
import re
from datetime import date
from enum import StrEnum
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

#: An analyzer id, as ``analysis_findings_analyzer_shape`` (``V081``) accepts one.
ANALYZER_ID_PATTERN = r"^[a-z][a-z0-9_]{0,62}$"

#: The finding types ``analysis_findings_type_known`` accepts, beside ``custom:<name>``.
FINDING_TYPES = frozenset(
    {
        "change_point",
        "log_signature",
        "config_usage",
        "cache_window",
        "queue_correlation",
        "waiver_cite",
        "workflow_outcome",
    }
)
_CUSTOM_TYPE = re.compile(r"^custom:[a-z][a-z0-9_]{0,62}$")

_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
_SHA = re.compile(r"^[0-9a-f]{7,40}$")


class _Strict(BaseModel):
    """A closed, immutable model: unknown keys are refused, nothing is mutated after build."""

    model_config = ConfigDict(extra="forbid", frozen=True)


class EvidenceKind(StrEnum):
    """What an evidence reference points at — ``analysis_evidence_ref_valid`` (``V081``)."""

    BUILD = "build"
    TEST_RUN = "test_run"
    TEST_CASE = "test_case"
    WAIVER = "waiver"
    MERGE = "merge"
    WORKFLOW_VERSION = "workflow_version"
    RUNNER_POOL = "runner_pool"
    RUNNER = "runner"


class EvidenceRef(_Strict):
    """One ``{kind, id}`` reference the Details sheet can click through.

    A ``merge`` id is a 7-40 character lowercase hex sha; every other kind is a lowercase
    uuid — the formats the database checks.
    """

    kind: EvidenceKind
    id: str

    @model_validator(mode="after")
    def _id_has_its_kinds_format(self) -> "EvidenceRef":
        """Refuse an id in the wrong format for its kind.

        Returns:
            The reference, unchanged.

        Raises:
            ValueError: The id is not a sha (merge) or a lowercase uuid (every other kind).
        """
        pattern = _SHA if self.kind is EvidenceKind.MERGE else _UUID
        if not pattern.fullmatch(self.id):
            raise ValueError(f"{self.kind.value} reference id {self.id!r} is malformed")
        return self


class ConfidenceBasis(_Strict):
    """Why a confidence is what it is — the scoring popover (``V081``).

    ``method`` names the analyzer's documented scoring rule, so a reader can recompute it.
    """

    method: Annotated[str, Field(min_length=1)]
    sample_size: Annotated[int, Field(ge=1)]
    effect_size: float
    stability: Annotated[float, Field(ge=0, le=1)]


class Finding(_Strict):
    """One analyzer's output for one subject — one ``analysis_findings`` row.

    ``data`` is shaped by ``finding_type``; the analyzer that writes it owns that shape, and
    the database's ``analysis_finding_data_valid()`` is the final word on it. There is no
    ``cause`` field and never will be: attribution is a ranked candidate list inside ``data``
    (decision A1), so a reader can disagree with the top one.
    """

    analyzer: Annotated[str, Field(pattern=ANALYZER_ID_PATTERN)]
    analyzer_version: Annotated[int, Field(ge=1)]
    finding_type: str
    subject_key: Annotated[str, Field(min_length=1, max_length=512)]
    data: dict[str, Any]
    evidence_refs: Annotated[list[EvidenceRef], Field(min_length=1)]
    confidence: Annotated[int, Field(ge=0, le=100)]
    confidence_basis: ConfidenceBasis

    @field_validator("finding_type")
    @classmethod
    def _type_is_known(cls, value: str) -> str:
        """Refuse a finding type the database would refuse.

        Args:
            value: The proposed type.

        Returns:
            The type, unchanged.

        Raises:
            ValueError: Not one of the seven families or ``custom:<name>``.
        """
        if value not in FINDING_TYPES and not _CUSTOM_TYPE.fullmatch(value):
            raise ValueError(f"finding type {value!r} is not known")
        return value

    @field_validator("subject_key")
    @classmethod
    def _subject_key_is_one_line(cls, value: str) -> str:
        """Refuse a blank or multi-line subject key — identities are joined by newlines.

        Args:
            value: The proposed key.

        Returns:
            The key, unchanged.

        Raises:
            ValueError: Blank, or containing a line break.
        """
        if not value.strip() or "\n" in value or "\r" in value:
            raise ValueError("subject_key is one non-blank line")
        return value

    @field_validator("evidence_refs")
    @classmethod
    def _evidence_is_distinct(cls, value: list[EvidenceRef]) -> list[EvidenceRef]:
        """Refuse a repeated reference.

        Args:
            value: The references.

        Returns:
            The references, unchanged.

        Raises:
            ValueError: The same reference appears twice.
        """
        if len(set(value)) != len(value):
            raise ValueError("evidence_refs are distinct")
        return value

    @property
    def identity_key(self) -> str:
        """The identity the database generates: ``analyzer@v<version>/<subject_key>``."""
        return f"{self.analyzer}@v{self.analyzer_version}/{self.subject_key}"


# ---------------------------------------------------------------------------
# The corpus.
# ---------------------------------------------------------------------------


class CorpusSource(StrEnum):
    """The corpus sources an analyzer can require."""

    BUILDS = "builds"
    EVENTS = "events"


class Grain(StrEnum):
    """The grain a source is delivered at."""

    #: One record per build-farm job.
    BUILD = "build"
    #: One record per dated event (a merge, a version, an infrastructure change).
    EVENT = "event"


#: The grain each source is delivered at. An analyzer requiring a source at another grain
#: cannot be satisfied by this corpus shape and is skipped as such.
SOURCE_GRAINS: dict[CorpusSource, Grain] = {
    CorpusSource.BUILDS: Grain.BUILD,
    CorpusSource.EVENTS: Grain.EVENT,
}


class CorpusRequirement(_Strict):
    """One source an analyzer reads, and the grain it reads it at."""

    source: CorpusSource
    grain: Grain


class DayWindow(_Strict):
    """The corpus bounds, as UTC dates, inclusive at both ends."""

    from_: Annotated[date, Field(alias="from")]
    to: date

    model_config = ConfigDict(extra="forbid", frozen=True, populate_by_name=True)

    @model_validator(mode="after")
    def _in_order(self) -> "DayWindow":
        """Refuse a window that ends before it starts.

        Returns:
            The window, unchanged.

        Raises:
            ValueError: ``from`` is after ``to``.
        """
        if self.from_ > self.to:
            raise ValueError("window.from is on or before window.to")
        return self


class BuildSample(_Strict):
    """One finished build: which job, on which UTC day, and how long it took."""

    build_id: Annotated[str, Field(pattern=_UUID.pattern)]
    day: date
    duration_seconds: Annotated[float, Field(gt=0)]


class EventKind(StrEnum):
    """What kind of change an attribution candidate is.

    Each has a documented plausibility prior in the change-point analyzer's parameters.
    """

    MERGE = "merge"
    CONFIG_VERSION = "config_version"
    POLICY_VERSION = "policy_version"
    ENV_RECIPE_VERSION = "env_recipe_version"
    INFRA_EVENT = "infra_event"


class CandidateEvent(_Strict):
    """A dated change that could explain a shift — a merge, a version, a farm event.

    ``ref`` is the evidence a finding cites for it, so it must be a kind the database can
    resolve (a merge by sha, a workflow version, a runner pool or runner).
    """

    kind: EventKind
    day: date
    label: Annotated[str, Field(min_length=1, max_length=200)]
    ref: EvidenceRef


class Corpus(_Strict):
    """One repository's snapshotted history, as an analysis run reads it.

    ``None`` means the source is absent from this corpus; ``[]`` means it is present and
    empty. Records outside ``window`` are refused, so an analyzer can trust the bounds.
    """

    repo_ref: Annotated[str, Field(min_length=1, max_length=255)]
    window: DayWindow
    builds: list[BuildSample] | None = None
    events: list[CandidateEvent] | None = None

    @model_validator(mode="after")
    def _records_inside_the_window(self) -> "Corpus":
        """Refuse a record dated outside the corpus window.

        Returns:
            The corpus, unchanged.

        Raises:
            ValueError: A build or event lies outside ``window``.
        """
        for record in (*(self.builds or ()), *(self.events or ())):
            if not self.window.from_ <= record.day <= self.window.to:
                raise ValueError(f"record dated {record.day} lies outside the window")
        return self

    def available(self) -> frozenset[CorpusRequirement]:
        """Which sources this corpus carries, at their grains.

        Returns:
            One requirement per present source.
        """
        present = {
            CorpusSource.BUILDS: self.builds is not None,
            CorpusSource.EVENTS: self.events is not None,
        }
        return frozenset(
            CorpusRequirement(source=source, grain=SOURCE_GRAINS[source])
            for source, here in present.items()
            if here
        )


# ---------------------------------------------------------------------------
# One serialization.
# ---------------------------------------------------------------------------


def canonical_json(value: Any) -> str:
    """Serialize to the one byte form findings are compared and stored in.

    Keys sorted, no insignificant whitespace, UTF-8 kept as text. Floats are whatever the
    analyzer rounded them to — an analyzer rounds before it emits, so the text is stable.

    Args:
        value: JSON-able data — typically ``[finding.model_dump(mode="json"), …]``.

    Returns:
        The canonical text.
    """
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def findings_json(findings: list[Finding]) -> str:
    """The canonical text of a list of findings, in the order the harness sorts them.

    Args:
        findings: The findings.

    Returns:
        :func:`canonical_json` of them, ordered by ``(analyzer, subject_key)``.
    """
    ordered = sorted(findings, key=lambda f: (f.analyzer, f.subject_key))
    return canonical_json([f.model_dump(mode="json") for f in ordered])


#: How an analyzer's sandboxed run ended.
OutcomeStatus = Literal[
    "completed", "skipped", "failed", "timed_out", "memory_exceeded", "not_run"
]
