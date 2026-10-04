"use client";

import type { ReactNode } from "react";

import { Card, CardHead, EmptyState, Tag, cx } from "@/app/ui";

import { SettingsSectionScope, useSettingsSave, useSettingsSectionId } from "./save-provider";
import {
  IMMEDIATE_MARK,
  type SectionSpan,
  type SettingsSectionId,
  sectionTitleId,
  settingsSection,
  unsavedMark,
} from "./view";

import "./settings.css";

/**
 * A section's seat in the settings grid
 * (BS.1, [#491](https://github.com/NobuData/ouroboros/issues/491)).
 *
 * The frame owns three facts about every card and the card owns none of them: **where it
 * sits** (the mockup's `c-5`/`c-7`/`c-12`), **the id the section nav's anchor lands on**, and
 * **which section it is to the save model**. So BS.2–BS.6 mount a card by rendering it inside
 * its seat and nothing else — the anchor, the scroll-spy and the dirty state's key are already
 * right, and a card cannot join a section it is not in.
 *
 * ### Empty, it says what is coming
 *
 * A seat with no card is not blank (`docs/DESIGN_SYSTEM_APP_SHELL.md` § 3.5): it draws the
 * section's heading and one line naming what fills it and the issue that builds it —
 * {@link SeatPlaceholder}. The heading is real, so the page's outline and its anchors are
 * complete before the first card lands.
 */

/** The class for each width — literals, so the style suite can see every one. */
const SPAN_CLASS: Record<SectionSpan, string> = {
  5: "settings__seat--5",
  7: "settings__seat--7",
  12: "settings__seat--12",
};

/** What a seat takes. */
export interface SettingsSeatProps {
  /** Which section this is. */
  readonly section: SettingsSectionId;
  /** The section's card. Omitted, the seat draws its placeholder. */
  readonly children?: ReactNode;
}

/**
 * The seat.
 *
 * @param props See {@link SettingsSeatProps}.
 * @returns The grid cell — carrying the section's id — with the card, or the placeholder, in it.
 */
export function SettingsSeat({ section, children }: SettingsSeatProps) {
  const { span } = settingsSection(section);

  return (
    <div className={cx("settings__seat", SPAN_CLASS[span])} id={section}>
      <SettingsSectionScope section={section}>
        {children ?? <SeatPlaceholder />}
      </SettingsSectionScope>
    </div>
  );
}

/**
 * How the section's controls take effect, as a marker for its card's head.
 *
 * Decision S7 asks that every control be visibly one kind or the other. A section whose
 * controls act at once says so, always; a batch section says how many of its fields are
 * unsaved while any are, and nothing while none is — a clean field needs no mark, and the
 * count is what tells a reader three cards from the head which card **Save changes** is about.
 *
 * Reads its section from the seat it is mounted in, so a card places it and passes nothing.
 *
 * @returns The marker, or nothing for a batch section with nothing unsaved — and nothing
 *   outside a seat.
 */
export function SectionMarks() {
  const section = useSettingsSectionId();
  const save = useSettingsSave();

  if (section === null) return null;
  if (settingsSection(section).saves === "immediate") return <Tag>{IMMEDIATE_MARK}</Tag>;

  const pending = save.sectionPending(section);

  return pending > 0 ? <Tag className="settings__unsaved">{unsavedMark(pending)}</Tag> : null;
}

/**
 * What a seat draws until its card exists: the section's heading, and what is coming.
 *
 * @param props.children Anything the section already has to show, above the note — the
 *   Policies seat mounts the dry-run policy there.
 * @returns The card.
 */
export function SeatPlaceholder({ children }: Readonly<{ children?: ReactNode }>) {
  const id = useSettingsSectionId();
  if (id === null) return null;

  const section = settingsSection(id);
  const titleId = sectionTitleId(id);

  return (
    <Card
      aria-labelledby={titleId}
      as="section"
      className={cx(id === "danger" && "settings__card--danger")}
    >
      <CardHead beside={<SectionMarks />} title={section.title} titleId={titleId} />
      {children}
      {section.arrives !== null && <EmptyState note={section.arrives} variant="flush" />}
    </Card>
  );
}
