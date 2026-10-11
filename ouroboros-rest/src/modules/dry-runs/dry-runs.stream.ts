/**
 * A dry run's progress as server-sent events (CD.4,
 * [#562](https://github.com/NobuData/ouroboros/issues/562)).
 *
 * ```
 * accepted         the dry run as recorded — the card's header
 * stage_started    a row has begun            (the live row: running)
 * stage_finished   a row has its result       (complete, with its verdict)
 * guard_blocked    the tool boundary refused a call, as it happened
 * done             always last: the dry run as it ended, with rows, artifacts and totals
 * ```
 *
 * The events are in stage order because the harness walks in stage order, and the terminal
 * `done` carries the totals. A row that has not started yet has no event — it is *queued*, and
 * the page knows the draft's stages already.
 */

import { SSE_MEDIA_TYPE, type SseResponse } from "../copilot/copilot.stream";
import type { DryRunResource, DryRunStageResource } from "./dry-runs.resources";

/** One event of a dry run's stream. */
export type DryRunStreamEvent =
  | { readonly kind: "accepted"; readonly dryRun: DryRunResource }
  | {
      readonly kind: "stage_started";
      readonly seq: number;
      readonly stageKey: string;
      readonly displayName: string;
    }
  | { readonly kind: "stage_finished"; readonly stage: DryRunStageResource }
  | {
      readonly kind: "guard_blocked";
      readonly guard: string;
      readonly call: string;
      readonly stageKey: string;
    }
  | { readonly kind: "done"; readonly dryRun: DryRunResource };

/**
 * One event, framed.
 *
 * @param event - The event.
 * @returns `event: <kind>` and `data: <json>`, terminated by the blank line the protocol needs.
 */
export function formatDryRunEvent(event: DryRunStreamEvent): string {
  return `event: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * Write a dry run's events to a response, as they arrive.
 *
 * The headers go out after the first event is produced, for `copilot.stream.ts`' reason:
 * everything that can refuse the request is checked before the service yields anything, so a
 * refusal propagates as the ordinary error envelope. Nothing after that can fail a run — what
 * goes wrong mid-run is recorded on the run and arrives as its `done` — so a stream that breaks
 * is simply ended; the client re-reads the dry run.
 *
 * @param response - Where to write.
 * @param events - The events.
 * @returns When the stream has ended.
 */
export async function writeDryRunEvents(
  response: SseResponse,
  events: AsyncIterable<DryRunStreamEvent>,
): Promise<void> {
  const iterator = events[Symbol.asyncIterator]();
  const first = await iterator.next();

  response.setHeader("content-type", `${SSE_MEDIA_TYPE}; charset=utf-8`);
  response.setHeader("cache-control", "no-cache, no-transform");
  response.setHeader("x-accel-buffering", "no");
  response.flushHeaders?.();

  try {
    let next = first;
    while (next.done !== true) {
      response.write(formatDryRunEvent(next.value));
      next = await iterator.next();
    }
  } finally {
    response.end();
  }
}
