/**
 * Every code the workflow lifecycle API can answer with — P.3
 * ([#134](https://github.com/NobuData/ouroboros/issues/134)).
 *
 * The contract `runs.errors.ts` and `tenancy.errors.ts` keep: the string in `openapi.yaml`
 * and the string in the answer come from one constant, `workflows.errors.spec.ts` holds the
 * two together, and every message is written for a person — no table, no column, and no fact
 * the caller did not already send.
 *
 * Three of them are worth reading as a group, because they are the ticket's own distinctions:
 *
 *   * **{@link workflowNotFound} is `404` for a workflow in another workspace too.** The
 *     repository's org scope cannot tell *absent* from *not yours*, so neither can this, so
 *     neither can a caller — the acceptance criterion as an information-flow property rather
 *     than a check somebody has to remember.
 *   * **{@link draftConflict} is `409`, never a silent overwrite.** A second tab holding a
 *     stale etag is the failure the `If-Match` guard exists for; a `409` is what sends the
 *     studio to its reload dialog with the first tab's edit still in the draft.
 *   * **{@link definitionInvalid} is `422` and carries the findings.** Node-anchored, so the
 *     canvas can select the offending node when somebody clicks one, and raised *before*
 *     anything is written so that a refused publish leaves no version behind.
 */

import {
  BadRequestError,
  ConflictError,
  InvalidRequestError,
  NotFoundError,
} from "../errors/error.envelope";
import { isDatabaseFailure } from "../tenancy/constraints";
import type { PublishFinding } from "./publish.gate";

/** The codes, as one object — see `tenancy.errors.ts` for why `as const` matters. */
export const WORKFLOW_ERRORS = {
  /** No workflow with that id — *or* none this caller may know about. */
  workflowNotFound: "workflow_not_found",
  /** That slug already names a workflow in this workspace. */
  slugTaken: "workflow_slug_taken",
  /** The workflow has no such published version. */
  versionNotFound: "workflow_version_not_found",
  /** A draft write arrived without the `If-Match` the guard is built on. */
  draftEtagRequired: "workflow_draft_etag_required",
  /** The draft moved under this writer — a second tab, or a publish. */
  draftConflict: "workflow_draft_conflict",
  /** There is no draft to publish. */
  draftAbsent: "workflow_draft_absent",
  /** A create carried no slug and its name yields none. */
  slugRequired: "workflow_slug_required",
  /** The definition did not pass the publish gate. */
  definitionInvalid: "workflow_definition_invalid",
  /** Two publishes raced and this one lost the version number. */
  publishConflict: "workflow_publish_conflict",
} as const;

/**
 * `404` — the workflow does not exist for this caller.
 *
 * @param id - The id the request named. Echoed into `details.workflowId` because the caller
 *   sent it and a studio holding several tabs open needs to know which request failed.
 * @returns The error to throw.
 */
export function workflowNotFound(id: string): NotFoundError {
  return new NotFoundError(WORKFLOW_ERRORS.workflowNotFound, "No such workflow.", {
    workflowId: id,
  });
}

/**
 * `404` — the workflow exists and has no version with that number.
 *
 * Distinct from {@link workflowNotFound} on the axis a client acts on: the workflow is
 * readable, and the *number* in `?version=` names nothing — a history link that outlived the
 * version it pointed at, or a number typed by hand. Telling the two apart leaks nothing,
 * because the caller has already been shown the workflow.
 *
 * @param id - The workflow.
 * @param version - The number that named nothing.
 * @returns The error to throw.
 */
export function versionNotFound(id: string, version: number): NotFoundError {
  return new NotFoundError(WORKFLOW_ERRORS.versionNotFound, "No such version of this workflow.", {
    workflowId: id,
    version,
  });
}

/**
 * `409` — that slug is already a workflow in this workspace.
 *
 * `workflows_organization_slug_key` is what actually refuses it, and this is that refusal in
 * the envelope: a `select` first would leave a window two creates could both pass through.
 *
 * @param slug - The slug the request named, or the one derived from its name.
 * @returns The error to throw.
 */
export function slugTaken(slug: string): ConflictError {
  return new ConflictError(
    WORKFLOW_ERRORS.slugTaken,
    "A workflow with that name already exists in this workspace.",
    { slug },
  );
}

/**
 * `400` — a draft write carried no `If-Match`.
 *
 * A `400` rather than a `422`, per `error.envelope.ts`' own distinction: nothing about the
 * body is wrong, and there is no field to name. What is missing is a precondition the request
 * does not carry a field for, and the action is *read the draft and send its etag*.
 *
 * It is deliberately not tolerated. An unconditional autosave is exactly the silent clobber
 * the guard exists to prevent, and a client that could opt out of it by omitting a header
 * would be a client that opted out of it by accident.
 *
 * @returns The error to throw.
 */
export function draftEtagRequired(): BadRequestError {
  return new BadRequestError(
    WORKFLOW_ERRORS.draftEtagRequired,
    "Saving a draft requires an If-Match header carrying the draft's etag.",
  );
}

/**
 * `409` — the draft is not the one this writer read.
 *
 * @param expected - The etag the request sent.
 * @param current - The etag the draft actually has now, when it is known. Published so the
 *   studio can decide whether to reload without a second round trip; it is a digest of a row
 *   this caller may already read, so it discloses nothing the `GET` does not. Omitted where it
 *   genuinely is not known — a draft created concurrently is reported by a unique index,
 *   inside a transaction that cannot then be read from, and inventing a token there would put
 *   a value in the envelope that matches nothing.
 * @returns The error to throw.
 */
export function draftConflict(expected: string, current?: string): ConflictError {
  return new ConflictError(
    WORKFLOW_ERRORS.draftConflict,
    "This draft was changed by someone else. Reload it before saving again.",
    { expected, ...(current === undefined ? {} : { current }) },
  );
}

/**
 * `409` — there is nothing to publish.
 *
 * The state of a workflow whose draft has never been written: `POST /api/v1/workflows`
 * creates one, so reaching this means a workflow that arrived another way — a seed, a direct
 * insert — or a draft deleted out from under the request.
 *
 * @param id - The workflow.
 * @returns The error to throw.
 */
export function draftAbsent(id: string): ConflictError {
  return new ConflictError(
    WORKFLOW_ERRORS.draftAbsent,
    "This workflow has no draft to publish. Save one first.",
    { workflowId: id },
  );
}

/**
 * `422` — the definition did not pass the publish gate, and nothing was written.
 *
 * @param findings - Every finding both validators produced, in the order the gate reports
 *   them. Carried in `details.findings` rather than flattened into the message, because the
 *   studio selects a node from `node` and a message it had to parse would be a message that
 *   breaks when the wording changes.
 * @returns The error to throw.
 */
export function definitionInvalid(findings: readonly PublishFinding[]): InvalidRequestError {
  return new InvalidRequestError(
    WORKFLOW_ERRORS.definitionInvalid,
    "This definition cannot be published yet.",
    { findings },
  );
}

/**
 * `409` — another publish took the version number this one had computed.
 *
 * `workflow_versions_workflow_version_key` and the `workflow_versions_next_version` trigger
 * are what refuse it, and V029 says why the refusal is right: *"two publishers racing both
 * compute max + 1, and the unique key lets one commit, which is a retry a writer must see"*.
 * So it is surfaced rather than retried here — the loser's definition may no longer be the
 * one they meant to publish on top of.
 *
 * @param id - The workflow.
 * @returns The error to throw.
 */
export function publishConflict(id: string): ConflictError {
  return new ConflictError(
    WORKFLOW_ERRORS.publishConflict,
    "This workflow was published by someone else. Reload it and try again.",
    { workflowId: id },
  );
}

/**
 * `422` — this name cannot be folded into a slug, so the caller has to choose one.
 *
 * `slug.ts` derives a slug from a title by lower-casing it and collapsing everything the
 * pattern does not admit; a title written entirely in a script `workflows_slug_format` cannot
 * represent leaves nothing behind. Inventing `workflow-1` for it would hand somebody an
 * identifier with no relationship to what they typed — and the slug is what a stored
 * `workflow_tag` resolves through, so it is not a detail they can ignore later.
 *
 * @param name - The title the request sent, echoed back so a form can say which field.
 * @returns The error to throw.
 */
export function slugRequired(name: string): InvalidRequestError {
  return new InvalidRequestError(
    WORKFLOW_ERRORS.slugRequired,
    "This name has no letters or digits to build a workflow slug from. Send `slug` as well.",
    { name },
  );
}

/**
 * Whether a rejection is one named constraint refusing.
 *
 * `constraints.ts`' `constraintError` maps the *tenancy* tables' rules onto the envelope
 * through one table, which is right there and wrong here: the four rules this module cares
 * about mean different things at different call sites — `workflow_versions_one_draft_idx` is a
 * `409` about a draft when a draft is being created and nothing at all anywhere else — so the
 * mapping belongs at the site that knows which request it is, and this is the predicate that
 * lets it be written as one line.
 *
 * The SQLSTATE is deliberately not part of the question. V029 enforces two of these rules with
 * a unique index (`23505`) and one with a trigger that raises `check_violation` (`23514`), and
 * a caller that had to name the class as well would be restating an implementation detail of
 * the migration in a `catch`.
 *
 * @param error - Whatever a repository's promise rejected with.
 * @param constraint - The constraint's name, exactly as V029 declares it — so the string is
 *   greppable from the SQL, and a renamed constraint stops matching rather than silently
 *   changing an answer.
 * @returns `true` when the driver reported that constraint refusing.
 */
export function violates(error: unknown, constraint: string): boolean {
  return isDatabaseFailure(error) && error.constraint === constraint;
}

/**
 * The constraints V029 declares that this module translates.
 *
 * Named here rather than spelled at each `catch`, so the set is readable in one look and a
 * migration that renames one produces a single failing lookup instead of four silent ones.
 */
export const WORKFLOW_CONSTRAINTS = {
  /** One slug per workspace — the create's `409`. */
  slugUnique: "workflows_organization_slug_key",
  /** At most one draft per workflow — where two start-editing requests meet. */
  oneDraft: "workflow_versions_one_draft_idx",
  /** One version number per workflow, once — where two publishers meet. */
  versionUnique: "workflow_versions_workflow_version_key",
  /** Versions are dense from 1 — the same race, caught a moment earlier by the trigger. */
  versionDense: "workflow_versions_next_version",
} as const;
