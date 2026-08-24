/**
 * What resolution refuses, and the one thing it refuses that is not a `fail_run`.
 *
 * Z.1 ([#194](https://github.com/NobuData/ouroboros/issues/194)). The same shape and the same
 * argument as `pricing/pricing.errors.ts` and `registry/registry.errors.ts`: a code is only
 * meaningful beside the operation that produces it, and this file exists so the string in the
 * specification and the string in the answer come from one constant.
 *
 * ---------------------------------------------------------------------------
 * **There is exactly one error here, and the reason there is only one is the interesting
 * part.**
 *
 * Almost everything that can go wrong with a resolution is not an error — it is an *answer*.
 * Every provider down, the floor breached, a chain filtered to nothing: those are
 * `fail_run` resolutions carrying an explanation, because the caller asked a well-formed
 * question about a route that exists and deserves to be told what the route did. Turning any
 * of them into a `500` or a `422` would throw away the explanations this ticket is mostly
 * about.
 *
 * {@link ROUTING_ERRORS.routeNotFound} is the one case that genuinely is not an answer: the
 * workspace has no route for that task kind, so there is no chain to explain and nothing to
 * annotate. A `404` rather than a `422`, because nothing about the request is malformed — the
 * kind is a perfectly good name, this workspace simply does not have it, and V016 lets a
 * workspace delete a kind it never uses.
 *
 * ---------------------------------------------------------------------------
 * **Z.2 ([#195](https://github.com/NobuData/ouroboros/issues/195)) added four more, and they
 * are refusals rather than answers because they are about a *write*.**
 *
 * A resolution is asked what a route does and can always say something. A save is asked to
 * make a route be something, and *the floor you set is deeper than the chain you sent* has no
 * reading under which the save happened. The four are:
 *
 *   * {@link ROUTING_ERRORS.routeSaveInvalid} — a `422` whose `details.routes` is keyed by
 *     **task kind**, so a client that sent eight routes and got one wrong knows which row of
 *     the matrix to mark. That keying is the ticket's *"per-route errors map back to their
 *     route"*, and it is why this is one error rather than the first of eight.
 *   * {@link ROUTING_ERRORS.escalationRuleInvalid} — a `422` for a rule whose `when` or
 *     `then` is not the M5 grammar, or which names a task kind or alias this workspace does
 *     not have. Both halves are decided by the database (see `management.service.ts`), which
 *     is what V018 asked for in as many words.
 *   * {@link ROUTING_ERRORS.escalationRuleNotFound} — a `404` for a rule id, and the same
 *     answer for *no such rule* and *another workspace's*.
 *   * {@link ROUTING_ERRORS.escalationRuleSortOrderTaken} — a `409`, because nothing about
 *     the request is malformed and a retry of it unchanged answers the same thing. What has
 *     to change is the state.
 */

import { ConflictError, InvalidRequestError, NotFoundError } from "../errors/error.envelope";

/**
 * The codes, as one object.
 *
 * `as const` so each value is its own literal type, and so `routing.errors.spec.ts` can hold
 * the published copy to these.
 */
export const ROUTING_ERRORS = {
  /**
   * This workspace has no route for that task kind.
   *
   * Reachable two ways, and both are the caller's: a name the workspace never had, and a kind
   * that exists with no route pointing at it. V016 makes the second possible on purpose —
   * `routes.task_kind_id` is unique, not mandatory — so the message names the kind rather
   * than guessing which of the two it was.
   */
  routeNotFound: "route_not_found",

  /**
   * The batch could not be saved, and `details.routes` says which routes and which fields.
   *
   * A `422` and not a `409`: every one of these is something about the *request* that has to
   * change — an empty chain, a floor past the end of the chain it was sent with, an alias
   * this workspace does not have, a task kind with no route to save onto.
   *
   * **One error for the whole batch, deliberately.** The mockup commits every edit at once,
   * so answering with the first failure would send a client back for the second, and the
   * third. `details.routes` is `{"<taskKind>": {"<field>": ["message"]}}` — the same
   * `{field: [messages]}` shape `validation_failed` uses, one level deeper, so a form that
   * already renders one renders the other.
   */
  routeSaveInvalid: "route_save_invalid",

  /**
   * The rule is not one this schema can store.
   *
   * Either the `when`/`then` grammar (**M5**) refused it, or the names inside `then` are not
   * this workspace's. `details.fields` names which of the two, keyed `when` or `then`.
   *
   * Distinct from `validation_failed` for `model_alias_params_invalid`'s reason: that code
   * means *the body is malformed*, and this one means *the body is well-formed JSON and the
   * routing domain refuses it*. A builder that wanted to say so could not tell them apart
   * from the status alone.
   */
  escalationRuleInvalid: "escalation_rule_invalid",

  /**
   * No escalation rule by that id in this workspace.
   *
   * The same answer for *no such rule* and *another workspace's rule*: telling the two apart
   * would let somebody enumerate another workspace's rules by watching which ids answer
   * differently. `registry/` and `provider-connections/` make the same choice.
   */
  escalationRuleNotFound: "escalation_rule_not_found",

  /**
   * Another rule already evaluates at that position.
   *
   * V018 makes `sort_order` unique per workspace, because *which rule wins* has to have one
   * answer. A `409` rather than a `422`: the request is well formed, the rule is fine, and
   * what has to change is the state — move the other rule, or leave `sortOrder` out and be
   * appended.
   */
  escalationRuleSortOrderTaken: "escalation_rule_sort_order_taken",
} as const;

/** One of {@link ROUTING_ERRORS}' values. */
export type RoutingErrorCode = (typeof ROUTING_ERRORS)[keyof typeof ROUTING_ERRORS];

/**
 * PostgreSQL's SQLSTATE for a unique violation.
 *
 * Written down rather than inlined so this file and its spec cannot disagree about which
 * class 23 code is being recognised — the same reason `registry.errors.ts` names its own.
 */
export const UNIQUE_VIOLATION = "23505";

/** PostgreSQL's SQLSTATE for a CHECK violation, which is also what V018's constraint triggers raise. */
export const CHECK_VIOLATION = "23514";

/** V018's per-workspace uniqueness on `escalation_rules.sort_order`. */
export const RULE_SORT_ORDER_CONSTRAINT = "escalation_rules_organization_sort_order_key";

/**
 * V018's deferred constraint trigger over the names a rule's `then` carries.
 *
 * It fires at `commit` rather than at the statement, so it is the one refusal a pre-flight
 * cannot close: an alias deleted between the check and the commit makes the server refuse
 * anyway. A caller that could not recognise it would report a designed refusal as a `500`.
 */
export const RULE_TARGETS_CONSTRAINT = "escalation_rules_targets_exist";

/**
 * That task kind has no route in this workspace.
 *
 * @param taskKind - The name that was asked for, echoed so a client can say which of several
 *   resolutions failed without correlating by position.
 * @returns The `404`.
 */
export function routeNotFound(taskKind: string): NotFoundError {
  return new NotFoundError(
    ROUTING_ERRORS.routeNotFound,
    "This workspace has no route for that task kind.",
    { taskKind },
  );
}

/**
 * `422` — the batch was refused, and here is what is wrong with each route in it.
 *
 * @param routes - Field messages keyed by task kind, exactly as they will be published:
 *   `{"implement": {"floorHopIndex": ["…"]}}`. The field names are the **request's**
 *   (camelCase), not the column's, because what a client has to fix is the value it sent.
 * @returns The `422`.
 * @throws {RangeError} If nothing is wrong, which would be this function describing a
 *   refusal that did not happen — a mistake at the call site rather than a state anybody can
 *   reach through the API.
 */
export function routeSaveInvalid(
  routes: Readonly<Record<string, Record<string, string[]>>>,
): InvalidRequestError {
  if (Object.keys(routes).length === 0) {
    throw new RangeError("routeSaveInvalid needs at least one route to complain about");
  }

  return new InvalidRequestError(
    ROUTING_ERRORS.routeSaveInvalid,
    "These routes could not be saved. See `details.routes` for each one. Nothing was saved.",
    { routes },
  );
}

/**
 * `422` — the rule is not one the routing domain will store.
 *
 * @param fields - What is wrong, keyed `when` or `then`. The same `{field: [messages]}` shape
 *   `validation_failed` publishes, so one renderer serves both.
 * @returns The `422`.
 * @throws {RangeError} If nothing is wrong, for {@link routeSaveInvalid}'s reason.
 */
export function escalationRuleInvalid(
  fields: Readonly<Record<string, string[]>>,
): InvalidRequestError {
  if (Object.keys(fields).length === 0) {
    throw new RangeError("escalationRuleInvalid needs at least one field to complain about");
  }

  return new InvalidRequestError(
    ROUTING_ERRORS.escalationRuleInvalid,
    "This escalation rule is not valid. See `details.fields`.",
    { fields },
  );
}

/**
 * `404` — this workspace has no escalation rule by that id.
 *
 * @param id - The id that was addressed, echoed so a client acting on a stale list can say
 *   which row to remove without correlating by position.
 * @returns The `404`.
 */
export function escalationRuleNotFound(id: string): NotFoundError {
  return new NotFoundError(
    ROUTING_ERRORS.escalationRuleNotFound,
    "This workspace has no escalation rule by that id.",
    { id },
  );
}

/**
 * `409` — another rule already evaluates at that position.
 *
 * @param sortOrder - The position that is taken, echoed so a builder can offer the next free
 *   one without a second request.
 * @returns The `409`.
 */
export function escalationRuleSortOrderTaken(sortOrder: number): ConflictError {
  return new ConflictError(
    ROUTING_ERRORS.escalationRuleSortOrderTaken,
    "Another escalation rule already evaluates at that position. Move it first, or leave " +
      "`sortOrder` out to be appended.",
    { sortOrder },
  );
}

/**
 * Whether a caught error is PostgreSQL refusing a rule at a position another rule holds.
 *
 * Duck-typed rather than an `instanceof` against `pg`'s `DatabaseError`, for the reason every
 * driver-error check in this service is: the object arrives through Kysely, and a class
 * identity that depends on which copy of `pg` was resolved is not a property worth betting a
 * `500` on. Both fields are checked, so an unrelated unique index violated by the same
 * statement is not mistaken for this one.
 *
 * @param error - Whatever was caught.
 * @returns `true` when it is a unique violation naming V018's order key.
 */
export function isRuleSortOrderTaken(error: unknown): boolean {
  return namesConstraint(error, UNIQUE_VIOLATION, RULE_SORT_ORDER_CONSTRAINT);
}

/**
 * Whether a caught error is V018's deferred trigger refusing the names a rule carries.
 *
 * The race the pre-flight cannot close — see {@link RULE_TARGETS_CONSTRAINT}. Recognised so
 * the answer is the same `422` the pre-flight would have given rather than a `500` that says
 * nothing about a rule.
 *
 * @param error - Whatever was caught.
 * @returns `true` when it is a CHECK violation naming that trigger.
 */
export function isRuleTargetMissing(error: unknown): boolean {
  return namesConstraint(error, CHECK_VIOLATION, RULE_TARGETS_CONSTRAINT);
}

/**
 * Whether a driver error carries both a SQLSTATE and a constraint name.
 *
 * One helper rather than the same six lines twice — and it is deliberately strict about both
 * fields: *some* constraint was violated is not the same fact as *this* one was.
 *
 * @param error - Whatever was caught.
 * @param code - The SQLSTATE it must carry.
 * @param constraint - The constraint it must name.
 * @returns Whether both match.
 */
function namesConstraint(error: unknown, code: string, constraint: string): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const candidate = error as { code?: unknown; constraint?: unknown };

  return candidate.code === code && candidate.constraint === constraint;
}
