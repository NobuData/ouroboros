/**
 * What #160's four execution routes answer — in snake_case, as `run-execution.dto.ts` argues:
 * this is the contract the engine's interpreter was written against field for field.
 *
 * Plain interfaces with a mapper each, like `ingest.resources.ts`, so a column added to `runs`
 * never reaches the engine by accident.
 */

import type { CodeRepositoryRef } from "../engine/engine.code.contract";
import type { QueueEffort, RunStatus } from "../db/schema";

/** The pinned workflow, as stored. */
export interface ExecutionWorkflowResource {
  /** The workflow's slug — `runs.workflow_tag`. */
  readonly tag: string;
  /** The pinned version — `runs.workflow_version_pin`. */
  readonly version: number;
  /** The pinned version's DSL document, exactly as `workflow_versions.definition` holds it. */
  readonly document: unknown;
}

/** The run's repository, and how the engine fetches it for this call. */
export interface ExecutionRepositoryResource {
  /** `github_repos.id`. */
  readonly id: string;
  /** `owner/name`. */
  readonly slug: string;
  /** The default branch, or `null` when it is not known. */
  readonly default_branch: string | null;
  /**
   * `CodeWorkspace.repositoryRef`'s answer: the workspace, the slug, the clone URL and the
   * workspace's GitHub token opened for this call (or `null` for a workspace without one). The
   * token is never stored by this service or the engine.
   */
  readonly ref: CodeRepositoryRef;
}

/** One imported acceptance criterion of the run's issue (#1308). */
export interface ExecutionCriterionResource {
  /** `pr_criteria.id`. */
  readonly id: string;
  /** The quoted claim. */
  readonly text: string;
}

/** Who started a run (#1310): what a `Co-authored-by` trailer is written from. */
export interface ExecutionStarterResource {
  /** `user.name`. */
  readonly name: string;
  /** `user.email`. */
  readonly email: string;
}

/** `POST /internal/runs/:id/start` → `200`. */
export interface RunStartedResource {
  readonly run_id: string;
  /** The epoch this start took — every later write carries it. */
  readonly epoch: number;
  readonly organization_id: string;
  readonly issue_number: number;
  readonly issue_title: string;
  /** The canonical ticket's body, or `null`. */
  readonly issue_body: string | null;
  /**
   * The canonical ticket's labels, `[]` when it has none — a fact workflow decision predicates
   * (`labels`) are judged on.
   */
  readonly labels: string[];
  /**
   * The issue's current size estimate — its latest `issue_estimates` effort, the chip the
   * backlog and queue show — or `null` when it was never sized. Judged by `effort` predicates.
   */
  readonly effort: QueueEffort | null;
  /**
   * The issue's imported acceptance criteria (AX.3's `pr_criteria`, #359) in their stored order,
   * `[]` when none — handed to the model as untrusted data, never as instructions (#1308).
   */
  readonly acceptance_criteria: ExecutionCriterionResource[];
  /** `runs.model`, as the run was opened with it. */
  readonly model: string;
  /**
   * The person who started the run (`runs.started_by`, V151, #1310) — named as the co-author of
   * the run's commits — or `null` when no person did.
   */
  readonly started_by: ExecutionStarterResource | null;
  /** `runs.branch_name` — `ouro/run-<id>-<issue>` unless the run was opened with one. */
  readonly branch_name: string;
  readonly workflow: ExecutionWorkflowResource;
  readonly repository: ExecutionRepositoryResource;
  /** The workspace's effective protected-path globs; empty when nothing is protected. */
  readonly protected_paths: string[];
  /** `runs.exec_base_commit`, or `null` before the first checkpoint named one. */
  readonly base_commit: string | null;
  /** `runs.exec_checkpoint`, or `null` before the first checkpoint. */
  readonly checkpoint: Record<string, unknown> | null;
  /** `coding` or `building`. */
  readonly status: RunStatus;
}

/** `POST /internal/runs/:id/heartbeat` → `200`. */
export interface HeartbeatResource {
  readonly epoch: number;
  /** ISO 8601, by the database's clock. */
  readonly heartbeat_at: string;
}

/** `PUT /internal/runs/:id/checkpoint` → `200`. */
export interface CheckpointSavedResource {
  /** ISO 8601, by the database's clock. */
  readonly checkpoint_at: string;
}

/** `POST /internal/runs/:id/finish` → `200`. */
export interface RunFinishedResource {
  readonly run_id: string;
  /** `review`, `needs_human` or `failed`. */
  readonly status: RunStatus;
  /** The queue item a `back_to_queue` finish wrote; `null` otherwise, or when already queued. */
  readonly requeued_queue_item_id: string | null;
}
