"use client";

import type { InvestigationKind } from "@/app/api/research";
import { Button, Chip, type ChipTone, cx } from "@/app/ui";

import {
  CANCELLED_NOTE,
  CANCELLING_LABEL,
  CANCEL_LABEL,
  type ComposerRun,
  FAILED_NOTE,
  START_ANOTHER_LABEL,
  VIEW_BRIEF_LABEL,
  hasBrief,
  inFlight,
  progressWords,
  roundWords,
  statusWords,
} from "./composer";
import { TINT_CLASS } from "./composer-kinds";

/** What the progress surface takes. */
export interface ProgressSurfaceProps {
  /** The run being followed. */
  readonly run: ComposerRun;
  /** The question it is answering. */
  readonly question: string;
  /** Its kind, for the chip. */
  readonly kind: InvestigationKind | null;
  /** Whether a cancel has been asked for and not yet answered. */
  readonly cancelling: boolean;
  /** Stop the run. */
  readonly onCancel: () => void;
  /** Go to the brief — the finished surface's primary action. */
  readonly onViewBrief: () => void;
  /** Back to a blank composer. */
  readonly onStartAnother: () => void;
}

/** The pill's hue for each status word. */
function toneOf(run: ComposerRun): ChipTone {
  const { status, cancelRequested } = run.progress;

  if (status === "running") return cancelRequested ? "warn" : "accent";
  if (status === "queued") return "warn";
  if (hasBrief(status)) return "ok";
  if (status === "failed") return "err";

  return "neutral";
}

/**
 * The composer as a progress surface (CN.2,
 * [#628](https://github.com/NobuData/ouroboros/issues/628)): what the card becomes, in place,
 * once **Start investigation** is pressed — the status, the source count ticking as the ledger
 * grows, the spend so far, and **Cancel** — because the minutes a loop takes are when a reader
 * decides whether the question was worth it.
 *
 * **The spend is a measurement, printed only when there is one.** `spendCents` is what the
 * run's priced model calls have cost; `null` — nothing priced so far, or an unpriced
 * researcher — prints nothing at all, never `$0.00`. The estimate the run started under sits
 * beside it, verbatim, so the two can be compared.
 *
 * **A cancelled run is a partial result, not a discarded one.** Its line keeps the sources it
 * gathered and what it spent, and says the rest was kept. A finished run offers **View brief ↑**,
 * which lands on the brief's seat; a failed one says why.
 *
 * @param props See {@link ProgressSurfaceProps}.
 * @returns The surface.
 */
export function ProgressSurface({
  run,
  question,
  kind,
  cancelling,
  onCancel,
  onViewBrief,
  onStartAnother,
}: ProgressSurfaceProps) {
  const { progress } = run;
  const live = inFlight(progress.status);
  const round = roundWords(progress);

  return (
    <div aria-live="polite" className="research__progress">
      <p className="research__question-echo">
        {kind !== null && (
          <span className={cx("research__kind-chip", TINT_CLASS[kind.tint])}>{kind.name}</span>
        )}
        <span className="research__progress-id">{run.displayId}</span>
        {question}
      </p>

      <p className="research__progress-line">
        <Chip dot={live ? "pulse" : "filled"} tone={toneOf(run)}>
          {statusWords(progress)}
        </Chip>
        <span className="research__progress-figures">{progressWords(progress)}</span>
      </p>

      <p className="research__progress-meta">
        {round !== null && <span>{round}</span>}
        <span>{run.estimateLabel}</span>
      </p>

      {progress.status === "cancelled" && <p className="research__progress-note">{CANCELLED_NOTE}</p>}
      {progress.status === "failed" && (
        <p className="research__progress-note">
          {FAILED_NOTE}
          {run.failure !== null && ` ${run.failure.detail}`}
        </p>
      )}

      <div className="research__progress-actions">
        {live ? (
          <Button
            onClick={onCancel}
            reason={run.mayCancel ? undefined : "Only the person who started it, or an owner or admin, can cancel."}
            tone="ghost"
          >
            {cancelling ? CANCELLING_LABEL : CANCEL_LABEL}
          </Button>
        ) : (
          <>
            {hasBrief(progress.status) && (
              <Button onClick={onViewBrief} tone="primary">
                {VIEW_BRIEF_LABEL}
              </Button>
            )}
            <Button onClick={onStartAnother} tone="ghost">
              {START_ANOTHER_LABEL}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
