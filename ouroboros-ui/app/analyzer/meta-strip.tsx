"use client";

import type { AnalysisRun } from "@/app/api/analyzer";
import { Card, Tag } from "@/app/ui";

import { useAnalyzer } from "./analyzer-store";
import { StripPopover } from "./strip-popover";
import {
  ANALYZERS_HEADING,
  BASIS_HEADING,
  NO_BASIS,
  NO_CONFIDENCE,
  NO_RUN_STRIP,
  SAMPLED_TAG,
  STRIP_LABELS,
  analyzerLines,
  basisLines,
  corpusLine,
  lastRunLine,
  missingCorpusLine,
  modelAnalyzers,
  samplingNotes,
} from "./view";

/**
 * Mockup 18's meta strip, with decision A3's truth (BW.1,
 * [#516](https://github.com/NobuData/ouroboros/issues/516)):
 *
 * ```
 * Corpus 1,284 builds · 312 loops · 90 days · 4.1M log lines · 62 HIL sessions [sampled]
 * Analyzed by [deterministic analyzers v1 ⓘ] · Last run 2h ago · 41 min · Confidence [high — … ⓘ]
 * ```
 *
 * - **Corpus** is the run's manifest, with a *sampled* tag (and what was sampled, at what rate,
 *   under which budget) whenever a source was read only in part — never counts presented as
 *   exhaustive when they were not.
 * - **Analyzed by** is the analyzer set's label, opening the analyzers and their versions; a model
 *   pill appears only beside an analyzer of kind `llm`.
 * - **Last run** is compute time; `$` only when `llmCostCents` is non-null (`lastRunLine`).
 * - **Confidence** is the run's note, opening the basis that produced it.
 *
 * @returns The strip.
 */
export function MetaStrip() {
  const { page, now } = useAnalyzer();
  const run = page?.run ?? null;

  return (
    <Card aria-busy={page === null || undefined} aria-label="Analysis summary" as="section" className="analyzer-strip">
      {page === null ? (
        // Unread: the strip's place, and no claim that nothing has run.
        <div aria-hidden="true" className="analyzer-strip__skeleton" />
      ) : run === null ? (
        <p className="analyzer-strip__empty">{NO_RUN_STRIP}</p>
      ) : (
        <StripRow now={now} run={run} />
      )}
    </Card>
  );
}

/**
 * The strip's one row, for a run.
 *
 * @param props.run The newest run.
 * @param props.now The clock.
 * @returns The four labelled slots.
 */
function StripRow({ run, now }: Readonly<{ run: AnalysisRun; now: Date }>) {
  const manifest = run.manifest;
  const sampled = manifest === null ? [] : samplingNotes(manifest);
  const models = modelAnalyzers(run.analyzerSet);
  const basis = manifest?.confidence ?? null;

  return (
    <dl className="analyzer-strip__row">
      <div className="analyzer-strip__slot">
        <dt className="analyzer-strip__label">{STRIP_LABELS.corpus}</dt>
        <dd className="analyzer-strip__value">
          {manifest === null ? missingCorpusLine(run) : corpusLine(manifest)}
          {sampled.length > 0 && (
            <Tag className="analyzer-strip__sampled" title={sampled.join("; ")}>
              <span>
                {SAMPLED_TAG}: {sampled.join("; ")}
              </span>
            </Tag>
          )}
        </dd>
      </div>
      <div className="analyzer-strip__slot">
        <dt className="analyzer-strip__label">{STRIP_LABELS.analyzedBy}</dt>
        <dd className="analyzer-strip__value">
          <StripPopover
            title={ANALYZERS_HEADING}
            trigger={
              <span>
                {run.analyzerSet.label} <span aria-hidden="true">ⓘ</span>
              </span>
            }
            triggerClassName="analyzer-strip__provenance"
          >
            <span className="analyzer-pop__list">
              {analyzerLines(run).map((line) => (
                <span className="analyzer-pop__item" key={line.id}>
                  <span className="analyzer-pop__mono">
                    {line.id} {line.version}
                  </span>{" "}
                  · {line.kind} · {line.outcome}
                </span>
              ))}
            </span>
          </StripPopover>
          {models.map((id) => (
            <span className="analyzer-strip__model" key={id}>
              {id}
            </span>
          ))}
        </dd>
      </div>
      <div className="analyzer-strip__slot">
        <dt className="analyzer-strip__label">{STRIP_LABELS.lastRun}</dt>
        <dd className="analyzer-strip__value">{lastRunLine(run, now)}</dd>
      </div>
      <div className="analyzer-strip__slot">
        <dt className="analyzer-strip__label">{STRIP_LABELS.confidence}</dt>
        <dd className="analyzer-strip__value">
          {run.confidenceNote === null ? (
            NO_CONFIDENCE
          ) : (
            <StripPopover
              title={BASIS_HEADING}
              trigger={
                <span>
                  {run.confidenceNote} <span aria-hidden="true">ⓘ</span>
                </span>
              }
              triggerClassName="analyzer-strip__confidence"
            >
              {basis === null ? (
                <span className="analyzer-pop__text">{NO_BASIS}</span>
              ) : (
                basisLines(basis).map((line) => (
                  <span className="analyzer-pop__text" key={line}>
                    {line}
                  </span>
                ))
              )}
            </StripPopover>
          )}
        </dd>
      </div>
    </dl>
  );
}
