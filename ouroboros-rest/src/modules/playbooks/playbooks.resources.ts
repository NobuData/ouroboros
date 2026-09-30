/**
 * What the playbooks routes answer (BF.6, [#415](https://github.com/NobuData/ouroboros/issues/415)),
 * and the pure mappers from rows to them.
 *
 * **`runCount` is counted, never stored.** It is `count(*)` of `runs.playbook_id` (V072's
 * `runs_playbook_idx`) read with the row — the card's `run 9×`. A queued launch is not a run until
 * one opens for it, so it does not count yet.
 */

import type { ContextManifest } from "../context-assembly/context-assembly.resources";
import type { QueueItemSummary } from "../dashboard/resources";
import type { SizingStatus } from "../db/schema";
import {
  readFilter,
  readOverrides,
  readPreset,
  type PlaybookIssueFilter,
  type PlaybookOverrides,
  type PlaybookPreset,
} from "./playbooks.derive";

/** The pinned workflow — `standard-fix@v14`. */
export interface PlaybookWorkflowResource {
  readonly id: string;
  readonly slug: string;
  readonly version: number;
}

/** One recipe, as the card draws it. */
export interface PlaybookResource {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly workflow: PlaybookWorkflowResource;
  readonly skillOverrides: PlaybookOverrides;
  readonly contextPreset: PlaybookPreset;
  /** `null` offers the playbook for every issue. */
  readonly issueFilter: PlaybookIssueFilter | null;
  /** The run it was created from; `null` for a hand-authored recipe or a deleted run. */
  readonly sourceRunId: string | null;
  /** `run 9×` — the runs launched through it, counted. */
  readonly runCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** The card: every recipe by name — `3 recipes` is `items.length`. */
export interface PlaybookList {
  readonly items: readonly PlaybookResource[];
}

/** One playbook's launch count. */
export interface PlaybookCount {
  readonly playbookId: string;
  readonly runs: number;
}

/** Every playbook's launch count, derived from the runs that carry its id. */
export interface PlaybookCounts {
  readonly counts: readonly PlaybookCount[];
}

/** What create-from-run captured from a run — the recipe before a person names it. */
export interface PlaybookDraftResource {
  readonly sourceRunId: string;
  /** The run's `Loop #1791`. */
  readonly sourceLoopSeq: number;
  readonly workflow: PlaybookWorkflowResource;
  readonly skillOverrides: PlaybookOverrides;
  readonly contextPreset: PlaybookPreset;
  /** Where each part came from, so the form can say it. */
  readonly derivedFrom: {
    /** `owner/name` of the run's repository — the scope overrides were derived against. */
    readonly repo: string;
    /** How many injection records the run has; `0` derives no overrides. */
    readonly injections: number;
    /** How many steers the run carried before de-duplication and bounds. */
    readonly steers: number;
  };
  /** A description to start from: the run it was learned from. */
  readonly suggestedDescription: string;
}

/** The context a launch attaches: assembly with the playbook's overrides, plus its preset. */
export interface PlaybookContextResource {
  /** The manifest the `playbook` consumer receives for this scope with the overrides applied. */
  readonly manifest: ContextManifest;
  /** The steer notes the preset carries into the run. */
  readonly steerNotes: readonly string[];
  /** The preset's extra facts, by id. */
  readonly factIds: readonly string[];
}

/** One issue *Run on issue… ▾* offers. */
export interface PlaybookIssueCandidate {
  /** `github_issues.id` — what `launch` takes. */
  readonly id: string;
  readonly number: number;
  readonly title: string;
  /** `owner/name`. */
  readonly repo: string;
  readonly labels: readonly string[];
  readonly sizingStatus: SizingStatus;
  /** Whether the queue already holds it — a launch would be refused `409`. */
  readonly queued: boolean;
}

/** The picker's list, narrowed by the playbook's filter. */
export interface PlaybookIssueList {
  readonly items: readonly PlaybookIssueCandidate[];
}

/** The receipt a launch answers, so the UI can confirm it happened and link to it. */
export interface PlaybookLaunchReceipt {
  readonly playbookId: string;
  /** The queued item, in the queue's own shape — the dashboard card draws the same thing. */
  readonly item: QueueItemSummary;
  /** Its place in the queue; `1` is next. */
  readonly position: number;
  /** The context the launch attaches for the issue's repository. */
  readonly context: PlaybookContextResource;
  /** Where to look next — relative API paths. */
  readonly links: {
    readonly queue: string;
    readonly playbook: string;
    readonly issue: string;
  };
}

/** A playbook row with its workflow slug and its counted launches. */
export interface PlaybookRow {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly workflow_id: string;
  readonly workflow_slug: string;
  readonly workflow_version: number;
  readonly skill_overrides: unknown;
  readonly context_preset: unknown;
  readonly issue_filter: unknown;
  readonly source_run_id: string | null;
  readonly run_count: string | number;
  readonly created_at: Date;
  readonly updated_at: Date;
}

/**
 * One row, as the API publishes it.
 *
 * @param row - The row, its workflow's slug and its launch count.
 * @returns The resource.
 */
export function playbookResource(row: PlaybookRow): PlaybookResource {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    workflow: { id: row.workflow_id, slug: row.workflow_slug, version: row.workflow_version },
    skillOverrides: readOverrides(row.skill_overrides),
    contextPreset: readPreset(row.context_preset),
    issueFilter: readFilter(row.issue_filter),
    sourceRunId: row.source_run_id,
    runCount: Number(row.run_count),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/**
 * The description a recipe learned from a run starts with.
 *
 * @param loopSeq - The run's loop number.
 * @param issueNumber - Its issue.
 * @param issueTitle - The issue's title as the run froze it.
 * @returns At most 300 characters — V072's bound.
 */
export function suggestedDescription(
  loopSeq: number,
  issueNumber: number,
  issueTitle: string,
): string {
  return `Learned from Loop #${loopSeq} (#${issueNumber} ${issueTitle})`.slice(0, 300);
}

/**
 * The relative API paths a receipt links to.
 *
 * @param playbookId - The playbook.
 * @param issueId - The issue queued.
 * @returns The links.
 */
export function launchLinks(playbookId: string, issueId: string): PlaybookLaunchReceipt["links"] {
  return {
    queue: "/api/v1/queue",
    playbook: `/api/v1/knowledge/playbooks/${playbookId}`,
    issue: `/api/v1/backlog/${issueId}`,
  };
}
