"use client";

import { useEffect } from "react";

import { setNavOrigin } from "@/app/shell/nav-registry";
import { RetryBanner } from "@/app/ui";

import { AnalyzerHead } from "./analyzer-head";
import type { AnalyzerPollOptions } from "./analyzer-poll";
import { AnalyzerProvider, useAnalyzer } from "./analyzer-store";
import type { AnalyzerReadings } from "./data";
import { MetaStrip } from "./meta-strip";
import { RunProgress } from "./run-progress";

import "./analyzer.css";

/** The sidebar entry this page mounts under, and keeps lit. */
export const ANALYZER_NAV_ORIGIN = "build-farm";

/** The banner's headline when the page could not be read. */
const UNREAD_HEADLINE = "The Build Analyzer could not be read.";

/**
 * The Build Analyzer (BW.1, [#516](https://github.com/NobuData/ouroboros/issues/516)) — mockup
 * 18's frame in the shell's content pane: the head, *Run analysis now*'s progress, and the meta
 * strip. The cards below it (the duration chart, suggestions, drafted tickets, measurements) are
 * BW.2–BW.5's.
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
        </div>
      </main>
    </AnalyzerProvider>
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
