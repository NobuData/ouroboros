"use client";

import type { ReactNode } from "react";

import { CHROME_BAR_PROPERTY } from "./chrome";
import { cx } from "./class-names";
import { useChromeExtent } from "./use-chrome-extent";

import "./ui.css";

/**
 * A bar that stays put while the page scrolls under it
 * ([#646](https://github.com/NobuData/ouroboros/issues/646)).
 *
 * The shape behind every "this needs you before you leave" surface the mockup roadmaps
 * assume: the workflow builder's and settings' unsaved-changes bars, the issue queue's
 * "3 issues selected" bar (mockup 03's `.sel-bar`). With the content pane the only scroll
 * container (§ 1.3), each of those must stick against the *pane* — and getting
 * `position: sticky` right against a scroll container is exactly the detail that gets
 * re-derived slightly differently twenty-two times, which is why it is a primitive.
 *
 * ### Its place in the stack
 *
 * Layer 2 of 3 in the stacking contract `app/ui/chrome.ts` documents: a `PageSubnav`
 * above, a sticky table header below. The bar's `top` is the subnav's published height —
 * zero when there is none — so the two never race for the same edge, and it publishes its
 * own height as {@link CHROME_BAR_PROPERTY} so the table header and the pane's anchor
 * offset clear it in turn. One sticky bar per page: the contract defines the stack, not a
 * pile.
 *
 * ### Tones
 *
 * The base bar is quiet chrome — the pane's scrim over scrolled content, a hairline below.
 * `"asking"` adds the accent rim and glow the mockups reserve for a bar that wants
 * something from the reader (03's `.sel-bar`, 13's `.action-bar`): a dirty-state bar is
 * asking, a filter summary is not.
 *
 * ### What it does not decide
 *
 * Content and meaning. A dirty-state bar is a status region, a bulk-action bar is not, and
 * only the page knows — so `role`, live-region semantics and the controls inside are the
 * children's business, the same division `PageSubnav` makes for its links.
 */

/** The bar's manner: quiet chrome, or the accent rim of a bar asking for a decision. */
export type StickyBarTone = "plain" | "asking";

/** What a sticky bar needs: a manner, and its content. */
export interface StickyBarProps {
  /** The treatment. Defaults to `"plain"`. */
  readonly tone?: StickyBarTone;
  /** The bar's content — text, buttons, whatever the surface puts in it. */
  readonly children: ReactNode;
  /** Classes from the page — placement only, never colour or type. */
  readonly className?: string;
}

/**
 * A bar stuck under whatever chrome is above it, over the scrolling page.
 *
 * @param props See {@link StickyBarProps}.
 * @returns A `<div>` that sticks below the page's subnav (or the pane's top edge) and
 *   publishes its height for the chrome stacked beneath it.
 */
export function StickyBar({ tone = "plain", children, className }: StickyBarProps) {
  const ref = useChromeExtent<HTMLDivElement>(CHROME_BAR_PROPERTY);

  return (
    <div
      className={cx("ou-sticky-bar", tone === "asking" && "ou-sticky-bar--asking", className)}
      ref={ref}
    >
      {children}
    </div>
  );
}
