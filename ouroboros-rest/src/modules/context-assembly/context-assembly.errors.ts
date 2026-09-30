/**
 * Context assembly's refusals ([#414](https://github.com/NobuData/ouroboros/issues/414)), each a
 * code `openapi.yaml` publishes.
 */

import { InvalidRequestError, NotFoundError } from "../errors/error.envelope";

/** The codes, as one object. */
export const CONTEXT_ASSEMBLY_ERRORS = {
  /** The scope names a workflow this workspace does not have. */
  workflowNotFound: "context_workflow_not_found",
  /** One skill id is in both halves of the override delta. */
  overridesOverlap: "context_overrides_overlap",
  /** An injection record's references do not fit its consumer. */
  consumerReference: "context_injection_consumer_reference",
  /** An injection record names something that is not this workspace's, or not injectable. */
  unresolved: "context_injection_unresolved",
} as const;

/**
 * `404` — the scope's workflow does not exist here.
 *
 * @param workflow - The slug.
 * @returns The error.
 */
export function workflowNotFound(workflow: string): NotFoundError {
  return new NotFoundError(
    CONTEXT_ASSEMBLY_ERRORS.workflowNotFound,
    `This workspace has no workflow ${workflow}.`,
    { workflow },
  );
}

/**
 * `422` — a skill is both enabled and disabled (V072 keeps the two halves disjoint).
 *
 * @param skillIds - The ids in both.
 * @returns The error.
 */
export function overridesOverlap(skillIds: readonly string[]): InvalidRequestError {
  return new InvalidRequestError(
    CONTEXT_ASSEMBLY_ERRORS.overridesOverlap,
    "A skill cannot be both enabled and disabled by one set of overrides.",
    { skillIds: [...skillIds] },
  );
}

/**
 * `422` — the references do not fit the consumer: an `estimator` names an estimate and nothing
 * else, a `run_stage` names a stage and its run, a `playbook` names the run it launched
 * (V071's `context_injections_consumer_ref`).
 *
 * @param consumer - The consumer.
 * @returns The error.
 */
export function consumerReference(consumer: string): InvalidRequestError {
  return new InvalidRequestError(
    CONTEXT_ASSEMBLY_ERRORS.consumerReference,
    consumer === "estimator"
      ? "An estimator injection names estimateId, and no run or run stage."
      : consumer === "run_stage"
        ? "A run_stage injection names runStageId and its runId, and no estimate."
        : "A playbook injection names the runId it launched, and no estimate or run stage.",
    { consumer },
  );
}

/**
 * `422` — V071's `context_injections_resolves` refused the record: an id is another workspace's,
 * a fact is not confirmed, a skill version is a draft or a draft skill's, or the run stage is not
 * of that run.
 *
 * @returns The error.
 */
export function unresolved(): InvalidRequestError {
  return new InvalidRequestError(
    CONTEXT_ASSEMBLY_ERRORS.unresolved,
    "The injection names an estimate, run, stage, fact or skill version that is not this " +
      "workspace's, or not injectable (only confirmed facts and published versions of " +
      "non-draft skills are).",
  );
}
