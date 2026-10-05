"use client";

import { useId, useState } from "react";

import type { AuditLogFilter } from "@/app/api/settings-audit";
import { ShellOverlay } from "@/app/shell/overlay";
import { Button, TextField } from "@/app/ui";

import {
  type AuditActorOption,
  EXPORT_BOUND_NOTE,
  EXPORT_CLOSE,
  EXPORT_DOWNLOAD,
  EXPORT_FILTERS_HEADING,
  EXPORT_FROM_LABEL,
  EXPORT_LOGGED_NOTE,
  EXPORT_NO_FILTERS,
  EXPORT_TITLE,
  EXPORT_TO_LABEL,
  type ExportRange,
  exportHref,
  exportRangeError,
  filterSummary,
} from "./view";

import "./audit-log.css";

/** What {@link ExportDialog} takes. */
export interface ExportDialogProps {
  /** The range to open with, or `null` while the dialog is closed. */
  readonly initial: ExportRange | null;
  /** The filter applied to the card — what the export is narrowed by, beside its range. */
  readonly filter: AuditLogFilter;
  /** The actor select's options, to name an actor rather than print an id. */
  readonly actors: readonly AuditActorOption[];
  /** Close the dialog. */
  readonly onClose: () => void;
}

/**
 * **Export CSV** — the range dialog (BS.5, [#495](https://github.com/NobuData/ouroboros/issues/495)).
 *
 * An export is **obviously bounded**: the dialog asks for a first and a last day, says that one
 * export covers at most 366 days and why, lists the filters it will carry so the file matches the
 * view behind it, and says that the export is itself recorded in the log.
 *
 * ### The download is a link
 *
 * A valid range draws a real `<a download>` to this origin's export route, so the browser
 * streams the body to disk as the service writes it — nothing is fetched into memory here. A
 * range the service would refuse draws the same button inert, with its reason, and no address.
 *
 * @param props See {@link ExportDialogProps}.
 * @returns The dialog.
 */
export function ExportDialog({ initial, filter, actors, onClose }: ExportDialogProps) {
  return (
    <ShellOverlay label={EXPORT_TITLE} onClose={onClose} open={initial !== null}>
      {initial !== null && (
        <ExportForm actors={actors} filter={filter} initial={initial} onClose={onClose} />
      )}
    </ShellOverlay>
  );
}

/**
 * The dialog's content — mounted only while it is open, so each opening starts from its range.
 *
 * @param props.initial The range to start from.
 * @param props.filter The applied filter.
 * @param props.actors The actor select's options.
 * @param props.onClose Close the dialog.
 * @returns The form.
 */
function ExportForm({
  initial,
  filter,
  actors,
  onClose,
}: Readonly<{
  initial: ExportRange;
  filter: AuditLogFilter;
  actors: readonly AuditActorOption[];
  onClose: () => void;
}>) {
  const base = useId();
  const [range, setRange] = useState<ExportRange>(initial);
  const error = exportRangeError(range);
  const applied = filterSummary(filter, actors);

  return (
    <div className="audit-log-export">
      <h2 className="audit-log-export__title">{EXPORT_TITLE}</h2>

      <div className="audit-log-export__range">
        <TextField
          id={`${base}-from`}
          label={EXPORT_FROM_LABEL}
          onChange={(event) => setRange({ ...range, from: event.target.value })}
          type="date"
          value={range.from}
        />
        <TextField
          id={`${base}-to`}
          label={EXPORT_TO_LABEL}
          onChange={(event) => setRange({ ...range, to: event.target.value })}
          type="date"
          value={range.to}
        />
      </div>
      <p className="audit-log-export__note">{EXPORT_BOUND_NOTE}</p>
      {error !== null && (
        <p className="audit-log-export__error" role="alert">
          {error}
        </p>
      )}

      <section aria-labelledby={`${base}-filters`} className="audit-log-export__applied">
        <h3 className="audit-log-export__heading" id={`${base}-filters`}>
          {EXPORT_FILTERS_HEADING}
        </h3>
        {applied.length === 0 ? (
          <p className="audit-log-export__note">{EXPORT_NO_FILTERS}</p>
        ) : (
          <ul className="audit-log-export__list">
            {applied.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
      </section>

      <p className="audit-log-export__note">{EXPORT_LOGGED_NOTE}</p>

      <div className="audit-log-export__actions">
        <Button onClick={onClose}>{EXPORT_CLOSE}</Button>
        {error === null ? (
          <Button download href={exportHref(range, filter)} tone="primary">
            {EXPORT_DOWNLOAD}
          </Button>
        ) : (
          <Button reason={error} tone="primary">
            {EXPORT_DOWNLOAD}
          </Button>
        )}
      </div>
    </div>
  );
}
