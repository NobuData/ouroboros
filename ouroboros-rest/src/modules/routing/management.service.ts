/**
 * The routing editor — the read the matrix is drawn from, the batch **Save routes** commits,
 * and the rules card's three writes.
 *
 * Z.2 ([#195](https://github.com/NobuData/ouroboros/issues/195)). Decision **M2** held V016's
 * and V018's tables for this ticket, and this is the service that finally writes them.
 *
 * ---------------------------------------------------------------------------
 * **A save is validated, then diffed, then written — in that order, and the order is the
 * ticket's atomicity criterion.**
 *
 * Everything that can refuse the batch is decided *before the transaction opens*
 * (`management.validation.ts`), so *"a failure in one route does not partially commit
 * another"* is not a rollback that has to work: it is a write that never started. What the
 * transaction then holds is only the statements that cannot be pre-checked — the chain
 * rewrites, the policy updates, and the revision row that must commit with them or not at all.
 *
 * The diff is computed once and drives both halves (`management.diff.ts`): a route with no
 * entry in it has no statement run against it, and a route with an entry is written *and*
 * recorded from the same object. That is what makes *"every save writes a `route_revisions`
 * row whose diff reflects exactly what changed"* structural rather than a second computation
 * that could disagree with the first.
 *
 * ---------------------------------------------------------------------------
 * **A rule is validated by the database, twice, and neither check is the other's backup.**
 *
 * The grammar is V018's own `escalation_rule_when_valid()` and `escalation_rule_then_valid()`
 * — that migration exposed them so this API would not carry a TypeScript copy of a domain the
 * database already owns. The *names* a rule carries are then checked against this workspace's
 * task kinds and aliases, which is a pre-flight over the deferred constraint trigger V018
 * attaches to three tables: the trigger fires at `commit` and would answer a bare integrity
 * violation, and the pre-flight is what turns that into a `422` naming `then`.
 *
 * The pre-flight cannot close the race — an alias deleted between the check and the commit
 * makes the server refuse anyway — so the trigger's own refusal is recognised and answered
 * with the same `422` rather than a `500`. Both, therefore, and neither alone.
 *
 * ---------------------------------------------------------------------------
 * **Who saved a route comes from the session and never from the body.** `actorId` is threaded
 * from `principal.user.id` into `routes.updated_by` and `route_revisions.actor`; a body field
 * would let a client attribute its own writes to somebody else, which is the one thing an
 * audit trail must not permit.
 */

import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../db/db.service";
import type { EscalationThen, EscalationWhen } from "../db/schema";
import { HOPS_KEY, revisionDiff, routeEntry } from "./management.diff";
import {
  RoutingManagementRepository,
  type ResolvedHop,
  type RuleWrite,
} from "./management.repository";
import {
  chainsByRoute,
  toRouteState,
  type DesiredRoute,
  type ManagedHopRow,
  type ManagedRouteRow,
} from "./management.rows";
import { batchProblems } from "./management.validation";
import {
  EMPTY_ROUTE_STATS,
  toAliasResource,
  toEscalationRuleResource,
  toRouteResource,
  toTaskKindResource,
  type AliasListResource,
  type EscalationRuleResource,
  type RouteResource,
  type RouteStatsResource,
  type RoutingMatrixResource,
  type SaveRoutesResource,
} from "./resources";
import {
  escalationRuleInvalid,
  escalationRuleNotFound,
  escalationRuleSortOrderTaken,
  isRuleSortOrderTaken,
  isRuleTargetMissing,
  routeSaveInvalid,
} from "./routing.errors";
import { RoutingRepository } from "./routing.repository";
import { RoutingStatsService } from "./stats.service";
import { targetAlias, targetTaskKind } from "./rules";
import type { CreateRuleDto, SaveRouteDto, UpdateRuleDto } from "./routing.dto";

/** What a client is told when V018's predicate grammar refuses `when`. */
export const WHEN_INVALID_MESSAGE =
  "`when` must carry at least one of `effort_gte` (xs, s, m, l, xl), `label` and `diff_kind` " +
  "(docs_only), and nothing else.";

/** What a client is told when V018's action grammar refuses `then`. */
export const THEN_INVALID_MESSAGE =
  "`then` must be exactly one of `use_alias` ({task_kind, alias, params?}), `add_vote` " +
  "({task_kind, alias}) or `route_local` ({}).";

/**
 * What a client is told when a rule names something this workspace does not have.
 *
 * @param field - Which name is missing — `task_kind` or `alias`.
 * @param value - The name, echoed exactly.
 * @returns The message.
 */
export function unknownRuleTargetMessage(field: "task_kind" | "alias", value: string): string {
  return `\`then\` names a ${field === "alias" ? "model alias" : "task kind"} this workspace does not have: "${value}".`;
}

/** What a client is told when the deferred trigger refuses the names at commit. */
export const RULE_TARGET_RACE_MESSAGE =
  "`then` names a task kind or model alias this workspace no longer has. Reload the registry " +
  "and try again.";

@Injectable()
export class RoutingManagementService {
  /**
   * @param database - The typed connection, for the one thing that needs a transaction: a
   *   batch save.
   * @param routing - Z.1's reads. Two of them are exactly what this surface needs — the alias
   *   list AA.3's swap menus are built from — and re-implementing them here would be a second
   *   answer to *what does this alias resolve to*.
   * @param management - This ticket's own statements: the matrix read, and every write.
   * @param stats - Z.5's ([#198](https://github.com/NobuData/ouroboros/issues/198)) aggregates
   *   over `token_usage`. The matrix's two numeric columns and the spend card are measured
   *   there and only there, so this service composes them rather than computing them: a second
   *   opinion about what a kind of work costs is a page whose columns disagree with its card.
   */
  constructor(
    private readonly database: DatabaseService,
    private readonly routing: RoutingRepository,
    private readonly management: RoutingManagementRepository,
    private readonly stats: RoutingStatsService,
  ) {}

  /**
   * The whole page's read — every task kind in order with its route and chain, the rules card
   * beside them, and the spend card under both.
   *
   * Four reads in parallel rather than eight sequential ones. They are independent reads of one
   * workspace, so there is nothing for a transaction to protect that a page which polls would
   * notice, and the alternative — a route at a time — is the shape that turns a page load into
   * a waterfall.
   *
   * **The stats are one read, not one per row.** Z.5 measures every kind in a single grouped
   * aggregate and hands back a map; asking per task kind would be eight statements over the
   * same ledger window, each of which could see a call the last one did not.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @returns The matrix, the rules and the spend card. Empty arrays and a zero-state card for a
   *   workspace whose foundations have not been seeded, which is AA.6's empty state rather than
   *   a failure — and, for a workspace that has run nothing, em-dashes rather than `$0.00`.
   */
  async matrix(organizationId: string): Promise<RoutingMatrixResource> {
    const [kinds, routes, hops, rules, stats] = await Promise.all([
      this.management.taskKinds(organizationId),
      this.management.routes(organizationId),
      this.management.chains(organizationId),
      this.management.rules(organizationId),
      this.stats.read(organizationId),
    ]);

    const chains = chainsByRoute(hops);
    const byKind = new Map(routes.map((route) => [route.task_kind, route]));

    return {
      taskKinds: kinds.map((kind) =>
        toTaskKindResource(kind, this.routeOf(byKind.get(kind.name), chains, stats.byTaskKind)),
      ),
      rules: rules.map(toEscalationRuleResource),
      spend: stats.spend,
    };
  }

  /**
   * Every alias in the workspace, with its current resolution — the swap menu's list.
   *
   * Z.1's read rather than a second one, deliberately. It left-joins the connection, so an
   * **unbound** alias is in the answer with an empty resolution rather than absent: mockup 21
   * draws that row, and a swap menu that hid it would make an alias created ahead of its key
   * unreachable from the surface that would bind a route to it.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @returns The aliases, ordered by name. Unpaged — see {@link AliasListResource}.
   */
  async aliases(organizationId: string): Promise<AliasListResource> {
    const rows = await this.routing.aliases(organizationId);

    return { aliases: rows.map(toAliasResource) };
  }

  /**
   * Commit one press of **Save routes**.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param actorId - Who pressed it, from the session. Never from the body.
   * @param requests - The routes to commit, in the order the client listed them.
   * @returns The revision this save wrote — `null` when it changed nothing — and the routes
   *   as they now stand, re-read after the commit rather than echoed from the body.
   * @throws {InvalidRequestError} `422 route_save_invalid` when any route in the batch cannot
   *   be saved. **Nothing is written**: every refusal is decided before the transaction opens.
   */
  async save(
    organizationId: string,
    actorId: string,
    requests: readonly SaveRouteDto[],
  ): Promise<SaveRoutesResource> {
    const desired = requests.map(toDesiredRoute);

    const [kinds, routes, hops, aliases] = await Promise.all([
      this.management.taskKinds(organizationId),
      this.management.routes(organizationId),
      this.management.chains(organizationId),
      this.management.aliasIds(organizationId),
    ]);

    const routesByKind = new Map(routes.map((route) => [route.task_kind, route]));
    const aliasIds = new Map(aliases.map((alias) => [alias.alias, alias.id]));

    const problems = batchProblems(
      desired,
      new Set(kinds.map((kind) => kind.name)),
      new Set(routesByKind.keys()),
      new Set(aliasIds.keys()),
    );

    if (Object.keys(problems).length > 0) {
      throw routeSaveInvalid(problems);
    }

    const chains = chainsByRoute(hops);
    const plans = desired.map((request) => {
      // Non-null by construction: `batchProblems` files `noRouteForTaskKind` for every kind
      // without one, and a batch carrying that complaint threw above.
      const route = routesByKind.get(request.taskKind) as ManagedRouteRow;

      return {
        request,
        routeId: route.route_id,
        entry: routeEntry(toRouteState(route, chains.get(route.route_id) ?? []), request),
      };
    });

    const diff = revisionDiff(plans.flatMap((plan) => (plan.entry === null ? [] : [plan.entry])));

    const revisionId =
      diff === null
        ? null
        : await this.database.transaction(async (trx) => {
            for (const plan of plans) {
              if (plan.entry === null) {
                continue;
              }

              await this.management.writeRoutePolicy(
                trx,
                organizationId,
                plan.routeId,
                plan.request,
                actorId,
              );

              // Only when the chain moved. A route whose floor changed and whose hops did not
              // should not have its `route_hops` rows deleted and re-inserted — the write
              // would be invisible in the answer and visible in every stamp on the table.
              if (HOPS_KEY in plan.entry.changes) {
                await this.management.replaceChain(
                  trx,
                  organizationId,
                  plan.routeId,
                  resolveHops(plan.request, aliasIds),
                );
              }
            }

            return this.management.recordRevision(trx, organizationId, actorId, diff);
          });

    return {
      revisionId,
      routes: await this.routesFor(
        organizationId,
        desired.map((request) => request.taskKind),
      ),
    };
  }

  /**
   * Add an escalation rule.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param body - The rule. `enabled` defaults to on and `sortOrder` to appended.
   * @returns The rule as stored, with the sentence PostgreSQL derived from it.
   * @throws {InvalidRequestError} `422 escalation_rule_invalid` when the grammar refuses it,
   *   or when it names a task kind or alias this workspace does not have.
   * @throws {ConflictError} `409 escalation_rule_sort_order_taken` when another rule already
   *   evaluates at that position.
   */
  async addRule(organizationId: string, body: CreateRuleDto): Promise<EscalationRuleResource> {
    await this.checkRule(organizationId, body.when, body.then);

    const sortOrder = body.sortOrder ?? (await this.management.nextRuleSortOrder(organizationId));

    return this.answerRuleWrite(() =>
      this.management.insertRule(
        organizationId,
        body.enabled ?? true,
        sortOrder,
        body.when,
        body.then,
      ),
    );
  }

  /**
   * Change an escalation rule — the card's switch, its place in the order, or the rule itself.
   *
   * The rule is read first, and not only to answer `404`: a `PATCH` that changes one half of
   * the pair still has to be checked as a *pair*, because V018's grammar functions take one
   * document each and the target check needs the `then` that will be stored — the new one when
   * the body carried it, and the stored one when it did not.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param id - The rule.
   * @param body - What to change. An empty body changes nothing and answers the rule as it
   *   stands, which is the honest answer to a request that asked for nothing.
   * @returns The rule as it now stands, with the sentence regenerated from whatever changed.
   * @throws {NotFoundError} `404 escalation_rule_not_found` for an id this workspace does not
   *   have — the same answer as for another workspace's.
   * @throws {InvalidRequestError} `422 escalation_rule_invalid` as {@link addRule} does.
   * @throws {ConflictError} `409 escalation_rule_sort_order_taken` likewise.
   */
  async changeRule(
    organizationId: string,
    id: string,
    body: UpdateRuleDto,
  ): Promise<EscalationRuleResource> {
    const stored = await this.management.rule(organizationId, id);

    if (stored === undefined) {
      throw escalationRuleNotFound(id);
    }

    if (body.when !== undefined || body.then !== undefined) {
      await this.checkRule(organizationId, body.when ?? stored.when, body.then ?? stored.then);
    }

    const write: RuleWrite = {
      enabled: body.enabled,
      sortOrder: body.sortOrder,
      when: body.when,
      then: body.then,
    };

    if (Object.values(write).every((value) => value === undefined)) {
      return toEscalationRuleResource(stored);
    }

    return this.answerRuleWrite(async () => {
      const updated = await this.management.updateRule(organizationId, id, write);

      // Deleted between the read and the write. `404` rather than a silent no-op, because a
      // client that asked to change a rule and was told nothing would keep drawing it.
      if (updated === undefined) {
        throw escalationRuleNotFound(id);
      }

      return updated;
    });
  }

  /**
   * Remove an escalation rule.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param id - The rule.
   * @returns When it is gone.
   * @throws {NotFoundError} `404 escalation_rule_not_found` when this workspace has no such
   *   rule — including when it is another workspace's, which is the same answer deliberately.
   */
  async removeRule(organizationId: string, id: string): Promise<void> {
    if (!(await this.management.deleteRule(organizationId, id))) {
      throw escalationRuleNotFound(id);
    }
  }

  /**
   * The routes for a list of task kinds, as the contract publishes them.
   *
   * Three reads for the whole answer rather than one per kind, and re-read rather than
   * assembled from what was just written — which is what makes the ticket's *"round-trip
   * through `PUT` and re-read identically"* a property of the response rather than a second
   * request a client has to make to check.
   *
   * The stats are read here too, so a route answered by a save carries the same two numerics
   * it will carry on the next matrix load. Saving a route does not change what it has already
   * cost, so this is the cache's ordinary hit rather than a fresh aggregate.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param taskKinds - The kinds to answer for, in the order they should appear.
   * @returns Their routes. A kind whose route vanished between the commit and this read
   *   contributes nothing rather than a null entry: the save happened, and an array of routes
   *   with a hole in it is harder for a client to read than a shorter array.
   */
  private async routesFor(
    organizationId: string,
    taskKinds: readonly string[],
  ): Promise<RouteResource[]> {
    const [routes, hops, stats] = await Promise.all([
      this.management.routes(organizationId),
      this.management.chains(organizationId),
      this.stats.read(organizationId),
    ]);

    const chains = chainsByRoute(hops);
    const byKind = new Map(routes.map((route) => [route.task_kind, route]));

    return taskKinds.flatMap((kind) => {
      const resource = this.routeOf(byKind.get(kind), chains, stats.byTaskKind);

      return resource === null ? [] : [resource];
    });
  }

  /**
   * One route as the contract publishes it, or null when the kind has none.
   *
   * @param route - The route row, or `undefined` for a kind with no route.
   * @param chains - Every chain in the workspace, keyed by route.
   * @param stats - What the window measured, keyed by task kind. A kind that is **absent** from
   *   it is one nothing was spent on, and it gets {@link EMPTY_ROUTE_STATS} — two em-dashes and
   *   three counts of zero — rather than a fabricated figure.
   * @returns The resource, or null.
   */
  private routeOf(
    route: ManagedRouteRow | undefined,
    chains: ReadonlyMap<string, readonly ManagedHopRow[]>,
    stats: ReadonlyMap<string, RouteStatsResource>,
  ): RouteResource | null {
    return route === undefined
      ? null
      : toRouteResource(
          route,
          chains.get(route.route_id) ?? [],
          stats.get(route.task_kind) ?? EMPTY_ROUTE_STATS,
        );
  }

  /**
   * Refuse a rule the domain will not store — the grammar, then the names.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param when - The predicate that will be stored.
   * @param then - The route modification that will be stored.
   * @returns When both are acceptable.
   * @throws {InvalidRequestError} `422 escalation_rule_invalid`, with `details.fields` keyed
   *   `when` and `then`. Both halves are reported at once: a client that got both wrong should
   *   not have to send the rule twice to be told so.
   */
  private async checkRule(organizationId: string, when: object, then: object): Promise<void> {
    const grammar = await this.management.ruleGrammar(when, then);
    const fields: Record<string, string[]> = {};

    if (!grammar.when) {
      fields.when = [WHEN_INVALID_MESSAGE];
    }

    if (!grammar.then) {
      fields.then = [THEN_INVALID_MESSAGE];
    }

    if (Object.keys(fields).length > 0) {
      throw escalationRuleInvalid(fields);
    }

    // Safe only now: the grammar function is the authority on what a `then` is, and it has
    // just said this document is one of the three shapes. Narrowing before the check would be
    // a cast that outran the thing that justifies it.
    const missing = await this.missingTargets(organizationId, then as unknown as EscalationThen);

    if (missing.length > 0) {
      throw escalationRuleInvalid({ then: missing });
    }
  }

  /**
   * Which of a rule's names this workspace does not have.
   *
   * The pre-flight over V018's deferred `escalation_rule_targets_exist` trigger. `route_local`
   * names neither a kind nor an alias and is therefore always satisfiable — which is the same
   * conclusion the trigger reaches, by the same reasoning.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param then - The route modification, already known to be one of the three shapes.
   * @returns One message per missing name. Empty when the workspace has both.
   */
  private async missingTargets(organizationId: string, then: EscalationThen): Promise<string[]> {
    const taskKind = targetTaskKind(then);
    const alias = targetAlias(then);

    if (taskKind === null && alias === null) {
      return [];
    }

    const [kinds, aliases] = await Promise.all([
      this.management.taskKinds(organizationId),
      this.management.aliasIds(organizationId),
    ]);

    const messages: string[] = [];

    if (taskKind !== null && !kinds.some((kind) => kind.name === taskKind)) {
      messages.push(unknownRuleTargetMessage("task_kind", taskKind));
    }

    if (alias !== null && !aliases.some((row) => row.alias === alias)) {
      messages.push(unknownRuleTargetMessage("alias", alias));
    }

    return messages;
  }

  /**
   * Run a rule write and turn the two refusals the pre-flights cannot close into their
   * designed answers.
   *
   * Both are races rather than mistakes — a rule inserted at the same position by another
   * administrator, an alias deleted between the check and the commit — and a caller that could
   * not recognise them would report a designed refusal as an unexplained `500`.
   *
   * @param write - The statement to run.
   * @returns The rule, as the contract publishes it.
   * @throws {ConflictError} `409` when V018's order key refused it.
   * @throws {InvalidRequestError} `422` when V018's deferred target trigger refused it.
   */
  private async answerRuleWrite(
    write: () => Promise<{
      id: string;
      enabled: boolean;
      sort_order: number;
      when: EscalationWhen;
      then: EscalationThen;
      display: string;
    }>,
  ): Promise<EscalationRuleResource> {
    try {
      return toEscalationRuleResource(await write());
    } catch (error) {
      if (isRuleSortOrderTaken(error)) {
        throw escalationRuleSortOrderTaken(sortOrderOf(error));
      }

      if (isRuleTargetMissing(error)) {
        throw escalationRuleInvalid({ then: [RULE_TARGET_RACE_MESSAGE] });
      }

      throw error;
    }
  }
}

/**
 * One request as the diff and the writer talk about it.
 *
 * The one place a DTO becomes a plain value: an absent note and an explicit `null` are the
 * same state on a `PUT`, and collapsing them here is what lets everything downstream compare
 * two chains without a three-way branch on `undefined`.
 *
 * @param request - The validated body entry.
 * @returns The route as the body asks for it.
 */
function toDesiredRoute(request: SaveRouteDto): DesiredRoute {
  return {
    taskKind: request.taskKind,
    allowLocalFallback: request.allowLocalFallback,
    floorHopIndex: request.floorHopIndex,
    maxCostCentsPerRun: request.maxCostCentsPerRun,
    hops: request.hops.map((hop) => ({ alias: hop.alias, note: hop.note ?? null })),
  };
}

/**
 * A chain with each alias resolved to the id `route_hops` stores.
 *
 * @param request - The route as the body asks for it.
 * @param aliasIds - Alias name to `model_aliases.id`, for this workspace.
 * @returns The hops, in order. Every alias is present by construction — a chain naming one
 *   this workspace does not have was refused before the transaction opened.
 */
function resolveHops(request: DesiredRoute, aliasIds: ReadonlyMap<string, string>): ResolvedHop[] {
  return request.hops.map((hop) => ({
    aliasId: aliasIds.get(hop.alias) as string,
    note: hop.note,
  }));
}

/**
 * The position a unique violation was raised about.
 *
 * Read from the driver's own `detail` — *"Key (organization_id, sort_order)=(org-x, 2) already
 * exists."* — because the statement that failed is behind a callback and the value is not in
 * hand at the point the error is caught. Falls back to `0` when the driver said nothing
 * parseable, which is honest: the `409` still names the rule's problem, and `details.sortOrder`
 * is a convenience rather than the message.
 *
 * @param error - The caught driver error.
 * @returns The position, or `0` when it could not be read.
 */
function sortOrderOf(error: unknown): number {
  const detail = (error as { detail?: unknown }).detail;

  if (typeof detail !== "string") {
    return 0;
  }

  const match = /,\s*(\d+)\)\s*already exists/.exec(detail);

  return match === null ? 0 : Number(match[1]);
}
