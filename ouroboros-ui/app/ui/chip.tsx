import type { ReactNode } from "react";

import { cx } from "./class-names";

import "./ui.css";

/**
 * The mockups' `.pill`, `.effort` and `.pill.model` in one primitive: a small marker
 * carrying a state in its hue.
 *
 * Each tone is one of the token sheet's published triples — text-capable ink, a 35% border,
 * a 10–12% fill (`docs/DESIGN_TOKENS.md` § Status) — so a chip is legible on every surface
 * in both palettes, and no tone is a colour invented at a call site.
 *
 * ### Hue is never the only signal
 *
 * The light and dark palettes differ in lightness as much as in hue, and a reader who
 * cannot separate two hues must still be able to separate two states. So a chip always
 * carries its state in words, and where two states sit side by side it also carries a
 * {@link ChipProps.dot} — filled for a state that was reported, a ring for one that is
 * *unknown*. That is the same rule the token sheet states and the dashboard's system card
 * is built on.
 */

/** Which hue a chip carries, and therefore what it is reporting. */
export type ChipTone =
  /** No state: a role, a label, a count. The default. */
  | "neutral"
  /** The brand accent: live, running, selected. */
  | "accent"
  /** Healthy, succeeded, merged. */
  | "ok"
  /** Needs attention, degraded, unknown. */
  | "warn"
  /** Failed, blocked, down. */
  | "err"
  /** The LLM / model-routing hue. */
  | "model";

/** The shape of the dot before a chip's label, when it has one. */
export type ChipDot =
  /** Filled — a state that was reported. */
  | "filled"
  /** A ring — a state nobody could report. */
  | "ring";

/** What a chip takes. */
export interface ChipProps {
  /** Which hue. Defaults to `neutral`. */
  readonly tone?: ChipTone;
  /**
   * The shape before the label, when the chip needs to differ from its neighbours by more
   * than colour. Omitted, the chip is its label alone.
   */
  readonly dot?: ChipDot;
  /** Whether the label is a value rather than a word — a model name, an identifier. */
  readonly mono?: boolean;
  /** The label. A chip is never empty: the hue alone says nothing. */
  readonly children: ReactNode;
  /** Classes from the page — placement only, never colour or type. */
  readonly className?: string;
  /** A tooltip, where the label is an abbreviation of something longer. */
  readonly title?: string;
}

/** The modifier each tone adds, or nothing for the neutral one. */
const TONE_CLASS: Record<ChipTone, string> = {
  neutral: "",
  accent: "ou-chip--accent",
  ok: "ou-chip--ok",
  warn: "ou-chip--warn",
  err: "ou-chip--err",
  model: "ou-chip--model",
};

/**
 * A chip.
 *
 * @param props See {@link ChipProps}.
 * @returns The chip, with its dot hidden from the accessibility tree — it repeats in shape
 *   what the label already says in words.
 */
export function Chip({ tone = "neutral", dot, mono, children, className, title }: ChipProps) {
  return (
    <span
      className={cx("ou-chip", TONE_CLASS[tone], mono && "ou-chip--mono", className)}
      title={title}
    >
      {dot !== undefined && (
        <span
          className={cx("ou-chip__dot", dot === "ring" && "ou-chip__dot--ring")}
          aria-hidden
        />
      )}
      {children}
    </span>
  );
}

/**
 * The estimate of how much work something is, as the mockups' square effort chip.
 *
 * The five sizes are the ones the roadmap and the issue forms already use, and the tone is
 * derived rather than passed: an `L` that was green somewhere would make the scale mean
 * nothing. The letters are the label, so the chip reads as `XS` … `XL` to everybody, and
 * `title` spells the scale out for a reader meeting it for the first time.
 */
export type Effort = "XS" | "S" | "M" | "L" | "XL";

/**
 * The hue each effort takes: the smallest two are cheap, the middle is the ordinary case,
 * and the largest two are the ones worth a second look before they are picked up.
 */
const EFFORT_TONE: Record<Effort, ChipTone> = {
  XS: "ok",
  S: "ok",
  M: "accent",
  L: "warn",
  XL: "err",
};

/**
 * An effort chip.
 *
 * @param props.effort Which of the five sizes.
 * @param props.className Classes from the page.
 * @returns The chip, in the hue that size carries.
 */
export function EffortChip({
  effort,
  className,
}: Readonly<{ effort: Effort; className?: string }>) {
  return (
    <Chip
      tone={EFFORT_TONE[effort]}
      className={cx("ou-chip--effort", className)}
      title={`Effort: ${effort}`}
    >
      {effort}
    </Chip>
  );
}
