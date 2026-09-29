"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type {
  AttachEvidenceRequest,
  PrCriterion,
  PrReview,
  PullRequestPage,
} from "@/app/api/pull-requests";
import { useKeyedPoll } from "@/app/issues/use-keyed-poll";
import { RUN_ORIGIN_PARAM, runPath } from "@/app/paths";
import type { RunOrigin } from "@/app/runs/origin";
import { BREADCRUMB_LABEL, loopLabel } from "@/app/runs/view";
import { setNavOrigin } from "@/app/shell/nav-registry";
import { RetryBanner } from "@/app/ui";

import { ClaimDialog } from "./claim-dialog";
import {
  CLAIM_ADDED,
  CLAIM_VERIFIED,
  type CriteriaOutcome,
  EVIDENCE_ATTACHED,
  type LocalCriterion,
  criteriaCard,
  importOutcome,
  standing,
  waiveOutcome,
  withLocal,
} from "./criteria";
import {
  addClaim,
  attachEvidence,
  importFromPlan,
  readEvidenceOptions,
  verifyClaim,
  waiveClaim,
} from "./criteria-actions";
import { CriteriaCard } from "./criteria-card";
import { DeclineDialog } from "./decline-dialog";
import { EvidenceDialog } from "./evidence-dialog";
import { hunkPaths } from "./evidence-options";
import { filesCard } from "./files";
import { type FilesArrival, FilesCard } from "./files-card";
import { approvalOutcome, gatesCard } from "./gates";
import { GatesCard } from "./gates-card";
import { decideApproval, requestHumanReview, returnToLoop } from "./head-actions";
import { type Hunk, sameHunk, withHunk } from "./hunk";
import { ArmDialog } from "./arm-dialog";
import { armPlan, disarmPlan, editPlan, mergeNow } from "./merge-actions";
import { type MessageDraft, draftOf, unsendable } from "./merge-message";
import {
  type ConfirmationView,
  DISARMED,
  type LocalPlan,
  MAY_HAVE_LANDED,
  PLAN_SAVED,
  type PlanEpic,
  type PlanNotice,
  type ToggleView,
  armedNotice,
  confirmation,
  effectivePage,
  mergePlanCard,
  mergedNotice,
  termsMoved,
} from "./merge-plan";
import { MergePlanCard } from "./merge-plan-card";
import type { MergeAnswer } from "./merge-receipt";
import {
  ACTION_UNREACHABLE_CODE,
  type ApprovalAnswer,
  type ApprovalOutcome,
  type CriterionOutcome,
  type ImportOutcome,
  type MergeOutcome,
  type OptionsOutcome,
  type PlanEdit,
  type PlanOutcome,
  type ReturnOutcome,
  type ReturnSelection,
  type ReviewRequestOutcome,
  type ThreadResolveOutcome,
  type ThreadResolveRequest,
  type WaiveOutcome,
} from "./outcomes";
import { PrActions } from "./pr-actions";
import { PrHead } from "./pr-head";
import { type PrPollOptions, createPagePoll } from "./poll";
import { ResolveDialog } from "./resolve-dialog";
import { ReturnDialog } from "./return-dialog";
import type { TextDialogOutcome } from "./text-dialog";
import { RevisionStrip } from "./revision-strip";
import { spendCard } from "./spend";
import { SpendCard } from "./spend-card";
import { gatesScope, scopedRevision, stripSteps, withRevision } from "./strip";
import {
  ENTRY_GONE,
  type LocalEntry,
  type ThreadOutcome,
  resolveOutcome,
  threadCard,
  withResolved,
} from "./thread";
import { resolveEntry } from "./thread-actions";
import { ThreadCard } from "./thread-card";
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
import { WaiveDialog } from "./waive-dialog";

import "./prs.css";

/** How a review request is sent. The Server Action in production; tests pass their own. */
export type ReviewSender = (prId: string) => Promise<ReviewRequestOutcome>;

/** How a return is sent. The Server Action in production; tests pass their own. */
export type ReturnSender = (prId: string, selection: ReturnSelection) => Promise<ReturnOutcome>;

/** How an approval is answered. The Server Action in production; tests pass their own. */
export type ApprovalSender = (prId: string, answer: ApprovalAnswer) => Promise<ApprovalOutcome>;

/**
 * How the criteria matrix writes ([#366](https://github.com/NobuData/ouroboros/issues/366)). The
 * Server Actions in production; tests pass their own.
 */
export interface CriteriaSenders {
  /** *Add claim*. */
  readonly addClaim: (prId: string, claim: string) => Promise<CriterionOutcome>;
  /** *Import from plan*. */
  readonly importFromPlan: (prId: string) => Promise<ImportOutcome>;
  /** The picker's read of what can be cited. */
  readonly readOptions: (prId: string) => Promise<OptionsOutcome>;
  /** *Attach evidence*. */
  readonly attach: (
    prId: string,
    criterionId: string,
    request: AttachEvidenceRequest,
  ) => Promise<CriterionOutcome>;
  /** *Verify*. */
  readonly verify: (prId: string, criterionId: string) => Promise<CriterionOutcome>;
  /** *Waive*. */
  readonly waive: (prId: string, criterionId: string, reason: string) => Promise<WaiveOutcome>;
}

/** The matrix's Server Actions. */
const CRITERIA_SENDERS: CriteriaSenders = {
  addClaim,
  importFromPlan,
  readOptions: readEvidenceOptions,
  attach: attachEvidence,
  verify: verifyClaim,
  waive: waiveClaim,
};

/**
 * How the review thread resolves an entry
 * ([#368](https://github.com/NobuData/ouroboros/issues/368)). The Server Action in production;
 * tests pass their own.
 */
export type EntryResolver = (
  prId: string,
  entryId: string,
  request: ThreadResolveRequest,
) => Promise<ThreadResolveOutcome>;

/**
 * How the Merge plan card writes ([#369](https://github.com/NobuData/ouroboros/issues/369)). The
 * Server Actions in production; tests pass their own.
 */
export interface PlanSenders {
  /** An edit — the message, a switch or the epic. */
  readonly edit: (prId: string, edit: PlanEdit) => Promise<PlanOutcome>;
  /** *Merge when all gates green*, confirmed. */
  readonly arm: (prId: string, revisionId: string) => Promise<PlanOutcome>;
  /** *Disarm*. */
  readonly disarm: (prId: string) => Promise<PlanOutcome>;
  /** *Merge now*, confirmed. */
  readonly merge: (prId: string) => Promise<MergeOutcome>;
}

/** The card's Server Actions. */
const PLAN_SENDERS: PlanSenders = {
  edit: editPlan,
  arm: armPlan,
  disarm: disarmPlan,
  merge: mergeNow,
};

/** What is said when the claim a dialog was opened for is no longer on the page. */
export const CLAIM_GONE = "That claim is no longer on this PR.";

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
  /** Whether the reader may waive a claim — owner or admin (#359). `false` when absent. */
  readonly mayWaive?: boolean;
  /** The hunk the address cites — `?hunk=` — or `null`. `null` when absent. */
  readonly initialHunk?: Hunk | null;
  /** How the criteria matrix writes. Defaults to the Server Actions. */
  readonly criteriaSenders?: CriteriaSenders;
  /** The clock an answer is timed by, in epoch milliseconds. Defaults to `Date.now`. */
  readonly now?: () => number;
  /** Test seams for the page's poll; production passes none. */
  readonly poll?: PrPollOptions;
  /** How to send a review request. Defaults to the Server Action. */
  readonly sendReview?: ReviewSender;
  /** How to send a return. Defaults to the Server Action. */
  readonly sendReturn?: ReturnSender;
  /** How to answer an approval. Defaults to the Server Action. */
  readonly sendApproval?: ApprovalSender;
  /** How one opening of the return dialog is keyed. Defaults to {@link newReplayKey}. */
  readonly replayKey?: () => string | undefined;
  /** How a thread entry is resolved. Defaults to the Server Action. */
  readonly sendResolve?: EntryResolver;
  /** The workspace's roadmap epics, or `null` when they could not be read. `null` when absent. */
  readonly epics?: readonly PlanEpic[] | null;
  /** How the Merge plan card writes. Defaults to the Server Actions. */
  readonly planSenders?: PlanSenders;
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
 * gates green* arms nothing: it brings the reader to the Merge plan card and moves focus there.
 *
 * **The revision cycle strip scopes the gates** ([#364](https://github.com/NobuData/ouroboros/issues/364)):
 * pressing a revision shows that revision's own snapshot, and the address follows (`?rev=1`) so
 * the view is linkable. A scope naming a revision the PR does not have is dropped, and the page
 * follows the latest. The head and its actions always describe the latest revision.
 *
 * **The gates card draws the scoped revision's snapshot** ([#365](https://github.com/NobuData/ouroboros/issues/365)).
 * Its human-approval row offers *Request review*, or *Approve* and *Decline* while a review is
 * waiting — on the latest revision only, because an answer is honoured only there. *Decline*
 * asks for its note first. The answered slot is drawn from the answer, before the next poll.
 *
 * **The criteria matrix is always the PR's own** ([#366](https://github.com/NobuData/ouroboros/issues/366)):
 * claims are about the PR, not a revision, so the strip's scope does not move it. Every change —
 * a claim added, evidence attached, a claim verified or waived — is drawn from its answer and
 * stands until a read made after it has caught up. A hunk reference brings the reader to the
 * Changed files card and moves focus there, and the address follows (`?hunk=…`).
 *
 * **The changed files are the latest revision's** ([#367](https://github.com/NobuData/ouroboros/issues/367)):
 * the rows with their meters, and the bounded diff excerpt, labelled as one. A hunk reference
 * scrolls the excerpt to its range, and a red diff-vs-plan gate links to the rows it flags.
 *
 * **The review thread is the PR's own too** ([#368](https://github.com/NobuData/ouroboros/issues/368)):
 * every entry, whichever revision it was about. *Reply & resolve* opens its dialog; the resolved
 * entry is drawn from the answer and stands until a read made after it has caught up, and the
 * header's open count follows because it is counted from the rows.
 *
 * **The merge plan is drawn for every reader, and armed only through its confirmation**
 * ([#369](https://github.com/NobuData/ouroboros/issues/369)). Each edit persists on its own; the
 * message is a draft until it is saved, and nothing is armed or merged while one is open. An
 * answer — armed, disarmed, merged — is drawn at once and stands until a read made after it has
 * caught up, and the head, the strip and the card all read that same plan, so none of them says
 * armed while another does not. The confirmation states what it read when it opened, and goes
 * inert if the PR moves under it.
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
  mayWaive = false,
  initialHunk = null,
  criteriaSenders = CRITERIA_SENDERS,
  now = Date.now,
  poll,
  sendReview = requestHumanReview,
  sendReturn = returnToLoop,
  sendApproval = decideApproval,
  replayKey = newReplayKey,
  sendResolve = resolveEntry,
  epics = null,
  planSenders = PLAN_SENDERS,
}: PrScreenProps) {
  const read = useKeyedPoll(prId, (id) => createPagePoll(id, poll));

  useEffect(() => setNavOrigin(origin.id), [origin.id]);

  const [plans, setPlans] = useState<readonly LocalPlan[]>([]);
  const polled = read.snapshot.data ?? initial;
  // The plan every surface reads: the newest answer no read has caught up with, and the state
  // that plan states.
  const page = polled === null ? null : effectivePage(polled, plans, read.snapshot.updatedAt);
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
  const [answering, setAnswering] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [gateOutcome, setGateOutcome] = useState<{
    readonly text: string;
    readonly failed: boolean;
  } | null>(null);
  const slot = useRef<HTMLElement>(null);
  const [locals, setLocals] = useState<readonly LocalCriterion[]>([]);
  const [criteriaSending, setCriteriaSending] = useState(false);
  const [criteriaOutcome, setCriteriaOutcome] = useState<CriteriaOutcome | null>(null);
  const [addingClaim, setAddingClaim] = useState(false);
  const [attachingTo, setAttachingTo] = useState<string | null>(null);
  const [waiving, setWaiving] = useState<string | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);
  const [resolved, setResolved] = useState<readonly LocalEntry[]>([]);
  const [threadSending, setThreadSending] = useState(false);
  const [threadOutcome, setThreadOutcome] = useState<ThreadOutcome | null>(null);
  const [hunk, setHunk] = useState<Hunk | null>(initialHunk);
  const [arrival, setArrival] = useState<FilesArrival | null>(
    initialHunk === null ? null : { kind: "hunk", seq: 0 },
  );
  const [draft, setDraft] = useState<MessageDraft | null>(null);
  const [planSending, setPlanSending] = useState(false);
  const [planNotice, setPlanNotice] = useState<PlanNotice | null>(null);
  const [confirming, setConfirming] = useState<ConfirmationView | null>(null);
  const [mergeAnswer, setMergeAnswer] = useState<MergeAnswer | null>(null);
  // A latch as well as the state: two presses inside one frame both read the state as idle.
  const planBusy = useRef(false);

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
    const next = withHunk(withRevision(search, scoped), hunk);
    if (next === search) return;

    window.history.replaceState(window.history.state, "", `${pathname}${next}${hash}`);
  }, [pageRead, scoped, hunk]);

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
   * Answer the approval slot, and say on the card what became of it.
   *
   * @param answer The decision and its note.
   * @returns The outcome, for the decline dialog: it closes on an answer and draws a refusal.
   */
  async function answerApproval(answer: ApprovalAnswer): Promise<ApprovalOutcome> {
    setAnswering(true);

    try {
      const outcome = await sendApproval(prId, answer);

      if (outcome.ok) {
        setAnsweredReview(outcome.outcome.review);
        setGateOutcome({ text: approvalOutcome(answer.decision), failed: false });
      } else if (answer.decision === "approve") {
        // A refused decline is drawn in its dialog, which is still open.
        setGateOutcome({ text: outcome.reason, failed: true });
      }

      return outcome;
    } finally {
      setAnswering(false);
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

  /**
   * Draw a claim from an answer, until a read made after it has caught up.
   *
   * @param changed The claims as the answer stated them.
   */
  function keep(changed: readonly PrCriterion[]): void {
    const at = now();

    setLocals((current) => [
      ...standing(current, read.snapshot.updatedAt),
      ...changed.map((criterion) => ({ criterion, at })),
    ]);
  }

  /**
   * Send one change of the matrix — one at a time — and refresh the page after it.
   *
   * @param send The change.
   * @returns What it answered.
   */
  async function change<T>(send: () => Promise<T>): Promise<T> {
    setCriteriaSending(true);

    try {
      return await send();
    } finally {
      setCriteriaSending(false);
      read.refresh();
    }
  }

  /**
   * Add the claim the dialog confirmed.
   *
   * @param claim The claim, trimmed.
   * @returns The outcome, for the dialog: it closes on a claim added and draws a refusal.
   */
  async function confirmClaim(claim: string): Promise<TextDialogOutcome> {
    const outcome = await change(() => criteriaSenders.addClaim(prId, claim));
    if (!outcome.ok) return outcome;

    keep([outcome.answer]);
    setCriteriaOutcome({ text: CLAIM_ADDED, failed: false });

    return { ok: true };
  }

  /** Import the plan's acceptance criteria, and say what became of it. */
  async function importPlan(): Promise<void> {
    if (criteriaSending) return;

    const outcome = await change(() => criteriaSenders.importFromPlan(prId));

    if (outcome.ok) {
      keep(outcome.answer.imported);
      setCriteriaOutcome(importOutcome(outcome.answer));
    } else {
      setCriteriaOutcome({ text: outcome.reason, failed: true });
    }
  }

  /**
   * Attach the evidence the picker confirmed to the claim it was opened for.
   *
   * @param request The reference.
   * @returns The outcome, for the picker: it closes on a citation and draws a refusal.
   */
  async function confirmEvidence(request: AttachEvidenceRequest): Promise<CriterionOutcome> {
    if (attachingTo === null) {
      return { ok: false, status: 404, code: "criterion_not_found", reason: CLAIM_GONE };
    }

    const criterionId = attachingTo;
    const outcome = await change(() => criteriaSenders.attach(prId, criterionId, request));

    if (outcome.ok) {
      keep([outcome.answer]);
      setCriteriaOutcome({ text: EVIDENCE_ATTACHED, failed: false });
    }

    return outcome;
  }

  /**
   * Verify a claim, and say on the card what became of it.
   *
   * @param criterionId The claim.
   */
  async function verify(criterionId: string): Promise<void> {
    if (criteriaSending) return;

    const outcome = await change(() => criteriaSenders.verify(prId, criterionId));

    if (outcome.ok) {
      keep([outcome.answer]);
      setCriteriaOutcome({ text: CLAIM_VERIFIED, failed: false });
    } else {
      setCriteriaOutcome({ text: outcome.reason, failed: true });
    }
  }

  /**
   * Waive the claim the dialog was opened for, with the reason it confirmed.
   *
   * @param reason Why, trimmed.
   * @returns The outcome, for the dialog: it closes on a waiver — annotated or not, which the
   *   card then says — and draws a refusal.
   */
  async function confirmWaive(reason: string): Promise<TextDialogOutcome> {
    if (waiving === null) return { ok: false, reason: CLAIM_GONE };

    const criterionId = waiving;
    const outcome = await change(() => criteriaSenders.waive(prId, criterionId, reason));
    if (!outcome.ok) return outcome;

    keep([outcome.answer.criterion]);
    setCriteriaOutcome(waiveOutcome(outcome.answer));

    return { ok: true };
  }

  /**
   * Resolve the entry the dialog was opened for, with what it confirmed.
   *
   * @param request The reply, and whether to mirror it.
   * @returns The outcome, for the dialog: it closes on a resolution — mirrored or not, which the
   *   card then says — and draws a refusal.
   */
  async function confirmResolve(request: ThreadResolveRequest): Promise<TextDialogOutcome> {
    if (resolving === null) return { ok: false, reason: ENTRY_GONE };

    const entryId = resolving;

    setThreadSending(true);

    try {
      const outcome = await sendResolve(prId, entryId, request);
      if (!outcome.ok) return outcome;

      const at = now();

      setResolved((current) => [
        ...standing(current, read.snapshot.updatedAt),
        { entry: outcome.answer.entry, at },
      ]);
      setThreadOutcome(resolveOutcome(outcome.answer));

      return { ok: true };
    } finally {
      setThreadSending(false);
      read.refresh();
    }
  }

  /**
   * Follow a hunk reference to the changed files.
   *
   * @param cited The hunk.
   */
  function followHunk(cited: Hunk): void {
    setHunk((current) => (sameHunk(current, cited) ? current : cited));
    arrive("hunk");
  }

  /**
   * Bring the reader to the Changed files card — the card scrolls to what was followed.
   *
   * @param kind A hunk reference, or the gates card's link to the flagged files.
   */
  function arrive(kind: FilesArrival["kind"]): void {
    setArrival((current) => ({ kind, seq: (current?.seq ?? 0) + 1 }));
  }

  /** Hand off to the Merge plan card, and take the reader there. */
  function handOff(): void {
    if (revision === null) return;

    setChosen(revision.seq);
    setFocusRequests((count) => count + 1);
  }

  /**
   * Draw a plan from an answer, until a read made after it has caught up.
   *
   * @param plan The plan as the answer stated it.
   */
  function keepPlan(plan: LocalPlan["plan"]): void {
    const at = now();

    setPlans((current) => [...standing(current, read.snapshot.updatedAt), { plan, at }]);
  }

  /**
   * What a refusal is said as. A service that did not answer an arm or a merge may still have
   * acted on it, so that one says so rather than saying nothing happened.
   *
   * @param refusal The refusal.
   * @param acts Whether the press was one that acts — an arm or a merge.
   * @returns The sentence.
   */
  function refusalText(refusal: { code: string; reason: string }, acts: boolean): string {
    return acts && refusal.code === ACTION_UNREACHABLE_CODE ? MAY_HAVE_LANDED : refusal.reason;
  }

  /**
   * Send one change of the plan — one at a time — and refresh the page after it.
   *
   * @param send The change.
   * @returns What it answered, or `null` when another change was already in flight.
   */
  async function changePlan<T>(send: () => Promise<T>): Promise<T | null> {
    if (planBusy.current) return null;

    planBusy.current = true;
    setPlanSending(true);

    try {
      return await send();
    } finally {
      planBusy.current = false;
      setPlanSending(false);
      read.refresh();
    }
  }

  /**
   * Send an edit of the plan, and say on the card what became of it.
   *
   * @param edit What to change.
   * @returns Whether it was saved.
   */
  async function edit(edit: PlanEdit): Promise<boolean> {
    const outcome = await changePlan(() => planSenders.edit(prId, edit));
    if (outcome === null) return false;

    if (outcome.ok) {
      keepPlan(outcome.answer);
      setPlanNotice({ text: PLAN_SAVED, failed: false });
    } else {
      setPlanNotice({ text: refusalText(outcome, false), failed: true });
    }

    return outcome.ok;
  }

  /** Save the message's draft — trimmed, as the service keeps it. */
  async function saveMessage(): Promise<void> {
    if (draft === null || unsendable(draft) !== null) return;

    if (await edit({ commitMessage: draft.text.trim() })) setDraft(null);
  }

  /**
   * Flip one switch of the plan.
   *
   * @param field The switch.
   */
  function flip(field: ToggleView["field"]): void {
    if (page === null) return;

    void edit({ [field]: !page.plan[field] });
  }

  /** Disarm the plan, and say on the card what became of it. */
  async function disarm(): Promise<void> {
    const outcome = await changePlan(() => planSenders.disarm(prId));
    if (outcome === null) return;

    if (outcome.ok) {
      keepPlan(outcome.answer);
      setPlanNotice({ text: DISARMED, failed: false });
    } else {
      setPlanNotice({ text: refusalText(outcome, false), failed: true });
    }
  }

  /**
   * Arm, or merge, as the confirmation stated.
   *
   * @param terms What the confirmation stated when it opened.
   * @returns The outcome, for the dialog: it closes on an arm or a merge and draws a refusal.
   */
  async function confirmPlan(terms: ConfirmationView): Promise<TextDialogOutcome> {
    if (page === null) return { ok: false, reason: NO_REVISION };

    const outcome = await changePlan<PlanOutcome | MergeOutcome>(() =>
      terms.kind === "merge"
        ? planSenders.merge(prId)
        : planSenders.arm(prId, terms.revisionId),
    );

    if (outcome === null) return { ok: false, reason: MAY_HAVE_LANDED };
    if (!outcome.ok) return { ok: false, reason: refusalText(outcome, true) };

    if ("plan" in outcome.answer) {
      const merged = outcome.answer;

      keepPlan(merged.plan);
      setPlanNotice(mergedNotice(merged));

      if (merged.plan.mergedResult !== null) {
        setMergeAnswer({
          sha: merged.plan.mergedResult.sha,
          failedActions: merged.failedActions,
        });
      }
    } else {
      keepPlan(outcome.answer);
      setPlanNotice(armedNotice(outcome.answer, page));
    }

    setChosen(null);
    // The button that opened the dialog is gone once the plan is armed or merged, so focus has
    // nowhere to return to: the card takes it.
    setFocusRequests((count) => count + 1);

    return { ok: true };
  }

  const criteria =
    page === null ? [] : withLocal(page.criteria, locals, read.snapshot.updatedAt);
  const matrix =
    page === null
      ? null
      : criteriaCard({
          page,
          criteria,
          mayContribute,
          mayWaive,
          originId: origin.id,
          search: withRevision(`?${RUN_ORIGIN_PARAM}=${encodeURIComponent(origin.id)}`, scoped),
        });
  const waived = criteria.find((each) => each.id === waiving) ?? null;
  const entries =
    page === null ? [] : withResolved(page.thread, resolved, read.snapshot.updatedAt);
  const thread = page === null ? null : threadCard({ page, entries, mayContribute });
  const answered = entries.find((each) => each.id === resolving) ?? null;
  const head = page === null ? null : prHead(page, origin.id);
  const actions =
    page === null
      ? null
      : actionsView({ page, answeredReview, mayContribute, mayArm, requestingReview });
  const run = page?.pullRequest.run ?? null;
  const scope = page === null ? null : gatesScope(page, scoped);
  const gates =
    page === null || scope === null
      ? null
      : gatesCard({ page, scope, answeredReview, mayContribute, originId: origin.id });
  const plan =
    page === null
      ? null
      : mergePlanCard({
          page,
          epics,
          draft,
          answer: mergeAnswer,
          mayArm,
          mayContribute,
          chosen: chosen !== null && chosen === revision?.seq ? chosen : null,
        });

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

      {gates !== null && (
        <GatesCard
          onApprove={() => void answerApproval({ decision: "approve" })}
          onDecline={() => setDeclining(true)}
          onFlagged={() => arrive("flagged")}
          onFollowLatest={() => setScoped(null)}
          onRequestReview={() => void requestReview()}
          outcome={gateOutcome}
          sending={answering || requestingReview}
          view={gates}
        />
      )}

      {matrix !== null && (
        <CriteriaCard
          onAddClaim={() => setAddingClaim(true)}
          onAttach={setAttachingTo}
          onHunk={followHunk}
          onImport={() => void importPlan()}
          onVerify={(criterionId) => void verify(criterionId)}
          onWaive={setWaiving}
          outcome={criteriaOutcome}
          sending={criteriaSending}
          view={matrix}
        />
      )}

      {page !== null && <FilesCard arrival={arrival} view={filesCard(page, hunk)} />}

      {thread !== null && (
        <ThreadCard
          onResolve={setResolving}
          outcome={threadOutcome}
          sending={threadSending}
          view={thread}
        />
      )}

      {plan !== null && page !== null && (
        <MergePlanCard
          draft={draft}
          notice={planNotice}
          onDiscard={() => setDraft(null)}
          onDisarm={() => void disarm()}
          onDraft={(text) => setDraft((current) => draftOf(text, page.plan.commitMessage, current))}
          onEpic={(epicId) => void edit({ epicId })}
          onPrimary={() => {
            if (plan.primary !== null) setConfirming(confirmation(page, plan.primary.kind));
          }}
          onSave={() => void saveMessage()}
          onToggle={flip}
          ref={slot}
          sending={planSending}
          view={plan}
        />
      )}

      {page !== null && <SpendCard view={spendCard(page.spend)} />}

      {page !== null && (
        <ArmDialog
          moved={confirming !== null && termsMoved(confirming, page)}
          onClose={() => setConfirming(null)}
          onConfirm={confirmPlan}
          terms={confirming}
        />
      )}

      {page !== null && (
        <>
          <ClaimDialog
            onClose={() => setAddingClaim(false)}
            onConfirm={confirmClaim}
            open={addingClaim}
          />
          <EvidenceDialog
            claim={criteria.find((each) => each.id === attachingTo)?.claim ?? null}
            loadOptions={() => criteriaSenders.readOptions(prId)}
            onClose={() => setAttachingTo(null)}
            onConfirm={confirmEvidence}
            paths={hunkPaths(page.files)}
            revisionId={page.files?.revisionId ?? null}
          />
          <WaiveDialog
            again={waived?.status === "waived"}
            claim={waived?.claim ?? null}
            onClose={() => setWaiving(null)}
            onConfirm={confirmWaive}
          />
        </>
      )}

      {page !== null && (
        <ResolveDialog
          entry={
            answered === null ? null : { author: answered.authorName, body: answered.body }
          }
          onClose={() => setResolving(null)}
          onConfirm={confirmResolve}
        />
      )}

      {page !== null && (
        <DeclineDialog
          number={page.pullRequest.number}
          onClose={() => setDeclining(false)}
          onConfirm={(note) => answerApproval({ decision: "decline", note })}
          open={declining}
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
