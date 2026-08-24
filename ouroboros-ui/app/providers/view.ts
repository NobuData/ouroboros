/**
 * Every decision the credential trail makes, as functions with inputs and outputs.
 *
 * AD.4 ([#225](https://github.com/NobuData/ouroboros/issues/225)) asks for a *minimal* trail
 * UI: a sheet from mockup 07's **Audit log** button showing timestamped rows — time, actor,
 * action, connection — and nothing more, because the full audit surface is mockup 17's
 * territory and duplicating it here would fork that page before it exists.
 *
 * "Minimal" describes the surface, not the care. Four of the sheet's decisions are judgements
 * rather than markup, and they live here so that each one's acceptance criteria are a unit
 * test on a small object rather than an assertion about rendered text.
 *
 * **Framework-free and pure.** Nothing here imports React, `next/*` or the server-only
 * client, the same way `app/models/view.ts` and `app/dashboard/view.ts` are pure.
 *
 * ---------------------------------------------------------------------------
 * ### The rule this module exists to keep
 *
 * A trail's whole value is that it is trustworthy, and there are exactly four ways one lies:
 *
 * 1. **It invents an actor.** `credential.lease_granted` has none — a worker authenticates
 *    with a service key and is not somebody — and a person deleted since leaves none behind.
 *    {@link actorOf} answers with a word that says so, and never with an id.
 * 2. **It renders an action it does not recognise.** {@link SENTENCES} is exhaustive over the
 *    contract's own union, so an eleventh action added to the service is a **build error
 *    here** rather than a row printing `provider.cap_changed` at somebody.
 * 3. **It states a refusal as an act.** *Ken rotated the key* and *Ken tried to rotate the
 *    key and the provider refused it* are different facts, and only `detail.outcome` tells
 *    them apart. {@link outcomeOf} is what stops the second being drawn as the first.
 * 4. **It renders a time in a zone nobody named.** The service sends UTC; a browser renders
 *    in the reader's own zone; and a trail whose rows are labelled neither is a trail two
 *    people compare and disagree about. {@link stampOf} formats in UTC, and the column says
 *    so once.
 */

import type { AuditAction, AuditEvent } from "@/app/api/audit";

/* --------------------------------------------------------------------- what an event says */

/**
 * What each action reads as, in the sheet's own voice.
 *
 * **Past tense, and the subject is the person**, because every row is rendered as *time ·
 * actor · sentence* and the actor is already the first word a reader meets. So the sentence
 * completes it — `Ken · rotated the credential` — rather than restating it.
 *
 * `Record<AuditAction, string>` rather than a lookup with a fallback, and that is the whole
 * point of the type: the contract's union is generated from `openapi.json`, so an action the
 * service learns to write and this map has not learned to render fails `yarn typecheck`. A
 * fallback of `event.action` would render the same situation as a working row with an ugly
 * word in it, which nobody would notice.
 */
export const SENTENCES: Record<AuditAction, string> = {
  "provider.added": "connected the provider",
  "provider.revealed": "revealed the credential",
  "provider.rotated": "rotated the credential",
  "provider.enabled": "switched the provider on",
  "provider.disabled": "switched the provider off",
  "provider.cap_changed": "changed the monthly cap",
  "provider.updated": "edited the provider's settings",
  "provider.deleted": "removed the provider",
  "provider.tested": "tested the provider",
  "credential.lease_granted": "was granted a provider lease",
};

/** Whether the operation a row records did what it was asked to. */
export type AuditOutcome = "success" | "failure";

/**
 * What a row is about — the connection's provider kind, when the payload names one.
 *
 * Every `provider.*` event carries `detail.kind`, and it is what turns *rotated the
 * credential* into *rotated the credential · anthropic* without the sheet having to fetch the
 * connection it names. A lease grant carries the same key for the same reason.
 *
 * @param event The row.
 * @returns The kind, or `null` when the payload names none — a refusal that happened before
 *   the row was read has no provider to name, and inventing one would be worse than a shorter
 *   sentence.
 */
export function kindOf(event: AuditEvent): string | null {
  const kind = event.detail.kind;

  return typeof kind === "string" && kind.length > 0 ? kind : null;
}

/**
 * Whether the operation succeeded.
 *
 * @param event The row.
 * @returns `"failure"` when the payload says so, and `"success"` otherwise. Defaulting to
 *   success is safe in exactly one direction and this is it: every event this service writes
 *   carries the field, so the default is unreachable today — and an event from a future
 *   writer that omitted it is far more likely to be a completion than a refusal nobody
 *   labelled.
 */
export function outcomeOf(event: AuditEvent): AuditOutcome {
  return event.detail.outcome === "failure" ? "failure" : "success";
}

/**
 * Why an operation was refused, in the service's own vocabulary.
 *
 * The **code**, deliberately, and never a message: a message is written for a person and can
 * carry whatever an upstream provider chose to say. The code is a word this product controls
 * and can be grepped for across a trail.
 *
 * @param event The row.
 * @returns The reason, or `null` on a completion and on a refusal that named none.
 */
export function reasonOf(event: AuditEvent): string | null {
  const reason = event.detail.reason;

  return typeof reason === "string" && reason.length > 0 ? reason : null;
}

/* -------------------------------------------------------------------------------- who */

/** What the trail prints where an event has no person behind it. */
export const NOBODY = "—";

/**
 * Who did it.
 *
 * @param event The row.
 * @returns Their name, or {@link NOBODY} when there is none. **Never an id**: an id in this
 *   column would be a name-shaped string that is not a name, which is worse than the dash — a
 *   reader can act on *nobody*, and cannot act on `5eed0003-0000-4000-8000-000000000002`. The
 *   two cases it covers are both ordinary, and the sheet does not distinguish them because a
 *   reader cannot act on the difference either: a lease grant never had an actor, and a
 *   person deleted since left `actorId` null behind (V022's set-null).
 */
export function actorOf(event: AuditEvent): string {
  return event.actorName ?? NOBODY;
}

/* ------------------------------------------------------------------------------- when */

/**
 * When it happened, as the sheet prints it: `2026-08-08 14:02`.
 *
 * **UTC, and labelled as such by the column heading rather than by every row.** The mockup's
 * own example is `2026-08-08 14:02 · Ken · rotated Anthropic key`, and a per-row `UTC` suffix
 * would widen the narrowest column to repeat one fact fifty times.
 *
 * Rendering in the reader's local zone was the alternative and is rejected on purpose: this
 * is the surface two people open during an incident, one of them from another continent, and
 * *the reveal at 14:02* has to mean the same thing to both. It is also what makes this
 * component's output stable — a formatter that read the runner's own zone would make the
 * sheet's tests pass in one time zone and fail in another.
 *
 * Written out rather than delegated to `Intl.DateTimeFormat`, which spells the same instant
 * four different ways across four locales and would put a comma into a column a reader scans.
 *
 * @param occurredAt The instant, ISO-8601, as the service sends it.
 * @returns `YYYY-MM-DD HH:MM`, in UTC. An unparseable value answers with itself rather than
 *   with `Invalid Date`: whatever the service sent is more useful to whoever has to diagnose
 *   it than two words saying only that this function was surprised.
 */
export function stampOf(occurredAt: string): string {
  const at = new Date(occurredAt);

  if (Number.isNaN(at.getTime())) return occurredAt;

  const pad = (value: number) => String(value).padStart(2, "0");

  return (
    `${String(at.getUTCFullYear())}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())} ` +
    `${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}`
  );
}

/* ------------------------------------------------------------------------- what to say */

/** The button in the page head, and the sheet it opens. */
export const AUDIT_LOG_LABEL = "Audit log";

/** The sheet's own name, which is what a screen reader announces when it opens. */
export const AUDIT_SHEET_TITLE = "Credential audit log";

/**
 * The sheet's subline.
 *
 * It states the two facts that make the surface worth trusting — that the trail is complete,
 * and that it holds no keys — because a reader looking at a list of *revealed the credential*
 * rows has a reasonable question about the second, and answering it in the interface is
 * cheaper than answering it in a support thread.
 */
export const AUDIT_SHEET_NOTE =
  "Every credential operation in this workspace, newest first. Refusals are recorded too. " +
  "No entry ever holds a key.";

/** What the sheet says while it is reading. */
export const AUDIT_LOADING = "Reading the trail…";

/** What the sheet says for a workspace where nothing has happened yet. */
export const AUDIT_EMPTY_TITLE = "Nothing has happened yet";

/** …and the note under it. */
export const AUDIT_EMPTY_NOTE =
  "Connecting a provider, revealing a key or changing a cap will each leave a row here.";

/** What the sheet says to somebody whose role may not read it. */
export const AUDIT_FORBIDDEN =
  "Reading the credential trail is for workspace owners and admins. Ask one of them to open it.";

/** What the sheet says when the read failed for any other reason. */
export const AUDIT_UNAVAILABLE =
  "The trail could not be read just now. Nothing was changed — try again in a moment.";

/**
 * How many rows the sheet asks for.
 *
 * Deliberately a single page and deliberately not paginated: AD.4 calls this surface
 * *minimal* and puts the full audit UI in mockup 17, so a reader who needs page four of a
 * workspace's history needs that page rather than a paging control bolted onto a sheet. Fifty
 * is what fits a sheet somebody scrolls once, and the service's own ceiling is a hundred.
 */
export const AUDIT_PAGE_SIZE = 50;

/**
 * What one read of the trail produced.
 *
 * A discriminated union rather than a bag of optional fields, for the reason
 * `app/login/view.ts` gives about its own: the sheet renders exactly one of four things, and
 * a shape that could hold *events and a refusal at once* would let it render two.
 */
export type AuditReading =
  /** The page, possibly empty. */
  | { readonly ok: true; readonly events: readonly AuditEvent[]; readonly total: number }
  /** Why not — a sentence already written for a reader. */
  | { readonly ok: false; readonly reason: string };
