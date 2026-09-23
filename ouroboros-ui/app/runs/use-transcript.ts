"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import {
  EMPTY_TRANSCRIPT_VIEW,
  type TranscriptStream,
  type TranscriptStreamOptions,
  type TranscriptView,
  createTranscriptStream,
} from "./transcript-stream";

/**
 * Where the transcript's stream meets React ([#312](https://github.com/NobuData/ouroboros/issues/312))
 * — `app/farm/use-log-stream.ts`'s shape: one stream for the card's lifetime, started on mount
 * and stopped on unmount.
 *
 * @param runId The run.
 * @param options Test seams; production passes none.
 * @returns The latest view, and the way to ask now.
 */
export function useTranscript(
  runId: string,
  options?: TranscriptStreamOptions,
): { readonly view: TranscriptView; readonly refresh: () => void } {
  const [stream] = useState<TranscriptStream>(() => createTranscriptStream(runId, options));

  useEffect(() => stream.start(), [stream]);

  const view = useSyncExternalStore<TranscriptView>(
    stream.subscribe,
    stream.snapshot,
    // The server has no stream and nothing to report. Identity-stable, as the hook requires.
    () => EMPTY_TRANSCRIPT_VIEW,
  );

  return { view, refresh: stream.refresh };
}
