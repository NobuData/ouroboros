/**
 * The designed refusals of the alias lifecycle
 * ([#584](https://github.com/NobuData/ouroboros/issues/584)), and the recogniser for the one
 * PostgreSQL raises first.
 *
 * Mockup 21's caption is a promise about two of these — *"Aliases are unique per workspace.
 * Deleting one is blocked while any route or workflow references it."* — and the ticket's
 * problem statement is about a third: *"A 409 that says 'in use' makes the user hunt."* So the
 * refusals that block a write carry the **referrer list** from CG.3's `alias_references`
 * (decision **R5**), each entry with its kind and its chip label, which turns a block into a
 * work list. The fourth, `model_alias_unbound`, carries the pointer to Providers & keys the
 * mockup draws as *Fix in Providers →*.
 *
 * Every code is stable and every message is for a person; none names a constraint, a driver
 * or a table — the envelope's rule (`docs/ARCHITECTURE.md` § 5.3).
 */

import { ConflictError, InvalidRequestError, NotFoundError } from "../errors/error.envelope";
import type { AliasReferenceKind } from "../db/schema";
import { REGISTRY_ERRORS } from "./registry.errors";

/** The codes this surface answers with, beside the two it shares with the resolution read. */
export const ALIAS_ERRORS = {
  /** `404` — no alias with that id in this workspace. The same code the resolution read uses by name. */
  notFound: REGISTRY_ERRORS.aliasNotFound,
  /** `422` — the name is taken in this workspace. Never a unique-violation leak. */
  nameTaken: "model_alias_name_taken",
  /** `409` — a delete refused because routes, rules or workflows reference the alias. */
  referenced: "model_alias_referenced",
  /** `422` — a rename refused for the same reason: by-name references make it delete-shaped. */
  renameBlocked: "model_alias_rename_blocked",
  /** `422` — an unbound alias cannot be enabled; connect a provider first. */
  unbound: "model_alias_unbound",
  /** `422` — a duplicate's name would not fit V015's ceiling. */
  copyNameTooLong: "model_alias_copy_name_too_long",
} as const;

/** One of {@link ALIAS_ERRORS}. */
export type AliasErrorCode = (typeof ALIAS_ERRORS)[keyof typeof ALIAS_ERRORS];

/**
 * Where an unbound alias is fixed — mockup 21's *Fix in Providers →*, as the route AE.1
 * ([#227](https://github.com/NobuData/ouroboros/issues/227)) mounts *Providers & keys* on.
 */
export const PROVIDERS_FIX_PATH = "/models/providers";

/** V015's unique key on `(organization_id, alias)`, by name, for {@link isAliasNameTaken}. */
export const ALIAS_NAME_CONSTRAINT = "model_aliases_organization_alias_key";

/** The SQLSTATE PostgreSQL raises for a unique violation. */
export const UNIQUE_VIOLATION = "23505";

/** One referrer, as a refusal names it — the same four fields the resource carries. */
export interface ReferrerDetail {
  readonly kind: AliasReferenceKind;
  readonly refId: string;
  readonly label: string;
  readonly blocking: boolean;
}

/**
 * `404 model_alias_not_found`, for an id.
 *
 * The same answer for *no such alias* and *another workspace's alias*: every read is scoped by
 * the tenant, so the second is indistinguishable from the first, and an answer that told them
 * apart would let a caller probe ids across workspaces.
 *
 * @param aliasId - The id that was asked about.
 * @returns The error.
 */
export function aliasIdNotFound(aliasId: string): NotFoundError {
  return new NotFoundError(
    ALIAS_ERRORS.notFound,
    "This workspace has no model alias with that id.",
    { aliasId },
  );
}

/**
 * `422 model_alias_name_taken`.
 *
 * A `422` rather than a `409`: the name is a field of the body, and the fix is to send a
 * different one — the same class of answer a malformed name gets, and the one the ticket's
 * seventh criterion asks for (*a designed 422, not a unique-violation leak*).
 *
 * @param alias - The name that is taken.
 * @returns The error.
 */
export function aliasNameTaken(alias: string): InvalidRequestError {
  return new InvalidRequestError(
    ALIAS_ERRORS.nameTaken,
    "This workspace already has an alias by that name. Aliases are unique per workspace.",
    { alias },
  );
}

/**
 * `409 model_alias_referenced` — a delete refused by what references the alias.
 *
 * @param alias - The alias's name.
 * @param references - What references it, from `alias_reference_guard()`. At least one.
 * @returns The error, its `details.references` being the work list.
 * @throws {RangeError} When called with nothing to name — a refusal with an empty list would be
 *   a `409` saying *in use* and nothing else, which is the answer this code exists to replace.
 */
export function aliasReferenced(
  alias: string,
  references: readonly ReferrerDetail[],
): ConflictError {
  if (references.length === 0) {
    throw new RangeError("aliasReferenced needs at least one referrer to name");
  }

  return new ConflictError(
    ALIAS_ERRORS.referenced,
    `${alias} cannot be removed while ${countOf(references)} ${
      references.length === 1 ? "references" : "reference"
    } it. Repoint ${references.length === 1 ? "it" : "them"} first — ` +
      "see details.references for each one.",
    { alias, references: references.map(copyOf) },
  );
}

/**
 * `422 model_alias_rename_blocked` — a rename refused by what references the alias.
 *
 * A `422` where the delete is a `409`, because the refused thing is a *field*: the body asked
 * for a new name, and the answer is that this field cannot change while the referrers stand.
 * The list is the same one, for the same reason (decision **R5**: workflow documents hold the
 * name, so a rename breaks them exactly as a delete would).
 *
 * @param alias - The alias's current name.
 * @param references - What references it. At least one.
 * @returns The error.
 * @throws {RangeError} When called with nothing to name.
 */
export function aliasRenameBlocked(
  alias: string,
  references: readonly ReferrerDetail[],
): InvalidRequestError {
  if (references.length === 0) {
    throw new RangeError("aliasRenameBlocked needs at least one referrer to name");
  }

  return new InvalidRequestError(
    ALIAS_ERRORS.renameBlocked,
    `${alias} cannot be renamed while ${countOf(references)} ${
      references.length === 1 ? "references" : "reference"
    } it by name. Repoint ${references.length === 1 ? "it" : "them"} first — ` +
      "see details.references for each one.",
    { alias, references: references.map(copyOf) },
  );
}

/**
 * `422 model_alias_unbound` — the alias has no provider connection, so it cannot be switched
 * on.
 *
 * The database would refuse this too (V019's `model_aliases_unbound_disabled`), and the whole
 * reason this function exists is that the user is owed the designed answer with the pointer
 * to Providers & keys rather than a constraint violation.
 *
 * @param alias - The alias's name.
 * @returns The error, its `details.fix` being where to go.
 */
export function aliasUnbound(alias: string): InvalidRequestError {
  return new InvalidRequestError(
    ALIAS_ERRORS.unbound,
    `${alias} has no provider connection, so it cannot be enabled. ` +
      "Connect a provider under Providers & keys, bind the alias to it, and then switch it on.",
    { alias, fix: PROVIDERS_FIX_PATH },
  );
}

/**
 * `422 model_alias_copy_name_too_long` — the duplicate's name would exceed V015's ceiling.
 *
 * Only reachable from an alias whose name is already within a few characters of the ceiling;
 * refused rather than truncated, because a truncated name is one the user did not choose.
 *
 * @param alias - The alias being duplicated.
 * @param proposed - The name the duplicate would have had.
 * @param maxLength - The ceiling.
 * @returns The error.
 */
export function copyNameTooLong(
  alias: string,
  proposed: string,
  maxLength: number,
): InvalidRequestError {
  return new InvalidRequestError(
    ALIAS_ERRORS.copyNameTooLong,
    `Duplicating ${alias} would name the copy ${proposed}, which is longer than ` +
      `${maxLength.toString()} characters. Rename the alias to something shorter first.`,
    { alias, proposed, maxLength },
  );
}

/**
 * Whether an error is PostgreSQL refusing a second alias by the same name.
 *
 * The service checks the name before it writes, so this fires only for the race — two creates
 * of the same name at once — and maps it to the same designed `422` the pre-check gives.
 *
 * @param error - Whatever the driver raised.
 * @returns Whether it is the unique violation on V015's `(organization_id, alias)` key.
 */
export function isAliasNameTaken(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const candidate = error as { code?: unknown; constraint?: unknown };

  return candidate.code === UNIQUE_VIOLATION && candidate.constraint === ALIAS_NAME_CONSTRAINT;
}

/**
 * `4 routes`, `1 rule`, `4 references` — the count phrase of a refusal.
 *
 * @param references - The referrers.
 * @returns The phrase.
 */
function countOf(references: readonly ReferrerDetail[]): string {
  const kinds = new Set(references.map((reference) => reference.kind));
  const noun =
    kinds.size === 1 && kinds.has("route")
      ? "route"
      : kinds.size === 1 && kinds.has("escalation")
        ? "escalation rule"
        : "reference";

  return `${references.length.toString()} ${noun}${references.length === 1 ? "" : "s"}`;
}

/**
 * A referrer as the envelope carries it — copied, so a caller's array is not the response.
 *
 * @param reference - The referrer.
 * @returns The same four fields.
 */
function copyOf(reference: ReferrerDetail): ReferrerDetail {
  return {
    kind: reference.kind,
    refId: reference.refId,
    label: reference.label,
    blocking: reference.blocking,
  };
}
