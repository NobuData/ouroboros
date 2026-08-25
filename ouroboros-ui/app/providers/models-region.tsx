"use client";

/**
 * The card's **Models available** region, live
 * ([#230](https://github.com/NobuData/ouroboros/issues/230)).
 *
 * The chips are the server's — this island draws the decided region it is handed and never
 * asks for models itself. What it adds is what only a client can: the **Refresh models**
 * action over `refreshModels`, followed by `router.refresh()` so the card is re-read; and the
 * animation when that re-read changes the chips. A chip that appeared enters; a chip that
 * vanished is kept drawn, leaving, for `CHIP_LEAVE_MS` and then dropped — which is what makes
 * a removal visible rather than a flicker. Motion only where the reader allows it
 * (`providers.css`).
 *
 * A model an alias still names is not a chip at all once discovery drops it; it is
 * `UnlistedFlag`, after the chips, with a link to the alias whose route it broke.
 *
 * The pull-list is this region's other shape — `pull-list.tsx` — because a pulling kind's
 * region refreshes the same way and flags the same way; only its rows differ.
 */

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { ProviderModel } from "@/app/api/providers";
import { Button, Chip, cx } from "@/app/ui";

import {
  DETECTED_LABEL,
  MODELS_LABEL,
  type ModelsRegion as Region,
  NO_MODELS,
  tierLabel,
} from "./cards";
import { CHIP_LEAVE_MS, REFRESHING, REFRESH_MODELS, REFRESH_READ_ONLY, chipDiff } from "./live";
import { refreshModels } from "./live-actions";
import { PullList } from "./pull-list";
import { UnlistedFlag } from "./unlisted-flag";

/** The region as this island draws it — the server draws the unavailable state itself. */
export type LiveRegion = Exclude<Region, { kind: "unavailable" }>;

/** What the island takes. */
export interface ModelsRegionProps {
  /** The connection. */
  readonly connectionId: string;
  /** The decided region. */
  readonly region: LiveRegion;
  /** Whether this reader may refresh or pull. */
  readonly mayAdminister: boolean;
}

/**
 * The region.
 *
 * @param props See {@link ModelsRegionProps}.
 * @returns The label row with its refresh, then the chips or the rows.
 */
export function ModelsRegion({ connectionId, region, mayAdminister }: ModelsRegionProps) {
  const router = useRouter();
  const labelId = `provider-${connectionId}-models`;
  const [refreshing, setRefreshing] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    setRefreshing(true);
    setFailure(null);

    const outcome = await refreshModels(connectionId);

    setRefreshing(false);

    if (!outcome.ok) {
      setFailure(outcome.reason);
      return;
    }

    router.refresh();
  }

  const refreshReason = !mayAdminister ? REFRESH_READ_ONLY : refreshing ? REFRESHING : undefined;

  return (
    <div className="providers-card__models">
      <div className="providers-card__models-head">
        <p className="providers-card__models-label" id={labelId}>
          {region.kind === "pull-list" ? DETECTED_LABEL : MODELS_LABEL}
        </p>
        {region.refreshable && (
          <Button
            aria-busy={refreshing || undefined}
            className="providers-card__refresh"
            onClick={() => void refresh()}
            reason={refreshReason}
            size="sm"
            tone="ghost"
          >
            {refreshing ? REFRESHING : REFRESH_MODELS}
          </Button>
        )}
      </div>

      {failure !== null && (
        <p
          className="providers-card__models-state providers-card__models-state--err"
          role="alert"
        >
          {failure}
        </p>
      )}

      {region.kind === "pull-list" ? (
        <PullList
          connectionId={connectionId}
          labelId={labelId}
          mayAdminister={mayAdminister}
          models={region.models}
          pulls={region.pulls}
          unlisted={region.unlisted}
        />
      ) : (
        <Chips labelId={labelId} region={region} />
      )}
    </div>
  );
}

/** One chip as drawn — the model, and whether it is on its way in or out. */
interface DrawnChip {
  readonly id: string;
  readonly display: string;
  readonly motion: "enter" | "leave" | null;
}

/**
 * The chips, animated across re-reads.
 *
 * @param props.labelId The region's label, for the list's name.
 * @param props.region The chips region.
 * @returns The list, or the line that says it is empty.
 */
function Chips({
  labelId,
  region,
}: Readonly<{ labelId: string; region: Extract<Region, { kind: "chips" }> }>) {
  /** The models as last drawn — read and written only inside the effect below. */
  const previous = useRef<readonly ProviderModel[] | null>(null);
  const [entering, setEntering] = useState<ReadonlySet<string>>(new Set());
  const [leaving, setLeaving] = useState<readonly DrawnChip[]>([]);

  useEffect(() => {
    const before = previous.current;

    previous.current = region.models;

    if (before === null) return;

    const diff = chipDiff(
      before.map((model) => model.modelId),
      region.models.map((model) => model.modelId),
    );

    if (diff.entering.size === 0 && diff.leaving.length === 0) return;

    // The leaving chips keep the display they had: the model is gone from the props, so its
    // name can only come from the render that last had it.
    setEntering(diff.entering);
    setLeaving(
      diff.leaving.map((id) => ({
        id,
        display: before.find((model) => model.modelId === id)?.display ?? id,
        motion: "leave",
      })),
    );

    const timer = setTimeout(() => {
      setEntering(new Set());
      setLeaving([]);
    }, CHIP_LEAVE_MS);

    return () => clearTimeout(timer);
  }, [region.models]);

  if (region.models.length === 0 && region.unlisted.length === 0 && leaving.length === 0) {
    return <p className="providers-card__models-state">{NO_MODELS}</p>;
  }

  const drawn: readonly DrawnChip[] = [
    ...region.models.map((model) => ({
      id: model.modelId,
      display: model.display,
      motion: entering.has(model.modelId) ? ("enter" as const) : null,
    })),
    ...leaving,
  ];

  return (
    <ul aria-labelledby={labelId} className="providers-card__chips">
      {drawn.map((chip) => (
        <li
          className={cx(
            "providers-card__chip",
            chip.motion === "enter" && "providers-card__chip--enter",
            chip.motion === "leave" && "providers-card__chip--leave",
          )}
          key={chip.id}
        >
          <Chip mono tone="model">
            {chip.display}
          </Chip>
        </li>
      ))}
      {/* A tier pill only where discovery reported one — decision P8. */}
      {region.tiers.map((tier) => (
        <li className="providers-card__chip" key={`tier:${tier}`}>
          <Chip tone="ok">{tierLabel(tier)}</Chip>
        </li>
      ))}
      {region.unlisted.map((unlisted) => (
        <li
          className="providers-card__chip providers-card__chip--unlisted"
          key={`unlisted:${unlisted.modelId}`}
        >
          <UnlistedFlag unlisted={unlisted} />
        </li>
      ))}
    </ul>
  );
}
