import type { IssueEstimateDetail } from "@/app/api/backlog";
import { Chip, EffortChip, Eyebrow, Meter, Tag } from "@/app/ui";

import {
  BREAKDOWN_EYEBROW,
  FILES_LABEL,
  RISK_FILL,
  RISK_LABEL,
  RISK_TONE,
  ROW_LABELS,
  confidenceLabel,
  cycleLabel,
  filesNote,
  tokensLabel,
} from "./panel";
import { EFFORT_LABEL } from "./table";

/**
 * The mockup's **AI Work Breakdown**: the file list, the three `.breakdown-row` lines, the
 * regression-risk meter with its rationale, and the workflow tag beside the routed model
 * ([#119](https://github.com/NobuData/ouroboros/issues/119)).
 *
 * Every figure is the estimate's own, spelled by `app/issues/panel.ts`: `~180k` from
 * `estTokens`, `12–18 min` from the cycle range, the chip and `conf 92%` from the effort and
 * confidence the table's row already carries — through the same map, so the chip in the panel
 * is the chip in the row. The meter's hue and length are the level's; the word beside it says
 * the level in text, so a reader who cannot separate the hues is not left with a bar. The
 * workflow and the model are opaque strings, drawn as given (decisions K5 and K6).
 *
 * An estimate that names no file draws a sentence in the list's place — which sentence depends
 * on who wrote the estimate, and `panel.ts` says why.
 *
 * @param props.estimate The estimate in force.
 * @returns The section.
 */
export function PanelBreakdown({ estimate }: Readonly<{ estimate: IssueEstimateDetail }>) {
  const { breakdown, risk } = estimate;

  return (
    <section aria-labelledby={BREAKDOWN_ID}>
      <Eyebrow className="issues-panel__eyebrow">
        <span id={BREAKDOWN_ID}>{BREAKDOWN_EYEBROW}</span>
      </Eyebrow>

      <p className="issues-panel__caption">{FILES_LABEL}</p>
      {breakdown.files.length === 0 ? (
        <p className="issues-panel__note">{filesNote(estimate.trace.estimator)}</p>
      ) : (
        <ul className="issues-panel__files">
          {breakdown.files.map((file, index) => (
            <li key={`${index}:${file}`}>{file}</li>
          ))}
        </ul>
      )}

      <dl className="issues-panel__rows">
        <div className="issues-panel__row">
          <dt>{ROW_LABELS.tokens}</dt>
          <dd>{tokensLabel(breakdown.estTokens)}</dd>
        </div>
        <div className="issues-panel__row">
          <dt>{ROW_LABELS.cycle}</dt>
          <dd>{cycleLabel(breakdown.cycleMin, breakdown.cycleMax)}</dd>
        </div>
        <div className="issues-panel__row">
          <dt>{ROW_LABELS.effort}</dt>
          <dd>
            <EffortChip effort={EFFORT_LABEL[estimate.effort]} />
            <span className="issues-panel__conf">{confidenceLabel(estimate.confidence)}</span>
          </dd>
        </div>
      </dl>

      <div className="issues-panel__risk">
        <div className="issues-panel__risk-head">
          <span className="issues-panel__caption">{RISK_LABEL}</span>
          {/* The level in words, off the attribute the sheet colours it by. */}
          <span className="issues-panel__risk-level" data-risk={risk}>
            {risk}
          </span>
        </div>
        {/* Decoration for the word beside it, which already says the level — so no label. */}
        <Meter tone={RISK_TONE[risk]} value={RISK_FILL[risk]} />
        <p className="issues-panel__risk-note">{estimate.riskNote}</p>
      </div>

      <div className="issues-panel__routing">
        <Tag>{estimate.suggestedWorkflow}</Tag>
        <Chip mono tone="model">
          {estimate.routedModel}
        </Chip>
      </div>
    </section>
  );
}

/** The id the section's `aria-labelledby` points at — one panel per page, so one id. */
const BREAKDOWN_ID = "issue-panel-breakdown";
