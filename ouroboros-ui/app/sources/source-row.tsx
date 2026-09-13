import type { TicketSource, TicketSourceCatalogEntry } from "@/app/api/sources";
import type { Reading } from "@/app/api/reading";
import type { TicketSourceStatusReport } from "@/app/api/sources";
import { monogramOf } from "@/app/catalog-tiles";
import { Chip, Tag, cx } from "@/app/ui";

import { ConfigureSource } from "./configure-source";
import { SourceControls } from "./source-controls";
import { type SyncLine, labelOf, lastSyncLine, statusPill, summaryOf, syncLine } from "./view";

import "./sources.css";

/**
 * One source, as mockup 17's list draws it
 * ([#141](https://github.com/NobuData/ouroboros/issues/141)):
 *
 * ```
 * [GH] GitHub · acme-robotics   GitHub  ● active
 *      acme-robotics · 4 repositories
 *      synced 40s ago
 *                                        [Test connection] [Sync now] [Pause] [Configure]
 * ```
 *
 * A Server Component: the row's words are `view.ts`'s decisions over the listing and the
 * status report, and the two client islands — the three live controls and the configure
 * dialog — are mounted with what they need and nothing else. The status's `running` is what
 * turns the chip into the pulsing *syncing* and the second line into *syncing…*; a status
 * that could not be read leaves the row on the listing's own columns, which carry the same
 * three facts.
 */

/** The modifier each tone of the second line adds — written out so the sheet's suite can find each. */
const SYNC_TONE_CLASS: Record<SyncLine["tone"], string> = {
  ok: "sources-row__sync--ok",
  neutral: "sources-row__sync--neutral",
  err: "sources-row__sync--err",
  accent: "sources-row__sync--accent",
};

/** What the row takes. */
export interface SourceRowProps {
  /** The source. */
  readonly source: TicketSource;
  /** Its status report — read, or explained — or `null` when the listing itself failed. */
  readonly status: Reading<TicketSourceStatusReport> | null;
  /** The catalog entry for its kind, or `null` when the catalog could not be read. */
  readonly entry: TicketSourceCatalogEntry | null;
  /** Whether this reader may press a control. */
  readonly mayAdminister: boolean;
  /** The instant the page was read. */
  readonly now: Date;
}

/**
 * The row.
 *
 * @param props See {@link SourceRowProps}.
 * @returns The list item.
 */
export function SourceRow({ source, status, entry, mayAdminister, now }: SourceRowProps) {
  const headingId = `source-${source.id}-name`;
  const report = status?.ok === true ? status.value : null;
  const pill = statusPill(source.status, report?.running === true);
  const line = syncLine(source, report, now);
  const last = lastSyncLine(report);

  return (
    <li
      aria-labelledby={headingId}
      className={cx(
        "sources-row",
        source.status === "paused" && "sources-row--paused",
        source.status === "error" && "sources-row--error",
      )}
    >
      <span aria-hidden="true" className="sources-row__monogram">
        {monogramOf(labelOf(source.kind))}
      </span>

      <div className="sources-row__identity">
        <div className="sources-row__head">
          <h2 className="sources-row__name" id={headingId}>
            {source.displayName}
          </h2>
          <Tag>{labelOf(source.kind)}</Tag>
          <Chip dot={pill.dot} tone={pill.tone}>
            {pill.label}
          </Chip>
        </div>
        <p className="sources-row__summary">{summaryOf(source, entry?.fields ?? null)}</p>
        <p className={cx("sources-row__sync", SYNC_TONE_CLASS[line.tone])}>{line.text}</p>
        {last !== null && <p className="sources-row__last">{last}</p>}
      </div>

      <div className="sources-row__actions">
        <SourceControls mayAdminister={mayAdminister} source={source} status={report} />
        <ConfigureSource entry={entry} mayAdminister={mayAdminister} source={source} />
      </div>
    </li>
  );
}
