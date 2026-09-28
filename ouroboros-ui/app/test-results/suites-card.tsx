"use client";

import { type KeyboardEvent, useId, useRef, useState } from "react";

import { Card, CardHead, Chip, Meter, RetryBanner, Tag } from "@/app/ui";
import { cx } from "@/app/ui/class-names";

import {
  type CaseRowView,
  NO_CASES,
  NO_SUITES,
  READING_SUITES,
  SUITES_LIST_LABEL,
  SUITES_STALE_HEADLINE,
  SUITES_TITLE,
  SUITES_UNREAD_HEADLINE,
  type SuiteRowView,
  type SuiteSelection,
  type SuiteTone,
  type SuitesView,
  nextRowIndex,
} from "./suites";

/** The modifier each status adds to a row's count. */
const COUNT_CLASS: Readonly<Record<SuiteTone, string>> = {
  ok: "tests-suites__count--ok",
  warn: "tests-suites__count--warn",
  err: "tests-suites__count--err",
  neutral: "tests-suites__count--neutral",
};

/**
 * What a row is remembered as open under — its name and platform, which an attempt switch and a
 * poll both keep, where its id is one attempt's.
 *
 * @param row The row.
 * @returns The key.
 */
function drillKey(row: Pick<SuiteRowView, "name" | "platform">): string {
  return `${row.name}\u0000${row.platform}`;
}

/**
 * One case of an open suite.
 *
 * @param props.row The case, from `caseView`.
 * @returns The case, as a list item: its name, status, duration and retry chip.
 */
function CaseRow({ row }: Readonly<{ row: CaseRowView }>) {
  return (
    <li className="tests-suites__case">
      <span className="tests-suites__case-name">{row.name}</span>
      <Chip tone={row.tone}>{row.status}</Chip>
      {row.retry !== null && (
        <Chip mono title={row.retry.title} tone="warn">
          {row.retry.text}
        </Chip>
      )}
      {row.duration !== null && <span className="tests-suites__case-duration">{row.duration}</span>}
    </li>
  );
}

/** What one suite row is told. */
interface SuiteRowProps {
  /** The row, from `suitesView`. */
  readonly row: SuiteRowView;
  /** Whether its cases are listed. */
  readonly open: boolean;
  /** Select this suite, or clear the selection when it is the selected one. */
  readonly onSelect: () => void;
  /** List or fold its cases. */
  readonly onToggle: () => void;
  /** A key was pressed on the row's button — the card moves focus between rows. */
  readonly onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  /** Hands the card the row's button, so it can be focused. */
  readonly register: (button: HTMLButtonElement | null) => void;
}

/**
 * One suite.
 *
 * The button is the suite's name, and its hit area is stretched over the whole row
 * (`tests.css`), so a click anywhere selects; Enter and Space are the button's own. The
 * disclosure is a sibling drawn above that area rather than a child — a button inside a button
 * is not reachable by keyboard. The platform is a tag and nothing more: there is no platform
 * page, and a link would promise one.
 *
 * @param props See {@link SuiteRowProps}.
 * @returns The suite, as a list item, with its cases beneath when open.
 */
function SuiteRow({ row, open, onSelect, onToggle, onKeyDown, register }: SuiteRowProps) {
  const casesId = useId();

  return (
    <li className="tests-suites__item">
      <div className="tests-suites__row" data-selected={row.selected ? "true" : undefined}>
        <button
          aria-pressed={row.selected}
          className="tests-suites__select"
          onClick={onSelect}
          onKeyDown={onKeyDown}
          ref={register}
          type="button"
        >
          {row.label}
        </button>
        <Tag>{row.platform}</Tag>
        <Meter className="tests-suites__meter" tone={row.meterTone ?? "accent"} value={row.ratio} />
        <span
          aria-label={row.countLabel}
          className={cx("tests-suites__count", COUNT_CLASS[row.tone])}
          role="img"
        >
          {row.count}
        </span>
        <button
          aria-controls={open ? casesId : undefined}
          aria-expanded={open}
          aria-label={`Cases of ${row.label}`}
          className="tests-suites__toggle"
          onClick={onToggle}
          type="button"
        >
          <span aria-hidden className="tests-suites__chevron">
            ▸
          </span>
        </button>
      </div>
      {open &&
        (row.cases.length === 0 ? (
          <p className="tests-suites__note" id={casesId}>
            {NO_CASES}
          </p>
        ) : (
          <ul aria-label={`Cases of ${row.label}`} className="tests-suites__cases" id={casesId}>
            {row.cases.map((each) => (
              <CaseRow key={each.id} row={each} />
            ))}
          </ul>
        ))}
    </li>
  );
}

/** What the card is told. */
export interface SuitesCardProps {
  /** The rows, from `suitesView` — or `null` while the attempt's page has not been read. */
  readonly view: SuitesView | null;
  /** Why the last read failed, or `null`. */
  readonly error: string | null;
  /** Ask again. */
  readonly onRetry: () => void;
  /** Select a suite, or `null` to clear the selection. */
  readonly onSelect: (selection: SuiteSelection | null) => void;
  /** What happened to the selection — *…did not run in Build 1 — selection cleared.* — or `null`. */
  readonly notice: string | null;
}

/**
 * The suites card ([#337](https://github.com/NobuData/ouroboros/issues/337)) — mockup 11's grid:
 * one row per suite with its platform tag, a meter and a count coloured by how the suite went,
 * the selected one inset in the accent, and each suite's cases a disclosure away.
 *
 * **It is the page's suite selector.** Selecting a row calls `onSelect` with the suite's name, and
 * the screen — which owns the selection and its `?suite=` — scopes the physical-tests and
 * failure-detail cards to it. Pressing the selected row again clears it.
 *
 * **Selecting and opening are two gestures.** The row selects; the chevron lists the cases, with
 * status, duration and a retry chip — the flaky case's `retry 2/3`. Any number of suites may be
 * open, and what is open is remembered by name, so a poll or an attempt switch does not fold it.
 *
 * **The keyboard walks the rows**: Arrow Up and Down, Home and End move focus between the rows'
 * buttons, Tab reaches each row's chevron, and Enter or Space press whichever has focus.
 *
 * **It scrolls inside its own wrapper**, both ways, so a long or wide list never moves the pane.
 *
 * Every value is `suites.ts`'s; this file only draws.
 *
 * @param props See {@link SuitesCardProps}.
 * @returns The card.
 */
export function SuitesCard({ view, error, onRetry, onSelect, notice }: SuitesCardProps) {
  const titleId = useId();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const rows = view?.rows ?? [];

  /**
   * List a suite's cases, or fold them.
   *
   * @param key The suite's {@link drillKey}.
   */
  function toggle(key: string): void {
    setOpen((held) => {
      const next = new Set(held);
      if (!next.delete(key)) next.add(key);

      return next;
    });
  }

  /**
   * Move focus between rows.
   *
   * @param event The key press.
   * @param index The row it was pressed on.
   */
  function walk(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    const target = nextRowIndex(event.key, index, rows.length);
    if (target === null) return;

    event.preventDefault();
    buttons.current[target]?.focus();
  }

  return (
    <Card aria-labelledby={titleId} as="section" className="tests-suites">
      <CardHead title={SUITES_TITLE} titleId={titleId} />

      {error !== null && (
        <RetryBanner
          className="tests-suites__banner"
          headline={view === null ? SUITES_UNREAD_HEADLINE : SUITES_STALE_HEADLINE}
          onRetry={onRetry}
          reason={error}
        />
      )}

      {notice !== null && (
        <p className="tests-suites__notice" role="status">
          {notice}
        </p>
      )}

      {view === null && error === null && <p className="tests-suites__note">{READING_SUITES}</p>}
      {view !== null && rows.length === 0 && <p className="tests-suites__note">{NO_SUITES}</p>}

      {rows.length > 0 && (
        <div className="tests-suites__scroll">
          <ul aria-label={SUITES_LIST_LABEL} className="tests-suites__list">
            {rows.map((row, index) => (
              <SuiteRow
                key={row.id}
                onKeyDown={(event) => walk(event, index)}
                onSelect={() =>
                  onSelect(row.selected ? null : { name: row.name, platform: row.platform })
                }
                onToggle={() => toggle(drillKey(row))}
                open={open.has(drillKey(row))}
                register={(button) => {
                  buttons.current[index] = button;
                }}
                row={row}
              />
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
