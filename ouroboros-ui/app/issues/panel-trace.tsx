import type { IssueEstimateDetail } from "@/app/api/backlog";

import { TRACE_LABEL, provenanceLine, signalsLine } from "./panel";

/**
 * The mockup's collapsible `.trace` — **Estimation trace**, with real provenance
 * ([#119](https://github.com/NobuData/ouroboros/issues/119)).
 *
 * A native `<details>`, open as the mockup draws it, so the keyboard toggles it for free and a
 * screen reader hears a disclosure rather than a styled div. What is inside is built from the
 * trace's own fields and nothing else — decision **K10**: *sized by heuristic-v0 · 2m ago* over
 * *signals: none recorded by this estimator*, never the mockup's model name and never its
 * knowledge signals, which the estimator that produces them will write when it exists.
 *
 * A `needs_human` issue opens its trace with the reason a person is deciding, in the error hue
 * — the estimate's own confidence under the floor, or that no estimate was produced.
 *
 * @param props.estimate The estimate in force.
 * @param props.lead The line to open with, or `null` — `app/issues/panel.ts`'s
 *   `needsHumanLine` for an issue sent to a person.
 * @param props.now What time it is, in whole seconds since the epoch — the reader's clock, so
 *   *2m ago* moves.
 * @returns The disclosure.
 */
export function PanelTrace({
  estimate,
  lead,
  now,
}: Readonly<{ estimate: IssueEstimateDetail; lead: string | null; now: number }>) {
  return (
    <details className="issues-panel__trace" open>
      <summary className="issues-panel__trace-head">{TRACE_LABEL}</summary>
      {lead !== null && (
        <p className="issues-panel__trace-line issues-panel__trace-line--err">{lead}</p>
      )}
      <p className="issues-panel__trace-line">
        {provenanceLine(estimate.trace, estimate.version, now)}
      </p>
      <p className="issues-panel__trace-line">{signalsLine(estimate.trace.signals)}</p>
    </details>
  );
}
