/**
 * An investigation's progress as server-sent events (CM.6,
 * [#625](https://github.com/NobuData/ouroboros/issues/625)).
 *
 *   event: progress   {kind, status, iteration, iterations, sources, spendCents, cancelRequested, updatedAt}
 *   event: done       the same reading, once the run has ended — always last
 *   event: error      {kind, code, message} — the stream could not go on
 *   : keep-alive      a comment, when nothing changed for a while
 *
 * **The stream is a poll of the database, per subscriber.** The loop's worker writes its
 * ledger, usage and checkpoints through REST into the database; each subscriber re-reads the
 * investigation every {@link POLL_MS} and is sent a `progress` event when the reading differs
 * from the last one it was sent. So any number of subscribers may watch one investigation, on
 * any REST instance, and one that connects late starts from the current reading. The shared
 * live-update channel (DASH-J.1, #89) is not built yet; the framing here is the copilot
 * stream's, which is the pattern that channel follows.
 *
 * **It closes itself.** When the investigation is no longer queued or running — brief ready,
 * failed, or cancelled with its ledger kept — the final reading is sent as `done` and the
 * response ends. It also ends when the client goes away, and after {@link MAX_POLLS} polls
 * whatever the investigation is doing, so a run that never starts cannot hold a stream open
 * for ever.
 */

import { SSE_MEDIA_TYPE, type SseResponse } from "../../copilot/copilot.stream";
import type { DomainError } from "../../errors/error.envelope";
import { type InvestigationProgressResource, inFlight } from "./lifecycle.resources";

/** How often a subscriber re-reads the investigation. */
export const POLL_MS = 1000;

/** How many unchanged polls pass before a keep-alive comment is sent. */
export const KEEP_ALIVE_POLLS = 15;

/**
 * How many polls one stream makes before it ends on its own — half an hour at {@link POLL_MS}.
 * An investigation can sit queued indefinitely; a stream must not. A client still watching
 * reconnects (an `EventSource` does so by itself) and starts from the current reading.
 */
export const MAX_POLLS = 1800;

/** One event of the stream. */
export type ProgressEvent =
  | ({ readonly kind: "progress" } & InvestigationProgressResource)
  | ({ readonly kind: "done" } & InvestigationProgressResource)
  | { readonly kind: "keep-alive" }
  | { readonly kind: "error"; readonly code: string; readonly message: string };

/** What a watch needs besides the reading itself. */
export interface WatchOptions {
  /** Whether the subscriber has gone away. */
  readonly closed: () => boolean;
  /** Wait between two polls; replaced in tests. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Milliseconds between polls. */
  readonly pollMs?: number;
  /** Unchanged polls before a keep-alive. */
  readonly keepAlivePolls?: number;
  /** Polls before the stream ends on its own. */
  readonly maxPolls?: number;
}

/**
 * Wait.
 *
 * @param ms - How long.
 * @returns When the time has passed.
 */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Watch an investigation until it ends or the subscriber leaves.
 *
 * The first reading is taken before anything is yielded, so an investigation that does not
 * exist is refused with the ordinary error envelope instead of an event.
 *
 * @param read - Take one reading; throws when the investigation cannot be read.
 * @param options - When to stop, and how to wait.
 * @returns `progress` for the first reading and each change, `keep-alive` while nothing
 *   changes, and `done` last when the run has ended. A stream that reaches its poll limit, or
 *   whose subscriber left, ends without a `done`.
 */
export async function* watchProgress(
  read: () => Promise<InvestigationProgressResource>,
  options: WatchOptions,
): AsyncGenerator<ProgressEvent, void, undefined> {
  const sleep = options.sleep ?? wait;
  const pollMs = options.pollMs ?? POLL_MS;
  const keepAlivePolls = options.keepAlivePolls ?? KEEP_ALIVE_POLLS;
  const maxPolls = options.maxPolls ?? MAX_POLLS;

  let reading = await read();
  let sent = "";
  let quiet = 0;

  for (let polls = 1; ; polls += 1) {
    const fingerprint = JSON.stringify(reading);
    if (fingerprint !== sent) {
      sent = fingerprint;
      quiet = 0;
      yield { kind: "progress", ...reading };
    } else if (++quiet >= keepAlivePolls) {
      quiet = 0;
      yield { kind: "keep-alive" };
    }

    if (!inFlight(reading.status)) {
      yield { kind: "done", ...reading };
      return;
    }

    if (polls >= maxPolls) return;
    await sleep(pollMs);
    if (options.closed()) return;
    reading = await read();
  }
}

/**
 * One event, framed.
 *
 * @param event - The event.
 * @returns `event: <kind>` and `data: <json>` — the whole event, its `kind` included, as the
 *   copilot stream frames its own — ending in the blank line the protocol needs. A keep-alive
 *   is a comment line, which a client's `EventSource` ignores.
 */
export function formatProgress(event: ProgressEvent): string {
  if (event.kind === "keep-alive") return ": keep-alive\n\n";

  return `event: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * A failure after the stream opened, as the one event a client can still receive.
 *
 * @param error - What was thrown.
 * @returns An `error` event carrying the domain code where there is one.
 */
export function progressFailure(error: unknown): ProgressEvent {
  const domain = error as Partial<DomainError> | null;
  const coded = typeof domain?.code === "string" && typeof domain.message === "string";

  return {
    kind: "error",
    code: coded ? domain.code : "investigation_progress_failed",
    message: coded
      ? (domain.message as string)
      : "The progress stream stopped unexpectedly. Reload to read the investigation's state.",
  };
}

/**
 * Write a progress stream to a response.
 *
 * The headers go out after the first event is produced, so a refusal raised before it
 * propagates as the ordinary error envelope. A failure after that is written as an `error`
 * event, because the status line has gone.
 *
 * @param response - Where to write.
 * @param events - The events.
 * @returns When the stream has ended.
 */
export async function writeProgress(
  response: SseResponse,
  events: AsyncIterable<ProgressEvent>,
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
      response.write(formatProgress(next.value));
      next = await iterator.next();
    }
  } catch (error) {
    response.write(formatProgress(progressFailure(error)));
  } finally {
    response.end();
  }
}
