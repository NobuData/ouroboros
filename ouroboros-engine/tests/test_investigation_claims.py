"""The citation gate: cite keys resolve against the ledger, and nothing else passes."""

import pytest

from ouroboros_engine.investigation.claims import (
    MAX_CLAIM_LENGTH,
    MAX_CLAIMS_PER_ANSWER,
    Candidate,
    Ledger,
    cite_label,
    compose_brief,
    gate_claims,
    gate_deliverable,
)
from ouroboros_engine.investigation.control import LedgerSource


def _source(number: int, key: str | None = None) -> LedgerSource:
    return LedgerSource(
        id=f"src-{number}",
        cite_no=number,
        cite_key=key,
        title=f"Source {number}",
        locator=f"https://example.com/{number}",
        excerpt="An excerpt.",
    )


@pytest.fixture
def ledger() -> Ledger:
    return Ledger([_source(7), _source(12), _source(31, "git")])


@pytest.mark.parametrize(
    ("cite", "expected"),
    [
        ("07", "src-7"),
        ("7", "src-7"),
        (7, "src-7"),
        ("[07]", "src-7"),
        (" [ 12 ] ", "src-12"),
        ("git", "src-31"),
        ("[git]", "src-31"),
        ("GIT", "src-31"),
        ("31", "src-31"),
        ("08", None),
        ("", None),
        ("src-7", None),
        (True, None),
        (None, None),
        (7.0, None),
        ({"cite": "07"}, None),
    ],
)
def test_a_cite_resolves_by_number_or_key_and_only_to_a_ledger_record(
    ledger: Ledger, cite: object, expected: str | None
) -> None:
    assert ledger.resolve(cite) == expected


def test_resolving_a_list_drops_unknown_keys_and_duplicates(ledger: Ledger) -> None:
    assert ledger.resolve_all(["07", "99", "[7]", "git"]) == ["src-7", "src-31"]
    assert ledger.resolve_all("07") == []
    assert ledger.resolve_all(None) == []


def test_the_ledger_counts_a_source_once(ledger: Ledger) -> None:
    assert ledger.add(_source(7)) is False
    assert ledger.add(_source(40)) is True
    assert len(ledger) == 4
    assert [source.cite_no for source in ledger.sources()] == [7, 12, 31, 40]
    assert "src-40" in ledger and "src-41" not in ledger


def test_a_source_is_named_to_the_model_by_key_or_padded_number() -> None:
    assert cite_label(_source(7)) == "07"
    assert cite_label(_source(31, "git")) == "git"
    assert cite_label(_source(112)) == "112"


def test_a_cited_claim_is_a_finding_and_an_uncited_one_is_demoted(
    ledger: Ledger,
) -> None:
    gated = gate_claims(
        {
            "claims": [
                {"text": "  The gap is\ncontrol.  ", "cites": ["07"]},
                {"text": "A hunch.", "cites": []},
                {"text": "Cites nothing real.", "cites": ["99"]},
                {"text": "No cites key at all."},
            ],
            "open_questions": ["Why?", {"text": "And how?"}],
        },
        ledger,
    )

    assert [(c.text, c.finding, c.demoted) for c in gated] == [
        ("The gap is control.", True, False),
        ("A hunch.", False, True),
        ("Cites nothing real.", False, True),
        ("No cites key at all.", False, True),
        ("Why?", False, False),
        ("And how?", False, False),
    ]
    assert gated[0].sources == ["src-7"]


def test_a_malformed_answer_yields_no_claims_rather_than_an_error(
    ledger: Ledger,
) -> None:
    assert gate_claims({}, ledger) == []
    assert gate_claims({"claims": "all of them", "open_questions": 3}, ledger) == []
    assert (
        gate_claims({"claims": ["text", 4, {"text": ""}, {"text": 9}, None]}, ledger)
        == []
    )


def test_an_answer_is_bounded_in_claims_and_in_length(ledger: Ledger) -> None:
    answer = {
        "claims": [{"text": f"Claim {n}", "cites": ["07"]} for n in range(200)]
        + [{"text": "x" * 9_000, "cites": ["07"]}]
    }
    gated = gate_claims(answer, ledger)
    assert len(gated) == MAX_CLAIMS_PER_ANSWER

    long = gate_claims({"claims": [{"text": "x" * 9_000, "cites": ["07"]}]}, ledger)
    assert len(long[0].text) == MAX_CLAIM_LENGTH


def test_the_brief_states_each_claim_in_exactly_one_span() -> None:
    sections = [
        [
            Candidate(text="First.", sources=["src-7"], offered_as_finding=True),
            Candidate(text="Uncited.", sources=[], offered_as_finding=True),
            Candidate(text="Second.", sources=["src-12"], offered_as_finding=True),
        ],
        [
            Candidate(text="Why?", sources=[], offered_as_finding=False),
            Candidate(text="First.", sources=["src-7"], offered_as_finding=True),
        ],
    ]

    body, claims = compose_brief(sections)

    assert [[(s.text, s.claim) for s in p.spans] for p in body.paragraphs] == [
        [("First.", "c1"), (" Second.", "c2")],
        [("Uncited.", "q1"), (" Why?", "q2")],
    ]
    assert [(c.ref, c.type, c.demoted, c.sources) for c in claims] == [
        ("c1", "finding", False, ["src-7"]),
        ("c2", "finding", False, ["src-12"]),
        ("q1", "open_question", True, []),
        ("q2", "open_question", False, []),
    ]


def test_a_finding_claim_never_leaves_the_composer_without_a_source() -> None:
    _, claims = compose_brief(
        [
            [Candidate(text=f"Claim {n}.", sources=[], offered_as_finding=True)]
            for n in range(5)
        ]
    )
    assert {claim.type for claim in claims} == {"open_question"}


def test_nothing_to_say_composes_nothing() -> None:
    body, claims = compose_brief([[], []])
    assert body.paragraphs == [] and claims == []


def test_a_deliverable_cannot_carry_source_ids_the_gate_did_not_resolve(
    ledger: Ledger,
) -> None:
    gated = gate_deliverable(
        {
            "title": "T",
            "sources": ["src-forged"],
            "rows": [
                {"capability": "A", "cites": ["07", "nope"], "sources": ["src-forged"]},
                {"status": "shipping", "cites": []},
                {"status": "none", "cites": "07"},
                {"note": "no cites key", "n": 3},
            ],
        },
        ledger,
    )

    assert gated == {
        "title": "T",
        "rows": [
            {"capability": "A", "sources": ["src-7"]},
            {"status": "unknown", "sources": []},
            {"status": "unknown", "sources": []},
            {"note": "no cites key", "n": 3},
        ],
    }


def test_a_deliverable_nested_absurdly_deep_is_cut_not_recursed(ledger: Ledger) -> None:
    deep: dict = {}
    cursor = deep
    for _ in range(5_000):
        cursor["next"] = {}
        cursor = cursor["next"]

    gated = gate_deliverable(deep, ledger)

    depth = 0
    while isinstance(gated, dict) and "next" in gated:
        gated = gated["next"]
        depth += 1
    assert depth <= 13 and gated is None
