"use client";

import { useEffect } from "react";

import { setNavOrigin } from "@/app/shell/nav-registry";
import { RetryBanner } from "@/app/ui";

import { AnalyzerHead } from "./analyzer-head";
import type { AnalyzerPollOptions } from "./analyzer-poll";
import { AnalyzerProvider, useAnalyzer } from "./analyzer-store";
import type { AnalyzerReadings } from "./data";
import { DurationCard } from "./duration-card";
import { MetaStrip } from "./meta-strip";
import { RunProgress } from "./run-progress";
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
 * one opens with the drafted tickets (BW.4,
 * [#519](https://github.com/NobuData/ouroboros/issues/519)), and the measurements (BW.5) follow.
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
 * The mockup's main column (`c-8`) — the cards about the repository's builds. It is not drawn in a
 * workspace with no repository to analyse: every card in it is one repository's.
 *
 * @returns The column, or nothing.
 */
function AnalyzerMain() {
  const { chosen } = useAnalyzer();

  return chosen === null ? null : (
    <div className="analyzer__main">
      <DurationCard />
      <ProcessSuggestionsCard />
      <WorkflowSuggestionsCard />
    </div>
  );
}

/**
 * The mockup's side column (`c-4`) — what the analysis turned into work: the drafted tickets. Like
 * the main column it is one repository's, so it is not drawn where there is none to analyse.
 *
 * @returns The column, or nothing.
 */
function AnalyzerSide() {
  const { chosen } = useAnalyzer();

  return chosen === null ? null : (
    <div className="analyzer__side">
      <TicketsCard />
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
