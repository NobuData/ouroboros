"use client";

import { type ReactNode, createContext, useCallback, useContext, useMemo, useState } from "react";

import { useKeyedPoll } from "@/app/issues/use-keyed-poll";
import { useFocusRepo } from "@/app/shell/focus-repo";

import { type StartOutcome, startAnalysis } from "./analyzer-actions";
import { type AnalyzerPage, type AnalyzerPollOptions, analyzerUrl, createAnalyzerPoll } from "./analyzer-poll";
import type { AnalyzerReadings } from "./data";
import { type ChosenRepo, chooseRepo } from "./repo";

/**
 * The Build Analyzer page's store (BW.1, [#516](https://github.com/NobuData/ouroboros/issues/516))
 * — one per screen, so the head, the progress panel and the meta strip read one page.
 *
 * The repository is the tenant chip's focus (else the first enabled one), and the page is a keyed
 * poll on it: choosing another repository in the chip moves the key, and the old repository's
 * answers are never drawn under the new one's name. *Run analysis now* is a server action whose
 * outcome is held per repository; a started run, or one that was already running, refreshes the
 * poll at once so the progress panel appears without waiting out an interval.
 */

/** A press's outcome, with the repository it was about. */
interface HeldOutcome {
  readonly repo: string;
  readonly outcome: StartOutcome;
}

/** What every region of the analyzer screen reads. */
export interface AnalyzerView {
  /** The repository analysed, or `null` when the workspace enables none (or could not be read). */
  readonly chosen: ChosenRepo | null;
  /** The chosen repository's page, or `null` before its first answer. */
  readonly page: AnalyzerPage | null;
  /** Why the latest read failed, as a sentence, or `null`. */
  readonly failure: string | null;
  /** The clock the strip's *ago* phrases are measured against. */
  readonly now: Date;
  /** Whether this person may run analyses and save the schedule. */
  readonly mayAdminister: boolean;
  /** Whether a press of *Run analysis now* is on its way. */
  readonly starting: boolean;
  /** How the last press for this repository went, or `null`. */
  readonly outcome: StartOutcome | null;
  /** *Run analysis now*. A second press while one is on its way does nothing. */
  readonly start: () => void;
  /** Read the page again now — after a save, or from the concurrent-run link. */
  readonly refresh: () => void;
}

/** What is read outside a provider: nothing is known, and pressing does nothing. */
const NO_ANALYZER: AnalyzerView = Object.freeze({
  chosen: null,
  page: null,
  failure: null,
  now: new Date(0),
  mayAdminister: false,
  starting: false,
  outcome: null,
  start: () => {},
  refresh: () => {},
});

const AnalyzerContext = createContext<AnalyzerView>(NO_ANALYZER);

/** How to provide the store. `poll` and `clock` are test seams; the screen passes the rest. */
export interface AnalyzerProviderProps {
  readonly readings: AnalyzerReadings;
  readonly children: ReactNode;
  readonly poll?: AnalyzerPollOptions;
}

/**
 * Provide the analyzer store.
 *
 * @param props.readings What the route read: the enabled repositories, the workspace and the role.
 * @param props.children The regions that read it.
 * @param props.poll Options for the poll — a stubbed reader, a fake clock.
 * @returns The provider.
 */
export function AnalyzerProvider({ readings, children, poll }: AnalyzerProviderProps) {
  const focus = useFocusRepo(readings.workspaceId);
  const { repos } = readings;
  const chosen = useMemo(() => chooseRepo(repos.ok ? repos.value : [], focus), [repos, focus]);
  const repo = chosen?.repo.ref ?? null;

  const { snapshot, refresh } = useKeyedPoll(repo === null ? null : analyzerUrl(repo), (url) =>
    createAnalyzerPoll(url, poll),
  );

  // An answer for another repository than the one chosen is never drawn under this one's name.
  const page = snapshot.data !== null && snapshot.data.repo === repo ? snapshot.data : null;
  const failure = readings.repos.ok ? snapshot.error : readings.repos.reason;
  const updatedAt = snapshot.updatedAt;
  const now = useMemo(() => new Date(updatedAt ?? readings.readAt), [updatedAt, readings.readAt]);

  const [starting, setStarting] = useState(false);
  const [held, setHeld] = useState<HeldOutcome | null>(null);
  const outcome = held !== null && held.repo === repo ? held.outcome : null;

  const start = useCallback(() => {
    if (starting || repo === null || !readings.mayAdminister) return;

    setStarting(true);
    void startAnalysis(repo).then((answer) => {
      setStarting(false);
      setHeld({ repo, outcome: answer });
      if (answer.kind !== "refused") refresh();
    });
  }, [starting, repo, readings.mayAdminister, refresh]);

  const view = useMemo<AnalyzerView>(
    () => ({
      chosen,
      page,
      failure,
      now,
      mayAdminister: readings.mayAdminister,
      starting,
      outcome,
      start,
      refresh,
    }),
    [chosen, page, failure, now, readings.mayAdminister, starting, outcome, start, refresh],
  );

  return <AnalyzerContext.Provider value={view}>{children}</AnalyzerContext.Provider>;
}

/**
 * Read the analyzer store.
 *
 * @returns The view; outside a provider, one that knows nothing.
 */
export function useAnalyzer(): AnalyzerView {
  return useContext(AnalyzerContext);
}
