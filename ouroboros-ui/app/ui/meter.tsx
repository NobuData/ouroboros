import type { CSSProperties } from "react";

import { cx } from "./class-names";

import "./ui.css";

/**
 * The mockups' `.meter`: a proportion drawn as a bar.
 *
 * A stage is `4/6`, a merge rate is `92%`, a week's interventions are `2` against a budget.
 * All three are one shape — a track, and a fill across some fraction of it — and the
 * mockups draw them identically, so this is one primitive rather than three.
 *
 * ### The fraction is the one thing that comes from data
 *
 * Its height, its radius, its track and its fill are all the sheet's; the *width* of the
 * fill is a number nobody can know until a run reports one. That width is passed as a
 * custom property rather than as a `width` declaration, which keeps the split honest: the
 * stylesheet still owns the property, and the only thing written at the call site is the
 * datum. It is the one inline style on the dashboard, and
 * `__tests__/dashboard/dashboard-screen.test.tsx` holds it to exactly that.
 *
 * ### Whether it is announced depends on what is beside it
 *
 * A meter carrying the *only* statement of its value is a `progressbar` with a name and a
 * value, and it is announced. A meter beside a caption that already says `Implementing ·
 * 4/6` is a picture of that caption, and announcing it would read the same fact twice — so
 * it is hidden from the accessibility tree, exactly as {@link Chip}'s dot is. Which of the
 * two it is depends on the call site, so {@link MeterProps.label} decides: pass one and the
 * bar speaks, omit it and the text beside it does.
 */

/** Which hue a meter's fill takes, and therefore what it is reporting. */
export type MeterTone =
  /** The brand accent, as a gradient. The default: progress through something. */
  | "accent"
  /** Healthy, complete, on target. */
  | "ok"
  /** Approaching a limit, needing attention. */
  | "warn"
  /** Over a limit, failed. */
  | "err";

/** What a meter takes. */
export interface MeterProps {
  /**
   * How full, from `0` to `1`. Anything outside that range is clamped rather than refused:
   * a bar drawn past its own track is a rendering bug, and a card that threw instead would
   * take the whole page down over one bad row.
   */
  readonly value: number;
  /**
   * What the bar is *of*, when it is the only statement of its value — which makes it a
   * `progressbar` announced under that name. Omitted, the bar is decoration for a caption
   * that already says the same thing, and is hidden from the accessibility tree.
   */
  readonly label?: string;
  /**
   * What to announce instead of the bare percentage — `Implementing · 4/6`. Meaningless
   * without {@link MeterProps.label}, since a hidden bar announces nothing at all.
   */
  readonly valueText?: string;
  /** Which hue. Defaults to `accent`. */
  readonly tone?: MeterTone;
  /** Classes from the page — placement only, never colour or type. */
  readonly className?: string;
}

/** The modifier each tone adds, or nothing for the default one. */
const TONE_CLASS: Record<MeterTone, string> = {
  accent: "",
  ok: "ou-meter--ok",
  warn: "ou-meter--warn",
  err: "ou-meter--err",
};

/** The custom property the sheet reads the fill's width from. */
const FILL_PROPERTY = "--ou-meter-fill";

/**
 * The percentage a fraction fills, as CSS.
 *
 * Rounded to a tenth so a poll that moves a run by a fraction of a stage does not rewrite
 * the attribute with sixteen digits, and clamped so no data can draw a bar past its track.
 *
 * @param value The fraction, `0`–`1`. A value that is not a finite number — which is what
 *   `0/0` produces — is read as empty, because a bar nobody can compute is not a full one.
 * @returns The width, as a percentage string.
 */
function fillWidth(value: number): string {
  if (!Number.isFinite(value)) return "0%";

  const percent = Math.min(100, Math.max(0, value * 100));

  return `${Math.round(percent * 10) / 10}%`;
}

/**
 * A meter.
 *
 * @param props See {@link MeterProps}.
 * @returns The bar — a `progressbar` when it was given a label, and a decoration when it
 *   was not.
 */
export function Meter({ value, label, valueText, tone = "accent", className }: MeterProps) {
  const width = fillWidth(value);
  const announced = label !== undefined;

  return (
    <div
      className={cx("ou-meter", TONE_CLASS[tone], className)}
      role={announced ? "progressbar" : undefined}
      aria-label={label}
      // The value is announced as a percentage of the track, which is what the bar draws.
      // `aria-valuetext` is what turns `67%` back into `Implementing · 4/6` for a reader who
      // cannot see the caption's position beside it.
      aria-valuenow={announced ? Number.parseFloat(width) : undefined}
      aria-valuemin={announced ? 0 : undefined}
      aria-valuemax={announced ? 100 : undefined}
      aria-valuetext={valueText}
      aria-hidden={announced ? undefined : true}
    >
      <span
        className="ou-meter__fill"
        style={{ [FILL_PROPERTY]: width } as CSSProperties}
      />
    </div>
  );
}
