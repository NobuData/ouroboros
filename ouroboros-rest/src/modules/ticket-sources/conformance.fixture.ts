/**
 * The ticket-source conformance kit — the suite every `TicketSourceProvider` has to pass, and the
 * reason *pluggable* is a test result rather than a claim.
 *
 * Q.5 ([#142](https://github.com/NobuData/ouroboros/issues/142)), roadmap decision **P5**. A
 * provider author writes one spec file, supplying a provider and its recordings and nothing else —
 * no database, no Nest module, no reading of the sync loop:
 *
 * ```ts
 * describeTicketSourceConformance("JiraTicketSourceProvider", () => ({
 *   provider, context, rejectedConfigs, mappings, unmappable,
 *   backlog, changeUpstream, changedBacklog, refuse, webhook,
 * }));
 * ```
 *
 * That is the on-ramp T.2–T.4 (#156, #157, #158) and every community provider take, and the
 * definition of done they share with GitHub's provider and the in-memory fake:
 *
 * ```
 * describeTicketSourceConformance(provider, recordings)
 *   ├─ config validation        accepted and rejected shapes
 *   ├─ full + incremental sync  cursor never regresses · re-sync writes nothing
 *   ├─ canonical mapping        every field populated or explicitly null
 *   ├─ error taxonomy           auth · rate_limit · not_found · upstream
 *   └─ webhook shape            when capabilities() declares it
 * ```
 *
 * A provider that writes takes the write suites as well — `conformance.write.fixture.ts`'s
 * `describeTicketSourceWriteConformance` (AL.2, [#278](https://github.com/NobuData/ouroboros/issues/278)):
 * create, dedupe, link, milestones, epics, the six-class write taxonomy and rollback.
 *
 * ---------------------------------------------------------------------------
 * **Why the checks are functions returning lists of sentences.** `providers/conformance.fixture.ts`
 * made the argument for model adapters and it holds unchanged: a rule shaped as
 * `…Violations(…) => string[]` can itself be a test subject, so `conformance.fixture.spec.ts`
 * watches each one fail on a provider built to break it, and one run reports every problem at
 * once.
 *
 * **Why the sync legs replay into a mirror.** The contract's interesting half is not one call but
 * a sequence — a cold import, the cursor it leaves, the same cursor asked again, a change upstream,
 * and the cursor after that. {@link ConformanceMirror} applies each page by the loop's own rules: a
 * closed ticket it has never seen is not stored, and a row is written only where
 * `ticket-sources.repository.ts`'s `differs` says the loop would write one. So *"re-running an
 * unchanged cursor writes nothing"* is counted rather than inferred.
 *
 * **Why monotonicity is judged by tickets, not by cursors.** The loop never interprets a cursor and
 * neither may the kit. What a cursor that moved backwards *does* is observable, though: a page
 * carries a version of a ticket older than the one the mirror already holds, and storing it would
 * roll the mirror back. Every replay reports that, and the change leg also requires the stored
 * cursor to move once a page has carried newer work.
 *
 * **No escape hatches.** Every error class needs a recorded refusal, and the recorded upstream
 * change must close a ticket the backlog holds open — `incrementalSync` *must* return departures,
 * and a recording that never shows one never checks it. An author who cannot record one has not
 * yet decided what their provider does about it.
 *
 * It is a `.fixture.ts`: type-checked with the code it gates, and left out of the image by
 * `tsconfig.build.json`.
 */

import { TICKET_SOURCE_KINDS, TICKET_STATES } from "../db/schema";
import {
  sourceConfigViolations,
  sourceSchemaViolations,
  sourceSecretField,
  toSourceFormFields,
} from "./ticket-source.config";
import {
  MAX_STATUS_REASON,
  TICKET_SOURCE_READ_ERROR_CLASSES,
  TicketSourceError,
  statusReasonFor,
  type TicketSourceErrorClass,
  type TicketSourceReadErrorClass,
} from "./ticket-source.errors";
import {
  prMemberViolations,
  supportsWebhooks,
  writeMemberViolations,
  type CanonicalTicket,
  type TicketPage,
  type TicketSourceCapabilities,
  type TicketSourceProvider,
  type TicketSyncContext,
} from "./ticket-source.provider";
import { TicketSourceRegistry } from "./ticket-source.registry";
import { differs, type StoredTicket } from "./ticket-sources.repository";

/**
 * What V030 permits in each canonical column, restated so a provider meets a bound in its own test
 * run rather than as a `23514` inside a background loop nobody is watching.
 *
 * Each value is the named constraint's own.
 */
export const CANONICAL_LIMITS = Object.freeze({
  /** `tickets_external_id_present`. */
  externalId: 255,
  /** `tickets_external_key_present`. */
  externalKey: 128,
  /** `tickets_external_url_https`. */
  externalUrl: 2048,
  /** `tickets_title_present`. */
  title: 512,
  /** `tickets_body_bounded`. */
  body: 262_144,
  /** `tickets_author_present`. */
  author: 255,
  /** `tickets_labels_shape` — how many names. */
  labels: 100,
  /** `tickets_labels_shape` — how long each name. */
  label: 255,
});

/**
 * `tickets_external_url_https`'s pattern, character for character.
 *
 * A safety rule rather than a tidy one: an `href` is a place a scheme like `javascript:` executes
 * rather than navigates.
 */
export const CANONICAL_URL = /^https:\/\/[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?\//;

/** `ticket_sources_sync_cursor_present` — the longest cursor the column stores. */
export const MAX_CURSOR_LENGTH = 255;

/**
 * How many pages one replay follows before it calls a provider unsettled.
 *
 * A recording is small, so a provider still answering `hasMore: true` after this many pages is
 * one whose `hasMore` never turns false — which in the loop is a source polled every second
 * forever.
 */
export const MAX_CHAIN = 25;

/** How deep {@link retainedStrings} looks into a provider's fields. */
export const MAX_RETENTION_DEPTH = 8;

/**
 * Every canonical field, as a total record — so a field added to `CanonicalTicket` does not
 * compile here until the kit has decided how to check it.
 */
const CANONICAL_FIELDS: Readonly<Record<keyof CanonicalTicket, true>> = Object.freeze({
  externalId: true,
  externalKey: true,
  externalUrl: true,
  title: true,
  body: true,
  state: true,
  labels: true,
  author: true,
  sourceCreatedAt: true,
  sourceUpdatedAt: true,
  meta: true,
});

/** The canonical field names, in the order `CanonicalTicket` declares them. */
export const CANONICAL_FIELD_NAMES = Object.keys(
  CANONICAL_FIELDS,
) as readonly (keyof CanonicalTicket)[];

/** A configuration a harness records, with a name for the sentence that reports it. */
export interface RecordedConfig {
  /** What makes it wrong, in words — `"an account name with a slash in it"`. */
  readonly name: string;
  /** The stored configuration, as `ticket_sources.config` would hand it over. */
  readonly config: unknown;
}

/** One raw tracker payload, and the canonical ticket it must map to. */
export interface RecordedMapping {
  /** What the payload is, in words. */
  readonly name: string;
  /** The payload, as the tracker served it. */
  readonly raw: unknown;
  /**
   * The canonical ticket, written out in full.
   *
   * The only way to check a mapping is to state its answer — two providers most easily disagree
   * exactly where a derived expectation would agree with both.
   */
  readonly expected: CanonicalTicket;
}

/** A raw payload the mapping must refuse. */
export interface RecordedPayload {
  /** What is wrong with it, in words. */
  readonly name: string;
  /** The payload. */
  readonly raw: unknown;
}

/** One webhook delivery, as the tracker sent it. */
export interface RecordedDelivery {
  /** The body, parsed. */
  readonly payload: unknown;
  /** The signature header's value. */
  readonly signature: string;
}

/** What the webhook leg needs from a provider that declares the capability. */
export interface WebhookConformance {
  /** A correctly signed delivery that describes at least one ticket. */
  readonly delivery: RecordedDelivery;
  /** The tickets that delivery must map to, in order. */
  readonly expected: readonly CanonicalTicket[];
  /** A delivery whose signature is wrong — refused as `auth`. The unsigned case the kit makes itself. */
  readonly forged: RecordedDelivery;
}

/**
 * Everything the kit needs from a provider author.
 *
 * **The recordings are the author's, and so is the transport.** An HTTP provider serves captured
 * responses from a stand-in client, the in-memory fake scripts its tracker, and a future provider
 * over a socket does whatever it does. The kit only calls the SPI's members and checks what comes
 * back — which is what lets T.2–T.4 consume it by supplying a provider and fixtures alone.
 *
 * A harness is built fresh for every case, so a mutator here ({@link changeUpstream},
 * {@link refuse}) changes only the recording of the case that called it.
 */
export interface TicketSourceConformance {
  /** The provider under test. */
  readonly provider: TicketSourceProvider;
  /**
   * The source the sync legs run against: a configuration the provider accepts, and the
   * credential its recordings expect.
   *
   * The kit searches every `detail`, every status reason and the provider's own fields for
   * {@link TicketSyncContext.credentials}, so it must be a value distinctive enough to find.
   */
  readonly context: TicketSyncContext;
  /**
   * Configurations the provider must refuse — as a *result* from `validateConfig` and as a
   * `not_found` `TicketSourceError` from a sync, which is the class `docs/TICKET_SOURCES.md` § 4
   * gives a configuration the tracker cannot be asked with. At least one.
   */
  readonly rejectedConfigs: readonly RecordedConfig[];
  /**
   * Payloads and the tickets they map to. At least one must map to a `null` body and one to a
   * `null` author, and one must carry a label when `capabilities().labels` is true.
   */
  readonly mappings: readonly RecordedMapping[];
  /** Payloads `mapTicket` must refuse with `TicketSourceError("upstream")`. At least one. */
  readonly unmappable: readonly RecordedPayload[];
  /** What a cold import from the recording must leave in the mirror. At least one ticket. */
  readonly backlog: readonly CanonicalTicket[];
  /**
   * Apply the recorded upstream change to the recording: the tracker moving on between two
   * polls. It must close a ticket {@link backlog} holds open.
   */
  readonly changeUpstream: () => void;
  /** What the mirror must hold once the change has been synced incrementally. */
  readonly changedBacklog: readonly CanonicalTicket[];
  /**
   * One arranger per error class: after it runs, both `validateConfig` and the sync members meet
   * a recorded refusal of that class.
   *
   * A total `Record`, so a class cannot be left out. The same recording is expected to classify
   * the same way on both paths, because the settings form and the source's status row are two
   * views of one tracker's answer.
   */
  readonly refuse: Readonly<Record<TicketSourceReadErrorClass, () => void>>;
  /** The webhook recordings — required exactly when `capabilities().webhooks` is true. */
  readonly webhook: WebhookConformance | null;
}

/** A promise's outcome, as a value — so a rejection can be checked rather than thrown. */
export type Settled<T> =
  | { readonly resolved: true; readonly value: T }
  | { readonly resolved: false; readonly error: unknown };

/**
 * Run an asynchronous call and answer how it ended.
 *
 * @param run - The call. A synchronous throw is caught as a rejection, because a provider written
 *   without `async` can throw before it ever returns a promise.
 * @returns The value, or what it rejected with.
 */
export async function settle<T>(run: () => Promise<T>): Promise<Settled<T>> {
  try {
    return { resolved: true, value: await run() };
  } catch (error) {
    return { resolved: false, error };
  }
}

/**
 * Everything wrong with one canonical ticket, judged by V030's constraints and the SPI's types.
 *
 * *"Every required canonical field populated or explicitly absent"*, as a rule: all eleven fields
 * are present, `body` and `author` are `null` rather than missing when the tracker said nothing, and
 * nothing else rides along outside `meta`.
 *
 * @param ticket - What a provider produced. `unknown`, because the interesting provider is one
 *   written somewhere the compiler stopped nobody.
 * @param at - What to prefix every sentence with.
 * @returns The violations. Empty means the row is one V030 accepts.
 */
export function canonicalTicketViolations(ticket: unknown, at = "ticket"): string[] {
  if (!isRecord(ticket)) {
    return [`${at}: must be an object`];
  }

  const violations: string[] = [];

  for (const field of CANONICAL_FIELD_NAMES) {
    if (ticket[field] === undefined) {
      violations.push(
        `${at}: ${field} is missing — a value the tracker did not supply is null, never absent`,
      );
    }
  }

  for (const key of Object.keys(ticket)) {
    if (!(key in CANONICAL_FIELDS)) {
      violations.push(`${at}: ${key} is not a canonical field — carry it in meta`);
    }
  }

  if (violations.length > 0) {
    // Everything below reads the fields, and a ticket missing one has nothing worth reading there;
    // a cascade of consequences is not a more useful report than the cause.
    return violations;
  }

  violations.push(
    ...textViolations(at, "externalId", ticket.externalId, CANONICAL_LIMITS.externalId),
  );
  violations.push(
    ...textViolations(at, "externalKey", ticket.externalKey, CANONICAL_LIMITS.externalKey),
  );

  if (
    typeof ticket.externalUrl !== "string" ||
    ticket.externalUrl.length > CANONICAL_LIMITS.externalUrl ||
    !CANONICAL_URL.test(ticket.externalUrl)
  ) {
    violations.push(
      `${at}: externalUrl must be an https link with a host, at most ` +
        `${CANONICAL_LIMITS.externalUrl.toString()} characters`,
    );
  }

  violations.push(...textViolations(at, "title", ticket.title, CANONICAL_LIMITS.title));

  if (
    ticket.body !== null &&
    (typeof ticket.body !== "string" || ticket.body.length > CANONICAL_LIMITS.body)
  ) {
    violations.push(
      `${at}: body must be null or text of at most ${CANONICAL_LIMITS.body.toString()} characters`,
    );
  }

  if (!(TICKET_STATES as readonly unknown[]).includes(ticket.state)) {
    violations.push(`${at}: state must be one of ${TICKET_STATES.join(", ")}`);
  }

  violations.push(...labelViolations(at, ticket.labels));

  if (ticket.author !== null) {
    violations.push(...textViolations(at, "author", ticket.author, CANONICAL_LIMITS.author));
  }

  const created = instantOf(ticket.sourceCreatedAt);
  const updated = instantOf(ticket.sourceUpdatedAt);

  if (created === undefined) {
    violations.push(`${at}: sourceCreatedAt must be a valid Date`);
  }

  if (updated === undefined) {
    violations.push(`${at}: sourceUpdatedAt must be a valid Date`);
  }

  if (created !== undefined && updated !== undefined && updated.getTime() < created.getTime()) {
    violations.push(`${at}: sourceUpdatedAt is before sourceCreatedAt — two fields swapped`);
  }

  if (!isPlainObject(ticket.meta) || !isJson(ticket.meta)) {
    violations.push(`${at}: meta must be a plain JSON object — it is stored as jsonb`);
  }

  return violations;
}

/**
 * Everything wrong with a provider's capability declaration.
 *
 * @param provider - The provider.
 * @returns The violations.
 */
export function capabilityViolations(provider: TicketSourceProvider): string[] {
  const capabilities = provider.capabilities() as unknown;

  if (!isRecord(capabilities)) {
    return ["capabilities() must answer an object"];
  }

  const violations: string[] = [];

  for (const flag of ["webhooks", "labels", "bidirectionalWrites"] as const) {
    if (typeof capabilities[flag] !== "boolean") {
      violations.push(`capabilities().${flag} must be a boolean — false is an answer`);
    }
  }

  if (violations.length > 0) {
    return violations;
  }

  // Stability by value rather than by identity: a fresh object per call is fine, and several
  // providers build one.
  if (JSON.stringify(provider.capabilities()) !== JSON.stringify(capabilities)) {
    violations.push("capabilities() must answer the same flags every call");
  }

  const declared = capabilities.webhooks === true;
  const present = typeof (provider as { webhookHandler?: unknown }).webhookHandler === "function";

  if (declared !== present) {
    violations.push(
      `capabilities().webhooks is ${declared.toString()} but webhookHandler is ` +
        `${present ? "present" : "absent"} — the registry refuses that disagreement at boot`,
    );
  }

  if (supportsWebhooks(provider) !== declared) {
    violations.push("supportsWebhooks disagrees with capabilities().webhooks");
  }

  // AL.2's (#278) declaration: coherent on its own, and in agreement with the summary flag and the
  // five write members — the same sentences the registry refuses a provider with at boot.
  violations.push(...writeMemberViolations(provider));

  // AX.1's (#357) declaration, on the same terms — see `conformance.pr.fixture.ts` for the suites a
  // provider declaring pull requests also takes.
  violations.push(...prMemberViolations(provider));

  return violations;
}

/**
 * Everything wrong with a provider's config schema, and with the harness's configuration against
 * it.
 *
 * The dialect is `sourceSchemaViolations`' job and this calls it first. What is added is what only
 * makes sense with a provider in hand: stability, the registry's own verdict, a form the settings
 * surface can draw, a secret field that agrees with the credential the recordings use, and a
 * sample configuration the provider's own form would accept.
 *
 * @param provider - The provider.
 * @param context - The harness's sync context — its `config` and `credentials` are the sample.
 * @returns The violations.
 */
export function schemaViolations(
  provider: TicketSourceProvider,
  context: TicketSyncContext,
): string[] {
  const schema = provider.configSchema();
  const dialect = sourceSchemaViolations(schema);

  if (dialect.length > 0) {
    // Everything below reads the schema's structure, and a schema outside the dialect has none
    // worth reading.
    return dialect;
  }

  const violations: string[] = [];

  if (JSON.stringify(provider.configSchema()) !== JSON.stringify(schema)) {
    violations.push("configSchema() must answer the same schema every call");
  }

  try {
    if (!new TicketSourceRegistry([provider]).kinds().includes(provider.kind)) {
      violations.push(`the registry does not list kind "${provider.kind}" once it is registered`);
    }
  } catch (error) {
    violations.push(`the registry refuses it at boot: ${describeThrown(error)}`);
  }

  const fields = toSourceFormFields(schema);
  const names = Object.keys(schema.properties);

  if (fields.map((field) => field.name).join() !== names.join()) {
    violations.push("toSourceFormFields must answer one field per property, in properties order");
  }

  for (const field of fields) {
    if (field.label.trim() === "") {
      violations.push(`field "${field.name}" renders with an empty label`);
    }
  }

  // The order is a contract — it is the order the form draws — and the wire between here and the
  // settings surface is JSON.
  const roundTripped = JSON.parse(JSON.stringify(schema)) as typeof schema;

  if (Object.keys(roundTripped.properties).join() !== names.join()) {
    violations.push("field order must survive a JSON round trip");
  }

  const secretField = sourceSecretField(schema);

  if (context.credentials !== null && secretField === null) {
    violations.push(
      "the harness syncs with a credential but the schema marks no x-ouroboros-secret field, " +
        "so the settings form would render no way to enter one",
    );
  }

  if (context.credentials === null && secretField !== null) {
    violations.push(
      `the schema marks "${secretField}" as the credential but the harness supplies none, ` +
        "so the recordings never exercise the field the form collects",
    );
  }

  if (!isPlainObject(context.config)) {
    violations.push(
      "the harness's config must be an object — ticket_sources_config_shape stores nothing else",
    );

    return violations;
  }

  // The submission the form would have made: the stored settings with the credential put back
  // where the form collects it, so the secret field's own keywords are exercised too.
  const submission =
    secretField === null || context.credentials === null
      ? context.config
      : { ...context.config, [secretField]: context.credentials };

  for (const [field, messages] of Object.entries(sourceConfigViolations(schema, submission))) {
    for (const message of messages) {
      violations.push(`the settings form would refuse the harness's own ${field}: ${message}`);
    }
  }

  return violations;
}

/**
 * Everything wrong with what a `validateConfig` call answered.
 *
 * @param validation - What the provider answered.
 * @param expected - The class the recording was arranged to produce, or `null` for the accepted
 *   configuration.
 * @param credentials - The credential the call was made with, searched for in the detail.
 * @returns The violations.
 */
export function validationViolations(
  validation: unknown,
  expected: TicketSourceErrorClass | null,
  credentials: string | null,
): string[] {
  if (!isRecord(validation)) {
    return ["validateConfig must answer a result — { status, detail }"];
  }

  const violations: string[] = [];
  const detail = validation.detail;

  if (typeof detail !== "string" || detail.trim() === "") {
    violations.push("detail must say something — it is what Test connection renders");
  } else if (credentials !== null && credentials !== "" && detail.includes(credentials)) {
    // The shortest path to a leaked token is a provider echoing a tracker's error body, and those
    // quote request headers. Checked on success too: a chatty success is the same leak.
    violations.push("detail contains the credential");
  }

  if (expected === null) {
    if (validation.status !== "ok") {
      violations.push(
        `the accepted configuration answered ${String(validation.status)} ` +
          `(${String(validation.errorClass)}): ${String(detail)}`,
      );
    } else if ("errorClass" in validation) {
      violations.push("a passing test carries no errorClass");
    }

    return violations;
  }

  if (validation.status !== "failed") {
    violations.push(`the ${expected} recording answered ${String(validation.status)}, not failed`);
  } else if (validation.errorClass !== expected) {
    violations.push(`the ${expected} recording was classified ${String(validation.errorClass)}`);
  }

  return violations;
}

/**
 * Everything wrong with how a sync failed.
 *
 * @param settled - How the sync ended.
 * @param expected - The class the recording was arranged to produce.
 * @param credentials - The credential the sync was made with.
 * @returns The violations.
 */
export function syncFailureViolations(
  settled: Settled<unknown>,
  expected: TicketSourceErrorClass,
  credentials: string | null,
): string[] {
  if (settled.resolved) {
    return [`the ${expected} recording answered a page instead of failing`];
  }

  const { error } = settled;

  if (!TicketSourceError.is(error)) {
    return [
      `a failed sync must reject with a TicketSourceError, not ${describeThrown(error)} — ` +
        "the loop records anything else as upstream",
    ];
  }

  const violations: string[] = [];

  if (error.errorClass !== expected) {
    violations.push(`the ${expected} recording was classified ${error.errorClass}`);
  }

  if (credentials !== null && credentials !== "" && error.detail.includes(credentials)) {
    violations.push("the error's detail contains the credential — a detail reaches the log");
  }

  // Read loosely: `TicketSourceError.is` is duck-typed, so a provider compiled against another
  // copy of the class may have left these off entirely.
  const { retryAt, httpStatus } = error as { retryAt?: unknown; httpStatus?: unknown };

  if (retryAt !== null && instantOf(retryAt) === undefined) {
    violations.push("retryAt must be null or a valid Date");
  }

  if (
    httpStatus !== null &&
    !(typeof httpStatus === "number" && Number.isInteger(httpStatus) && httpStatus >= 300)
  ) {
    violations.push("httpStatus must be null or the refusal's HTTP status");
  }

  if (violations.length > 0) {
    return violations;
  }

  const reason = statusReasonFor(error);

  if (reason.trim() === "" || reason.length > MAX_STATUS_REASON) {
    violations.push(
      `the status reason must be non-blank and at most ${MAX_STATUS_REASON.toString()} characters`,
    );
  }

  return violations;
}

/**
 * Everything wrong with one page.
 *
 * @param page - What a sync member answered.
 * @param at - What to prefix every sentence with.
 * @param capabilities - The provider's flags, for the labels rule.
 * @returns The violations.
 */
export function pageViolations(
  page: unknown,
  at: string,
  capabilities: TicketSourceCapabilities,
): string[] {
  if (!isRecord(page)) {
    return [`${at}: must answer a page — { tickets, nextCursor, hasMore }`];
  }

  const violations: string[] = [];
  const { tickets, nextCursor, hasMore } = page;

  if (
    nextCursor !== null &&
    !(
      typeof nextCursor === "string" &&
      nextCursor.trim() !== "" &&
      nextCursor.length <= MAX_CURSOR_LENGTH
    )
  ) {
    violations.push(
      `${at}: nextCursor must be null or non-blank text of at most ` +
        `${MAX_CURSOR_LENGTH.toString()} characters — '' would re-import the backlog every pass`,
    );
  }

  if (typeof hasMore !== "boolean") {
    violations.push(`${at}: hasMore must be a boolean`);
  }

  if (!Array.isArray(tickets)) {
    violations.push(`${at}: tickets must be an array`);

    return violations;
  }

  const seen = new Set<string>();
  let previous: number | undefined;

  for (const [index, ticket] of (tickets as unknown[]).entries()) {
    const shape = canonicalTicketViolations(ticket, `${at}, ticket ${index.toString()}`);

    if (shape.length > 0) {
      violations.push(...shape);
      continue;
    }

    const canonical = ticket as CanonicalTicket;

    if (seen.has(canonical.externalId)) {
      violations.push(
        `${at}: ${canonical.externalKey} appears twice — a page is written in one transaction`,
      );
    }

    seen.add(canonical.externalId);

    if (previous !== undefined && canonical.sourceUpdatedAt.getTime() < previous) {
      violations.push(
        `${at}: ${canonical.externalKey} is out of order — a page ascends by sourceUpdatedAt, ` +
          "or the cursor it returns cannot resume it",
      );
    }

    previous = canonical.sourceUpdatedAt.getTime();

    if (!capabilities.labels && canonical.labels.length > 0) {
      violations.push(
        `${at}: ${canonical.externalKey} carries labels, but capabilities().labels is false`,
      );
    }
  }

  return violations;
}

/**
 * Everything wrong with a provider's mapping, over the harness's recordings.
 *
 * @param provider - The provider.
 * @param mappings - Payloads and what they must map to.
 * @param unmappable - Payloads that must be refused.
 * @returns The violations, each naming the recording it is about.
 */
export function mappingViolations(
  provider: TicketSourceProvider,
  mappings: readonly RecordedMapping[],
  unmappable: readonly RecordedPayload[],
): string[] {
  const violations: string[] = [];

  if (mappings.length === 0) {
    violations.push("record at least one payload for mapTicket to map");
  }

  for (const { name, raw, expected } of mappings) {
    const at = `mapping "${name}"`;
    let ticket: unknown;

    try {
      ticket = provider.mapTicket(raw);
    } catch (error) {
      violations.push(`${at} threw: ${describeThrown(error)}`);
      continue;
    }

    const shape = canonicalTicketViolations(ticket, at);

    violations.push(
      ...(shape.length > 0 ? shape : ticketDifferences(ticket as CanonicalTicket, expected, at)),
    );
  }

  if (!mappings.some((mapping) => mapping.expected.body === null)) {
    violations.push(
      "no recording maps to a null body — record a payload with no description, so absent is " +
        "seen to be null rather than ''",
    );
  }

  if (!mappings.some((mapping) => mapping.expected.author === null)) {
    violations.push(
      "no recording maps to a null author — record a payload with none, which is what a " +
        "deleted account looks like",
    );
  }

  if (
    provider.capabilities().labels &&
    !mappings.some((mapping) => mapping.expected.labels.length > 0)
  ) {
    violations.push("capabilities().labels is true but no recording maps to a label");
  }

  if (unmappable.length === 0) {
    violations.push(
      "record at least one payload mapTicket must refuse — a half-filled row is worse than none",
    );
  }

  for (const { name, raw } of unmappable) {
    try {
      provider.mapTicket(raw);
      violations.push(`payload "${name}" was mapped rather than refused`);
    } catch (error) {
      if (!TicketSourceError.is(error)) {
        violations.push(
          `payload "${name}" was refused with ${describeThrown(error)} rather than a TicketSourceError`,
        );
      } else if (error.errorClass !== "upstream") {
        violations.push(
          `payload "${name}" was refused as ${error.errorClass} — a payload the tracker sent ` +
            "and this build cannot read is upstream",
        );
      }
    }
  }

  return violations;
}

/**
 * Where one canonical ticket differs from what was recorded, field by field.
 *
 * @param actual - What the provider produced.
 * @param expected - What the recording says.
 * @param at - What to prefix every sentence with.
 * @returns One sentence per differing field. Dates compare by instant and objects by content, so
 *   key order in `meta` is not a difference — `jsonb` does not keep it either.
 */
export function ticketDifferences(
  actual: CanonicalTicket,
  expected: CanonicalTicket,
  at: string,
): string[] {
  return CANONICAL_FIELD_NAMES.flatMap((field) => {
    const answered = comparable(actual[field]);
    const recorded = comparable(expected[field]);

    return answered === recorded ? [] : [`${at}: ${field} is ${answered}, recorded as ${recorded}`];
  });
}

/**
 * Where a mirror's tickets differ from the tickets a recording expects.
 *
 * @param actual - What the mirror holds.
 * @param expected - What the recording says it should hold.
 * @param label - Which leg this is, for the sentences.
 * @returns The violations: a missing ticket, an unexpected one, or a field that differs.
 */
export function backlogViolations(
  actual: readonly CanonicalTicket[],
  expected: readonly CanonicalTicket[],
  label: string,
): string[] {
  const held = new Map(actual.map((ticket) => [ticket.externalId, ticket]));
  const wanted = new Set(expected.map((ticket) => ticket.externalId));
  const violations: string[] = [];

  for (const ticket of expected) {
    const found = held.get(ticket.externalId);

    if (found === undefined) {
      violations.push(`${label}: ${ticket.externalKey} should be in the mirror and is not`);
    } else {
      violations.push(...ticketDifferences(found, ticket, `${label}: ${ticket.externalKey}`));
    }
  }

  for (const ticket of actual) {
    if (!wanted.has(ticket.externalId)) {
      violations.push(
        `${label}: the mirror holds ${ticket.externalKey}, which the recording does not expect`,
      );
    }
  }

  return violations;
}

/** One row the mirror wrote. */
export interface MirrorWrite {
  /** The ticket's display key, for a sentence a person can follow. */
  readonly externalKey: string;
  /** Whether the row was new or rewritten. */
  readonly write: "imported" | "updated";
}

/** What applying one page did. */
export interface MirrorApplied {
  /** The rows written. Empty is the answer a re-sync must give. */
  readonly writes: readonly MirrorWrite[];
  /** One sentence per ticket that came back older than the mirror's copy. */
  readonly regressions: readonly string[];
}

/**
 * The loop's write rules, over a map instead of a database.
 *
 * Two rules and one predicate, all of them the loop's: a closed ticket this mirror has never seen
 * is not stored (`ticket-sources.repository.ts`'s header), a row is rewritten only when `differs`
 * says so, and a `null` cursor leaves the stored one alone. The database half —
 * `tickets_touch_updated_at` really not firing — is `ticket-sources.integration-spec.ts`'s.
 */
export class ConformanceMirror {
  /** The stored rows, by external id, in the shape the loop's comparison reads. */
  private readonly rows = new Map<string, StoredTicket>();

  /** The stored cursor. */
  private storedCursor: string | null = null;

  /** The cursor the loop would hand to the next sync, or null before any was stored. */
  get cursor(): string | null {
    return this.storedCursor;
  }

  /**
   * Apply one page, as `applySync` would.
   *
   * @param page - A page already known to satisfy {@link pageViolations}.
   * @returns What was written, and every ticket that came back older than the stored copy.
   */
  apply(page: TicketPage): MirrorApplied {
    const writes: MirrorWrite[] = [];
    const regressions: string[] = [];

    for (const ticket of page.tickets) {
      const previous = this.rows.get(ticket.externalId);

      if (previous === undefined) {
        if (ticket.state !== "closed") {
          this.rows.set(ticket.externalId, rowOf(ticket));
          writes.push({ externalKey: ticket.externalKey, write: "imported" });
        }

        continue;
      }

      if (ticket.sourceUpdatedAt.getTime() < previous.source_updated_at.getTime()) {
        regressions.push(
          `${ticket.externalKey} came back as of ${ticket.sourceUpdatedAt.toISOString()}, older ` +
            `than the ${previous.source_updated_at.toISOString()} copy the mirror holds — a ` +
            "cursor that moved backwards",
        );
      }

      if (differs(previous, ticket)) {
        this.rows.set(ticket.externalId, rowOf(ticket));
        writes.push({ externalKey: ticket.externalKey, write: "updated" });
      }
    }

    if (page.nextCursor !== null) {
      this.storedCursor = page.nextCursor;
    }

    return { writes, regressions };
  }

  /**
   * What the mirror holds.
   *
   * @returns Every stored ticket, as canonical values.
   */
  tickets(): CanonicalTicket[] {
    return [...this.rows.values()].map(ticketOf);
  }
}

/** What one replay did. */
export interface Replay {
  /** Every page, in order. */
  readonly pages: readonly TicketPage[];
  /** Every write, in order. */
  readonly writes: readonly MirrorWrite[];
  /** Everything wrong, in order. */
  readonly violations: readonly string[];
}

/**
 * Sync one source the way the loop would, until the provider says there is no more.
 *
 * `fullSync` while the mirror has no cursor and `incrementalSync` once it has one — the loop's
 * entire dispatch — applying each page and following `hasMore` for at most {@link MAX_CHAIN}
 * pages.
 *
 * @param provider - The provider.
 * @param context - The source.
 * @param mirror - Where the pages land. Its cursor is where the replay starts.
 * @param label - Which leg this is, for the sentences.
 * @returns The pages, the writes and the violations. A rejection or a malformed page stops the
 *   replay and is reported rather than thrown.
 */
export async function replay(
  provider: TicketSourceProvider,
  context: TicketSyncContext,
  mirror: ConformanceMirror,
  label: string,
): Promise<Replay> {
  const capabilities = provider.capabilities();
  const pages: TicketPage[] = [];
  const writes: MirrorWrite[] = [];
  const violations: string[] = [];

  for (let step = 1; step <= MAX_CHAIN; step += 1) {
    const cursor = mirror.cursor;
    const at = `${label}, page ${step.toString()} (${cursor === null ? "fullSync" : "incrementalSync"})`;
    const settled = await settle(async () =>
      cursor === null ? provider.fullSync(context) : provider.incrementalSync(context, cursor),
    );

    if (!settled.resolved) {
      violations.push(`${at} rejected: ${describeThrown(settled.error)}`);

      return { pages, writes, violations };
    }

    const shape = pageViolations(settled.value, at, capabilities);

    if (shape.length > 0) {
      violations.push(...shape);

      return { pages, writes, violations };
    }

    const page = settled.value;
    const applied = mirror.apply(page);

    pages.push(page);
    writes.push(...applied.writes);
    violations.push(...applied.regressions.map((regression) => `${at}: ${regression}`));

    if (!page.hasMore) {
      return { pages, writes, violations };
    }
  }

  violations.push(
    `${label} never settled — hasMore was still true after ${MAX_CHAIN.toString()} pages`,
  );

  return { pages, writes, violations };
}

/**
 * Everything wrong with a webhook-capable provider's handling of recorded deliveries.
 *
 * @param provider - The provider, which must declare the capability.
 * @param webhook - The recordings.
 * @returns The violations.
 */
export async function webhookViolations(
  provider: TicketSourceProvider,
  webhook: WebhookConformance,
): Promise<string[]> {
  if (!supportsWebhooks(provider)) {
    return ["the provider does not declare webhooks, so it has no delivery to check"];
  }

  const violations: string[] = [];

  if (webhook.expected.length === 0) {
    violations.push(
      "record a delivery that carries a ticket — an empty outcome checks nothing about its shape",
    );
  }

  const delivered = await settle(async () =>
    provider.webhookHandler(webhook.delivery.payload, webhook.delivery.signature),
  );

  if (!delivered.resolved) {
    violations.push(`the signed delivery was refused: ${describeThrown(delivered.error)}`);
  } else {
    const outcome = delivered.value as unknown;
    const tickets = isRecord(outcome) ? outcome.tickets : undefined;

    if (!Array.isArray(tickets)) {
      violations.push("webhookHandler must answer { tickets } — the tickets a sync would write");
    } else {
      if (tickets.length !== webhook.expected.length) {
        violations.push(
          `the signed delivery answered ${tickets.length.toString()} ticket(s), recorded as ` +
            `${webhook.expected.length.toString()}`,
        );
      }

      for (const [index, ticket] of (tickets as unknown[]).entries()) {
        const at = `delivered ticket ${index.toString()}`;
        const shape = canonicalTicketViolations(ticket, at);
        const expected = webhook.expected.at(index);

        if (shape.length > 0) {
          violations.push(...shape);
        } else if (expected !== undefined) {
          violations.push(...ticketDifferences(ticket as CanonicalTicket, expected, at));
        }
      }
    }
  }

  const refusals: readonly [string, RecordedDelivery | { payload: unknown; signature: null }][] = [
    ["an unsigned delivery", { payload: webhook.delivery.payload, signature: null }],
    ["a forged delivery", webhook.forged],
  ];

  for (const [name, delivery] of refusals) {
    const refused = await settle(async () =>
      provider.webhookHandler(delivery.payload, delivery.signature),
    );

    if (refused.resolved) {
      violations.push(
        `${name} was accepted — a provider verifies its own signatures and refuses what fails`,
      );
    } else if (!TicketSourceError.is(refused.error) || refused.error.errorClass !== "auth") {
      violations.push(`${name} was refused with ${describeThrown(refused.error)} rather than auth`);
    }
  }

  return violations;
}

/**
 * Every string reachable from a value's fields.
 *
 * How the kit looks for a credential a provider kept: the way a leak would be found, by looking.
 * Walks own enumerable fields, arrays, maps and sets to {@link MAX_RETENTION_DEPTH}, visiting each
 * object once, so a provider holding a cyclic graph is still answered.
 *
 * @param root - Where to start — a provider.
 * @returns The strings, in the order they were found.
 */
export function retainedStrings(root: unknown): string[] {
  const found: string[] = [];
  const seen = new WeakSet<object>();

  const visit = (value: unknown, depth: number): void => {
    if (typeof value === "string") {
      found.push(value);

      return;
    }

    if (
      typeof value !== "object" ||
      value === null ||
      depth > MAX_RETENTION_DEPTH ||
      seen.has(value)
    ) {
      return;
    }

    seen.add(value);

    const children =
      value instanceof Map
        ? [...(value as Map<unknown, unknown>).keys(), ...(value as Map<unknown, unknown>).values()]
        : value instanceof Set
          ? [...(value as Set<unknown>)]
          : Object.values(value);

    for (const child of children) {
      visit(child, depth + 1);
    }
  };

  visit(root, 0);

  return found;
}

/**
 * Whether a provider kept the credential it was handed.
 *
 * @param provider - The provider, after a call.
 * @param credentials - The credential that call used, or null.
 * @returns A violation when any reachable string contains it.
 */
export function retentionViolations(
  provider: TicketSourceProvider,
  credentials: string | null,
): string[] {
  if (credentials === null || credentials === "") {
    return [];
  }

  return retainedStrings(provider).some((value) => value.includes(credentials))
    ? [
        "the provider holds the credential after the call returned — a provider is a singleton, " +
          "and one that keeps a token holds it across every request",
      ]
    : [];
}

/**
 * The suite.
 *
 * @param name - What the provider is called, for the `describe` block.
 * @param build - Builds a harness. A function rather than a value so every case gets a fresh
 *   provider and a fresh recording — a kit whose cases shared one would pass or fail by the order
 *   Jest ran them in.
 */
export function describeTicketSourceConformance(
  name: string,
  build: () => TicketSourceConformance,
): void {
  describe(`${name} — TicketSourceProvider conformance`, () => {
    it("keys on one of V030's ticket source kinds", () => {
      expect(TICKET_SOURCE_KINDS).toContain(build().provider.kind);
    });

    it("declares three stable capability flags and a write declaration that agree with its members", () => {
      expect(capabilityViolations(build().provider)).toEqual([]);
    });

    it("answers a config schema the settings form can render and the registry accepts", () => {
      const harness = build();

      expect(schemaViolations(harness.provider, harness.context)).toEqual([]);
    });

    it("passes Test connection with its own configuration, and says what it found", async () => {
      const { provider, context } = build();

      // Awaited as a value rather than round a `resolves` matcher: a rejection here is itself the
      // contract broken, and should fail the case as the error it is.
      const validation = await provider.validateConfig(context.config, context.credentials);

      expect(validationViolations(validation, null, context.credentials)).toEqual([]);
    });

    it("refuses each rejected configuration — as a result from Test connection, as not_found from a sync", async () => {
      const { provider, context, rejectedConfigs } = build();
      const violations: string[] =
        rejectedConfigs.length === 0 ? ["record at least one configuration to reject"] : [];

      for (const { name: shape, config } of rejectedConfigs) {
        const validated = await settle(async () =>
          provider.validateConfig(config, context.credentials),
        );

        violations.push(
          ...(validated.resolved
            ? validationViolations(validated.value, "not_found", context.credentials)
            : [`validateConfig rejected rather than answering: ${describeThrown(validated.error)}`]
          ).map((violation) => `${shape}: ${violation}`),
        );

        const synced = await settle(async () => provider.fullSync({ ...context, config }));

        violations.push(
          ...syncFailureViolations(synced, "not_found", context.credentials).map(
            (violation) => `${shape}: ${violation}`,
          ),
        );
      }

      expect(violations).toEqual([]);
    });

    for (const errorClass of TICKET_SOURCE_READ_ERROR_CLASSES) {
      it(`classifies its recorded ${errorClass} refusal as ${errorClass} — a result from Test connection, a TicketSourceError from a sync`, async () => {
        const { provider, context, refuse } = build();

        refuse[errorClass]();

        const validated = await settle(async () =>
          provider.validateConfig(context.config, context.credentials),
        );
        const synced = await settle(async () => provider.fullSync(context));

        expect([
          ...(validated.resolved
            ? validationViolations(validated.value, errorClass, context.credentials)
            : [
                `validateConfig rejected rather than answering: ${describeThrown(validated.error)}`,
              ]),
          ...syncFailureViolations(synced, errorClass, context.credentials),
        ]).toEqual([]);
      });
    }

    it("maps every recorded payload exactly, with each canonical field populated or explicitly null", () => {
      const { provider, mappings, unmappable } = build();

      expect(mappingViolations(provider, mappings, unmappable)).toEqual([]);
    });

    it("mirrors the recorded backlog from a cold import, and leaves a watermark", async () => {
      const { provider, context, backlog } = build();
      const mirror = new ConformanceMirror();
      const imported = await replay(provider, context, mirror, "cold import");

      expect([
        ...(backlog.length === 0 ? ["record a backlog of at least one ticket"] : []),
        ...imported.violations,
        ...backlogViolations(mirror.tickets(), backlog, "cold import"),
        ...(mirror.cursor === null && backlog.length > 0
          ? ["a cold import that stored tickets left no cursor, so the next cycle imports again"]
          : []),
      ]).toEqual([]);
    });

    it("writes nothing when the same cursor is synced again", async () => {
      const { provider, context } = build();
      const mirror = new ConformanceMirror();
      const imported = await replay(provider, context, mirror, "cold import");
      const cursor = mirror.cursor;
      const first = await replay(provider, context, mirror, "first re-sync");
      const second = await replay(provider, context, mirror, "second re-sync");
      const violations = [...imported.violations, ...first.violations, ...second.violations];

      for (const [label, resync] of [
        ["first re-sync", first],
        ["second re-sync", second],
      ] as const) {
        if (resync.writes.length > 0) {
          violations.push(
            `${label} wrote ${resync.writes.map((write) => write.externalKey).join(", ")} with ` +
              "nothing changed upstream",
          );
        }
      }

      if (mirror.cursor !== cursor) {
        violations.push(
          `re-syncing moved the cursor from ${String(cursor)} to ${String(mirror.cursor)} with ` +
            "nothing changed upstream",
        );
      }

      if (comparable(first.pages) !== comparable(second.pages)) {
        violations.push(
          "the same cursor answered two different pages with nothing changed upstream",
        );
      }

      expect(violations).toEqual([]);
    });

    it("carries an upstream change — a close included — through incrementalSync, without the watermark moving backwards", async () => {
      const harness = build();
      const { provider, context } = harness;
      const mirror = new ConformanceMirror();
      const imported = await replay(provider, context, mirror, "cold import");
      const before = mirror.cursor;

      harness.changeUpstream();

      const changed = await replay(provider, context, mirror, "after the change");
      const settled = await replay(provider, context, mirror, "re-sync after the change");
      const opened = new Set(
        harness.backlog
          .filter((ticket) => ticket.state === "open")
          .map((ticket) => ticket.externalId),
      );
      const violations = [
        ...imported.violations,
        ...changed.violations,
        ...backlogViolations(mirror.tickets(), harness.changedBacklog, "after the change"),
        ...settled.violations,
      ];

      if (
        !harness.changedBacklog.some(
          (ticket) => ticket.state === "closed" && opened.has(ticket.externalId),
        )
      ) {
        violations.push(
          "the recorded change must close a ticket the backlog holds open — incrementalSync must " +
            "be seen to return a departure",
        );
      }

      if (changed.writes.length > 0 && mirror.cursor === before) {
        violations.push(
          "the watermark did not move past a change the page carried, so every poll re-reads it",
        );
      }

      if (settled.writes.length > 0) {
        violations.push(
          `syncing again after the change wrote ${settled.writes
            .map((write) => write.externalKey)
            .join(", ")}`,
        );
      }

      expect(violations).toEqual([]);
    });

    it("holds no credential once a sync has returned", async () => {
      const { provider, context } = build();
      const imported = await replay(provider, context, new ConformanceMirror(), "cold import");

      expect([
        ...imported.violations,
        ...retentionViolations(provider, context.credentials),
      ]).toEqual([]);
    });

    it("maps a signed webhook delivery, and refuses unsigned and forged ones as auth — when it declares webhooks", async () => {
      const { provider, webhook } = build();
      const declared = provider.capabilities().webhooks;

      if (!declared) {
        // Not a skip: a polling provider has a contract here too — the member is unreachable and
        // there is nothing recorded for it — and this is the assertion that it stays that way.
        expect(supportsWebhooks(provider)).toBe(false);
        expect(webhook).toBeNull();

        return;
      }

      expect(
        webhook === null
          ? ["capabilities().webhooks is true, so record a signed delivery and a forged one"]
          : await webhookViolations(provider, webhook),
      ).toEqual([]);
    });
  });
}

/**
 * A value as comparable text: dates by instant, object keys in a fixed order.
 *
 * @param value - Any value a canonical ticket or a page holds.
 * @returns Its canonical JSON, or `undefined` spelled out.
 */
export function comparable(value: unknown): string {
  return (
    JSON.stringify(value, (_key, nested: unknown) =>
      isPlainObject(nested)
        ? Object.fromEntries(Object.entries(nested).sort(([a], [b]) => a.localeCompare(b)))
        : nested,
    ) ?? "undefined"
  );
}

/**
 * A thrown value, as a sentence.
 *
 * @param error - Whatever was caught.
 * @returns Its name and message, or the value rendered.
 */
export function describeThrown(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/**
 * Everything wrong with one bounded, non-blank text field.
 *
 * @param at - The sentence prefix.
 * @param field - The field's name.
 * @param value - Its value.
 * @param max - The longest it may be.
 * @returns One violation, or none.
 */
function textViolations(at: string, field: string, value: unknown, max: number): string[] {
  return typeof value === "string" && value.trim() !== "" && value.length <= max
    ? []
    : [`${at}: ${field} must be non-blank text of at most ${max.toString()} characters`];
}

/**
 * Everything wrong with a label list, by `tickets_labels_shape`.
 *
 * @param at - The sentence prefix.
 * @param labels - The value.
 * @returns The violations.
 */
function labelViolations(at: string, labels: unknown): string[] {
  if (!Array.isArray(labels)) {
    return [`${at}: labels must be an array — empty when the ticket has none`];
  }

  const violations: string[] = [];

  if (labels.length > CANONICAL_LIMITS.labels) {
    violations.push(`${at}: labels holds more than ${CANONICAL_LIMITS.labels.toString()} names`);
  }

  if (
    !(labels as unknown[]).every(
      (label) =>
        typeof label === "string" && label.trim() !== "" && label.length <= CANONICAL_LIMITS.label,
    )
  ) {
    violations.push(
      `${at}: every label must be non-blank text of at most ${CANONICAL_LIMITS.label.toString()} characters`,
    );
  }

  return violations;
}

/**
 * A valid `Date`, or nothing.
 *
 * @param value - The value.
 * @returns The date when it is one and parses.
 */
function instantOf(value: unknown): Date | undefined {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value : undefined;
}

/**
 * Whether a value is an object that is not an array.
 *
 * @param value - The value.
 * @returns `true` for an object, narrowing it to a record.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether a value is a plain object — a literal, not a `Date`, a `Map` or a class instance.
 *
 * @param value - The value.
 * @returns `true` for a plain object.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value) as unknown;

  return prototype === Object.prototype || prototype === null;
}

/**
 * Whether a value survives being stored as `jsonb` unchanged.
 *
 * @param value - The value.
 * @returns `true` for null, booleans, finite numbers, strings, and arrays and plain objects of
 *   those.
 */
function isJson(value: unknown): boolean {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return true;
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (Array.isArray(value)) {
    return (value as unknown[]).every(isJson);
  }

  return isPlainObject(value) && Object.values(value).every(isJson);
}

/**
 * A canonical ticket, as the loop's comparison reads a stored row.
 *
 * `meta` goes through JSON the way `jsonb` would take it, so a provider that later mutated the
 * object it returned could not reach into the mirror.
 *
 * @param ticket - The ticket.
 * @returns The row. Its `id` is the external id — the mirror has no other.
 */
function rowOf(ticket: CanonicalTicket): StoredTicket {
  return {
    id: ticket.externalId,
    external_id: ticket.externalId,
    external_key: ticket.externalKey,
    external_url: ticket.externalUrl,
    title: ticket.title,
    body: ticket.body,
    state: ticket.state,
    labels: [...ticket.labels],
    author: ticket.author,
    source_created_at: new Date(ticket.sourceCreatedAt.getTime()),
    source_updated_at: new Date(ticket.sourceUpdatedAt.getTime()),
    meta: JSON.parse(JSON.stringify(ticket.meta)) as unknown,
  };
}

/**
 * A stored row, as a canonical ticket again.
 *
 * @param row - The row.
 * @returns The ticket.
 */
function ticketOf(row: StoredTicket): CanonicalTicket {
  return {
    externalId: row.external_id,
    externalKey: row.external_key,
    externalUrl: row.external_url,
    title: row.title,
    body: row.body,
    state: row.state,
    labels: [...row.labels],
    author: row.author,
    sourceCreatedAt: new Date(row.source_created_at.getTime()),
    sourceUpdatedAt: new Date(row.source_updated_at.getTime()),
    meta: row.meta as CanonicalTicket["meta"],
  };
}
