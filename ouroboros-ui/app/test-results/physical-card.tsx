"use client";

import { useId } from "react";

import { Card, CardHead, Chip, Tag } from "@/app/ui";
import { cx } from "@/app/ui/class-names";

import {
  type CaseSelection,
  HIL_SCHEMA_HINT,
  MEASURED_PREFIX,
  type MeasuredLineView,
  NO_PHYSICAL_CASES,
  PHYSICAL_TITLE,
  type PhysicalRowView,
  type PhysicalView,
  READING_PHYSICAL,
  RIG_ONLINE,
  type RigGroupView,
} from "./physical";

/**
 * One measured line — the mockup's `p-meas`.
 *
 * @param props.line The line, from `measuredLine`.
 * @returns `measured: overshoot 2.4% vs limit 2.0%`, the value in the err hue when it breached,
 *   the limit and the comparative faint.
 */
function MeasuredLine({ line }: Readonly<{ line: MeasuredLineView }>) {
  return (
    <span className="tests-physical__measured">
      {MEASURED_PREFIX} {line.label}{" "}
      <span
        className={cx("tests-physical__value", line.breached && "tests-physical__value--breached")}
        data-breached={line.breached ? "true" : undefined}
      >
        {line.value}
      </span>{" "}
      <span className="tests-physical__limit">{line.limit}</span>
      {line.comparative !== null && (
        <>
          {" "}
          <span className="tests-physical__comparative">{line.comparative}</span>
        </>
      )}
    </span>
  );
}

/**
 * One `ptest` row.
 *
 * The button is the case's name, and its hit area is stretched over the whole row (`tests.css`),
 * so a click anywhere selects; Enter and Space are the button's own.
 *
 * @param props.row The row, from `physicalView`.
 * @param props.onSelect Select this case, or clear the selection when it is the selected one.
 * @returns The case, as a list item: its name and pill, what the rig did, and what it measured.
 */
function PhysicalRow({
  row,
  onSelect,
}: Readonly<{ row: PhysicalRowView; onSelect: () => void }>) {
  return (
    <li
      className="tests-physical__row"
      data-failing={row.failing ? "true" : undefined}
      data-selected={row.selected ? "true" : undefined}
    >
      <div className="tests-physical__top">
        <button
          aria-pressed={row.selected}
          className="tests-physical__select"
          onClick={onSelect}
          type="button"
        >
          {row.name}
        </button>
        <Chip tone={row.pill.tone}>{row.pill.text}</Chip>
      </div>
      {row.procedure !== null && <span className="tests-physical__did">{row.procedure}</span>}
      {row.measured.map((line) => (
        <MeasuredLine key={line.metric} line={line} />
      ))}
    </li>
  );
}

/**
 * One rig's group: its header, and its rows.
 *
 * The presence pill is drawn only for a rig that maps to a connected farm runner — a group whose
 * `online` is `false` draws none, rather than an *offline* nobody observed.
 *
 * @param props.group The group, from `physicalView`.
 * @param props.onSelect Select a case, or `null` to clear the selection.
 * @returns The group, as a section named by its rig.
 */
function RigGroup({
  group,
  onSelect,
}: Readonly<{ group: RigGroupView; onSelect: (selection: CaseSelection | null) => void }>) {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className="tests-physical__group">
      <header className="tests-physical__rig">
        <h3 className="tests-physical__rig-name" id={headingId}>
          {group.heading}
        </h3>
        {group.online && (
          <Chip dot="filled" tone="ok">
            {RIG_ONLINE}
          </Chip>
        )}
        <span className="tests-physical__spacer" />
        {group.bench !== null && <Tag>{group.bench}</Tag>}
      </header>

      {group.rows.length === 0 && <p className="tests-physical__note">{NO_PHYSICAL_CASES}</p>}
      {group.rows.length > 0 && group.degraded && (
        <p className="tests-physical__hint">{HIL_SCHEMA_HINT}</p>
      )}

      {group.rows.length > 0 && (
        <ul aria-label={`Physical tests on ${group.rig}`} className="tests-physical__list">
          {group.rows.map((row) => (
            <PhysicalRow
              key={row.id}
              onSelect={() =>
                onSelect(row.selected ? null : { name: row.name, platform: group.platform })
              }
              row={row}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/** What the card is told. */
export interface PhysicalCardProps {
  /** The groups, from `physicalView` — or `null` while the attempt's page has not been read. */
  readonly view: PhysicalView | null;
  /** Select a case, or `null` to clear the selection. */
  readonly onSelect: (selection: CaseSelection | null) => void;
  /** What happened to the selection — *…selection cleared.* — or `null`. */
  readonly notice: string | null;
}

/**
 * The physical-tests card ([#338](https://github.com/NobuData/ouroboros/issues/338)) — mockup
 * 11's rig card: one group per rig with its bench, and one row per case with its pass/FAIL pill,
 * what the rig did, and what it measured against its limit.
 *
 * **It is the page's case selector.** Selecting a row calls `onSelect` with the case's name, and
 * the screen — which owns the selection and its `?case=` — scopes the failure-detail card to it.
 * Pressing the selected row again clears it.
 *
 * **It is filtered by the suites card.** The screen hands it only the groups the selected suite
 * leaves, or the note that says why there are none.
 *
 * **It scrolls inside its own wrapper**, both ways, so a long or wide list never moves the pane.
 *
 * Every value is `physical.ts`'s; this file only draws.
 *
 * @param props See {@link PhysicalCardProps}.
 * @returns The card.
 */
export function PhysicalCard({ view, onSelect, notice }: PhysicalCardProps) {
  const titleId = useId();

  return (
    <Card aria-labelledby={titleId} as="section" className="tests-physical">
      <CardHead title={PHYSICAL_TITLE} titleId={titleId} />

      {notice !== null && (
        <p className="tests-physical__notice" role="status">
          {notice}
        </p>
      )}

      {view === null && <p className="tests-physical__note">{READING_PHYSICAL}</p>}
      {view !== null && view.note !== null && <p className="tests-physical__note">{view.note}</p>}

      {view !== null && view.groups.length > 0 && (
        <div className="tests-physical__scroll">
          {view.groups.map((group) => (
            <RigGroup group={group} key={group.id} onSelect={onSelect} />
          ))}
        </div>
      )}
    </Card>
  );
}
