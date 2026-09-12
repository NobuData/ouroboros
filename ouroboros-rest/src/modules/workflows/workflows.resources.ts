/**
 * What a workflow looks like on the wire — P.3
 * ([#134](https://github.com/NobuData/ouroboros/issues/134)).
 *
 * ```
 * WorkflowStats      the rail entry — P.4's, and this API does not define a second one
 * WorkflowSummary    the entity: id, slug, name, status, the v14 chip, the two stamps
 * WorkflowDraft      the draft slot: its etag, and the document when there is one
 * WorkflowDetail     a summary, the draft slot, and the one version the request asked for
 * WorkflowVersion    one published version, document and all
 * VersionSummary     one row of the history, deliberately without its document
 * ```
 *
 * ---------------------------------------------------------------------------
 * ## The rail's shape is P.4's, imported rather than restated
 *
 * `GET /api/v1/workflows` answers `WorkflowStats` — `stats.resources.ts`' shape, produced by
 * `WorkflowStatsService`, which is exactly what `workflows.module.ts` says the export exists
 * for: *"publishing a second listing here would be two answers to what is on the rail"*. So
 * there is no `WorkflowListEntry` in this file, and the caption a client renders under a name
 * is the one P.4 composed.
 *
 * ## The draft slot always has an etag, and sometimes has a document
 *
 * `draft.definition` is `null` for a workflow with no draft row, and `draft.etag` is
 * `draft.etag.ts`' {@link NO_DRAFT} in that case rather than being absent. A client therefore
 * writes the same three lines whether or not a draft exists — read, edit, `If-Match` — which is
 * the whole reason the empty state was given an etag instead of a special case.
 *
 * ## A version's document travels on the detail and never on the history
 *
 * A definition carries a prompt template per model stage, so a history page that inlined them
 * would move megabytes to render a list of dates. `GET /api/v1/workflows/{id}/versions` is
 * numbers, notes and stamps; `GET /api/v1/workflows/{id}?version=14` is the document.
 */

import type { Workflow, WorkflowStatus, WorkflowVersion } from "../db/schema";
import { draftEtag } from "./draft.etag";
import type { PublishedVersionRow } from "./workflows.repository";

/** One workflow's entity — the page head's title, chip and status, without its document. */
export interface WorkflowSummary {
  /** `workflows.id`. */
  readonly id: string;
  /** The slug — what a stored `workflow_tag` resolves through, and what the assign menu sends. */
  readonly slug: string;
  /** The human title the rail and the page head print. */
  readonly name: string;
  /** `active`, `paused` — the rail's err-dot — or `archived`, the soft delete. */
  readonly status: WorkflowStatus;
  /** The `v14` chip's number, or `null` for a workflow that has only ever had a draft. */
  readonly currentVersion: number | null;
  /** When the workflow was created. */
  readonly createdAt: string;
  /** When the entity last changed — a rename or a status change, not a draft edit. */
  readonly updatedAt: string;
}

/** The one mutable document a workflow has, and the token that guards writing it. */
export interface WorkflowDraft {
  /**
   * The etag to send back as `If-Match` on the next save.
   *
   * Always present, including for a workflow with no draft at all — see this file's header.
   * Opaque: compare it for equality and nothing else.
   */
  readonly etag: string;
  /**
   * The stored document, or `null` when this workflow has no draft.
   *
   * Typed `unknown` rather than `unknown | null`, which is the same type: the column's own
   * constraint promises no more than *a JSON object*, so every reader parses before it
   * programs against one. The `null` is in the documentation and in the schema
   * (`WorkflowDraft` in `openapi.yaml`), where a client can act on it.
   */
  readonly definition: unknown;
  /** The mockup's *Last edited*, or `null` when there is no draft. */
  readonly updatedAt: string | null;
}

/** One published, immutable version — document and all. */
export interface WorkflowVersionResource {
  /** The version number. Dense from 1, and never reused. */
  readonly version: number;
  /** The frozen document. */
  readonly definition: unknown;
  /** What changed, in the publisher's words, or `null`. */
  readonly changeNote: string | null;
  /** When it was published. */
  readonly publishedAt: string;
  /** Who published it — `"user"."id"` — or `null` once that person has been deleted. */
  readonly publishedBy: string | null;
}

/** One row of the history — everything but the document. */
export interface WorkflowVersionSummary {
  /** The version number. */
  readonly version: number;
  /** What changed, in the publisher's words, or `null`. */
  readonly changeNote: string | null;
  /** When it was published. */
  readonly publishedAt: string;
  /** Who published it, or `null` once that person has been deleted. */
  readonly publishedBy: string | null;
  /**
   * Whether this is the version in force — the `v14` chip.
   *
   * Computed against `workflows.current_version` rather than against `max(version)`, because
   * V029 is emphatic that the pointer is a pointer: a workflow can carry several published
   * versions while an older one runs, and a history that marked the newest would be marking
   * the wrong row.
   */
  readonly isCurrent: boolean;
}

/** A workflow, its draft slot, and the one version the request asked to see. */
export interface WorkflowDetail extends WorkflowSummary {
  /** The draft slot — always present, sometimes empty. */
  readonly draft: WorkflowDraft;
  /**
   * The version the request named, or the one in force when it named none.
   *
   * `null` for a workflow that has never been published, and `null` is not an error: it is the
   * state **+ New workflow** leaves behind, and what the canvas opens on is `draft.definition`.
   */
  readonly version: WorkflowVersionResource | null;
}

/**
 * One workflow row, as the wire carries it.
 *
 * @param row - The entity, from the repository.
 * @returns The summary.
 */
export function workflowSummary(row: Workflow): WorkflowSummary {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    status: row.status,
    currentVersion: row.current_version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/**
 * The draft slot, as the wire carries it.
 *
 * @param draft - The draft row, or `undefined` when the workflow has none.
 * @returns The slot. Its `etag` is computed by `draft.etag.ts` from the same row the document
 *   came from, so the token a client is handed and the token the next write is checked against
 *   are derived from one read.
 */
export function workflowDraft(draft: WorkflowVersion | undefined): WorkflowDraft {
  return {
    etag: draftEtag(draft),
    definition: draft === undefined ? null : draft.definition,
    updatedAt: draft === undefined ? null : draft.updated_at.toISOString(),
  };
}

/**
 * One published version, document and all.
 *
 * @param row - The version row. Its `version` and `published_at` are non-null by
 *   `workflow_versions_version_publish_stamp`; a draft reaching here would be a caller that
 *   read the wrong row, which the narrowing below turns into a failure rather than a `null` on
 *   the wire.
 * @returns The resource.
 * @throws {Error} When the row is a draft. A programming mistake, not a request's.
 */
export function workflowVersion(row: WorkflowVersion): WorkflowVersionResource {
  if (row.version === null || row.published_at === null) {
    throw new Error(
      `workflow_versions row ${row.id} is a draft and cannot be rendered as a version. ` +
        "Read it through the draft slot instead — see workflows.resources.ts.",
    );
  }

  return {
    version: row.version,
    definition: row.definition,
    changeNote: row.change_note,
    publishedAt: row.published_at.toISOString(),
    publishedBy: row.published_by,
  };
}

/**
 * One row of the history.
 *
 * @param row - The published columns, without the document.
 * @param currentVersion - `workflows.current_version`, for {@link WorkflowVersionSummary.isCurrent}.
 * @returns The summary.
 */
export function workflowVersionSummary(
  row: PublishedVersionRow,
  currentVersion: number | null,
): WorkflowVersionSummary {
  return {
    version: row.version,
    changeNote: row.change_note,
    publishedAt: row.published_at.toISOString(),
    publishedBy: row.published_by,
    isCurrent: row.version === currentVersion,
  };
}

/**
 * A workflow with its draft slot and one version.
 *
 * @param row - The entity.
 * @param draft - The draft row, or `undefined`.
 * @param version - The version to carry, or `undefined` when there is none to show.
 * @returns The detail.
 */
export function workflowDetail(
  row: Workflow,
  draft: WorkflowVersion | undefined,
  version: WorkflowVersion | undefined,
): WorkflowDetail {
  return {
    ...workflowSummary(row),
    draft: workflowDraft(draft),
    version: version === undefined ? null : workflowVersion(version),
  };
}
