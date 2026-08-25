/**
 * The one refusal bulk import has, and the sentences it is made of
 * ([#587](https://github.com/NobuData/ouroboros/issues/587)).
 *
 * **A batch that is wrong anywhere is refused everywhere.** The ticket's phrasing is that
 * *partial creation is worse than none* — seven aliases created and an eighth refused leaves
 * an operator reconciling by hand — so the refusal below describes the whole request and
 * nothing is written. That is the same contract `routing/routing.errors.ts` publishes for a
 * route save, deliberately: two batch surfaces that failed differently would be two things for
 * a client to learn, and the wizard is CI.4's ([#594](https://github.com/NobuData/ouroboros/issues/594))
 * to build against one of them.
 *
 * **The complaints are itemized by request position.** `details.items` is keyed by the item's
 * index in the array that was sent — `{"0": {"alias": ["…"]}}` — because the thing #594 has to
 * mark is a *row of its table*, and the index is the only key that is guaranteed to identify
 * one: a batch may legally name the same model twice, and that is itself one of the things
 * complained about here. Inside an item the keys are the request's own field names, plus
 * CH.2's `params.<name>` paths passed through unchanged, so one renderer serves this, a
 * `validation_failed` and a `model_alias_params_invalid`.
 */

import { InvalidRequestError } from "../errors/error.envelope";

/** The codes this surface answers with, beside the `404` it shares with every other read. */
export const IMPORT_ERRORS = {
  /** `422` — one or more items cannot be created, and **nothing was**. */
  invalid: "model_import_invalid",
} as const;

/** One of {@link IMPORT_ERRORS}. */
export type ImportErrorCode = (typeof IMPORT_ERRORS)[keyof typeof IMPORT_ERRORS];

/** The field an item's model complaint is filed under — the request's own spelling. */
export const MODEL_ID_FIELD = "modelId";

/** The field an item's name complaint is filed under. */
export const ALIAS_FIELD = "alias";

/**
 * What a client is told about one item. Written once so a message and its assertion cannot
 * drift apart.
 */
export const IMPORT_MESSAGES = {
  /**
   * The model is not one discovery reported on this connection.
   *
   * **The rule this surface exists to keep** (decision **R7**). CH.1's create *warns* about an
   * undiscovered model and saves it anyway, because a single alias typed by somebody who knows
   * what they are doing is a configuration that may well be valid during discovery's gaps. A
   * bulk path cannot make that allowance: the whole reason import is safe is that its model ids
   * came from the provider rather than from a paste buffer, and an item naming something
   * discovery has not seen is the typo class the registry was built to remove.
   */
  notDiscovered:
    "This connection has not discovered a model by that id. Import only creates aliases for " +
    "models the provider itself listed — refresh discovery under Providers & keys, or create " +
    "the alias by hand if you are sure.",
  /** The workspace already has an alias by that name. */
  nameTaken:
    "This workspace already has an alias by that name. Aliases are unique per workspace — " +
    "choose another, or leave the row out.",
  /** Two items of one batch ask for the same name. */
  nameRepeated: "This name is asked for more than once in the same import.",
  /**
   * A concurrent write took one of the batch's names between the check and the insert.
   *
   * Its own sentence rather than {@link IMPORT_MESSAGES.nameTaken}, because it is filed against
   * **every** item: V015's unique key names the constraint and not which of the inserts met it,
   * and telling somebody that all forty of their names are taken would be a wrong statement
   * about thirty-nine of them. What is true of all of them is that the batch rolled back.
   */
  nameRaced:
    "Something else created an alias with one of these names while this import was running. " +
    "Nothing was created — read the candidates again and retry.",
} as const;

/** One item's complaints, keyed by the field of the request they are about. */
export type ItemProblems = Record<string, string[]>;

/** Every complaint in a batch, keyed by the item's index as text. Empty means it may commit. */
export type BatchProblems = Record<string, ItemProblems>;

/**
 * `422 model_import_invalid` — the batch was refused, and here is what is wrong with each item.
 *
 * @param items - Field messages keyed by the item's index in the request, exactly as they will
 *   be published: `{"1": {"alias": ["…"]}}`.
 * @returns The `422`, its `details.items` being the work list.
 * @throws {RangeError} When nothing is wrong, which would be this function describing a
 *   refusal that did not happen — a mistake at the call site rather than a state a request can
 *   reach.
 */
export function importInvalid(items: Readonly<BatchProblems>): InvalidRequestError {
  if (Object.keys(items).length === 0) {
    throw new RangeError("importInvalid needs at least one item to complain about");
  }

  return new InvalidRequestError(
    IMPORT_ERRORS.invalid,
    "These models could not be imported. See `details.items` for each one, keyed by its " +
      "position in the request. Nothing was created.",
    { items },
  );
}
