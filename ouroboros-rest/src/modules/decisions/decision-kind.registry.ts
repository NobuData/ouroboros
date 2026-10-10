/**
 * `DecisionKindRegistry` — the ninth SPI: human decisions register rather than being special-cased.
 *
 * BN.1 ([#461](https://github.com/NobuData/ouroboros/issues/461)), decisions **X1**, **X2**, **X4**
 * and **X9**. Ticket sources register providers, result parsers register formats, gate providers
 * register gates — and a plane that blocks on a person registers a **decision kind** and emits
 * against it. The registry knows declarations and nothing else; nothing here branches on a kind id.
 *
 * ```
 * plane adapter ─ emit({kind, payload, refs, key}) ─▶ dormant? ─▶ declared? ─▶ payload · refs · key valid?
 *                                                                  │ no: 404 / 422, nothing filed
 *   one transaction, the key advisory-locked:                      ▼
 *     before = item by (workspace, plane:source_ref)
 *     decision_item_emit(…)                         ← V093's upsert: one row per key, refreshed only while asking
 *   ─▶ filed | refreshed | unchanged | settled
 *   after commit: filed/refreshed ─▶ audit decision.filed / decision.refreshed ─▶ DecisionLifecycle
 *
 * watcher ─ resolveFromSource(settled) ─▶ decision_item_source_resolve  ← V097: policy(source_resolved)
 *   ─▶ audit decision.source_resolved ─▶ DecisionLifecycle "resolved"
 * ```
 *
 * - **Declarations** come from `decision_kinds` (V093/V097). {@link register} publishes a kind's
 *   declaration as its next version when it differs from the newest, so a fixture kind — or an
 *   amendment ticket's — joins the inbox with **zero changes here**.
 * - **Validation** happens before anything is written: a payload failing its schema, refs not
 *   fitting the ref shape, or a malformed key throws `422 decision_emission_invalid` naming the
 *   field, and no item is filed. The database checks again; it stays the authority.
 * - **Version pinning**: an emission pins the newest version; an open item renders and resolves at
 *   the version it pinned ({@link pinnedKind}), however often the kind is bumped since.
 * - **Rendering** (X2) and **action resolution** are pure functions this exposes so a channel never
 *   re-implements them.
 * - **Dormant kinds** are registered but inert: `spend_approval` has a declaration (its shape is
 *   fixed) and emits nothing until AF.4 (#237) enforces caps — a cap approval that does not exist
 *   is never claimed.
 */

import { Injectable, Logger } from "@nestjs/common";

import {
  DECISION_FILED_EVENT,
  DECISION_REFRESHED_EVENT,
  DECISION_SOURCE_RESOLVED_EVENT,
  type AuditAction,
} from "../audit/audit.events";
import { AuditService } from "../audit/audit.service";
import { canonicalJson } from "../ingest/ingest.idempotency";
import {
  resolveActions,
  type DecisionViewer,
  type ResolvedDecisionAction,
} from "./decision.actions";
import { DecisionLifecycle } from "./decision.lifecycle";
import {
  DecisionRepository,
  type DecisionItemIdentity,
  type DecisionItemSnapshot,
} from "./decision.repository";
import { renderDecision, type DecisionTextFormat } from "./decision.templates";
import type {
  DecisionEmission,
  DecisionEmitOutcome,
  DecisionEmitStatus,
  DecisionKindDeclaration,
  PublishedDecisionKind,
  RenderedDecision,
  SettledDecision,
} from "./decision.types";
import { DecisionPayloadValidator, keyViolations, refViolations } from "./decision.validation";
import { decisionEmissionInvalid, decisionKindNotDeclared } from "./decisions.errors";

/**
 * Kinds that are declared but emit nothing yet.
 *
 * `spend_approval` activates when AF.4 ([#237](https://github.com/NobuData/ouroboros/issues/237))
 * enforces per-run caps; until then a cap approval would be a decision about nothing. Remove it
 * from this set in AF.4, and its emitter starts filing.
 */
export const DORMANT_DECISION_KINDS: ReadonlySet<string> = new Set(["spend_approval"]);

/** The policy name V097 reserves for an out-of-band closure. */
export const SOURCE_RESOLVED_POLICY = "source_resolved";

/** A declared kind, and whether it is live. */
export interface RegisteredDecisionKind {
  readonly kind: PublishedDecisionKind;
  /** Declared, but emitting nothing until its plane can enforce it. */
  readonly dormant: boolean;
}

/**
 * What an emission did, given the item before and the item after.
 *
 * @param before - The item the key had filed, if any.
 * @param emission - What was emitted.
 * @returns `filed` for a new item, `settled` when it had already been answered or closed,
 *   `refreshed` when its facts, refs or severity changed, and `unchanged` otherwise.
 */
export function emitStatusOf(
  before: DecisionItemSnapshot | undefined,
  emission: DecisionEmission,
): Exclude<DecisionEmitStatus, "dormant"> {
  if (before === undefined) {
    return "filed";
  }

  if (before.status === "resolved" || before.status === "expired") {
    return "settled";
  }

  const changed =
    canonicalJson(before.payload) !== canonicalJson(emission.payload) ||
    canonicalJson(before.refs) !== canonicalJson(emission.refs) ||
    (emission.severity !== undefined && emission.severity !== before.severity);

  return changed ? "refreshed" : "unchanged";
}

/**
 * Whether two declarations say the same thing — every field but the version, the interval
 * compared as PostgreSQL prints it.
 *
 * @param a - One declaration.
 * @param b - The other.
 * @returns `true` when publishing `b` over `a` would change nothing.
 */
export function sameDeclaration(a: DecisionKindDeclaration, b: DecisionKindDeclaration): boolean {
  const comparable = (kind: DecisionKindDeclaration) =>
    canonicalJson({
      kindId: kind.kindId,
      severityDefault: kind.severityDefault,
      questionTemplate: kind.questionTemplate,
      whyTemplate: kind.whyTemplate,
      payloadSchema: kind.payloadSchema,
      actions: kind.actions,
      resolutionSemantics: kind.resolutionSemantics,
      refShape: kind.refShape,
      escalationWindow: kind.escalationWindow,
      mergeClass: kind.mergeClass,
    });

  return comparable(a) === comparable(b);
}

@Injectable()
export class DecisionKindRegistry {
  private readonly logger = new Logger(DecisionKindRegistry.name);

  private readonly validator = new DecisionPayloadValidator();

  /** Published versions are immutable, so each is read once. */
  private readonly pinned = new Map<string, PublishedDecisionKind>();

  /**
   * @param repository - The decision statements.
   * @param audit - Where every emission and closure is recorded (X9).
   * @param lifecycle - Who hears that an item changed (#536).
   */
  constructor(
    private readonly repository: DecisionRepository,
    private readonly audit: AuditService,
    private readonly lifecycle: DecisionLifecycle,
  ) {}

  /**
   * Whether a kind is declared but inert.
   *
   * @param kindId - The kind.
   * @returns `true` for a dormant kind — see {@link DORMANT_DECISION_KINDS}.
   */
  isDormant(kindId: string): boolean {
    return DORMANT_DECISION_KINDS.has(kindId);
  }

  /**
   * Every declared kind at its newest version, each marked dormant or live — what a policy card
   * reads so it never claims an approval a dormant kind cannot ask for.
   *
   * @returns The kinds, by kind id.
   */
  async kinds(): Promise<RegisteredDecisionKind[]> {
    const kinds = await this.repository.currentKinds();

    return kinds.map((kind) => ({ kind, dormant: this.isDormant(kind.kindId) }));
  }

  /**
   * Register a kind's declaration: publish it as the next version when it differs from the newest,
   * or return the newest when it says the same thing. Registrations of one kind are serialised, the
   * database checks the version is the next one, and it holds every rule — a template slot that names no required scalar fact, a merge-class kind made
   * auto-resolvable, a later version loosening either — and refuses the publish if one is broken.
   *
   * @param declaration - The declaration.
   * @returns The version new emissions now pin.
   */
  async register(declaration: DecisionKindDeclaration): Promise<PublishedDecisionKind> {
    return this.repository.transaction(async (trx) => {
      await this.repository.lockKind(trx, declaration.kindId);

      const current = await this.repository.currentKind(declaration.kindId, trx);
      const asked = {
        ...declaration,
        escalationWindow: await this.repository.canonicalInterval(
          trx,
          declaration.escalationWindow,
        ),
      };

      if (current !== undefined && sameDeclaration(current, asked)) {
        return current;
      }

      const version = await this.repository.publishKind(
        declaration,
        (current?.version ?? 0) + 1,
        trx,
      );

      this.logger.log(`Decision kind ${declaration.kindId} registered as v${String(version)}.`);

      return { ...asked, version };
    });
  }

  /**
   * The newest version of a kind.
   *
   * @param kindId - The kind.
   * @returns The declaration.
   * @throws {NotFoundError} `decision_kind_not_declared`.
   */
  async currentKind(kindId: string): Promise<PublishedDecisionKind> {
    const kind = await this.repository.currentKind(kindId);

    if (kind === undefined) {
      throw decisionKindNotDeclared(kindId);
    }

    return kind;
  }

  /**
   * The version an item pinned — what it renders and resolves at.
   *
   * @param kindId - The kind.
   * @param version - The pinned version.
   * @returns The declaration, read once and cached (versions are immutable).
   * @throws {NotFoundError} `decision_kind_not_declared` when there is no such version.
   */
  async pinnedKind(kindId: string, version: number): Promise<PublishedDecisionKind> {
    const key = `${kindId}@${String(version)}`;
    const cached = this.pinned.get(key);

    if (cached !== undefined) {
      return cached;
    }

    const kind = await this.repository.kindVersion(kindId, version);

    if (kind === undefined) {
      throw decisionKindNotDeclared(`${kindId} v${String(version)}`);
    }

    this.pinned.set(key, kind);

    return kind;
  }

  /**
   * File a decision — or refresh the one its key already filed. Idempotent on `(workspace, plane,
   * source_ref)`: a stage evaluated on every retry files one card.
   *
   * @param emission - The kind, facts, refs and key. Never prose.
   * @returns What the emission did, and the item.
   * @throws {NotFoundError} `decision_kind_not_declared` — nothing is filed.
   * @throws {InvalidRequestError} `decision_emission_invalid`, naming every violation — nothing is
   *   filed.
   */
  async emit(emission: DecisionEmission): Promise<DecisionEmitOutcome> {
    if (this.isDormant(emission.kindId)) {
      this.logger.debug(`Decision kind ${emission.kindId} is dormant; nothing filed.`);
      return { status: "dormant", itemId: null };
    }

    const kind = await this.currentKind(emission.kindId);
    const violations = [
      ...keyViolations(emission.key.plane, emission.key.sourceRef),
      ...this.validator.validate(kind, emission.payload),
      ...refViolations(kind.refShape, emission.refs),
    ];

    if (violations.length > 0) {
      throw decisionEmissionInvalid(emission.kindId, violations);
    }

    const outcome = await this.repository.transaction(async (trx) => {
      await this.repository.lockKey(trx, emission.organizationId, emission.key);

      const before = await this.repository.itemByKey(trx, emission.organizationId, emission.key);
      const itemId = await this.repository.emit(trx, emission);

      return { status: emitStatusOf(before, emission), itemId };
    });

    if (outcome.status === "filed" || outcome.status === "refreshed") {
      await this.record(
        outcome.status === "filed" ? DECISION_FILED_EVENT : DECISION_REFRESHED_EVENT,
        {
          id: outcome.itemId,
          organizationId: emission.organizationId,
          kindId: kind.kindId,
          kindVersion: kind.version,
          plane: emission.key.plane,
          sourceRef: emission.key.sourceRef,
        },
        { severity: emission.severity ?? kind.severityDefault },
      );
      this.lifecycle.emit({
        type: outcome.status,
        itemId: outcome.itemId,
        organizationId: emission.organizationId,
        kindId: kind.kindId,
      });
    }

    return outcome;
  }

  /**
   * Close an item whose source settled out of band, as `policy(source_resolved)` (X4). A no-op for
   * an item that is no longer asking, so a watcher may call it as often as it likes.
   *
   * @param settled - The item, how its source settled, and through which channel.
   * @returns Whether this call closed it.
   */
  async resolveFromSource(settled: SettledDecision): Promise<boolean> {
    const closed = await this.repository.sourceResolve(settled.itemId, settled.channel, {
      source: settled.settlement,
    });

    if (!closed) {
      return false;
    }

    const identity = await this.repository.identity(settled.itemId);

    if (identity !== undefined) {
      await this.record(DECISION_SOURCE_RESOLVED_EVENT, identity, {
        settlement: settled.settlement,
        channel: settled.channel,
      });
      this.lifecycle.emit({
        type: "resolved",
        itemId: identity.id,
        organizationId: identity.organizationId,
        kindId: identity.kindId,
        resolver: "policy",
        policy: SOURCE_RESOLVED_POLICY,
        actionId: SOURCE_RESOLVED_POLICY,
        channel: settled.channel,
        settlement: settled.settlement,
      });
    }

    return true;
  }

  /**
   * A card's question, why and tags (X2).
   *
   * @param kind - The version the item pinned.
   * @param payload - Its facts.
   * @param format - Where the prose is going — `plain`, `html` or `markdown`.
   * @returns The prose.
   */
  render(
    kind: PublishedDecisionKind,
    payload: Readonly<Record<string, unknown>>,
    format: DecisionTextFormat = "plain",
  ): RenderedDecision {
    return renderDecision(kind, payload, format);
  }

  /**
   * A card's action row, resolved against who is looking.
   *
   * @param kind - The version the item pinned.
   * @param viewer - The member's roles and `can_approve_loops`.
   * @returns Every action, marked `allowed` and `navigates`.
   */
  actionsFor(kind: PublishedDecisionKind, viewer: DecisionViewer): ResolvedDecisionAction[] {
    return resolveActions(kind.actions, viewer);
  }

  /**
   * Write one audit line about an item (X9). Actor null: a plane, not a person, did it.
   *
   * @param action - The event.
   * @param item - The item.
   * @param extra - Detail beyond the item's identity.
   */
  private async record(
    action: AuditAction,
    item: DecisionItemIdentity,
    extra: Readonly<Record<string, string>>,
  ): Promise<void> {
    await this.audit.record({
      organizationId: item.organizationId,
      actorId: null,
      action,
      subjectType: "decision_item",
      subjectId: item.id,
      at: new Date(),
      detail: {
        kind: item.kindId,
        version: item.kindVersion,
        plane: item.plane,
        sourceRef: item.sourceRef,
        ...extra,
      },
    });
  }
}
