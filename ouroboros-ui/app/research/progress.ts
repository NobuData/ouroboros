import type { InvestigationProgress } from "@/app/api/research";

/**
 * Following an investigation's progress from the browser (CN.2,
 * [#628](https://github.com/NobuData/ouroboros/issues/628)) — the client's half of
 * `GET /api/v1/research/investigations/{id}/progress`, reached through this origin's
 * pass-through (`app/api/research-progress.ts`) because the browser cannot reach the service.
 *
 * The stream is server-sent events in the copilot stream's framing: `event: progress` on each
 * change, `event: done` once the run has ended — always last, after which the service closes —
 * and `event: error` when the stream could not go on. Each `data:` line is the whole event as
 * JSON, its `kind` included.
 *
 * ### Why `done` closes the source here
 * An `EventSource` reconnects by itself whenever its connection closes, which is right while
 * the run is in flight (a stream ends on its own after half an hour, and the next reading is
 * where a reconnected client starts) and wrong once the run has ended: the service would
 * answer `done` again, for ever. So the watcher closes the source on `done` and on `error`.
 *
 * ### Two things called `error`
 * The service's `event: error` arrives as a `MessageEvent` named `error` **with data**; the
 * browser's own connection-lost signal is a plain `Event` named `error` **without**. The watcher
 * reads the data to tell them apart: a lost connection is left to the browser's reconnect, a
 * served error ends the watch.
 *
 * Framework-free, and the source is injectable, so the whole protocol is a unit test with a
 * fake that dispatches what the service would.
 */

/** The three events the service names. */
export const PROGRESS_EVENT_KINDS = ["progress", "done", "error"] as const;

/** One of {@link PROGRESS_EVENT_KINDS}. */
export type ProgressEventKind = (typeof PROGRESS_EVENT_KINDS)[number];

/** A served error — the stream could not go on. */
export interface ProgressError {
  readonly code: string;
  readonly message: string;
}

/** What a watcher is told. */
export interface ProgressHandlers {
  /** A reading — the first, and each change. */
  readonly onProgress: (reading: InvestigationProgress) => void;
  /** The last reading: the run has ended. The watch is over. */
  readonly onDone: (reading: InvestigationProgress) => void;
  /** The service could not go on. The watch is over. */
  readonly onError: (error: ProgressError) => void;
}

/** The part of a message event the watcher reads. */
export interface ProgressMessage {
  /** The `data:` line — JSON, or undefined on the browser's own connection event. */
  readonly data?: unknown;
}

/** The part of an `EventSource` the watcher uses — what a fake provides in a test. */
export interface ProgressSource {
  addEventListener(type: string, listener: (event: ProgressMessage) => void): void;
  close(): void;
}

/** How a source is opened. Defaults to the browser's `EventSource`. */
export type ProgressSourceFactory = (url: string) => ProgressSource;

/**
 * This origin's pass-through for one investigation's stream.
 *
 * @param investigationId The investigation.
 * @returns `/api/research/investigations/{id}/progress`, the id encoded.
 */
export function progressUrl(investigationId: string): string {
  return `/api/research/investigations/${encodeURIComponent(investigationId)}/progress`;
}

/**
 * Read one event's payload.
 *
 * @param event The message.
 * @returns The parsed object, or null for a connection event or a line that is not JSON.
 */
export function readEventData(event: ProgressMessage): Record<string, unknown> | null {
  if (typeof event.data !== "string") return null;

  try {
    const parsed: unknown = JSON.parse(event.data);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Whether a payload is a reading.
 *
 * @param data The payload.
 * @returns True when it carries a status and a source count.
 */
export function isProgressReading(data: Record<string, unknown>): data is InvestigationProgress &
  Record<string, unknown> {
  return typeof data.status === "string" && typeof data.sources === "number";
}

/** A source that never speaks — for a runtime with no `EventSource`, where a row simply does not tick. */
const SILENT_SOURCE: ProgressSource = { addEventListener: () => {}, close: () => {} };

/**
 * Open the browser's `EventSource` on a URL.
 *
 * @param url The stream.
 * @returns The source — or a silent one where the runtime has no `EventSource` (a server render,
 *   a test document), so a card with live rows can be drawn anywhere and ticks where it can.
 */
function browserSource(url: string): ProgressSource {
  return typeof EventSource === "undefined" ? SILENT_SOURCE : new EventSource(url);
}

/**
 * Follow an investigation until it ends, the service gives up, or the caller stops.
 *
 * @param investigationId The investigation.
 * @param handlers What to do with each event.
 * @param open How to open the source. A test hands in a fake.
 * @returns Stop watching. Idempotent; called by the watcher itself on `done` and on a served
 *   error.
 */
export function watchInvestigation(
  investigationId: string,
  handlers: ProgressHandlers,
  open: ProgressSourceFactory = browserSource,
): () => void {
  const source = open(progressUrl(investigationId));
  let closed = false;

  const stop = (): void => {
    if (closed) return;
    closed = true;
    source.close();
  };

  source.addEventListener("progress", (event) => {
    const data = readEventData(event);
    if (data !== null && isProgressReading(data)) handlers.onProgress(data);
  });

  source.addEventListener("done", (event) => {
    const data = readEventData(event);
    stop();
    if (data !== null && isProgressReading(data)) handlers.onDone(data);
  });

  source.addEventListener("error", (event) => {
    // The browser's own connection event carries no data: it reconnects by itself.
    const data = readEventData(event);
    if (data === null) return;

    stop();
    handlers.onError({
      code: typeof data.code === "string" ? data.code : "investigation_progress_failed",
      message:
        typeof data.message === "string"
          ? data.message
          : "The progress stream stopped unexpectedly. Reload to read the investigation's state.",
    });
  });

  return stop;
}
