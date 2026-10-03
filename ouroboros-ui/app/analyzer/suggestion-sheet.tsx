"use client";

import { useId } from "react";

import type { AnalysisSuggestion, AnalysisSuggestionFinding } from "@/app/api/analyzer";
import { ShellOverlay } from "@/app/shell/overlay";
import { Eyebrow } from "@/app/ui";

import { useAnalyzer } from "./analyzer-store";
import { evidenceLink } from "./duration-view";
import { EvidenceList } from "./evidence-list";
import {
  DETAILS_LABEL,
  EVIDENCE_LABEL,
  FINDINGS_GONE,
  SHEET_HEADINGS,
  SPIKE_PILL,
  calibrationCell,
  calibrationHistory,
  calibrationLines,
  confidenceLines,
  confidenceText,
  evidenceNote,
  findingConfidence,
  findingFacts,
  findingHeading,
  impactLines,
  impactText,
  resolved,
  sheetEyebrow,
} from "./suggestions-view";

/**
 * The Details sheet behind a suggestion (BW.3,
 * [#518](https://github.com/NobuData/ouroboros/issues/518)) — everything the row's two numbers
 * stand on, in one place:
 *
 * - the **impact** with its computed basis — the method, the formula and its inputs, the raw
 *   estimate and the calibration that scaled it;
 * - the **calibration in effect** — whose factor it is, and every update that moved it;
 * - the **confidence** with its scoring inputs;
 * - the **findings** it was composed from, as their analyzers wrote them, each with its own
 *   confidence and its **evidence** — every reference a link to the surface it resolves on: the
 *   build farm, a pull request, the workflow studio, a loop's test results;
 * - how it was **resolved**, once it has been.
 *
 * **It follows the suggestion, not a snapshot of it.** The caller passes the live row, so a sheet
 * left open over a poll shows what the page shows, and closes by itself if an analysis no longer
 * has that suggestion. The modal contract is the shell overlay's.
 *
 * @param props.suggestion The suggestion whose **Details** was pressed, or `null`.
 * @param props.onClose Called when the reader dismisses the sheet.
 * @returns The sheet while a suggestion is given; nothing otherwise.
 */
export function SuggestionSheet({
  suggestion,
  onClose,
}: Readonly<{ suggestion: AnalysisSuggestion | null; onClose: () => void }>) {
  const label = suggestion === null ? DETAILS_LABEL : `${DETAILS_LABEL} · ${suggestion.title}`;

  return (
    <ShellOverlay label={label} onClose={onClose} open={suggestion !== null}>
      {suggestion !== null && <SuggestionDetails suggestion={suggestion} />}
    </ShellOverlay>
  );
}

/**
 * The sheet's content, for one suggestion.
 *
 * @param props.suggestion The suggestion.
 * @returns Its sections.
 */
function SuggestionDetails({ suggestion }: Readonly<{ suggestion: AnalysisSuggestion }>) {
  const { page } = useAnalyzer();
  const id = useId();
  const impact = impactText(suggestion.impact);
  const cell = calibrationCell(page?.suggestions.calibration ?? [], suggestion.impact);
  const history = cell === null ? [] : calibrationHistory(cell);
  const state = resolved(suggestion);

  return (
    <div className="analyzer-sd">
      <div>
        <Eyebrow>{sheetEyebrow(suggestion)}</Eyebrow>
        <h2 className="shell-overlay__title">{suggestion.title}</h2>
        <p className="analyzer-sd__evidence">
          <span className="analyzer-sd__heading">{EVIDENCE_LABEL}</span> {suggestion.evidenceLine}
        </p>
      </div>

      {state !== null && (
        <section aria-labelledby={`${id}-resolution`}>
          <h3 className="analyzer-sd__heading" id={`${id}-resolution`}>
            {SHEET_HEADINGS.resolution}
          </h3>
          <p className="analyzer-sd__line">
            {state.headline} — {state.note}
          </p>
          {state.reason !== null && <p className="analyzer-sd__quote">“{state.reason}”</p>}
        </section>
      )}

      <section aria-labelledby={`${id}-impact`}>
        <h3 className="analyzer-sd__heading" id={`${id}-impact`}>
          {SHEET_HEADINGS.impact}
        </h3>
        <p className="analyzer-sd__figure">
          {impact ?? "not quantified"}
          {suggestion.needsSpike && <span className="analyzer-sd__flag"> · {SPIKE_PILL}</span>}
        </p>
        <Lines lines={impactLines(suggestion)} />
      </section>

      <section aria-labelledby={`${id}-calibration`}>
        <h3 className="analyzer-sd__heading" id={`${id}-calibration`}>
          {SHEET_HEADINGS.calibration}
        </h3>
        <Lines lines={calibrationLines(suggestion.impact, cell)} />
        {history.length > 0 && (
          <>
            <h4 className="analyzer-sd__subheading">{SHEET_HEADINGS.history}</h4>
            <ol className="analyzer-sd__history">
              {history.map((entry) => (
                <li key={entry}>{entry}</li>
              ))}
            </ol>
          </>
        )}
      </section>

      <section aria-labelledby={`${id}-confidence`}>
        <h3 className="analyzer-sd__heading" id={`${id}-confidence`}>
          {SHEET_HEADINGS.confidence}
        </h3>
        <p className="analyzer-sd__figure">{confidenceText(suggestion.confidence)}</p>
        <Lines lines={confidenceLines(suggestion)} />
      </section>

      <section aria-labelledby={`${id}-findings`}>
        <h3 className="analyzer-sd__heading" id={`${id}-findings`}>
          {SHEET_HEADINGS.findings}
        </h3>
        {suggestion.findings.length === 0 ? (
          <p className="analyzer-sd__line">{FINDINGS_GONE}</p>
        ) : (
          <ul className="analyzer-sd__findings">
            {suggestion.findings.map((finding) => (
              <Finding finding={finding} key={finding.id} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * A run of sentences, one per line.
 *
 * @param props.lines The sentences.
 * @returns The lines.
 */
function Lines({ lines }: Readonly<{ lines: readonly string[] }>) {
  return (
    <>
      {lines.map((line) => (
        <p className="analyzer-sd__line" key={line}>
          {line}
        </p>
      ))}
    </>
  );
}

/**
 * One finding a suggestion cites: which analyzer wrote it about what, its own confidence and the
 * rule it was scored by, its data, and its evidence — each reference a link to where it resolves.
 *
 * @param props.finding The finding.
 * @returns The finding.
 */
function Finding({ finding }: Readonly<{ finding: AnalysisSuggestionFinding }>) {
  const facts = findingFacts(finding);
  const note = evidenceNote(finding);
  const method = finding.confidenceBasis.method;

  return (
    <li className="analyzer-sd__finding">
      <p className="analyzer-sd__subject">{findingHeading(finding)}</p>
      <p className="analyzer-sd__line">{findingConfidence(finding)}</p>
      {method !== null && <p className="analyzer-sd__mono">{method}</p>}
      {facts.length > 0 && (
        <dl className="analyzer-sd__facts">
          {facts.map(([label, value]) => (
            <div className="analyzer-sd__fact" key={label}>
              <dt className="analyzer-sd__key">{label}</dt>
              <dd className="analyzer-sd__val">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="analyzer-sd__subheading">{SHEET_HEADINGS.evidence}</p>
      <EvidenceList links={finding.evidence.map(evidenceLink)} />
      {note !== null && <p className="analyzer-sd__more">{note}</p>}
    </li>
  );
}
