"use client";

import type { ReactNode } from "react";

import { CHROME_SUBNAV_PROPERTY } from "./chrome";
import { cx } from "./class-names";
import { useChromeExtent } from "./use-chrome-extent";

import "./ui.css";

/**
 * The mockups' `.subnav`, as a pane-top sticky
 * ([#646](https://github.com/NobuData/ouroboros/issues/646)).
 *
 * The tab row a section with sub-surfaces keeps at the top of its content pane — Models'
 * Routing / Model registry / Providers / Spend, Settings' section tabs — which is decision
 * S5's other half: the sidebar stays one level deep *because* the second level lives here.
 * Mockups 06, 07, 21 and 17 all draw the same gesture (a hairline under the row, a 2px
 * accent-glow underline beneath the active tab), so it is one primitive rather than four
 * hand-rolled `position: sticky` fixes — the drift between them (06's 13.5px type, 17's
 * tighter padding) is normalised, and the one *deliberate* divergence is kept:
 *
 * ### Tones, because the hues were a choice
 *
 * Mockup 06 underlines its active tab in `--model` — the model-routing purple — where 07
 * and 21 use the accent. The issue is explicit that each mockup's treatment is preserved
 * rather than normalised away, so the hue is a prop: {@link SubnavTone}. What is *not* a
 * prop is the shape — inset, height, radius and glow are the invariant the design system
 * draws at every level (the mockups' topbar nav and section navs use the identical
 * underline), and a shape per page would be the drift again.
 *
 * ### What the links are
 *
 * Children, not data. The tabs of a real section are route links (`next/link`, so the
 * navigation is client-side and the pane's scroll restoration sees it), Settings' are
 * anchor links, and a primitive that rendered its own `<a>` would have chosen for both.
 * The active tab is the one carrying `aria-current` — the attribute the sidebar already
 * uses for the same fact — so the state is written where a screen reader finds it and the
 * stylesheet reads the same spelling.
 *
 * ### The sticky half
 *
 * The row sticks to the top of the scroll container it lives in and publishes its measured
 * height as {@link CHROME_SUBNAV_PROPERTY} on that container — the fact the rest of the
 * stacking contract (`app/ui/chrome.ts`) offsets by. Layer 1 of 3: nothing sits above a
 * subnav, a `StickyBar` starts below it, a sticky table header below both.
 */

/**
 * The active tab's underline hue. `"accent"` unless the mockup being implemented says
 * otherwise — the only one that does today is 06, whose Models routing tabs underline in
 * the model purple.
 */
export type SubnavTone = "accent" | "model";

/** What a subnav needs: a name, a hue, and its tabs. */
export interface PageSubnavProps {
  /**
   * The accessible name of the navigation region — the section whose surfaces these tabs
   * move between, e.g. `"Models"`. Required because the shell's sidebar is also a `<nav>`,
   * and two unnamed navigation landmarks are indistinguishable in a rotor.
   */
  readonly label: string;
  /** The underline hue. Defaults to `"accent"`. */
  readonly tone?: SubnavTone;
  /**
   * The tabs: links, with `aria-current` on the active one (`"page"` for a route tab,
   * `"location"` for an anchor tab).
   */
  readonly children: ReactNode;
  /** Classes from the page — placement only, never colour or type. */
  readonly className?: string;
}

/** The tone that needs a modifier class — the accent hue is the base rule's own. */
const TONE_CLASS: Record<SubnavTone, string | false> = {
  accent: false,
  model: "ou-subnav--model",
};

/**
 * A section's tab row, stuck to the top of the pane.
 *
 * @param props See {@link PageSubnavProps}.
 * @returns A named `<nav>` that sticks to the top of its scroll container and publishes
 *   its height for the chrome stacked beneath it.
 */
export function PageSubnav({ label, tone = "accent", children, className }: PageSubnavProps) {
  const ref = useChromeExtent<HTMLElement>(CHROME_SUBNAV_PROPERTY);

  return (
    <nav aria-label={label} className={cx("ou-subnav", TONE_CLASS[tone], className)} ref={ref}>
      {children}
    </nav>
  );
}
