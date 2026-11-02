"use client";

import { cx } from "@/app/ui";

import { ORIGIN_GROUP_LABEL, ORIGIN_OPTIONS, type OriginFilter, originCookie } from "./origin";

import "./origin.css";

/**
 * The origin filter (DJ.3, [#1316](https://github.com/NobuData/ouroboros/issues/1316)): **Live**,
 * **Demo data**, **Simulated**, **All origins** — a pressed-button group, as the Insights range
 * segment is. A press remembers the choice in the origin cookie, so the next page opened reads the
 * same origin, and hands it to the screen, which moves its address and reads.
 *
 * @param props.value The origin the page is showing.
 * @param props.onSelect What a press does — the screen's own navigation.
 * @param props.className Classes from the screen, for placement only.
 * @returns The group.
 */
export function OriginSegment({
  value,
  onSelect,
  className,
}: Readonly<{ value: OriginFilter; onSelect: (origin: OriginFilter) => void; className?: string }>) {
  return (
    <div aria-label={ORIGIN_GROUP_LABEL} className={cx("origin-seg", className)} role="group">
      {ORIGIN_OPTIONS.map((option) => {
        const selected = option.value === value;

        return (
          <button
            aria-pressed={selected}
            className={cx("origin-seg__option", selected && "origin-seg__option--selected")}
            key={option.value}
            onClick={() => {
              rememberOrigin(option.value);
              onSelect(option.value);
            }}
            type="button"
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Write the origin cookie in the browser.
 *
 * @param origin The chosen origin.
 */
export function rememberOrigin(origin: OriginFilter): void {
  document.cookie = originCookie(origin);
}
