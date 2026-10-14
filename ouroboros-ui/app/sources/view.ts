/**
 * Every decision the ticket-sources page makes about what a row *says*, as functions with
 * inputs and outputs ([#141](https://github.com/NobuData/ouroboros/issues/141)).
 *
 * Mockup 17's list draws a kind badge, a status dot, a one-line summary — *acme-robotics · 2
 * repos · synced 40s ago* — and, when syncing has stopped, the honest reason: *rate limited
 * until 14:20*. Each of those is a judgement about the service's answers rather than markup,
 * so each lives here as a rule with a unit test. `app/sources/source-row.tsx` draws.
 *
 * **Framework-free and pure**, the way `app/providers/cards.ts` is.
 *
 * ### The summary is drawn from the provider's own fields
 *
 * The acceptance criterion is *no hard-coded GitHub form*, and the summary keeps it too:
 * {@link summaryOf} walks the catalog entry's fields — the ones the provider declared — and
 * prints each non-secret value, a list as a count under its own label. Nothing here knows
 * that a GitHub source has a `login` and a `repos`; it knows that the entry said *GitHub
 * account* and *Repositories*, and prints what the row holds under each. When the catalog
 * could not be read, the stored config's own keys stand in, so a summary is never blank.
 *
 * ### The reason is the service's sentence, and the status is its word
 *
 * `statusReason` is composed by `ouroboros-rest` from the four-word taxonomy every provider
 * fails in — `rate limited until 14:20 UTC`, `credentials rejected (401)` — and this module
 * prints it as it arrives. It decides only which hue and which dot carry the word beside it,
 * and it does that from `status`, which is the loop's own filter rather than a guess.
 */

import type {
  TicketSource,
  TicketSourceFormField,
  TicketSourceKind,
  TicketSourceStatus,
  TicketSourceStatusReport,
  TicketSourceTest,
} from "@/app/api/sources";
import { relativeAgo } from "@/app/format";
import type { ChipDot, ChipTone } from "@/app/ui";

/* --------------------------------------------------------------------------- the page */

/** The page's title — mockup 17's *Ticket sources* section, and the tab that leads here. */
export const SOURCES_TITLE = "Ticket sources";

/** The page-head subline: what the surface is for, in the issue's own framing. */
export const SOURCES_SUBLINE =
  "Where this workspace's tickets come from. Connect a tracker, test it before trusting it, " +
  "and see honestly why syncing has stopped.";

/** The head's primary action. */
export const ADD_SOURCE_LABEL = "+ Add source";

/** The list's accessible name. */
export const LIST_LABEL = "Ticket sources";

/* --------------------------------------------------------------------------- the kind */

/**
 * The tile and badge labels for the five kinds the contract declares.
 *
 * Copy, not behaviour: the contract's `TicketSourceKind` is the whole input, and a kind not in
 * the map — which the `Record` makes impossible today — would be labelled by its own name.
 */
export const KIND_LABELS: Readonly<Record<TicketSourceKind, string>> = {
  github: "GitHub",
  gitlab: "GitLab",
  jira: "Jira",
  linear: "Linear",
  custom: "Custom",
};

/**
 * The label for a kind.
 *
 * @param kind The kind, as the service spells it.
 * @returns The product's spelling where there is one, and the kind itself otherwise.
 */
export function labelOf(kind: string): string {
  return (KIND_LABELS as Readonly<Partial<Record<string, string>>>)[kind] ?? kind;
}

/* --------------------------------------------------------------------------- the pill */

/** The status chip: a hue, a dot, and the word — never the hue alone. */
export interface StatusPill {
  readonly tone: ChipTone;
  readonly dot: ChipDot;
  readonly label: string;
}

/**
 * The chip for a status.
 *
 * `active` is the working state and reads as healthy; `paused` is a person's choice and reads
 * as neutral, with the ring that the design system gives a state nobody *reported*; `error`
 * is the loop's report and reads as failed. A row that is syncing right now gets the pulse,
 * which is the mockups' halo for a thing happening at this moment.
 *
 * @param status The row's status.
 * @param running Whether a sync is in flight.
 * @returns The chip.
 */
export function statusPill(status: TicketSourceStatus, running = false): StatusPill {
  if (running) return { tone: "accent", dot: "pulse", label: "syncing" };

  switch (status) {
    case "active":
      return { tone: "ok", dot: "filled", label: "active" };
    case "paused":
      return { tone: "neutral", dot: "ring", label: "paused" };
    case "error":
      return { tone: "err", dot: "filled", label: "error" };
  }
}

/* ------------------------------------------------------------------------ the summary */

/**
 * The row's one-line summary — *acme-robotics · 4 repositories* — from the provider's own
 * fields.
 *
 * @param source The source.
 * @param fields The catalog entry's fields for its kind, or `null` when the catalog could
 *   not be read.
 * @returns The values joined with a middle dot: a string as itself, a list as a count under
 *   the field's label. The kind's label when there is nothing to say.
 */
export function summaryOf(
  source: Pick<TicketSource, "kind" | "config">,
  fields: readonly TicketSourceFormField[] | null,
): string {
  const parts =
    fields === null
      ? Object.entries(source.config).map(([key, value]) => part(key, value))
      : fields
          .filter((field) => field.widget !== "secret")
          .map((field) => part(field.label, source.config[field.name]));

  const said = parts.filter((text): text is string => text !== null);

  return said.length === 0 ? labelOf(source.kind) : said.join(" · ");
}

/**
 * One summary part.
 *
 * @param label The field's label — or, with no catalog, its key.
 * @param value What the row holds for it.
 * @returns A string as itself, a list as `4 repositories`, and null for anything else.
 */
function part(label: string, value: unknown): string | null {
  if (typeof value === "string") return value.length === 0 ? null : value;
  if (Array.isArray(value)) return `${String(value.length)} ${countNoun(value.length, label)}`;

  return null;
}

/**
 * A field's label as the noun after a count — *Repositories* → *4 repositories*, *1 repository*.
 *
 * @param count How many.
 * @param label The label.
 * @returns The label lower-cased, and singular for a count of one — *repositories* to
 *   *repository*, *boards* to *board*.
 */
function countNoun(count: number, label: string): string {
  const noun = label.toLowerCase();

  if (count !== 1) return noun;
  if (noun.endsWith("ies")) return `${noun.slice(0, -3)}y`;
  if (noun.endsWith("s")) return noun.slice(0, -1);

  return noun;
}

/* ------------------------------------------------------------------------ the sync line */

/** What the row prints for a source that has never been synced. */
export const NEVER_SYNCED = "never synced";

/** What the row prints while a sync is in flight. */
export const SYNCING = "syncing…";

/**
 * The freshness phrase — *synced 40s ago*, or {@link NEVER_SYNCED}.
 *
 * @param syncedAt When the last successful sync finished, or null.
 * @param now The instant the page was read.
 * @returns The phrase.
 */
export function syncedLabel(syncedAt: string | null, now: Date): string {
  return syncedAt === null ? NEVER_SYNCED : `synced ${relativeAgo(syncedAt, now)}`;
}

/** The row's second line: what it says, and the hue it says it in. */
export interface SyncLine {
  readonly text: string;
  readonly tone: "ok" | "neutral" | "err" | "accent";
}

/**
 * The row's second line.
 *
 * An `error` row prints the service's reason and nothing else — *rate limited until 14:20 UTC*
 * is the sentence the acceptance criterion asks for, and burying it after a freshness phrase
 * would be the honest reason said second. A paused row says so before its freshness; a
 * running one says it is running; an active one says how fresh it is.
 *
 * @param source The source.
 * @param status The loop's report for it, or null when it could not be read.
 * @param now The instant the page was read.
 * @returns The line.
 */
export function syncLine(
  source: Pick<TicketSource, "status" | "statusReason" | "syncedAt">,
  status: Pick<TicketSourceStatusReport, "running"> | null,
  now: Date,
): SyncLine {
  if (status?.running === true) return { text: SYNCING, tone: "accent" };

  if (source.status === "error") {
    return { text: source.statusReason ?? UNEXPLAINED_ERROR, tone: "err" };
  }

  const fresh = syncedLabel(source.syncedAt, now);

  if (source.status === "paused") return { text: `paused · ${fresh}`, tone: "neutral" };

  return { text: fresh, tone: "ok" };
}

/** What an `error` row prints when the service gave no reason — which the contract forbids. */
export const UNEXPLAINED_ERROR = "sync stopped — the service gave no reason";

/**
 * What the last sync did, in a line — *imported 2 · updated 1 · unchanged 6*.
 *
 * @param report The loop's report, or null.
 * @returns The line, or null when this process has synced the source none — which is
 *   different from *found nothing* and is drawn as nothing rather than as zeros.
 */
export function lastSyncLine(report: TicketSourceStatusReport | null): string | null {
  const last = report?.lastSync ?? null;

  if (last === null) return null;

  if (last.outcome !== "synced") return last.reason;

  const counts = [
    `imported ${String(last.imported)}`,
    `updated ${String(last.updated)}`,
    `unchanged ${String(last.unchanged)}`,
  ];

  return `last sync ${counts.join(" · ")}${last.hasMore ? " · more waiting" : ""}`;
}

/* ------------------------------------------------------------------------ the controls */

/** The three row actions' labels. */
export const TEST_LABEL = "Test connection";
export const SYNC_LABEL = "Sync now";
export const PAUSE_LABEL = "Pause";
export const RESUME_LABEL = "Resume";
export const CONFIGURE_LABEL = "Configure";

/** What the controls say while they work. */
export const TESTING = "testing…";
export const SYNC_STARTING = "starting…";
export const PAUSING = "pausing…";
export const RESUMING = "resuming…";

/** Why a member's controls are inert. */
export const TEST_READ_ONLY = "Testing a source is for workspace owners and admins.";
export const SYNC_READ_ONLY = "Syncing a source is for workspace owners and admins.";
export const PAUSE_READ_ONLY = "Pausing a source is for workspace owners and admins.";
export const CONFIGURE_READ_ONLY = "Configuring a source is for workspace owners and admins.";

/** Why **Sync now** is inert on a paused row. */
export const SYNC_PAUSED = "This source is paused. Resume it to sync it.";

/**
 * Why **Sync now** is inert while the minimum interval has not passed.
 *
 * @param seconds How long, from the status report's `retryAfterSeconds`.
 * @returns The tooltip.
 */
export function syncWaitReason(seconds: number): string {
  return `Synced a moment ago — try again in ${String(seconds)}s.`;
}

/** What the controls say when the request itself could not run. */
export const TEST_FAILED = "The test could not run. Nothing was changed — try again in a moment.";
export const SYNC_FAILED = "The sync could not be started. Try again in a moment.";
export const PAUSE_FAILED = "The change could not be made. Try again in a moment.";
export const SOURCE_GONE = "This source has been removed. Reload the page.";

/** What a sync's acceptance says. */
export const SYNC_STARTED = "Sync started — the row refreshes when it lands.";

/** What the sync control says when the service refused because one is running. */
export const SYNC_RUNNING = "A sync of this source is already running.";

/** What the sync control says when the service refused because the source is paused. */
export const SYNC_REFUSED_PAUSED = "This source is paused. Resume it before syncing.";

/**
 * What the sync control says when the service refused because one ran a moment ago.
 *
 * @param seconds The service's `details.retryAfterSeconds`.
 * @returns The sentence.
 */
export function syncTooSoon(seconds: number): string {
  return `Synced less than a minute ago. Try again in ${String(seconds)}s.`;
}

/* ------------------------------------------------------------------------ the test note */

/** The glyph before a test note, by tone. */
export const GLYPHS = { ok: "✓", err: "✗" } as const;

/** What the test note draws. */
export interface TestNote {
  readonly tone: keyof typeof GLYPHS;
  readonly glyph: (typeof GLYPHS)[keyof typeof GLYPHS];
  /** The service's words: the provider's detail on a pass, the reason and the detail on a failure. */
  readonly text: string;
}

/**
 * The note **Test connection** draws from what the provider found.
 *
 * A pass prints the provider's own detail — *acme-robotics · 4 repositories* — because a bare
 * tick cannot say somebody pointed the source at the wrong account. A failure prints the
 * taxonomy's sentence first, so it reads the same as the row would had a sync failed this
 * way, and the provider's own words after it.
 *
 * @param result What the service answered.
 * @returns The note.
 */
export function testNote(result: TicketSourceTest): TestNote {
  if (result.status === "ok") return { tone: "ok", glyph: GLYPHS.ok, text: result.detail };

  const reason = result.reason ?? "failed";

  return {
    tone: "err",
    glyph: GLYPHS.err,
    text: result.detail.length === 0 ? reason : `${reason} — ${result.detail}`,
  };
}

/* ------------------------------------------------------------------- removing a source */

/** The row's control. */
export const REMOVE_LABEL = "Remove";

/** Why the control is inert for a reader who may not remove. */
export const REMOVE_READ_ONLY = "Removing a source is for workspace owners and admins.";

/** The dialog's title; the source's name follows it. */
export const REMOVE_DIALOG_TITLE = "Remove source";

/** What the dialog says while the counts are being read. */
export const REMOVE_READING = "Reading what this source has mirrored…";

/** What the dialog says when the counts could not be read. Nothing is removed unseen. */
export const REMOVE_UNREAD =
  "What this source has mirrored could not be read just now, so it cannot be removed yet. " +
  "Close this and try again in a moment.";

/** The sentence over the counts. */
export const REMOVE_INTRO = "Removing this source also removes what Ouroboros mirrored through it:";

/** What stays, said under the counts. */
export const REMOVE_KEPT =
  "Nothing on the tracker is touched: the issues and pull requests themselves stay where they " +
  "are. Runs that already happened keep their own record.";

/** What cannot be got back. */
export const REMOVE_IRREVERSIBLE =
  "This cannot be undone. Adding the source again syncs its open tickets again, but the " +
  "estimates and pull request records removed here do not come back.";

/** Why a source the Build Analyzer drafted into cannot be removed, and what to do instead. */
export const REMOVE_BLOCKED =
  "This source cannot be removed: the Build Analyzer has drafted tickets into a batch that " +
  "targets it, and that record is kept. Pause the source instead.";

/** The control that removes, and the one that does not. */
export const REMOVE_CONFIRM = "Remove source";
export const REMOVE_CANCEL = "Keep it";

/** Why the controls are inert while a removal is in flight. */
export const REMOVING = "Removing…";

/** What the dialog says when the removal failed for a reason it has no sentence for. */
export const REMOVE_FAILED =
  "The source could not be removed just now. Nothing was removed — try again in a moment.";

/**
 * A count with its noun, singular or plural.
 *
 * @param count How many.
 * @param one The noun for one.
 * @param many The noun for any other number.
 * @returns `1 ticket`, `77 tickets`, `0 tickets`.
 */
function counted(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

/**
 * The lines of the removal dialog's list: what goes with the source.
 *
 * Every line is drawn, a zero included — *0 pull request records* is an answer, and a line
 * that vanished would leave a reader wondering whether it was counted.
 *
 * @param removal What the service counted.
 * @returns Three lines: tickets, pull request records, draft batches.
 */
export function removalLines(removal: {
  readonly tickets: number;
  readonly pullRequests: number;
  readonly draftBatches: number;
}): readonly string[] {
  return [
    `${counted(removal.tickets, "ticket", "tickets")}, estimates and dependencies included`,
    `${counted(removal.pullRequests, "pull request record", "pull request records")}, gates, reviews and approvals included`,
    `${counted(removal.draftBatches, "Planning draft batch", "Planning draft batches")} targeting it`,
  ];
}

/* --------------------------------------------------------------------- the backlog token */

/**
 * The card's anchor on the page — where the Issues page's *Open settings* control lands
 * ([#1250](https://github.com/NobuData/ouroboros/issues/1250)).
 */
export const BACKLOG_TOKEN_ANCHOR = "backlog-token";

/** The card's title. */
export const BACKLOG_TOKEN_TITLE = "Backlog token";

/** What the token is for, and the mistake the card exists to prevent. */
export const BACKLOG_TOKEN_NOTE =
  "The Issues backlog reads GitHub with this token. It is separate from a source's " +
  "credential: a token stored on a source above does not start the backlog.";

/** The state line when nothing is stored. */
export const BACKLOG_TOKEN_NONE = "No token is stored, so the Issues backlog is paused.";

/** The state line when the service could not say. */
export const BACKLOG_TOKEN_UNREAD =
  "The token's state could not be read just now. Saving a token still works.";

/** What a reader who may not set it is told instead of the form. */
export const BACKLOG_TOKEN_READ_ONLY =
  "The backlog token is set, replaced and removed by a workspace owner or admin.";

/** The input's label. */
export const BACKLOG_TOKEN_FIELD_LABEL = "GitHub token";

/** The input's hint: the shape the service takes, and what the token must be able to do. */
export const BACKLOG_TOKEN_FIELD_HINT =
  "Starts with github_pat_, ghp_, gho_, ghu_, ghs_ or ghr_. It needs read access to issues " +
  "on every repository enabled for this workspace.";

/**
 * The shape the service accepts, as the input's `pattern` — `github.token.ts`'s rule in
 * `ouroboros-rest`: a known prefix, or a forty-character hexadecimal classic token, and no
 * whitespace. The service checks again; this only saves a round trip on a paste error.
 */
export const BACKLOG_TOKEN_PATTERN =
  "(github_pat_|ghp_|gho_|ghu_|ghs_|ghr_)\\S+|[0-9a-f]{40}";

/** The shortest and longest token the service takes. */
export const BACKLOG_TOKEN_MIN_LENGTH = 20;
export const BACKLOG_TOKEN_MAX_LENGTH = 255;

/** The submit control, with nothing stored and with something to replace. */
export const BACKLOG_TOKEN_SAVE = "Save token";
export const BACKLOG_TOKEN_REPLACE = "Replace token";

/** Why the submit control is inert while a write is in flight. */
export const BACKLOG_TOKEN_SAVING = "Saving…";

/** The control that starts a removal, and the two that settle it. */
export const BACKLOG_TOKEN_REMOVE = "Remove token";
export const BACKLOG_TOKEN_REMOVE_CONFIRM = "Remove it";
export const BACKLOG_TOKEN_REMOVE_CANCEL = "Keep it";

/** What is asked before a removal. */
export const BACKLOG_TOKEN_REMOVE_QUESTION =
  "Remove the token? The Issues backlog pauses until another is saved.";

/** Why the removal controls are inert while one is in flight. */
export const BACKLOG_TOKEN_REMOVING = "Removing…";

/** What the card says once a token is stored. */
export const BACKLOG_TOKEN_SAVED = "Saved. The backlog picks it up on its next sync.";

/** What the card says once the token is removed. */
export const BACKLOG_TOKEN_REMOVED = "Removed. The Issues backlog is paused.";

/** What the card says when the service refused the value's shape. */
export const BACKLOG_TOKEN_SHAPE =
  "That does not look like a GitHub token. Paste the whole token, with no spaces.";

/** What the card says to somebody whose role changed while the page was open. */
export const BACKLOG_TOKEN_FORBIDDEN =
  "Only a workspace owner or admin may change the backlog token.";

/** What the card says when a write failed for any other reason. */
export const BACKLOG_TOKEN_FAILED =
  "The token could not be changed just now. Nothing was stored — try again in a moment.";

/**
 * The state line for a stored token: its mask and when it was set, and when it was last
 * replaced if it has been.
 *
 * @param token What the service says about it — `configured` is true.
 * @returns `ghp_••••3456 · set 2026-09-12`, with ` · replaced 2026-10-01` after a rotation.
 */
export function backlogTokenState(token: {
  readonly masked: string | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
}): string {
  const parts = [token.masked ?? ""];

  if (token.createdAt !== null) parts.push(`set ${dayOf(token.createdAt)}`);
  if (token.createdAt !== null && token.updatedAt !== null && token.updatedAt > token.createdAt) {
    parts.push(`replaced ${dayOf(token.updatedAt)}`);
  }

  return parts.filter((part) => part.length > 0).join(" · ");
}

/**
 * The calendar day of an instant, in UTC — a fixed form, so the line reads the same on the
 * server and in every reader's browser.
 *
 * @param instant An ISO 8601 instant.
 * @returns `YYYY-MM-DD`, or the text itself when it is not an instant.
 */
function dayOf(instant: string): string {
  const at = new Date(instant);

  return Number.isNaN(at.getTime()) ? instant : at.toISOString().slice(0, 10);
}
