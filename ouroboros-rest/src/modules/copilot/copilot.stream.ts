/**
 * The exchange as the browser sees it — server-sent events, one per thing that happened.
 *
 * The UI's *watch-it-build* moment is this stream: reply text arrives as `delta` events and the
 * operations the reply carries arrive as `operation` events **in the order the model produced
 * them**, each already applied (or bounced) by the time it is sent. A client that renders the
 * stream in order renders the reply the way it was built.
 *
 * `text/event-stream` rather than NDJSON here, because the reader is a browser and `EventSource`
 * semantics are what it wants. The `event:` field is the event's `kind`, so a client may listen
 * per kind or read `data` whole.
 */

import type { UpstreamError } from "../errors/error.envelope";
import type { ProposedOperation } from "./copilot.operations";
import type {
  CopilotDraftResource,
  CopilotMessageResource,
  CopilotWarningResource,
} from "./copilot.resources";

/** The media type of the stream. */
export const SSE_MEDIA_TYPE = "text/event-stream";

/** One event of an exchange. */
export type CopilotExchangeEvent =
  /** The person's message was recorded and a reply has started. Always first. */
  | {
      readonly kind: "accepted";
      readonly message: CopilotMessageResource;
      readonly replyId: string;
      readonly replySeq: number;
    }
  /** A fragment of reply text. */
  | { readonly kind: "delta"; readonly text: string }
  /** An operation the reply proposed, and what became of it — the marker the UI animates rows in on. */
  | {
      readonly kind: "operation";
      readonly op: ProposedOperation;
      readonly outcome: "applied" | "bounced" | "proposed";
      readonly validatorMessage: string | null;
      /** The draft revision the operation produced — applied only. */
      readonly draftRev: number | null;
      /** The draft slot's etag afterwards — applied only. */
      readonly etag: string | null;
      /** The unresolved references this operation introduced (W7). */
      readonly warnings: readonly CopilotWarningResource[];
    }
  /** A read the reply made. */
  | { readonly kind: "read"; readonly tool: string }
  /** A question — the chip row. */
  | {
      readonly kind: "question";
      readonly index: number;
      readonly prompt: string;
      readonly options: readonly string[];
    }
  /** A dry run the reply proposed. */
  | { readonly kind: "dry_run_proposal"; readonly ticket: string; readonly reason: string }
  /** The draft changed under the conversation; the copilot re-read it. */
  | { readonly kind: "conflict"; readonly message: string; readonly etag: string };

/** The events the service adds around the exchange. */
export type CopilotStreamEvent =
  | CopilotExchangeEvent
  /** What the exchange consumed and cost; `null`s when unmetered or unpriced. */
  | {
      readonly kind: "usage";
      readonly tokensIn: number | null;
      readonly tokensOut: number | null;
      readonly costCents: number | null;
    }
  /** The reply could not be made or finished — `copilot_unrouted`, `gateway_unavailable`, … */
  | { readonly kind: "error"; readonly code: string; readonly message: string }
  /** The reply as recorded, and the draft as it stands. Always last. */
  | {
      readonly kind: "done";
      readonly message: CopilotMessageResource;
      readonly draft: CopilotDraftResource;
    };

/** What the controller needs of the response it writes the stream to. */
export interface SseResponse {
  /** Set a header, replacing any previous value. */
  setHeader(name: string, value: string): unknown;
  /** Send the headers now, so the client sees the stream open before the first event. */
  flushHeaders?(): unknown;
  /** Write one chunk. */
  write(chunk: string): unknown;
  /** End the stream. */
  end(): unknown;
}

/**
 * One event, framed.
 *
 * @param event - The event.
 * @returns `event: <kind>` and `data: <json>`, terminated by the blank line the protocol needs.
 */
export function formatSse(event: CopilotStreamEvent): string {
  return `event: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * Write a stream of events to a response, as they arrive.
 *
 * **The headers are sent after the first event is produced**, not before: everything that can
 * refuse the request (no such session, a closed one, a reply still streaming) is checked before
 * the service yields anything, and a refusal raised then propagates as the ordinary error
 * envelope rather than arriving as an event on an already-open stream. A failure *after* the
 * stream opened is written as an `error` event, because the status line has gone.
 *
 * @param response - Where to write.
 * @param events - The events.
 * @returns When the stream has ended.
 */
export async function writeSse(
  response: SseResponse,
  events: AsyncIterable<CopilotStreamEvent>,
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
      response.write(formatSse(next.value));
      next = await iterator.next();
    }
  } catch (error) {
    response.write(formatSse(streamFailure(error)));
  } finally {
    response.end();
  }
}

/**
 * A failure after the stream opened, as the one event a client can still receive.
 *
 * @param error - What was thrown.
 * @returns An `error` event carrying the domain code where there is one.
 */
export function streamFailure(error: unknown): CopilotStreamEvent {
  const domain = error as Partial<UpstreamError> | null;
  const code = typeof domain?.code === "string" ? domain.code : "copilot_stream_failed";
  const message =
    typeof domain?.message === "string" && domain.message !== ""
      ? domain.message
      : "The reply could not be finished.";
  return { kind: "error", code, message };
}
