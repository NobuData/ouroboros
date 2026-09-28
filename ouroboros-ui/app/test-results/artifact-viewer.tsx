"use client";

import { useEffect, useState } from "react";

import { Button, RetryBanner } from "@/app/ui";

import {
  type ArtifactText,
  CLOSE_VIEWER,
  DOWNLOAD_FILE,
  FILE_EMPTY,
  FILE_EXPIRED,
  FILE_FAILED_HEADLINE,
  FILE_UNREADABLE,
  READING_FILE,
  clippedNote,
  readArtifactText,
} from "./artifacts";

/** How the viewer reads a file. The fetch in production; tests pass their own. */
export type ArtifactReader = (url: string, signal: AbortSignal) => Promise<ArtifactText>;

/** The production reader — a constant, so the viewer's effect reads once per file. */
const READ: ArtifactReader = (url, signal) => readArtifactText(url, { signal });

/** What the viewer is told. */
export interface ArtifactViewerProps {
  /** The viewer's element id — what the row's affordance controls. */
  readonly id: string;
  /** The file's name. */
  readonly name: string;
  /** The file, on this origin. */
  readonly url: string;
  /** Close the viewer. */
  readonly onClose: () => void;
  /** How to read the file. Defaults to the fetch. */
  readonly read?: ArtifactReader;
}

/**
 * The inline text viewer ([#341](https://github.com/NobuData/ouroboros/issues/341)) — a text
 * artifact read in place, beneath its row.
 *
 * **The file is drawn as text and nothing else.** It is the runner's bytes, so it is put in a
 * `<pre>` as a text node: markup in a log is characters on the screen, never elements in the
 * page.
 *
 * **It reads a bounded amount** (`readArtifactText`): a log longer than the limit is shown from
 * its start, says so, and leaves the rest to the download beside it.
 *
 * **It scrolls inside its own wrapper**, both ways, and the wrapper takes focus so the keyboard
 * can scroll it. A file that expired while the page was open says *expired*; any other failure
 * says why and offers a retry.
 *
 * It lives exactly as long as it is open: closing it aborts a read in flight, and opening it
 * again reads again.
 *
 * @param props See {@link ArtifactViewerProps}.
 * @returns The viewer, as a region named by its file.
 */
export function ArtifactViewer({ id, name, url, onClose, read = READ }: ArtifactViewerProps) {
  const [result, setResult] = useState<ArtifactText | null>(null);
  const [tries, setTries] = useState(0);

  useEffect(() => {
    const stop = new AbortController();

    read(url, stop.signal).then(
      (answer) => {
        if (!stop.signal.aborted) setResult(answer);
      },
      () => {
        if (!stop.signal.aborted) setResult({ state: "failed", reason: FILE_UNREADABLE });
      },
    );

    return () => stop.abort();
  }, [read, url, tries]);

  /** Read the file again, from the start. */
  function retry(): void {
    setResult(null);
    setTries((count) => count + 1);
  }

  return (
    <section aria-label={`Contents of ${name}`} className="tests-artifacts__viewer" id={id}>
      <header className="tests-artifacts__viewer-head">
        <span className="tests-artifacts__viewer-name">{name}</span>
        <a className="tests-artifacts__viewer-link" download href={url}>
          {DOWNLOAD_FILE}
        </a>
        <Button onClick={onClose} size="sm" tone="ghost">
          {CLOSE_VIEWER}
        </Button>
      </header>

      {result === null && (
        <p className="tests-artifacts__viewer-note" role="status">
          {READING_FILE}
        </p>
      )}

      {result?.state === "expired" && (
        <p className="tests-artifacts__viewer-note" role="alert">
          {FILE_EXPIRED}
        </p>
      )}

      {result?.state === "failed" && (
        <RetryBanner headline={FILE_FAILED_HEADLINE} onRetry={retry} reason={result.reason} />
      )}

      {result?.state === "read" && result.text === "" && (
        <p className="tests-artifacts__viewer-note">{FILE_EMPTY}</p>
      )}

      {result?.state === "read" && result.text !== "" && (
        <>
          {/* Focusable so the keyboard can scroll it. */}
          <pre aria-label={name} className="tests-artifacts__text" role="group" tabIndex={0}>
            {result.text}
          </pre>
          {result.clipped && <p className="tests-artifacts__viewer-note">{clippedNote()}</p>}
        </>
      )}
    </section>
  );
}
