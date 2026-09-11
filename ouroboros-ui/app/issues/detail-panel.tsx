"use client";

import { useState } from "react";

import type { BacklogIssueDetail, IssueDetail } from "@/app/api/backlog";
import { requestSummaryRefresh } from "@/app/dashboard/summary-refresh";
import { useSecondsNow } from "@/app/shell/clock";
import { Button, Card, CardHead, Chip, EmptyState, Tag } from "@/app/ui";

import { offenderLine, queuedToast } from "./bar";
import type { DetailPollOptions } from "./detail-poll";
import { queueUnder, reestimateIssue } from "./head-actions";
import { HeadOutcomeLine } from "./head-outcome";
import {
  CLOSE_PANEL_LABEL,
  FIRST_ESTIMATE_NOTE,
  FIRST_ESTIMATE_PENDING,
  ISSUE_STALE,
  ISSUE_UNREAD,
  NEEDS_HUMAN_TITLE,
  NO_ISSUE_OPEN,
  NO_ISSUE_OPEN_NOTE,
  OPEN_ON_GITHUB_LABEL,
  OPEN_ON_GITHUB_UNLINKED,
  PANEL_TITLE,
  type PanelState,
  QUEUE_ONE_LABEL,
  READING_ISSUE,
  REESTIMATE_ONE_LABEL,
  SIZING_NOW,
  SIZING_NOW_NOTE,
  githubHref,
  metaLine,
  needsHumanLine,
  panelState,
  queueOneReason,
  reestimateOneReason,
} from "./panel";
import { PanelBreakdown } from "./panel-breakdown";
import { PanelExcerpt } from "./panel-excerpt";
import { PanelSkeleton } from "./panel-skeleton";
import { PanelTrace } from "./panel-trace";
import type { SeenRowMap } from "./seen-rows";
import { useIssueSelection, useSeenRows } from "./selection";
import { type BacklogStatus, STATUS_LABEL, STATUS_TONE, type TableRow, statusOf } from "./table";
import { useDetailPoll } from "./use-detail-poll";
import { NOTHING_QUEUED } from "./view";

/**
 * Mockup 03's `ISSUE DETAIL` card — the sizing story for one issue
 * ([#119](https://github.com/NobuData/ouroboros/issues/119)): the status pill, the mono meta
 * line, the title and tags, the body excerpt, the **AI Work Breakdown**, the three actions and
 * the collapsible trace, across all four sizing states.
 *
 * ### The issue is the store's, and the answer is the poll's
 *
 * The row whose detail is open is `app/issues/selection.tsx`'s `detail`, written by the table
 * on a click or `Enter` and read here — the second state the store keeps apart from the
 * checked set. What the panel draws about it is the last answer of a poll keyed on the id
 * (`app/issues/use-detail-poll.ts`): the browser asks `app/api/backlog/[id]/route.ts` on the
 * DASH-I.8 cadence, and the moment the pipeline moves the issue the panel moves with it —
 * which is what *"`estimating` (skeleton breakdown that flips live)"* and *"the new version
 * renders without a manual refresh"* both mean. Between a row being opened and its detail
 * arriving, the head is drawn from the row as the table last saw it
 * (`app/issues/seen-rows.ts`), so the panel opens on the click rather than a round trip later.
 *
 * ### The card is always there
 *
 * The mockup draws the panel beside the table with `#485` open, and the grid holds its seat
 * whether or not a row is: a card that appeared on the first click would shift the table
 * under the pointer that clicked it. With no row open it says so, and says how to open one.
 *
 * ### One press, and the polls follow
 *
 * **Queue for loop** is the selection bar's Server Action with one id — the contract makes
 * the three queue affordances one write — and **Re-estimate** is L.4's single re-estimate.
 * A press that took asks every poll on the page now (`requestSummaryRefresh`): the panel's
 * own, so the `estimating…` the service has already written is drawn at once rather than an
 * interval later; the table's, so the row's pill follows; and the dashboard's, where a queued
 * issue now is. A refusal is a line under the actions, in the words the bar's dialog would
 * have used for the same issue. Nothing here is a `router.refresh()`: everything the panel
 * draws is the poll's, and the table's rows are its own poll's.
 *
 * **The pending flag is plain state, flipped in `finally`**, for the reason the head's
 * buttons give.
 *
 * @param props.readAt When the page was read, in milliseconds since the epoch — the server's
 *   reading of the clock, which is the first paint's *now* for every relative age here.
 * @param props.mayContribute Whether this reader's role may queue and re-estimate — every role
 *   but `viewer`, whose two actions are inert with the reason.
 * @param props.poll Test seams for the poll; production passes none.
 * @returns The card.
 */
export function DetailPanel({
  readAt,
  mayContribute,
  poll,
}: Readonly<{ readAt: number; mayContribute: boolean; poll?: DetailPollOptions }>) {
  const { detail: id, inspect } = useIssueSelection();
  const seen = useSeenRows();
  const { snapshot } = useDetailPoll(id, poll);
  const now = useSecondsNow(Math.floor(readAt / 1000));

  const row = id === null ? undefined : seen.get(id);
  // The panel draws the issue it was opened for and nothing else: an answer about another id
  // — which no path here produces — would be a head over the wrong body.
  const detail = snapshot.data !== null && snapshot.data.issue.id === id ? snapshot.data : null;
  const status: BacklogStatus | undefined =
    detail !== null ? statusOf(detail.issue) : row?.status;

  return (
    <Card aria-labelledby={TITLE_ID} as="section" className="issues-panel">
      <CardHead
        beside={
          status !== undefined && (
            <Chip tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Chip>
          )
        }
        title={PANEL_TITLE}
        titleId={TITLE_ID}
        trailing={
          id !== null ? (
            <Button
              aria-label={CLOSE_PANEL_LABEL}
              onClick={() => inspect(null)}
              size="sm"
              tone="ghost"
            >
              ×
            </Button>
          ) : undefined
        }
      />

      {id === null ? (
        <EmptyState note={NO_ISSUE_OPEN_NOTE} title={NO_ISSUE_OPEN} />
      ) : (
        // Keyed on the issue, so an expanded excerpt and a press's outcome belong to one issue
        // and start over for the next.
        <OpenIssue
          key={id}
          detail={detail}
          error={snapshot.error}
          id={id}
          mayContribute={mayContribute}
          now={now}
          row={row}
          seen={seen}
        />
      )}
    </Card>
  );
}

/** The id the card's `aria-labelledby` points at. */
const TITLE_ID = "issue-panel-title";

/**
 * The card's body for the row that is open: its head from whatever is known soonest, and
 * then one of the four sizing states, or the skeleton and the failure around them.
 *
 * @param props.id The open issue.
 * @param props.detail The poll's last answer about it, or `null` before the first.
 * @param props.error Why the poll's last ask failed, or `null`.
 * @param props.row The issue's row as the table last saw it, if the table has drawn it.
 * @param props.seen Every row the table has drawn — what names a refusal's issue.
 * @param props.now The reader's clock, in whole seconds.
 * @param props.mayContribute Whether this reader's role may queue and re-estimate.
 * @returns The body.
 */
function OpenIssue({
  id,
  detail,
  error,
  row,
  seen,
  now,
  mayContribute,
}: Readonly<{
  id: string;
  detail: IssueDetail | null;
  error: string | null;
  row: TableRow | undefined;
  seen: SeenRowMap;
  now: number;
  mayContribute: boolean;
}>) {
  if (detail === null) {
    return (
      <>
        {row !== undefined && <IssueHead labels={row.labels} meta={null} number={row.number} title={row.title} />}
        {error === null ? (
          <div className="issues-panel__waiting" role="status">
            <p className="issues-panel__note">{READING_ISSUE}</p>
            <PanelSkeleton />
          </div>
        ) : (
          <EmptyState note={error} title={ISSUE_UNREAD} variant="flush" />
        )}
      </>
    );
  }

  const { issue, estimate } = detail;
  const state = panelState(detail);

  return (
    <>
      <IssueHead
        labels={issue.labels}
        meta={metaLine(issue, now)}
        number={issue.number}
        title={issue.title}
      />
      <PanelExcerpt body={issue.body} />
      <hr className="issues-panel__divider" />

      {state === "unsized" && (
        <EmptyState note={FIRST_ESTIMATE_NOTE} title={FIRST_ESTIMATE_PENDING} variant="flush" />
      )}
      {state === "estimating" && (
        <div className="issues-panel__sizing" role="status">
          <EmptyState note={SIZING_NOW_NOTE} title={SIZING_NOW} variant="flush" />
          <PanelSkeleton />
        </div>
      )}
      {(state === "sized" || state === "needs_human") && estimate !== null && (
        <PanelBreakdown estimate={estimate} />
      )}
      {state === "needs_human" && estimate === null && (
        <EmptyState note={needsHumanLine(null)} title={NEEDS_HUMAN_TITLE} variant="flush" />
      )}

      <IssueActions id={id} issue={issue} mayContribute={mayContribute} seen={seen} state={state} />

      {(state === "sized" || state === "needs_human") && estimate !== null && (
        <PanelTrace
          estimate={estimate}
          lead={state === "needs_human" ? needsHumanLine(estimate) : null}
          now={now}
        />
      )}

      {error !== null && (
        <p className="issues-panel__unread" role="status">
          {ISSUE_STALE} {error}
        </p>
      )}
    </>
  );
}

/**
 * The panel's head under the card's: the mono meta line, the title, the tag row.
 *
 * @param props.number The issue's number — the `#485` the meta line starts with, and what
 *   the head reads while the rest of the line is still on its way.
 * @param props.meta The full meta line, or `null` before the detail has arrived.
 * @param props.title The title as GitHub has it.
 * @param props.labels GitHub's labels, in the order they are stored.
 * @returns The head.
 */
function IssueHead({
  number,
  meta,
  title,
  labels,
}: Readonly<{ number: number; meta: string | null; title: string; labels: readonly string[] }>) {
  return (
    <>
      <p className="issues-panel__meta">{meta ?? `#${number}`}</p>
      <h3 className="issues-panel__title">{title}</h3>
      {labels.length > 0 && (
        <div className="issues-panel__tags">
          {labels.map((label) => (
            <Tag key={label}>{label}</Tag>
          ))}
        </div>
      )}
    </>
  );
}

/**
 * The three actions and what the last press came back as.
 *
 * @param props.id The open issue.
 * @param props.issue Where it is, whether the queue holds it, and where it lives on GitHub.
 * @param props.state Which sizing state the panel is drawing — a change clears the last
 *   press's line, since *sizing again* over a breakdown that has already landed would be a
 *   sentence about a moment that has passed.
 * @param props.seen Every row the table has drawn — what names a refusal's issue.
 * @param props.mayContribute Whether this reader's role may queue and re-estimate.
 * @returns The row of actions, with the outcome line under it.
 */
function IssueActions({
  id,
  issue,
  state,
  seen,
  mayContribute,
}: Readonly<{
  id: string;
  issue: BacklogIssueDetail;
  state: PanelState;
  seen: SeenRowMap;
  mayContribute: boolean;
}>) {
  const [pending, setPending] = useState<"queue" | "estimate" | null>(null);
  const [report, setReport] = useState<{ state: PanelState; outcome: HeadOutcomeOrNull }>({
    state,
    outcome: null,
  });

  // The state moved under the last press's line — the poll drew what the press asked for —
  // so the line has said its piece. Adjusted during render, guarded on the state, the way the
  // table keeps its pill changes.
  if (report.state !== state) setReport({ state, outcome: null });

  /** Send this issue to the queue, under the workflow its own estimate suggested. */
  async function queue(): Promise<void> {
    if (pending !== null) return;

    setPending("queue");
    setReport({ state, outcome: null });

    try {
      const result = await queueUnder([id], null);

      if (result.ok) {
        setReport({ state, outcome: { ok: true, message: queuedToast(result.queued) } });
        requestSummaryRefresh();
      } else {
        const [named] = result.offenders;
        setReport({
          state,
          outcome: {
            ok: false,
            reason: named === undefined ? result.reason : `${offenderLine(named, seen)} ${NOTHING_QUEUED}`,
          },
        });
      }
    } finally {
      setPending(null);
    }
  }

  /** Ask for a new version of this issue's estimate. */
  async function reestimate(): Promise<void> {
    if (pending !== null) return;

    setPending("estimate");
    setReport({ state, outcome: null });

    try {
      const result = await reestimateIssue(id);
      setReport({ state, outcome: result });
      if (result.ok) requestSummaryRefresh();
    } finally {
      setPending(null);
    }
  }

  const href = githubHref(issue.ghUrl);

  return (
    <>
      <div className="issues-panel__actions">
        <Button
          aria-busy={pending === "queue" || undefined}
          onClick={() => void queue()}
          reason={queueOneReason(issue, mayContribute)}
          size="sm"
          tone="primary"
        >
          {QUEUE_ONE_LABEL}
        </Button>
        <Button
          aria-busy={pending === "estimate" || undefined}
          onClick={() => void reestimate()}
          reason={reestimateOneReason(issue.sizingStatus, mayContribute)}
          size="sm"
          tone="ghost"
        >
          {REESTIMATE_ONE_LABEL}
        </Button>
        {href === null ? (
          <Button reason={OPEN_ON_GITHUB_UNLINKED} size="sm" tone="ghost">
            {OPEN_ON_GITHUB_LABEL}
          </Button>
        ) : (
          <Button href={href} rel="noopener noreferrer" size="sm" target="_blank" tone="ghost">
            {OPEN_ON_GITHUB_LABEL}
          </Button>
        )}
      </div>
      <HeadOutcomeLine outcome={report.outcome} />
    </>
  );
}

/** What the last press came back as, or `null` before there has been one. */
type HeadOutcomeOrNull = Parameters<typeof HeadOutcomeLine>[0]["outcome"];
