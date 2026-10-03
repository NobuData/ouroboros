"use client";

import type { AnalysisRun, AnalyzerCorpus } from "@/app/api/analyzer";
import { Card, cx } from "@/app/ui";

import { useAnalyzer } from "./analyzer-store";
import { shownResultsLine } from "./state-view";
import {
  FOLLOW_RUNNING,
  PHASES,
  PROGRESS_HEADING,
  type PhaseState,
  alreadyRunningLine,
  analyzerOutcome,
  phaseState,
  runStatusLine,
} from "./view";

/** The progress panel's heading id — the anchor the concurrent-run state links to. */
export const PROGRESS_ANCHOR = "analysis-progress";

/** Each phase state's modifier — literal, so the style suite can see every class. */
const PHASE_CLASS: Readonly<Record<PhaseState, string>> = {
  done: "analyzer-progress__phase--done",
  current: "analyzer-progress__phase--current",
  waiting: "analyzer-progress__phase--waiting",
};

/** Each terminal status's modifier on the status line. */
const STATUS_CLASS: Readonly<Record<AnalysisRun["status"], string>> = {
  running: "analyzer-progress__status--running",
  complete: "analyzer-progress__status--complete",
  failed: "analyzer-progress__status--failed",
  budget_exceeded: "analyzer-progress__status--budget",
};

/**
 * *Run analysis now*'s real progress (BW.1, [#516](https://github.com/NobuData/ouroboros/issues/516))
 * — BV.1's phases (*assembling corpus → analyzing → composing suggestions*) with a tick per
 * analyzer, then how the run ended. A 41-minute analysis behind a spinner looks like a hang; this
 * panel shows where it is.
 *
 * Drawn while the newest run is running, after a press in this visit that started (or found) one,
 * and whenever the newest run
 * ended `failed` or `budget_exceeded` — two outcomes a reader must not mistake for each other, or
 * for a quiet success. A press refused because one is already running draws that state, with a
 * link to the running analysis's progress, and no second run is started. Any other refusal is an
 * alert.
 *
 * Under a run in flight, a failed run or a budget stop, the cards below still hold results — the
 * last finished analysis's, or what this one's finished analyzers found — and the panel says
 * which (BW.6, [#521](https://github.com/NobuData/ouroboros/issues/521); `shownResultsLine`).
 *
 * @returns The panel, or nothing.
 */
export function RunProgress() {
  const { page, outcome, now, chosen, refresh } = useAnalyzer();
  const run = page?.run ?? null;
  const repo = chosen?.repo.ref ?? "";

  const shown =
    run !== null &&
    (run.status === "running" ||
      run.status === "failed" ||
      run.status === "budget_exceeded" ||
      // A press that started a run, or found one going — never a refused one, whose panel would
      // otherwise show the previous run's ending as if the press had produced it.
      (outcome !== null && outcome.kind !== "refused"));

  return (
    <>
      {outcome?.kind === "running" && (
        <p className="analyzer-busy" role="status">
          {alreadyRunningLine(repo, outcome.startedAt, outcome.phase, now)}{" "}
          <a className="analyzer-busy__link" href={`#${PROGRESS_ANCHOR}`} onClick={() => refresh()}>
            {FOLLOW_RUNNING}
          </a>
        </p>
      )}
      {outcome?.kind === "refused" && (
        <p className="analyzer-refusal" role="alert">
          {outcome.reason}
        </p>
      )}
      {shown && page !== null && <ProgressCard corpus={page.corpus} now={now} run={run} />}
    </>
  );
}

/**
 * The panel for one run.
 *
 * @param props.run The run.
 * @param props.corpus The corpus state — which analysis the cards below were drawn from.
 * @param props.now The clock.
 * @returns The phases, the analyzers' ticks once analysis has begun, the status line, and — when
 *   the cards below are not simply this run's — whose results they are.
 */
function ProgressCard({ run, corpus, now }: Readonly<{ run: AnalysisRun; corpus: AnalyzerCorpus; now: Date }>) {
  const ticking = run.phase !== "assembling" || run.status !== "running";
  const below = shownResultsLine(run, corpus, now);

  return (
    <Card aria-labelledby={PROGRESS_ANCHOR} as="section" className="analyzer-progress">
      <h2 className="analyzer-progress__title" id={PROGRESS_ANCHOR}>
        {PROGRESS_HEADING}
      </h2>
      <ol className="analyzer-progress__phases">
        {PHASES.map((phase) => {
          const state = phaseState(phase.id, run);

          return (
            <li
              aria-current={state === "current" ? "step" : undefined}
              className={cx("analyzer-progress__phase", PHASE_CLASS[state])}
              key={phase.id}
            >
              {phase.label}
            </li>
          );
        })}
      </ol>
      {ticking && (
        <ul aria-label="Analyzers" className="analyzer-progress__analyzers">
          {run.progress.analyzers.map((entry) => (
            <li key={entry.id}>
              <span className="analyzer-progress__id">{entry.id}</span> {analyzerOutcome(entry)}
            </li>
          ))}
        </ul>
      )}
      <p className={cx("analyzer-progress__status", STATUS_CLASS[run.status])} role="status">
        {runStatusLine(run)}
      </p>
      {below !== null && <p className="analyzer-progress__below">{below}</p>}
    </Card>
  );
}
