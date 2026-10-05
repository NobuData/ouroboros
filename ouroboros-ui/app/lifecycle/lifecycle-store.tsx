"use client";

import {
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

import type { WorkspaceLifecycle } from "@/app/api/settings-lifecycle";
import { onSummaryRefresh } from "@/app/dashboard/summary-refresh";
import { RECOVERY_PATH } from "@/app/paths";
import { EMPTY_POLL_SNAPSHOT, type Poll } from "@/app/poll";

import { type LifecyclePollOptions, createLifecyclePoll } from "./lifecycle-poll";

/**
 * Where the workspace stands, for everything in the signed-in shell
 * (BS.6, [#496](https://github.com/NobuData/ouroboros/issues/496)).
 *
 * One poll per shell (`app/lifecycle/lifecycle-poll.ts`), provided above the shell so the two
 * things that care read one answer: the **paused banner**, which is chrome on every screen, and
 * the **Danger zone card**, whose switch is the thing that changes it.
 *
 * ### A write's answer is shown at once
 *
 * Pause, resume and disconnect each answer with the lifecycle as it now stands. {@link
 * LifecycleHandle.apply} puts that answer in immediately — so the banner appears, or clears, on
 * the press rather than on the next poll — and asks the poll to read again, so what is shown is
 * the service's own word a moment later. An applied answer is dropped as soon as a poll answers
 * after it.
 *
 * ### A workspace pending deletion has one screen
 *
 * Every surface of it is frozen. The moment the poll says `pending_delete` — whoever deleted
 * it, in whichever tab — the browser leaves for the recovery screen.
 */

/** What the store hands a reader. */
export interface LifecycleHandle {
  /** The last lifecycle read, or `null` before the first answer — and outside a provider. */
  readonly lifecycle: WorkspaceLifecycle | null;
  /**
   * Put a write's answer in at once, so the banner moves without waiting for the poll.
   *
   * @param next The lifecycle the write answered with.
   */
  readonly apply: (next: WorkspaceLifecycle) => void;
  /**
   * Read again now.
   *
   * @returns Once the read has been asked for; the answer arrives through `lifecycle`.
   */
  readonly refresh: () => Promise<void>;
}

/** What a reader outside any provider gets: nothing known, and nothing to do. */
const DETACHED: LifecycleHandle = Object.freeze({
  lifecycle: null,
  apply: () => {},
  refresh: () => Promise.resolve(),
});

const LifecycleContext = createContext<LifecycleHandle>(DETACHED);

/** A write's answer, and when it was applied. */
interface Applied {
  readonly value: WorkspaceLifecycle;
  readonly at: number;
}

/** What {@link LifecycleProvider} takes. */
export interface LifecycleProviderProps {
  readonly children: ReactNode;
  /** The poll's wiring — read on the first render only. Tests pass a reader and a clock. */
  readonly poll?: LifecyclePollOptions;
  /**
   * How to leave for the recovery screen. Defaults to a full navigation: every piece of client
   * state on the page belongs to a workspace that is now frozen.
   */
  readonly leave?: (path: string) => void;
}

/**
 * Provide the lifecycle to the shell and everything in it.
 *
 * @param props See {@link LifecycleProviderProps}.
 * @returns The children, able to read {@link useLifecycle}.
 */
export function LifecycleProvider({ children, poll, leave }: LifecycleProviderProps) {
  // Once per mount, for `app/dashboard/summary-store.tsx`'s reason.
  const [store] = useState<Poll<WorkspaceLifecycle>>(() => createLifecyclePoll(poll));
  const [now] = useState(() => poll?.now ?? (() => Date.now()));
  const [applied, setApplied] = useState<Applied | null>(null);

  useEffect(() => {
    const stopPolling = store.start();
    // A workspace switch is a different workspace's lifecycle: the same signal the summary
    // poll re-reads on.
    const stopListening = onSummaryRefresh(() => store.refresh());

    return () => {
      stopListening();
      stopPolling();
    };
  }, [store]);

  const snapshot = useSyncExternalStore(store.subscribe, store.snapshot, () => EMPTY_POLL_SNAPSHOT);

  /** The applied answer while no poll has answered since; the poll's otherwise. */
  const lifecycle =
    applied !== null && (snapshot.updatedAt === null || snapshot.updatedAt < applied.at)
      ? applied.value
      : snapshot.data;

  const frozen = lifecycle?.state === "pending_delete";

  useEffect(() => {
    if (!frozen) return;

    (leave ?? ((path) => window.location.assign(path)))(RECOVERY_PATH);
  }, [frozen, leave]);

  const handle = useMemo<LifecycleHandle>(
    () => ({
      lifecycle,
      apply: (next) => {
        setApplied({ value: next, at: now() });
        store.refresh();
      },
      refresh: () => {
        store.refresh();
        return Promise.resolve();
      },
    }),
    [lifecycle, now, store],
  );

  return <LifecycleContext.Provider value={handle}>{children}</LifecycleContext.Provider>;
}

/**
 * Where the workspace stands, and the two things a writer does about it.
 *
 * @returns The handle. Outside a provider: no lifecycle, and `apply` and `refresh` that do
 *   nothing — so a card renders on its own.
 */
export function useLifecycle(): LifecycleHandle {
  return useContext(LifecycleContext);
}
