"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { EMPTY_LOG_VIEW, type LogStream, type LogStreamOptions, type LogView, createLogStream } from "./log-stream";

/**
 * Where a build's log stream meets React (AI.6,
 * [#261](https://github.com/NobuData/ouroboros/issues/261)) — the shape
 * `app/farm/farm-store.tsx` set out, for one component rather than a screen.
 *
 * **One stream per mount, and the caller keys the mount by the job.** A stream accumulates: its
 * rows are one build's output and its offset is a position in that build's bytes, so there is no
 * meaningful way to point a running stream at another job. A component that may be handed a
 * different job renders the caller of this hook under `key={job.id}`, and a new job is then a new
 * stream with nothing of the old one in it.
 *
 * The stream is built by a lazy initialiser rather than a `useMemo` — React may discard a memo,
 * and a discarded stream is a log read again from its start — and it starts in an effect, so
 * nothing is asked for during a server render or the hydration pass that has to match it.
 *
 * @param jobId The build job. Read once, on the render that builds the stream.
 * @param options The mode, and the test seams. Read once, likewise.
 * @returns The log as far as it has been read.
 */
export function useLogStream(jobId: string, options?: LogStreamOptions): LogView {
  const [stream] = useState<LogStream>(() => createLogStream(jobId, options));

  useEffect(() => stream.start(), [stream]);

  return useSyncExternalStore<LogView>(
    stream.subscribe,
    stream.snapshot,
    // The server has no stream and nothing to report. Identity-stable, as the hook requires.
    () => EMPTY_LOG_VIEW,
  );
}
