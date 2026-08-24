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
 * Since AE.1 ([#227](https://github.com/NobuData/ouroboros/issues/227)) the foot of this file
 * also holds the **page's** copy — the title, the subline the security model approved, and
 * what the head's other action says while it cannot act — for the reason the sheet's copy is
 * here: a sentence that lives in one named place is a sentence a reviewer can be pointed at,
 * and the subline in particular is one that is *not the UI's to choose*.
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

/* --------------------------------------------------------------------------- the page */

/**
 * The page's title — mockup 07's `<h1>`, and the name of the tab that leads here.
 */
export const PROVIDERS_TITLE = "Providers & keys";

/**
 * The placeholder the approved subline carries for the workspace's display name.
 *
 * Exported so the test that holds {@link PROVIDERS_SUBLINE_TEMPLATE} to the document can
 * name the one thing it expects to find substituted.
 */
export const WORKSPACE_SLOT = "{workspace}";

/**
 * The page-head subline, **verbatim from `docs/SECURITY_MODEL.md` § 7.2**.
 *
 * This is the sentence that makes the security claim, and its wording is not this module's
 * to choose: AD.5 ([#226](https://github.com/NobuData/ouroboros/issues/226)) owns it, because
 * the mockup's version — *"workers only ever see short-lived tokens"* — is not what the
 * system does (AD.3 does something stronger, and § 4.1 of the document says what). So this
 * constant is a copy of § 7.2's block with its line breaks joined, and nothing else: no
 * paraphrase, no rewording of *workspace* back to the mockup's *tenant*, and the `{workspace}`
 * slot left exactly where the document puts it for {@link providersSubline} to fill.
 *
 * `__tests__/providers/view.test.ts` reads the document and compares, so a change to either
 * that is not a change to both fails the suite — which is the document's own rule: *a change
 * here is a change to the product's claims and is reviewed as one.*
 */
export const PROVIDERS_SUBLINE_TEMPLATE =
  "Credentials live in {workspace}'s encrypted vault, scoped to this workspace. " +
  "Keys never leave the control plane — workers never receive them at all.";

/**
 * The subline for one workspace.
 *
 * The possessive is the template's — `{workspace}'s` — and it is applied as written, with no
 * rule of this module's own about names that already end in *s*. The copy is not the UI's to
 * adjust, and an apostrophe rule would be an adjustment; if the document wants one it belongs
 * in § 7.2, where a reviewer of the claim would look for it.
 *
 * @param workspace The workspace's display name, as the service reports it (`Membership.name`).
 *   Substituted **literally**: a name is data, so a `$` in it must not reach
 *   `String.replace`'s pattern syntax — a workspace called `A$&B` would otherwise read back the
 *   placeholder into its own sentence.
 * @returns The approved sentence with the name in it.
 */
export function providersSubline(workspace: string): string {
  return PROVIDERS_SUBLINE_TEMPLATE.replace(WORKSPACE_SLOT, () => workspace);
}

/** The head's primary action, as the mockup labels it. */
export const ADD_PROVIDER_LABEL = "+ Add provider";

/**
 * Why **+ Add provider** cannot act yet.
 *
 * A constant rather than a rule: the catalog and form it opens are AE.5's
 * ([#231](https://github.com/NobuData/ouroboros/issues/231)) and do not exist, so there is no
 * state in which this control acts today. `Button`'s `reason` is how a control is switched
 * off in this product — it sets `aria-disabled`, becomes the tooltip, and cannot be omitted —
 * and naming the issue is what makes that tooltip a usable answer to *when?* rather than the
 * word *soon* on its own (`docs/DESIGN_SYSTEM_APP_SHELL.md` § 3.5).
 */
export const ADD_PROVIDER_REASON =
  "The add-provider flow is not built yet — it arrives with #231.";

/** What the space below the tab set says it is waiting for. */
export const PROVIDERS_NEXT_TITLE = "The provider cards arrive next";

/**
 * …and which issues fill it. Named rather than mocked: a grid of invented cards would be the
 * one dishonest thing on a page built to be honest, and indistinguishable in a screenshot
 * from the real one AE.2 ships.
 */
export const PROVIDERS_NEXT_NOTE =
  "The five provider cards arrive with #228; key management with #229, test and discovery " +
  "with #230, the add-provider catalog with #231, and caps, the security strip and the " +
  "page's states with #232. The Audit log above is live.";
