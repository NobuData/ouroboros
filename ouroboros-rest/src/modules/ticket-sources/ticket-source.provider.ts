/**
 * `TicketSourceProvider` — the one interface the intake loop is allowed to know about.
 *
 * Q.2 ([#139](https://github.com/NobuData/ouroboros/issues/139)), roadmap decision **P5**.
 *
 * ```
 * interface TicketSourceProvider
 *   kind · capabilities() · validateConfig(config, credentials)
 *   fullSync(ctx) · incrementalSync(ctx, cursor) → { tickets[], nextCursor, hasMore }
 *   mapTicket(raw → canonical)   ·   webhookHandler?(payload, signature)
 *
 * scheduler ─▶ registry.get(kind) ─▶ sync ─▶ upsert tickets ─▶ estimation
 * core ──imports──▶ SPI only              ticket-sources/providers/{github,jira,linear,…}
 * ```
 *
 * ---------------------------------------------------------------------------
 * **The problem it exists for, stated the way the issue states it.** *"Pluggability is an
 * interface discipline, not a feature. It holds only if core intake code depends exclusively
 * on a contract that every tracker can implement — and it decays the first time someone adds
 * `if (source.kind === 'github')` to the sync loop because it was quicker."* That is why
 * `.dependency-cruiser.cjs` carries `ticket-source-core-imports-the-spi-only`, and why
 * `boundary.spec.ts` watches that rule fail on a tree built to break it.
 *
 * ---------------------------------------------------------------------------
 * **Why `validateConfig` takes loose parts and the sync members take a context.**
 *
 * The asymmetry is the lifecycle, not an oversight. {@link TicketSourceProvider.validateConfig}
 * is what Q.4's ([#141](https://github.com/NobuData/ouroboros/issues/141)) **Test connection**
 * button calls, and it is called *before a row exists* — there is no `sourceId` to hand it, and
 * the credential is a string somebody has just pasted rather than a sealed column. The sync
 * members run against a stored source whose credential the loop opened for the length of one
 * call. Naming that difference in the signatures means a provider cannot accidentally require a
 * saved row in order to answer *is this configuration any good*, which is the one question a
 * form has to be able to ask.
 *
 * ---------------------------------------------------------------------------
 * **Failures: a value from `validateConfig`, an exception from the sync members.**
 *
 * Identical to the reasoning in `providers/provider.adapter.ts`, one domain over. A failed test
 * is what a form is *for* — the screen exists to render it — and an exception would put the
 * outcome at the mercy of somebody's control flow. A sync answers a page of tickets and has no
 * room for a failure in its return type, so it throws
 * {@link import("./ticket-source.errors").TicketSourceError}, which carries the same taxonomy a
 * validation failure would.
 *
 * ---------------------------------------------------------------------------
 * **The cursor is opaque, and that is an acceptance criterion rather than a style.**
 *
 * *"Cursor handling is provider-owned: the loop stores what the provider returns and never
 * interprets it."* GitHub's is a `since` timestamp, GitLab's an `updated_after`, Jira's a JQL
 * bound, Linear's an `updatedAt` filter — and a loop that parsed any of them would be a second
 * implementation of somebody else's format, with its own opinion about time zones. V030's
 * `sync_cursor` is `text` for the same reason.
 *
 * Which is exactly why {@link TicketPage} has a third member. The loop has to know whether to
 * come back immediately or wait for the next interval, and the only way to answer that *without*
 * interpreting the cursor is for the provider to say. {@link TicketPage.hasMore} is that
 * sentence, and it is the one field here the issue's `{tickets[], nextCursor}` sketch does not
 * name — added because the criterion above cannot be kept without it.
 *
 * ---------------------------------------------------------------------------
 * **Capabilities gate members at compile time, and `webhooks` is the worked example.**
 *
 * {@link TicketSourceProvider} has no `webhookHandler` at all. A provider that handles webhooks
 * implements {@link WebhookCapableProvider}, and a caller reaches the member through
 * {@link supportsWebhooks} or through `TicketSourceRegistry.webhookCapable`. So
 * `registry.get("jira").webhookHandler(…)` does not compile — *Property 'webhookHandler' does
 * not exist* — rather than throwing at run time behind an endpoint somebody has already pointed
 * a tracker at. The issue's *"optional, declared through `capabilities()`"*, as a type.
 *
 * ---------------------------------------------------------------------------
 * **`configSchema()` is Q.4's member, and it arrived the way this file said it would.**
 *
 * Q.2 left it out on purpose — *"a schema dialect invented with no form rendering it would be a
 * dialect nothing had ever checked"* — and named the shape it should take when a form existed:
 * `providers/provider.config.ts`'s. Q.4 ([#141](https://github.com/NobuData/ouroboros/issues/141))
 * is that form, and {@link TicketSourceProvider.configSchema} is that member: the same dialect,
 * widened by one field type in `ticket-source.config.ts`, checked by `TicketSourceRegistry` at
 * boot, and rendered by `GET /api/v1/sources/catalog` into the fields the settings surface
 * draws. A member and a registry assertion, not a reshape — exactly as promised.
 *
 * ---------------------------------------------------------------------------
 * **The write path arrived the way this file said it would — as an extension.**
 *
 * Q.2 declared {@link TicketSourceCapabilities.bidirectionalWrites} with no member behind it, *"so
 * the interface a v2 ticket needs is an extension rather than a reshape"*, and named
 * {@link WebhookCapableProvider} as the recipe. AL.2
 * ([#278](https://github.com/NobuData/ouroboros/issues/278)) is that ticket, and it followed the
 * recipe: {@link WriteCapableProvider} is a sub-interface, {@link supportsWrites} is its guard,
 * `bidirectionalWrites` is now the flag that gates it, and {@link TicketSourceCapabilities.write}
 * carries the detail the push service and the tracker segment need. Every provider that shipped
 * before it keeps compiling with one added line — `write: READ_ONLY_WRITE_CAPABILITIES`.
 *
 * **What is still deliberately not on this interface: `deleteTicket`.** Nothing in the product
 * removes a ticket from somebody's tracker, and a rollback that did would be the one write whose
 * mistake cannot be undone by hand. The write suites' *rollback* case asks the opposite of a
 * delete — that a refused write leaves nothing behind to clean up.
 */

import type { TicketSourceKind, TicketState } from "../db/schema";
import type { TicketSourceConfigSchema } from "./ticket-source.config";
import type { TicketSourceErrorClass } from "./ticket-source.errors";
import {
  writeCapabilityViolations,
  type DependencyLinkResult,
  type EpicContainerInput,
  type EpicMirrorRef,
  type MilestoneRef,
  type TicketDraftInput,
  type TicketSourceWriteCapabilities,
  type TicketWriteRef,
} from "./ticket-source.write";

/**
 * What a provider can do, as three flags and the write declaration behind the third.
 *
 * A total shape rather than an optional bag: a provider author has to answer every one, and
 * `false` is an answer. A partial record would let a capability be *unmentioned*, and every
 * consumer would then have to decide what an absent flag means — which is how a third meaning
 * ("undefined, so probably no") gets invented at four call sites.
 *
 * The three flags are the three Q.2 asks for: *"does this provider support webhooks? labels?
 * bidirectional writes?"* — and {@link write} is AL.2's answer to *which* writes.
 */
export interface TicketSourceCapabilities {
  /**
   * Whether this provider implements {@link WebhookCapableProvider}.
   *
   * The one flag with a member behind it today. `TicketSourceRegistry` asserts the flag and the
   * member agree, in both directions, at construction — so a provider that lies about this
   * stops the process at boot rather than at the endpoint.
   */
  readonly webhooks: boolean;
  /**
   * Whether {@link CanonicalTicket.labels} is ever non-empty.
   *
   * **Not whether the field exists** — it always does, and an empty array is a legitimate
   * answer from a provider that has labels and a ticket that carries none. What the flag says
   * is whether the concept exists at the tracker at all, which is the difference between a
   * filter chip-set that is empty because nothing matched and one that is empty because the
   * tracker has no such thing. A surface that cannot tell those apart draws an empty control
   * and invites somebody to wonder what they did wrong.
   */
  readonly labels: boolean;
  /**
   * Whether this provider implements {@link WriteCapableProvider}.
   *
   * The summary flag, exactly as {@link webhooks} is for its member, and always equal to
   * {@link write}'s `createTicket` — `TicketSourceRegistry` refuses a provider at boot where the
   * two disagree, or where either disagrees with the members. Kept beside the detail rather than
   * replaced by it because the catalog has carried it since Q.4, and removing a field a client
   * reads would have made this extension the reshape Q.2 promised it would not be.
   */
  readonly bidirectionalWrites: boolean;
  /**
   * What this provider can write — AL.2's declaration
   * ([#278](https://github.com/NobuData/ouroboros/issues/278)).
   *
   * A read-only provider answers `READ_ONLY_WRITE_CAPABILITIES`. See `ticket-source.write.ts` for
   * the flags and for the rule that every one of them is off when `createTicket` is.
   */
  readonly write: TicketSourceWriteCapabilities;
}

/**
 * One ticket, in the canonical model's vocabulary rather than its tracker's.
 *
 * V030's `tickets` columns, minus the four this product owns or derives — `id`,
 * `organization_id`, `source_id` and `sizing_status` are the loop's to supply, and a provider
 * that could set `sizing_status` could claim an estimate that does not exist.
 *
 * **This is the whole of what `mapTicket` is for**, and the reason it is a member of the SPI
 * rather than something the loop does: `485` is a GitHub issue number, `PROJ-142` is a Jira
 * key, and a Linear ticket is a uuid that *displays* as `ENG-123`. Only the provider knows
 * which of its fields is which, and V030 split {@link externalId} from {@link externalKey}
 * precisely so it never has to choose one.
 */
export interface CanonicalTicket {
  /**
   * The tracker's own identity for this ticket — `485`, `PROJ-142`, a uuid.
   *
   * The upsert key with the source, so it must be **stable for the life of the ticket**: a
   * value that changes when a ticket is renamed or moved would import the same ticket twice
   * and leave the first copy behind forever. Where a tracker offers both a mutable key and an
   * immutable id — Jira and Linear both do — this is the immutable one and
   * {@link externalKey} is the other.
   */
  readonly externalId: string;
  /**
   * The display form — `#485`, `PROJ-142`, `ENG-123`.
   *
   * Supplied rather than computed, because it is not derivable from {@link externalId} in
   * general. GitHub is the case that hides this: `485` and `#485` differ by one character, and
   * a model derived from GitHub alone would have had one column.
   */
  readonly externalKey: string;
  /**
   * The ticket in its own tracker — the href behind *"Open ↗"*.
   *
   * Must be `https` with a host: V030's `tickets_external_url_https` refuses anything else, and
   * it is a safety rule rather than a tidy one — an `href` is a place a scheme like
   * `javascript:` executes rather than navigates, and a provider is an HTTP client parsing
   * somebody else's JSON.
   */
  readonly externalUrl: string;
  /** The title as the tracker currently has it. Overwritten by the next sync that sees it change. */
  readonly title: string;
  /** The body in full, or null when the tracker's is. `''` is not the same fact and must not be substituted. */
  readonly body: string | null;
  /**
   * `open` or `closed`.
   *
   * **Collapsing a richer workflow onto two words is the provider's job**, and it is the one
   * mapping decision this interface forces rather than accommodates. Jira's states and
   * Linear's are richer than two; a wider vocabulary here would be a filter whose options
   * changed depending on which tracker a workspace happened to use.
   */
  readonly state: TicketState;
  /**
   * The tracker's label names — `["bug", "i2c"]`. Empty when the ticket has none, and always
   * empty from a provider whose {@link TicketSourceCapabilities.labels} is `false`.
   *
   * The tracker's vocabulary, not this product's: `sizing_status` is ours, and mixing the two
   * would make a filter chip ambiguous about whose word it is showing.
   */
  readonly labels: readonly string[];
  /**
   * Who opened it, in whatever form the tracker returns — a login, an account id, a display
   * name. Null when the tracker returns no author, which is what a deleted account looks like.
   */
  readonly author: string | null;
  /** When the tracker says it was opened. What *"opened 2d ago"* counts from. */
  readonly sourceCreatedAt: Date;
  /**
   * When the tracker last touched it.
   *
   * Never before {@link sourceCreatedAt} — V030's `tickets_updated_after_created` refuses that
   * pair, because no tracker produces it and a mapping that swapped two fields does.
   */
  readonly sourceUpdatedAt: Date;
  /**
   * Whatever else this provider needs to carry — a GitHub repository, a Jira project, a Linear
   * team.
   *
   * **Namespaced by the provider's own kind** by convention: `{ "github": { "repo_id": … } }`.
   * Nothing enforces that — V030 checks only that it is an object — and the convention is what
   * keeps a later per-kind filter from colliding with another provider's key of the same name.
   * Stored as written and never read by core code, which is the point.
   */
  readonly meta: Readonly<Record<string, unknown>>;
}

/** A configuration test that passed. */
export interface TicketSourceValidationOk {
  readonly status: "ok";
  /**
   * What the test found, for the affordance to render beside its tick — `4 repositories`,
   * `PROJ · 212 issues`.
   *
   * Never a bare `ok`: the point of a **Test connection** button is to tell somebody they
   * configured the thing they meant to, and a tick alone cannot say that they pointed it at the
   * wrong project.
   */
  readonly detail: string;
}

/** A configuration test that failed. */
export interface TicketSourceValidationFailure {
  readonly status: "failed";
  /** Which of the four it was — see `ticket-source.errors.ts`. */
  readonly errorClass: TicketSourceErrorClass;
  /**
   * What went wrong, in words fit to appear under a form field.
   *
   * **Must never contain the credential.** The shortest path to a leaked token is a provider
   * that echoes a tracker's error body, and tracker error bodies quote request headers.
   */
  readonly detail: string;
}

/**
 * What a configuration test found.
 *
 * A union rather than one shape with optional fields, so that *a passing test has no error
 * class* is enforced by the compiler rather than by a convention.
 */
export type TicketSourceValidation = TicketSourceValidationOk | TicketSourceValidationFailure;

/**
 * A stored source, opened for the length of one call.
 *
 * Assembled by the loop, and deliberately **not** the database row: a row carries a display
 * name, a status, a status reason and a sealed column, none of which a provider has any
 * business reading — and three of which are written *about* the provider by the thing calling
 * it.
 */
export interface TicketSyncContext {
  /**
   * `ticket_sources.id` — for the provider's own logs, and for a provider that needs to name
   * the source in an error. Never sent to a tracker.
   */
  readonly sourceId: string;
  /**
   * The workspace. Present so a provider can scope a cache or a rate budget by it, and for the
   * same reason the vault binds it into the credential's AAD: a value that belongs to one
   * workspace should be unusable in another even by mistake.
   */
  readonly organizationId: string;
  /**
   * `ticket_sources.config`, as stored.
   *
   * `unknown` rather than a shape, and that is the SPI working rather than a gap: the per-kind
   * grammar belongs to the provider that reads it, and a type spelled here would be GitHub's
   * grammar under a neutral name. A provider parses this — the same parse
   * {@link TicketSourceProvider.validateConfig} makes — and throws
   * {@link import("./ticket-source.errors").TicketSourceError} `not_found` when what it finds
   * is not what it needs.
   */
  readonly config: unknown;
  /**
   * The opened credential, or null.
   *
   * Null is a real state rather than an unfinished one: a source may be configured before
   * anybody has pasted a token in (V030 makes the column nullable for exactly that), and a
   * tracker serving public projects needs none at all. A provider that requires one and is
   * handed null fails `auth`, which is the honest class — the credential is the thing that is
   * wrong.
   *
   * **Live for the duration of one call.** The loop opens it immediately before and drops its
   * reference immediately after; a provider that stored one would be a singleton holding a
   * plaintext token across requests. Nothing logs it — see `ticket-sources.service.ts`.
   */
  readonly credentials: string | null;
}

/**
 * One page of a sync: what the tracker returned, and where to resume.
 *
 * The issue's `{tickets[], nextCursor}` plus {@link hasMore} — see this file's header for why
 * the third member is what makes *"the loop never interprets the cursor"* possible rather than
 * merely intended.
 */
export interface TicketPage {
  /**
   * The tickets, mapped, in the order the tracker listed them.
   *
   * **Ascending by {@link CanonicalTicket.sourceUpdatedAt} is strongly preferred** and is not
   * enforced, for the same reason the cursor is opaque: it is a property of the request a
   * provider made, and only the provider can arrange it. What depends on it is resumability —
   * with ascending order the tickets a capped page stored are exactly the ones at or before the
   * cursor it returns, so the next page continues rather than starting again. Q.5's conformance
   * kit ([#142](https://github.com/NobuData/ouroboros/issues/142)) is where that becomes a test
   * every provider takes.
   *
   * An empty page is a legitimate answer and the most common one: most polls of most sources
   * find nothing changed.
   */
  readonly tickets: readonly CanonicalTicket[];
  /**
   * The watermark to store, or null to leave the stored one alone.
   *
   * Opaque to everything outside the provider that wrote it. Null rather than an empty string —
   * V030's `ticket_sources_sync_cursor_present` refuses `''`, because a cursor of `''` is a
   * poller that would silently re-import the entire backlog on every pass.
   *
   * A provider returning a cursor **must** be able to resume from it: the loop stores it and
   * hands it straight back to {@link TicketSourceProvider.incrementalSync} next time.
   */
  readonly nextCursor: string | null;
  /**
   * Whether the tracker has more waiting behind this page.
   *
   * `true` books the next cycle in {@link import("./cadence").CONTINUATION_DELAY_MS} rather
   * than a full interval, which is what turns a cold import of a five-thousand-ticket backlog
   * into several quick cycles instead of an afternoon. `false` on the last page — including on
   * a page that was empty, which is the ordinary state.
   *
   * It is the provider's answer rather than a comparison the loop makes, because the only
   * comparison available to the loop is *did this page look full*, and page size is the
   * provider's business.
   */
  readonly hasMore: boolean;
}

/**
 * The SPI. Everything the intake loop is allowed to know about a tracker.
 *
 * Six members plus a key, and every one of them is something a surface does: Q.4's settings
 * list is {@link kind} and {@link capabilities}, its add-source form is {@link configSchema},
 * its **Test connection** button is {@link validateConfig}, and the two sync members are what
 * fills mockup 03's backlog.
 * {@link mapTicket} is the one with no surface behind it, and it is a member rather than an
 * implementation detail for a reason the issue gives: *"the raw → canonical mapping, testable
 * in isolation"* — a mapping reachable only through a network call is a mapping tested through
 * one.
 */
export interface TicketSourceProvider {
  /**
   * The registry key — one of V030's five `ticket_sources.kind` values.
   *
   * The same spelling the column carries, so a row and a provider agree about what kind of
   * thing they are describing without either translating.
   */
  readonly kind: TicketSourceKind;

  /**
   * What this provider can do.
   *
   * @returns All three flags and the write declaration. Must be **stable** — two calls answer equal values — because a
   *   capability that changed between two renders would show an affordance that then failed,
   *   and because `TicketSourceRegistry` checks the webhook flag once, at boot.
   */
  capabilities(): TicketSourceCapabilities;

  /**
   * The settings this provider takes, as a form.
   *
   * Q.4's ([#141](https://github.com/NobuData/ouroboros/issues/141)) *"provider form renders
   * from provider-declared config schema (no hardcoded GitHub form)"*, as the member that makes
   * it possible: `GET /api/v1/sources/catalog` turns this into an ordered list of fields, and
   * the settings surface draws that list without knowing which tracker it is drawing.
   *
   * @returns The schema, in `ticket-source.config.ts`'s dialect — `provider.config.ts`'s flat
   *   object of string fields, plus a list of strings for the one thing a tracker needs that a
   *   model provider does not. The field marked `x-ouroboros-secret` is the credential: it is
   *   submitted with the rest and routed to the vault, never stored as a setting. Must be
   *   **stable** — two calls answer equal schemas — because `TicketSourceRegistry` judges it
   *   once, at boot, and refuses a provider whose schema the form could not draw.
   */
  configSchema(): TicketSourceConfigSchema;

  /**
   * Check a configuration and credential against the live tracker.
   *
   * Q.4's **Test connection**, and the last step of its add-source flow. Called before any row
   * exists — see this file's header on the asymmetry with the sync members.
   *
   * @param config - The settings, in this provider's own vocabulary. Contains no credential.
   * @param credentials - The credential, or null where this provider needs none. Held for the
   *   length of this call and nowhere else.
   * @returns What the check found. **Never rejects** for anything a tracker did — a refusal, a
   *   timeout, a closed socket and a nonsense body are all results. A provider that threw here
   *   would make a form's error state depend on whether somebody remembered a `try`.
   */
  validateConfig(config: unknown, credentials: string | null): Promise<TicketSourceValidation>;

  /**
   * Every ticket this source should mirror, from the beginning.
   *
   * What a source with no stored cursor gets. **Not necessarily every ticket the tracker
   * holds** — a provider is entitled to decide that a backlog means *open tickets*, and the one
   * that ships does exactly that, because a cold import that dragged in a decade of closed
   * issues would be a first sync nobody wants. What it must not do is return a page it cannot
   * resume from: see {@link TicketPage}.
   *
   * @param context - The source, opened.
   * @returns One page. {@link TicketPage.hasMore} says whether to come back.
   * @throws {TicketSourceError} When the tracker could not be asked or refused.
   */
  fullSync(context: TicketSyncContext): Promise<TicketPage>;

  /**
   * Everything that has changed since a cursor.
   *
   * @param context - The source, opened.
   * @param cursor - Exactly the value this provider last returned as
   *   {@link TicketPage.nextCursor}, stored and handed back unread. Never null — a source with
   *   no cursor gets {@link fullSync} instead, and that is the whole of how the loop tells the
   *   two apart.
   * @returns One page. Must include tickets that **left** the open set, where the canonical
   *   model can express the departure — a close is a `state` change rather than an absence, and
   *   a ticket that simply stops being listed sits in the mirror as open forever.
   * @throws {TicketSourceError} When the tracker could not be asked or refused.
   */
  incrementalSync(context: TicketSyncContext, cursor: string): Promise<TicketPage>;

  /**
   * One raw payload, as a canonical ticket.
   *
   * A member of the SPI rather than a private helper because the issue asks for it to be
   * *"testable in isolation"*, and because it is the half of a provider that a recorded fixture
   * can exercise with no network at all. Both sync members are expected to be built on it, and
   * Q.5's conformance kit asserts the mapping's completeness through this member.
   *
   * @param raw - Whatever the tracker returned for one ticket. `unknown`, because its shape is
   *   this provider's business.
   * @returns The canonical row.
   * @throws {TicketSourceError} `upstream`, when the payload cannot be represented — a required
   *   field missing, a timestamp that will not parse. Throwing rather than returning a
   *   half-filled row: V030 refuses most of those at the column, and a row that made it through
   *   would be a ticket rendered with somebody's placeholder in it.
   */
  mapTicket(raw: unknown): CanonicalTicket;
}

/**
 * What a webhook delivery turned out to contain.
 *
 * Tickets rather than a bare acknowledgement, so the endpoint that receives a delivery and the
 * loop that polls write through the **same** upsert — which is what stops a webhook path from
 * being a second, subtly different intake with its own bugs.
 */
export interface WebhookOutcome {
  /**
   * The tickets this delivery described, mapped. Empty for a delivery that carried no ticket
   * change — a ping, a comment, an event this provider does not act on — which is an ordinary
   * outcome rather than a failure.
   */
  readonly tickets: readonly CanonicalTicket[];
}

/**
 * A provider that can accept a webhook delivery.
 *
 * See this file's header for why the member lives on a sub-interface rather than as an optional
 * member of {@link TicketSourceProvider}, and why that is the difference between a type error
 * and a run-time one.
 */
export interface WebhookCapableProvider extends TicketSourceProvider {
  /**
   * @returns The flags, with `webhooks` narrowed to `true`. Narrowing the return type is what
   *   makes a provider claiming this interface while reporting `webhooks: false` fail to
   *   compile — so the flag and the member cannot disagree in the one direction a type can
   *   catch. `TicketSourceRegistry` catches the other.
   */
  capabilities(): TicketSourceCapabilities & { readonly webhooks: true };

  /**
   * Take one delivery.
   *
   * @param payload - The body, parsed. `unknown` for {@link TicketSourceProvider.mapTicket}'s
   *   reason.
   * @param signature - Whatever header the tracker signs with, or null when none arrived. **A
   *   provider must verify this itself** and must refuse an unsigned delivery on a source
   *   configured with a secret: the endpoint that calls this cannot verify a signature it has
   *   no scheme for, and a shared "verify the signature" helper would be five schemes in one
   *   function with a `switch` on the kind — the exact branch this SPI exists to remove.
   * @returns What the delivery described.
   * @throws {TicketSourceError} `auth` when the signature is absent, malformed or wrong.
   */
  webhookHandler(payload: unknown, signature: string | null): Promise<WebhookOutcome>;
}

/**
 * A provider that can create tickets, link them, and mirror epics and milestones into its tracker.
 *
 * AL.2's ([#278](https://github.com/NobuData/ouroboros/issues/278)) extension, on
 * {@link WebhookCapableProvider}'s recipe: a sub-interface, so `registry.get(kind).createTicket(…)`
 * does not compile without {@link supportsWrites} in front of it, and the push service asks what
 * a provider can do rather than which provider it is.
 *
 * **Every member is idempotent** and **every member throws `TicketSourceError`** on a refusal,
 * classified through `classifyWriteHttpStatus` — `permission`, `validation` and `rate_limit` being
 * the three a write meets that a read does not distinguish. See `ticket-source.write.ts` for why
 * both hold, and for the documented `linkDependency` fallback.
 *
 * The context is the sync members' {@link TicketSyncContext}: a stored source, opened for the
 * length of one call, whose credential the provider must not keep.
 */
export interface WriteCapableProvider extends TicketSourceProvider {
  /**
   * @returns The flags, with `bidirectionalWrites` and `write.createTicket` narrowed to `true` —
   *   so a provider claiming this interface while declaring itself read-only fails to compile.
   */
  capabilities(): TicketSourceCapabilities & {
    readonly bidirectionalWrites: true;
    readonly write: TicketSourceWriteCapabilities & { readonly createTicket: true };
  };

  /**
   * Create one ticket — or answer the one an earlier call with the same key created.
   *
   * @param context - The source, opened.
   * @param draft - What to create. Its `idempotencyKey` is the dedupe contract.
   * @returns The ticket's identity in its tracker.
   * @throws {TicketSourceError} On a refusal. A refused create **leaves no ticket behind** — the
   *   write suites' rollback case — so a retry after recovery creates exactly one.
   */
  createTicket(context: TicketSyncContext, draft: TicketDraftInput): Promise<TicketWriteRef>;

  /**
   * Record that one ticket blocks another.
   *
   * @param context - The source, opened.
   * @param blocker - The ticket that must be done first.
   * @param blocked - The ticket that waits for it.
   * @returns Which mode recorded it — `native` exactly when `write.nativeDependencies` is true,
   *   `fallback` (the body marker) otherwise. Linking the same pair twice leaves one relation.
   * @throws {TicketSourceError} On a refusal; `validation` for a ticket linked to itself.
   */
  linkDependency(
    context: TicketSyncContext,
    blocker: TicketWriteRef,
    blocked: TicketWriteRef,
  ): Promise<DependencyLinkResult>;

  /**
   * Find the milestone with this name, or create it.
   *
   * @param context - The source, opened.
   * @param name - The milestone's name. Non-blank.
   * @returns The milestone; the same reference on every call with the same name. `null` when
   *   `write.milestones` is false — an ordinary configuration, not a failure.
   * @throws {TicketSourceError} On a refusal; `validation` for a blank name.
   */
  ensureMilestone(context: TicketSyncContext, name: string): Promise<MilestoneRef | null>;

  /**
   * Find the container an epic is mirrored into, or create it.
   *
   * @param context - The source, opened.
   * @param epic - The planning epic. Its `epicId` is the idempotency key.
   * @returns The mirror reference AK.3's `epic_mirrors` persists; the same one on every call for
   *   the same epic. `null` when `write.epicMapping` is `none`.
   * @throws {TicketSourceError} On a refusal; `validation` for a blank title.
   */
  ensureEpicContainer(
    context: TicketSyncContext,
    epic: EpicContainerInput,
  ): Promise<EpicMirrorRef | null>;

  /**
   * Make a ticket a member of an epic's container.
   *
   * @param context - The source, opened.
   * @param ticket - The ticket.
   * @param mirror - What `ensureEpicContainer` answered. Attaching twice leaves one membership.
   * @throws {TicketSourceError} On a refusal; `validation` when the mirror's `mapping` is not this
   *   provider's `epicMapping` — including any mirror at all under `none`.
   */
  attachToEpic(
    context: TicketSyncContext,
    ticket: TicketWriteRef,
    mirror: EpicMirrorRef,
  ): Promise<void>;
}

/** The five members {@link WriteCapableProvider} adds, as values — what the registry checks. */
export const WRITE_MEMBERS = [
  "createTicket",
  "linkDependency",
  "ensureMilestone",
  "ensureEpicContainer",
  "attachToEpic",
] as const satisfies readonly (keyof WriteCapableProvider)[];

/**
 * Whether a provider can write — and, for the compiler, that its write members are there.
 *
 * The check is the **flag**, for {@link supportsWebhooks}' reason: a half-finished member on a
 * provider declaring itself read-only must not become callable because it happens to exist.
 *
 * @param provider - Any provider.
 * @returns `true` when it declares `write.createTicket`.
 */
export function supportsWrites(provider: TicketSourceProvider): provider is WriteCapableProvider {
  return provider.capabilities().write.createTicket;
}

/**
 * Everything wrong with how a provider's write declaration agrees with itself and its members.
 *
 * What `TicketSourceRegistry` refuses at boot and the conformance kit reports: the declaration's
 * own coherence (`writeCapabilityViolations`), the summary flag against the detail, and the flag
 * against the five members — in both directions, since a member without the flag is unreachable
 * and a flag without the members is a `TypeError` behind a guard that said it was safe.
 *
 * @param provider - Any provider.
 * @returns The violations.
 */
export function writeMemberViolations(provider: TicketSourceProvider): string[] {
  const capabilities = provider.capabilities() as Partial<TicketSourceCapabilities>;
  const shape = writeCapabilityViolations(capabilities.write);

  if (shape.length > 0) {
    return shape;
  }

  const declared = (capabilities.write as TicketSourceWriteCapabilities).createTicket;
  const violations: string[] = [];

  if (capabilities.bidirectionalWrites !== declared) {
    violations.push(
      `capabilities().bidirectionalWrites is ${String(capabilities.bidirectionalWrites)} but ` +
        `write.createTicket is ${declared.toString()} — the summary and the detail must agree`,
    );
  }

  const members = provider as unknown as Record<string, unknown>;
  const missing = WRITE_MEMBERS.filter((member) => typeof members[member] !== "function");
  const present = WRITE_MEMBERS.filter((member) => typeof members[member] === "function");

  if (declared && missing.length > 0) {
    violations.push(`write.createTicket is true but ${missing.join(", ")} is absent`);
  }

  if (!declared && present.length > 0) {
    violations.push(
      `write.createTicket is false but ${present.join(", ")} is present — an unreachable write ` +
        "member is a declaration somebody forgot to update",
    );
  }

  return violations;
}

/**
 * Whether a provider handles webhooks — and, for the compiler, that its `webhookHandler` is
 * there.
 *
 * The narrowing is the point: without it there is no way to reach the member at all.
 *
 * The check is the **flag**, not the presence of the method. A provider is entitled to say what
 * it can do, and an inherited or half-finished `webhookHandler` on something reporting
 * `webhooks: false` must not be callable because it happens to exist. `TicketSourceRegistry`
 * asserts the two agree at boot, so a disagreement is caught where it is written rather than
 * where it is called.
 *
 * @param provider - Any provider.
 * @returns `true` when it declares the capability.
 */
export function supportsWebhooks(
  provider: TicketSourceProvider,
): provider is WebhookCapableProvider {
  return provider.capabilities().webhooks;
}
