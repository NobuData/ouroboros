"use client";

import { useId } from "react";

import { MODELS_PATH } from "@/app/paths";
import { Button, Card, CardHead, Chip, type Column, Meter, Table, cx } from "@/app/ui";

import { useInsights } from "./insights-store";
import { MethodTip } from "./method-tip";
import { SeriesEmptyState } from "./series-card";
import {
  APPLY_LABEL,
  COLUMN,
  LOW_SAMPLE,
  NO_SCOREBOARD,
  ROUTING_RULES_LABEL,
  SCOREBOARD_CAPTION,
  SCOREBOARD_TITLE,
  type ColumnNote,
  type ScoreboardRowView,
  type TrendTone,
  columnNotes,
  scoreboardRow,
  suggestionView,
} from "./scoreboard-view";

/** The trend cell's class for each tone — goodness, never sign. */
const TREND_CLASS: Record<TrendTone, string> = {
  up: "insights-board__trend--good",
  down: "insights-board__trend--bad",
  muted: "insights-board__trend--none",
};

/**
 * A column heading that opens its registry entry — the untouched definition, the `$ / success`
 * denominator — on hover and on focus.
 *
 * @param note The heading and what its popover says.
 * @returns The heading.
 */
function NotedHeading(note: ColumnNote) {
  return <MethodTip label={note.label} method={note.text} />;
}

/**
 * The scoreboard's columns.
 *
 * @param notes The two column popovers.
 * @returns The columns, in the mockup's order.
 */
function columns(notes: ReturnType<typeof columnNotes>): Column<ScoreboardRowView>[] {
  return [
    {
      key: "task",
      header: COLUMN.task,
      cell: (row) => (
        <span className="insights-board__task">
          {row.task}
          {row.role !== null && <span className="insights-board__role">({row.role})</span>}
          {row.lowSample !== null && (
            <Chip className="insights-board__sample" title={row.lowSample} tone="warn">
              {LOW_SAMPLE}
              <span className="sr-only">{`: ${row.lowSample}`}</span>
            </Chip>
          )}
        </span>
      ),
    },
    {
      key: "model",
      header: COLUMN.model,
      cell: (row) => (
        <Chip mono tone="model">
          {row.model}
        </Chip>
      ),
    },
    {
      key: "untouched",
      header: NotedHeading(notes.untouched),
      className: "insights-board__untouched-col",
      cell: (row) => (
        <span className="insights-board__untouched">
          <Meter className="insights-board__meter" value={row.untouched ?? 0} />
          <span className="insights-board__rate">{row.untouchedText}</span>
        </span>
      ),
    },
    {
      key: "cost",
      header: NotedHeading(notes.cost),
      align: "end",
      mono: true,
      cell: (row) => <span title={row.cost.note ?? undefined}>{row.cost.text}</span>,
    },
    {
      key: "trend",
      header: COLUMN.trend,
      align: "end",
      mono: true,
      cell: (row) => (
        <span className={cx("insights-board__trend", TREND_CLASS[row.trend.tone])} title={row.trend.label}>
          <span aria-hidden="true">{row.trend.glyph}</span>
          <span className="sr-only">{row.trend.label}</span>
        </span>
      ),
    },
  ];
}

/**
 * Mockup 15's **MODEL SCOREBOARD** (BK.4, [#445](https://github.com/NobuData/ouroboros/issues/445)).
 *
 * The #46 `Table` over BJ.3's rows ([#439](https://github.com/NobuData/ouroboros/issues/439)) —
 * task with its fallback hop, model pill, untouched meter with its number, `$ / success` in mono
 * and the trend arrow — inside the table's own scroll wrapper, so a narrow pane scrolls the table
 * and never the page. The untouched and `$ / success` headings open their registry entries.
 *
 * Under the table, the suggestion band renders AB.3's payload
 * ([#209](https://github.com/NobuData/ouroboros/issues/209)) with its deep link, **and is absent
 * when there is none** — nothing here composes advice (`app/insights/scoreboard-view.ts`).
 *
 * @returns The card.
 */
export function ScoreboardCard() {
  const { page } = useInsights();
  const titleId = useId();
  const head = (
    <CardHead
      title={SCOREBOARD_TITLE}
      titleId={titleId}
      trailing={
        <Button href={MODELS_PATH} size="sm" tone="ghost">
          {ROUTING_RULES_LABEL}
        </Button>
      }
    />
  );

  if (page === null) {
    return (
      <Card aria-busy aria-labelledby={titleId} as="section" className="insights-board insights-col--8" fill>
        {head}
        <div aria-hidden="true" className="insights-board__skeleton" />
      </Card>
    );
  }

  const board = page.scoreboard;
  const rows = board.rows.map((row) => scoreboardRow(row, board.minSample));
  const suggestion = suggestionView(board.suggestion);

  return (
    <Card aria-labelledby={titleId} as="section" className="insights-board insights-col--8" fill>
      {head}
      {rows.length === 0 ? (
        <SeriesEmptyState empty={NO_SCOREBOARD} />
      ) : (
        <Table
          caption={SCOREBOARD_CAPTION}
          captionHidden
          columns={columns(columnNotes(board.methodology))}
          rowKey={(row) => row.key}
          rows={rows}
        />
      )}
      {suggestion !== null && (
        <div className="insights-board__suggestion" data-suggestion>
          <p className="insights-board__claim">
            {suggestion.claim}
            {suggestion.saving !== null && ` (${suggestion.saving})`}
          </p>
          <Button href={suggestion.href} size="sm" tone="ghost">
            {APPLY_LABEL}
          </Button>
        </div>
      )}
    </Card>
  );
}
