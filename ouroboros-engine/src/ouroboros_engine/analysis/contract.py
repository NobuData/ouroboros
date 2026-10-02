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
from datetime import UTC, date
from enum import StrEnum
from typing import Annotated, Any, Literal

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)

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
    """The corpus sources an analyzer can require.

    ``builds`` and ``events`` are BV.2's; the rest are the planes BV.1 (#510) assembles in
    ``ouroboros-rest`` — one per bounded reader — for BV.3's pattern analyzers.
    """

    BUILDS = "builds"
    EVENTS = "events"
    LOG_TAILS = "log_tails"
    TESTS = "tests"
    FLAKES = "flakes"
    LOOPS = "loops"
    CACHE = "cache"
    WAIVERS = "waivers"
    SERIES = "series"
    RIG_TELEMETRY = "rig_telemetry"
    #: BV.3 (#512): every finished farm job with its stage label, commit, ref, pool,
    #: queue times and configuration — what ``builds`` (the duration series) leaves out.
    JOBS = "jobs"
    #: BV.3 (#512): the runner pools and the runners in each.
    POOLS = "pools"
    #: BV.3 (#512): the build configuration options the repository declares.
    CONFIG_OPTIONS = "config_options"


class Grain(StrEnum):
    """The grain a source is delivered at."""

    #: One record per build-farm job.
    BUILD = "build"
    #: One record per dated event (a merge, a version, an infrastructure change).
    EVENT = "event"
    #: One record per test case result.
    TEST_CASE = "test_case"
    #: One record per scored test case — the current flake score, not dated.
    CASE_SCORE = "case_score"
    #: One record per loop (an ``ouroboros.runs`` row).
    LOOP = "loop"
    #: One record per waiver.
    WAIVER = "waiver"
    #: One point per (metric, dimension, UTC day) — a BI rollup row.
    DAY = "day"
    #: One reading per (runner, metric, UTC day).
    READING = "reading"
    #: One record per runner pool — current membership, not dated.
    POOL = "pool"
    #: One record per declared configuration option — not dated.
    OPTION = "option"


#: The grain each source is delivered at. An analyzer requiring a source at another grain
#: cannot be satisfied by this corpus shape and is skipped as such.
SOURCE_GRAINS: dict[CorpusSource, Grain] = {
    CorpusSource.BUILDS: Grain.BUILD,
    CorpusSource.EVENTS: Grain.EVENT,
    CorpusSource.LOG_TAILS: Grain.BUILD,
    CorpusSource.TESTS: Grain.TEST_CASE,
    CorpusSource.FLAKES: Grain.CASE_SCORE,
    CorpusSource.LOOPS: Grain.LOOP,
    CorpusSource.CACHE: Grain.BUILD,
    CorpusSource.WAIVERS: Grain.WAIVER,
    CorpusSource.SERIES: Grain.DAY,
    CorpusSource.RIG_TELEMETRY: Grain.READING,
    CorpusSource.JOBS: Grain.BUILD,
    CorpusSource.POOLS: Grain.POOL,
    CorpusSource.CONFIG_OPTIONS: Grain.OPTION,
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


#: How a finished build ended, as the corpus carries it. ``retried`` is a failure somebody
#: ran again — a failed build, like the BI ``builds`` family counts it.
BuildStatus = Literal["succeeded", "failed", "retried"]

_Day = date
_NonNegativeInt = Annotated[int, Field(ge=0)]
_Uuid = Annotated[str, Field(pattern=_UUID.pattern)]
_Name = Annotated[str, Field(min_length=1, max_length=512)]


class LogTail(_Strict):
    """The tail of one build's stored log, and how long the whole log was.

    ``line_count`` is every line the farm stored for the build (``build_jobs.log_lines``);
    ``lines`` is only its tail — the reader's bounded slice of it, oldest first.
    """

    build_id: _Uuid
    day: _Day
    label: _Name
    status: BuildStatus
    line_count: _NonNegativeInt
    lines: list[str]


class CaseResult(_Strict):
    """One test case's result in one test run (AS.1's ``test_cases`` row, flattened).

    ``build_id`` is the farm job the run came from, when the test plane knows it.
    """

    test_run_id: _Uuid
    build_id: _Uuid | None
    day: _Day
    suite: _Name
    platform: _Name | None
    case_key: _Name
    status: Literal["passed", "failed", "flaky", "skipped"]
    failure: str | None


class FlakeScore(_Strict):
    """A test case's current flake score (AT.3's ``flake_scores``) — current, so not dated."""

    case_key: _Name
    score: Annotated[float, Field(ge=0, le=1)]
    state: Annotated[str, Field(min_length=1, max_length=64)]


#: How a loop stage ended (BV.3, #512): ``failed`` — its own check failed at least once;
#: ``flagged`` — a review stage found a defect in what came before it.
StageOutcome = Literal["passed", "failed", "flagged"]


class LoopStage(_Strict):
    """One stage of one loop: its key, how many attempts it took, and their summed time.

    ``outcome`` is optional (#512): a corpus that does not carry stage outcomes leaves it
    ``None``, and the analyzers reading it count such a stage as unknown, never as passed.
    """

    key: Annotated[str, Field(min_length=1, max_length=120)]
    attempts: Annotated[int, Field(ge=1)]
    seconds: Annotated[float, Field(ge=0)]
    outcome: StageOutcome | None = None


class LoopRecord(_Strict):
    """One loop (an ``ouroboros.runs`` row): stage timings and transcript *statistics*.

    The transcript's bodies are never in the corpus — ``events`` and ``event_bytes`` are how
    much of it there was.

    The last four fields are optional (BV.3, #512) and ``None`` when the corpus does not
    carry them: the workflow slug and the version the loop ran, the commit it merged (absent
    for an unmerged loop) and the repository paths its change touched.
    """

    run_id: _Uuid
    day: _Day
    status: Annotated[str, Field(min_length=1, max_length=64)]
    stages: list[LoopStage]
    events: _NonNegativeInt
    event_bytes: _NonNegativeInt
    workflow: Annotated[str, Field(min_length=1, max_length=120)] | None = None
    workflow_version_id: _Uuid | None = None
    merge_sha: Annotated[str, Field(pattern=_SHA.pattern)] | None = None
    paths_touched: list[Annotated[str, Field(min_length=1, max_length=1024)]] | None = (
        None
    )


class CacheStat(_Strict):
    """One build's ccache counters (AG.5's ``build_jobs.ccache_stats``)."""

    build_id: _Uuid
    day: _Day
    hits: _NonNegativeInt
    misses: _NonNegativeInt


class Waiver(_Strict):
    """One PR waiver (AS.4's ``pr_waivers``): the loop, the cases it waived, and why."""

    waiver_id: _Uuid
    run_id: _Uuid
    day: _Day
    case_keys: list[_Name]
    reason: Annotated[str, Field(min_length=1)]


class SeriesPoint(_Strict):
    """One BI rollup row: a metric's value for one dimension on one UTC day.

    ``samples`` carries a median metric's retained observations (``metric_daily.meta``), so
    an analyzer can pool them rather than average medians; it is empty for any other metric.
    """

    day: _Day
    dimension: Annotated[str, Field(max_length=200)]
    value: float
    samples: list[float]


class RigReading(_Strict):
    """One rig/HIL telemetry reading — the read shape AJ.4 (#266) must produce.

    Specified here before AJ.4 exists, so BV.1 has a shape to fill and an analyzer has one
    to require. Until it lands ``rig_telemetry`` is absent from every corpus, never empty.
    """

    runner_id: _Uuid
    day: _Day
    metric: Annotated[str, Field(min_length=1, max_length=120)]
    value: float


class BuildJob(_Strict):
    """One finished farm job, as the pattern analyzers read it (BV.3, #512).

    ``builds`` is the duration *series*; this is the job itself — which stage it was
    (``label``: ``zephyr build``, ``qemu_cortex_m3``, ``HIL test rig``), how it ended, the
    commit and ref it built, the pool it queued on, when it queued, started and finished,
    and the configuration it was built with. ``day`` is ``finished_at``'s UTC date.

    ``config`` maps each configuration option the job's build *set* to its value (for a
    Zephyr build, the ``-DCONFIG_…=`` arguments); ``None`` means the job's configuration is
    not known, which is different from ``{}`` (known, and nothing set).
    """

    build_id: _Uuid
    day: _Day
    label: _Name
    status: BuildStatus
    commit_sha: Annotated[str, Field(pattern=_SHA.pattern)]
    git_ref: _Name
    title: Annotated[str, Field(min_length=1, max_length=512)] | None = None
    pool_id: _Uuid | None = None
    queued_at: AwareDatetime
    started_at: AwareDatetime | None = None
    finished_at: AwareDatetime
    config: dict[_Name, Annotated[str, Field(max_length=1024)]] | None = None

    @model_validator(mode="after")
    def _times_in_order(self) -> "BuildJob":
        """Refuse a job whose instants are out of order or whose day is not its finish's.

        Returns:
            The job, unchanged.

        Raises:
            ValueError: ``queued_at`` ≤ ``started_at`` ≤ ``finished_at`` does not hold, or
                ``day`` is not ``finished_at``'s UTC date.
        """
        started = self.started_at or self.queued_at
        if not self.queued_at <= started <= self.finished_at:
            raise ValueError("queued_at <= started_at <= finished_at")
        if self.finished_at.astimezone(UTC).date() != self.day:
            raise ValueError("day is finished_at's UTC date")
        return self


class RunnerPool(_Strict):
    """One runner pool and the runners in it now (BV.3, #512) — current, so not dated."""

    pool_id: _Uuid
    name: _Name
    runner_ids: list[_Uuid]


class ConfigOption(_Strict):
    """One configuration option the repository declares (BV.3, #512) — e.g. a Kconfig symbol.

    The declared set is what lets ``config_usage`` say *never set*: an option no job set is
    only visible against the list of options that exist.
    """

    name: Annotated[str, Field(min_length=1, max_length=255)]


class SamplingRecord(_Strict):
    """How much of one source the corpus read — BV.1's manifest record (V080), mirrored.

    ``rate`` is exactly 1 when the source was read in full and strictly between 0 and 1 when a
    budget (``cap``) bound it.
    """

    sampled: bool
    rate: Annotated[float, Field(gt=0, le=1)]
    cap: Literal["max_builds", "max_log_lines", "compute_ceiling_seconds"] | None = None

    @model_validator(mode="after")
    def _rate_agrees(self) -> "SamplingRecord":
        """Refuse a record whose rate contradicts its flag.

        Returns:
            The record, unchanged.

        Raises:
            ValueError: ``sampled`` with a rate of 1, or not sampled with a rate under 1.
        """
        if self.sampled == (self.rate == 1):
            raise ValueError(
                "a sampled source has a rate under 1; a full read has rate 1"
            )
        return self


class Corpus(_Strict):
    """One repository's snapshotted history, as an analysis run reads it.

    ``None`` means the source is absent from this corpus; ``[]`` means it is present and
    empty. Records outside ``window`` are refused, so an analyzer can trust the bounds.

    ``sampling`` (BV.3, #512) is BV.1's per-source sampling record, keyed by source name. An
    analyzer making an *absence* claim reads it: a source missing from it — or ``sampling``
    itself ``None`` — is **unknown**, and is treated as possibly sampled.
    """

    repo_ref: Annotated[str, Field(min_length=1, max_length=255)]
    window: DayWindow
    builds: list[BuildSample] | None = None
    events: list[CandidateEvent] | None = None
    log_tails: list[LogTail] | None = None
    tests: list[CaseResult] | None = None
    flakes: list[FlakeScore] | None = None
    loops: list[LoopRecord] | None = None
    cache: list[CacheStat] | None = None
    waivers: list[Waiver] | None = None
    series: (
        dict[
            Annotated[str, Field(pattern=r"^[a-z][a-z0-9_]{0,62}$")], list[SeriesPoint]
        ]
        | None
    ) = None
    rig_telemetry: list[RigReading] | None = None
    jobs: list[BuildJob] | None = None
    pools: list[RunnerPool] | None = None
    config_options: list[ConfigOption] | None = None
    sampling: dict[CorpusSource, SamplingRecord] | None = None

    @model_validator(mode="after")
    def _records_inside_the_window(self) -> "Corpus":
        """Refuse a record dated outside the corpus window.

        Every dated source is checked; ``flakes``, ``pools`` and ``config_options`` are
        current and carry no day.

        Returns:
            The corpus, unchanged.

        Raises:
            ValueError: A dated record lies outside ``window``.
        """
        dated = (
            *(self.builds or ()),
            *(self.events or ()),
            *(self.log_tails or ()),
            *(self.tests or ()),
            *(self.loops or ()),
            *(self.cache or ()),
            *(self.waivers or ()),
            *(point for points in (self.series or {}).values() for point in points),
            *(self.rig_telemetry or ()),
            *(self.jobs or ()),
        )
        for record in dated:
            if not self.window.from_ <= record.day <= self.window.to:
                raise ValueError(f"record dated {record.day} lies outside the window")
        return self

    def available(self) -> frozenset[CorpusRequirement]:
        """Which sources this corpus carries, at their grains.

        Returns:
            One requirement per present source — present meaning not ``None``, so an empty
            source is available and an absent one is not.
        """
        return frozenset(
            CorpusRequirement(source=source, grain=SOURCE_GRAINS[source])
            for source in CorpusSource
            if getattr(self, source.value) is not None
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
