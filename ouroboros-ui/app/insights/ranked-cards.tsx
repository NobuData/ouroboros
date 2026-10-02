"use client";

import type { InsightsPage } from "@/app/api/insights";
import { HBars } from "@/app/charts";

import {
  type BarsView,
  EFFORT_TITLE,
  SUITES_TITLE,
  TOKENS_TITLE,
  effortView,
  suitesView,
  tokensView,
} from "./bars-view";
import { useInsights } from "./insights-store";
import { SeriesCard, SeriesEmptyState, SeriesSkeleton, type SeriesWidth } from "./series-card";

/**
 * Mockup 15's three secondary bar cards (BK.5, [#446](https://github.com/NobuData/ouroboros/issues/446)):
 * **TEST FAILURES BY SUITE**, **TIME TO COMPLETION BY EFFORT** and **TOKENS BY STAGE**.
 *
 * Each is the `HBars` primitive over one of BJ.2's bar cards, ranked by `rankEmphasis`, with the
 * service's computed line under it — drawn only when the service had one to give. Each is drawn
 * for the page's own range, holds its place with a skeleton before anything is read, and draws a
 * designed empty state rather than zero-length bars. The bars sit in their own scroll wrapper, so
 * a narrow pane scrolls the card, never the content pane.
 */

/** What one ranked card is: its heading before a read, its width, its hue and its view. */
interface RankedCardSpec {
  /** The heading drawn on the skeleton, before the page says the range. */
  readonly title: string;
  /** Its width in the grid. */
  readonly width: SeriesWidth;
  /** `model` for token counts, as the mockup's `.hbar.tok`. */
  readonly hue: "accent" | "model";
  /** The card's view of the page. */
  readonly view: (page: InsightsPage) => BarsView;
}

/**
 * One ranked card, from its spec.
 *
 * @param props.spec What the card is.
 * @returns The card.
 */
function RankedCard({ spec }: Readonly<{ spec: RankedCardSpec }>) {
  const { page } = useInsights();

  if (page === null) {
    return (
      <SeriesCard busy tag={null} title={spec.title} width={spec.width}>
        <SeriesSkeleton width={spec.width} />
      </SeriesCard>
    );
  }

  const view = spec.view(page);

  return (
    <SeriesCard tag={view.tag} title={view.title} width={spec.width}>
      {view.empty !== null ? (
        <SeriesEmptyState empty={view.empty} />
      ) : (
        <div className="insights-scroll">
          <HBars className="insights-scroll__chart" hue={spec.hue} key={page.range} label={view.label} rows={view.rows} />
        </div>
      )}
      {view.line !== null && <p className="insights-series__foot">{view.line}</p>}
    </SeriesCard>
  );
}

/** The suites card's spec. */
const SUITES: RankedCardSpec = {
  title: SUITES_TITLE,
  width: "third",
  hue: "accent",
  view: (page) => suitesView(page.hbars.suites, page.range),
};

/** The effort card's spec. */
const EFFORT: RankedCardSpec = {
  title: EFFORT_TITLE,
  width: "third",
  hue: "accent",
  view: (page) => effortView(page.hbars.effort),
};

/** The tokens card's spec — the cost card's half of the row. */
const TOKENS: RankedCardSpec = {
  title: TOKENS_TITLE,
  width: "half",
  hue: "model",
  view: (page) => tokensView(page.hbars.tokens, page.range),
};

/**
 * **TEST FAILURES BY SUITE** — failing cases by suite, and the failures' share of every case run.
 *
 * @returns The card.
 */
export function SuitesCard() {
  return <RankedCard spec={SUITES} />;
}

/**
 * **TIME TO COMPLETION BY EFFORT** — the median issue-to-merge per effort chip, and #435's
 * calibration line.
 *
 * @returns The card.
 */
export function EffortCard() {
  return <RankedCard spec={EFFORT} />;
}

/**
 * **TOKENS BY STAGE** — tokens per task kind in the model hue, and the per-PR and local-share line.
 *
 * @returns The card.
 */
export function TokensCard() {
  return <RankedCard spec={TOKENS} />;
}
