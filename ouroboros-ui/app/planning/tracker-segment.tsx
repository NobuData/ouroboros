"use client";

import { cx } from "@/app/ui";

import { TRACKER_GROUP_LABEL, type TrackerOption, type TrackerTint } from "./generator";

import "./planning.css";

/**
 * The generator card's tracker segment — mockup 09's `.seg` with its tinted monograms
 * (AM.2, [#284](https://github.com/NobuData/ouroboros/issues/284)).
 *
 * A group of pressed-state buttons rather than radios, as the mockup draws it: each is a tab stop,
 * `aria-pressed` says which is chosen, and a tracker that cannot be written to — or that nobody
 * connected — is **disabled with its reason** (AL.2, [#278](https://github.com/NobuData/ouroboros/issues/278)):
 * `aria-disabled`, the reason as its tooltip and as visually hidden text read with its name, and no
 * handler, so it cannot fail on click because it cannot be clicked into doing anything.
 */

/** Each monogram tint's classes — literal, so the stylesheet test can see them rendered. */
const MONOGRAM_CLASS: Record<TrackerTint, string> = {
  gh: "planning-mgram planning-mgram--gh",
  ji: "planning-mgram planning-mgram--ji",
  ln: "planning-mgram planning-mgram--ln",
  neutral: "planning-mgram",
};

/** What the segment takes. */
export interface TrackerSegmentProps {
  /** The buttons, from `generator.ts`'s `trackerOptions`. */
  readonly options: readonly TrackerOption[];
  /** The chosen source's id, or `null`. */
  readonly value: string | null;
  /** Called with a source's id when a choosable button is pressed. */
  readonly onChange: (sourceId: string) => void;
  /** Why nothing may be chosen at all — a viewer, a draft in flight. Every button goes inert. */
  readonly reason?: string;
}

/**
 * The segment.
 *
 * @param props See {@link TrackerSegmentProps}.
 * @returns The group.
 */
export function TrackerSegment({ options, value, onChange, reason }: TrackerSegmentProps) {
  return (
    <div aria-label={TRACKER_GROUP_LABEL} className="planning-seg" role="group">
      {options.map((option) => {
        const selected = option.sourceId !== null && option.sourceId === value;
        const why = option.reason ?? (selected ? undefined : reason);
        const sourceId = option.sourceId;

        return (
          <button
            aria-disabled={why !== undefined || undefined}
            aria-pressed={selected}
            className={cx("planning-seg__option", selected && "planning-seg__option--selected")}
            key={option.key}
            onClick={why === undefined && sourceId !== null ? () => { onChange(sourceId); } : undefined}
            title={why}
            type="button"
          >
            <span aria-hidden className={MONOGRAM_CLASS[option.tint]}>
              {option.monogram}
            </span>
            {option.label}
            {option.reason !== undefined && (
              <>
                {/* The space keeps the reason a separate phrase in the accessible name. */}{" "}
                <span className="sr-only">{`— ${option.reason}`}</span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
