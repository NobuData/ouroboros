"use client";

import { type Ref, useId } from "react";

import type { PrFiles } from "@/app/api/pull-requests";
import { Card, CardHead } from "@/app/ui";

import { FILES_ID, OPENS_HOST } from "./criteria";
import { type Hunk, hunkRange } from "./hunk";

/** The card's title — the mockup's `CHANGED FILES`. */
export const FILES_TITLE = "Changed files";

/** The slot's link to the whole diff — the mockup's `Full diff on GitHub ↗`. */
export const FULL_DIFF_LINK = "Full diff on the host";

/** What the slot says before a hunk has been cited. */
export const NO_HUNK_CITED =
  "No hunk is cited. A hunk reference of the criteria matrix brings the reader here.";

/** What the slot says about itself until AY.5 draws the card. */
export const FILES_PENDING_CARD =
  "The diff itself, scrolled to the cited range, arrives with the Changed files card (#367).";

/** What the slot says when the latest revision's snapshot does not hold the cited path. */
export const HUNK_NOT_IN_SNAPSHOT =
  "The latest revision's snapshot does not hold this path — the hunk was cited on a revision that changed it.";

/**
 * What the slot says about a cited hunk.
 *
 * @param hunk The hunk.
 * @returns `Cited: drivers/can/telemetry_buf.c · lines 41–66`.
 */
export function citedLine(hunk: Hunk): string {
  return `Cited: ${hunk.path} · ${hunkRange(hunk)}`;
}

/** What the slot is told. */
export interface FilesSlotProps {
  /** The hunk the address cites, or `null`. */
  readonly hunk: Hunk | null;
  /** The latest revision's files snapshot, or `null`. */
  readonly files: PrFiles | null;
  /** The region, for the screen to scroll to and focus. */
  readonly ref?: Ref<HTMLElement>;
}

/**
 * Where a hunk reference lands ([#366](https://github.com/NobuData/ouroboros/issues/366)) — the
 * Changed files card's place on the page.
 *
 * The card with the file rows and the diff excerpt is AY.5's
 * ([#367](https://github.com/NobuData/ouroboros/issues/367)). Until it is drawn, this is the
 * honest slot: it takes focus, names the path and the range the matrix cited, says whether the
 * latest revision's snapshot holds that path, and links to the whole diff on the host — rather
 * than a link that leads nowhere. AY.5 replaces the body and keeps {@link FILES_ID}, the ref, the
 * `hunk` prop and the `?hunk=` address (`hunk.ts`), scrolling its diff to the range.
 *
 * @param props See {@link FilesSlotProps}.
 * @returns The slot.
 */
export function FilesSlot({ hunk, files, ref }: FilesSlotProps) {
  const titleId = useId();
  const held = hunk !== null && files !== null && files.rows.some((row) => row.path === hunk.path);

  return (
    <section
      aria-labelledby={titleId}
      className="prv-files"
      id={FILES_ID}
      ref={ref}
      tabIndex={-1}
    >
      <Card>
        <CardHead
          title={FILES_TITLE}
          titleId={titleId}
          trailing={
            files === null ? undefined : (
              <a
                className="prv-criteria__link"
                href={files.fullDiffUrl}
                rel="noopener noreferrer"
                target="_blank"
              >
                {FULL_DIFF_LINK}
                <span aria-label={OPENS_HOST} role="img">
                  {" ↗"}
                </span>
              </a>
            )
          }
        />

        {hunk === null ? (
          <p className="prv-files__note">{NO_HUNK_CITED}</p>
        ) : (
          <>
            <p className="prv-files__cited">{citedLine(hunk)}</p>
            {!held && <p className="prv-files__note">{HUNK_NOT_IN_SNAPSHOT}</p>}
          </>
        )}

        <p className="prv-files__note">{FILES_PENDING_CARD}</p>
      </Card>
    </section>
  );
}
