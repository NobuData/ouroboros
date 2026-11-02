"use client";

import Link from "next/link";
import { useId } from "react";

import { Button, Card, CardHead } from "@/app/ui";

import {
  CONSOLE_LINK,
  FIRST_LOOP_PENDING,
  FIRST_LOOP_TITLE,
  type FirstLoop,
  type FirstLoopState,
  MERGE_GUIDANCE,
  MERGE_GUIDANCE_LINK,
  MERGE_GUIDANCE_TITLE,
  POLICY_HREF,
  REVIEW_ACK,
  REVIEW_DECISION,
  REVIEW_LINK,
  REVIEW_POLICY_LINK,
  REVIEW_TITLE,
  STATE_LINES,
  WAITING_LINK,
  draftLine,
  firstLoopState,
  stateLinks,
} from "./first-loop-view";

/** Each state's line class — literal, so the style suite sees every one rendered. */
const LINE_CLASS: Readonly<Record<FirstLoopState["kind"], string>> = {
  running: "first-loop__state",
  waiting: "first-loop__state first-loop__state--attention",
  stalled: "first-loop__state first-loop__state--attention",
  failed: "first-loop__state first-loop__state--failed",
  canceled: "first-loop__state first-loop__state--failed",
  budget: "first-loop__state first-loop__state--failed",
  review: "first-loop__state first-loop__state--done",
  merged: "first-loop__state first-loop__state--done",
  closed: "first-loop__state first-loop__state--attention",
};

/** Props of {@link FirstLoopCard}. */
export interface FirstLoopCardProps {
  /** The run, from `refs.firstRun.id`. */
  readonly runId: string;
  /** The first loop, or null while it has not been heard. */
  readonly loop: FirstLoop | null;
  /** Why it could not be heard, or null. */
  readonly failure: string | null;
  /** When the guided review was acknowledged here, or null. */
  readonly reviewedAt: string | null;
  /** Acknowledge the guided review. */
  readonly onReviewed: () => void;
  /** The stall clock, in epoch milliseconds — a test seam. */
  readonly now: number;
}

/**
 * The words a state leads with.
 *
 * @param state The state.
 * @returns The sentence.
 */
function stateLine(state: FirstLoopState): string {
  switch (state.kind) {
    case "running":
      return STATE_LINES.running(state.stage);
    case "stalled":
      return STATE_LINES.stalled(state.minutes);
    case "failed":
      return STATE_LINES.failed(state.reason);
    case "budget":
      return STATE_LINES.budget[state.limit];
    default:
      return STATE_LINES[state.kind];
  }
}

/**
 * The guided first review — the diff and the checks, why the PR is a draft, and the review as the
 * decision it is; then, only once acknowledged, the first-merge guidance.
 *
 * @param props.loop The first loop, with its PR.
 * @param props.reviewHref The PR page.
 * @param props.reviewedAt When the review was acknowledged here, or null.
 * @param props.onReviewed Acknowledge it.
 * @returns The section.
 */
function GuidedReview({
  loop,
  reviewHref,
  reviewedAt,
  onReviewed,
}: Readonly<{ loop: FirstLoop; reviewHref: string; reviewedAt: string | null; onReviewed: () => void }>) {
  const titleId = useId();
  const pr = loop.pullRequest;

  if (pr === null) return null;

  return (
    <section aria-labelledby={titleId} className="first-loop__review">
      <h3 className="first-loop__review-title" id={titleId}>
        {REVIEW_TITLE} — #{String(pr.number)}
      </h3>
      <p className="first-loop__line">
        {draftLine(pr, loop.dryRun)}{" "}
        <Link className="first-loop__link" href={POLICY_HREF}>
          {REVIEW_POLICY_LINK}
        </Link>
      </p>
      <p className="first-loop__line">{REVIEW_DECISION}</p>
      <div className="first-loop__actions">
        <Button href={reviewHref} size="sm" tone="primary">
          {REVIEW_LINK}
        </Button>
        {reviewedAt === null && (
          <Button onClick={onReviewed} size="sm" tone="ghost">
            {REVIEW_ACK}
          </Button>
        )}
      </div>
      {reviewedAt !== null && (
        <div className="first-loop__guidance" role="note">
          <p className="first-loop__guidance-title">{MERGE_GUIDANCE_TITLE}</p>
          <p className="first-loop__line">{MERGE_GUIDANCE}</p>
          <Link className="first-loop__link" href={POLICY_HREF}>
            {MERGE_GUIDANCE_LINK}
          </Link>
        </div>
      )}
    </section>
  );
}

/**
 * The first loop, live (BD.1, [#396](https://github.com/NobuData/ouroboros/issues/396)) — where the
 * run stands in the run's own words, with the run console's link in every state; the guided
 * review once its draft pull request opens; the first-merge guidance only after that review.
 * A failed, cancelled, budget-stopped, waiting or stalled run says so — never a spinner.
 *
 * The timeline beside it (the right column's *What Happens Next*) takes the measured rows; this
 * card says what they mean.
 *
 * @param props See {@link FirstLoopCardProps}.
 * @returns The card.
 */
export function FirstLoopCard({ runId, loop, failure, reviewedAt, onReviewed, now }: FirstLoopCardProps) {
  const titleId = useId();

  if (loop === null) {
    return (
      <Card aria-labelledby={titleId} as="section" className="first-loop">
        <CardHead title={FIRST_LOOP_TITLE} titleId={titleId} />
        <p className="first-loop__line" role={failure === null ? "status" : "alert"}>
          {failure ?? FIRST_LOOP_PENDING}
        </p>
      </Card>
    );
  }

  const state = firstLoopState(loop, now);
  const links = stateLinks(runId, state);
  const attention = state.kind !== "running" && state.kind !== "review" && state.kind !== "merged";
  // A closed PR is linked for the record, but there is nothing left to review or to merge.
  const reviewing = links.review !== null && state.kind !== "closed";

  return (
    <Card aria-labelledby={titleId} as="section" className="first-loop">
      <CardHead title={FIRST_LOOP_TITLE} titleId={titleId} />
      <p className={LINE_CLASS[state.kind]} role={attention ? "alert" : "status"}>
        {stateLine(state)}
      </p>
      <div className="first-loop__actions">
        <Link className="first-loop__link" href={links.console}>
          {CONSOLE_LINK}
        </Link>
        {links.waiting !== null && (
          <Link className="first-loop__link" href={links.waiting}>
            {WAITING_LINK.label}
          </Link>
        )}
      </div>
      {links.review !== null && !reviewing && (
        <Link className="first-loop__link" href={links.review}>
          {REVIEW_LINK}
        </Link>
      )}
      {reviewing && links.review !== null && (
        <GuidedReview loop={loop} onReviewed={onReviewed} reviewHref={links.review} reviewedAt={reviewedAt} />
      )}
    </Card>
  );
}
