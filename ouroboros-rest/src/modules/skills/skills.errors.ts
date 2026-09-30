/**
 * Every refusal the skills service makes, as the envelope carries it (BF.1,
 * [#410](https://github.com/NobuData/ouroboros/issues/410)).
 *
 * The workflow lifecycle's vocabulary (`workflows.errors.ts`) with a skill's nouns, and four
 * refusals of its own:
 *
 *   * **The required lock** — `403 skill_required_locked`, *"required by policy — cannot
 *     disable"*, with `details.reason: "required_by_policy"`. Mockup 14's locked switch renders
 *     this reason; the code is what a client branches on and the reason is what it prints, so the
 *     UI need not own a second copy of the sentence. A `403` rather than a `409`: the caller is
 *     allowed to see the skill and is refused the act, whoever they are — even the owner, who
 *     must lift `required` first.
 *   * **The owner's flag** — `403 skill_required_owner_only`. `required` is the flag that makes a
 *     skill impossible to turn off, so only an owner may set or clear it.
 *   * **The delete guard** — `409 skill_referenced`, naming every published workflow whose
 *     version in force names the skill, so the person knows what to fix.
 *   * **The scope move** — `409 skill_scope_conflict` carrying the preview's clashes, and
 *     `409 skill_scope_preview_stale` when what the caller previewed is no longer what would
 *     happen.
 */

import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  InvalidRequestError,
  NotFoundError,
} from "../errors/error.envelope";
import { isDatabaseFailure } from "../tenancy/constraints";
import type { SkillDocumentIssue } from "./skills.frontmatter";
import type { SkillReference, ScopeClash } from "./skills.resources";

/** The designed reason a locked switch renders — mockup 14's warn tag, word for word. */
export const REQUIRED_LOCK_MESSAGE = "required by policy — cannot disable";

/** The machine-readable reason carried beside {@link REQUIRED_LOCK_MESSAGE}. */
export const REQUIRED_LOCK_REASON = "required_by_policy";

/** Every code this module answers with. */
export const SKILL_ERRORS = {
  skillNotFound: "skill_not_found",
  versionNotFound: "skill_version_not_found",
  slugTaken: "skill_slug_taken",
  slugRequired: "skill_slug_required",
  documentInvalid: "skill_document_invalid",
  draftEtagRequired: "skill_draft_etag_required",
  draftConflict: "skill_draft_conflict",
  draftAbsent: "skill_draft_absent",
  publishConflict: "skill_publish_conflict",
  scopeMismatch: "skill_scope_mismatch",
  requiredLocked: "skill_required_locked",
  requiredOwnerOnly: "skill_required_owner_only",
  requiredDraft: "skill_required_draft",
  unpublished: "skill_unpublished",
  referenced: "skill_referenced",
  scopeInvalid: "skill_scope_invalid",
  scopeConflict: "skill_scope_conflict",
  scopePreviewStale: "skill_scope_preview_stale",
} as const;

/** The V069 constraints this service turns into answers, by name. */
export const SKILL_CONSTRAINTS = {
  slugUnique: "skills_organization_slug_key",
  oneDraft: "skill_versions_one_draft_idx",
  versionUnique: "skill_versions_skill_version_key",
  versionDense: "skill_versions_next_version",
} as const;

/**
 * Whether an error is PostgreSQL refusing a write by a named constraint.
 *
 * @param error - Whatever was thrown.
 * @param constraint - The constraint's name.
 * @returns `true` for that constraint's violation.
 */
export function violates(error: unknown, constraint: string): boolean {
  return isDatabaseFailure(error) && error.constraint === constraint;
}

/**
 * @param slug - The slug asked for.
 * @returns `404 skill_not_found` — absent, or another workspace's, indistinguishably.
 */
export function skillNotFound(slug: string): NotFoundError {
  return new NotFoundError(SKILL_ERRORS.skillNotFound, "No such skill.", { slug });
}

/**
 * @param slug - The skill.
 * @param version - The number asked for.
 * @returns `404 skill_version_not_found`.
 */
export function versionNotFound(slug: string, version: number): NotFoundError {
  return new NotFoundError(SKILL_ERRORS.versionNotFound, "No such version of this skill.", {
    slug,
    version,
  });
}

/**
 * @param slug - The slug that is taken.
 * @returns `409 skill_slug_taken`.
 */
export function slugTaken(slug: string): ConflictError {
  return new ConflictError(
    SKILL_ERRORS.slugTaken,
    "A skill with that slug already exists in this workspace.",
    { slug },
  );
}

/**
 * @param name - The name no slug could be built from.
 * @returns `422 skill_slug_required`.
 */
export function slugRequired(name: string): InvalidRequestError {
  return new InvalidRequestError(
    SKILL_ERRORS.slugRequired,
    "This name has no letters or digits to build a skill slug from. Send `slug` as well.",
    { name },
  );
}

/**
 * @param issues - Every reason the document did not read.
 * @returns `422 skill_document_invalid` — nothing was written.
 */
export function documentInvalid(issues: readonly SkillDocumentIssue[]): InvalidRequestError {
  return new InvalidRequestError(
    SKILL_ERRORS.documentInvalid,
    "This file does not read as a skill, so it was not saved. The draft is unchanged.",
    { issues },
  );
}

/** @returns `400 skill_draft_etag_required` — a missing `If-Match` is not a lost race. */
export function draftEtagRequired(): BadRequestError {
  return new BadRequestError(
    SKILL_ERRORS.draftEtagRequired,
    "Saving a skill draft requires an If-Match header carrying the draft's etag.",
  );
}

/**
 * @param expected - The etag the writer sent.
 * @param current - The etag the draft slot has now.
 * @returns `409 skill_draft_conflict`.
 */
export function draftConflict(expected: string, current: string): ConflictError {
  return new ConflictError(
    SKILL_ERRORS.draftConflict,
    "This skill's draft was changed by someone else. Reload it before saving again.",
    { expected, current },
  );
}

/**
 * @param slug - The skill.
 * @returns `409 skill_draft_absent`.
 */
export function draftAbsent(slug: string): ConflictError {
  return new ConflictError(
    SKILL_ERRORS.draftAbsent,
    "This skill has no draft to publish. Save one first.",
    { slug },
  );
}

/**
 * @param slug - The skill.
 * @returns `409 skill_publish_conflict` — somebody published first.
 */
export function publishConflict(slug: string): ConflictError {
  return new ConflictError(
    SKILL_ERRORS.publishConflict,
    "This skill was published by someone else. Reload it and try again.",
    { slug },
  );
}

/**
 * @param slug - The skill.
 * @param declared - The scope the draft's frontmatter declares.
 * @param actual - The registry row's scope.
 * @returns `422 skill_scope_mismatch` — move the skill, or change what the file says.
 */
export function scopeMismatch(slug: string, declared: string, actual: string): InvalidRequestError {
  return new InvalidRequestError(
    SKILL_ERRORS.scopeMismatch,
    `This draft declares scope ${declared}, but the skill is ${actual}-scoped. Move the skill, or change the frontmatter.`,
    { slug, declared, actual },
  );
}

/**
 * The required lock — the designed refusal mockup 14's locked switch renders.
 *
 * @param slug - The skill.
 * @returns `403 skill_required_locked` with `details.reason` {@link REQUIRED_LOCK_REASON}.
 */
export function requiredLocked(slug: string): ForbiddenError {
  return new ForbiddenError(SKILL_ERRORS.requiredLocked, REQUIRED_LOCK_MESSAGE, {
    slug,
    reason: REQUIRED_LOCK_REASON,
  });
}

/**
 * @param slug - The skill.
 * @param role - The roles the caller holds, comma-separated.
 * @returns `403 skill_required_owner_only`.
 */
export function requiredOwnerOnly(slug: string, role: string): ForbiddenError {
  return new ForbiddenError(
    SKILL_ERRORS.requiredOwnerOnly,
    "Only a workspace owner may change whether a skill is required.",
    { slug, role, requiredRoles: ["owner"] },
  );
}

/**
 * @param slug - The skill.
 * @returns `422 skill_required_draft` — a draft is never injected, so it cannot be always-on.
 */
export function requiredDraft(slug: string): InvalidRequestError {
  return new InvalidRequestError(
    SKILL_ERRORS.requiredDraft,
    "A draft skill cannot be required: a draft is never injected. Promote it out of draft first.",
    { slug },
  );
}

/**
 * @param slug - The skill.
 * @returns `409 skill_unpublished` — promoting out of draft needs a version to inject.
 */
export function unpublished(slug: string): ConflictError {
  return new ConflictError(
    SKILL_ERRORS.unpublished,
    "This skill has no published version yet. Publish one before promoting it out of draft.",
    { slug },
  );
}

/**
 * The delete guard's refusal.
 *
 * @param slug - The skill.
 * @param workflows - Every published workflow whose version in force names it.
 * @returns `409 skill_referenced`, naming them.
 */
export function referenced(slug: string, workflows: readonly SkillReference[]): ConflictError {
  const names = workflows.map((workflow) => workflow.slug).join(", ");

  return new ConflictError(
    SKILL_ERRORS.referenced,
    `This skill is referenced by published workflows (${names}). Remove the references first.`,
    { slug, workflows },
  );
}

/**
 * @param message - What is wrong with the requested scope.
 * @param details - The fields concerned.
 * @returns `422 skill_scope_invalid`.
 */
export function scopeInvalid(
  message: string,
  details: Record<string, unknown>,
): InvalidRequestError {
  return new InvalidRequestError(SKILL_ERRORS.scopeInvalid, message, details);
}

/**
 * @param slug - The skill.
 * @param clashes - What the move collides with.
 * @returns `409 skill_scope_conflict` — resolve explicitly with `resolve: "keep_both"`.
 */
export function scopeConflict(slug: string, clashes: readonly ScopeClash[]): ConflictError {
  return new ConflictError(
    SKILL_ERRORS.scopeConflict,
    "This move collides with a skill of the same name at the destination scope. Send resolve: keep_both to move it anyway.",
    { slug, clashes },
  );
}

/**
 * @param slug - The skill.
 * @param expected - The token the caller previewed.
 * @param current - The token the move has now.
 * @returns `409 skill_scope_preview_stale` — preview again.
 */
export function scopePreviewStale(slug: string, expected: string, current: string): ConflictError {
  return new ConflictError(
    SKILL_ERRORS.scopePreviewStale,
    "What this move would do has changed since it was previewed. Preview it again.",
    { slug, expected, current },
  );
}
