import type { ReactNode } from "react";

import { cx } from "./class-names";

import "./ui.css";

/**
 * The two markers that are not chips: the mockups' `.tag` and `.nav-badge`.
 *
 * A {@link Chip} carries a *state* and therefore a hue. These two carry neither:
 *
 * - **A tag is metadata** — a branch name, a key, a label somebody wrote. It is
 *   monospaced because it is a value read character by character, and it has no tones on
 *   purpose: a tag that could be red would be a chip.
 * - **A badge is a count attached to something else** — the sidebar's needs-you number, a
 *   tab's unread total. It is never a control of its own, and it never renders `0`: a badge
 *   showing zero is a claim that something is waiting when nothing is
 *   (`docs/DESIGN_SYSTEM_APP_SHELL.md` § 3.5, and the rule BN.4 spells out for the sidebar).
 */

/** What a badge is reporting, which decides its hue. */
export type BadgeTone =
  /** A plain count. The default. */
  | "neutral"
  /** Something live or selected. */
  | "accent"
  /** Something waiting for a person. */
  | "warn";

/** The modifier each tone adds, or nothing for the neutral one. */
const TONE_CLASS: Record<BadgeTone, string> = {
  neutral: "",
  accent: "ou-badge--accent",
  warn: "ou-badge--warn",
};

/**
 * A tag.
 *
 * @param props.children The value. A tag is never empty.
 * @param props.className Classes from the page.
 * @returns The tag.
 */
export function Tag({
  children,
  className,
}: Readonly<{ children: ReactNode; className?: string }>) {
  return <span className={cx("ou-tag", className)}>{children}</span>;
}

/**
 * A count badge, or nothing at all when there is nothing to report.
 *
 * @param props.count How many. `0` and a negative count render nothing, and so does a
 *   count that could not be read — the caller passes `null` for that, rather than a zero
 *   standing in for a number nobody has.
 * @param props.label What the count is *of*, read after the figure by a screen reader and
 *   hidden from the page — a bare `3` beside a navigation entry reads as nothing. It is
 *   visually hidden text rather than an `aria-label`, because a label on a `<span>` with no
 *   role is not reliably exposed at all.
 * @param props.tone Which hue. Defaults to `neutral`.
 * @param props.className Classes from the page.
 * @returns The badge, or `null`.
 */
export function Badge({
  count,
  label,
  tone = "neutral",
  className,
}: Readonly<{
  count: number | null;
  label: string;
  tone?: BadgeTone;
  className?: string;
}>) {
  if (count === null || count <= 0) return null;

  return (
    <span className={cx("ou-badge", TONE_CLASS[tone], className)}>
      {count}
      <span className="sr-only"> {label}</span>
    </span>
  );
}
