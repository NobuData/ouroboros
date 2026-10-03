"use client";

import { useId } from "react";

import { Button, Card, CardHead } from "@/app/ui";

import { useAnalyzer } from "./analyzer-store";
import {
  FIRST_RUN_NOTE,
  INSUFFICIENT_TITLE,
  READS_LABEL,
  READS_LINE,
  RUN_IN_FLIGHT_REASON,
  THIN_RUN_NOTE,
  ctaLabel,
  floorLine,
  historyLine,
  neverRunTitle,
  pageState,
  thinAnalysisLine,
} from "./state-view";
import { RUN_GLYPH, runBlock } from "./view";

/**
 * What the page draws instead of its result cards when there are no results worth drawing (BW.6,
 * [#521](https://github.com/NobuData/ouroboros/issues/521)) — for many repositories, the first
 * thing the analyzer ever shows.
 *
 * - **Insufficient corpus**: how many builds the repository has, on how many days; the floor the
 *   service states; that an analysis may still be run and what it will not show; and what the
 *   analyzer reads. No chart and no suggestion is drawn — not an empty one either.
 * - **Never run**: the history is there. The panel says what a first analysis produces and offers
 *   it — the head's own action, inert for the same reasons — beside the how-it-works card.
 *
 * In both, a thin analysis that came before is named, so nobody wonders where its chart went.
 *
 * @returns The panel, or nothing while the page is unread or holds results.
 */
export function CorpusStatePanel() {
  const { page, mayAdminister, starting, start } = useAnalyzer();
  const titleId = useId();
  const state = pageState(page);

  if (page === null || (state !== "insufficient" && state !== "never-run")) return null;

  const { corpus, run } = page;
  const thin = thinAnalysisLine(corpus);
  const reason =
    runBlock({ mayAdminister, starting, unread: false }) ??
    (run?.status === "running" ? RUN_IN_FLIGHT_REASON : undefined);

  return (
    <Card aria-labelledby={titleId} as="section" className="analyzer-state">
      <CardHead title={state === "insufficient" ? INSUFFICIENT_TITLE : neverRunTitle(corpus)} titleId={titleId} />
      <p className="analyzer-state__count">{historyLine(corpus, corpus.window.days)}</p>
      {state === "insufficient" ? (
        <>
          <p className="analyzer-state__text">{floorLine(corpus)}</p>
          {thin !== null && <p className="analyzer-state__text">{thin}</p>}
          <p className="analyzer-state__text">{THIN_RUN_NOTE}</p>
        </>
      ) : (
        <>
          {thin !== null && <p className="analyzer-state__text">{thin}</p>}
          <p className="analyzer-state__text">{FIRST_RUN_NOTE}</p>
          <div className="analyzer-state__actions">
            <Button onClick={start} reason={reason} tone="primary">
              {ctaLabel(corpus)} <span aria-hidden="true">{RUN_GLYPH}</span>
            </Button>
          </div>
        </>
      )}
      <p className="analyzer-state__reads">
        <span className="analyzer-state__label">{READS_LABEL}</span>
        {READS_LINE}
      </p>
    </Card>
  );
}
