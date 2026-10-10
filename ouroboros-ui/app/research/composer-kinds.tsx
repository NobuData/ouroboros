"use client";

import type { InvestigationKind } from "@/app/api/research";
import { cx } from "@/app/ui";

import { KINDS_LABEL } from "./composer";

/**
 * The kind's hue, by V106's `tint_key` — literal class names in a component, so the style suite
 * sees every one rendered. A key nobody mapped draws the plain segment.
 */
export const TINT_CLASS: Readonly<Record<string, string>> = {
  bug: "research__kind--bug",
  reg: "research__kind--reg",
  road: "research__kind--road",
  gap: "research__kind--gap",
};

/** What the segmented control takes. */
export interface KindSegmentsProps {
  /** The workspace's kinds, in the composer's order. */
  readonly kinds: readonly InvestigationKind[];
  /** The chosen kind's slug. */
  readonly selected: string | null;
  /** Told the kind pressed. */
  readonly onSelect: (kind: InvestigationKind) => void;
  /** Whether the control can act — not while a run is being started. */
  readonly disabled?: boolean;
}

/**
 * The investigation kind, as mockup 22's segmented control (`.seg`) — one segment per kind the
 * registry serves, the chosen one in the `sel` treatment and the kind's own hue (CN.2,
 * [#628](https://github.com/NobuData/ouroboros/issues/628)).
 *
 * A radio group in the ARIA sense: the segments are one choice, so each is `aria-checked`
 * rather than `aria-pressed`, and the group carries the mockup's label. The hue is the kind
 * chip's hue elsewhere on the page (`tint`), from a literal class map so the style suite can
 * see every one.
 *
 * @param props See {@link KindSegmentsProps}.
 * @returns The group.
 */
export function KindSegments({ kinds, selected, onSelect, disabled = false }: KindSegmentsProps) {
  return (
    <div aria-label={KINDS_LABEL} className="research__kinds" role="radiogroup">
      {kinds.map((kind) => {
        const checked = kind.slug === selected;

        return (
          <button
            aria-checked={checked}
            aria-disabled={disabled || undefined}
            className={cx(
              "research__kind",
              TINT_CLASS[kind.tint],
              checked && "research__kind--sel",
            )}
            key={kind.slug}
            onClick={disabled ? undefined : () => onSelect(kind)}
            role="radio"
            type="button"
          >
            {kind.name}
          </button>
        );
      })}
    </div>
  );
}
