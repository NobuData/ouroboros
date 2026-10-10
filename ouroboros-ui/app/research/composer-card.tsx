"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useState } from "react";

import type { InvestigationDepth, InvestigationKind } from "@/app/api/research";
import { PLANNING_PATH } from "@/app/paths";
import { Button, Card, CardHead, Chip, EmptyState, TextAreaField } from "@/app/ui";

import {
  COMPOSER_TITLE,
  COMPOSER_UNAVAILABLE_TITLE,
  type ComposerReadings,
  type ComposerRun,
  DEFAULT_DEPTH,
  DELIVERABLE_PREFIX,
  type EstimateOutcome,
  NO_KINDS_NOTE,
  PLANNING_WORD,
  QUESTION_LABEL,
  QUESTION_NAME,
  QUESTION_PLACEHOLDER,
  RELOAD_LABEL,
  STARTING_LABEL,
  START_LABEL,
  defaultSelection,
  deliverableSteps,
  estimateStateOf,
  estimateWords,
  hasBrief,
  inFlight,
  initialKind,
  researcherWords,
  runFromDetail,
  startReason,
  toggleTool,
} from "./composer";
import {
  cancelInvestigation,
  estimateComposer,
  readInvestigation,
  startInvestigation,
} from "./composer-actions";
import { DepthMenu } from "./composer-depth";
import { KindSegments } from "./composer-kinds";
import { ProgressSurface } from "./composer-progress";
import { ToolChips } from "./composer-tools";
import { type ProgressSourceFactory, watchInvestigation } from "./progress";
import { COMPOSER_REGION, regionTitleId } from "./view";

/** What the card takes. */
export interface ComposerCardProps {
  /** The catalogs and the setting, read on the server. */
  readonly readings: ComposerReadings;
  /** Why this reader may not start in this workspace, or null. */
  readonly gate: string | null;
  /** Told when a run has produced a brief, and when the reader asks to see it. */
  readonly onBriefReady: (investigationId: string) => void;
  /** How long a change waits before it is estimated, in milliseconds. */
  readonly estimateDelayMs?: number;
  /** How the progress stream is opened. Defaults to the browser's `EventSource`. */
  readonly openSource?: ProgressSourceFactory;
}

/** How long a change waits before it is estimated: long enough to absorb a run of clicks. */
export const ESTIMATE_DELAY_MS = 250;

/**
 * Mockup 22's **START AN INVESTIGATION** card (CN.2,
 * [#628](https://github.com/NobuData/ouroboros/issues/628)) — the product's front door: a
 * question, a kind, a depth and a tool mix, with a **computed estimate** and a **resolved
 * researcher pill**, and live progress in place once it starts.
 *
 * **It asks for money and time, so it is honest first.** The estimate line is the service's
 * sentence, re-read on every change of kind, depth or tool; when the researcher is unpriced it
 * carries no `$`, and this card composes no dollar figure of its own (`composer.ts`). The pill
 * names the alias routing resolved — a claim about what is about to run, never a constant. A
 * tool this build cannot call is an idle chip that points at where to connect it, not a toggle
 * that refuses. And **Start investigation** is inert, with its reason, for every state in which
 * a start could not honestly be made.
 *
 * **Starting is not a submit that hangs.** The card becomes a progress surface in place —
 * status, the source count ticking over the progress stream, spend so far — with **Cancel**,
 * and a finished run offers the brief (`composer-progress.tsx`).
 *
 * @param props See {@link ComposerCardProps}.
 * @returns The card.
 */
export function ComposerCard({
  readings,
  gate,
  onBriefReady,
  estimateDelayMs = ESTIMATE_DELAY_MS,
  openSource,
}: ComposerCardProps) {
  const router = useRouter();
  const titleId = regionTitleId(COMPOSER_REGION);
  const questionId = useId();

  const kinds = useMemo(() => (readings.kinds.ok ? readings.kinds.value.kinds : []), [readings]);
  const tools = useMemo(() => (readings.tools.ok ? readings.tools.value.tools : []), [readings]);

  const [kindSlug, setKindSlug] = useState<string | null>(() => initialKind(kinds)?.slug ?? null);
  const kind = useMemo(() => kinds.find((entry) => entry.slug === kindSlug) ?? null, [kinds, kindSlug]);
  const [question, setQuestion] = useState("");
  const [depth, setDepth] = useState<InvestigationDepth>(DEFAULT_DEPTH);
  const [on, setOn] = useState<readonly string[]>(() =>
    kind === null ? [] : defaultSelection(kind, tools),
  );
  const onSet = useMemo(() => new Set(on), [on]);
  const [run, setRun] = useState<ComposerRun | null>(null);
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  // Every change of kind or tool re-estimates, once the clicks have settled. The ask is keyed by
  // the kind and the selection as text, so a re-render with the same choices asks nothing, and an
  // answer to an earlier ask is known for what it is: kept on the line, marked stale, until the
  // newer one arrives.
  const askKey =
    kindSlug === null || on.length === 0 ? null : `${kindSlug}|${on.join(",")}`;
  const [answer, setAnswer] = useState<{ key: string; outcome: EstimateOutcome } | null>(null);
  useEffect(() => {
    if (askKey === null) return undefined;

    const [slug, selection] = askKey.split("|") as [string, string];
    let overtaken = false;
    const timer = setTimeout(() => {
      void estimateComposer({ kind: slug, tools: selection.split(",") }).then((outcome) => {
        if (!overtaken) setAnswer({ key: askKey, outcome });
      });
    }, estimateDelayMs);

    return () => {
      overtaken = true;
      clearTimeout(timer);
    };
  }, [askKey, estimateDelayMs]);

  const estimate = estimateStateOf(askKey, answer);

  // While the run is in flight, its stream ticks the surface; `done` ends the watch and the
  // detail is read once for what the stream does not carry — the failure reason.
  const runId = run?.id ?? null;
  const live = run !== null && inFlight(run.progress.status);
  useEffect(() => {
    if (runId === null || !live) return undefined;

    const forRun = (update: (current: ComposerRun) => ComposerRun) =>
      setRun((current) => (current !== null && current.id === runId ? update(current) : current));

    return watchInvestigation(
      runId,
      {
        onProgress: (progress) => forRun((current) => ({ ...current, progress })),
        onDone: (progress) => {
          forRun((current) => ({ ...current, progress }));
          if (hasBrief(progress.status)) onBriefReady(runId);
          void readInvestigation(runId).then((outcome) => {
            if (outcome.ok) forRun((current) => runFromDetail(current, outcome.detail));
          });
        },
        onError: (error) => setRefusal(error.message),
      },
      openSource,
    );
  }, [runId, live, openSource, onBriefReady]);

  const selectKind = useCallback(
    (next: InvestigationKind) => {
      setKindSlug(next.slug);
      setOn(defaultSelection(next, tools));
    },
    [tools],
  );

  const toggle = useCallback(
    (slug: string) => setOn((current) => toggleTool(new Set(current), slug, tools)),
    [tools],
  );

  async function start(): Promise<void> {
    if (kindSlug === null) return;

    setStarting(true);
    setRefusal(null);
    const outcome = await startInvestigation({
      question: question.trim(),
      kind: kindSlug,
      depth,
      tools: [...on],
    });
    setStarting(false);

    if (!outcome.ok) {
      setRefusal(outcome.refusal.message);
      return;
    }
    setRun(outcome.run);
  }

  async function cancel(): Promise<void> {
    if (run === null) return;

    setCancelling(true);
    const outcome = await cancelInvestigation(run.id);
    setCancelling(false);

    if (!outcome.ok) {
      setRefusal(outcome.refusal.message);
      return;
    }
    setRun((current) =>
      current === null
        ? current
        : { ...current, progress: outcome.run.progress, mayCancel: outcome.run.mayCancel },
    );
  }

  function startAnother(): void {
    setRun(null);
    setQuestion("");
    setRefusal(null);
  }

  const unread = !readings.kinds.ok ? readings.kinds : !readings.tools.ok ? readings.tools : null;
  if (unread !== null) {
    return (
      <Card aria-labelledby={titleId} as="section">
        <CardHead title={COMPOSER_TITLE} titleId={titleId} />
        <EmptyState note={unread.reason} title={COMPOSER_UNAVAILABLE_TITLE} variant="flush">
          <Button onClick={() => router.refresh()} tone="ghost">
            {RELOAD_LABEL}
          </Button>
        </EmptyState>
      </Card>
    );
  }

  if (kind === null) {
    return (
      <Card aria-labelledby={titleId} as="section">
        <CardHead title={COMPOSER_TITLE} titleId={titleId} />
        <EmptyState note={NO_KINDS_NOTE} variant="flush" />
      </Card>
    );
  }

  const researcher = estimate.kind === "ready" ? estimate.estimates[depth].researcher : undefined;
  const reason = starting
    ? STARTING_LABEL
    : startReason({ gate, question, toolsOn: on.length, estimate, depth });
  const steps = deliverableSteps(kind.playbook.deliverables);

  return (
    <Card aria-labelledby={titleId} as="section">
      <CardHead
        title={COMPOSER_TITLE}
        titleId={titleId}
        trailing={
          <Chip mono tone={researcher === null ? "warn" : "model"}>
            {researcherWords(researcher)}
          </Chip>
        }
      />

      {run !== null ? (
        <ProgressSurface
          cancelling={cancelling}
          kind={kind}
          onCancel={() => void cancel()}
          onStartAnother={startAnother}
          onViewBrief={() => onBriefReady(run.id)}
          question={question}
          run={run}
        />
      ) : (
        <div className="research__composer">
          <TextAreaField
            id={questionId}
            label={QUESTION_LABEL}
            name={QUESTION_NAME}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder={QUESTION_PLACEHOLDER}
            readOnly={starting}
            rows={4}
            value={question}
          />

          <div className="research__composer-row">
            <KindSegments disabled={starting} kinds={kinds} onSelect={selectKind} selected={kindSlug} />
            <DepthMenu
              depth={depth}
              estimates={estimate.kind === "ready" ? estimate.estimates : null}
              onPick={setDepth}
              reason={starting ? STARTING_LABEL : undefined}
            />
          </div>

          <ToolChips disabled={starting} on={onSet} onToggle={toggle} tools={tools} />

          <div className="research__composer-foot">
            <span className="research__deliverable">
              {DELIVERABLE_PREFIX} {steps.join(" → ")} in{" "}
              <a className="research__deliverable-link" href={PLANNING_PATH}>
                {PLANNING_WORD}
              </a>
            </span>
            <span className="research__composer-end">
              <span aria-busy={estimate.kind === "pending" || (estimate.kind === "ready" && estimate.stale)} className="research__estimate">
                {estimateWords(estimate, depth)}
              </span>
              <Button onClick={() => void start()} reason={reason ?? undefined} tone="primary">
                {starting ? STARTING_LABEL : START_LABEL}
              </Button>
            </span>
          </div>
        </div>
      )}

      {refusal !== null && (
        <p className="research__refusal" role="alert">
          {refusal}
        </p>
      )}
    </Card>
  );
}
