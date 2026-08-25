"use client";

/**
 * The Ollama card's **Detected models** pull-list
 * ([#230](https://github.com/NobuData/ouroboros/issues/230), over AC.4's server-side
 * tracking, [#219](https://github.com/NobuData/ouroboros/issues/219)).
 *
 * One row per detected model: the mono name, the size tag, and **Pull latest**. A press asks
 * `startPull`, which answers at once with the record as the service holds it — `running`, or
 * `queued` behind another — and from then on the list **polls** `GET /api/providers/{id}/pulls`
 * every `PULL_POLL_MS` while anything is in flight. The progress is the service's, not this
 * browser's: the rows are handed the records read *with the page*, so a reload lands on a bar
 * at the transfer's real percentage rather than on an idle button, and the list stops polling
 * by itself when nothing is moving.
 *
 * When a pull lands the service re-runs discovery; the list waits `PULL_SETTLE_MS` and asks
 * the router to re-read the card, which is how the new size reaches the row. A pull that
 * failed says why, in the service's own sentence, beside the action to try again.
 *
 * The bar is a `progressbar` — it is the only statement of the percentage on the row — and
 * an indeterminate one while the daemon has not yet said how big the transfer is.
 */

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { ModelPull, ProviderModel, UnlistedModel } from "@/app/api/providers";
import { pullsPath } from "@/app/api/providers/[id]/pulls/path";
import { Button, Meter, cx } from "@/app/ui";

import { NO_MODELS } from "./cards";
import {
  PULLED,
  PULL_LATEST,
  PULL_POLL_MS,
  PULL_QUEUED,
  PULL_READ_ONLY,
  PULL_SETTLE_MS,
  PULL_STARTING,
  type PullRowState,
  anyInFlight,
  newlyPulled,
  pullRowState,
  pullValueText,
  sizeTag,
} from "./live";
import { startPull } from "./live-actions";
import { UnlistedFlag } from "./unlisted-flag";

/** What the list takes. */
export interface PullListProps {
  readonly connectionId: string;
  /** The region's label, for the list's name. */
  readonly labelId: string;
  readonly mayAdminister: boolean;
  /** The detected models, in the catalog's order. */
  readonly models: readonly ProviderModel[];
  /**
   * Aliased models the host no longer has — drawn as rows too, because pulling one is what
   * mends the route.
   */
  readonly unlisted: readonly UnlistedModel[];
  /** The service's records, as read with the page. */
  readonly pulls: readonly ModelPull[];
}

/** The shape of the answer the poll reads back — the contract's `ModelPulls`. */
interface PulledAnswer {
  readonly pulls: readonly ModelPull[];
}

/**
 * The list.
 *
 * @param props See {@link PullListProps}.
 * @returns The rows, or the line that says there are none.
 */
export function PullList({
  connectionId,
  labelId,
  mayAdminister,
  models,
  unlisted,
  pulls: initial,
}: PullListProps) {
  const router = useRouter();
  const [pulls, setPulls] = useState<readonly ModelPull[]>(initial);
  const [failures, setFailures] = useState<ReadonlyMap<string, string>>(new Map());
  const [starting, setStarting] = useState<ReadonlySet<string>>(new Set());
  /** The records as last drawn, for the poll to diff against — written only in an effect. */
  const latest = useRef(pulls);

  useEffect(() => {
    latest.current = pulls;
  }, [pulls]);

  useEffect(() => {
    if (!anyInFlight(pulls)) return;

    const timer = setInterval(() => {
      void (async () => {
        const response = await fetch(pullsPath(connectionId), { cache: "no-store" });

        if (!response.ok) return;

        const answer = (await response.json()) as PulledAnswer;
        const landed = newlyPulled(latest.current, answer.pulls);

        setPulls(answer.pulls);

        if (landed.length > 0) setTimeout(() => router.refresh(), PULL_SETTLE_MS);
      })();
    }, PULL_POLL_MS);

    return () => clearInterval(timer);
  }, [connectionId, pulls, router]);

  /**
   * Ask for one model.
   *
   * @param modelId The model, in the daemon's own spelling.
   */
  async function pull(modelId: string): Promise<void> {
    setStarting((ids) => new Set([...ids, modelId]));
    setFailures((map) => {
      const next = new Map(map);
      next.delete(modelId);
      return next;
    });

    const outcome = await startPull(connectionId, modelId);

    setStarting((ids) => new Set([...ids].filter((id) => id !== modelId)));

    if (!outcome.ok) {
      setFailures((map) => new Map(map).set(modelId, outcome.reason));
      return;
    }

    setPulls((current) => [
      ...current.filter((record) => record.modelId !== modelId),
      outcome.pull,
    ]);
  }

  if (models.length === 0 && unlisted.length === 0) {
    return <p className="providers-card__models-state">{NO_MODELS}</p>;
  }

  const byModel = new Map(pulls.map((record) => [record.modelId, record]));

  return (
    <ul aria-labelledby={labelId} className="providers-card__pull-list">
      {models.map((model) => (
        <Row
          failure={failures.get(model.modelId) ?? null}
          key={model.modelId}
          mayAdminister={mayAdminister}
          modelId={model.modelId}
          name={model.display}
          onPull={() => void pull(model.modelId)}
          size={sizeTag(model.sizeBytes)}
          starting={starting.has(model.modelId)}
          state={pullRowState(byModel.get(model.modelId))}
        />
      ))}
      {unlisted.map((flag) => (
        <Row
          failure={failures.get(flag.modelId) ?? null}
          flag={flag}
          key={`unlisted:${flag.modelId}`}
          mayAdminister={mayAdminister}
          modelId={flag.modelId}
          name={flag.modelId}
          onPull={() => void pull(flag.modelId)}
          size={null}
          starting={starting.has(flag.modelId)}
          state={pullRowState(byModel.get(flag.modelId))}
        />
      ))}
    </ul>
  );
}

/** What one row takes. */
interface RowProps {
  readonly modelId: string;
  readonly name: string;
  readonly size: string | null;
  readonly state: PullRowState;
  readonly starting: boolean;
  readonly failure: string | null;
  readonly mayAdminister: boolean;
  readonly onPull: () => void;
  /** Present for a row that is a stranded alias's model rather than a detected one. */
  readonly flag?: UnlistedModel;
}

/**
 * One row: the name and the size leading, the state and the action trailing.
 *
 * @param props See {@link RowProps}.
 * @returns The row.
 */
function Row({ modelId, name, size, state, starting, failure, mayAdminister, onPull, flag }: RowProps) {
  const busy = starting || state.kind === "running" || state.kind === "queued";
  const reason = !mayAdminister ? PULL_READ_ONLY : busy ? PULL_LATEST : undefined;

  return (
    <li
      className={cx("providers-card__pull-row", `providers-card__pull-row--${state.kind}`)}
      data-model={modelId}
    >
      <span className="providers-card__pull-lead">
        {flag === undefined ? (
          <span className="providers-card__pull-model">{name}</span>
        ) : (
          <UnlistedFlag unlisted={flag} />
        )}
        {size !== null && <span className="providers-card__pull-size">{size}</span>}
      </span>
      <span className="providers-card__pull-trail">
        {state.kind === "running" && (
          <span className="providers-card__pull-progress">
            <Meter
              className={cx(
                "providers-card__pull-bar",
                state.percent === null && "providers-card__pull-bar--indeterminate",
              )}
              label={`Pulling ${modelId}`}
              tone="accent"
              value={state.percent === null ? 0 : state.percent / 100}
              valueText={pullValueText(modelId, state)}
            />
            <span className="providers-card__pull-percent">
              {state.percent === null ? PULL_STARTING : `${state.percent.toString()}%`}
            </span>
          </span>
        )}
        {state.kind === "queued" && (
          <span className="providers-card__pull-state" role="status">
            {PULL_QUEUED}
          </span>
        )}
        {state.kind === "done" && (
          <span className="providers-card__pull-state providers-card__pull-state--ok" role="status">
            <span aria-hidden="true">✓</span> {PULLED}
          </span>
        )}
        {state.kind === "failed" && (
          <span className="providers-card__pull-state providers-card__pull-state--err" role="alert">
            <span aria-hidden="true">✗</span> {state.detail}
          </span>
        )}
        {failure !== null && (
          <span className="providers-card__pull-state providers-card__pull-state--err" role="alert">
            {failure}
          </span>
        )}
        {state.kind !== "running" && state.kind !== "queued" && (
          <Button
            aria-busy={starting || undefined}
            onClick={onPull}
            reason={reason}
            size="sm"
            tone="ghost"
          >
            {PULL_LATEST}
          </Button>
        )}
      </span>
    </li>
  );
}
