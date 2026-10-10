/**
 * Imported document sets' refusals (CL.5, [#618](https://github.com/NobuData/ouroboros/issues/618)).
 *
 * Each code is stable and is what a client branches on; the sentences are for people.
 */

import { ConflictError, InvalidRequestError, NotFoundError } from "../../errors/error.envelope";

export const DOCUMENT_IMPORT_ERRORS = {
  /** This workspace has no such imported set. `404`. */
  notFound: "document_import_not_found",
  /** The workspace already has a set at that collection and name. `409`. */
  exists: "document_import_exists",
  /** The file cannot be read as documents — the message names the row or section. `422`. */
  invalid: "document_import_invalid",
  /** Neither the request nor the file gives the set a title. `422`. */
  titleRequired: "document_import_title_required",
} as const;

/**
 * `404` — the workspace has no such set.
 *
 * @param importId - The id asked for.
 * @returns The error.
 */
export function importNotFound(importId: string): NotFoundError {
  return new NotFoundError(
    DOCUMENT_IMPORT_ERRORS.notFound,
    "This workspace has no such imported document set.",
    { importId },
  );
}

/**
 * `409` — the locator is taken.
 *
 * @param collection - The collection asked for.
 * @param name - The name asked for.
 * @returns The error.
 */
export function importExists(collection: string, name: string): ConflictError {
  return new ConflictError(
    DOCUMENT_IMPORT_ERRORS.exists,
    `This workspace already has an imported set at issue-index://${collection}/${name}. Remove it first to replace it.`,
    { collection, name },
  );
}

/**
 * `422` — the file cannot be imported.
 *
 * @param reason - Why, from the parser — it names the row or section.
 * @returns The error.
 */
export function importInvalid(reason: string): InvalidRequestError {
  return new InvalidRequestError(
    DOCUMENT_IMPORT_ERRORS.invalid,
    `The file cannot be imported: ${reason}.`,
    { fields: { content: [reason] } },
  );
}

/**
 * `422` — the set has no title.
 *
 * @returns The error.
 */
export function titleRequired(): InvalidRequestError {
  const reason = "give the set a title, or start a Markdown file with a # heading";

  return new InvalidRequestError(
    DOCUMENT_IMPORT_ERRORS.titleRequired,
    `The set needs a title: ${reason}.`,
    { fields: { title: [reason] } },
  );
}
