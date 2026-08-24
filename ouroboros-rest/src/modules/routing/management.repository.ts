/**
 * Every statement the routing editor issues — the reads the matrix is drawn from, and the
 * writes **Save routes** and the rules card commit.
 *
 * Z.2 ([#195](https://github.com/NobuData/ouroboros/issues/195)). Decision **M2**'s other
 * half: `routing.repository.ts` says in its header that V016's and V018's write surfaces are
 * this ticket's and that it contains no `insert`, `update` or `delete`. This is where they
 * are, and the split is deliberate rather than alphabetical — `routing.repository.spec.ts`
 * compiles every statement in that file and asserts the absence, so a write added there fails
 * a test rather than a review.
 *
 * ---------------------------------------------------------------------------
 * **A chain is rewritten, not patched, and V016 wrote the transaction down for us.**
 *
 * V016's header says it in as many words — *"How a reorder is performed, so Z.2 (#195) does
 * not have to invent it"*. Both of the rules that hold a chain's numbering,
 * `route_hops_route_position_key` and the `route_chain_intact()` constraint trigger, are
 * `deferrable initially deferred`, so nothing is checked until `commit`. That makes
 * *"`delete` the hops, `insert` the new order"* legal inside one transaction, with no `set
 * constraints`, no shuffle through a temporary position, and no per-hop reasoning about which
 * of them moved.
 *
 * Rewriting rather than diffing is also what makes {@link RoutingManagementRepository.replaceChain}
 * one statement pair instead of an update, an insert and a delete whose interleaving would
 * have to be reasoned about. The chain a body sends *is* the chain, and positions are assigned
 * from the array index — so V016's density rule cannot be broken from here, because a dense
 * array cannot produce a sparse chain.
 *
 * ---------------------------------------------------------------------------
 * **The rule grammar is asked of the database rather than reimplemented.**
 *
 * {@link RoutingManagementRepository.ruleGrammar} calls V018's own
 * `escalation_rule_when_valid()` and `escalation_rule_then_valid()`, which that migration
 * exposed for exactly this:
 *
 *   > reachable on its own so Z.2's API validates a submitted rule with this definition
 *   > instead of a TypeScript copy of it.
 *
 * A copy would agree on the day it was written and drift the first time either grammar was
 * widened — and the drift would surface as a rule this service accepted and PostgreSQL
 * refused, answered as a `500`.
 *
 * ---------------------------------------------------------------------------
 * **Every statement carries the workspace**, including the ones whose id is globally unique,
 * for the reason `registry.repository.ts` gives and `routing.repository.ts` repeats: a lookup
 * that *could* cross a workspace boundary is one that eventually does. On the writes it is not
 * a convention at all — it is the ticket's *organization isolation* criterion, and it is why
 * an `update` here has two predicates rather than one.
 */

import { Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";

import { DatabaseService } from "../db/db.service";
import { SCHEMA_NAME, type Database, type RouteRevisionDiff } from "../db/schema";
import type {
  AliasIdRow,
  DesiredRoute,
  ManagedHopRow,
  ManagedRouteRow,
  ManagedRuleRow,
  TaskKindRow,
} from "./management.rows";

/** One hop, ready to be written: the alias resolved to its id, and the note as sent. */
export interface ResolvedHop {
  /** `model_aliases.id`, looked up from the name the body carried. */
  aliasId: string;
  /** The operator's sentence, or null. */
  note: string | null;
}

/** What a rule write may set. `display` is absent because the column generates it (**M5**). */
export interface RuleWrite {
  /** The card's switch. */
  enabled?: boolean;
  /** Evaluation order; 1 is first. */
  sortOrder?: number;
  /** The predicate. Validated by {@link RoutingManagementRepository.ruleGrammar} first. */
  when?: Record<string, unknown>;
  /** The route modification. Likewise. */
  then?: Record<string, unknown>;
}

/** What the two V018 grammar functions concluded about one submitted rule. */
export interface RuleGrammarVerdict {
  /** Whether `when` is the WF-P8 predicate grammar as routing scopes it. */
  when: boolean;
  /** Whether `then` is exactly one of the three route modifications, with a body it accepts. */
  then: boolean;
}

/** The columns every rule read here selects, in one place so the reads cannot drift apart. */
const RULE_COLUMNS = ["id", "enabled", "sort_order", "when", "then", "display"] as const;

@Injectable()
export class RoutingManagementRepository {
  /**
   * @param database - The typed connection. Injected, never constructed: the pool's lifecycle
   *   belongs to `DatabaseService`.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * The workspace's task kinds, in the order the matrix draws them.
   *
   * Read separately from the routes rather than joined to them, because V016 makes
   * `routes.task_kind_id` unique but **not** mandatory: a kind with no route is a legal state
   * and is a matrix row with an empty cell, not a row that should vanish. An inner join would
   * hide it and an outer join would answer one row shape for two different things.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @returns The kinds, `sort_order` ascending. Empty for a workspace whose foundations have
   *   not been seeded — the page's empty state (AA.6), not a failure.
   */
  async taskKinds(organizationId: string): Promise<TaskKindRow[]> {
    return this.database.db
      .selectFrom("task_kinds")
      .select(["id", "name", "description", "sort_order"])
      .where("organization_id", "=", organizationId)
      .orderBy("sort_order")
      .execute();
  }

  /**
   * Every route in the workspace, with the name of the kind it answers for.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @returns The routes. Ordered by kind name so the answer is stable between calls; the
   *   caller keys them by `task_kind` and draws them in the kinds' own order.
   */
  async routes(organizationId: string): Promise<ManagedRouteRow[]> {
    return this.database.db
      .selectFrom("routes as r")
      .innerJoin("task_kinds as k", (join) =>
        join
          .onRef("k.organization_id", "=", "r.organization_id")
          .onRef("k.id", "=", "r.task_kind_id"),
      )
      .select([
        "r.id as route_id",
        "k.name as task_kind",
        "r.tag",
        "r.allow_local_fallback",
        "r.floor_hop_index",
        "r.max_cost_cents_per_run",
        "r.updated_by",
        "r.updated_at",
      ])
      .where("r.organization_id", "=", organizationId)
      .orderBy("k.name")
      .execute();
  }

  /**
   * Every hop of every chain in the workspace, in order.
   *
   * **`leftJoin` on the connection**, exactly as `routing.repository.ts` does and for the same
   * reason: an unbound alias is a hop the operator configured, and dropping it would make a
   * three-hop chain arrive as two. The matrix draws it with an empty resolution line instead.
   *
   * One statement for the whole matrix rather than one per route — see this module's rows
   * file. `route_id` is selected so the caller can split them; ordering by it first makes that
   * split a single pass.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @returns Every hop, grouped by route in `position` order.
   */
  async chains(organizationId: string): Promise<ManagedHopRow[]> {
    return this.database.db
      .selectFrom("route_hops as h")
      .innerJoin("model_aliases as a", (join) =>
        join
          .onRef("a.organization_id", "=", "h.organization_id")
          .onRef("a.id", "=", "h.model_alias_id"),
      )
      .leftJoin("provider_connections as c", (join) =>
        join
          .onRef("c.organization_id", "=", "a.organization_id")
          .onRef("c.id", "=", "a.provider_connection_id"),
      )
      .select([
        "h.route_id",
        "h.position",
        "h.note",
        "a.alias",
        "a.model_id",
        "a.params",
        "c.id as connection_id",
        "c.kind",
        "c.display_name",
        "c.base_url",
      ])
      .where("h.organization_id", "=", organizationId)
      .orderBy("h.route_id")
      .orderBy("h.position")
      .execute();
  }

  /**
   * The workspace's escalation rules — **all of them**, in evaluation order.
   *
   * The deliberate difference from `routing.repository.ts`'s `rules()`, which carries `where
   * enabled` because resolution asks *which rules fire*. The card asks *which rules exist*
   * and prints `3 active` from the difference, so a read that filtered would make the count
   * unrenderable and a switched-off rule unreachable from the surface that switches it.
   *
   * `display` is selected rather than recomposed — decision **M5**.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @returns The rules, `sort_order` ascending.
   */
  async rules(organizationId: string): Promise<ManagedRuleRow[]> {
    return this.database.db
      .selectFrom("escalation_rules")
      .select(RULE_COLUMNS)
      .where("organization_id", "=", organizationId)
      .orderBy("sort_order")
      .execute();
  }

  /**
   * One rule of this workspace.
   *
   * @param organizationId - The workspace, from the tenant context. Carried even though the
   *   id is globally unique: a `PATCH` that could address another workspace's rule is the
   *   isolation criterion failing at the one place it matters most.
   * @param id - The rule.
   * @returns The rule, or `undefined` for an id this workspace does not have — which the
   *   caller turns into the same `404` it answers for another workspace's.
   */
  async rule(organizationId: string, id: string): Promise<ManagedRuleRow | undefined> {
    return this.database.db
      .selectFrom("escalation_rules")
      .select(RULE_COLUMNS)
      .where("organization_id", "=", organizationId)
      .where("id", "=", id)
      .executeTakeFirst();
  }

  /**
   * Every alias name in the workspace, with its id.
   *
   * What turns the `coder-max` a body carries into the `route_hops.model_alias_id` a chain is
   * written with — and, by its absence, what makes *unknown alias* a `422` naming the field
   * rather than a foreign-key violation surfacing as a `500`.
   *
   * Deliberately not `routing.repository.ts`'s `aliases()`, which selects the resolution and
   * not the id: this caller needs the key and none of the rest, and widening that read to
   * carry an id would put a primary key into resolution's pure inputs, where nothing uses one.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @returns Every alias, ordered by name.
   */
  async aliasIds(organizationId: string): Promise<AliasIdRow[]> {
    return this.database.db
      .selectFrom("model_aliases")
      .select(["id", "alias"])
      .where("organization_id", "=", organizationId)
      .orderBy("alias")
      .execute();
  }

  /**
   * Where a new rule goes when the body does not say — one past the highest this workspace
   * holds.
   *
   * Appending rather than defaulting to 1 is what makes **+ Add rule** a button rather than a
   * decision: a new rule that silently claimed the first position would change what every
   * existing rule does.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @returns The next free position, and `1` for a workspace with no rules. Racy by nature —
   *   two administrators adding a rule at the same moment can pick the same number — which is
   *   why V018's unique key exists and why the caller recognises its violation as a `409`.
   */
  async nextRuleSortOrder(organizationId: string): Promise<number> {
    const row = await this.database.db
      .selectFrom("escalation_rules")
      .select(({ fn }) => fn.max<number>("sort_order").as("highest"))
      .where("organization_id", "=", organizationId)
      .executeTakeFirst();

    return (row?.highest ?? 0) + 1;
  }

  /**
   * Ask V018 whether a submitted rule is one it would store.
   *
   * Both functions in one round trip, because a client that got half its rule wrong should be
   * told both halves rather than being sent back for the second. They are `immutable` and
   * `strict`, so this is two expression evaluations and touches no table.
   *
   * @param when - The candidate predicate, exactly as the body carried it. `object` rather
   *   than a narrower type on purpose: the whole point is that this is asked *before* anything
   *   knows whether the document is a predicate, and a parameter typed as one would be
   *   claiming the answer.
   * @param then - The candidate route modification, likewise.
   * @returns Which of the two the grammar accepts.
   */
  async ruleGrammar(when: object, then: object): Promise<RuleGrammarVerdict> {
    const { rows } = await sql<{ when_ok: boolean; then_ok: boolean }>`
      select ${sql.id(SCHEMA_NAME)}.escalation_rule_when_valid(${JSON.stringify(when)}::jsonb)
               as when_ok,
             ${sql.id(SCHEMA_NAME)}.escalation_rule_then_valid(${JSON.stringify(then)}::jsonb)
               as then_ok
    `.execute(this.database.db);

    return { when: rows[0]?.when_ok === true, then: rows[0]?.then_ok === true };
  }

  /**
   * Write one route's policy triple, and record who did it.
   *
   * `updated_at` is deliberately not set: V016 attaches the `touch_updated_at()` trigger, so
   * the server clock is that column's only writer — the rule every table in this schema keeps.
   *
   * @param trx - The transaction the whole batch runs in. Required rather than optional: a
   *   policy written outside the transaction that rewrites the chain is half a save, and a
   *   signature that allowed it would let one be written by accident.
   * @param organizationId - The workspace, from the tenant context.
   * @param routeId - The route.
   * @param desired - The policy triple as the body asks for it.
   * @param actorId - Who pressed **Save routes**, from the session — never from the body.
   * @returns When it is written.
   */
  async writeRoutePolicy(
    trx: Transaction<Database>,
    organizationId: string,
    routeId: string,
    desired: DesiredRoute,
    actorId: string,
  ): Promise<void> {
    await trx
      .updateTable("routes")
      .set({
        allow_local_fallback: desired.allowLocalFallback,
        floor_hop_index: desired.floorHopIndex,
        max_cost_cents_per_run: desired.maxCostCentsPerRun,
        updated_by: actorId,
      })
      .where("organization_id", "=", organizationId)
      .where("id", "=", routeId)
      .execute();
  }

  /**
   * Replace one route's chain with the one the body sent.
   *
   * Delete every hop, insert the new order — legal inside a transaction because both of
   * V016's ordering rules are deferred to `commit`. See this file's header.
   *
   * @param trx - The transaction the whole batch runs in.
   * @param organizationId - The workspace, from the tenant context.
   * @param routeId - The route whose chain this is.
   * @param hops - The chain, primary first, with each alias already resolved to its id.
   *   Positions are assigned from the array index, so a dense array is the only thing this
   *   can produce.
   * @returns When it is written.
   * @throws {RangeError} If the chain is empty, which V016's `route_chain_intact()` would
   *   refuse at commit anyway — raised here because the caller's DTO already makes it
   *   unreachable, so reaching it is a programming mistake rather than a request's.
   */
  async replaceChain(
    trx: Transaction<Database>,
    organizationId: string,
    routeId: string,
    hops: readonly ResolvedHop[],
  ): Promise<void> {
    if (hops.length === 0) {
      throw new RangeError("replaceChain needs at least one hop — V016 refuses an empty chain");
    }

    await trx
      .deleteFrom("route_hops")
      .where("organization_id", "=", organizationId)
      .where("route_id", "=", routeId)
      .execute();

    await trx
      .insertInto("route_hops")
      .values(
        hops.map((hop, index) => ({
          organization_id: organizationId,
          route_id: routeId,
          position: index + 1,
          model_alias_id: hop.aliasId,
          note: hop.note,
        })),
      )
      .execute();
  }

  /**
   * Record what the batch changed.
   *
   * The `diff` is serialised and cast rather than passed as a parameter: `pg` sends a
   * JavaScript object to a `jsonb` column as `[object Object]`, which the column accepts as a
   * string and nothing can read back — the trap `provider-health.repository.ts` documents.
   *
   * @param trx - The transaction the whole batch runs in, so the revision and the routes it
   *   describes commit together or not at all. A revision that survived a rolled-back save
   *   would be an audit trail describing something that did not happen.
   * @param organizationId - The workspace, from the tenant context.
   * @param actorId - Who pressed **Save routes**.
   * @param diff - What moved. Non-empty by construction — `management.diff.ts` answers `null`
   *   for a save that changed nothing, and V021's CHECK refuses an empty document anyway.
   * @returns The revision's id, which the save answers with.
   */
  async recordRevision(
    trx: Transaction<Database>,
    organizationId: string,
    actorId: string,
    diff: RouteRevisionDiff,
  ): Promise<string> {
    const row = await trx
      .insertInto("route_revisions")
      .values({
        organization_id: organizationId,
        actor: actorId,
        diff: sql<RouteRevisionDiff>`${JSON.stringify(diff)}::jsonb`,
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    return row.id;
  }

  /**
   * Add an escalation rule.
   *
   * `display` is not named and cannot be: the column is `generated always … stored`, so
   * `EscalationRulesTable.display` is `ColumnType<string, never, never>` and an insert naming
   * it does not compile. It is *returned*, because the sentence the card will render is the
   * one PostgreSQL just derived — decision **M5** end to end.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param enabled - The switch's position.
   * @param sortOrder - Where it evaluates.
   * @param when - The predicate, already accepted by {@link RoutingManagementRepository.ruleGrammar}.
   * @param then - The route modification, likewise.
   * @returns The rule as stored, generated sentence included.
   */
  async insertRule(
    organizationId: string,
    enabled: boolean,
    sortOrder: number,
    when: Record<string, unknown>,
    then: Record<string, unknown>,
  ): Promise<ManagedRuleRow> {
    return this.database.db
      .insertInto("escalation_rules")
      .values({
        organization_id: organizationId,
        enabled,
        sort_order: sortOrder,
        when: sql<never>`${JSON.stringify(when)}::jsonb`,
        then: sql<never>`${JSON.stringify(then)}::jsonb`,
      })
      .returning(RULE_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  /**
   * Change an escalation rule.
   *
   * @param organizationId - The workspace, from the tenant context — the second predicate
   *   that makes another workspace's rule unaddressable rather than merely unlisted.
   * @param id - The rule.
   * @param write - What to set. Every field is optional; an empty object is refused, because
   *   an `update` with nothing to set is not valid SQL and the caller has already decided
   *   what an empty `PATCH` means.
   * @returns The rule as it now stands, or `undefined` when this workspace has no such rule.
   * @throws {RangeError} If `write` sets nothing — a programming mistake at the call site,
   *   which is where the empty-`PATCH` case is answered.
   */
  async updateRule(
    organizationId: string,
    id: string,
    write: RuleWrite,
  ): Promise<ManagedRuleRow | undefined> {
    const changes: Record<string, unknown> = {};

    if (write.enabled !== undefined) {
      changes.enabled = write.enabled;
    }

    if (write.sortOrder !== undefined) {
      changes.sort_order = write.sortOrder;
    }

    if (write.when !== undefined) {
      changes.when = sql`${JSON.stringify(write.when)}::jsonb`;
    }

    if (write.then !== undefined) {
      changes.then = sql`${JSON.stringify(write.then)}::jsonb`;
    }

    if (Object.keys(changes).length === 0) {
      throw new RangeError("updateRule needs at least one column to set");
    }

    return this.database.db
      .updateTable("escalation_rules")
      .set(changes)
      .where("organization_id", "=", organizationId)
      .where("id", "=", id)
      .returning(RULE_COLUMNS)
      .executeTakeFirst();
  }

  /**
   * Remove an escalation rule.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param id - The rule.
   * @returns Whether a row was removed. `false` is *this workspace has no such rule*, which
   *   the caller answers `404` for — the same answer it gives for another workspace's, so the
   *   two cannot be told apart by whoever is probing.
   */
  async deleteRule(organizationId: string, id: string): Promise<boolean> {
    const result = await this.database.db
      .deleteFrom("escalation_rules")
      .where("organization_id", "=", organizationId)
      .where("id", "=", id)
      .executeTakeFirst();

    return result.numDeletedRows > 0n;
  }
}
