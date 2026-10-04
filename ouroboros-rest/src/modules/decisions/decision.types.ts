/**
 * The decision domain's vocabulary, as the REST service handles it — a kind's declaration, an
 * emission, and what an emission did.
 *
 * BN.1 ([#461](https://github.com/NobuData/ouroboros/issues/461)), decisions **X1** and **X2**. The
 * shapes mirror V093's documents (`decision_kinds.actions`, `resolution_semantics`, `ref_shape`)
 * exactly, so a declaration read from the database and one a plane registers are the same object.
 * Nothing here branches on a kind id: the registry, the feed and the watchers are kind-agnostic, and
 * a kind joins the inbox by declaring itself.
 */

import type { DecisionChannel, DecisionSeverity } from "../db/schema";

/** The four typed refs a card's tag row may carry (V093). */
export type DecisionRefType = "run" | "pr" | "ticket" | "path";

/** Every ref type, in V093's order. */
export const DECISION_REF_TYPES: readonly DecisionRefType[] = ["run", "pr", "ticket", "path"];

/**
 * One tag on a card. Canonical and tracker-agnostic: `run` names `runs.id`, `pr` names
 * `pull_requests.id`, `ticket` names `tickets.id`, and a `path` is repository-relative. Never a
 * provider URL.
 */
export interface DecisionRef {
  readonly type: DecisionRefType;
  /** A lower-case uuid, or the repository-relative path for a `path` ref. */
  readonly id: string;
  /** The tag's text — `loop #1843`, `PR #509`, `issue #465`. */
  readonly label: string;
}

/** Who may press an action — V091's role ladder plus the `approver` capability. */
export type DecisionRequiredRole = "viewer" | "member" | "approver" | "admin" | "owner";

/** One button of a card's action row (V093's `actions` element). */
export interface DecisionAction {
  /** A snake_case slug, unique in the row. */
  readonly id: string;
  /** What the button says. */
  readonly label: string;
  readonly style: "primary" | "ghost" | "danger";
  readonly required_role: DecisionRequiredRole;
  /** The sentence that says what pressing it does. */
  readonly consequence_text: string;
  /** Whether the action carries a note. */
  readonly takes_note: boolean;
  /** `<plane>.<operation>` — what BN.2 executes; `navigate.*` is a link that decides nothing. */
  readonly handler_binding: string;
}

/** What "answered" means for a kind (V093's `resolution_semantics`). */
export interface DecisionResolutionSemantics {
  readonly answered_by: readonly string[];
  readonly closes_source: readonly string[];
  readonly auto_resolvable: boolean;
}

/** Which refs an item must and may carry, and its plain tags (V093's `ref_shape`). */
export interface DecisionRefShape {
  readonly required: readonly DecisionRefType[];
  readonly optional: readonly DecisionRefType[];
  /** Templates over required scalar facts, or literals — `{pr_kind}`, `verification`. */
  readonly tags: readonly string[];
}

/**
 * A kind's declaration — everything the inbox knows about it, and the only thing.
 *
 * `payloadSchema` is JSON Schema in V093's supported subset (closed object, scalar properties,
 * arrays of scalars).
 */
export interface DecisionKindDeclaration {
  /** One of the nine MVP kinds, an amendment kind, or `custom:<slug>`. */
  readonly kindId: string;
  readonly severityDefault: DecisionSeverity;
  readonly questionTemplate: string;
  readonly whyTemplate: string;
  readonly payloadSchema: Readonly<Record<string, unknown>>;
  readonly actions: readonly DecisionAction[];
  readonly resolutionSemantics: DecisionResolutionSemantics;
  readonly refShape: DecisionRefShape;
  /** Interval text — `30 minutes`. */
  readonly escalationWindow: string;
  readonly mergeClass: boolean;
}

/** A published declaration: a declaration and the version the database gave it. */
export interface PublishedDecisionKind extends DecisionKindDeclaration {
  readonly version: number;
}

/**
 * The idempotency key of an emission: the plane that files it and the plane's own reference for
 * what is being asked about. One item per key per workspace, however often the plane emits.
 */
export interface DecisionKey {
  /** A slug with no colon — `guardrails`, `pr.gates`, `facts`. */
  readonly plane: string;
  /** The plane's reference — `run:<id>:path:boot/rollback_flag.c`. At most 500 characters. */
  readonly sourceRef: string;
}

/** What a plane hands the registry: a kind, facts, refs and a key. Never prose. */
export interface DecisionEmission {
  readonly organizationId: string;
  readonly kindId: string;
  /** Facts the kind's templates compose the question and why from. */
  readonly payload: Readonly<Record<string, unknown>>;
  readonly refs: readonly DecisionRef[];
  readonly key: DecisionKey;
  /** Overrides the kind's severity default. Optional. */
  readonly severity?: DecisionSeverity;
}

/**
 * What one emission did.
 *
 * - `filed` — a new item; audited as `decision.filed`.
 * - `refreshed` — the open item's facts or refs changed; audited as `decision.refreshed`.
 * - `unchanged` — the open item already said exactly this; nothing written, nothing audited.
 * - `settled` — the item for this key was already answered, closed or expired; left alone.
 * - `dormant` — the kind is registered but inert (`spend_approval` until AF.4); nothing filed.
 */
export type DecisionEmitStatus = "filed" | "refreshed" | "unchanged" | "settled" | "dormant";

/** The answer to an emission. */
export interface DecisionEmitOutcome {
  readonly status: DecisionEmitStatus;
  /** The item, or null for a dormant kind. */
  readonly itemId: string | null;
}

/** A card's prose, composed from facts (X2). */
export interface RenderedDecision {
  readonly question: string;
  readonly why: string;
  readonly tags: readonly string[];
}

/** Why an item's source counts as settled — the closure's receipt (`outcome.source`). */
export type DecisionSourceSettlement =
  | "pr_merged"
  | "pr_closed"
  | "run_terminated"
  | "run_moved_on"
  | "criterion_settled"
  | "fact_resolved"
  | "batch_settled"
  | "estimate_superseded"
  | "ticket_closed";

/** One item a detector found settled, and how. */
export interface SettledDecision {
  readonly itemId: string;
  readonly organizationId: string;
  readonly settlement: DecisionSourceSettlement;
  /** Where the settlement came from — `github` for a PR merged on its host. */
  readonly channel: DecisionChannel;
}
