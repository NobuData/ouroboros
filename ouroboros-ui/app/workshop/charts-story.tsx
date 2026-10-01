import { HBars, Sparkline, StackedVBars, TimeSeries } from "@/app/charts";
import { moneyOfCents, percentOf, spanOfMs, tokenCount } from "@/app/format";
import { Card, CardHead, Eyebrow, Tag } from "@/app/ui";

import {
  BUILDS_NOTE_INDEX,
  BUILDS_PER_DAY,
  COST_BUDGET_CENTS,
  COST_SPIKE_INDEX,
  DAILY_COST,
  EFFORT_LADDER_MS,
  INTERVENTION_CAUSES,
  SPARKS,
  STAGE_MEDIANS_MS,
  THROUGHPUT,
  TOKENS_BY_STAGE,
} from "./chart-fixtures";

import "./workshop.css";

/**
 * The chart primitives story ([#442](https://github.com/NobuData/ouroboros/issues/442)) —
 * every Insights chart shape, over mockup 15's own data, on one page.
 *
 * It is the fixture the screenshot suite photographs in both palettes and at the 125 % font
 * scale (`tests/e2e/specs/charts.spec.ts`), and the reference #444–#447 build their cards
 * against. Beyond the mockup's two time series it draws the cases the mockup does not —
 * guide only, annotation only, a single point and an empty series — because those are the
 * acceptance list's and nowhere else in the product shows them yet.
 *
 * @returns The story.
 */
export function ChartsStory() {
  const cost = DAILY_COST.at(-1)!.value;
  const spike = DAILY_COST[COST_SPIKE_INDEX]!.value;

  return (
    <div className="wk-page">
      <header className="wk-head">
        <Eyebrow>Component workshop</Eyebrow>
        <h1 className="wk-title">Chart primitives</h1>
        <p className="wk-sub">
          The four shapes behind mockup 15 — time series, bar rows, sparklines and stacked bars —
          drawn from tokens, in hand-written SVG and CSS.
        </p>
      </header>

      <section aria-labelledby="time-series" className="wk-section">
        <h2 className="wk-heading" id="time-series">
          Time series
        </h2>
        <div className="wk-charts">
          <Card className="wk-chart wk-chart--wide">
            <CardHead title="Merged PRs per day · 30d" trailing={<Tag>Jul 10 – Aug 8</Tag>} />
            <TimeSeries
              label="Merged PRs per day, last 30 days, trending up to 6 per day"
              points={THROUGHPUT}
            />
          </Card>

          <Card className="wk-chart wk-chart--wide">
            <CardHead title="Daily cost · all providers" trailing={<Tag>Jul 10 – Aug 8</Tag>} />
            <TimeSeries
              label={`Daily cost across all providers, last 30 days, rising to ${moneyOfCents(cost)} with one ${moneyOfCents(spike)} spike`}
              points={DAILY_COST}
              formatValue={moneyOfCents}
              guide={{ value: COST_BUDGET_CENTS, label: "$20 budget" }}
              annotation={{
                index: COST_SPIKE_INDEX,
                label: `${moneyOfCents(spike)} — Zephyr migration spike`,
              }}
              gridlines={2}
              width={560}
              height={140}
              size="half"
            />
          </Card>

          <Card className="wk-chart">
            <CardHead title="Guide only" />
            <TimeSeries
              label={`Daily cost, last 30 days, ending at ${moneyOfCents(cost)} under a $20 budget`}
              points={DAILY_COST}
              formatValue={moneyOfCents}
              guide={{ value: COST_BUDGET_CENTS, label: "$20 budget" }}
              width={560}
              height={140}
              size="half"
            />
          </Card>

          <Card className="wk-chart">
            <CardHead title="Annotation only" />
            <TimeSeries
              label={`Daily cost, last 30 days, ending at ${moneyOfCents(cost)} with one spike`}
              points={DAILY_COST}
              formatValue={moneyOfCents}
              annotation={{ index: COST_SPIKE_INDEX, label: `${moneyOfCents(spike)} — spike` }}
              width={560}
              height={140}
              size="half"
            />
          </Card>

          <Card className="wk-chart">
            <CardHead title="A single point" />
            <TimeSeries
              label="Merged PRs on Aug 8: 6"
              points={THROUGHPUT.slice(-1)}
              width={560}
              height={140}
              size="half"
            />
          </Card>

          <Card className="wk-chart">
            <CardHead title="No data" />
            <TimeSeries
              label="Merged PRs per day: no data yet"
              points={[]}
              width={560}
              height={140}
              size="half"
            />
          </Card>
        </div>
      </section>

      <section aria-labelledby="bar-rows" className="wk-section">
        <h2 className="wk-heading" id="bar-rows">
          Bar rows
        </h2>
        <div className="wk-charts">
          <Card className="wk-chart">
            <CardHead title="Where loops still need humans" trailing={<Tag>30d · 20 total</Tag>} />
            <HBars label="Interventions by cause, 30 days, 20 total" rows={INTERVENTION_CAUSES} />
          </Card>

          <Card className="wk-chart">
            <CardHead title="Cycle time by stage · median" trailing={<Tag>30d</Tag>} />
            <HBars
              label="Median cycle time by stage, Implement longest"
              rows={STAGE_MEDIANS_MS.map(({ name, ms }) => ({
                name,
                value: ms,
                display: spanOfMs(ms),
                emphasis: name === "Implement" ? "top" : "dim",
              }))}
            />
          </Card>

          <Card className="wk-chart">
            <CardHead title="Time to completion by effort" trailing={<Tag>median · issue→merge</Tag>} />
            <HBars
              label="Median time from issue to merge by effort, XL longest"
              rows={EFFORT_LADDER_MS.map(({ effort, ms }, index) => ({
                name: effort,
                effort,
                value: ms,
                display: spanOfMs(ms),
                emphasis: index === 4 ? "top" : index < 2 ? "dim" : undefined,
              }))}
            />
          </Card>

          <Card className="wk-chart">
            <CardHead title="Tokens by stage" trailing={<Tag>30d</Tag>} />
            <HBars
              label="Tokens by stage, 30 days, Implement highest"
              hue="model"
              rows={TOKENS_BY_STAGE.map(({ name, tokens }, index) => ({
                name,
                value: tokens,
                display: tokenCount(tokens),
                emphasis: index === 0 ? "top" : index >= 4 ? "dim" : undefined,
              }))}
            />
          </Card>
        </div>
      </section>

      <section aria-labelledby="sparklines" className="wk-section">
        <h2 className="wk-heading" id="sparklines">
          Sparklines
        </h2>
        <Card className="wk-chart">
          <ul className="wk-sparks">
            <li className="wk-spark-row">
              <Sparkline values={SPARKS.fixed} dim />
              <span>{percentOf(0)}</span>
            </li>
            <li className="wk-spark-row">
              <Sparkline values={SPARKS.rising} />
              <span>{percentOf(0.041)}</span>
            </li>
            <li className="wk-spark-row">
              <Sparkline values={SPARKS.watching} />
              <span>{percentOf(0.012)}</span>
            </li>
            <li className="wk-spark-row">
              <Sparkline
                values={SPARKS.deploys}
                label="Deploy frequency over 8 weeks, rising to 4.2 per day"
              />
            </li>
          </ul>
        </Card>
      </section>

      <section aria-labelledby="stacked-bars" className="wk-section">
        <h2 className="wk-heading" id="stacked-bars">
          Stacked bars
        </h2>
        <Card className="wk-chart">
          <CardHead title="Builds per day" trailing={<Tag>30d</Tag>} />
          <StackedVBars
            label="Builds per day for 30 days, succeeded versus failed, failures clustered on eight days"
            days={BUILDS_PER_DAY}
            note={{ index: BUILDS_NOTE_INDEX, text: "18 · 2 failed" }}
          />
        </Card>
      </section>
    </div>
  );
}
