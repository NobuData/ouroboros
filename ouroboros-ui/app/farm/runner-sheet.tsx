"use client";

import type { FarmRunner } from "@/app/api/farm";
import { ShellOverlay } from "@/app/shell/overlay";
import { Eyebrow } from "@/app/ui";

import {
  RUNNER_SHEET_CLOSE,
  RUNNER_SHEET_EYEBROW,
  runnerFacts,
  runnerSheetLabel,
} from "./runner-details";

/**
 * The runner details sheet — the menu's **View details** (AI.5,
 * [#260](https://github.com/NobuData/ouroboros/issues/260)): the telemetry snapshot, the
 * security mode, the agent version, and the certificate's serial and renewal date.
 *
 * Every fact and every judgement about it is `app/farm/runner-details.ts`'s; this lays them out
 * in the shell's one modal, in the job sheet's own list treatment (`app/farm/job-sheet.tsx`).
 *
 * **It follows the live page, not a snapshot taken when it opened.** The card hands it the
 * runner the current page has for the id it holds, so the CPU figure moves with the row behind
 * it — and when the machine leaves the fleet the sheet closes, rather than going on describing
 * a runner that is no longer there.
 *
 * **A warning is never only a colour.** A fact drawn in the warning or error ink carries a
 * sentence under it saying what is wrong — *bearer-token fallback*, *renewal is due*, *expired*.
 *
 * Every member may open it: it is a read, and the page it reads is one every member may read.
 *
 * @param props.runner The runner, as the current page serves it, or `null` to close the sheet.
 * @param props.nowMs The instant the page was confirmed current — what the ages count from.
 * @param props.onClose Dismiss.
 * @returns The sheet — unmounted while closed.
 */
export function RunnerSheet({
  runner,
  nowMs,
  onClose,
}: Readonly<{ runner: FarmRunner | null; nowMs: number; onClose: () => void }>) {
  const label = runner === null ? RUNNER_SHEET_EYEBROW : runnerSheetLabel(runner.name);

  return (
    <ShellOverlay label={label} onClose={onClose} open={runner !== null}>
      {runner !== null && (
        <>
          <div>
            <Eyebrow>{RUNNER_SHEET_EYEBROW}</Eyebrow>
            <h2 className="shell-overlay__title">{runner.name}</h2>
          </div>

          {runnerFacts(runner, nowMs, dayOf).map((group) => (
            <section
              aria-label={group.title}
              className="farm-runner-sheet__group"
              key={group.title}
            >
              <h3 className="farm-runner-sheet__heading">{group.title}</h3>
              <dl className="farm-job">
                {group.facts.map((fact) => (
                  <div className="farm-job__row" key={fact.term}>
                    <dt className="farm-job__term">{fact.term}</dt>
                    <dd className="farm-job__value">
                      <span className={valueClass(fact.tone, fact.mono)}>{fact.value}</span>
                      {fact.note !== undefined && (
                        <span className="farm-runner-sheet__note">{fact.note}</span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}

          <button className="shell-overlay__close" onClick={onClose} type="button">
            {RUNNER_SHEET_CLOSE}
          </button>
        </>
      )}
    </ShellOverlay>
  );
}

/**
 * How the sheet says a date: day, short month and year, in the reader's own locale.
 *
 * Passing `undefined` reads the browser's locale, and is also what makes this a function of its
 * input alone from a test's point of view (`app/dashboard/view.ts`'s `clockTime` argues the
 * same): a suite asserts against this rather than against a locale it would have to pin.
 *
 * @param atMs The instant, in epoch milliseconds.
 * @returns `30 Oct 2026`, as the locale writes it.
 */
export function dayOf(atMs: number): string {
  return new Date(atMs).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * The classes a fact's value wears.
 *
 * Literal class names, one per combination, because the farm's style suite reads this file for
 * the classes it renders and cannot see one assembled from parts.
 *
 * @param tone Whether the value is a warning or an error.
 * @param mono Whether it is an identifier.
 * @returns The class list.
 */
function valueClass(tone: "warn" | "err" | undefined, mono: boolean | undefined): string {
  if (tone === "err") return "farm-runner-sheet__value farm-runner-sheet__value--err";
  if (tone === "warn") return "farm-runner-sheet__value farm-runner-sheet__value--warn";
  if (mono === true) return "farm-runner-sheet__value farm-runner-sheet__value--mono";

  return "farm-runner-sheet__value";
}
