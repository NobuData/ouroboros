"use client";

import type { BacklogListing } from "@/app/api/backlog";
import type { PollSnapshot } from "@/app/poll";

import { type BacklogPollOptions, createBacklogPoll } from "./backlog-poll";
import { useKeyedPoll } from "./use-keyed-poll";

/**
 * Where the backlog's poll meets React — one loop per address, rebuilt when the address moves
 * ([#117](https://github.com/NobuData/ouroboros/issues/117)).
 *
 * The loop, the key and the workspace switch are `app/issues/use-keyed-poll.ts`'s since the
 * detail panel needed the same thing keyed on an issue
 * ([#119](https://github.com/NobuData/ouroboros/issues/119)); what is here is the table's
 * reader, keyed on the address `backlogUrl` answers for the view on screen. A chip press or a
 * page turn is a new address and therefore a new loop, and between the address moving and the
 * new loop's first answer the table draws what the server rendered for the new address — which
 * is exactly the view the reader asked for.
 *
 * @param url The address to poll — `backlogUrl`'s answer for the view on screen.
 * @param options Test seams, read on the renders that build a poll; production passes none.
 * @returns The latest answer, and the way to ask now.
 */
export function useBacklogPoll(
  url: string,
  options?: BacklogPollOptions,
): { readonly snapshot: PollSnapshot<BacklogListing>; readonly refresh: () => void } {
  return useKeyedPoll(url, (address) => createBacklogPoll(address, options));
}
