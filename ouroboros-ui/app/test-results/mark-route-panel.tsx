"use client";

import { type Ref, useState } from "react";

import type {
  Classification,
  FailureClass,
  TestNextStep,
  TestRunHints,
  Waiver,
} from "@/app/api/test-results";
import type { TextDialogOutcome } from "@/app/prs/text-dialog";

import type { FailureEntry } from "./failure";
import {
  NOTHING_TO_CLASSIFY,
  READING_TARGET,
  type StagedFailures,
  type ToggleField,
  formView,
  togglesView,
  worklistView,
} from "./mark-route";
import {
  type HeldDecision,
  currentDecision,
  recordedView,
  waiverView,
} from "./mark-route-decision";
import { pickView } from "./mark-route-pick";
import { classifyFailure, setRunIntent, waiveFailure } from "./mark-route-actions";
import { MarkRouteCard } from "./mark-route-card";
import type {
  ClassifyOutcome,
  Decision,
  IntentsOutcome,
  ToggleChange,
  WaiveOutcome,
} from "./mark-route-outcomes";
import { WaiveDialog } from "./waive-dialog";

/** How a decision is sent. The Server Action in production; tests pass their own. */
export type ClassifySender = (
  testRunId: string,
  caseId: string,
  decision: Decision,
) => Promise<ClassifyOutcome>;

/** How a waiver is sent. The Server Action in production; tests pass their own. */
export type WaiveSender = (
  testRunId: string,
  caseId: string,
  reason: string,
) => Promise<WaiveOutcome>;

/** How a toggle is stored. The Server Action in production; tests pass their own. */
export type IntentSender = (runId: string, change: ToggleChange) => Promise<IntentsOutcome>;

/** What a reader has typed for one failure, and whether they are deciding it again. */
interface Draft {
  readonly chosen: FailureClass | null;
  readonly note: string;
  readonly editing: boolean;
}

/** A failure nobody has started deciding. */
const BLANK: Draft = { chosen: null, note: "", editing: false };

/** What the panel is told. */
export interface MarkRoutePanelProps {
  /** The run. */
  readonly runId: string;
  /** The module the page was opened from — the receipt's link keeps it lit. */
  readonly from: string;
  /** The attempt on screen. */
  readonly testRunId: string;
  /** The failure on the failure-detail card, or `null` when the attempt has none in scope. */
  readonly target: FailureEntry | null;
  /** The failed set *Send failures back to loop* staged for this attempt, or `null`. */
  readonly staged: StagedFailures | null;
  /**
   * The ids of the attempt's failures that can be put on the card, or `null` while the attempt's
   * page has not been read.
   */
  readonly openable: ReadonlySet<string> | null;
  /** Put a staged failure on both cards. */
  readonly onPick: (caseId: string) => void;
  /** The attempt's triage hints, or `null` while they have not been read. */
  readonly hints: TestRunHints | null;
  /** The attempt's current decisions, as its page serves them. */
  readonly classifications: readonly Classification[];
  /** The timeline's next step — the stored toggles — or `null` while it has not been read. */
  readonly next: TestNextStep | null;
  /** The attempt a correction round would open, or `null` when it is not known. */
  readonly nextAttempt: number | null;
  /** Whether the reader may classify and set the toggles — owner, admin or member. */
  readonly mayClassify: boolean;
  /** Whether the reader may waive — owner or admin. */
  readonly mayWaive: boolean;
  /** The reader's id, or `null` when it is not known. */
  readonly readerId: string | null;
  /** Display names by id, or `null` when the workspace's members could not be read. */
  readonly people: Readonly<Record<string, string>> | null;
  /** A decision was recorded — the screen reads the attempt's page and the timeline again. */
  readonly onDecided: () => void;
  /** A toggle was stored — the screen reads the timeline again. */
  readonly onStored: () => void;
  /** How to send a decision. Defaults to the Server Action. */
  readonly classify?: ClassifySender;
  /** How to send a waiver. Defaults to the Server Action. */
  readonly waive?: WaiveSender;
  /** How to store a toggle. Defaults to the Server Action. */
  readonly setIntent?: IntentSender;
  /** The region, for the screen to scroll to and focus. */
  readonly ref?: Ref<HTMLElement>;
}

/**
 * The Mark & Route card, bound ([#340](https://github.com/NobuData/ouroboros/issues/340)): what
 * the reader has typed, what they have sent, and what came back.
 *
 * **What is typed is kept per failure**, so moving between the failures of a staged set loses no
 * half-written correction. The screen keys this component by the attempt, so another build's
 * failures never inherit it.
 *
 * **A decision is drawn from what the service answered**, held here until the attempt's page
 * serves it, and with what only the answer carries: what routing could not do, and the decision
 * it replaced. Nothing is drawn as decided before the service says it is.
 *
 * **A toggle is stored when it is pressed.** The value the service answered is drawn until the
 * timeline's poll agrees with it, so the switch does not flick back while that read is in flight.
 *
 * @param props See {@link MarkRoutePanelProps}.
 * @returns The card, and its waiver dialog.
 */
export function MarkRoutePanel({
  runId,
  from,
  testRunId,
  target,
  staged,
  openable,
  onPick,
  hints,
  classifications,
  next,
  nextAttempt,
  mayClassify,
  mayWaive,
  readerId,
  people,
  onDecided,
  onStored,
  classify = classifyFailure,
  waive = waiveFailure,
  setIntent = setRunIntent,
  ref,
}: MarkRoutePanelProps) {
  const [drafts, setDrafts] = useState<Readonly<Record<string, Draft>>>({});
  const [decided, setDecided] = useState<Readonly<Record<string, HeldDecision>>>({});
  const [waivers, setWaivers] = useState<Readonly<Record<string, Waiver>>>({});
  const [sending, setSending] = useState(false);
  const [refusal, setRefusal] = useState<{ caseId: string; reason: string } | null>(null);
  const [waiving, setWaiving] = useState<FailureEntry | null>(null);
  const [held, setHeld] = useState<Partial<Record<ToggleField, boolean>>>({});
  const [storing, setStoring] = useState(false);
  const [toggleRefusal, setToggleRefusal] = useState<string | null>(null);

  /**
   * The decision that stands for a case: the newest of what the page serves and what was just
   * recorded here.
   *
   * @param id The case.
   * @returns The decision and what came with it, or `null` while the case is undecided.
   */
  function decisionOf(id: string) {
    return currentDecision(classifications, decided[id] ?? null, id);
  }

  const caseId = target?.caseId ?? null;
  const draft = (caseId === null ? undefined : drafts[caseId]) ?? BLANK;
  const current = caseId === null ? null : decisionOf(caseId);
  // The worklist names a decision the moment it is recorded, not when the page next serves it.
  const stagedDecisions = (staged?.cases ?? []).flatMap((each) => {
    const found = decisionOf(each.caseId);

    return found === null ? [] : [found.decision];
  });
  const waiver = caseId === null ? undefined : waivers[caseId];

  const pick =
    caseId === null ? ({ kind: "none" } as const) : pickView(hints, caseId, classifications);

  // The timeline has caught up with a toggle this reader set, so its word is the one drawn from
  // here on. Dropped during render: a held value that outlived the agreement would hide a change
  // somebody else makes later.
  if (next !== null) {
    const agreed = (Object.keys(held) as ToggleField[]).filter(
      (field) => next.intents[field] === held[field],
    );

    if (agreed.length > 0) {
      setHeld(
        Object.fromEntries(
          Object.entries(held).filter(([field]) => !agreed.includes(field as ToggleField)),
        ),
      );
    }
  }

  /**
   * Change what is typed for the failure on the card.
   *
   * @param change The fields that changed.
   */
  function edit(change: Partial<Draft>): void {
    if (caseId === null) return;

    setDrafts((before) => ({ ...before, [caseId]: { ...(before[caseId] ?? BLANK), ...change } }));
    setRefusal(null);
  }

  /** Send the decision on the card, then hold what the service answered. */
  async function submit(): Promise<void> {
    if (target === null || sending) return;

    const selected = draft.chosen ?? (pick.kind === "none" ? null : pick.class);
    if (selected === null) return;

    const note = draft.note.trim();
    const prior = current?.decision ?? null;
    const sentFor = target.caseId;

    setSending(true);
    setRefusal(null);

    try {
      const outcome = await classify(testRunId, sentFor, {
        class: selected,
        note: note === "" ? null : note,
      });

      if (!outcome.ok) {
        setRefusal({ caseId: sentFor, reason: outcome.reason });
        return;
      }

      setDecided((before) => ({ ...before, [sentFor]: { result: outcome.result, prior } }));
      setDrafts((before) => ({ ...before, [sentFor]: BLANK }));
      onDecided();
    } finally {
      setSending(false);
    }
  }

  /**
   * Store a toggle's other value, then hold what the service answered.
   *
   * @param field The toggle.
   */
  async function toggle(field: ToggleField): Promise<void> {
    if (next === null || storing || !mayClassify) return;

    const value = !(held[field] ?? next.intents[field]);

    setStoring(true);
    setToggleRefusal(null);

    try {
      const outcome = await setIntent(runId, { field, value });

      if (!outcome.ok) {
        setToggleRefusal(outcome.reason);
        return;
      }

      setHeld((before) => ({ ...before, [field]: outcome.intents[field] }));
      onStored();
    } finally {
      setStoring(false);
    }
  }

  /**
   * Send the waiver of the failure the dialog was opened for.
   *
   * @param reason Why, trimmed.
   * @returns That it was recorded, or why it was not — drawn in the dialog.
   */
  async function confirmWaiver(reason: string): Promise<TextDialogOutcome> {
    if (waiving === null) return { ok: true };

    const waived = waiving.caseId;
    const outcome = await waive(testRunId, waived, reason);

    if (!outcome.ok) return { ok: false, reason: outcome.reason };

    setWaivers((before) => ({ ...before, [waived]: outcome.waiver }));

    return { ok: true };
  }

  return (
    <>
      <MarkRouteCard
        editing={draft.editing}
        empty={openable === null ? READING_TARGET : NOTHING_TO_CLASSIFY}
        form={formView({
          pick,
          chosen: draft.chosen,
          note: draft.note,
          nextAttempt,
          sending,
        })}
        mayClassify={mayClassify}
        mayWaive={mayWaive}
        note={draft.note}
        onChoose={(chosen) => edit({ chosen })}
        onKeep={() => edit({ editing: false })}
        onNote={(note) => edit({ note })}
        onPick={onPick}
        onReclassify={() => edit({ editing: true })}
        onSubmit={() => void submit()}
        onToggle={(field) => void toggle(field)}
        onWaive={() => setWaiving(target)}
        recorded={
          current === null ? null : recordedView({ current, runId, from, readerId, people })
        }
        ref={ref}
        refusal={refusal !== null && refusal.caseId === caseId ? refusal.reason : null}
        target={target}
        toggleRefusal={toggleRefusal}
        toggles={
          next === null ? null : togglesView({ next, held, mayClassify, sending: storing })
        }
        waiver={waiver === undefined ? null : waiverView(waiver, readerId, people)}
        worklist={worklistView(staged, openable, stagedDecisions, caseId)}
      />
      <WaiveDialog
        failure={waiving === null ? null : `${waiving.suite} › ${waiving.name}`}
        onClose={() => setWaiving(null)}
        onConfirm={confirmWaiver}
      />
    </>
  );
}
