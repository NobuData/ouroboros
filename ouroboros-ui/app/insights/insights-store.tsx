"use client";

import { useRouter } from "next/navigation";
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useTransition,
} from "react";

import type { InsightsPage, InsightsRange } from "@/app/api/insights";
import type { Reading } from "@/app/api/reading";
import { useKeyedPoll } from "@/app/issues/use-keyed-poll";
import { INSIGHTS_PATH } from "@/app/paths";
import type { PollSnapshot } from "@/app/poll";

import type { InsightsReadings } from "./data";
import { type InsightsPollOptions, createInsightsPoll, insightsUrl } from "./insights-poll";
import { rangeSearch } from "./range";

/**
 * Where the insights poll and the range meet React — one store per screen, read by every region
 * of it (BK.2, [#443](https://github.com/NobuData/ouroboros/issues/443)).
 *
 * ### The range drives everything below it
 *
 * The range is chosen here and nowhere else, so every region that reads the page reads it for the
 * same window: switching is **one** new page, and the head, the KPI row and every card the later
 * BK issues mount (#444–#447) re-render from it together. A press changes the chosen range at
 * once — the segment answers the press — and then writes the address with `router.replace`
 * inside a transition, so the server renders the new range's first paint and `pending` is true
 * until it has. The address is the source of truth: a back-button press is a new `readings.range`
 * and the chosen range follows it.
 *
 * ### One loop per range
 *
 * The poll is keyed on the range's address (`app/issues/use-keyed-poll.ts`), so a press replaces
 * the loop and an answer for the old range is never drawn over the new one. Until the new loop or
 * the new server render answers, the page on screen is the last one — marked `pending` rather
 * than blanked.
 *
 * ### A failure keeps the page
 *
 * As the farm's store does: a failed ask leaves the last page on screen with `failure` beside it.
 */

/** What every region of the insights screen reads. */
export interface InsightsView {
  /** The range the reader chose — what the segment shows as pressed. */
  readonly range: InsightsRange;
  /**
   * The latest page there is — the poll's, else the server's — or `null` when none was read. Its
   * own `range` is the window its figures cover, which differs from {@link InsightsView.range}
   * only while {@link InsightsView.pending}.
   */
  readonly page: InsightsPage | null;
  /** Whether the page on screen is for another range than the one chosen — a switch in flight. */
  readonly pending: boolean;
  /** Why the latest attempt failed, as a sentence for a person, or `null` when it succeeded. */
  readonly failure: string | null;
  /** When {@link InsightsView.page} was last confirmed current, or `null` with no page. */
  readonly dataAt: number | null;
  /** Whether a {@link InsightsView.retry} is in flight. */
  readonly retrying: boolean;
  /** Ask now. A second press while one is in flight does nothing. */
  readonly retry: () => void;
  /** Choose a range: the segment's press. */
  readonly select: (range: InsightsRange) => void;
}

/** What is read outside a provider: nothing is known, and pressing does nothing. */
const NO_INSIGHTS: InsightsView = Object.freeze({
  range: "30d",
  page: null,
  pending: false,
  failure: null,
  dataAt: null,
  retrying: false,
  retry: () => {},
  select: () => {},
});

/** Defaulted, so a region rendered outside the provider — in a test — reads *nothing yet*. */
const InsightsContext = createContext<InsightsView>(NO_INSIGHTS);

/**
 * What the screen draws, from what the server read and what the poll has heard since.
 *
 * Pure and exported so the precedence is a unit test: the poll's page wins over the server's,
 * the poll's failure wins over the server's, and the server's failure stands only until the poll
 * has an answer of its own.
 *
 * @param initial The server's read.
 * @param readAt When the server made it.
 * @param snapshot The poll's state, for the chosen range.
 * @returns The page, the failure and the page's age.
 */
export function insightsReading(
  initial: Reading<InsightsPage>,
  readAt: number,
  snapshot: PollSnapshot<InsightsPage>,
): Pick<InsightsView, "page" | "failure" | "dataAt"> {
  if (snapshot.data !== null) {
    return { page: snapshot.data, failure: snapshot.error, dataAt: snapshot.updatedAt };
  }

  return initial.ok
    ? { page: initial.value, failure: snapshot.error, dataAt: readAt }
    : { page: null, failure: snapshot.error ?? initial.reason, dataAt: null };
}

/** How to provide the store. `poll` is a test seam; the screen passes the rest. */
export interface InsightsProviderProps {
  /** What the route read for the first paint, and for which range. */
  readonly readings: InsightsReadings;
  /** The regions that read it. */
  readonly children: ReactNode;
  /** Options for the polls this provider builds — a stubbed reader, a fake clock. */
  readonly poll?: InsightsPollOptions;
}

/**
 * Hold the chosen range, poll it, and put the page within reach of everything below.
 *
 * @param props The server's read, the regions to wrap, and the test seam.
 * @returns The regions, wrapped.
 */
export function InsightsProvider({ readings, children, poll }: InsightsProviderProps) {
  const router = useRouter();
  const [navigating, startNavigation] = useTransition();
  const [range, setRange] = useState<InsightsRange>(readings.range);
  const [heldRange, setHeldRange] = useState<InsightsRange>(readings.range);

  // The address moved under the screen — a back-button press, a link — so the chosen range
  // follows it. Compared during render, React's *adjusting state when a prop changes*.
  if (heldRange !== readings.range) {
    setHeldRange(readings.range);
    setRange(readings.range);
  }

  const { snapshot, refresh } = useKeyedPoll(insightsUrl(range), (url) =>
    createInsightsPoll(url, poll),
  );

  const { page, failure, dataAt } = insightsReading(readings.page, readings.readAt, snapshot);
  // The page on screen is another range's until the new range's first answer lands.
  const pending = navigating || (page !== null && page.range !== range);

  /** The snapshot a retry was pressed against — *in flight* is *it has not moved since*. */
  const [asked, setAsked] = useState<PollSnapshot<InsightsPage> | null>(null);
  const retrying = asked === snapshot;

  const retry = useCallback(() => {
    if (asked === snapshot) return;

    setAsked(snapshot);
    refresh();
  }, [asked, snapshot, refresh]);

  const select = useCallback(
    (next: InsightsRange) => {
      if (next === range) return;

      setRange(next);
      startNavigation(() => {
        router.replace(`${INSIGHTS_PATH}${rangeSearch(next)}`, { scroll: false });
      });
    },
    [range, router],
  );

  const view = useMemo<InsightsView>(
    () => ({ range, page, pending, failure, dataAt, retrying, retry, select }),
    [range, page, pending, failure, dataAt, retrying, retry, select],
  );

  return <InsightsContext.Provider value={view}>{children}</InsightsContext.Provider>;
}

/**
 * The insights page, as fresh as the last poll left it, for the chosen range.
 *
 * @returns See {@link InsightsView}.
 */
export function useInsights(): InsightsView {
  return useContext(InsightsContext);
}
