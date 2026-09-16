"""The outline parser — what it reads off a document, and what it refuses to read into one.

:mod:`tests.test_planning_planner` owns what an outline *means*; this file owns what it
*says*. The two are separated for the reason the parser and the planner are: a rule about
markdown is something a reviewer should be able to check without holding the contract in
their head too.

The cases that matter most here are the negative ones. A parser that reads a dependency out
of the order somebody typed their bullets in, or a workflow tag out of a markdown link, is a
parser that invents — and inventing is the one thing decision **N2**'s staging exists to
avoid.
"""

import pytest

from ouroboros_engine.planning.outline import parse_outline

# ---------------------------------------------------------------------------
# A bullet is a ticket; what is under it is not
# ---------------------------------------------------------------------------


def test_each_top_level_bullet_becomes_one_item() -> None:
    outline = parse_outline("- First\n- Second\n- Third")

    assert [item.title for item in outline.items] == ["First", "Second", "Third"]


@pytest.mark.parametrize("bullet", ["-", "*", "+"])
def test_every_unordered_bullet_character_is_a_bullet(bullet: str) -> None:
    assert parse_outline(f"{bullet} A task").items[0].title == "A task"


@pytest.mark.parametrize("marker", ["1.", "1)", "12."])
def test_a_numbered_item_is_a_bullet_too(marker: str) -> None:
    outline = parse_outline(f"{marker} A task")

    assert outline.items[0].title == "A task"
    assert outline.items[0].ordered


def test_an_unordered_bullet_is_not_ordered() -> None:
    assert not parse_outline("- A task").items[0].ordered


def test_nested_bullets_become_the_item_s_detail() -> None:
    outline = parse_outline("- Rollback\n  - restore the slot\n  - emit telemetry")

    assert outline.items[0].title == "Rollback"
    assert outline.items[0].detail == ("- restore the slot", "- emit telemetry")


def test_detail_is_pulled_flush_but_keeps_its_relative_nesting() -> None:
    # The body becomes a ticket description, so the first level of detail belongs against
    # the margin — while a line nested one level deeper stays one level deeper.
    outline = parse_outline("- Rollback\n    - restore the slot\n        - and log it")

    assert outline.items[0].detail == ("- restore the slot", "    - and log it")


def test_a_line_that_is_not_a_bullet_continues_the_item_it_sits_under() -> None:
    outline = parse_outline("- Rollback\n  it has to survive a power cut")

    assert outline.items[0].detail == ("it has to survive a power cut",)


def test_the_shallowest_bullet_is_the_ticket_level() -> None:
    # An outline pasted with a uniform indent — out of a textarea, an email, a YAML block —
    # parses as the same three tickets it would flush left.
    outline = parse_outline("    - First\n    - Second\n      - detail\n    - Third")

    assert [item.title for item in outline.items] == ["First", "Second", "Third"]
    assert outline.items[1].detail == ("- detail",)


def test_tabs_are_indentation_too() -> None:
    outline = parse_outline("- Rollback\n\t- restore the slot")

    assert outline.items[0].detail == ("- restore the slot",)
    assert len(outline.items) == 1, (
        "a tab-indented bullet is detail, not a second ticket"
    )


def test_blank_lines_are_not_structure() -> None:
    outline = parse_outline("- First\n\n- Second\n")

    assert len(outline.items) == 2


def test_a_document_with_no_list_has_no_items() -> None:
    outline = parse_outline("We should really fix the updater at some point.")

    assert outline.items == ()
    assert outline.preamble == ("We should really fix the updater at some point.",)


def test_an_empty_document_is_a_valid_argument() -> None:
    assert parse_outline("").items == ()


# ---------------------------------------------------------------------------
# Dependencies: written down, never inferred from typing order
# ---------------------------------------------------------------------------


def test_blocks_names_the_key_this_item_blocks() -> None:
    assert parse_outline("- Partition table  blocks: OTA-3").items[0].blocks == (
        "OTA-3",
    )


def test_after_names_the_key_this_item_follows() -> None:
    assert parse_outline("- Ship the collector  after: TEL-1").items[0].after == (
        "TEL-1",
    )


def test_one_annotation_may_name_several_keys() -> None:
    item = parse_outline("- Groundwork  blocks: OTA-2, OTA-3").items[0]

    assert item.blocks == ("OTA-2", "OTA-3")


def test_both_annotations_can_appear_on_one_line() -> None:
    item = parse_outline("- Middle  after: A-1  blocks: A-3").items[0]

    assert item.after == ("A-1",)
    assert item.blocks == ("A-3",)


@pytest.mark.parametrize("written", ["BLOCKS: OTA-3", "Blocks: OTA-3", "blocks:OTA-3"])
def test_an_annotation_is_read_however_it_was_typed(written: str) -> None:
    assert parse_outline(f"- Partition table  {written}").items[0].blocks == ("OTA-3",)


def test_a_key_is_upper_cased_however_it_was_written() -> None:
    assert parse_outline("- Task  blocks: ota-3").items[0].blocks == ("OTA-3",)


def test_a_repeated_key_is_named_once() -> None:
    item = parse_outline("- Task  blocks: OTA-3, OTA-3").items[0]

    assert item.blocks == ("OTA-3",)


def test_an_annotation_is_taken_out_of_the_title() -> None:
    # Otherwise every dependency an author declares ends up in the issue title they get.
    item = parse_outline("- Partition table for A/B slots  blocks: OTA-3").items[0]

    assert item.title == "Partition table for A/B slots"


def test_an_annotation_indented_under_a_bullet_is_body_text_and_is_reported() -> None:
    # It is the author's mistake and a silent one would cost them an edge they thought they
    # had drawn, so the parser hands it back for the planner to mention.
    outline = parse_outline("- Recovery beacon\n    blocks: HRD-1")

    assert outline.items[0].blocks == ()
    assert outline.stray_annotations == ("blocks: HRD-1",)


def test_the_order_bullets_were_typed_in_declares_nothing() -> None:
    # The heart of it: an unordered list is a set of tasks. A parser that chained these
    # would be inventing a dependency nobody wrote.
    outline = parse_outline("- First\n- Second\n- Third")

    assert all(item.blocks == () and item.after == () for item in outline.items)


# ---------------------------------------------------------------------------
# Workflow markers
# ---------------------------------------------------------------------------


def test_a_bracketed_marker_is_read_and_taken_out_of_the_title() -> None:
    item = parse_outline("- Write the runbook  [docs]").items[0]

    assert item.markers == ("docs",)
    assert item.title == "Write the runbook"


def test_a_marker_is_lower_cased() -> None:
    assert parse_outline("- Task  [Docs]").items[0].markers == ("docs",)


def test_a_markdown_link_is_not_a_marker() -> None:
    # `[text](url)` is the shape this would most easily get wrong, and getting it wrong
    # means a workflow suggestion read out of somebody's hyperlink.
    item = parse_outline("- See [the spec](https://example.test/spec) first").items[0]

    assert item.markers == ()
    assert "the spec" in item.title


def test_a_bullet_that_is_only_a_marker_has_no_title() -> None:
    # Reported as an item with an empty title rather than dropped here: what to do about a
    # nameless ticket is the planner's decision, not the parser's.
    item = parse_outline("- [docs]").items[0]

    assert item.title == ""
    assert item.markers == ("docs",)


# ---------------------------------------------------------------------------
# What was seen and not used
# ---------------------------------------------------------------------------


def test_prose_before_the_first_bullet_is_kept_as_preamble() -> None:
    outline = parse_outline("Here is what I think it takes:\n- Audit the bootloader")

    assert outline.preamble == ("Here is what I think it takes:",)
    assert [item.title for item in outline.items] == ["Audit the bootloader"]


def test_whitespace_inside_a_title_is_collapsed() -> None:
    assert parse_outline("-   Lots    of   space  ").items[0].title == "Lots of space"


def test_items_are_numbered_in_document_order() -> None:
    outline = parse_outline("- First\n- Second")

    assert [item.ordinal for item in outline.items] == [1, 2]


def test_the_same_document_parses_the_same_way_twice() -> None:
    document = "- First  blocks: X-2\n  - detail\n- Second  [docs]"

    assert parse_outline(document) == parse_outline(document)
