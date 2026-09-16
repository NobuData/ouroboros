/**
 * The in-memory ticket source — the conformance kit's first subject, `docs/TICKET_SOURCES.md`'s
 * second worked example, and what the core intake harness runs on instead of a network.
 *
 * Q.5 ([#142](https://github.com/NobuData/ouroboros/issues/142)). Three jobs, and each one is a
 * reason it is written the way it is:
 *
 *   * **It proves the kit is passable by something that is not GitHub.** A contract only GitHub's
 *     provider satisfies is a contract shaped like GitHub. A second implementation sharing none of
 *     its code — no Octokit, no `since` timestamp, no integer identity — passing the same suite is
 *     what makes *pluggable* a test result.
 *   * **It powers core intake tests.** `ticket-sources.integration-spec.ts` runs the loop against a
 *     migrated database with this as its only provider, and `.dependency-cruiser.cjs`'s
 *     `ticket-source-core-tests-run-on-the-fake` keeps Octokit out of those suites.
 *   * **It is an example a provider author can copy.** So it does what the SPI asks rather than
 *     what a stub could get away with: it collapses a four-word workflow onto `open` and `closed`,
 *     keeps its tracker's own word in `meta`, answers a cursor the loop never reads, classifies
 *     refusals through `classifyHttpStatus`, and verifies its own webhook signatures.
 *
 * ---------------------------------------------------------------------------
 * **Two halves: a tracker, and a provider that talks to it.** {@link InMemoryTracker} is the far
 * side of the wire — records, a clock, an access token it keeps only as a digest, and a request log
 * a suite can read. {@link InMemoryTicketSourceProvider} is the client, and holds nothing but the
 * tracker it was pointed at. Keeping them apart is what makes the kit's *"holds no credential"*
 * check honest here: a fake that compared tokens inside the provider would have to keep one.
 *
 * **Why the cursor is `<updated>~<id>`.** A timestamp alone is either inclusive or lossy — two
 * records touched in the same instant either come back on every poll or one of them never does. A
 * position to resume after, exclusive on both halves, is exact; and it is deliberately not a value
 * the loop could mistake for a date.
 *
 * **Two classes rather than one with a flag**, for `providers/adapters/fake.adapter.fixture.ts`'s
 * reason: {@link InMemoryWebhookTicketSourceProvider} declares `webhooks: true` and implements the
 * member, and the polling provider has no such member at all.
 *
 * **The write half is a third class, configured rather than subclassed per mapping.**
 * {@link InMemoryWriteTicketSourceProvider} implements AL.2's
 * ([#278](https://github.com/NobuData/ouroboros/issues/278)) `WriteCapableProvider` over the same
 * tracker, and takes its write declaration as an option — so one class is the fully featured
 * writer, the writer with no native relations that exercises the documented `linkDependency`
 * fallback, and the writer whose epics map to `none`. Three subclasses would be three copies of
 * one set of members differing only in a constant.
 *
 * **Why it keys on `custom` by default.** V030's five kinds have no `fake`, and `custom` is the kind
 * a provider written outside this repository registers as — which is what this file is the on-ramp
 * for. A suite that needs it to stand in for `jira` passes the kind.
 *
 * It is a `.fixture.ts`: nothing that ships imports it, and `tsconfig.build.json` leaves it out.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type { TicketSourceKind } from "../../db/schema";
import {
  PLACEHOLDER_ANNOTATION,
  PROVIDER_CONFIG_DIALECT,
  SECRET_ANNOTATION,
} from "../../providers/provider.config";
import { canonicalTicketViolations } from "../conformance.fixture";
import type { TicketSourceConfigSchema } from "../ticket-source.config";
import {
  TicketSourceError,
  classifyHttpStatus,
  classifyWriteHttpStatus,
  type TicketSourceErrorClass,
} from "../ticket-source.errors";
import type {
  CanonicalTicket,
  TicketPage,
  TicketSourceCapabilities,
  TicketSourceProvider,
  TicketSourceValidation,
  TicketSyncContext,
  WebhookCapableProvider,
  WebhookOutcome,
  WriteCapableProvider,
} from "../ticket-source.provider";
import {
  MAX_IDEMPOTENCY_KEY,
  READ_ONLY_WRITE_CAPABILITIES,
  hasDependencyMarker,
  withDependencyMarker,
  type DependencyLinkResult,
  type EpicContainerInput,
  type EpicMirrorRef,
  type MilestoneRef,
  type TicketDraftInput,
  type TicketSourceWriteCapabilities,
  type TicketWriteRef,
} from "../ticket-source.write";

/** The project every tracker has unless told otherwise. */
export const IN_MEMORY_PROJECT = "PROJ";

/**
 * The access token a tracker accepts unless told otherwise, and worth nothing.
 *
 * Shaped like a real token and distinctive, because the kit searches every detail, reason and
 * provider field for it — a value that looked like prose could pass by being missed.
 */
export const IN_MEMORY_TOKEN = "imt_Q5fixtureINMEMORYtrackerTOKEN000142";

/** The secret the webhook fixtures sign deliveries with. */
export const IN_MEMORY_WEBHOOK_SECRET = "whsec_Q5fixtureINMEMORYdeliveries000142";

/** Where a record's link points. `.invalid` is reserved, so nothing ever answers there. */
export const IN_MEMORY_SITE = "https://tracker.example.invalid";

/** The tracker's clock before its first change. */
export const IN_MEMORY_EPOCH = new Date("2026-09-01T09:00:00.000Z");

/** How far the clock moves on every change, so every record's stamp is distinct and predictable. */
export const IN_MEMORY_TICK_MS = 60_000;

/** How many records one sync answers unless told otherwise. */
export const IN_MEMORY_PAGE_SIZE = 50;

/** The property name the access token is submitted under. */
export const IN_MEMORY_TOKEN_FIELD = "token";

/** What a project key looks like: upper-case, as the tracker spells it, at most sixteen long. */
export const IN_MEMORY_PROJECT_PATTERN = /^[A-Z][A-Z0-9]{0,15}$/;

/** The tracker's workflow — four words, which the provider has to collapse onto two. */
export const IN_MEMORY_STATUSES = ["todo", "in_progress", "done", "wont_do"] as const;

/** One of {@link IN_MEMORY_STATUSES}. */
export type InMemoryStatus = (typeof IN_MEMORY_STATUSES)[number];

/** The statuses that are `closed` in the canonical model. The rest are `open`. */
const CLOSED_STATUSES: readonly InMemoryStatus[] = ["done", "wont_do"];

/** The HTTP status the tracker refuses with for each class — what `classifyHttpStatus` reads back. */
const REFUSAL_STATUS: Readonly<Record<TicketSourceErrorClass, number>> = Object.freeze({
  auth: 401,
  permission: 403,
  validation: 422,
  rate_limit: 429,
  not_found: 404,
  upstream: 503,
});

/** One record, as the tracker serves it — this tracker's wire format, not the canonical model. */
export interface InMemoryRecord {
  /** The immutable identity. Numeric text, and never the key. */
  readonly id: string;
  /** The display key — `PROJ-7`. */
  readonly key: string;
  /** The project it belongs to. */
  readonly project: string;
  /** The title. */
  readonly summary: string;
  /** The description, or null when there is none. */
  readonly description: string | null;
  /** Where it is in the workflow. */
  readonly status: InMemoryStatus;
  /** Its tags, in order. */
  readonly tags: readonly string[];
  /** Who filed it, or null for an account that is gone. */
  readonly reporter: string | null;
  /** When it was filed, ISO-8601. */
  readonly created: string;
  /** When it last changed, ISO-8601. */
  readonly updated: string;
}

/** What filing a record takes. */
export interface InMemoryFiling {
  /** The title. */
  readonly summary: string;
  /** The description. Null — the tracker saying nothing — unless given. */
  readonly description?: string | null;
  /** The status. `todo` unless given. */
  readonly status?: InMemoryStatus;
  /** The tags. None unless given. */
  readonly tags?: readonly string[];
  /** The reporter. Null unless given. */
  readonly reporter?: string | null;
  /** The project. {@link IN_MEMORY_PROJECT} unless given. */
  readonly project?: string;
}

/** A record to create over the wire — what the write provider sends. */
export interface InMemoryCreation extends InMemoryFiling {
  /** The caller's idempotency key, which the tracker stores and {@link InMemoryTracker.search} finds. */
  readonly idempotencyKey: string;
  /** The milestone to assign, by id, or null. */
  readonly milestoneId: string | null;
}

/** A milestone, as the tracker serves it. */
export interface InMemoryMilestone {
  /** Its identity — `M1`. */
  readonly id: string;
  /** Its name. */
  readonly name: string;
}

/** An epic container, as the tracker serves it. */
export interface InMemoryContainer {
  /** Its handle — `EPIC-1`. */
  readonly ref: string;
  /** The planning epic it was created for. */
  readonly epicId: string;
  /** Its title. */
  readonly title: string;
}

/**
 * Everything the tracker holds that a write could have changed, as a suite reads it.
 *
 * Read directly off the tracker rather than over the wire, because it is the *outcome* a write
 * suite checks — how many tickets exist — and asking the provider would be asking the thing under
 * test to mark its own work.
 */
export interface InMemoryWriteLedger {
  /** Every record, by id. */
  readonly records: readonly string[];
  /** Native relations, as `[blockerId, blockedId]`. */
  readonly relations: readonly (readonly [string, string])[];
  /** Relations recorded through the body-marker fallback, as `[blockerId, blockedId]`. */
  readonly markers: readonly (readonly [string, string])[];
  /** Every milestone, by id. */
  readonly milestones: readonly string[];
  /** Every container, by ref. */
  readonly containers: readonly string[];
  /** Memberships, as `[containerRef, recordId]`. */
  readonly memberships: readonly (readonly [string, string])[];
  /** Which milestone each record is assigned, as `[recordId, milestoneId]`. */
  readonly assignments: readonly (readonly [string, string])[];
}

/** The longest title the tracker accepts — `tickets_title_present`'s bound, so a push it takes a sync can store. */
export const IN_MEMORY_MAX_SUMMARY = 512;

/** What an edit may change. The status moves through {@link InMemoryTracker.transition} instead. */
export type InMemoryEdit = Partial<
  Pick<InMemoryRecord, "summary" | "description" | "tags" | "reporter">
>;

/** A place in the tracker's order to resume after. */
export interface InMemoryPosition {
  /** The `updated` stamp of the last record seen. */
  readonly updated: string;
  /** Its id — the tiebreak between records touched in the same instant. */
  readonly id: string;
}

/** Every operation the tracker serves — two reads, then the writes AL.2's provider makes. */
export type TrackerOperation =
  | "probe"
  | "list"
  | "fetch"
  | "search"
  | "create"
  | "amend"
  | "relate"
  | "milestones"
  | "create-milestone"
  | "find-container"
  | "create-container"
  | "add-member";

/** One request the tracker served, as its access log records it. Never the token. */
export interface TrackerRequest {
  /** What was asked. */
  readonly operation: TrackerOperation;
  /** Which project. */
  readonly project: string;
  /** Whether only open records were wanted. */
  readonly openOnly: boolean;
  /** Where the listing resumed, or null for one from the beginning. */
  readonly after: InMemoryPosition | null;
}

/** How a tracker is set up. */
export interface InMemoryTrackerOptions {
  /** The token it accepts, or null for a public tracker that asks for none. {@link IN_MEMORY_TOKEN} unless given. */
  readonly token?: string | null;
  /** The projects it has. Only {@link IN_MEMORY_PROJECT} unless given. */
  readonly projects?: readonly string[];
  /** Its clock before the first change. {@link IN_MEMORY_EPOCH} unless given. */
  readonly epoch?: Date;
}

/** One listing request. */
export interface InMemoryQuery {
  /** The token presented, or null. */
  readonly token: string | null;
  /** The project. */
  readonly project: string;
  /** Only records whose status is open. */
  readonly openOnly: boolean;
  /** Only records after this position, or null for all. */
  readonly after: InMemoryPosition | null;
  /** The most records to answer. */
  readonly limit: number;
}

/** One listing. */
export interface InMemoryListing {
  /** The records, in the tracker's order: `updated` ascending, then `id`. */
  readonly records: readonly InMemoryRecord[];
  /** Whether more records matched than the limit let through. */
  readonly more: boolean;
}

/** What a webhook delivery carries. */
export interface InMemoryDeliveryPayload {
  /** What happened. The provider acts on `record.updated` and nothing else. */
  readonly event: "record.updated" | "ping";
  /** The record as it now is, on `record.updated`. */
  readonly record?: InMemoryRecord;
}

/** One delivery, with the signature header the tracker sent it under. */
export interface InMemoryDelivery {
  /** The body. */
  readonly payload: InMemoryDeliveryPayload;
  /** `sha256=<hex>` over the body, keyed by the webhook secret. */
  readonly signature: string;
}

/**
 * A refusal, as the tracker answers one: an HTTP status, and when a rate window lifts.
 *
 * Deliberately not a `TicketSourceError` — the tracker has never heard of the SPI, and translating
 * its refusal into the taxonomy is the provider's job.
 */
export class InMemoryTrackerRefusal extends Error {
  /**
   * @param status - The HTTP status.
   * @param retryAt - When a rate window lifts, or null.
   */
  constructor(
    readonly status: number,
    readonly retryAt: Date | null = null,
  ) {
    super(`the in-memory tracker answered ${status.toString()}`);
    this.name = "InMemoryTrackerRefusal";
  }
}

/**
 * The far side of the wire: records, a clock, and the rules a real tracker would apply.
 *
 * Every change moves the clock by {@link IN_MEMORY_TICK_MS}, so a suite can state a record's stamps
 * exactly. Records are frozen, so what a suite holds cannot change what the tracker serves.
 */
export class InMemoryTracker {
  /** Every request served, in order — the tracker's access log. Carries no token. */
  readonly requests: TrackerRequest[] = [];

  /** The records, by id. */
  private readonly records = new Map<string, InMemoryRecord>();

  /** The projects this tracker has. */
  private readonly projects: ReadonlySet<string>;

  /** The accepted token's SHA-256, or null for a public tracker. Never the token itself. */
  private readonly tokenDigest: string | null;

  /** The clock, in epoch milliseconds. */
  private clock: number;

  /** How many records have been filed — the sequence ids and keys are numbered from. */
  private filed = 0;

  /** The refusal every request meets until {@link recover}, or null. */
  private refusal: InMemoryTrackerRefusal | null = null;

  /** Record ids by the idempotency key they were created under. */
  private readonly keys = new Map<string, string>();

  /** Native relations, as `blockerId→blockedId`. */
  private readonly relations = new Set<string>();

  /** Milestones, by id. */
  private readonly milestoneById = new Map<string, InMemoryMilestone>();

  /** Which milestone each record is assigned, by record id. */
  private readonly assignments = new Map<string, string>();

  /** Epic containers, by ref. */
  private readonly containers = new Map<string, InMemoryContainer>();

  /** Memberships, as `containerRef→recordId`. */
  private readonly memberships = new Set<string>();

  /**
   * @param options - How the tracker is set up.
   */
  constructor(options: InMemoryTrackerOptions = {}) {
    const token = options.token === undefined ? IN_MEMORY_TOKEN : options.token;

    this.tokenDigest = token === null ? null : digestOf(token);
    this.projects = new Set(options.projects ?? [IN_MEMORY_PROJECT]);
    this.clock = (options.epoch ?? IN_MEMORY_EPOCH).getTime();
  }

  /**
   * File a record.
   *
   * @param filing - What it says.
   * @returns The record, numbered in filing order — id `10001`, key `PROJ-1` — and stamped now.
   * @throws {RangeError} When the project is not one this tracker has.
   */
  file(filing: InMemoryFiling): InMemoryRecord {
    const project = filing.project ?? IN_MEMORY_PROJECT;

    if (!this.projects.has(project)) {
      throw new RangeError(`the in-memory tracker has no project ${project}`);
    }

    this.filed += 1;

    const at = this.tick();

    return this.store({
      id: (10_000 + this.filed).toString(),
      key: `${project}-${this.filed.toString()}`,
      project,
      summary: filing.summary,
      description: filing.description ?? null,
      status: filing.status ?? "todo",
      tags: filing.tags ?? [],
      reporter: filing.reporter ?? null,
      created: at,
      updated: at,
    });
  }

  /**
   * Change a record's fields.
   *
   * @param id - The record.
   * @param changes - What changes.
   * @returns The record as it now is, stamped now.
   * @throws {RangeError} When there is no such record.
   */
  edit(id: string, changes: InMemoryEdit): InMemoryRecord {
    return this.store({ ...this.record(id), ...changes, updated: this.tick() });
  }

  /**
   * Move a record through the workflow.
   *
   * @param id - The record.
   * @param status - Where it goes.
   * @returns The record as it now is, stamped now.
   * @throws {RangeError} When there is no such record.
   */
  transition(id: string, status: InMemoryStatus): InMemoryRecord {
    return this.store({ ...this.record(id), status, updated: this.tick() });
  }

  /**
   * One record, as the tracker would serve it.
   *
   * @param id - The record.
   * @returns The record.
   * @throws {RangeError} When there is no such record.
   */
  record(id: string): InMemoryRecord {
    const record = this.records.get(id);

    if (record === undefined) {
      throw new RangeError(`the in-memory tracker has no record ${id}`);
    }

    return record;
  }

  /**
   * Refuse every request from now on, until {@link recover}.
   *
   * @param errorClass - Which class of refusal — answered as the HTTP status that class reads as.
   * @param retryAt - When the window lifts, for `rate_limit`; ignored for the other classes.
   */
  refuse(errorClass: TicketSourceErrorClass, retryAt: Date | null = null): void {
    this.refusal = new InMemoryTrackerRefusal(
      REFUSAL_STATUS[errorClass],
      errorClass === "rate_limit" ? retryAt : null,
    );
  }

  /** Answer requests again. */
  recover(): void {
    this.refusal = null;
  }

  /**
   * What **Test connection** asks: may this token see this project, and how much is open there?
   *
   * @param token - The token presented, or null.
   * @param project - The project.
   * @returns How many open records the project holds.
   * @throws {InMemoryTrackerRefusal} When the request is refused.
   */
  probe(token: string | null, project: string): number {
    this.requests.push({ operation: "probe", project, openOnly: true, after: null });
    this.admit(token, project);

    return this.ordered().filter(
      (record) => record.project === project && !isClosedStatus(record.status),
    ).length;
  }

  /**
   * List records in the tracker's order.
   *
   * @param query - What to list.
   * @returns At most `limit` records, and whether more matched.
   * @throws {InMemoryTrackerRefusal} When the request is refused.
   */
  list(query: InMemoryQuery): InMemoryListing {
    this.requests.push({
      operation: "list",
      project: query.project,
      openOnly: query.openOnly,
      after: query.after,
    });
    this.admit(query.token, query.project);

    const matching = this.ordered().filter(
      (record) =>
        record.project === query.project &&
        !(query.openOnly && isClosedStatus(record.status)) &&
        (query.after === null || isAfter(record, query.after)),
    );

    return { records: matching.slice(0, query.limit), more: matching.length > query.limit };
  }

  /**
   * One record, over the wire.
   *
   * @param token - The token presented, or null.
   * @param project - The project.
   * @param id - The record.
   * @returns The record.
   * @throws {InMemoryTrackerRefusal} When refused; `404` when the project has no such record.
   */
  fetch(token: string | null, project: string, id: string): InMemoryRecord {
    this.log("fetch", project);
    this.admit(token, project);

    return this.recordIn(project, id);
  }

  /**
   * The record created under an idempotency key, if any — the search a writer makes before it
   * creates.
   *
   * @param token - The token presented, or null.
   * @param project - The project.
   * @param idempotencyKey - The key.
   * @returns The record, or undefined when nothing was created under it.
   * @throws {InMemoryTrackerRefusal} When refused.
   */
  search(
    token: string | null,
    project: string,
    idempotencyKey: string,
  ): InMemoryRecord | undefined {
    this.log("search", project);
    this.admit(token, project);

    const id = this.keys.get(`${project}:${idempotencyKey}`);

    return id === undefined ? undefined : this.record(id);
  }

  /**
   * Create a record over the wire. **Checks everything before it stores anything**, so a refusal
   * leaves nothing behind — what the write suites' rollback case relies on.
   *
   * @param token - The token presented, or null.
   * @param project - The project.
   * @param creation - What to create.
   * @returns The record.
   * @throws {InMemoryTrackerRefusal} When refused; `422` for a blank or overlong summary or a
   *   milestone the project does not have.
   */
  create(token: string | null, project: string, creation: InMemoryCreation): InMemoryRecord {
    this.log("create", project);
    this.admit(token, project);

    const summary = creation.summary.trim();

    if (summary === "" || summary.length > IN_MEMORY_MAX_SUMMARY) {
      throw new InMemoryTrackerRefusal(422);
    }

    if (creation.milestoneId !== null && !this.milestoneById.has(creation.milestoneId)) {
      throw new InMemoryTrackerRefusal(422);
    }

    const record = this.file({ ...creation, project });

    this.keys.set(`${project}:${creation.idempotencyKey}`, record.id);

    if (creation.milestoneId !== null) {
      this.assignments.set(record.id, creation.milestoneId);
    }

    return record;
  }

  /**
   * Change a record's description over the wire — how the fallback writer records a relation.
   *
   * @param token - The token presented, or null.
   * @param project - The project.
   * @param id - The record.
   * @param description - The new description.
   * @returns The record as it now is.
   * @throws {InMemoryTrackerRefusal} When refused; `404` for a record the project does not have.
   */
  amend(token: string | null, project: string, id: string, description: string): InMemoryRecord {
    this.log("amend", project);
    this.admit(token, project);
    this.recordIn(project, id);

    return this.edit(id, { description });
  }

  /**
   * Record a native relation. Idempotent.
   *
   * @param token - The token presented, or null.
   * @param project - The project.
   * @param blockerId - The blocking record.
   * @param blockedId - The blocked record.
   * @throws {InMemoryTrackerRefusal} When refused; `404` for a record the project does not have;
   *   `422` for a record related to itself.
   */
  relate(token: string | null, project: string, blockerId: string, blockedId: string): void {
    this.log("relate", project);
    this.admit(token, project);
    this.recordIn(project, blockerId);
    this.recordIn(project, blockedId);

    if (blockerId === blockedId) {
      throw new InMemoryTrackerRefusal(422);
    }

    this.relations.add(`${blockerId}→${blockedId}`);
  }

  /**
   * Every milestone the tracker has.
   *
   * @param token - The token presented, or null.
   * @param project - The project.
   * @returns The milestones, in creation order.
   * @throws {InMemoryTrackerRefusal} When refused.
   */
  milestones(token: string | null, project: string): InMemoryMilestone[] {
    this.log("milestones", project);
    this.admit(token, project);

    return [...this.milestoneById.values()];
  }

  /**
   * Create a milestone. Not idempotent — like a real tracker, it creates another on every call,
   * which is why the provider lists first.
   *
   * @param token - The token presented, or null.
   * @param project - The project.
   * @param name - Its name.
   * @returns The milestone.
   * @throws {InMemoryTrackerRefusal} When refused; `422` for a blank name.
   */
  createMilestone(token: string | null, project: string, name: string): InMemoryMilestone {
    this.log("create-milestone", project);
    this.admit(token, project);

    if (name.trim() === "") {
      throw new InMemoryTrackerRefusal(422);
    }

    const milestone = Object.freeze({
      id: `M${(this.milestoneById.size + 1).toString()}`,
      name,
    });

    this.milestoneById.set(milestone.id, milestone);

    return milestone;
  }

  /**
   * The container created for a planning epic, if any.
   *
   * @param token - The token presented, or null.
   * @param project - The project.
   * @param epicId - The planning epic.
   * @returns The container, or undefined.
   * @throws {InMemoryTrackerRefusal} When refused.
   */
  findContainer(
    token: string | null,
    project: string,
    epicId: string,
  ): InMemoryContainer | undefined {
    this.log("find-container", project);
    this.admit(token, project);

    return [...this.containers.values()].find((container) => container.epicId === epicId);
  }

  /**
   * Create a container. Not idempotent, for {@link createMilestone}'s reason.
   *
   * @param token - The token presented, or null.
   * @param project - The project.
   * @param epicId - The planning epic.
   * @param title - Its title.
   * @returns The container.
   * @throws {InMemoryTrackerRefusal} When refused; `422` for a blank title.
   */
  createContainer(
    token: string | null,
    project: string,
    epicId: string,
    title: string,
  ): InMemoryContainer {
    this.log("create-container", project);
    this.admit(token, project);

    if (title.trim() === "") {
      throw new InMemoryTrackerRefusal(422);
    }

    const container = Object.freeze({
      ref: `EPIC-${(this.containers.size + 1).toString()}`,
      epicId,
      title,
    });

    this.containers.set(container.ref, container);

    return container;
  }

  /**
   * Make a record a member of a container. Idempotent.
   *
   * @param token - The token presented, or null.
   * @param project - The project.
   * @param ref - The container.
   * @param recordId - The record.
   * @throws {InMemoryTrackerRefusal} When refused; `404` for a container or record that is not there.
   */
  addMember(token: string | null, project: string, ref: string, recordId: string): void {
    this.log("add-member", project);
    this.admit(token, project);
    this.recordIn(project, recordId);

    if (!this.containers.has(ref)) {
      throw new InMemoryTrackerRefusal(404);
    }

    this.memberships.add(`${ref}→${recordId}`);
  }

  /**
   * Everything a write could have changed — see {@link InMemoryWriteLedger}.
   *
   * @param markersOf - Reads the blocker ids a body records through the fallback. Passed in, so
   *   the tracker — which has never heard of the SPI — does not parse the SPI's marker itself.
   * @returns The ledger.
   */
  ledger(markersOf: (body: string | null) => readonly string[]): InMemoryWriteLedger {
    const pairs = (set: ReadonlySet<string>): [string, string][] =>
      [...set].map((entry) => entry.split("→") as [string, string]);

    return {
      records: [...this.records.keys()],
      relations: pairs(this.relations),
      markers: [...this.records.values()].flatMap((record) =>
        markersOf(record.description).map((blocker) => [blocker, record.id] as const),
      ),
      milestones: [...this.milestoneById.keys()],
      containers: [...this.containers.keys()],
      memberships: pairs(this.memberships),
      assignments: [...this.assignments.entries()],
    };
  }

  /**
   * A signed delivery announcing a record's current state.
   *
   * @param id - The record.
   * @param secret - The webhook secret to sign with.
   * @returns The delivery.
   * @throws {RangeError} When there is no such record.
   */
  deliver(id: string, secret: string): InMemoryDelivery {
    const payload: InMemoryDeliveryPayload = { event: "record.updated", record: this.record(id) };

    return { payload, signature: signInMemoryDelivery(payload, secret) };
  }

  /**
   * A signed delivery that carries no record — what a tracker sends to check an endpoint exists.
   *
   * @param secret - The webhook secret to sign with.
   * @returns The delivery.
   */
  ping(secret: string): InMemoryDelivery {
    const payload: InMemoryDeliveryPayload = { event: "ping" };

    return { payload, signature: signInMemoryDelivery(payload, secret) };
  }

  /**
   * Refuse a request, or let it through.
   *
   * @param token - The token presented.
   * @param project - The project asked about.
   * @throws {InMemoryTrackerRefusal} The arranged refusal first; then `401` for a missing or wrong
   *   token on a tracker that requires one; then `404` for a project it does not have.
   */
  private admit(token: string | null, project: string): void {
    if (this.refusal !== null) {
      throw this.refusal;
    }

    if (this.tokenDigest !== null && (token === null || digestOf(token) !== this.tokenDigest)) {
      throw new InMemoryTrackerRefusal(401);
    }

    if (!this.projects.has(project)) {
      throw new InMemoryTrackerRefusal(404);
    }
  }

  /**
   * Log a write-side request. The read operations log their own richer entries.
   *
   * @param operation - What was asked.
   * @param project - Which project.
   */
  private log(operation: TrackerOperation, project: string): void {
    this.requests.push({ operation, project, openOnly: false, after: null });
  }

  /**
   * One record, as a wire call finds it.
   *
   * @param project - The project it must belong to.
   * @param id - The record.
   * @returns The record.
   * @throws {InMemoryTrackerRefusal} `404` when there is no such record in the project.
   */
  private recordIn(project: string, id: string): InMemoryRecord {
    const record = this.records.get(id);

    if (record?.project !== project) {
      throw new InMemoryTrackerRefusal(404);
    }

    return record;
  }

  /**
   * Every record, in the tracker's order.
   *
   * @returns The records, `updated` ascending and then by numeric id.
   */
  private ordered(): InMemoryRecord[] {
    return [...this.records.values()].sort(byPosition);
  }

  /**
   * Move the clock one tick.
   *
   * @returns The new instant, ISO-8601.
   */
  private tick(): string {
    this.clock += IN_MEMORY_TICK_MS;

    return new Date(this.clock).toISOString();
  }

  /**
   * Store a record, frozen.
   *
   * @param record - The record.
   * @returns The stored copy.
   */
  private store(record: InMemoryRecord): InMemoryRecord {
    const frozen: InMemoryRecord = Object.freeze({
      ...record,
      tags: Object.freeze([...record.tags]),
    });

    this.records.set(frozen.id, frozen);

    return frozen;
  }
}

/** The in-memory kind's settings, parsed. */
export interface InMemorySourceConfig {
  /** The project to mirror. */
  readonly project: string;
}

/**
 * The in-memory kind's settings, as a form.
 *
 * A fresh object every call, so a caller holding one while somebody fills in a form cannot edit the
 * next caller's copy. The token is optional because a public tracker asks for none.
 *
 * @returns The schema.
 */
export function inMemorySourceSchema(): TicketSourceConfigSchema {
  return {
    $schema: PROVIDER_CONFIG_DIALECT,
    type: "object",
    title: "Connect the in-memory tracker",
    properties: {
      project: {
        type: "string",
        title: "Project key",
        description: "The project to mirror, as the tracker spells it.",
        minLength: 1,
        maxLength: 16,
        pattern: IN_MEMORY_PROJECT_PATTERN.source,
        [PLACEHOLDER_ANNOTATION]: "Upper-case, as the tracker spells it",
      },
      [IN_MEMORY_TOKEN_FIELD]: {
        type: "string",
        title: "Access token",
        description: "Needed unless the tracker is public. Sealed in the vault once stored.",
        minLength: 8,
        maxLength: 256,
        [SECRET_ANNOTATION]: true,
      },
    },
    required: ["project"],
    additionalProperties: false,
  };
}

/**
 * Read an in-memory source's configuration.
 *
 * @param config - `ticket_sources.config`, as the loop handed it over.
 * @returns The settings.
 * @throws {TicketSourceError} `not_found`, when the object is not this grammar — the class
 *   `docs/TICKET_SOURCES.md` § 4 gives a configuration the tracker cannot be asked with.
 */
export function readInMemoryConfig(config: unknown): InMemorySourceConfig {
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    throw new TicketSourceError("not_found", "config is not the in-memory tracker's settings");
  }

  const { project } = config as { project?: unknown };

  if (typeof project !== "string" || !IN_MEMORY_PROJECT_PATTERN.test(project)) {
    throw new TicketSourceError("not_found", "config.project is not a key the tracker could have");
  }

  return { project };
}

/** How a provider is set up. */
export interface InMemoryProviderOptions {
  /** The kind it answers for. `custom` unless given — see this file's header. */
  readonly kind?: TicketSourceKind;
  /** The most records one sync answers. {@link IN_MEMORY_PAGE_SIZE} unless given. */
  readonly pageSize?: number;
}

/**
 * The client half: a `TicketSourceProvider` over an {@link InMemoryTracker}.
 *
 * Stateless apart from the tracker it was pointed at — see this file's header on why that is what
 * lets the kit's retention check pass honestly.
 */
export class InMemoryTicketSourceProvider implements TicketSourceProvider {
  /** The kind this provider answers for. */
  readonly kind: TicketSourceKind;

  /** The most records one sync answers. */
  private readonly pageSize: number;

  /**
   * @param tracker - The tracker to talk to.
   * @param options - The kind and the page size.
   * @throws {RangeError} When the page size is not a positive whole number — a page of nothing
   *   would answer `hasMore: true` forever.
   */
  constructor(
    private readonly tracker: InMemoryTracker,
    options: InMemoryProviderOptions = {},
  ) {
    const pageSize = options.pageSize ?? IN_MEMORY_PAGE_SIZE;

    if (!Number.isInteger(pageSize) || pageSize < 1) {
      throw new RangeError(
        `pageSize must be a positive whole number, received ${String(pageSize)}`,
      );
    }

    this.kind = options.kind ?? "custom";
    this.pageSize = pageSize;
  }

  /**
   * What this provider can do.
   *
   * @returns Labels yes — the tracker has tags. Webhooks no: that is
   *   {@link InMemoryWebhookTicketSourceProvider}. Writes no: that is
   *   {@link InMemoryWriteTicketSourceProvider}.
   */
  capabilities(): TicketSourceCapabilities {
    return {
      webhooks: false,
      labels: true,
      bidirectionalWrites: false,
      write: READ_ONLY_WRITE_CAPABILITIES,
    };
  }

  /**
   * The settings this provider takes.
   *
   * @returns {@link inMemorySourceSchema}.
   */
  configSchema(): TicketSourceConfigSchema {
    return inMemorySourceSchema();
  }

  /**
   * Test a configuration against the tracker.
   *
   * @param config - The settings.
   * @param credentials - The token, or null.
   * @returns What the probe found — `PROJ · 3 open tickets`. **Never rejects**: a bad config and a
   *   refusal are both results.
   */
  validateConfig(config: unknown, credentials: string | null): Promise<TicketSourceValidation> {
    let result: TicketSourceValidation;

    try {
      const { project } = readInMemoryConfig(config);
      const open = this.tracker.probe(credentials, project);

      result = {
        status: "ok",
        detail: `${project} · ${open.toString()} open ${open === 1 ? "ticket" : "tickets"}`,
      };
    } catch (error) {
      const failure = asInMemoryFailure(error);

      result = { status: "failed", errorClass: failure.errorClass, detail: failure.detail };
    }

    return Promise.resolve(result);
  }

  /**
   * Every open record in the project, from the beginning.
   *
   * @param context - The source, opened.
   * @returns One page.
   * @throws {TicketSourceError} When the tracker refused, or the configuration cannot be read.
   */
  fullSync(context: TicketSyncContext): Promise<TicketPage> {
    return settledPage(() => this.walk(context, null));
  }

  /**
   * Every record — open or not — changed after a cursor.
   *
   * @param context - The source, opened.
   * @param cursor - What this provider last returned. A value it did not write is treated as no
   *   cursor at all, so a corrupted watermark costs one cold import rather than every later poll.
   * @returns One page.
   * @throws {TicketSourceError} When the tracker refused, or the configuration cannot be read.
   */
  incrementalSync(context: TicketSyncContext, cursor: string): Promise<TicketPage> {
    return settledPage(() => this.walk(context, readInMemoryCursor(cursor) ?? null));
  }

  /**
   * One record, as a canonical ticket.
   *
   * @param raw - A record, as the tracker served it.
   * @returns The ticket: the id as the identity and the key as the display form, `done` and
   *   `wont_do` collapsed onto `closed`, and the tracker's own status kept under `meta[kind]`.
   * @throws {TicketSourceError} `upstream`, when the record cannot be represented.
   */
  mapTicket(raw: unknown): CanonicalTicket {
    const record = parseRecord(raw);
    const ticket: CanonicalTicket = {
      externalId: record.id,
      externalKey: record.key,
      externalUrl: inMemoryUrl(record.key),
      title: record.summary.trim(),
      body: record.description,
      state: isClosedStatus(record.status) ? "closed" : "open",
      labels: [...record.tags],
      author: record.reporter,
      sourceCreatedAt: new Date(record.created),
      sourceUpdatedAt: new Date(record.updated),
      meta: { [this.kind]: { project: record.project, status: record.status } },
    };

    // The canonical rules are the kit's, and reusing them is the point: a record this mirror could
    // not store is refused here, as one error, instead of as a constraint violation in the loop.
    const violations = canonicalTicketViolations(ticket, record.key);

    if (violations.length > 0) {
      throw new TicketSourceError(
        "upstream",
        `record cannot be represented: ${violations.join("; ")}`,
      );
    }

    return ticket;
  }

  /**
   * Ask the tracker for one page.
   *
   * @param context - The source, opened.
   * @param after - Where to resume, or null for a cold import of open records.
   * @returns The page. A record that cannot be mapped fails the page — this tracker only serves
   *   what it stored, so an unmappable record is a bug worth stopping for.
   */
  private walk(context: TicketSyncContext, after: InMemoryPosition | null): TicketPage {
    const { project } = readInMemoryConfig(context.config);
    const listing = this.tracker.list({
      token: context.credentials,
      project,
      openOnly: after === null,
      after,
      limit: this.pageSize,
    });
    const last = listing.records.at(-1);

    return {
      tickets: listing.records.map((record) => this.mapTicket(record)),
      nextCursor: last === undefined ? null : inMemoryCursor(last),
      hasMore: listing.more,
    };
  }
}

/**
 * The in-memory provider, taking webhook deliveries as well.
 *
 * The secret is the provider's own configuration here, because the SPI's `webhookHandler` carries
 * no source — a real provider will need the delivery endpoint to resolve one, which is the
 * endpoint's ticket rather than this one's.
 */
export class InMemoryWebhookTicketSourceProvider
  extends InMemoryTicketSourceProvider
  implements WebhookCapableProvider
{
  /**
   * @param tracker - The tracker to talk to.
   * @param webhookSecret - What deliveries are signed with.
   * @param options - The kind and the page size.
   */
  constructor(
    tracker: InMemoryTracker,
    private readonly webhookSecret: string,
    options: InMemoryProviderOptions = {},
  ) {
    super(tracker, options);
  }

  /**
   * What this provider can do.
   *
   * @returns The polling provider's flags, with `webhooks` narrowed to `true`.
   */
  override capabilities(): TicketSourceCapabilities & { readonly webhooks: true } {
    return { ...super.capabilities(), webhooks: true };
  }

  /**
   * Take one delivery.
   *
   * @param payload - The body, parsed.
   * @param signature - The signature header, or null when none arrived.
   * @returns The record the delivery announced, mapped — or no tickets for a ping or an event this
   *   provider does not act on.
   * @throws {TicketSourceError} `auth` for an unsigned or wrongly signed delivery; `upstream` for a
   *   signed one that cannot be read.
   */
  webhookHandler(payload: unknown, signature: string | null): Promise<WebhookOutcome> {
    if (signature === null) {
      return Promise.reject(new TicketSourceError("auth", "an unsigned delivery"));
    }

    if (!verifyInMemoryDelivery(payload, signature, this.webhookSecret)) {
      return Promise.reject(
        new TicketSourceError("auth", "a delivery whose signature does not match"),
      );
    }

    try {
      return Promise.resolve(this.outcomeOf(payload));
    } catch (error) {
      return Promise.reject(asInMemoryFailure(error));
    }
  }

  /**
   * Read a verified delivery.
   *
   * @param payload - The body.
   * @returns What it described.
   * @throws {TicketSourceError} `upstream`, when it cannot be read.
   */
  private outcomeOf(payload: unknown): WebhookOutcome {
    if (typeof payload !== "object" || payload === null) {
      throw new TicketSourceError("upstream", "a delivery that is not an object");
    }

    const { event, record } = payload as { event?: unknown; record?: unknown };

    if (event !== "record.updated") {
      return { tickets: [] };
    }

    if (record === undefined) {
      throw new TicketSourceError("upstream", "a record.updated delivery that carries no record");
    }

    return { tickets: [this.mapTicket(record)] };
  }
}

/** How a write provider is set up. */
export interface InMemoryWriteProviderOptions extends InMemoryProviderOptions {
  /**
   * What it declares it can write, beyond `createTicket` — which is always true for this class.
   * Every writable feature unless given: native relations, milestones, and epics as parent issues.
   */
  readonly write?: Partial<Omit<TicketSourceWriteCapabilities, "createTicket">>;
}

/**
 * The in-memory provider, writing as well — AL.2's
 * ([#278](https://github.com/NobuData/ouroboros/issues/278)) `WriteCapableProvider` over the same
 * tracker.
 *
 * Every member searches before it creates and checks its own arguments before it sends anything,
 * so a retry is a no-op and a refusal leaves nothing half-made. The declaration is an option — see
 * this file's header — and each member reads it rather than branching on anything else.
 */
export class InMemoryWriteTicketSourceProvider
  extends InMemoryTicketSourceProvider
  implements WriteCapableProvider
{
  /** The write declaration, fixed at construction so `capabilities()` is stable. */
  private readonly writes: TicketSourceWriteCapabilities & { readonly createTicket: true };

  /**
   * @param tracker - The tracker to talk to.
   * @param options - The kind, the page size, and the write declaration.
   */
  constructor(
    private readonly writeTracker: InMemoryTracker,
    options: InMemoryWriteProviderOptions = {},
  ) {
    super(writeTracker, options);

    this.writes = Object.freeze({
      createTicket: true,
      nativeDependencies: options.write?.nativeDependencies ?? true,
      epicMapping: options.write?.epicMapping ?? "parent_issue",
      milestones: options.write?.milestones ?? true,
    });
  }

  /**
   * What this provider can do.
   *
   * @returns The polling provider's flags, with writes declared.
   */
  override capabilities(): TicketSourceCapabilities & {
    readonly bidirectionalWrites: true;
    readonly write: TicketSourceWriteCapabilities & { readonly createTicket: true };
  } {
    return { ...super.capabilities(), bidirectionalWrites: true, write: this.writes };
  }

  /**
   * Create a record, or answer the one already created under the draft's key.
   *
   * @param context - The source, opened.
   * @param draft - What to create.
   * @returns The record's identity.
   * @throws {TicketSourceError} `validation` for a blank or overlong key, or a milestone on a
   *   declaration without milestones; the tracker's refusal, classified, otherwise.
   */
  createTicket(context: TicketSyncContext, draft: TicketDraftInput): Promise<TicketWriteRef> {
    return settledWrite(() => {
      const { project } = readInMemoryConfig(context.config);
      const key = draft.idempotencyKey;

      if (key.trim() === "" || key.length > MAX_IDEMPOTENCY_KEY) {
        throw invalid("idempotencyKey must be non-blank and bounded");
      }

      if (draft.milestone !== null && !this.writes.milestones) {
        throw invalid("a milestone was given, and this tracker is declared without milestones");
      }

      const existing = this.writeTracker.search(context.credentials, project, key);

      if (existing !== undefined) {
        return writeRefOf(existing);
      }

      return writeRefOf(
        this.writeTracker.create(context.credentials, project, {
          summary: draft.title,
          description: draft.body,
          tags: draft.labels,
          idempotencyKey: key,
          milestoneId: draft.milestone?.externalRef ?? null,
        }),
      );
    });
  }

  /**
   * Record that one record blocks another — natively, or through the documented fallback.
   *
   * @param context - The source, opened.
   * @param blocker - The blocking record.
   * @param blocked - The blocked record.
   * @returns The mode the declaration says.
   * @throws {TicketSourceError} `validation` for a record linked to itself; the tracker's refusal
   *   otherwise.
   */
  linkDependency(
    context: TicketSyncContext,
    blocker: TicketWriteRef,
    blocked: TicketWriteRef,
  ): Promise<DependencyLinkResult> {
    return settledWrite(() => {
      const { project } = readInMemoryConfig(context.config);

      if (blocker.externalId === blocked.externalId) {
        throw invalid("a ticket cannot block itself");
      }

      if (this.writes.nativeDependencies) {
        this.writeTracker.relate(
          context.credentials,
          project,
          blocker.externalId,
          blocked.externalId,
        );

        return { mode: "native" };
      }

      // The fallback: the blocker exists, and the marker goes on the blocked record's body once.
      this.writeTracker.fetch(context.credentials, project, blocker.externalId);

      const current = this.writeTracker.fetch(context.credentials, project, blocked.externalId);

      if (!hasDependencyMarker(current.description, blocker.externalId)) {
        this.writeTracker.amend(
          context.credentials,
          project,
          blocked.externalId,
          withDependencyMarker(current.description, blocker.externalId),
        );
      }

      return { mode: "fallback" };
    });
  }

  /**
   * Find or create a milestone.
   *
   * @param context - The source, opened.
   * @param name - Its name.
   * @returns The milestone, or null on a declaration without milestones.
   * @throws {TicketSourceError} `validation` for a blank name; the tracker's refusal otherwise.
   */
  ensureMilestone(context: TicketSyncContext, name: string): Promise<MilestoneRef | null> {
    return settledWrite(() => {
      if (!this.writes.milestones) {
        return null;
      }

      const { project } = readInMemoryConfig(context.config);

      if (name.trim() === "") {
        throw invalid("a milestone needs a name");
      }

      const found =
        this.writeTracker
          .milestones(context.credentials, project)
          .find((milestone) => milestone.name === name) ??
        this.writeTracker.createMilestone(context.credentials, project, name);

      return { externalRef: found.id, name: found.name };
    });
  }

  /**
   * Find or create an epic's container.
   *
   * @param context - The source, opened.
   * @param epic - The planning epic.
   * @returns The mirror reference, or null under `epicMapping: 'none'`.
   * @throws {TicketSourceError} `validation` for a blank title; the tracker's refusal otherwise.
   */
  ensureEpicContainer(
    context: TicketSyncContext,
    epic: EpicContainerInput,
  ): Promise<EpicMirrorRef | null> {
    return settledWrite(() => {
      const mapping = this.writes.epicMapping;

      if (mapping === "none") {
        return null;
      }

      const { project } = readInMemoryConfig(context.config);

      if (epic.title.trim() === "") {
        throw invalid("an epic needs a title");
      }

      const container =
        this.writeTracker.findContainer(context.credentials, project, epic.epicId) ??
        this.writeTracker.createContainer(context.credentials, project, epic.epicId, epic.title);

      return { mapping, externalRef: container.ref };
    });
  }

  /**
   * Make a record a member of an epic's container.
   *
   * @param context - The source, opened.
   * @param ticket - The record.
   * @param mirror - The container.
   * @throws {TicketSourceError} `validation` for a mirror this declaration could not have produced;
   *   the tracker's refusal otherwise.
   */
  attachToEpic(
    context: TicketSyncContext,
    ticket: TicketWriteRef,
    mirror: EpicMirrorRef,
  ): Promise<void> {
    return settledWrite(() => {
      if (mirror.mapping !== this.writes.epicMapping) {
        throw invalid(
          `a ${mirror.mapping} mirror, and this tracker maps epics to ${this.writes.epicMapping}`,
        );
      }

      const { project } = readInMemoryConfig(context.config);

      this.writeTracker.addMember(
        context.credentials,
        project,
        mirror.externalRef,
        ticket.externalId,
      );
    });
  }
}

/**
 * A record's link.
 *
 * @param key - Its display key.
 * @returns The browse URL.
 */
export function inMemoryUrl(key: string): string {
  return `${IN_MEMORY_SITE}/browse/${encodeURIComponent(key)}`;
}

/**
 * Whether a status is `closed` in the canonical model.
 *
 * @param status - The tracker's word.
 * @returns `true` for `done` and `wont_do`.
 */
export function isClosedStatus(status: InMemoryStatus): boolean {
  return CLOSED_STATUSES.includes(status);
}

/**
 * The cursor for resuming after a record.
 *
 * @param record - The last record a page carried.
 * @returns `<updated>~<id>`.
 */
export function inMemoryCursor(record: Pick<InMemoryRecord, "updated" | "id">): string {
  return `${record.updated}~${record.id}`;
}

/**
 * The position a cursor names.
 *
 * @param cursor - A stored cursor.
 * @returns The position, or `undefined` when this provider could not have written it.
 */
export function readInMemoryCursor(cursor: string): InMemoryPosition | undefined {
  const parts = cursor.split("~");

  if (parts.length !== 2) {
    return undefined;
  }

  const [updated, id] = parts as [string, string];
  const instant = new Date(updated);

  if (!/^\d+$/.test(id) || Number.isNaN(instant.getTime()) || instant.toISOString() !== updated) {
    return undefined;
  }

  return { updated, id };
}

/**
 * The signature a delivery is sent under.
 *
 * @param payload - The body.
 * @param secret - The webhook secret.
 * @returns `sha256=<hex>` — an HMAC over the body's JSON.
 */
export function signInMemoryDelivery(payload: unknown, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(JSON.stringify(payload)).digest("hex")}`;
}

/**
 * Whether a signature is the one a delivery should carry.
 *
 * Compared in constant time, which is the habit worth copying even in a fixture.
 *
 * @param payload - The body.
 * @param signature - What arrived.
 * @param secret - The webhook secret.
 * @returns `true` when they match.
 */
export function verifyInMemoryDelivery(
  payload: unknown,
  signature: string,
  secret: string,
): boolean {
  const expected = Buffer.from(signInMemoryDelivery(payload, secret));
  const given = Buffer.from(signature);

  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * Anything a tracker call threw, as the SPI's error.
 *
 * @param error - What was caught.
 * @returns A `TicketSourceError`: passed through when it already is one, classified by status when
 *   the tracker refused, and `upstream` for anything else.
 */
export function asInMemoryFailure(error: unknown): TicketSourceError {
  if (TicketSourceError.is(error)) {
    return error;
  }

  if (error instanceof InMemoryTrackerRefusal) {
    return new TicketSourceError(
      classifyHttpStatus(error.status),
      `the in-memory tracker answered ${error.status.toString()}`,
      error.retryAt,
      error.status,
    );
  }

  return new TicketSourceError(
    "upstream",
    `the in-memory tracker failed in a way it does not describe: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
}

/**
 * Anything a tracker *write* threw, as the SPI's error.
 *
 * {@link asInMemoryFailure} with the write-side reading of a status — `403` is `permission` and
 * `422` is `validation` here.
 *
 * @param error - What was caught.
 * @returns A `TicketSourceError`.
 */
export function asInMemoryWriteFailure(error: unknown): TicketSourceError {
  if (error instanceof InMemoryTrackerRefusal) {
    return new TicketSourceError(
      classifyWriteHttpStatus(error.status),
      `the in-memory tracker refused a write with ${error.status.toString()}`,
      error.retryAt,
      error.status,
    );
  }

  return asInMemoryFailure(error);
}

/**
 * Run a synchronous write as the promise a write member answers.
 *
 * @param run - The write.
 * @returns Its value, or a rejection carrying a `TicketSourceError`.
 */
function settledWrite<T>(run: () => T): Promise<T> {
  try {
    return Promise.resolve(run());
  } catch (error) {
    return Promise.reject(asInMemoryWriteFailure(error));
  }
}

/**
 * A write refused before it was sent.
 *
 * @param detail - What was wrong with the arguments.
 * @returns The error.
 */
function invalid(detail: string): TicketSourceError {
  return new TicketSourceError("validation", detail);
}

/**
 * A record as a write member names it.
 *
 * @param record - The record.
 * @returns Its identity, key and link — the same three `mapTicket` gives the ticket a sync adopts.
 */
function writeRefOf(record: InMemoryRecord): TicketWriteRef {
  return { externalId: record.id, externalKey: record.key, url: inMemoryUrl(record.key) };
}

/**
 * Run a synchronous walk as the promise a sync member answers.
 *
 * @param run - The walk.
 * @returns The page, or a rejection carrying a `TicketSourceError`.
 */
function settledPage(run: () => TicketPage): Promise<TicketPage> {
  try {
    return Promise.resolve(run());
  } catch (error) {
    return Promise.reject(asInMemoryFailure(error));
  }
}

/**
 * Read a record's fields defensively — this is the tracker's JSON, and a caller may hand anything.
 *
 * @param raw - The payload.
 * @returns The record.
 * @throws {TicketSourceError} `upstream`, naming the field that is wrong. Never a field's value.
 */
function parseRecord(raw: unknown): InMemoryRecord {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw unusable("payload is not a record");
  }

  const candidate = raw as Record<string, unknown>;

  const text = (field: keyof InMemoryRecord): string => {
    const value = candidate[field];

    if (typeof value !== "string") {
      throw unusable(`record.${field} is not text`);
    }

    return value;
  };

  const optionalText = (field: keyof InMemoryRecord): string | null =>
    candidate[field] === null ? null : text(field);

  const id = text("id");

  if (!/^\d+$/.test(id)) {
    throw unusable("record.id is not the tracker's numeric identity");
  }

  const status = candidate.status;

  if (!(IN_MEMORY_STATUSES as readonly unknown[]).includes(status)) {
    throw unusable("record.status is not a status this tracker has");
  }

  const tags = candidate.tags;

  if (!Array.isArray(tags) || !(tags as unknown[]).every((tag) => typeof tag === "string")) {
    throw unusable("record.tags is not a list of names");
  }

  return {
    id,
    key: text("key"),
    project: text("project"),
    summary: text("summary"),
    description: optionalText("description"),
    status: status as InMemoryStatus,
    tags: tags as string[],
    reporter: optionalText("reporter"),
    created: text("created"),
    updated: text("updated"),
  };
}

/**
 * The one error {@link parseRecord} throws.
 *
 * @param detail - What could not be read.
 * @returns The error.
 */
function unusable(detail: string): TicketSourceError {
  return new TicketSourceError("upstream", detail);
}

/**
 * Whether a record comes after a position in the tracker's order.
 *
 * @param record - The record.
 * @param position - The position.
 * @returns `true` when strictly after — later `updated`, or the same instant and a higher id.
 */
function isAfter(record: InMemoryRecord, position: InMemoryPosition): boolean {
  return (
    record.updated > position.updated ||
    (record.updated === position.updated && Number(record.id) > Number(position.id))
  );
}

/**
 * The tracker's order.
 *
 * @param left - One record.
 * @param right - Another.
 * @returns Negative when `left` comes first.
 */
function byPosition(left: InMemoryRecord, right: InMemoryRecord): number {
  if (left.updated !== right.updated) {
    return left.updated < right.updated ? -1 : 1;
  }

  return Number(left.id) - Number(right.id);
}

/**
 * A token's digest — what the tracker keeps instead of the token.
 *
 * @param token - The token.
 * @returns Its SHA-256, hex.
 */
function digestOf(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
