"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { PrReview, PullRequestPage } from "@/app/api/pull-requests";
import { useKeyedPoll } from "@/app/issues/use-keyed-poll";
import { runPath } from "@/app/paths";
import type { RunOrigin } from "@/app/runs/origin";
import { BREADCRUMB_LABEL, loopLabel } from "@/app/runs/view";
import { setNavOrigin } from "@/app/shell/nav-registry";
import { RetryBanner } from "@/app/ui";

import { GatesSlot } from "./gates-slot";
import { requestHumanReview, returnToLoop } from "./head-actions";
import { MergePlanSlot } from "./merge-plan-slot";
import type { ReturnOutcome, ReturnSelection, ReviewRequestOutcome } from "./outcomes";
import { PrActions } from "./pr-actions";
import { PrHead } from "./pr-head";
import { type PrPollOptions, createPagePoll } from "./poll";
import { ReturnDialog } from "./return-dialog";
import { RevisionStrip } from "./revision-strip";
import { gatesScope, scopedRevision, stripSteps, withRevision } from "./strip";
import {
  NO_REVISION,
  type OutcomeView,
  STALE_HEADLINE,
  UNREAD_HEADLINE,
  actionsView,
  hasActions,
  latestRevision,
  prHead,
  redGates,
  returnReceipt,
  reviewOutcome,
} from "./view";

import "./prs.css";

/** How a review request is sent. The Server Action in production; tests pass their own. */
export type ReviewSender = (prId: string) => Promise<ReviewRequestOutcome>;

/** How a return is sent. The Server Action in production; tests pass their own. */
export type ReturnSender = (prId: string, selection: ReturnSelection) => Promise<ReturnOutcome>;

/** The breadcrumb's current page before the PR has been read. */
export const PR_CRUMB = "Pull request";

/**
 * A key for one opening of the return dialog, so a retry of the same press — after a dropped
 * connection, say — answers the first correction round instead of queuing a second.
 *
 * @returns A uuid, or `undefined` where the browser cannot mint one; the return is then sent
 *   without a key, exactly as a caller that never had one would.
 */
export function newReplayKey(): string | undefined {
  return typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : undefined;
}

/** What the screen is told. */
export interface PrScreenProps {
  /** The PR's id. */
  readonly prId: string;
  /** The server's first read of the page, or `null` when it failed. */
  readonly initial: PullRequestPage | null;
  /** Why the first read failed, or `null`. */
  readonly initialError: string | null;
  /** The module the page was opened from. */
  readonly origin: RunOrigin;
  /** The revision the address scopes the gates to — `?rev=` — or `null`. `null` when absent. */
  readonly initialRevision?: number | null;
  /** Whether the reader may take a head action — owner, admin or member. `false` when absent. */
  readonly mayContribute?: boolean;
  /** Whether the reader may arm a merge — owner or admin. `false` when absent. */
  readonly mayArm?: boolean;
  /** Test seams for the page's poll; production passes none. */
  readonly poll?: PrPollOptions;
  /** How to send a review request. Defaults to the Server Action. */
  readonly sendReview?: ReviewSender;
  /** How to send a return. Defaults to the Server Action. */
  readonly sendReturn?: ReturnSender;
  /** How one opening of the return dialog is keyed. Defaults to {@link newReplayKey}. */
  readonly replayKey?: () => string | undefined;
}

/**
 * The PR verification frame ([#363](https://github.com/NobuData/ouroboros/issues/363)) — mockup
 * 12's breadcrumb, head and three actions, for one PR.
 *
 * **A contextual surface.** It renders in the shell's content pane and adds no chrome of its own,
 * so the header and the sidebar stay put while the pane scrolls. It has no sidebar entry: the
 * module it was opened from is published as the registry's origin while it is mounted, which
 * keeps that entry lit, and the breadcrumb leads back through the loop's run console to it.
 *
 * **One poll on the I.8 cadence** ([#87](https://github.com/NobuData/ouroboros/issues/87)): the
 * whole page, so the pill, the red gates and the review's state move together. A failed refresh
 * keeps the last answer on screen under a banner rather than blanking it.
 *
 * **The three actions** are `view.ts`'s decisions. *Request human review* is sent once and the
 * button becomes `review requested` from the answer, before the next poll. *Return to loop* opens
 * the dialog; its receipt links into the run console, where the steer appears. *Merge when all
 * gates green* arms nothing: it brings the reader to the Merge plan slot and moves focus there.
 *
 * **The revision cycle strip scopes the gates** ([#364](https://github.com/NobuData/ouroboros/issues/364)):
 * pressing a revision shows that revision's own snapshot, and the address follows (`?rev=1`) so
 * the view is linkable. A scope naming a revision the PR does not have is dropped, and the page
 * follows the latest. The head and its actions always describe the latest revision.
 *
 * @param props See {@link PrScreenProps}.
 * @returns The screen.
 */
export function PrScreen({
  prId,
  initial,
  initialError,
  origin,
  initialRevision = null,
  mayContribute = false,
  mayArm = false,
  poll,
  sendReview = requestHumanReview,
  sendReturn = returnToLoop,
  replayKey = newReplayKey,
}: PrScreenProps) {
  const read = useKeyedPoll(prId, (id) => createPagePoll(id, poll));

  useEffect(() => setNavOrigin(origin.id), [origin.id]);

  const page = read.snapshot.data ?? initial;
  // A poll's own verdict supersedes the server's once it has one — either way.
  const error =
    read.snapshot.updatedAt === null
      ? (read.snapshot.error ?? initialError)
      : read.snapshot.error;

  const [requestingReview, setRequestingReview] = useState(false);
  const [answeredReview, setAnsweredReview] = useState<PrReview | null>(null);
  const [outcome, setOutcome] = useState<OutcomeView | null>(null);
  const [returning, setReturning] = useState<{ readonly key: string | undefined } | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const [focusRequests, setFocusRequests] = useState(0);
  const [scoped, setScoped] = useState<number | null>(initialRevision);
  const slot = useRef<HTMLElement>(null);

  // The address names a revision this PR does not have. Dropped during render, so the gates of
  // the latest revision are never drawn under another revision's name.
  if (page !== null && scoped !== null && scopedRevision(page, scoped) === null) {
    setScoped(null);
  }

  // The address follows the scope, however it changed — a press or a dropping. Not before the
  // page has been read: a scope that cannot be checked yet is kept as the address states it.
  const pageRead = page !== null;
  useEffect(() => {
    if (!pageRead) return;

    const { pathname, search, hash } = window.location;
    const next = withRevision(search, scoped);
    if (next === search) return;

    window.history.replaceState(window.history.state, "", `${pathname}${next}${hash}`);
  }, [pageRead, scoped]);

  // After *Merge when all gates green* has handed off and the slot has drawn it: bring the slot
  // into the pane's view and put focus on it, so a keyboard or screen-reader user lands where a
  // sighted one is looking.
  useEffect(() => {
    if (focusRequests === 0) return;

    const region = slot.current;
    region?.scrollIntoView?.({ block: "start" });
    region?.focus({ preventScroll: true });
  }, [focusRequests]);

  const revision = page === null ? null : latestRevision(page);

  /** Ask for a human review — once — then say what became of it. */
  async function requestReview(): Promise<void> {
    if (requestingReview) return;

    setRequestingReview(true);

    try {
      const answer = await sendReview(prId);

      if (answer.ok) {
        setAnsweredReview(answer.outcome.review);
        setOutcome(reviewOutcome(answer.outcome.created));
      } else {
        setOutcome({ text: answer.reason, failed: true, link: null });
      }
    } finally {
      setRequestingReview(false);
      read.refresh();
    }
  }

  /**
   * Send the return the dialog confirmed, and draw its receipt.
   *
   * @param gates The gates selected.
   * @returns The outcome, for the dialog: it closes on a queued return and draws a refusal.
   */
  async function confirmReturn(gates: readonly string[]): Promise<ReturnOutcome> {
    if (page === null || revision === null) {
      return { ok: false, status: 409, code: "pull_request_has_no_revision", reason: NO_REVISION };
    }

    const answer = await sendReturn(prId, {
      gates,
      revisionId: revision.id,
      ...(returning?.key === undefined ? {} : { replayKey: returning.key }),
    });

    if (answer.ok) {
      setOutcome(returnReceipt(answer.answer, page.pullRequest, origin.id));
      read.refresh();
    }

    return answer;
  }

  /** Hand off to the Merge plan slot, and take the reader there. */
  function handOff(): void {
    if (revision === null) return;

    setChosen(revision.seq);
    setFocusRequests((count) => count + 1);
  }

  const head = page === null ? null : prHead(page, origin.id);
  const actions =
    page === null
      ? null
      : actionsView({ page, answeredReview, mayContribute, mayArm, requestingReview });
  const run = page?.pullRequest.run ?? null;
  const gates = page === null ? null : gatesScope(page, scoped);

  return (
    <main className="prv">
      <nav aria-label={BREADCRUMB_LABEL} className="prv__crumbs">
        <ol className="prv__crumb-list">
          <li className="prv__crumb">
            <Link className="prv__crumb-link" href={origin.route}>
              {origin.label}
            </Link>
          </li>
          {run !== null && (
            <li className="prv__crumb">
              <Link className="prv__crumb-link" href={runPath(run.id, origin.id)}>
                {loopLabel(run.loopSeq)}
              </Link>
            </li>
          )}
          <li aria-current="page" className="prv__crumb">
            {head?.prLabel ?? PR_CRUMB}
          </li>
        </ol>
      </nav>

      {error !== null && (
        <RetryBanner
          className="prv__banner"
          headline={page === null ? UNREAD_HEADLINE : STALE_HEADLINE}
          onRetry={read.refresh}
          reason={error}
        />
      )}

      {head !== null && (
        <PrHead
          actions={
            actions === null || !hasActions(actions) ? null : (
              <PrActions
                onMerge={handOff}
                onRequestReview={() => void requestReview()}
                onReturn={() => setReturning({ key: replayKey() })}
                outcome={outcome}
                view={actions}
              />
            )
          }
          view={head}
        />
      )}

      {page !== null && (
        <RevisionStrip onScope={setScoped} scoped={scoped} steps={stripSteps(page)} />
      )}

      {gates !== null && <GatesSlot onFollowLatest={() => setScoped(null)} scope={gates} />}

      {page !== null && actions !== null && actions.merge !== null && (
        <MergePlanSlot
          chosen={chosen !== null && chosen === revision?.seq ? chosen : null}
          ref={slot}
        />
      )}

      {page !== null && (
        <ReturnDialog
          gates={redGates(page)}
          head={page.pullRequest}
          onClose={() => setReturning(null)}
          onConfirm={confirmReturn}
          open={returning !== null}
        />
      )}
    </main>
  );
}
