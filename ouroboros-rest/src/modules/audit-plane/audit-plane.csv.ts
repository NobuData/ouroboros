/**
 * The audit export's CSV — a stable column contract, and the one function that turns an event
 * resource into a line (BR.2, [#486](https://github.com/NobuData/ouroboros/issues/486)).
 *
 * **Stable columns.** {@link AUDIT_CSV_COLUMNS} is the contract an auditor's spreadsheet is built
 * against; a column is only ever appended, never renamed, removed or reordered.
 *
 * **Content equals the filtered view.** Each line is an `AuditPlaneEventResource` — the exact
 * object the list endpoint answers with — flattened, so the export and the page cannot disagree.
 *
 * **RFC 4180, and safe to open.** A cell is quoted when it holds a comma, quote or line break, with
 * quotes doubled. A cell that a spreadsheet would read as a formula (`=`, `+`, `-`, `@`, a tab or a
 * carriage return first) is prefixed with `'` — CSV injection. Audit content includes names and
 * notes people typed, so the file an auditor double-clicks must not run anything.
 */

import type { AuditPlaneEventResource } from "./audit-plane.resources";

/** The columns, in order. Append only. */
export const AUDIT_CSV_COLUMNS = [
  "occurred_at",
  "actor_kind",
  "actor",
  "actor_id",
  "actor_service",
  "event",
  "action",
  "plane",
  "subject_type",
  "subject_id",
  "ip",
  "detail",
  "id",
] as const;

/** The export's media type. */
export const AUDIT_CSV_MEDIA_TYPE = "text/csv; charset=utf-8";

/** Leading characters a spreadsheet treats as the start of a formula. */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/** Characters that force a cell to be quoted. */
const NEEDS_QUOTES = /[",\r\n]/;

/**
 * One cell.
 *
 * @param value - The value; `null` is an empty cell.
 * @returns The escaped cell.
 */
export function csvCell(value: string | null): string {
  if (value === null) return "";

  const safe = FORMULA_LEAD.test(value) ? `'${value}` : value;

  return NEEDS_QUOTES.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/**
 * The header line.
 *
 * @returns The column names, CRLF-terminated.
 */
export function csvHeader(): string {
  return `${AUDIT_CSV_COLUMNS.join(",")}\r\n`;
}

/**
 * One event as one line.
 *
 * @param event - The event, exactly as the list endpoint renders it.
 * @returns The line, CRLF-terminated.
 */
export function csvLine(event: AuditPlaneEventResource): string {
  const cells: Record<(typeof AUDIT_CSV_COLUMNS)[number], string | null> = {
    occurred_at: event.occurredAt,
    actor_kind: event.actorKind,
    actor: event.actor,
    actor_id: event.actorId,
    actor_service: event.actorService,
    event: event.event,
    action: event.action,
    plane: event.plane,
    subject_type: event.subjectType,
    subject_id: event.subjectId,
    ip: event.ip,
    detail: JSON.stringify(event.detail),
    id: event.id,
  };

  return `${AUDIT_CSV_COLUMNS.map((column) => csvCell(cells[column])).join(",")}\r\n`;
}
