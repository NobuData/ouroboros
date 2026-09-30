"""``POST /v0/learn``'s shapes — the contract that outlives the extractor behind it.

BF.3 (`#412 <https://github.com/NobuData/ouroboros/issues/412>`_), decision **K5**: facts are
learned deterministically in the MVP, by ``ouroboros-rest``'s proposer registry, and the
extraction contract is **committed now** so BH.1's LLM extractor
(`#423 <https://github.com/NobuData/ouroboros/issues/423>`_) answers it and plugs into that
registry as the ``llm`` proposer without a reshape.

**Request: a source bundle.** Each :class:`LearnSource` is one thing the loop wrote — a PR's
review cycle, a run's observations, a correction note — with its text and the typed references
a candidate learned from it must cite. The caller also sends the facts it already holds, so an
extractor can avoid restating them; ``ouroboros-rest`` dedupes again regardless (in any status,
rejected included), because a hint is not a guarantee.

**Response: candidates, with confidence and typed provenance.** A :class:`LearnCandidate`
carries the text (inline-code spans verbatim), a category, a confidence between 0 and 1, the
index of the source it came from, and the provenance the fact will be stored with — the display
line (*"from PR #498 review cycle"* — the richer phrasing belongs to the richer extraction) and
the refs, each drawn from the source's own.

**There is no status anywhere in this contract.** Every candidate lands ``proposed`` in
``ouroboros-rest`` (decision **K3**): an extractor has no field to say otherwise.

**``extractor`` is always recorded** — decision **K10**, as ``Plan.planner`` is: a response
that cannot say what produced it does not get past the boundary.

Requests and responses are closed, like every shape under ``/v0``.
"""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

#: The kinds of source the contract carries. The first two are BH.1's; the last three are
#: the deterministic proposers' own sources, carried so an extractor may read them too.
LearnSourceKind = Literal[
    "pr_review_cycle", "run_observation", "correction_note", "waiver", "steer"
]

#: The provenance reference kinds a candidate may cite — ``ouroboros-db``'s
#: ``fact_provenance_typed`` vocabulary (V071, widened by V074), minus ``import``, which names
#: a file rather than a row and is the rule-file import's alone.
LearnRefKind = Literal[
    "run",
    "pull_request",
    "ticket",
    "classification",
    "waiver",
    "steer",
    "run_stage",
    "gate",
    "person",
]

#: The candidate categories — ``ouroboros-rest``'s ``CandidateCategory``.
LearnCategory = Literal["convention", "environment", "limitation", "instruction"]

#: The most sources one request may carry, and the longest a source's text may be.
MAX_SOURCES = 32
MAX_SOURCE_TEXT_LENGTH = 16_384

#: The most refs a source or a candidate may carry — the stored provenance's own cap.
MAX_REFS = 16

#: How many existing facts the caller may send, and how long each may be — the stored fact's
#: own cap.
MAX_EXISTING_FACTS = 500
MAX_FACT_LENGTH = 500

#: The most candidates one answer may hold, and the longest a candidate may be — the proposer
#: registry's own candidate cap, so an answer this contract accepts is one the registry can.
MAX_CANDIDATES = 64
MAX_CANDIDATE_LENGTH = 200

#: The longest provenance line — the stored provenance's own cap.
MAX_LINE_LENGTH = 200

#: The longest an extractor's name may be, and the notes an answer may carry.
MAX_EXTRACTOR_LENGTH = 64
MAX_NOTES = 16
MAX_NOTE_LENGTH = 512


class LearnRef(BaseModel):
    """One typed provenance reference — a row the fact was learned from.

    Attributes:
        kind: Which kind of row.
        id: The row's id — a canonical uuid, or a person's user id for ``person``.
    """

    model_config = ConfigDict(extra="forbid")

    kind: LearnRefKind = Field(examples=["pull_request"])
    id: str = Field(
        min_length=1, max_length=255, examples=["a7150000-0000-0000-0000-000000000498"]
    )


class LearnSource(BaseModel):
    """One thing the loop wrote, offered for extraction.

    Attributes:
        kind: What it is.
        label: How a provenance line names it — ``PR #498 review cycle``.
        text: The source's text, as people wrote it.
        refs: The rows it stands for. Every ref a candidate cites comes from here.
    """

    model_config = ConfigDict(extra="forbid")

    kind: LearnSourceKind = Field(examples=["pr_review_cycle"])
    label: str = Field(
        min_length=1, max_length=MAX_LINE_LENGTH, examples=["PR #498 review cycle"]
    )
    text: str = Field(min_length=1, max_length=MAX_SOURCE_TEXT_LENGTH)
    refs: list[LearnRef] = Field(max_length=MAX_REFS)


class LearnContext(BaseModel):
    """What the candidates are for, and what already exists.

    Attributes:
        repo: ``owner/name`` the facts would be scoped to, or ``None`` for the workspace.
        existing_facts: Facts the caller already holds, in any status — a hint an extractor
            may use to avoid restating them. The caller dedupes again regardless.
    """

    model_config = ConfigDict(extra="forbid")

    repo: str | None = Field(
        default=None, max_length=255, examples=["acme-robotics/helios-firmware"]
    )
    existing_facts: list[
        Annotated[str, Field(min_length=1, max_length=MAX_FACT_LENGTH)]
    ] = Field(default_factory=list, max_length=MAX_EXISTING_FACTS)


class LearnRequest(BaseModel):
    """The body of a ``POST /v0/learn`` request — a source bundle."""

    model_config = ConfigDict(extra="forbid")

    sources: list[LearnSource] = Field(min_length=1, max_length=MAX_SOURCES)
    context: LearnContext


class LearnProvenance(BaseModel):
    """What a candidate's fact will be stored with.

    Attributes:
        line: The card's line — honest about the extraction that produced it.
        refs: The rows it learned from — each one of its source's refs.
    """

    model_config = ConfigDict(extra="forbid")

    line: str = Field(
        min_length=1, max_length=MAX_LINE_LENGTH, examples=["from PR #498 review cycle"]
    )
    refs: list[LearnRef] = Field(max_length=MAX_REFS)


class LearnCandidate(BaseModel):
    """One fact an extractor offers. Lands ``proposed`` — there is no field to say otherwise.

    Attributes:
        text: The fact, inline-code spans verbatim.
        category: What kind of knowledge it is.
        confidence: The extractor's confidence, between 0 and 1.
        source_index: Which of the request's sources it came from (0-based).
        provenance: The line and refs the fact will carry.
    """

    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1, max_length=MAX_CANDIDATE_LENGTH)
    category: LearnCategory = Field(examples=["convention"])
    confidence: float = Field(ge=0, le=1, examples=[0.82])
    source_index: int = Field(ge=0, lt=MAX_SOURCES, examples=[0])
    provenance: LearnProvenance


class Learned(BaseModel):
    """The body of a ``POST /v0/learn`` response — candidates, and what produced them.

    Attributes:
        candidates: What was learned. Empty is a real answer.
        extractor: What produced them — decision **K10**; required and non-empty.
        notes: Sentences for an operator — why nothing was extracted, say.
    """

    model_config = ConfigDict(extra="forbid")

    candidates: list[LearnCandidate] = Field(max_length=MAX_CANDIDATES)
    extractor: str = Field(
        min_length=1, max_length=MAX_EXTRACTOR_LENGTH, examples=["unavailable-v0"]
    )
    notes: list[Annotated[str, Field(min_length=1, max_length=MAX_NOTE_LENGTH)]] = (
        Field(max_length=MAX_NOTES, examples=[[]])
    )


def honours_sources(learned: Learned, request: LearnRequest) -> list[str]:
    """Check an answer against the bundle it answered.

    A candidate must name a source that was sent, and cite only that source's refs —
    provenance an extractor invented is exactly the overclaiming K5 exists to prevent.

    Args:
        learned: The answer.
        request: The request it answered.

    Returns:
        One sentence per problem; empty when the answer honours the request.
    """
    problems: list[str] = []

    for index, candidate in enumerate(learned.candidates):
        if candidate.source_index >= len(request.sources):
            problems.append(
                f"candidate {index} names source {candidate.source_index}, "
                f"which the request did not send"
            )
            continue

        offered = {
            (ref.kind, ref.id) for ref in request.sources[candidate.source_index].refs
        }
        for ref in candidate.provenance.refs:
            if (ref.kind, ref.id) not in offered:
                problems.append(
                    f"candidate {index} cites {ref.kind} {ref.id}, "
                    f"which its source did not carry"
                )

    return problems
