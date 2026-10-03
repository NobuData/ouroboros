"use client";

import { useEffect } from "react";

import { setNavOrigin } from "@/app/shell/nav-registry";
import { RetryBanner } from "@/app/ui";

import { AnalyzerHead } from "./analyzer-head";
import type { AnalyzerPollOptions } from "./analyzer-poll";
import { AnalyzerProvider, useAnalyzer } from "./analyzer-store";
import { CorpusStatePanel } from "./corpus-state";
import type { AnalyzerReadings } from "./data";
import { DurationCard } from "./duration-card";
import { HowItWorksCard } from "./how-it-works-card";
import { MeasurementsCard } from "./measurements-card";
import { MetaStrip } from "./meta-strip";
import { RunProgress } from "./run-progress";
import { isCold, pageState, sideCards } from "./state-view";
import { ProcessSuggestionsCard, WorkflowSuggestionsCard } from "./suggestion-cards";
import { TicketsCard } from "./tickets-card";

import "./analyzer.css";

/** The sidebar entry this page mounts under, and keeps lit. */
export const ANALYZER_NAV_ORIGIN = "build-farm";

/** The banner's headline when the page could not be read. */
const UNREAD_HEADLINE = "The Build Analyzer could not be read.";

/**
 * The Build Analyzer (BW.1, [#516](https://github.com/NobuData/ouroboros/issues/516)) — mockup
 * 18's frame in the shell's content pane: the head, *Run analysis now*'s progress, and the meta
 * strip. Below it the mockup's two columns begin: the main one holds the annotated duration chart
 * (BW.2, [#517](https://github.com/NobuData/ouroboros/issues/517)) and, under it, the two
 * suggestion cards (BW.3, [#518](https://github.com/NobuData/ouroboros/issues/518)); the side
 * one holds the drafted tickets (BW.4, [#519](https://github.com/NobuData/ouroboros/issues/519)),
 * then the predicted-vs-measured card and the how-it-works explainer (BW.5,
 * [#520](https://github.com/NobuData/ouroboros/issues/520)).
 *
 * That is the page over **results**. A repository with too little history, or one nothing has
 * analysed yet, gets one panel in place of the result cards (BW.6,
 * [#521](https://github.com/NobuData/ouroboros/issues/521); `state-view.ts` holds the rule) — and
 * a run in flight, a failed one and a budget stop are the progress panel, over whichever holds.
 *
 * It has no sidebar entry of its own; it lives under **Build Farm**, which it publishes as its
 * origin so that entry stays lit (`setNavOrigin`, `app/shell/nav-registry.ts`).
 *
 * @param props.readings What the route read.
 * @param props.poll Test seams for the page's poll.
 * @returns The screen.
 */
export function AnalyzerScreen({
  readings,
  poll,
}: Readonly<{ readings: AnalyzerReadings; poll?: AnalyzerPollOptions }>) {
  useEffect(() => setNavOrigin(ANALYZER_NAV_ORIGIN), []);

  return (
    <AnalyzerProvider poll={poll} readings={readings}>
      <main className="analyzer">
        <AnalyzerBanner />
        <AnalyzerHead />
        <div className="analyzer__grid">
          <RunProgress />
          <MetaStrip />
          <AnalyzerMain />
          <AnalyzerSide />
        </div>
      </main>
    </AnalyzerProvider>
  );
}

/**
 * The mockup's main column (`c-8`) — the cards about the repository's builds, or the one panel
 * that stands in for them while there are no results worth drawing. It is not drawn in a workspace
 * with no repository to analyse: every card in it is one repository's.
 *
 * @returns The column, or nothing.
 */
function AnalyzerMain() {
  const { chosen, page } = useAnalyzer();

  if (chosen === null) return null;

  return (
    <div className="analyzer__main">
      {isCold(pageState(page)) ? (
        <CorpusStatePanel />
      ) : (
        <>
          <DurationCard />
          <ProcessSuggestionsCard />
          <WorkflowSuggestionsCard />
        </>
      )}
    </div>
  );
}

/**
 * The mockup's side column (`c-4`) — what the analysis turned into work, how its predictions held
 * up, and how it works. Like the main column it is one repository's, so it is not drawn where
 * there is none to analyse. In a cold state the explainer stays, and the two work cards stay only
 * where they hold something (`sideCards`).
 *
 * @returns The column, or nothing.
 */
function AnalyzerSide() {
  const { chosen, page } = useAnalyzer();

  if (chosen === null) return null;

  const cards = sideCards(page);

  return (
    <div className="analyzer__side">
      {cards.tickets && <TicketsCard />}
      {cards.measurements && <MeasurementsCard />}
      <HowItWorksCard />
    </div>
  );
}

/**
 * The banner a failed read draws — over the last page read, which stays on screen.
 *
 * @returns The banner, or nothing.
 */
function AnalyzerBanner() {
  const { failure, refresh } = useAnalyzer();

  return failure === null ? null : <RetryBanner headline={UNREAD_HEADLINE} onRetry={refresh} reason={failure} />;
}
