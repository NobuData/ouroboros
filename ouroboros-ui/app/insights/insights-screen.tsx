import { BuildsCard } from "./builds-card";
import { CardBoundary } from "./card-boundary";
import type { InsightsReadings } from "./data";
import { CostCard } from "./cost-card";
import { DoraStrip } from "./dora-strip";
import { FlakyCard } from "./flaky-card";
import { InsightsBanner } from "./insights-banner";
import { InsightsGrid } from "./insights-grid";
import { InsightsHead } from "./insights-head";
import { InterventionsCard } from "./interventions-card";
import type { InsightsPollOptions } from "./insights-poll";
import { InsightsProvider } from "./insights-store";
import { KpiRow } from "./kpi-row";
import { LagBanner } from "./lag-banner";
import { PerformanceStrip } from "./performance-strip";
import { EffortCard, SuitesCard, TokensCard } from "./ranked-cards";
import { ScoreboardCard } from "./scoreboard-card";
import { StagesCard } from "./stages-card";
import { ThroughputCard } from "./throughput-card";

import { EFFORT_TITLE, INTERVENTIONS_TITLE, STAGES_TITLE, SUITES_TITLE, TOKENS_TITLE } from "./bars-view";
import { DORA_TITLE } from "./dora-view";
import { FLAKY_TITLE } from "./flaky-view";
import { BUILDS_TITLE, PERFORMANCE_TITLE } from "./performance-view";
import { SCOREBOARD_TITLE } from "./scoreboard-view";
import { COST_TITLE } from "./series-view";

import "./insights.css";

/** The KPI row's name while its boundary stands in for it. */
const KPI_LABEL = "Key figures";

/** The throughput card's name while its boundary stands in for it. */
const THROUGHPUT_LABEL = "Merged PRs per day";

/**
 * Insights (BK.2, [#443](https://github.com/NobuData/ouroboros/issues/443)) —
 * `docs/mockups/15-insights.html`'s page head and KPI row, the throughput and daily-cost cards
 * (#444), the interventions and stage-medians cards and the model scoreboard (#445), the flaky
 * card, the build & test strip and the secondary charts (#446), and the DORA strip, the digest
 * sheet and the states a working workspace never sees (#447).
 *
 * It renders **inside the app shell**, so it starts at its page head and contributes no chrome
 * of its own (`docs/DESIGN_SYSTEM_APP_SHELL.md` § 2): the shell's content pane is the scroll
 * container — the header and the sidebar do not move — and the sidebar's **Insights** entry is
 * how a reader arrives. The mockup's topbar is superseded by the shell.
 *
 * **One store, and every region under it.** The page is one payload for one range, provided once
 * here (`app/insights/insights-store.tsx`), so the range segment drives every region at once.
 *
 * The banners sit above the head, inside the frame, for the farm's reason: each is a fact about
 * the whole page, and a reader handed old data should be told before they read it — the read
 * banner when the latest read failed, the lag banner when the rollups it read are behind.
 *
 * **Every card sits under its own boundary** (`CardBoundary`), so one card that cannot draw its
 * part degrades to a designed error of its own width while the rest of the page keeps working.
 *
 * @param props.readings What the route read for the first paint, and for which range.
 * @param props.poll Test seams for the poll; the route passes none.
 * @returns The screen.
 */
export function InsightsScreen({
  readings,
  poll,
}: Readonly<{ readings: InsightsReadings; poll?: InsightsPollOptions }>) {
  return (
    <InsightsProvider poll={poll} readings={readings}>
      <main className="insights">
        <InsightsBanner />
        <LagBanner />
        <InsightsHead />
        <InsightsGrid>
          <CardBoundary className="insights-col--12" label={KPI_LABEL}>
            <KpiRow />
          </CardBoundary>
          <CardBoundary className="insights-col--8" label={THROUGHPUT_LABEL}>
            <ThroughputCard />
          </CardBoundary>
          <CardBoundary className="insights-col--4" label={INTERVENTIONS_TITLE}>
            <InterventionsCard mayRecategorize={readings.mayRecategorize} />
          </CardBoundary>
          <CardBoundary className="insights-col--4" label={STAGES_TITLE}>
            <StagesCard />
          </CardBoundary>
          <CardBoundary className="insights-col--8" label={SCOREBOARD_TITLE}>
            <ScoreboardCard />
          </CardBoundary>
          <CardBoundary className="insights-col--4" label={FLAKY_TITLE}>
            <FlakyCard playbook={readings.flakyPlaybook.ok ? readings.flakyPlaybook.value : undefined} />
          </CardBoundary>
          <CardBoundary className="insights-col--12" label={PERFORMANCE_TITLE}>
            <PerformanceStrip />
          </CardBoundary>
          <CardBoundary className="insights-col--4" label={BUILDS_TITLE}>
            <BuildsCard />
          </CardBoundary>
          <CardBoundary className="insights-col--4" label={SUITES_TITLE}>
            <SuitesCard />
          </CardBoundary>
          <CardBoundary className="insights-col--4" label={EFFORT_TITLE}>
            <EffortCard />
          </CardBoundary>
          <CardBoundary className="insights-col--6" label={TOKENS_TITLE}>
            <TokensCard />
          </CardBoundary>
          <CardBoundary className="insights-col--6" label={COST_TITLE}>
            <CostCard />
          </CardBoundary>
          <CardBoundary className="insights-col--12" label={DORA_TITLE}>
            <DoraStrip />
          </CardBoundary>
        </InsightsGrid>
      </main>
    </InsightsProvider>
  );
}
