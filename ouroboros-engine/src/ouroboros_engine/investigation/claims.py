"""The citation gate — where *"every claim cited"* is enforced, not requested.

Decision V3: a claim without a citation cannot render as a finding. Asking a model to cite
its sources produces citations most of the time; this module is what makes it true every
time. Whatever synthesis answers passes through here before it is delivered:

* a candidate claim's cite keys are resolved **against the ledger the tools filled** —
  ``07`` or ``[07]`` by cite number, ``git`` by cite key. A key that names no record is
  dropped: a model cannot cite a source the investigation never read;
* a candidate left with no record is **demoted to an open question**, marked as demoted and
  logged by the loop — never published as a finding;
* a deliverable input gets the same treatment, item by item (:func:`gate_deliverable`).

Nothing here calls a model or the control plane; it is pure, so the property it guards is
testable in isolation.
"""

from __future__ import annotations

import re
from typing import Any

from pydantic import BaseModel, ConfigDict

from .control import BriefBody, Claim, LedgerSource, Paragraph, Span

#: The most claims one synthesis answer may contribute; the rest are ignored.
MAX_CLAIMS_PER_ANSWER = 60

#: The longest claim kept, in characters.
MAX_CLAIM_LENGTH = 2_000

#: How deep a deliverable input may nest before the rest is cut off.
MAX_DELIVERABLE_DEPTH = 12

#: The key a model writes its cite keys under, and the key the control plane reads the
#: resolved ``source_records`` ids from.
CITES_KEY = "cites"
SOURCES_KEY = "sources"

_BRACKETS = re.compile(r"^\[(.*)\]$")


class Ledger:
    """The sources an investigation has archived, addressable the way a brief cites them."""

    def __init__(self, sources: list[LedgerSource] | None = None) -> None:
        """Start a ledger.

        Args:
            sources: What is already archived.
        """
        self._by_id: dict[str, LedgerSource] = {}
        for source in sources or []:
            self.add(source)

    def add(self, source: LedgerSource) -> bool:
        """Record a source.

        Args:
            source: The archived record.

        Returns:
            ``True`` when it was new to this ledger.
        """
        if source.id in self._by_id:
            return False
        self._by_id[source.id] = source
        return True

    def __len__(self) -> int:
        """How many sources are archived."""
        return len(self._by_id)

    def __contains__(self, source_id: object) -> bool:
        """Whether a ``source_records`` id is in the ledger."""
        return source_id in self._by_id

    def sources(self) -> list[LedgerSource]:
        """The sources, in cite-number order."""
        return sorted(self._by_id.values(), key=lambda source: source.cite_no)

    def resolve(self, cite: object) -> str | None:
        """Resolve one cite key to a ``source_records`` id.

        Args:
            cite: What the model wrote — ``7``, ``"07"``, ``"[07]"``, ``"git"``.

        Returns:
            The record's id, or ``None`` when the ledger has no such record.
        """
        if isinstance(cite, bool):
            return None
        if isinstance(cite, int):
            key = str(cite)
        elif isinstance(cite, str):
            key = cite.strip()
            bracketed = _BRACKETS.match(key)
            if bracketed:
                key = bracketed.group(1).strip()
        else:
            return None
        if not key:
            return None

        for source in self._by_id.values():
            if source.cite_key is not None and source.cite_key == key.lower():
                return source.id
        if key.isdecimal():
            number = int(key)
            for source in self._by_id.values():
                if source.cite_no == number:
                    return source.id
        return None

    def resolve_all(self, cites: object) -> list[str]:
        """Resolve a list of cite keys, dropping the ones that name nothing.

        Args:
            cites: Whatever the model put under ``cites``.

        Returns:
            The distinct record ids, in the order first cited.
        """
        if not isinstance(cites, list):
            return []
        resolved: list[str] = []
        for cite in cites:
            source_id = self.resolve(cite)
            if source_id is not None and source_id not in resolved:
                resolved.append(source_id)
        return resolved


def cite_label(source: LedgerSource) -> str:
    """How a source is named to the model — its key, or its zero-padded number.

    Args:
        source: The record.

    Returns:
        ``git`` or ``07``.
    """
    return source.cite_key or f"{source.cite_no:02d}"


class Candidate(BaseModel):
    """A claim as synthesis offered it, gated. A model so a checkpoint can carry it.

    Attributes:
        text: The claim.
        sources: The ledger records it resolved to.
        offered_as_finding: Whether the model offered it as a finding (as opposed to an
            open question of its own).
    """

    model_config = ConfigDict(frozen=True, extra="ignore")

    text: str
    sources: list[str]
    offered_as_finding: bool

    @property
    def finding(self) -> bool:
        """Whether it may be published as a finding — offered as one, and cited."""
        return self.offered_as_finding and bool(self.sources)

    @property
    def demoted(self) -> bool:
        """Whether it was offered as a finding and could not point at a record."""
        return self.offered_as_finding and not self.sources


def gate_claims(answer: dict[str, Any], ledger: Ledger) -> list[Candidate]:
    """Gate one synthesis answer.

    Args:
        answer: ``{"claims": [{"text", "cites"}], "open_questions": [text]}`` — anything
            else in it is ignored, and anything malformed is skipped.
        ledger: The investigation's ledger.

    Returns:
        The candidates, findings and open questions together, in the order offered.
    """
    gated: list[Candidate] = []

    claims = answer.get("claims")
    for entry in claims if isinstance(claims, list) else []:
        if not isinstance(entry, dict):
            continue
        text = _clean(entry.get("text"))
        if text is None:
            continue
        gated.append(
            Candidate(
                text=text,
                sources=ledger.resolve_all(entry.get(CITES_KEY)),
                offered_as_finding=True,
            )
        )

    questions = answer.get("open_questions")
    for entry in questions if isinstance(questions, list) else []:
        text = _clean(entry.get("text") if isinstance(entry, dict) else entry)
        if text is not None:
            gated.append(Candidate(text=text, sources=[], offered_as_finding=False))

    return gated[:MAX_CLAIMS_PER_ANSWER]


def compose_brief(sections: list[list[Candidate]]) -> tuple[BriefBody, list[Claim]]:
    """Build the brief and its claim rows from the gated sections.

    One paragraph per section that has findings, then one closing paragraph of open
    questions. Every span states one claim, so the body's claim refs and the claim rows
    match one to one — V108's ``brief_claims_span_in_body``.

    Args:
        sections: The candidates of each synthesis pass, in order.

    Returns:
        The body and the claims. Both empty when there is nothing to say.
    """
    paragraphs: list[Paragraph] = []
    claims: list[Claim] = []
    questions: list[Candidate] = []
    seen: set[str] = set()

    for section in sections:
        spans: list[Span] = []
        for candidate in section:
            if candidate.text in seen:
                continue
            seen.add(candidate.text)
            if not candidate.finding:
                questions.append(candidate)
                continue
            ref = f"c{len(claims) + 1}"
            claims.append(
                Claim(
                    ref=ref,
                    type="finding",
                    text=candidate.text,
                    sources=candidate.sources,
                )
            )
            spans.append(Span(text=_joined(candidate.text, first=not spans), claim=ref))
        if spans:
            paragraphs.append(Paragraph(spans=spans))

    spans = []
    for number, candidate in enumerate(questions, start=1):
        ref = f"q{number}"
        claims.append(
            Claim(
                ref=ref,
                type="open_question",
                text=candidate.text,
                sources=[],
                demoted=candidate.demoted,
            )
        )
        spans.append(Span(text=_joined(candidate.text, first=not spans), claim=ref))
    if spans:
        paragraphs.append(Paragraph(spans=spans))

    return BriefBody(paragraphs=paragraphs), claims


def gate_deliverable(value: Any, ledger: Ledger, depth: int = 0) -> Any:
    """Gate a deliverable input: resolve every item's cites, and say so when it has none.

    Walks the JSON the model answered. Wherever an object carries ``cites``, they are
    replaced by ``sources`` — the resolved record ids. An item left with none is not
    silently kept as if it were supported: one that has a ``status`` (a matrix cell) becomes
    ``unknown`` — decision V7's honest *we did not find out* — and any other is marked
    ``uncited``.

    Args:
        value: The deliverable JSON, or a part of it.
        ledger: The investigation's ledger.
        depth: How deep this call is; nesting past :data:`MAX_DELIVERABLE_DEPTH` is cut.

    Returns:
        The gated value, safe to send to the control plane.
    """
    if depth > MAX_DELIVERABLE_DEPTH:
        return None
    if isinstance(value, list):
        return [gate_deliverable(item, ledger, depth + 1) for item in value]
    if not isinstance(value, dict):
        return value

    gated: dict[str, Any] = {
        key: gate_deliverable(item, ledger, depth + 1)
        for key, item in value.items()
        # A model may not hand over ``sources`` directly: ids only ever come from the gate.
        if key not in (CITES_KEY, SOURCES_KEY)
    }
    if CITES_KEY in value:
        sources = ledger.resolve_all(value[CITES_KEY])
        gated[SOURCES_KEY] = sources
        if not sources:
            if "status" in gated:
                gated["status"] = "unknown"
            else:
                gated["uncited"] = True
    return gated


def _clean(text: object) -> str | None:
    """Normalise a claim's text.

    Args:
        text: What the model wrote.

    Returns:
        The text with its whitespace collapsed and its length bounded, or ``None`` when it
        is not a non-blank string.
    """
    if not isinstance(text, str):
        return None
    collapsed = " ".join(text.split())
    return collapsed[:MAX_CLAIM_LENGTH] or None


def _joined(text: str, *, first: bool) -> str:
    """A span's text, separated from the span before it.

    Args:
        text: The claim.
        first: Whether it opens its paragraph.

    Returns:
        The text, with a leading space unless it opens the paragraph.
    """
    return text if first else f" {text}"
