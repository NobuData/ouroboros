/**
 * The write half of the ticket-source SPI — what a provider says it can create, and the values
 * that cross the interface when it does.
 *
 * AL.2 ([#278](https://github.com/NobuData/ouroboros/issues/278)): *the pluggability requirement
 * made bidirectional*. `ticket-source.provider.ts` holds the members
 * (`WriteCapableProvider`); this file holds everything those members take and answer, plus the
 * two pure rules core code applies to a declaration — is it coherent, and what may the UI offer.
 *
 * ```
 * capabilities().write = {
 *   createTicket        boolean                                  — the gate for every member
 *   nativeDependencies  boolean                                  — else the documented fallback
 *   epicMapping         'parent_issue' | 'epic' | 'project' | 'none'
 *   milestones          boolean
 * }
 * createTicket(ctx, draft)            → { externalId, externalKey, url }     idempotent by key
 * linkDependency(ctx, blocker, blocked) → { mode: 'native' | 'fallback' }  idempotent
 * ensureMilestone(ctx, name)          → { externalRef, name } | null        idempotent
 * ensureEpicContainer(ctx, epic)      → { mapping, externalRef } | null     idempotent
 * attachToEpic(ctx, ticket, mirror)   → void                                 idempotent
 * ```
 *
 * ---------------------------------------------------------------------------
 * **Why the flags are a total shape, when the issue sketches three of them as optional.** The
 * read side's argument, unchanged: `TicketSourceCapabilities` is total so that no consumer has
 * to decide what an unmentioned flag means. A `createTicket?` would give the push service, the
 * catalog and the tracker segment three chances to decide that `undefined` means *no* — and one
 * chance to decide it means *not yet known, so try*. {@link READ_ONLY_WRITE_CAPABILITIES} is the
 * one-line answer a provider that cannot write gives, so totality costs a read-only provider
 * nothing.
 *
 * **Why every member is idempotent.** The push service (AL.3,
 * [#279](https://github.com/NobuData/ouroboros/issues/279)) is written to be killed mid-batch and
 * resumed, and each of its steps is a call here. A member that created a second milestone, a
 * second parent issue or a second copy of a ticket on a retry would make *resumable* a property
 * of the service's bookkeeping alone — and bookkeeping is exactly what a crash between a
 * tracker's `201` and a database commit loses. So the SPI carries the guarantee too, and the
 * conformance kit's write suites call every member twice.
 *
 * **Why an absent capability answers `null` rather than throwing.** `ensureMilestone` on a tracker
 * without milestones, and `ensureEpicContainer` under `epicMapping: 'none'`, are ordinary
 * configurations — the acceptance criterion says *"a supported, tested configuration, not a
 * crash"*. A push that has no milestone to assign or no container to attach to is still a push.
 * `attachToEpic` is the exception, because it cannot be *called* correctly without a mirror
 * reference that only a supported mapping produces; handed one anyway, it refuses as
 * `validation`.
 *
 * ---------------------------------------------------------------------------
 * **The `linkDependency` fallback, documented here because the criterion requires it to be.**
 *
 * A provider whose tracker has no native `blocks` relation — `nativeDependencies: false` — still
 * links. It records the relation **in the blocked ticket's body**, as one marker line per
 * blocker, appended below everything a person wrote:
 *
 * ```
 * <!-- ouroboros:blocked-by <blocker externalId> -->
 * ```
 *
 * {@link dependencyMarker} composes the line and {@link hasDependencyMarker} finds it, so every
 * fallback provider writes the same line and a later sync — or a later push — can read it back.
 * The contract a fallback link keeps is the contract a native one keeps: calling it twice leaves
 * one marker, and it answers `{ mode: 'fallback' }` so the UI can say which mode ran rather than
 * silently degrading. An HTML comment because every tracker in V030's set renders Markdown and
 * none renders a comment; a tracker whose body is plain text is a provider's to override.
 *
 * The in-memory fake's `InMemoryWriteTicketSourceProvider`, declared with
 * `nativeDependencies: false`, is the fixture that exercises this path.
 *
 * ---------------------------------------------------------------------------
 * **Why `epicMapping` has its own vocabulary rather than `epic_mirrors.kind`'s.** V036's column
 * holds `parent_issue`, `milestone` and `jira_epic` — the rows AL.3 and AN.2 will write — while
 * this flag names the *shape* of a tracker's epic: a parent issue, a native epic, a project, or
 * nothing. The two are not the same list (a Linear project has no V036 kind yet; a milestone is a
 * container V036 stores but not a mapping any tracker uses for epics), and translating between
 * them is the push service's job, where both are in view.
 *
 * No tracker's SDK and no provider is imported here, and `ticket-source.write.spec.ts` asserts
 * the rules below name no tracker — decision **P5** holds on the write path exactly as on the read.
 */

/** What an epic becomes in a tracker — or `none`, where it becomes nothing. */
export type EpicMapping = "parent_issue" | "epic" | "project" | "none";

/** The four as values, in the order the issue lists them. */
export const EPIC_MAPPINGS = [
  "parent_issue",
  "epic",
  "project",
  "none",
] as const satisfies readonly EpicMapping[];

/** What a provider can write. See this file's header for why every flag is required. */
export interface TicketSourceWriteCapabilities {
  /**
   * Whether this provider implements `WriteCapableProvider`.
   *
   * **The gate for everything else.** A provider that cannot create a ticket has nothing to link,
   * attach or assign a milestone to, so every other flag must be off when this is —
   * {@link writeCapabilityViolations} holds a declaration to that, and `TicketSourceRegistry`
   * refuses one that disagrees at boot.
   */
  readonly createTicket: boolean;
  /**
   * Whether `linkDependency` creates a relation the tracker itself understands.
   *
   * `false` on a writable provider is not a missing feature: it links through the fallback this
   * file's header documents, and says so in the answer.
   */
  readonly nativeDependencies: boolean;
  /** What `ensureEpicContainer` creates. `none` makes it answer `null`. */
  readonly epicMapping: EpicMapping;
  /** Whether `ensureMilestone` creates anything. `false` makes it answer `null`. */
  readonly milestones: boolean;
}

/**
 * The declaration of a provider that writes nothing — every read-only provider's `write`.
 *
 * Frozen, so a provider returning it cannot have it edited under another provider's feet.
 */
export const READ_ONLY_WRITE_CAPABILITIES: TicketSourceWriteCapabilities = Object.freeze({
  createTicket: false,
  nativeDependencies: false,
  epicMapping: "none",
  milestones: false,
});

/**
 * A ticket to create, in the canonical model's vocabulary.
 *
 * Deliberately small: what a draft row (V034) carries and every tracker in V030's set can hold.
 * State, author and timestamps are the tracker's to assign on creation, and a milestone and an
 * epic arrive through their own members, so a tracker without either is not asked to ignore a
 * field.
 */
export interface TicketDraftInput {
  /**
   * The caller's idempotency key — AL.3's batch-and-draft key.
   *
   * **The dedupe contract.** `createTicket` called twice with the same key answers the same
   * ticket and creates one. How a provider finds the first is its business — a marker in the
   * body, a custom field, a label, a search — and the conformance kit checks the outcome rather
   * than the mechanism. Non-blank and at most {@link MAX_IDEMPOTENCY_KEY} characters.
   */
  readonly idempotencyKey: string;
  /** The title. Non-blank. */
  readonly title: string;
  /** The body, or null for a one-line draft. `''` is not the same fact. */
  readonly body: string | null;
  /**
   * Label names to apply. Empty when there are none, and ignored by a provider whose
   * `capabilities().labels` is false — a tracker without labels cannot be refused for lacking them.
   */
  readonly labels: readonly string[];
  /**
   * The milestone to assign, as `ensureMilestone` answered it, or null.
   *
   * A reference rather than a name, so the create cannot race a second `ensureMilestone` into
   * existence.
   */
  readonly milestone: MilestoneRef | null;
}

/** The longest {@link TicketDraftInput.idempotencyKey} a provider must be able to carry. */
export const MAX_IDEMPOTENCY_KEY = 128;

/**
 * A ticket that exists in a tracker, as a write member names one.
 *
 * What `createTicket` answers and what `linkDependency` and `attachToEpic` take — the issue's
 * `{external_id, external_key, url}`, in this codebase's spelling. `externalId` and `externalKey`
 * mean exactly what they mean on `CanonicalTicket`, so the ticket a later sync adopts carries the
 * same identity the push recorded.
 */
export interface TicketWriteRef {
  /** The tracker's stable identity — `CanonicalTicket.externalId`. */
  readonly externalId: string;
  /** The display form — `CanonicalTicket.externalKey`. */
  readonly externalKey: string;
  /** The ticket in its tracker. `https` with a host, for `CanonicalTicket.externalUrl`'s reason. */
  readonly url: string;
}

/** A milestone that exists in a tracker. */
export interface MilestoneRef {
  /** The tracker's handle for it — what `epic_mirrors.external_ref` would store for one. */
  readonly externalRef: string;
  /** Its name, as the tracker spells it. */
  readonly name: string;
}

/** An epic to mirror into a tracker. */
export interface EpicContainerInput {
  /**
   * The planning epic's id (`planning_epics.id`). **The idempotency key** — two calls for the
   * same epic answer the same container, however its title has changed in between.
   */
  readonly epicId: string;
  /** The epic's title. Non-blank. */
  readonly title: string;
  /** A description for the container, or null. */
  readonly description: string | null;
}

/**
 * Where an epic lives in a tracker — the mirror reference AK.3 (#274) persists.
 *
 * `mapping` repeats the provider's `epicMapping` so a reference stored today can still be
 * recognised after a provider changes its declaration.
 */
export interface EpicMirrorRef {
  /** What kind of container it is. Never `none`: `none` answers no reference at all. */
  readonly mapping: Exclude<EpicMapping, "none">;
  /** The tracker's handle for the container. Non-blank. */
  readonly externalRef: string;
}

/** How a dependency was recorded. */
export type DependencyLinkMode = "native" | "fallback";

/** What `linkDependency` did. */
export interface DependencyLinkResult {
  /**
   * `native` when the tracker holds the relation itself; `fallback` when it is the body marker
   * this file's header documents.
   *
   * **The truth about what ran**, and the kit checks the half that can be a lie: a provider
   * declaring `nativeDependencies: false` never answers `native`, and whatever it answers, the
   * relation is there. A provider declaring `true` may still answer `fallback` — the declaration
   * says what the tracker *kind* supports, and one self-hosted instance of it may predate the
   * relation, which only a capability probe can discover (AL.3,
   * [#279](https://github.com/NobuData/ouroboros/issues/279)). The UI tells a person which mode
   * ran, and this field is where it reads that.
   */
  readonly mode: DependencyLinkMode;
}

/**
 * Whether the UI may offer a push to a source of this kind, and why not when it may not.
 *
 * The acceptance criterion *"capability flags gate UI affordances: a read-only source renders
 * push-disabled with a reason"*, as the value the catalog carries — so the tracker segment
 * (AM.2, [#284](https://github.com/NobuData/ouroboros/issues/284)) draws a disabled button and a
 * tooltip rather than a push that fails on click.
 */
export interface PushAffordance {
  /** Whether the push button is enabled. */
  readonly enabled: boolean;
  /** Why it is not, in words fit for a tooltip — or null when it is enabled. */
  readonly reason: string | null;
}

/** The sentence a disabled push renders. One today; a keyed record so a second is one entry. */
export const PUSH_DISABLED_REASONS = Object.freeze({
  readOnly: "This tracker is read-only in Ouroboros — it can sync tickets but not create them.",
});

/**
 * What the UI may offer for one declaration.
 *
 * A function of the flags alone, and deliberately not of a source row: whether a *connected*
 * source is paused or failing is the source's status, which the segment already has, and this
 * answers the question only the provider can — can this kind of tracker be written to at all.
 *
 * @param write - A provider's `capabilities().write`.
 * @returns Enabled with no reason when it can create tickets; disabled with
 *   {@link PUSH_DISABLED_REASONS}.readOnly when it cannot.
 */
export function pushAffordance(write: TicketSourceWriteCapabilities): PushAffordance {
  return write.createTicket
    ? { enabled: true, reason: null }
    : { enabled: false, reason: PUSH_DISABLED_REASONS.readOnly };
}

/**
 * Everything wrong with a `capabilities().write` declaration, judged on its own.
 *
 * Shared by `TicketSourceRegistry`, which refuses a provider at boot, and the conformance kit,
 * which reports the same sentences in a provider author's test run — one rule, two places it is
 * enforced, no second copy to drift.
 *
 * @param write - The declaration. `unknown`, because the interesting provider is one written
 *   somewhere the compiler stopped nobody.
 * @returns The violations. Empty means a total, coherent declaration.
 */
export function writeCapabilityViolations(write: unknown): string[] {
  if (typeof write !== "object" || write === null || Array.isArray(write)) {
    return ["capabilities().write must be an object — READ_ONLY_WRITE_CAPABILITIES says no"];
  }

  const declared = write as Record<string, unknown>;
  const violations: string[] = [];

  for (const flag of ["createTicket", "nativeDependencies", "milestones"] as const) {
    if (typeof declared[flag] !== "boolean") {
      violations.push(`capabilities().write.${flag} must be a boolean — false is an answer`);
    }
  }

  if (!(EPIC_MAPPINGS as readonly unknown[]).includes(declared.epicMapping)) {
    violations.push(`capabilities().write.epicMapping must be one of ${EPIC_MAPPINGS.join(", ")}`);
  }

  if (violations.length > 0 || declared.createTicket === true) {
    return violations;
  }

  // Coherence: nothing can be linked, attached or assigned without something to create.
  if (declared.nativeDependencies === true) {
    violations.push("capabilities().write.nativeDependencies is true but createTicket is false");
  }

  if (declared.milestones === true) {
    violations.push("capabilities().write.milestones is true but createTicket is false");
  }

  if (declared.epicMapping !== "none") {
    violations.push(
      `capabilities().write.epicMapping is ${String(declared.epicMapping)} but createTicket is ` +
        "false — a provider that cannot write maps epics to none",
    );
  }

  return violations;
}

/**
 * The fallback's marker line for one blocker — see this file's header.
 *
 * @param blockerExternalId - The blocking ticket's `externalId`.
 * @returns `<!-- ouroboros:blocked-by <id> -->`.
 * @throws {RangeError} When the id is blank or contains `--`/`>`, either of which would end the
 *   comment early and put the rest of the line in front of a reader.
 */
export function dependencyMarker(blockerExternalId: string): string {
  if (
    blockerExternalId.trim() === "" ||
    blockerExternalId.includes("--") ||
    blockerExternalId.includes(">")
  ) {
    throw new RangeError("a dependency marker needs an id that cannot close an HTML comment");
  }

  return `<!-- ouroboros:blocked-by ${blockerExternalId} -->`;
}

/** One marker line, as {@link dependencyMarker} writes it. */
const MARKER_LINE = /^<!-- ouroboros:blocked-by ([^\s>]+) -->$/;

/**
 * Every blocker a body records through the fallback.
 *
 * The reading half of {@link dependencyMarker}, so a later sync or push — and a suite counting
 * relations — reads the marker with the same grammar that wrote it.
 *
 * @param body - A ticket's body, or null.
 * @returns The blockers' `externalId`s, in the order their lines appear. Only whole marker lines
 *   count, so a marker quoted mid-sentence by a person is not a relation.
 */
export function dependencyMarkersIn(body: string | null): string[] {
  if (body === null) {
    return [];
  }

  return body
    .split("\n")
    .map((line) => MARKER_LINE.exec(line.trim())?.[1])
    .filter((id): id is string => id !== undefined);
}

/**
 * Whether a body already records a blocker through the fallback.
 *
 * @param body - The blocked ticket's body, or null.
 * @param blockerExternalId - The blocking ticket's `externalId`.
 * @returns `true` when the marker is present as a whole line.
 * @throws {RangeError} For an id {@link dependencyMarker} refuses.
 */
export function hasDependencyMarker(body: string | null, blockerExternalId: string): boolean {
  dependencyMarker(blockerExternalId);

  return dependencyMarkersIn(body).includes(blockerExternalId);
}

/**
 * A body with one blocker recorded through the fallback — unchanged when it already is.
 *
 * @param body - The blocked ticket's body, or null.
 * @param blockerExternalId - The blocking ticket's `externalId`.
 * @returns The body with the marker appended on its own line below what a person wrote.
 */
export function withDependencyMarker(body: string | null, blockerExternalId: string): string {
  const marker = dependencyMarker(blockerExternalId);

  if (body === null || body === "") {
    return marker;
  }

  return hasDependencyMarker(body, blockerExternalId) ? body : `${body}\n\n${marker}`;
}
