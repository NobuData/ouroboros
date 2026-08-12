import type { ReactNode } from "react";

import { cx } from "./class-names";

import "./ui.css";

/**
 * The mockups' `.eyebrow`: the small uppercase caption above a title.
 *
 * It is a primitive because both screens already had one — the login card's
 * `Step 1 · Sign in` and the dashboard's `Mission Control` were the same seven declarations
 * written twice, in two sheets, which is the drift this issue exists to stop before there
 * are twenty screens rather than two.
 *
 * It is a `<p>` rather than a heading, deliberately. An eyebrow is a caption *for* the
 * heading beneath it, so making it a heading of its own would put a second entry in the
 * page's outline for one title, and screen-reader users navigating by heading would hear
 * `Step 1 · Sign in` and `Sign in` as two separate things.
 */

/** How loud an eyebrow is. */
export type EyebrowTone =
  /** The accent — the default, and what the mockups draw. */
  | "accent"
  /** Faint, for a head that must not compete with the one beside it. */
  | "quiet";

/**
 * An eyebrow.
 *
 * @param props.tone Which treatment. Defaults to `accent`.
 * @param props.children The caption.
 * @param props.className Classes from the page — placement only.
 * @returns The caption.
 */
export function Eyebrow({
  tone = "accent",
  children,
  className,
}: Readonly<{ tone?: EyebrowTone; children: ReactNode; className?: string }>) {
  return (
    <p className={cx("ou-eyebrow", tone === "quiet" && "ou-eyebrow--quiet", className)}>
      {children}
    </p>
  );
}
