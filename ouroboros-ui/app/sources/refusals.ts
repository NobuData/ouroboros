/**
 * The service's codes the page branches on, and the sentences the actions answer with —
 * imported by `app/sources/actions.ts` and `app/sources/catalog.ts` alike
 * ([#141](https://github.com/NobuData/ouroboros/issues/141)).
 *
 * Split from `catalog.ts` so the Server Action module's import list names only values it
 * uses: a `"use server"` module may export nothing but async functions, and the codes are a
 * thing both a dialog and an action need to agree about.
 */

/** The service's error envelope, as a Server Action hands it back. */
export interface ApiRefusal {
  /** The contract's stable code — what is branched on. */
  readonly code: string;
  /** The service's sentence, written for an API caller. */
  readonly message: string;
  /** Whatever the code carries — field messages, a taken name. */
  readonly details: Readonly<Record<string, unknown>>;
}

export const CONFIG_INVALID_CODE = "ticket_source_config_invalid";
export const VALIDATION_FAILED_CODE = "validation_failed";
export const NAME_TAKEN_CODE = "ticket_source_name_taken";
export const FORBIDDEN_CODE = "forbidden";
export const KIND_UNSUPPORTED_CODE = "ticket_source_kind_unsupported";
export const NOT_FOUND_CODE = "ticket_source_not_found";
export const CREDENTIALS_UNSUPPORTED_CODE = "ticket_source_credentials_unsupported";

/** What the add dialog says when the catalog could not be read. */
export const CATALOG_UNAVAILABLE =
  "The catalog could not be read just now. Nothing was changed — try again in a moment.";

/** What the credential form says for a provider that takes none. */
export const CREDENTIALS_UNSUPPORTED = "This source's provider takes no credential.";
