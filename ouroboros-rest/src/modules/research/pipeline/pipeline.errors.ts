/**
 * The refusals of the gaps hand-off and the roadmap pipeline (CM.5,
 * [#624](https://github.com/NobuData/ouroboros/issues/624)).
 */

import {
  ConflictError,
  InvalidRequestError,
  NotFoundError,
  UpstreamError,
} from "../../errors/error.envelope";

export const PIPELINE_ERRORS = {
  /** This workspace has no such investigation. `404`. */
  investigationNotFound: "investigation_not_found",
  /** The investigation has no roadmap document yet. `404`. */
  roadmapNotFound: "roadmap_not_found",
  /** The document has no such suggestion. `404`. */
  suggestionNotFound: "roadmap_suggestion_not_found",
  /** The workspace has no such ticket source. `404`. */
  sourceNotFound: "roadmap_source_not_found",
  /** The investigation already has its roadmap document. `409`. */
  roadmapExists: "roadmap_exists",
  /** The suggestion was already applied or dismissed. `409`. */
  suggestionSettled: "roadmap_suggestion_settled",
  /** Someone else changed the document while this request was working on it. `409`. */
  versionConflict: "roadmap_version_conflict",
  /** The workspace routes no model to research work. `409`. */
  noResearcher: "roadmap_no_researcher",
  /** A pipeline skill exists in the workspace but has no published version. `409`. */
  skillUnpublished: "roadmap_skill_unpublished",
  /** The document has no source to project to or file in. `409`. */
  noTarget: "roadmap_target_missing",
  /** The request must say which source — the workspace has none, or more than one. `422`. */
  targetRequired: "roadmap_target_required",
  /** The brief proposes no epic from its gaps. `422`. */
  nothingProposed: "gaps_nothing_proposed",
  /** The skill's answer cannot be stored as a roadmap. `502`. */
  outputInvalid: "roadmap_output_invalid",
  /** The skill could not be run. `502`. */
  skillFailed: "roadmap_skill_failed",
} as const;

/**
 * `404` — the workspace has no such investigation.
 *
 * @param investigationId - The id asked for.
 * @returns The error.
 */
export function investigationNotFound(investigationId: string): NotFoundError {
  return new NotFoundError(
    PIPELINE_ERRORS.investigationNotFound,
    "This workspace has no such investigation.",
    { investigationId },
  );
}

/**
 * `404` — nothing has generated a roadmap from this investigation yet.
 *
 * @param investigation - `RS-124`.
 * @returns The error.
 */
export function roadmapNotFound(investigation: string): NotFoundError {
  return new NotFoundError(
    PIPELINE_ERRORS.roadmapNotFound,
    `${investigation} has no roadmap document yet. Generate one from its brief first.`,
    { investigation },
  );
}

/**
 * `404` — the document has no such suggestion.
 *
 * @param suggestionId - The id asked for.
 * @returns The error.
 */
export function suggestionNotFound(suggestionId: string): NotFoundError {
  return new NotFoundError(
    PIPELINE_ERRORS.suggestionNotFound,
    "This roadmap has no such suggestion.",
    { suggestionId },
  );
}

/**
 * `404` — the workspace has no such ticket source.
 *
 * @param sourceId - The id asked for.
 * @returns The error.
 */
export function sourceNotFound(sourceId: string): NotFoundError {
  return new NotFoundError(
    PIPELINE_ERRORS.sourceNotFound,
    "This workspace has no such ticket source.",
    { sourceId },
  );
}

/**
 * `409` — an investigation produces one roadmap.
 *
 * @param investigation - `RS-124`.
 * @returns The error.
 */
export function roadmapExists(investigation: string): ConflictError {
  return new ConflictError(
    PIPELINE_ERRORS.roadmapExists,
    `${investigation} already has a roadmap document. Suggest a change and apply it to regenerate.`,
    { investigation },
  );
}

/**
 * `409` — a suggestion is settled once.
 *
 * @param suggestionId - The suggestion.
 * @param status - `applied` or `dismissed`.
 * @returns The error.
 */
export function suggestionSettled(suggestionId: string, status: string): ConflictError {
  return new ConflictError(
    PIPELINE_ERRORS.suggestionSettled,
    `This suggestion was already ${status}.`,
    { suggestionId, status },
  );
}

/**
 * `409` — the document moved under this request.
 *
 * @param docId - The document.
 * @returns The error.
 */
export function versionConflict(docId: string): ConflictError {
  return new ConflictError(
    PIPELINE_ERRORS.versionConflict,
    "The roadmap changed while this was being worked on. Read it again and retry.",
    { docId },
  );
}

/**
 * `409` — nothing is routed to research, so no model can follow the skill.
 *
 * @returns The error.
 */
export function noResearcher(): ConflictError {
  return new ConflictError(
    PIPELINE_ERRORS.noResearcher,
    "No model is routed to research work in this workspace, so the skill cannot be run.",
  );
}

/**
 * `409` — the workspace's copy of a pipeline skill has never been published.
 *
 * @param slug - `create-roadmap` or `create-issues`.
 * @returns The error.
 */
export function skillUnpublished(slug: string): ConflictError {
  return new ConflictError(
    PIPELINE_ERRORS.skillUnpublished,
    `The ${slug} skill has no published version. Publish it on the Knowledge page first.`,
    { slug },
  );
}

/**
 * `409` — the document's source was removed.
 *
 * @returns The error.
 */
export function noTarget(): ConflictError {
  return new ConflictError(
    PIPELINE_ERRORS.noTarget,
    "This roadmap's ticket source was removed, so there is nowhere to file its issues.",
  );
}

/**
 * `422` — the request has to name the source.
 *
 * @param candidates - How many sources the workspace has.
 * @returns The error.
 */
export function targetRequired(candidates: number): InvalidRequestError {
  return new InvalidRequestError(
    PIPELINE_ERRORS.targetRequired,
    candidates === 0
      ? "This workspace has no ticket source. Connect one first."
      : "This workspace has more than one ticket source. Say which one with targetSourceId.",
    { candidates },
  );
}

/**
 * `422` — the brief's matrix has no HIGH or MED gap to draft from.
 *
 * @param investigation - `RS-127`.
 * @returns The error.
 */
export function nothingProposed(investigation: string): InvalidRequestError {
  return new InvalidRequestError(
    PIPELINE_ERRORS.nothingProposed,
    `${investigation}'s brief proposes nothing from its gaps, so there is no epic to draft.`,
    { investigation },
  );
}

/**
 * `502` — the skill answered something that cannot be a roadmap.
 *
 * @param problems - What is wrong, one sentence each.
 * @returns The error.
 */
export function outputInvalid(problems: readonly string[]): UpstreamError {
  return new UpstreamError(
    PIPELINE_ERRORS.outputInvalid,
    "The skill's answer cannot be stored as a roadmap. Nothing was changed.",
    { problems: [...problems] },
  );
}

/**
 * `502` — the skill could not be run to an answer.
 *
 * @param slug - The skill.
 * @param reason - The engine's code — `gateway_unavailable`, `skill_output_invalid`, ….
 * @param message - The engine's sentence.
 * @returns The error.
 */
export function skillFailed(slug: string, reason: string, message: string): UpstreamError {
  return new UpstreamError(
    PIPELINE_ERRORS.skillFailed,
    `The ${slug} skill could not be run: ${message} Nothing was changed.`,
    { slug, reason },
  );
}
