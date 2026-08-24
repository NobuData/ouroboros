/**
 * What the registry refuses, and the one refusal the schema hands up rather than invents.
 *
 * The same shape and the same argument as `pricing/pricing.errors.ts`: a code is only
 * meaningful beside the operation that produces it, `openapi.yaml` is where the two are
 * published together, and this file exists so the string in the specification and the string
 * in the answer come from one constant.
 *
 * There were two, and the second is the interesting one; CH.2
 * ([#585](https://github.com/NobuData/ouroboros/issues/585)) added two more — a `422` for
 * parameters a model does not accept, and the `404` its schema read answers for a connection
 * this workspace does not have.
 *
 * ---------------------------------------------------------------------------
 * **`provider_connection_in_use` is a designed message for a rule the database enforces.**
 *
 * V015's `model_aliases_provider_fk` carries `on delete restrict`, so deleting a connection
 * that aliases still name is refused by PostgreSQL. That refusal reads:
 *
 *   update or delete on table "provider_connections" violates foreign key constraint
 *   "model_aliases_provider_fk" on table "model_aliases"
 *
 * which is correct, unactionable, and names a constraint the person who clicked *Remove*
 * has never heard of. [#189](https://github.com/NobuData/ouroboros/issues/189)'s acceptance
 * criterion asks for the rule *and* a clear message, so this file is the message: it names
 * the aliases that are in the way, which is what turns a refusal into an instruction.
 *
 * **Both directions are covered, deliberately.** {@link providerConnectionInUse} is what a
 * caller throws after {@link RegistryService.dependentAliases} has told it what depends on
 * the connection — the pre-flight, which is where a good message comes from because the
 * names are still in hand. {@link isProviderConnectionInUse} is for the race the pre-flight
 * cannot close: an alias created between the check and the delete makes the server refuse
 * anyway, and a caller that could not recognise that error would report it as a `500`.
 *
 * Neither is thrown from inside this module, and that is decision **M2** rather than dead
 * code: *deleting a provider connection* is mockup 07's surface, and this module deliberately
 * has no CRUD. Both are thrown by `provider-connections/provider-connections.service.ts`
 * (AD.2, [#223](https://github.com/NobuData/ouroboros/issues/223)) — the pre-flight and the
 * race — and both are tested against a real foreign-key violation in
 * `registry.integration-spec.ts` rather than against a hand-written error object.
 */

import { ConflictError, NotFoundError } from "../errors/error.envelope";

/**
 * The codes, as one object.
 *
 * `as const` so each value is its own literal type, and so `registry.errors.spec.ts` can
 * hold the published copy to these.
 */
export const REGISTRY_ERRORS = {
  /**
   * No alias by that name in this workspace.
   *
   * What resolution answers when a route names something the registry does not have —
   * which, once Y.2's routes carry a foreign key onto `model_aliases`, is only reachable
   * through a caller that supplied the name itself: a simulation, the DSL, a swap menu
   * acting on a stale list.
   */
  aliasNotFound: "model_alias_not_found",

  /**
   * That connection cannot be removed while aliases resolve on it.
   *
   * A `409` rather than a `422`: nothing about the request is malformed, the connection
   * exists, and a client that retries it unchanged gets the same answer. What has to change
   * is the *state* — repoint or remove the aliases first.
   */
  providerConnectionInUse: "provider_connection_in_use",

  /**
   * The parameters written against an alias are not ones its model accepts.
   *
   * A `422` and not a `400`: the request is well formed and the alias exists — what is wrong is
   * that a thinking budget was set on a model with no thinking, or a temperature outside the
   * range this provider publishes. `details` carries one entry per field, keyed
   * `params.<name>` and `restrictions.<name>` so a form maps each back to the input it came
   * from. See `params.validation.ts`, which is the only thing that raises it.
   *
   * Distinct from `validation_failed` deliberately, even though both are `422`s with the same
   * `details` shape. That code means *the body is malformed*; this one means *the body is fine
   * and the model refuses it*, and a client that wanted to say so — the inspector does — could
   * not tell them apart from the status alone.
   */
  aliasParamsInvalid: "model_alias_params_invalid",

  /**
   * The connection a param schema was asked for does not exist in this workspace.
   *
   * A `404`, and the same answer for *no such connection* and *not yours*: telling the two
   * apart would let somebody enumerate another workspace's connections by watching which ids
   * answer differently. `provider-connections/` makes the same choice with the same code.
   */
  connectionNotFound: "provider_connection_not_found",
} as const;

/** One of {@link REGISTRY_ERRORS}' values. */
export type RegistryErrorCode = (typeof REGISTRY_ERRORS)[keyof typeof REGISTRY_ERRORS];

/**
 * The constraint PostgreSQL names when a connection with dependent aliases is deleted.
 *
 * V015 declares it; this constant is what lets {@link isProviderConnectionInUse} tell that
 * violation from every other foreign-key violation the same statement could raise. A
 * literal rather than a substring match, because *some* foreign key was violated is not the
 * same fact as *this* one was.
 */
export const PROVIDER_DEPENDENCY_CONSTRAINT = "model_aliases_provider_fk";

/**
 * PostgreSQL's SQLSTATE for a foreign-key violation.
 *
 * Written down rather than inlined so the two places that care — this file and its spec —
 * cannot disagree about which class 23 code is being recognised.
 */
export const FOREIGN_KEY_VIOLATION = "23503";

/**
 * `404` — this workspace has no alias by that name.
 *
 * @param alias - The name that was looked up, echoed exactly as it was supplied. A caller
 *   that spelled it with a capital letter needs to see which spelling was searched for,
 *   because V015 stores aliases folded and `Coder-Max` genuinely is not `coder-max`.
 * @returns The error to throw.
 */
export function aliasNotFound(alias: string): NotFoundError {
  return new NotFoundError(
    REGISTRY_ERRORS.aliasNotFound,
    "This workspace has no model alias by that name.",
    { alias },
  );
}

/**
 * `409` — aliases still resolve on that connection, so it cannot be removed.
 *
 * The message names them. That is the whole point of this function existing rather than the
 * caller throwing a generic conflict: *"coder-max and local-docs resolve on this
 * connection"* tells somebody what to do next, and *"this connection is in use"* does not.
 *
 * @param connectionId - The connection that was to be removed. In `details` rather than in
 *   the sentence, because it is a uuid and nobody reads one.
 * @param aliases - The aliases blocking it, as
 *   {@link RegistryService.dependentAliases} returned them — sorted, so the message is
 *   stable between calls. Must not be empty: an empty list means nothing was blocking, and
 *   this error would then be describing a refusal that did not happen.
 * @returns The error to throw.
 * @throws {RangeError} If `aliases` is empty, which is a programming error at the call site
 *   rather than a state a user can reach.
 */
export function providerConnectionInUse(
  connectionId: string,
  aliases: readonly string[],
): ConflictError {
  if (aliases.length === 0) {
    throw new RangeError("providerConnectionInUse needs at least one alias to name");
  }

  return new ConflictError(
    REGISTRY_ERRORS.providerConnectionInUse,
    `This provider connection cannot be removed while ${listOf(aliases)} ${
      aliases.length === 1 ? "resolves" : "resolve"
    } on it. Repoint or remove ${aliases.length === 1 ? "it" : "them"} first.`,
    { connectionId, aliases: [...aliases] },
  );
}

/**
 * Whether a caught error is PostgreSQL refusing to delete a connection aliases depend on.
 *
 * The race {@link providerConnectionInUse}'s pre-flight cannot close: an alias created
 * between the check and the delete makes the server refuse anyway. A caller that could not
 * recognise this would report a designed refusal as an unexplained `500`.
 *
 * Duck-typed rather than an `instanceof` against `pg`'s `DatabaseError`, for the reason
 * every driver-error check in this service is: the object arrives through Kysely, and a
 * class identity that depends on which copy of `pg` was resolved is not a property worth
 * betting a `500` on. Both fields are checked, so an unrelated foreign key violated by the
 * same statement is not mistaken for this one.
 *
 * @param error - Whatever was caught.
 * @returns `true` when it is a foreign-key violation naming V015's dependency constraint.
 */
export function isProviderConnectionInUse(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const candidate = error as { code?: unknown; constraint?: unknown };

  return (
    candidate.code === FOREIGN_KEY_VIOLATION &&
    candidate.constraint === PROVIDER_DEPENDENCY_CONSTRAINT
  );
}

/**
 * `404` — this workspace has no provider connection by that id.
 *
 * Raised by the param-schema read, which is the first thing in this module to address a
 * connection by id rather than through an alias. It carries the same code
 * `provider-connections/` uses for the same fact, so a client that already recognises one
 * recognises both — one code for one situation, whichever surface produced it.
 *
 * @param connectionId - The id that was asked for, echoed in `details` rather than in the
 *   sentence, because it is a uuid and nobody reads one.
 * @returns The error to throw.
 */
export function registryConnectionNotFound(connectionId: string): NotFoundError {
  return new NotFoundError(
    REGISTRY_ERRORS.connectionNotFound,
    "This workspace has no provider connection by that id.",
    { connectionId },
  );
}

/**
 * Join names the way a sentence does — `a`, `a and b`, `a, b and c`.
 *
 * Local and unexported: it exists so one message reads like English, and a shared
 * list-formatting helper is a thing this service does not have and does not need.
 *
 * @param names - At least one name, already in the order they should be read.
 * @returns The names as one clause.
 */
function listOf(names: readonly string[]): string {
  if (names.length === 1) {
    return names[0];
  }

  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
