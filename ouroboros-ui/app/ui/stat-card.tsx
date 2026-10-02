import type { ReactNode } from "react";

import { Card } from "./card";
import { cx } from "./class-names";

import "./ui.css";

/**
 * The mockups' `.stat` inside a `.card`: a caption, a figure, and a line explaining the figure.
 *
 * It was the dashboard's own composition (DASH-I.2,
 * [#81](https://github.com/NobuData/ouroboros/issues/81)) until the build farm's stat row
 * (AI.1, [#256](https://github.com/NobuData/ouroboros/issues/256)) drew the same tile — which
 * is the threshold this directory sets for a primitive: a shape the design system names, used
 * by more than one screen, that decides nothing about the product. Mockups 02, 08, 11, 15 and
 * 23 all draw it, so the rule `app/dashboard/dashboard.css` states for itself applied: *a rule
 * belongs in `ui.css` if a second screen would otherwise write it again.*
 *
 * **It renders and decides nothing.** What the figure is, whether it is an em dash, what the
 * line under it says and whether there is one at all are the caller's — `app/dashboard/view.ts`
 * and `app/farm/view.ts` — so each of those is a unit test on a function rather than an
 * assertion about rendered text. What this maps is presentation only: a tone to the class that
 * colours it, in the same way {@link Card} maps its own.
 *
 * ### The two shapes mockup 08 adds
 *
 * - **A suffix on the figure** — `4/5` is an accented `4` beside a smaller, fainter `/5`. The
 *   suffix is part of the same figure rather than a second element beside it, so the tile still
 *   reads as one number.
 * - **Something between the figure and its line** — the cache tile's meter. It is `children`
 *   rather than a `meter` prop, because what goes there is the caller's composition and a
 *   primitive that knew about meters would be two primitives.
 *
 * ### The two mockup 11 adds
 *
 * - **A hue on the figure** — the test-results strip draws *Passed* in the ok hue, *Failed* in
 *   the error hue and *Flaky* in the warn hue (#335). `valueTone` names that hue; whether a
 *   figure deserves one is the caller's.
 * - **A link in the line** — the *Flaky* tile's `quarantine watching ↗`. The line is a node
 *   rather than a string, so the caller composes it; a primitive that knew about links would
 *   be deciding where they go.
 *
 * ### The one mockup 15 adds
 *
 * - **A caption that acts** — each KPI label opens its methodology popover (#443). `caption`
 *   replaces the caption's text with the caller's node, and `label` stays the tile's name.
 *
 * The caption is the tile's accessible name, so a reader moving between four of them hears
 * "Loops live, 3" rather than four unlabelled numbers. It is a `<section>` for the same reason:
 * an `aria-label` on a `<div>` names nothing.
 */

/**
 * How the line under a figure is drawn.
 *
 * It is a *tone* rather than a colour, because the sheet decides the colour and the caller
 * decides what the line is saying. The two directional ones are the mockups' own `up` and
 * `down` classes, and those name **goodness rather than direction** — mockup 15 draws
 * *"▼ 2m faster"* as `up`, and mockup 08 draws *"▼ 38s vs last week"* the same way, because a
 * time that fell is good news. The distinction is kept in the name so that the next card to use
 * it does not read `up` as *the number went up*.
 */
export type StatTone =
  /** The default: a line describing what the figure is made of. */
  | "muted"
  /** Good news — the mockups' `--ok`. */
  | "up"
  /** Bad news — the mockups' `--err`. */
  | "down"
  /** Not news at all: the reason the figure could not be read. */
  | "failed";

/** The hue a figure may take — mockup 11's coloured counts. */
export type StatValueTone = "ok" | "warn" | "err";

/** What a stat tile takes. */
export interface StatCardProps {
  /** The caption above the figure, and the tile's accessible name. */
  readonly label: string;
  /**
   * What is drawn in the caption's place, when the caption does more than name the tile — mockup
   * 15's KPI labels, each a button opening its methodology. {@link StatCardProps.label} stays the
   * tile's accessible name, so the caller should draw the same words. Omitted, the caption is the
   * label as text.
   */
  readonly caption?: ReactNode;
  /** The figure, already formatted — an em dash when there is nothing to show. */
  readonly value: string;
  /**
   * The rest of the figure, drawn smaller and fainter — the `/5` of `4/5`. Omitted, the figure
   * is {@link StatCardProps.value} alone.
   */
  readonly valueSuffix?: string;
  /**
   * Whether the figure is drawn in the accent colour — reserved for the tile that is in the
   * present tense. The suffix never takes it.
   */
  readonly accent?: boolean;
  /** The figure's hue, when it has one. Ignored when `accent` is set. */
  readonly valueTone?: StatValueTone;
  /**
   * The line under the figure — text, or the caller's composition of text and a link — or
   * `null` for a tile that has nothing it can honestly say.
   */
  readonly delta?: ReactNode;
  /** How that line is drawn. Defaults to `muted`. */
  readonly tone?: StatTone;
  /** What sits between the figure and its line — a meter. */
  readonly children?: ReactNode;
  /** Classes from the page — placement only, never colour or type. */
  readonly className?: string;
}

/** The modifier each delta tone adds, or nothing for the default one. */
const TONE_CLASS: Record<StatTone, string> = {
  muted: "",
  up: "ou-stat__delta--up",
  down: "ou-stat__delta--down",
  failed: "ou-stat__delta--failed",
};

/** The modifier each figure hue adds. */
const VALUE_TONE_CLASS: Record<StatValueTone, string> = {
  ok: "ou-stat__value--ok",
  warn: "ou-stat__value--warn",
  err: "ou-stat__value--err",
};

/**
 * A stat tile.
 *
 * @param props See {@link StatCardProps}.
 * @returns The card, as a region named by its caption.
 */
export function StatCard({
  label,
  caption,
  value,
  valueSuffix,
  accent = false,
  valueTone,
  delta = null,
  tone = "muted",
  children,
  className,
}: StatCardProps) {
  return (
    <Card as="section" className={className} aria-label={label}>
      <div className="ou-stat">
        <span className="ou-stat__label">{caption ?? label}</span>
        <span
          className={cx(
            "ou-stat__value",
            accent && "ou-stat__value--accent",
            !accent && valueTone !== undefined && VALUE_TONE_CLASS[valueTone],
          )}
        >
          {value}
          {valueSuffix !== undefined && <span className="ou-stat__suffix">{valueSuffix}</span>}
        </span>
        {children}
        {delta !== null && delta !== undefined && <span className={cx("ou-stat__delta", TONE_CLASS[tone])}>{delta}</span>}
      </div>
    </Card>
  );
}
