"use client";

import { useEffect, useId, useRef, useState } from "react";

import { Card, CardHead, Tag, cx } from "@/app/ui";

import { FILES_ID, OPENS_HOST } from "./criteria";
import type { DiffLineKind } from "./diff";
import {
  EXCERPT_LABEL,
  type ExcerptFileView,
  FILES_TITLE,
  FULL_DIFF_LINK,
  type FileMeter,
  type FileRowView,
  type FilesCardView,
  METER_TRACK,
  OUT_OF_SCOPE_TAG,
} from "./files";

/** Each diff line's class — the shared diff treatments, from the same tokens as the transcript's. */
const LINE_CLASS: Readonly<Record<DiffLineKind, string>> = {
  ctx: "prv-diff__line prv-diff__line--ctx",
  del: "prv-diff__line prv-diff__line--del",
  add: "prv-diff__line prv-diff__line--add",
};

/** What brought the reader to the card. */
export interface FilesArrival {
  /** A hunk reference of the matrix, or the gates card's link to the flagged rows. */
  readonly kind: "hunk" | "flagged";
  /** Which arrival this is — `0` is the address the page was opened at, a press counts up. */
  readonly seq: number;
}

/** What a meter is told. */
interface MeterProps {
  /** The row's segments. */
  readonly meter: FileMeter;
}

/**
 * A row's tri-segment meter: additions, deletions, and the unchanged rest of the track.
 *
 * Drawn as a picture whose segments are stated as lengths of a {@link METER_TRACK}-wide track, so
 * the data is the only thing written on the element and every treatment stays the sheet's. It is
 * a picture of the counts beside it, so it is hidden from the accessibility tree.
 *
 * @param props See {@link MeterProps}.
 * @returns The meter.
 */
function FileMeterBar({ meter }: MeterProps) {
  return (
    <svg
      aria-hidden="true"
      className="prv-file__meter"
      focusable="false"
      preserveAspectRatio="none"
      viewBox={`0 0 ${METER_TRACK} 1`}
    >
      <rect className="prv-file__meter-rest" height={1} width={METER_TRACK} x={0} y={0} />
      <rect className="prv-file__meter-add" height={1} width={meter.add} x={0} y={0} />
      <rect className="prv-file__meter-del" height={1} width={meter.del} x={meter.add} y={0} />
    </svg>
  );
}

/** What a file row is told. */
interface FileRowProps {
  /** The row. */
  readonly row: FileRowView;
}

/**
 * One changed file: its path, its counts, its meter — and, flagged, what the gate says of it.
 *
 * @param props See {@link FileRowProps}.
 * @returns The row.
 */
function FileRow({ row }: FileRowProps) {
  return (
    <li
      className={cx("prv-file", row.flagged && "prv-file--flagged")}
      data-flagged={row.flagged ? "" : undefined}
    >
      <span className="prv-file__path">{row.path}</span>
      {row.flagged && <span className="prv-file__flag">{OUT_OF_SCOPE_TAG}</span>}
      <span className="prv-file__counts">
        <span className="prv-file__add">{row.additions}</span>{" "}
        <span className="prv-file__del">{row.deletions}</span>
      </span>
      <FileMeterBar meter={row.meter} />
    </li>
  );
}

/** What one file of the excerpt is told. */
interface ExcerptFileProps {
  /** The file. */
  readonly file: ExcerptFileView;
  /** Whether it is drawn open. */
  readonly open: boolean;
  /** The file's disclosure was pressed. */
  readonly onToggle: () => void;
}

/**
 * One file of the excerpt: a disclosure, and beneath it the file's stored hunks.
 *
 * The block scrolls sideways inside its own wrapper, so a long line never moves the pane.
 *
 * @param props See {@link ExcerptFileProps}.
 * @returns The file.
 */
function ExcerptFile({ file, open, onToggle }: ExcerptFileProps) {
  const panelId = useId();

  return (
    <li className="prv-diff__file">
      <button
        aria-controls={open ? panelId : undefined}
        aria-expanded={open}
        className="prv-diff__toggle"
        onClick={onToggle}
        type="button"
      >
        {file.path}
      </button>

      {open && (
        <div className="prv-diff__scroll" id={panelId}>
          <pre className="prv-diff__block">
            {file.hunks.map((hunk, at) => (
              <span className="prv-diff__hunk" key={at}>
                <span className="prv-diff__line prv-diff__line--head">{hunk.header}</span>
                {hunk.lines.map((line, index) => (
                  <span
                    className={cx(LINE_CLASS[line.kind], line.cited && "prv-diff__line--cited")}
                    data-cited={line.cited ? "" : undefined}
                    data-cited-anchor={line.anchor ? "" : undefined}
                    key={index}
                  >
                    {line.text}
                  </span>
                ))}
              </span>
            ))}
          </pre>
        </div>
      )}
    </li>
  );
}

/** What the card is told. */
export interface FilesCardProps {
  /** The card, from `filesCard`. */
  readonly view: FilesCardView;
  /** What brought the reader here, or `null` when nothing did. */
  readonly arrival: FilesArrival | null;
}

/**
 * The Changed files card ([#367](https://github.com/NobuData/ouroboros/issues/367)) — mockup
 * 12's file rows with their meters, and the diff excerpt.
 *
 * Every row and line is `files.ts`'s; this file only draws, and brings the reader to what they
 * followed. A hunk reference of the matrix (#366) opens the cited file and brings the first line
 * of the range into view; the gates card's link (#365) brings the first flagged row. A press
 * moves focus to the card as well, so a keyboard or screen-reader user lands where a sighted one
 * is looking; the address the page was opened at only scrolls.
 *
 * The excerpt's files open and close one by one — all of it within what is stored. It is labelled
 * as an excerpt, and the whole diff is a link to the host.
 *
 * @param props See {@link FilesCardProps}.
 * @returns The card.
 */
export function FilesCard({ view, arrival }: FilesCardProps) {
  const titleId = useId();
  const region = useRef<HTMLElement>(null);
  const [toggled, setToggled] = useState<Readonly<Record<string, boolean>>>({});
  const [arrived, setArrived] = useState(arrival?.seq ?? null);
  const seq = arrival?.seq ?? null;
  const kind = arrival?.kind ?? null;
  const citedPath = view.cited?.path ?? null;

  // A hunk was followed: the cited file is drawn open again, whatever the reader chose before.
  if (arrived !== seq) {
    setArrived(seq);

    if (kind === "hunk" && citedPath !== null && citedPath in toggled) {
      setToggled((current) =>
        Object.fromEntries(Object.entries(current).filter(([path]) => path !== citedPath)),
      );
    }
  }

  useEffect(() => {
    if (seq === null || kind === null) return;

    const card = region.current;
    if (card === null) return;

    const target = card.querySelector(kind === "hunk" ? "[data-cited-anchor]" : "[data-flagged]");

    if (seq > 0) card.focus({ preventScroll: true });
    if (target !== null) target.scrollIntoView?.({ block: "center" });
    else card.scrollIntoView?.({ block: "start" });
  }, [seq, kind]);

  return (
    <section
      aria-labelledby={titleId}
      className="prv-files"
      id={FILES_ID}
      ref={region}
      tabIndex={-1}
    >
      <Card>
        <CardHead
          beside={view.totals === null ? undefined : <Tag>{view.totals}</Tag>}
          title={FILES_TITLE}
          titleId={titleId}
          trailing={
            view.fullDiffUrl === null ? undefined : (
              <a
                className="prv-criteria__link"
                href={view.fullDiffUrl}
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

        {view.explanation !== null && <p className="prv-files__scope">{view.explanation}</p>}

        {view.empty !== null ? (
          <p className="prv-files__note">{view.empty}</p>
        ) : (
          <ul className="prv-files__rows">
            {view.rows.map((row) => (
              <FileRow key={row.path} row={row} />
            ))}
          </ul>
        )}

        {view.cited !== null && (
          <div className="prv-files__citation">
            <p className="prv-files__cited">{view.cited.line}</p>
            {view.cited.note !== null && <p className="prv-files__note">{view.cited.note}</p>}
          </div>
        )}

        {view.excerpt.length > 0 && <p className="prv-diff__label">{EXCERPT_LABEL}</p>}
        {view.excerptNotes.map((note) => (
          <p className="prv-files__note" key={note}>
            {note}
          </p>
        ))}

        {view.excerpt.length > 0 && (
          <ul className="prv-diff">
            {view.excerpt.map((file) => {
              const open = toggled[file.path] ?? file.open;

              return (
                <ExcerptFile
                  file={file}
                  key={file.path}
                  onToggle={() => setToggled((current) => ({ ...current, [file.path]: !open }))}
                  open={open}
                />
              );
            })}
          </ul>
        )}
      </Card>
    </section>
  );
}
