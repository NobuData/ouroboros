"use client";

import type { IssueDetail } from "@/app/api/backlog";
import type { PollSnapshot } from "@/app/poll";

import { type DetailPollOptions, createDetailPoll, detailUrl } from "./detail-poll";
import { useKeyedPoll } from "./use-keyed-poll";

/**
 * Where the detail panel's poll meets React — one loop per open issue, rebuilt when another
 * row is opened, and none while no row is
 * ([#119](https://github.com/NobuData/ouroboros/issues/119)).
 *
 * `app/issues/use-keyed-poll.ts` is the loop and the key; what is here is the panel's reader,
 * keyed on the issue the selection store says is open. A click on another row is a new loop,
 * and between the id moving and the new loop's first answer the panel draws what the table
 * already knows about the row — its number, title, labels and status — over a skeleton for the
 * rest. Closing the panel is a `null` id, which holds no loop and makes no request.
 *
 * @param id The open issue's `github_issues.id`, or `null` while none is open.
 * @param options Test seams, read on the renders that build a poll; production passes none.
 * @returns The latest answer, and the way to ask now — which a **Re-estimate** press uses, so
 *   the `estimating…` the service has already written is drawn at once rather than an interval
 *   later.
 */
export function useDetailPoll(
  id: string | null,
  options?: DetailPollOptions,
): { readonly snapshot: PollSnapshot<IssueDetail>; readonly refresh: () => void } {
  return useKeyedPoll(id, (issue) => createDetailPoll(detailUrl(issue), options));
}
