"use client";

import { cx } from "@/app/ui";

import { useInsights } from "./insights-store";
import { CUSTOM_LABEL, CUSTOM_REASON, RANGES, RANGE_GROUP_LABEL } from "./range";

/**
 * The insights range segment — mockup 15's `.seg`: `7d` / **`30d`** / `90d` / `custom`
 * (BK.2, [#443](https://github.com/NobuData/ouroboros/issues/443)).
 *
 * A group of pressed-state buttons, as the mockup draws it and as the planning tracker segment
 * keeps it (`app/planning/tracker-segment.tsx`): each is a tab stop and `aria-pressed` says which
 * is chosen. A press is `useInsights().select`, which re-reads the page for every region and
 * writes the address — the store says how.
 *
 * **`custom` is present and honestly unavailable**: custom ranges are BL.3's
 * ([#450](https://github.com/NobuData/ouroboros/issues/450)), so the option is `aria-disabled`
 * with no handler, its reason is the tooltip and is read with its name, and it is drawn in the
 * faint ink rather than looking like a button that failed.
 *
 * @returns The segment.
 */
export function RangeSegment() {
  const { range, select } = useInsights();

  return (
    <div aria-label={RANGE_GROUP_LABEL} className="insights-seg" role="group">
      {RANGES.map((option) => {
        const selected = option === range;

        return (
          <button
            aria-pressed={selected}
            className={cx("insights-seg__option", selected && "insights-seg__option--selected")}
            key={option}
            onClick={() => select(option)}
            type="button"
          >
            {option}
          </button>
        );
      })}
      <button
        aria-disabled
        aria-pressed={false}
        className="insights-seg__option"
        title={CUSTOM_REASON}
        type="button"
      >
        {CUSTOM_LABEL}
        {/* The space keeps the reason a separate phrase in the accessible name. */}{" "}
        <span className="sr-only">{`— ${CUSTOM_REASON}`}</span>
      </button>
    </div>
  );
}
