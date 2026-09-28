"use client";

import {
  Activity,
  File,
  FileCode,
  FileText,
  Gauge,
  type LucideIcon,
  PieChart,
} from "lucide-react";
import { useId, useState } from "react";

import type { TestArtifact } from "@/app/api/test-results";
import { Card, CardHead, Chip, Tag } from "@/app/ui";
import { cx } from "@/app/ui/class-names";

import { type ArtifactReader, ArtifactViewer } from "./artifact-viewer";
import {
  ARTIFACTS_LIST_LABEL,
  ARTIFACTS_TITLE,
  type ArtifactRowView,
  type ArtifactsView,
  COVERAGE_LABEL,
  type DeltaTone,
  EXPIRED,
  OPEN_GLYPH,
  READING_ARTIFACTS,
  TRUNCATED,
} from "./artifacts";

/** The icon each kind of artifact takes. */
const KIND_ICON: Readonly<Record<TestArtifact["kind"], LucideIcon>> = {
  junit: FileCode,
  hil: Gauge,
  coverage: PieChart,
  log: FileText,
  capture: Activity,
  other: File,
};

/** The modifier each hue adds to a coverage delta. */
const DELTA_CLASS: Readonly<Record<DeltaTone, string>> = {
  ok: "tests-artifacts__delta--ok",
  err: "tests-artifacts__delta--err",
  neutral: "tests-artifacts__delta--neutral",
};

/**
 * One `art` row, and its viewer while it is open.
 *
 * @param props.row The row, from `artifactsView`.
 * @param props.open Whether this row's viewer is open.
 * @param props.onToggle Open this row's viewer, or close it.
 * @param props.read How the viewer reads the file; production passes none.
 * @returns The artifact, as a list item: its icon and name, its size when notable, its state,
 *   and its affordance — a button for a file read in place, a link for one that is saved, and
 *   **nothing** for a tombstone.
 */
function ArtifactRow({
  row,
  open,
  onToggle,
  read,
}: Readonly<{
  row: ArtifactRowView;
  open: boolean;
  onToggle: () => void;
  read?: ArtifactReader;
}>) {
  const viewerId = useId();
  const Icon = KIND_ICON[row.kind] ?? File;

  return (
    <li
      className="tests-artifacts__row"
      data-expired={row.expired ? "true" : undefined}
      data-truncated={row.truncation !== null ? "true" : undefined}
    >
      <div className="tests-artifacts__line">
        <Icon aria-hidden className="tests-artifacts__icon" />
        <span className="sr-only">{row.kindLabel}: </span>

        <span className="tests-artifacts__name" title={row.coverage !== null ? row.name : undefined}>
          {row.coverage === null ? (
            row.name
          ) : (
            <>
              {COVERAGE_LABEL} {row.coverage.percent}
              {row.coverage.delta !== null && (
                <>
                  {" "}
                  <span className={cx("tests-artifacts__delta", DELTA_CLASS[row.coverage.delta.tone])}>
                    {row.coverage.delta.text}
                  </span>
                </>
              )}
            </>
          )}
          {row.size !== null && (
            <>
              {" "}
              <span className="tests-artifacts__size">{row.size}</span>
            </>
          )}
        </span>

        {row.truncation !== null && <Chip tone="warn">{TRUNCATED}</Chip>}
        {row.expired && <Chip>{EXPIRED}</Chip>}

        {row.open?.mode === "inline" && (
          <button
            aria-controls={open ? viewerId : undefined}
            aria-expanded={open}
            aria-label={row.open.label}
            className="tests-artifacts__open"
            onClick={onToggle}
            type="button"
          >
            {OPEN_GLYPH}
          </button>
        )}
        {row.open?.mode === "download" && (
          <a aria-label={row.open.label} className="tests-artifacts__open" download href={row.open.url}>
            {OPEN_GLYPH}
          </a>
        )}
      </div>

      {row.truncation !== null && <p className="tests-artifacts__reason">{row.truncation}</p>}

      {open && row.open?.mode === "inline" && (
        <ArtifactViewer id={viewerId} name={row.name} onClose={onToggle} read={read} url={row.open.url} />
      )}
    </li>
  );
}

/** What the card is told. */
export interface ArtifactsCardProps {
  /** The rows, from `artifactsView` — or `null` while the attempt's page has not been read. */
  readonly view: ArtifactsView | null;
  /** How the inline viewer reads a file. Production passes none. */
  readonly read?: ArtifactReader;
}

/**
 * The artifacts card ([#341](https://github.com/NobuData/ouroboros/issues/341)) — mockup 11's
 * `ARTIFACTS · retained 30d`: one row per file the build uploaded, and its coverage.
 *
 * **The tag is the workspace's policy**, as the payload states it; with no live file there is no
 * tag.
 *
 * **A text artifact opens in place; anything else downloads.** One viewer is open at a time, and
 * which one is this card's own state — it is not in the address, because a file's text is not a
 * place. A row that stops being openable while its viewer is open — the retention sweep took it,
 * or another attempt is on screen — closes with it.
 *
 * **A tombstone has no affordance**, and a truncated row says why it was cut short.
 *
 * **It scrolls inside its own wrapper**, so a long list never moves the pane.
 *
 * Every value is `artifacts.ts`'s; this file only draws.
 *
 * @param props See {@link ArtifactsCardProps}.
 * @returns The card.
 */
export function ArtifactsCard({ view, read }: ArtifactsCardProps) {
  const titleId = useId();
  const [opened, setOpened] = useState<string | null>(null);

  return (
    <Card aria-labelledby={titleId} as="section" className="tests-artifacts">
      <CardHead
        title={ARTIFACTS_TITLE}
        titleId={titleId}
        trailing={view !== null && view.tag !== null ? <Tag>{view.tag}</Tag> : undefined}
      />

      {view === null && <p className="tests-artifacts__note">{READING_ARTIFACTS}</p>}
      {view !== null && view.note !== null && <p className="tests-artifacts__note">{view.note}</p>}

      {view !== null && view.rows.length > 0 && (
        <div className="tests-artifacts__scroll">
          <ul aria-label={ARTIFACTS_LIST_LABEL} className="tests-artifacts__list">
            {view.rows.map((row) => (
              <ArtifactRow
                key={row.key}
                onToggle={() => setOpened(opened === row.key ? null : row.key)}
                open={opened === row.key}
                read={read}
                row={row}
              />
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
