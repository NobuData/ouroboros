/**
 * The Audit Log card's copy and rules, as values
 * (BS.5, [#495](https://github.com/NobuData/ouroboros/issues/495)) — mockup 17's `c-5` card.
 *
 * The card is a **window onto a log that gets large**: today's newest rows by default, and behind
 * the filters the whole log, keyset-paged. Everything that decides what the card says or sends is
 * here — the filter form and the query it becomes, the export's bounded range and its address, how
 * a row is stamped, and every sentence — so the components draw and this file can be tested as
 * itself.
 *
 * ### Every time on the card is UTC, and the card says so
 *
 * The today view is read in the service's default zone and the filter's days are UTC days, so one
 * day means one thing on the rows, in the range and in the export. The head's tag names the zone
 * once rather than every row repeating it.
 *
 * Framework-free and pure.
 */

import type { AuditActorKind, AuditLogEvent, AuditLogFilter, AuditLogPage } from "@/app/api/settings-audit";
import type { MembersPage, ServiceAccountList } from "@/app/api/settings-members";

/* ------------------------------------------------------------------ the head and the rows */

/** The head's tag while the card shows today's rows. */
export const TODAY_TAG = "today · UTC";

/** The head's tag while the card shows the filtered log. */
export const FILTERED_TAG = "filtered · UTC";

/** What the card says on a day nothing has happened yet. */
export const TODAY_EMPTY = "Nothing has been recorded yet today.";

/** What the card says when today holds more events than its rows. */
export const TODAY_MORE = "Today has more events than are shown here.";

/** The control that opens the whole of today in the filtered log. */
export const TODAY_MORE_ACTION = "Show all of today";

/** The class each actor kind's name is drawn with — literals, so the style suite sees every one. */
export const ACTOR_KIND_CLASS: Readonly<Record<AuditActorKind, string>> = {
  human: "audit-log__actor--human",
  bot: "audit-log__actor--bot",
  service: "audit-log__actor--service",
  system: "audit-log__actor--system",
};

/** What each actor kind is called — the select's options, and the word a row carries as text. */
export const ACTOR_KIND_LABELS: Readonly<Record<AuditActorKind, string>> = {
  human: "person",
  bot: "bot",
  service: "service account",
  system: "system",
};

/** The actor kinds, in the order the select lists them. */
export const ACTOR_KINDS: readonly AuditActorKind[] = ["human", "bot", "service", "system"];

/**
 * The footer's retention tag — `retained 400d`.
 *
 * @param days The workspace's `audit` retention tier, as the today view reports it.
 * @returns The tag.
 */
export function retainedTag(days: number): string {
  return `retained ${String(days)}d`;
}

/**
 * A log row's stamp: the UTC date and time, because the filtered log spans days.
 *
 * @param occurredAt The event's instant, ISO-8601.
 * @returns `2026-10-05 14:31`, or the input unchanged when it is not a date.
 */
export function stampOf(occurredAt: string): string {
  const at = new Date(occurredAt);
  if (Number.isNaN(at.getTime())) return occurredAt;

  return at.toISOString().slice(0, 16).replace("T", " ");
}

/* ------------------------------------------------------------------ who the seat is for */

/** What the Audit seat prints for a reader below admin, for whom the log is never requested. */
export const AUDIT_ADMINS_ONLY =
  "The audit log is read by owners and admins. Ask one of them for what you need from it.";

/**
 * The sentence the seat prints when today's read failed.
 *
 * @param reason The service's own sentence for the failure.
 * @returns Who reads the log, and why it could not be read here.
 */
export function auditUnread(reason: string): string {
  return `The audit log is read by owners and admins, and could not be read here: ${reason}`;
}

/* ------------------------------------------------------------------ the actor select */

/** One choice of the actor select. */
export interface AuditActorOption {
  /** `id:<userId>` for a person, `service:<name>` for a service account or the bot. */
  readonly value: string;
  /** What the option says. */
  readonly label: string;
}

/** The bot's service name — always an option, because it acts in every workspace. */
export const BOT_SERVICE = "ouroboros-app";

/** The prefix of an option that names a person. */
const PERSON_PREFIX = "id:";

/** The prefix of an option that names a service account or the bot. */
const SERVICE_PREFIX = "service:";

/**
 * The actor select's options: people by user id, service accounts by name, and always the bot.
 *
 * @param members The members page as read, or `null` when it could not be.
 * @param serviceAccounts The administrator's service-account list, or `null`. Without it the
 *   members page's own service rows are used.
 * @returns The options, each value once, in that order.
 */
export function actorOptions(
  members: MembersPage | null,
  serviceAccounts: ServiceAccountList | null,
): readonly AuditActorOption[] {
  const people = (members?.members ?? []).map((member) => ({
    value: `${PERSON_PREFIX}${member.userId}`,
    label: member.name,
  }));
  const names = [
    ...(serviceAccounts?.items ?? []).map((account) => account.name),
    ...(members?.serviceAccounts ?? []).map((account) => account.name),
  ].filter((name) => name !== BOT_SERVICE);
  const services = [...new Set(names)].map((name) => ({
    value: `${SERVICE_PREFIX}${name}`,
    label: `${SERVICE_PREFIX}${name}`,
  }));
  const bot = { value: `${SERVICE_PREFIX}${BOT_SERVICE}`, label: `${BOT_SERVICE}[bot]` };
  const seen = new Set<string>();

  return [...people, ...services, bot].filter((option) => {
    if (seen.has(option.value)) return false;

    seen.add(option.value);
    return true;
  });
}

/* ------------------------------------------------------------------ the filter form */

/** The filter form as typed — every field a string, empty meaning *not narrowed*. */
export interface AuditFilterForm {
  /** The first day, `YYYY-MM-DD`, UTC. */
  readonly from: string;
  /** The last day, `YYYY-MM-DD`, UTC — inclusive here, exclusive on the wire. */
  readonly to: string;
  /** One actor kind, or `""`. */
  readonly actorKind: "" | AuditActorKind;
  /** One actor — an {@link AuditActorOption.value}, or `""`. */
  readonly actor: string;
  /** A plane (`policy`) or one action (`policy.published`). */
  readonly plane: string;
  /** A reference — `pr:509`, `#509`, `run:<id>`, `repo:<ref>`, `key:<id>`, `subject:<id>`. */
  readonly ref: string;
}

/** A form that narrows nothing. */
export const EMPTY_FORM: AuditFilterForm = {
  from: "",
  to: "",
  actorKind: "",
  actor: "",
  plane: "",
  ref: "",
};

/** What is wrong with the form, by field. */
export type AuditFilterErrors = Partial<Record<keyof AuditFilterForm, string>>;

/** The toggle that opens and closes the filters. */
export const FILTERS_LABEL = "filters";
/** The form's accessible name. */
export const FILTERS_TITLE = "Filter the audit log";
/** The field labels. */
export const FROM_LABEL = "From (UTC day)";
export const TO_LABEL = "To (UTC day, inclusive)";
export const ACTOR_KIND_LABEL = "Actor kind";
export const ACTOR_LABEL = "Actor";
export const PLANE_LABEL = "Plane or action";
export const REF_LABEL = "Reference";
/** The option that narrows nothing. */
export const ANY_OPTION = "Any";
/** The plane field's example. */
export const PLANE_HINT = "policy for a whole plane, or policy.published for one action.";
/** The reference field's example. */
export const REF_HINT = "#509 or pr:509, run:<id>, repo:<owner/name>, key:<id>, subject:<id>.";
/** The form's two actions. */
export const APPLY_LABEL = "Apply";
export const CLEAR_LABEL = "Clear";

/** What a day that is not a day is told. */
export const DAY_INVALID = "Enter a day as YYYY-MM-DD.";
/** What a range that ends before it starts is told. */
export const RANGE_REVERSED = "The last day is before the first.";
/** What a plane the service would refuse is told. */
export const PLANE_INVALID =
  "A plane is lower-case letters, digits and underscores — policy, or policy.published for one action.";
/** What a reference the service would refuse is told. */
export const REF_INVALID =
  "A reference is #509, pr:509, run:<id>, repo:<ref>, key:<id> or subject:<id>, without spaces.";

/** The service's action-filter grammar — `policy.*` or `policy.published`. */
const ACTION_FILTER_PATTERN = /^[a-z][a-z0-9_]*\.(\*|[a-z][a-z0-9_]*)$/;
/** The service's reference grammar. */
const REFERENCE_PATTERN = /^(pr|run|repo|key|subject):[^\s,]{1,200}$/;
/** A `YYYY-MM-DD` day. */
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** One day, in milliseconds. */
const DAY_MS = 86_400_000;

/**
 * A UTC day's midnight, in milliseconds.
 *
 * @param day `YYYY-MM-DD`.
 * @returns The instant, or `null` for anything that is not a real day (`2026-02-31`).
 */
export function dayStart(day: string): number | null {
  if (!DAY_PATTERN.test(day)) return null;

  const at = Date.parse(`${day}T00:00:00.000Z`);
  if (Number.isNaN(at)) return null;

  return new Date(at).toISOString().slice(0, 10) === day ? at : null;
}

/**
 * The UTC day an instant falls on.
 *
 * @param instant ISO-8601, or milliseconds.
 * @returns `YYYY-MM-DD`, or `""` when it is not a date.
 */
export function dayOf(instant: string | number): string {
  const at = new Date(instant);

  return Number.isNaN(at.getTime()) ? "" : at.toISOString().slice(0, 10);
}

/**
 * A plane as typed, in the service's spelling.
 *
 * @param text `policy`, `policy.*` or `policy.published`, in any case, with stray spaces.
 * @returns `policy.*` for a bare plane; otherwise the trimmed, lower-cased text.
 */
export function normalisePlane(text: string): string {
  const plane = text.trim().toLowerCase();

  return plane === "" || plane.includes(".") ? plane : `${plane}.*`;
}

/**
 * A reference as typed, in the service's spelling.
 *
 * @param text `#509`, `PR 509`, `pr:509`, `run:<id>` and so on.
 * @returns `pr:509` for the PR shorthands; otherwise the trimmed text.
 */
export function normaliseRef(text: string): string {
  const ref = text.trim();
  const shorthand = /^(?:#|pr\s*#?)(\d+)$/i.exec(ref);

  return shorthand === null ? ref : `pr:${shorthand[1]}`;
}

/**
 * The part of a filter an actor option stands for.
 *
 * @param value An {@link AuditActorOption.value}, or `""`.
 * @returns `{actorId}` for a person, `{actorService}` for a service account or the bot, and
 *   nothing for `""` or a value in neither spelling.
 */
export function actorFilter(value: string): Pick<AuditLogFilter, "actorId" | "actorService"> {
  if (value.startsWith(PERSON_PREFIX)) return { actorId: value.slice(PERSON_PREFIX.length) };
  if (value.startsWith(SERVICE_PREFIX)) return { actorService: value.slice(SERVICE_PREFIX.length) };

  return {};
}

/** The form checked: the filter it becomes, or what is wrong with which fields. */
export type ParsedFilter =
  | { readonly ok: true; readonly filter: AuditLogFilter }
  | { readonly ok: false; readonly errors: AuditFilterErrors };

/**
 * Turn the form into the query the service takes, or say what is wrong with it.
 *
 * The last day is inclusive on the form and exclusive on the wire, so `to` becomes the midnight
 * *after* it. A field left empty contributes nothing.
 *
 * @param form The form as typed.
 * @returns The filter — only the fields that narrow — or an error per refused field.
 */
export function parseFilterForm(form: AuditFilterForm): ParsedFilter {
  const errors: { -readonly [K in keyof AuditFilterForm]?: string } = {};
  const from = form.from === "" ? undefined : dayStart(form.from);
  const to = form.to === "" ? undefined : dayStart(form.to);
  const plane = normalisePlane(form.plane);
  const ref = normaliseRef(form.ref);

  if (from === null) errors.from = DAY_INVALID;
  if (to === null) errors.to = DAY_INVALID;
  if (typeof from === "number" && typeof to === "number" && to < from) errors.to = RANGE_REVERSED;
  if (plane !== "" && !ACTION_FILTER_PATTERN.test(plane)) errors.plane = PLANE_INVALID;
  if (ref !== "" && !REFERENCE_PATTERN.test(ref)) errors.ref = REF_INVALID;

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    filter: {
      ...(typeof from === "number" && { from: new Date(from).toISOString() }),
      ...(typeof to === "number" && { to: new Date(to + DAY_MS).toISOString() }),
      ...(form.actorKind !== "" && { actorKind: form.actorKind }),
      ...actorFilter(form.actor),
      ...(plane !== "" && { action: plane }),
      ...(ref !== "" && { ref }),
    },
  };
}

/**
 * What a filter narrows by, as lines a person reads — the export dialog's *applied filters*.
 * The time range is left out: the export names its own.
 *
 * @param filter The applied filter.
 * @param actors The actor select's options, for a person's name rather than their id.
 * @returns One line per narrowing field; empty when only the range (or nothing) is set.
 */
export function filterSummary(
  filter: AuditLogFilter,
  actors: readonly AuditActorOption[],
): readonly string[] {
  const lines: string[] = [];
  const named = (value: string): string =>
    actors.find((option) => option.value === value)?.label ?? value;

  if (filter.actorKind !== undefined) lines.push(`Actor kind: ${ACTOR_KIND_LABELS[filter.actorKind]}`);
  if (filter.actorId !== undefined) lines.push(`Actor: ${named(`${PERSON_PREFIX}${filter.actorId}`)}`);
  if (filter.actorService !== undefined) {
    lines.push(`Actor: ${named(`${SERVICE_PREFIX}${filter.actorService}`)}`);
  }
  if (filter.action !== undefined) lines.push(`Plane or action: ${filter.action}`);
  if (filter.ref !== undefined) lines.push(`Reference: ${filter.ref}`);

  return lines;
}

/* ------------------------------------------------------------------ the filtered log */

/** How many events one page of the filtered log asks for. */
export const AUDIT_PAGE_SIZE = 50;

/** What the server hop answers: a page, or the sentence to show instead. */
export type AuditLogReading =
  | { readonly ok: true; readonly page: AuditLogPage }
  | { readonly ok: false; readonly reason: string };

/** What the log says while a page is being read. */
export const LOG_LOADING = "Reading the audit log…";
/** What the log says when nothing matches. */
export const LOG_EMPTY = "No events match these filters.";
/** The control that follows the cursor. */
export const LOAD_MORE = "Load more";
/** The same control while its page is in flight. */
export const LOADING_MORE = "Loading…";
/** What a reader below admin who reaches the read is told. */
export const AUDIT_FORBIDDEN =
  "Reading the audit log is for workspace owners and admins. Ask one of them for what you need from it.";
/** What the log says when the read failed and the service gave no sentence. */
export const AUDIT_UNAVAILABLE =
  "The audit log could not be read just now. Nothing was changed — try again in a moment.";

/**
 * The rows after another page: the new ones appended, none twice.
 *
 * A keyset cursor does not repeat a row; this is the defence for a page asked for twice.
 *
 * @param shown The rows already drawn.
 * @param page The rows that just arrived.
 * @returns Both, in order, each id once.
 */
export function mergeEvents(
  shown: readonly AuditLogEvent[],
  page: readonly AuditLogEvent[],
): readonly AuditLogEvent[] {
  const seen = new Set(shown.map((event) => event.id));

  return [...shown, ...page.filter((event) => !seen.has(event.id))];
}

/**
 * The line under the last page — said so that a list that stops is known to be complete.
 *
 * @param count How many events the list holds.
 * @returns `End of log · 37 events`.
 */
export function endOfLog(count: number): string {
  return `End of log · ${String(count)} event${count === 1 ? "" : "s"}`;
}

/* ------------------------------------------------------------------ the export */

/** The footer's button, and the dialog's title. */
export const EXPORT_LABEL = "Export CSV";
export const EXPORT_TITLE = "Export the audit log as CSV";
/** The bounded-range rule, explained. */
export const EXPORT_BOUND_NOTE =
  "An export covers at most 366 days, so a download is never the whole of a long history at once. A longer history is several exports.";
/** That exporting is itself an event. */
export const EXPORT_LOGGED_NOTE = "This export is itself recorded in the audit log, with its range and filters.";
/** The heading over the applied filters, and what is said when there are none. */
export const EXPORT_FILTERS_HEADING = "The export matches the filtered view";
export const EXPORT_NO_FILTERS = "No filters — every event in the range.";
/** The dialog's fields and actions. */
export const EXPORT_FROM_LABEL = "From (UTC day)";
export const EXPORT_TO_LABEL = "To (UTC day, inclusive)";
export const EXPORT_DOWNLOAD = "Download CSV";
export const EXPORT_CLOSE = "Close";
/** What a range the export cannot take is told. */
export const EXPORT_RANGE_REQUIRED = "Choose the first and the last day to export.";
export const EXPORT_RANGE_TOO_LONG = "That range is longer than 366 days. Export it in parts.";

/** The most days one export may cover. */
export const EXPORT_MAX_DAYS = 366;
/** How many days the dialog offers before anybody chooses. */
export const EXPORT_DEFAULT_DAYS = 30;
/** This origin's route for the export (`app/api/settings/audit/export.csv/route.ts`). */
export const EXPORT_ROUTE = "/api/settings/audit/export.csv";

/** An export's range as the dialog holds it: two UTC days, both inclusive. */
export interface ExportRange {
  readonly from: string;
  readonly to: string;
}

/**
 * The range the dialog opens with: the applied filter's, where it has one; otherwise the last
 * thirty days ending today.
 *
 * @param now The moment the dialog was opened.
 * @param filter The applied filter. Its `to` is exclusive, so the day shown is the one before.
 * @returns The two days.
 */
export function defaultExportRange(now: Date, filter: AuditLogFilter = {}): ExportRange {
  const today = dayOf(now.getTime());
  const to = filter.to === undefined ? today : dayOf(Date.parse(filter.to) - 1);
  const end = dayStart(to) ?? now.getTime();
  const from =
    filter.from === undefined ? dayOf(end - (EXPORT_DEFAULT_DAYS - 1) * DAY_MS) : dayOf(filter.from);

  return { from, to };
}

/**
 * Check an export's range in the browser, before anything is asked for.
 *
 * @param range The two days, inclusive.
 * @returns What is wrong with it, or `null` when the service would take it: both are days, the
 *   first is not after the last, and they cover at most {@link EXPORT_MAX_DAYS} days.
 */
export function exportRangeError(range: ExportRange): string | null {
  if (range.from === "" || range.to === "") return EXPORT_RANGE_REQUIRED;

  const from = dayStart(range.from);
  const to = dayStart(range.to);

  if (from === null || to === null) return DAY_INVALID;
  if (to < from) return RANGE_REVERSED;
  // The last day is inclusive, so the span sent is one day longer than the difference.
  if ((to - from) / DAY_MS + 1 > EXPORT_MAX_DAYS) return EXPORT_RANGE_TOO_LONG;

  return null;
}

/**
 * The address a valid export downloads from.
 *
 * @param range The two days, inclusive — already checked by {@link exportRangeError}.
 * @param filter The applied filter. Its own range is replaced by the export's.
 * @returns The route with `from`, the exclusive `to`, and every other field the filter set.
 */
export function exportHref(range: ExportRange, filter: AuditLogFilter = {}): string {
  const query = new URLSearchParams({
    from: new Date(dayStart(range.from) ?? 0).toISOString(),
    to: new Date((dayStart(range.to) ?? 0) + DAY_MS).toISOString(),
  });

  for (const name of ["actorKind", "actorId", "actorService", "action", "ref"] as const) {
    const value = filter[name];
    if (value !== undefined) query.set(name, value);
  }

  return `${EXPORT_ROUTE}?${query.toString()}`;
}
