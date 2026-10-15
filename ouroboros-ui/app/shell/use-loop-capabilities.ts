"use client";

/**
 * `useLoopCapabilities()` — what this deployment can run for real, for any surface that would
 * otherwise assert it (DG.3, [#1301](https://github.com/NobuData/ouroboros/issues/1301)).
 */

import { useEffect, useSyncExternalStore } from "react";

import type { LoopCapabilities } from "@/app/api/loop";
import { EMPTY_POLL_SNAPSHOT, type PollSnapshot } from "@/app/poll";
import { retainLoopCapabilities, sharedLoopCapabilitiesPoll } from "./loop-capabilities";

/** What a surface reads. */
export interface LoopCapabilitiesState {
  /** The report, or null until the first answer (and while it cannot be read). */
  readonly capabilities: LoopCapabilities | null;
  /** Why it could not be read, or null. */
  readonly error: string | null;
}

/**
 * Read the shared capability report, starting the shared poll while mounted.
 *
 * @returns The report and the read's error.
 */
export function useLoopCapabilities(): LoopCapabilitiesState {
  const poll = sharedLoopCapabilitiesPoll();
  const snapshot: PollSnapshot<LoopCapabilities> = useSyncExternalStore(
    poll.subscribe,
    poll.snapshot,
    () => EMPTY_POLL_SNAPSHOT,
  );

  useEffect(() => retainLoopCapabilities(), []);

  return { capabilities: snapshot.data, error: snapshot.error };
}
