"use client";

import { type ReactNode, createContext, useCallback, useContext, useMemo, useState } from "react";

import { useKeyedPoll } from "@/app/issues/use-keyed-poll";
import { useFocusRepo } from "@/app/shell/focus-repo";

import { type StartOutcome, dismissSuggestion, startAnalysis } from "./analyzer-actions";
import { type AnalyzerPage, type AnalyzerPollOptions, analyzerUrl, createAnalyzerPoll } from "./analyzer-poll";
import type { AnalyzerReadings } from "./data";
import { type ChosenRepo, chooseRepo } from "./repo";
import type { LocalResolution } from "./suggestions-view";

/**
 * The Build Analyzer page's store (BW.1, [#516](https://github.com/NobuData/ouroboros/issues/516))
 * — one per screen, so the head, the progress panel and the meta strip read one page.
 *
 * The repository is the tenant chip's focus (else the first enabled one), and the page is a keyed
 * poll on it: choosing another repository in the chip moves the key, and the old repository's
 * answers are never drawn under the new one's name. *Run analysis now* is a server action whose
 * outcome is held per repository; a started run, or one that was already running, refreshes the
 * poll at once so the progress panel appears without waiting out an interval.
 *
 * Since BW.3 ([#518](https://github.com/NobuData/ouroboros/issues/518)) it also holds the page's
 * own resolutions of suggestions, laid over the poll's answer until the poll confirms them:
 *
 * ```
 * dismiss ──▶ row resolves at once ──▶ service accepts ──▶ the poll confirms it
 *                                  └─▶ service refuses ──▶ rolled back: open again, with why
 * ```
 *
 * A dismissal is **optimistic** — the row resolves before the service answers — and is rolled back
 * with the service's reason if it refuses. An apply and a spike draft are not: their dialogs wait
 * for the answer and then {@link AnalyzerView.resolveLocally | record} it, so the row does not sit
 * open between the answer and the next poll.
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
  /** Whether this person may dismiss a suggestion — `owner`, `admin` or `member`. */
  readonly mayDismiss: boolean;
  /** The page's own resolutions of suggestions, by suggestion, until the poll confirms them. */
  readonly local: ReadonlyMap<string, LocalResolution>;
  /** Why a dismissal was rolled back, by suggestion — the service's reason, as a sentence. */
  readonly refusals: ReadonlyMap<string, string>;
  /**
   * Dismiss a suggestion: its row resolves at once, and is put back open — with why — if the
   * service refuses.
   */
  readonly dismiss: (id: string, reason: string | null) => void;
  /** Record a resolution the service has answered — an apply, a spike's draft — and read again. */
  readonly resolveLocally: (id: string, resolution: LocalResolution) => void;
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
  mayDismiss: false,
  local: new Map(),
  refusals: new Map(),
  dismiss: () => {},
  resolveLocally: () => {},
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

  const [local, setLocal] = useState<ReadonlyMap<string, LocalResolution>>(() => new Map());
  const [refusals, setRefusals] = useState<ReadonlyMap<string, string>>(() => new Map());

  const resolveLocally = useCallback(
    (id: string, resolution: LocalResolution) => {
      setLocal((current) => new Map(current).set(id, resolution));
      setRefusals((current) => without(current, id));
      refresh();
    },
    [refresh],
  );

  const dismiss = useCallback(
    (id: string, reason: string | null) => {
      if (!readings.mayDismiss) return;

      // Optimistic: the row resolves now. The service's answer confirms it or rolls it back.
      // Dated by the page's own clock, so it agrees with every other date the page draws.
      setLocal((current) =>
        new Map(current).set(id, {
          status: "dismissed",
          at: now.toISOString(),
          reason,
          draftBatchId: null,
          windowDays: null,
        }),
      );
      setRefusals((current) => without(current, id));

      void dismissSuggestion(id, reason).then((answer) => {
        if (!answer.ok) {
          setLocal((current) => without(current, id));
          setRefusals((current) => new Map(current).set(id, answer.reason));
        }
        // Either way the page is read again: to confirm it, or to show who got there first.
        if (answer.ok || answer.resolved) refresh();
      });
    },
    [readings.mayDismiss, refresh, now],
  );

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
      mayDismiss: readings.mayDismiss,
      local,
      refusals,
      dismiss,
      resolveLocally,
    }),
    [
      chosen,
      page,
      failure,
      now,
      readings.mayAdminister,
      readings.mayDismiss,
      starting,
      outcome,
      start,
      refresh,
      local,
      refusals,
      dismiss,
      resolveLocally,
    ],
  );

  return <AnalyzerContext.Provider value={view}>{children}</AnalyzerContext.Provider>;
}

/**
 * A map without one of its keys.
 *
 * @param map The map.
 * @param key The key to leave out.
 * @returns The same map when it never held the key; a copy without it otherwise.
 */
function without<V>(map: ReadonlyMap<string, V>, key: string): ReadonlyMap<string, V> {
  if (!map.has(key)) return map;

  const copy = new Map(map);
  copy.delete(key);

  return copy;
}

/**
 * Read the analyzer store.
 *
 * @returns The view; outside a provider, one that knows nothing.
 */
export function useAnalyzer(): AnalyzerView {
  return useContext(AnalyzerContext);
}
