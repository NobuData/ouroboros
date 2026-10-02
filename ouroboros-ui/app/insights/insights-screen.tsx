import { BuildsCard } from "./builds-card";
import type { InsightsReadings } from "./data";
import { CostCard } from "./cost-card";
import { FlakyCard } from "./flaky-card";
import { InsightsBanner } from "./insights-banner";
import { InsightsGrid } from "./insights-grid";
import { InsightsHead } from "./insights-head";
import { InterventionsCard } from "./interventions-card";
import type { InsightsPollOptions } from "./insights-poll";
import { InsightsProvider } from "./insights-store";
import { KpiRow } from "./kpi-row";
import { PerformanceStrip } from "./performance-strip";
import { EffortCard, SuitesCard, TokensCard } from "./ranked-cards";
import { ScoreboardCard } from "./scoreboard-card";
import { StagesCard } from "./stages-card";
import { ThroughputCard } from "./throughput-card";

import "./insights.css";

/**
 * Insights (BK.2, [#443](https://github.com/NobuData/ouroboros/issues/443)) —
 * `docs/mockups/15-insights.html`'s page head and KPI row, the throughput and daily-cost cards
 * (#444), the interventions and stage-medians cards and the model scoreboard (#445), the flaky
 * card, the build & test strip and the secondary charts (#446), and the frame the rest of the
 * page arrives in (#447).
 *
 * It renders **inside the app shell**, so it starts at its page head and contributes no chrome
 * of its own (`docs/DESIGN_SYSTEM_APP_SHELL.md` § 2): the shell's content pane is the scroll
 * container — the header and the sidebar do not move — and the sidebar's **Insights** entry is
 * how a reader arrives. The mockup's topbar is superseded by the shell.
 *
 * **One store, and every region under it.** The page is one payload for one range, provided once
 * here (`app/insights/insights-store.tsx`), so the range segment drives every region at once.
 *
 * The banner sits above the head, inside the frame, for the farm's reason: it is a fact about the
 * whole page, and a reader handed old data should be told before they read it.
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
        <InsightsHead />
        <InsightsGrid>
          <KpiRow />
          <ThroughputCard />
          <InterventionsCard mayRecategorize={readings.mayRecategorize} />
          <StagesCard />
          <ScoreboardCard />
          <FlakyCard playbook={readings.flakyPlaybook.ok ? readings.flakyPlaybook.value : undefined} />
          <PerformanceStrip />
          <BuildsCard />
          <SuitesCard />
          <EffortCard />
          <TokensCard />
          <CostCard />
        </InsightsGrid>
      </main>
    </InsightsProvider>
  );
}
