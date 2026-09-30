/**
 * The playbooks service's refusals (BF.6, [#415](https://github.com/NobuData/ouroboros/issues/415)),
 * each a code `openapi.yaml` publishes.
 *
 * A launch also answers every refusal of the queue write it composes (`queue_issues_*`,
 * `queue_workflow_unknown` — `backlog/queue.errors.ts`): a playbook launch is refused exactly as
 * queueing the same issue would be.
 */

import { ConflictError, InvalidRequestError, NotFoundError } from "../errors/error.envelope";

/** The codes, as one object. */
export const PLAYBOOK_ERRORS = {
  /** No playbook by that id in this workspace. */
  notFound: "playbook_not_found",
  /** Another playbook of this workspace has that name. */
  nameTaken: "playbook_name_taken",
  /** The workflow slug names no workflow of this workspace. */
  workflowNotFound: "playbook_workflow_not_found",
  /** The version is not a published version of that workflow. */
  versionNotPublished: "playbook_workflow_version_not_published",
  /** One skill id is in both halves of the override delta. */
  overridesOverlap: "playbook_overrides_overlap",
  /** A skill or fact is not this workspace's, or a required skill is disabled. */
  referenceUnresolved: "playbook_reference_unresolved",
  /** No run by that id in this workspace. */
  runNotFound: "playbook_run_not_found",
  /** The run has not reached a terminal status. */
  runNotTerminal: "playbook_run_not_terminal",
  /** The run has no pin a playbook could copy. */
  runUnpinned: "playbook_run_unpinned",
  /** No issue by that id in this workspace. */
  issueNotFound: "playbook_issue_not_found",
  /** The playbook's issue filter does not admit that issue. */
  issueFiltered: "playbook_issue_filtered",
} as const;

/** V072's constraint and trigger names, as the service catches them (`violatesConstraint`). */
export const PLAYBOOK_CONSTRAINTS = {
  /** `unique (organization_id, name)`. */
  nameUnique: "playbooks_organization_name_key",
  /** The BEFORE trigger holding every skill and fact id to the workspace. */
  refsResolve: "playbooks_refs_resolve",
} as const;

/**
 * `404` — no such playbook here (another workspace's reads the same).
 *
 * @param id - The id asked for.
 * @returns The error.
 */
export function playbookNotFound(id: string): NotFoundError {
  return new NotFoundError(PLAYBOOK_ERRORS.notFound, "This workspace has no such playbook.", {
    id,
  });
}

/**
 * `409` — the name is another playbook's.
 *
 * @param name - The name.
 * @returns The error.
 */
export function nameTaken(name: string): ConflictError {
  return new ConflictError(
    PLAYBOOK_ERRORS.nameTaken,
    `This workspace already has a playbook named ${name}.`,
    { name },
  );
}

/**
 * `422` — the workflow does not exist here.
 *
 * @param workflow - The slug.
 * @returns The error.
 */
export function workflowNotFound(workflow: string): InvalidRequestError {
  return new InvalidRequestError(
    PLAYBOOK_ERRORS.workflowNotFound,
    `This workspace has no workflow ${workflow}.`,
    { workflow },
  );
}

/**
 * `422` — a playbook pins a published version, never a draft or a number that was never published.
 *
 * @param workflow - The slug.
 * @param version - The version asked for.
 * @returns The error.
 */
export function versionNotPublished(workflow: string, version: number): InvalidRequestError {
  return new InvalidRequestError(
    PLAYBOOK_ERRORS.versionNotPublished,
    `${workflow} has no published version ${version} to pin.`,
    { workflow, version },
  );
}

/**
 * `422` — a skill is both enabled and disabled.
 *
 * @param skillIds - The ids in both.
 * @returns The error.
 */
export function overridesOverlap(skillIds: readonly string[]): InvalidRequestError {
  return new InvalidRequestError(
    PLAYBOOK_ERRORS.overridesOverlap,
    "A skill cannot be both enabled and disabled by one playbook.",
    { skillIds: [...skillIds] },
  );
}

/**
 * `422` — V072's `playbooks_refs_resolve` refused: a skill or fact id is not this workspace's, or
 * a required skill was disabled.
 *
 * @returns The error.
 */
export function referenceUnresolved(): InvalidRequestError {
  return new InvalidRequestError(
    PLAYBOOK_ERRORS.referenceUnresolved,
    "The overrides or preset name a skill or fact that is not this workspace's, or disable a " +
      "required skill.",
  );
}

/**
 * `404` — no such run here.
 *
 * @param runId - The run.
 * @returns The error.
 */
export function runNotFound(runId: string): NotFoundError {
  return new NotFoundError(PLAYBOOK_ERRORS.runNotFound, "This workspace has no such run.", {
    runId,
  });
}

/**
 * `409` — a recipe is learned from a run that finished; one still going has not shown what went well.
 *
 * @param runId - The run.
 * @param status - Its status.
 * @returns The error.
 */
export function runNotTerminal(runId: string, status: string): ConflictError {
  return new ConflictError(
    PLAYBOOK_ERRORS.runNotTerminal,
    "A playbook is created from a run that has finished.",
    { runId, status },
  );
}

/**
 * `422` — the run carries no pin (a row predating pinning), or its workflow is gone.
 *
 * @param runId - The run.
 * @param workflow - Its workflow tag.
 * @returns The error.
 */
export function runUnpinned(runId: string, workflow: string): InvalidRequestError {
  return new InvalidRequestError(
    PLAYBOOK_ERRORS.runUnpinned,
    "The run has no published workflow version a playbook could pin.",
    { runId, workflow },
  );
}

/**
 * `404` — no such issue here.
 *
 * @param issueId - The issue.
 * @returns The error.
 */
export function issueNotFound(issueId: string): NotFoundError {
  return new NotFoundError(PLAYBOOK_ERRORS.issueNotFound, "This workspace has no such issue.", {
    issueId,
  });
}

/**
 * `422` — the playbook's issue filter does not admit the issue; the picker would not have offered it.
 *
 * @param issueId - The issue.
 * @returns The error.
 */
export function issueFiltered(issueId: string): InvalidRequestError {
  return new InvalidRequestError(
    PLAYBOOK_ERRORS.issueFiltered,
    "This playbook's issue filter does not admit that issue.",
    { issueId },
  );
}
