"use client";

import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

import type { FarmPage } from "@/app/api/farm";
import type { Reading } from "@/app/api/reading";
import { onSummaryRefresh } from "@/app/dashboard/summary-refresh";
import { EMPTY_POLL_SNAPSHOT, type Poll, type PollSnapshot } from "@/app/poll";

import { type FarmPollOptions, createFarmPoll } from "./farm-poll";

/**
 * Where the farm's poll meets React — one store, provided once per screen, read by every region
 * of it (AI.1, [#256](https://github.com/NobuData/ouroboros/issues/256)).
 *
 * `app/farm/farm-poll.ts` is the loop and knows nothing about rendering; this is the provider
 * that starts one and the hook that reads it, the shape `app/dashboard/summary-store.tsx` set
 * out. It is provided at the farm screen rather than at the `(app)` layout because nothing
 * outside this screen reads the farm — and it is a provider at all, rather than a hook each
 * region calls, because **the page is one observation**: the stat row's `4/5` counts the rows of
 * the runners table beside it (AI.2, #257), and two regions polling separately would be two
 * answers ten seconds apart disagreeing on one screen. One poll, exactly one request per
 * interval, however many regions subscribe.
 *
 * ### The first answer is the server's
 *
 * The route reads the page for the first paint (`app/farm/data.ts`) and hands it here as
 * `initial`. What every reader gets is the **latest page there is** — the poll's once it has
 * one, the server's until then — so the screen arrives rendered and then stays fresh, and the
 * server render and the browser's first pass agree by construction: the poll does not start
 * until an effect, and effects do not run during hydration.
 *
 * ### A failure keeps the page
 *
 * `PollSnapshot.data` survives a failed ask, so a farm that stops answering leaves the last
 * page on screen with {@link FarmView.failure} beside it — a slightly old truth under a banner
 * rather than no truth at all (`app/farm/farm-banner.tsx`). A first paint that failed has no
 * page to keep; it carries the server's reason until the poll's first success clears it.
 *
 * ### The workspace switch
 *
 * The farm is scoped by the session's active organization, so a switch makes every figure on
 * screen another workspace's. The shell publishes that moment through
 * `app/dashboard/summary-refresh.ts`, and this listens for it as every poll does.
 */

/** What every region of the farm screen reads. */
export interface FarmView {
  /** The latest page there is — the poll's, else the server's — or `null` when none was read. */
  readonly page: FarmPage | null;
  /**
   * Why the latest attempt failed, as a sentence for a person, or `null` when it succeeded.
   * Present beside a {@link FarmView.page} means *stale*; present without one means *unread*.
   */
  readonly failure: string | null;
  /**
   * When {@link FarmView.page} was last confirmed current, in epoch milliseconds, or `null`
   * when there is no page.
   */
  readonly dataAt: number | null;
  /** Whether a {@link FarmView.retry} is in flight. */
  readonly retrying: boolean;
  /** Ask now. A second press while one is in flight does nothing. */
  readonly retry: () => void;
  /**
   * Ask now **because something was just written** (AI.4, #259). Unlike {@link FarmView.retry} it
   * is not a control's press and has no *in flight* to report: it supersedes whatever ask is in
   * the air (`app/poll.ts`), so the next page to land is one read after the write.
   */
  readonly refresh: () => void;
}

/** What is read outside a provider: nothing is known, and asking does nothing. */
const NO_FARM: FarmView = Object.freeze({
  page: null,
  failure: null,
  dataAt: null,
  retrying: false,
  retry: () => {},
  refresh: () => {},
});

/**
 * Defaulted rather than left `undefined`, so a region rendered outside the provider — in a
 * test — reads *nothing is known yet* instead of throwing.
 */
const FarmContext = createContext<FarmView>(NO_FARM);

/** How to provide the store. `poll` is a test seam; the screen passes the rest. */
export interface FarmProviderProps {
  /** The page as the route read it, or why it could not. */
  readonly initial: Reading<FarmPage>;
  /** When the route read it, in epoch milliseconds. */
  readonly readAt: number;
  /** The regions that read it. */
  readonly children: ReactNode;
  /**
   * Options for the poll this provider builds — a stubbed reader, a fake clock. Read once, on
   * the render that builds the poll; changing them afterwards changes nothing.
   */
  readonly poll?: FarmPollOptions;
}

/**
 * What the screen draws, from what the server read and what the poll has heard since.
 *
 * Pure, and exported so the precedence is a unit test rather than something inferred from a
 * rendered page: the poll's page wins over the server's, the poll's failure wins over the
 * server's, and the server's failure stands only until the poll has an answer of its own.
 *
 * @param initial The server's read.
 * @param readAt When the server made it.
 * @param snapshot The poll's state.
 * @returns The page, the failure and the page's age — everything in {@link FarmView} that is
 *   data.
 */
export function farmReading(
  initial: Reading<FarmPage>,
  readAt: number,
  snapshot: PollSnapshot<FarmPage>,
): Pick<FarmView, "page" | "failure" | "dataAt"> {
  if (snapshot.data !== null) {
    return { page: snapshot.data, failure: snapshot.error, dataAt: snapshot.updatedAt };
  }

  // The poll has no page of its own yet: either it has not answered, or every answer so far
  // failed. What is on screen is the server's, and the poll's failure — the more recent of the
  // two — is the one to report.
  return initial.ok
    ? { page: initial.value, failure: snapshot.error, dataAt: readAt }
    : { page: null, failure: snapshot.error ?? initial.reason, dataAt: null };
}

/**
 * Start one poll and put the farm within reach of everything below.
 *
 * @param props The server's read, the regions to wrap, and the test seam.
 * @returns The regions, wrapped.
 */
export function FarmProvider({ initial, readAt, children, poll }: FarmProviderProps) {
  // Built once per mount, by a lazy initialiser — `app/dashboard/summary-store.tsx` says why a
  // `useMemo` over the prop would abandon the interval the server asked for.
  const [store] = useState<Poll<FarmPage>>(() => createFarmPoll(poll));

  useEffect(() => {
    const stopPolling = store.start();
    const stopListening = onSummaryRefresh(() => store.refresh());

    return () => {
      stopListening();
      stopPolling();
    };
  }, [store]);

  const snapshot = useSyncExternalStore<PollSnapshot<FarmPage>>(
    store.subscribe,
    store.snapshot,
    // The server has no poll and nothing to report. Identity-stable, as the hook requires.
    () => EMPTY_POLL_SNAPSHOT,
  );

  /**
   * The snapshot a retry was pressed against. Every answer — a failure included — publishes a
   * new snapshot, so *in flight* is exactly *the snapshot has not moved since the press*, and
   * nothing has to be told when the ask comes back.
   */
  const [asked, setAsked] = useState<PollSnapshot<FarmPage> | null>(null);
  const retrying = asked === snapshot;

  const retry = useCallback(() => {
    // The banner never makes its control inert; this is the guard that keeps a second press
    // from starting a second ask over the first.
    if (asked === snapshot) return;

    setAsked(snapshot);
    store.refresh();
  }, [asked, snapshot, store]);

  const refresh = useCallback(() => store.refresh(), [store]);

  const view = useMemo<FarmView>(
    () => ({ ...farmReading(initial, readAt, snapshot), retrying, retry, refresh }),
    [initial, readAt, snapshot, retrying, retry, refresh],
  );

  return <FarmContext.Provider value={view}>{children}</FarmContext.Provider>;
}

/**
 * The farm, as fresh as the last poll left it.
 *
 * @returns The page, the failure beside it, and the retry — see {@link FarmView}.
 */
export function useFarm(): FarmView {
  return useContext(FarmContext);
}
