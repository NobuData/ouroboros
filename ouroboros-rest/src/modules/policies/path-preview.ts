/**
 * The glob editor's match preview, as functions (BS.4,
 * [#494](https://github.com/NobuData/ouroboros/issues/494)) — which globs are ones the policy
 * document would accept, and what each one covers in a repository's tree.
 *
 * **The preview and the enforcement cannot disagree**, because neither rule lives here: a glob is
 * valid when the committed `path_glob` definition (`org-policy.schema.ts`, held equal to
 * `schemas/workflow-dsl/v1.json`) accepts it — the grammar the publish validates with — and a path
 * matches when `guardrails.glob.ts` says so — the matcher AP.3's `allowed_paths` check runs.
 *
 * Pure: no host request, no database.
 */

import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";

import { InvalidRequestError } from "../errors/error.envelope";
import { globToRegExp } from "../guardrails/guardrails.glob";
import type { RepoTree } from "../ticket-sources/ticket-source.probe";
import { ORG_POLICY_DSL_DEFINITIONS } from "./org-policy.schema";

/** The `code` of the preview's one refusal of its own. `422`. */
export const PATH_PREVIEW_GLOB_INVALID = "policy_path_glob_invalid";

/** The most matching paths a preview shows per glob and repository. */
export const PATH_PREVIEW_MAX_SAMPLES = 5;

/** What one glob covers in one repository. */
export interface GlobMatchResource {
  readonly glob: string;
  /** How many files of the listed tree it matches. */
  readonly matchCount: number;
  /** Up to {@link PATH_PREVIEW_MAX_SAMPLES} of them, sorted. */
  readonly samples: readonly string[];
}

/** The compiled `path_glob` validator — compiled once, on first use. */
let globValidator: ValidateFunction | undefined;

/**
 * The validator for one glob, by reference to the committed definition.
 *
 * @returns It.
 */
function validateGlob(): ValidateFunction {
  if (globValidator === undefined) {
    const ajv = new Ajv2020({ strict: false });

    ajv.addSchema(ORG_POLICY_DSL_DEFINITIONS);
    globValidator = ajv.compile({ $ref: `${ORG_POLICY_DSL_DEFINITIONS.$id}#/$defs/path_glob` });
  }

  return globValidator;
}

/**
 * Whether a glob is one the `protected_paths` rule may store.
 *
 * @param glob - The pattern.
 * @returns True when the committed grammar accepts it.
 */
export function isPolicyPathGlob(glob: unknown): glob is string {
  return validateGlob()(glob) === true;
}

/**
 * Refuse a list holding a glob the document would not accept.
 *
 * @param globs - The patterns, already a non-empty list of distinct strings.
 * @throws {InvalidRequestError} `policy_path_glob_invalid`, naming each refused glob and where it
 *   sits in the list (`details.invalid`).
 */
export function assertPolicyPathGlobs(globs: readonly string[]): void {
  const invalid = globs.flatMap((glob, index) => (isPolicyPathGlob(glob) ? [] : [{ index, glob }]));

  if (invalid.length > 0) {
    throw new InvalidRequestError(
      PATH_PREVIEW_GLOB_INVALID,
      "A glob is relative to the repository root — no leading `/`, no `..` segment, no whitespace, at most 256 characters.",
      { invalid },
    );
  }
}

/**
 * The files of a listed tree, sorted — directories are not something a change touches.
 *
 * @param tree - The listing.
 * @returns Each file's path.
 */
export function filesOf(tree: RepoTree): string[] {
  return tree.entries
    .filter((entry) => entry.type === "file")
    .map((entry) => entry.path)
    .sort();
}

/**
 * What each glob covers among a repository's files.
 *
 * @param globs - The patterns, in the caller's order.
 * @param files - The repository's files, sorted.
 * @returns One answer per glob, in the same order.
 */
export function matchGlobs(
  globs: readonly string[],
  files: readonly string[],
): GlobMatchResource[] {
  return globs.map((glob) => {
    const pattern = globToRegExp(glob);
    const matched = files.filter((path) => pattern.test(path));

    return {
      glob,
      matchCount: matched.length,
      samples: matched.slice(0, PATH_PREVIEW_MAX_SAMPLES),
    };
  });
}
