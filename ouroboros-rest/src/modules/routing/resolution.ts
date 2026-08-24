/**
 * What `resolve(taskKind, ctx)` answers with — the versioned shape every consumer pins, and
 * the one place the product's four routing promises are written down as data.
 *
 * Z.1 ([#194](https://github.com/NobuData/ouroboros/issues/194)), decision **M6**. Mockup 06's
 * page head makes four behavioural claims — escalation rules apply before the chain is
 * walked, hops on unhealthy providers are skipped, the floor is enforced rather than silently
 * crossed, and a cost cap travels with the resolution — and this file is the shape that makes
 * each of them inspectable rather than asserted.
 *
 * ---------------------------------------------------------------------------
 * **Every decision carries a code *and* a sentence, and the sentence is rendered verbatim.**
 *
 * The word *silently* in the mockup's promise is what this costs. A resolution that answers
 * "no chain available" teaches nobody anything at 3am, so every hop kept, every hop dropped,
 * every rule applied and the floor's own decision carry a machine-readable `code` for a
 * client that branches and an `explanation` for a person who reads. The inspector (AA.4,
 * [#203](https://github.com/NobuData/ouroboros/issues/203)) and the simulate panel print the
 * sentences **as they arrive** — there is no story assembly in the client, which is the
 * ticket's acceptance criterion and the reason `explanations.ts` is one module rather than a
 * convention.
 *
 * A `code` is stable and a sentence is not. A client that branches on wording will break the
 * first time somebody improves a phrase; that is what the codes are for, and why they are
 * `as const` objects rather than free strings.
 *
 * ---------------------------------------------------------------------------
 * **{@link RESOLUTION_VERSION} is a promise about this file, not about the engine.**
 *
 * M9's handover — the executor contract WF-T.6
 * ([#160](https://github.com/NobuData/ouroboros/issues/160)) and the gateway requirements
 * AB.1 ([#207](https://github.com/NobuData/ouroboros/issues/207)) consume — depends on the
 * *shape* being stable, not on the decisions being frozen. Adding a hop drop code is not a
 * version bump: a client that does not recognise a code has a sentence to render and a
 * `decision` to branch on. Renaming a field, removing one, or changing what an existing field
 * means **is**. `resolution.spec.ts` holds the published shape to this rule by naming every
 * field of it, so a rename fails a test written for that purpose rather than a snapshot
 * somebody updates without reading.
 *
 * ---------------------------------------------------------------------------
 * **There is no credential anywhere in here and nowhere to put one**, which is
 * `registry/resolution.ts`'s argument inherited unchanged: a resolution carries an *address
 * and a model* — everything an executor needs to choose a provider and nothing it needs to
 * authenticate as one. Decision **P3**.
 */

import type { ProviderConnectionKind, ProviderConnectionStatus } from "../db/schema";
import type { FloorCode, HopCode, ResolutionFailureCode, RuleOutcomeCode } from "./explanations";

/**
 * The shape's version — the string a consumer pins.
 *
 * `r1` is the ticket's own spelling (its diagram reads `version: r1`), and it is deliberately
 * not a semver: a resolution is not a package, and `1.0.0` would invite a client to reason
 * about a patch digit that will never move. See this file's header for what a bump means.
 */
export const RESOLUTION_VERSION = "r1";

/** The version, as a type, so a consumer can pin it in a signature rather than in a string. */
export type ResolutionVersion = typeof RESOLUTION_VERSION;

/**
 * Where a hop's model runs, and whether it is usable.
 *
 * The same four identifying fields `registry/resolution.ts`'s `ResolvedConnection` carries,
 * plus the status — which arrives here from the **health snapshot** rather than from the
 * connection row, so that a resolution has exactly one opinion about a provider's state. See
 * `routing.repository.ts`, whose chain statement deliberately does not select `status`.
 */
export interface ResolvedProvider {
  /** The connection's id — how mockup 07's surfaces address it. */
  readonly id: string;
  /** Which adapter reaches it. */
  readonly kind: ProviderConnectionKind;
  /** What the inspector prints beside the model — `Anthropic`, `GitHub Copilot`, `Ollama`. */
  readonly displayName: string;
  /** Where it is, or null for a kind reached at its vendor's own endpoint. */
  readonly baseUrl: string | null;
  /**
   * Whether it is usable, as far as anything knows — from Z.3's snapshot.
   *
   * `unknown` is a state and never a green dot (decision **M8**), and it is deliberately not
   * a reason to drop a hop: nothing having checked a provider is not evidence that it is
   * down. The hop is kept and the explanation says so.
   */
  readonly status: ProviderConnectionStatus;
  /**
   * Milliseconds the last check measured, or null when none measured one.
   *
   * Carried so the inspector's hop-meta line — the mockup's *"42ms to us-east"* — comes out
   * of the resolution rather than out of a second request to the health strip. Never `0` as a
   * stand-in for *unmeasured*.
   */
  readonly latencyMs: number | null;
  /**
   * Why the provider is in this state, when there is something to say — `elevated latency`,
   * `503 upstream`.
   *
   * Carried for the same reason the latency is: the hop's sentence is composed once, here,
   * and a client that had to fetch the health strip to learn why a hop was dropped would be
   * composing the story this ticket exists to stop it composing.
   */
  readonly detail: string | null;
}

/** Whether a hop is in the chain the executor will walk. */
export type HopDecision = "kept" | "dropped";

/**
 * One hop of the resolved chain — kept or dropped, and why.
 *
 * **Dropped hops stay in the array.** A chain that quietly omitted them would be the exact
 * silence this ticket exists to remove: the inspector draws hop 2 struck through with a
 * reason beside it, and it can only do that if the hop is still there.
 */
export interface ResolutionHop {
  /**
   * Where this hop sits in the resolved chain; 1 is the primary. Dense, and it counts dropped
   * hops — it is the number the inspector's rail prints.
   */
  readonly index: number;
  /**
   * The hop's number in the **stored** chain — `route_hops.position` — or null for a hop an
   * escalation rule prepended.
   *
   * The distinction is load-bearing: {@link Resolution.floor} is measured against this and
   * never against {@link ResolutionHop.index}, so a rule that prepends a primary cannot
   * silently move a floor an operator set against the chain they saw in the inspector.
   */
  readonly position: number | null;
  /** The alias this hop names — `coder-max`. Never a raw model id (decision **M1**). */
  readonly alias: string;
  /** What that alias means — the raw provider model string, and the only place it appears. */
  readonly modelId: string;
  /**
   * The invocation defaults this hop carries: the alias's own, with an applied rule's merged
   * **over** them.
   *
   * Key order is sorted, which is not cosmetic — see `rules.ts`. A resolution is required to
   * be byte-for-byte identical for identical inputs, and object key order survives
   * `JSON.stringify`.
   */
  readonly params: Record<string, unknown>;
  /**
   * Where it runs, or null when the alias is **unbound** — V019's state for a name created
   * ahead of its key.
   *
   * Null is why {@link Resolution.chain} can hold a hop with no provider at all, and such a
   * hop is always `dropped` with a stated reason.
   */
  readonly provider: ResolvedProvider | null;
  /**
   * The operator's own sentence for this hop — `route_hops.note`, unchanged, or null.
   *
   * Separate from {@link ResolutionHop.explanation} because the two have different authors. A
   * note is what somebody wrote about *why this hop is in the chain* (*"Fallback on 5xx /
   * timeouts"*); an explanation is what this engine concluded about *this* resolution. The
   * inspector's hop-meta line renders the note where there is one; the simulate panel renders
   * the explanation. Collapsing them would mean either losing the operator's sentence or
   * letting it stand in for a decision it cannot describe.
   */
  readonly note: string | null;
  /** Whether the executor will try this hop. */
  readonly decision: HopDecision;
  /** Why — stable, and what a client branches on. */
  readonly code: HopCode;
  /** Why, as a sentence — rendered verbatim. */
  readonly explanation: string;
}

/**
 * One escalation rule that **matched the context**, and what it did about it.
 *
 * Matched rather than applied, deliberately. A rule whose predicate fired but whose `"then"`
 * names another task kind did nothing, and *nothing happened and here is why* is the answer
 * an operator needs when a rule they can see on the card did not change the run they are
 * looking at. `applied` is the filter for "the rules that took effect"; the rest are the
 * near misses, each with a reason.
 */
export interface AppliedRule {
  /** The rule's id — what Z.2's rules API addresses it by. */
  readonly id: string;
  /** Its evaluation order; 1 is first. Rules are listed in this order. */
  readonly sortOrder: number;
  /**
   * The sentence the card renders — `escalation_rules.display`, straight from the generated
   * column.
   *
   * Reported rather than recomposed, which is the whole of decision **M5**: PostgreSQL
   * derives this string from the rule's structure and refuses a hand-written one, so the
   * explanation panel and the rules card cannot print two different sentences for one rule.
   */
  readonly display: string;
  /** Whether it changed this resolution. */
  readonly applied: boolean;
  /** What it did, or why it did not. */
  readonly code: RuleOutcomeCode;
  /** The same, as a sentence — rendered verbatim. */
  readonly explanation: string;
}

/**
 * A second opinion an `add_vote` rule attached — the matrix's *"always second vote:
 * second-opinion"*.
 *
 * A **requirement**, not a hop: it is not somewhere the run falls back to, it is something
 * the executor must also do. Carried on the resolution because M9's handover is what honours
 * it, and dropping it into the chain would make it look like a fallback the run only reaches
 * when everything above it fails.
 */
export interface VoteRequirement {
  /** The alias casting the vote — `second-opinion`. */
  readonly alias: string;
  /** What it resolves to. */
  readonly modelId: string;
  /** Its invocation defaults. Sorted, for the same determinism reason hops' are. */
  readonly params: Record<string, unknown>;
  /** Where it runs. Never null: a rule naming an unbound alias is not applied at all. */
  readonly provider: ResolvedProvider;
  /** Which rule asked for it, so the inspector can point at the row that did. */
  readonly ruleId: string;
}

/**
 * What the floor did — recorded on **every** resolution, including the ones where it did
 * nothing.
 *
 * The ticket asks for this explicitly, and the reason is the honest one: *no floor is set* and
 * *the floor was satisfied* are different facts, and a field that appeared only when a policy
 * fired would leave a reader unable to tell either from a client that forgot to render it.
 */
export interface FloorDecision {
  /**
   * The deepest **stored** hop position this route may run on — `routes.floor_hop_index` — or
   * null when the mockup's switch is off.
   */
  readonly hopIndex: number | null;
  /** What it decided. */
  readonly code: FloorCode;
  /** The same, as a sentence — rendered verbatim. */
  readonly explanation: string;
}

/** Whether this resolution produced a chain to run or a refusal to run one. */
export type ResolutionOutcome = "resolved" | "fail_run";

/**
 * Why a resolution refuses to produce a chain.
 *
 * Present exactly when {@link Resolution.outcome} is `fail_run`, and never a truncated chain
 * instead: *the run may not proceed* and *the run proceeds on the third fallback* are
 * different outcomes, and the mockup's promise is that the product never quietly turns the
 * first into the second.
 */
export interface ResolutionFailure {
  /** Which refusal — stable, and what a client branches on. */
  readonly code: ResolutionFailureCode;
  /** Why, as a sentence — rendered verbatim. */
  readonly explanation: string;
}

/**
 * One resolution — the answer `ResolutionService.resolve` gives and the simulate endpoint
 * (Z.4, [#197](https://github.com/NobuData/ouroboros/issues/197)) serves unchanged.
 *
 * Deterministic given its inputs: the same route, health snapshot and context produce this
 * object byte for byte, which is what makes **Simulate routing** the same code path as
 * execution rather than a parallel mock of it.
 */
export interface Resolution {
  /** The shape's version — see {@link RESOLUTION_VERSION}. */
  readonly resolutionVersion: ResolutionVersion;
  /** The kind that was asked for — `task_kinds.name`. */
  readonly taskKind: string;
  /** Its route's tag — `implement-primary`, the inspector's title. */
  readonly routeTag: string;
  /** Whether there is a chain to run. */
  readonly outcome: ResolutionOutcome;
  /**
   * Every hop, in the order the executor would try them, dropped ones included.
   *
   * The chain an executor actually walks is `chain.filter((hop) => hop.decision === "kept")`,
   * and that filter is deliberately the caller's: a client that wanted only the survivors
   * would have discarded the explanations this ticket exists to produce.
   */
  readonly chain: readonly ResolutionHop[];
  /** Every rule whose predicate matched, in `sort_order`, applied or not. */
  readonly rules: readonly AppliedRule[];
  /** Second opinions the executor must also obtain. Empty is the ordinary case. */
  readonly votes: readonly VoteRequirement[];
  /** What the floor decided. Always present. */
  readonly floor: FloorDecision;
  /**
   * The route's **Allow fallback to local models** switch, echoed.
   *
   * A plain boolean with no sentence of its own, because the policy has nothing to say until
   * it drops something — and when it does, the sentence is on the hop it dropped, where the
   * reader is already looking.
   */
  readonly allowLocalFallback: boolean;
  /**
   * The cost cap that travels to the executor — `routes.max_cost_cents_per_run`, in cents, or
   * null for a route with none.
   *
   * Attached to every resolution including a `fail_run`, because it is a property of the
   * route rather than of the outcome, and a client rendering the inspector needs it whichever
   * way the resolution went.
   */
  readonly maxCostCents: number | null;
  /** Why there is no chain, or null when there is one. */
  readonly failure: ResolutionFailure | null;
}
