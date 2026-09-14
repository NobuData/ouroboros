/**
 * What the code view looks like on the wire — U.3
 * ([#167](https://github.com/NobuData/ouroboros/issues/167)).
 *
 * ```
 * WorkflowCode          one workflow as a file: its text, the draft's etag, whether it is editable
 * WorkflowCodeTree      the explorer: every file the project has, and nothing it does not
 * WorkflowCodeConfig    ouroboros.config.ts, read-only and printed from the registry
 * WorkflowCodeIssue     one reason a saved file was refused, where an editor underlines it
 * ```
 *
 * ---------------------------------------------------------------------------
 * ## One draft, two editors
 *
 * `WorkflowCode.etag` is the draft slot's etag, the same token `GET /api/v1/workflows/{id}` hands
 * the canvas (decision **C3**). A save in either editor moves it, so a stale save in the other is
 * a `409` rather than a second draft.
 *
 * ## The tree is what exists
 *
 * Decision **C6**: one `workflows/<slug>.loop.ts` per workflow on the rail, and
 * `ouroboros.config.ts`. **Directories are not entries.** A client groups files by the directory
 * in their `path`, so an empty directory cannot be served at all, and mockup 05's `skills/` and
 * `lib/` appear on the day a file under them does (X.2, #181) rather than as placeholders now.
 *
 * ## The outline and the checks are referenced, not yet served
 *
 * `outlineRef` and `checksRef` are where the outline and the Loop Checks payloads will be read
 * from. W.2 ([#178](https://github.com/NobuData/ouroboros/issues/178)) serves both, and until it
 * does both are `null`: a reference to a route that answers `404` would be a promise the page
 * cannot keep.
 */

import type { Workflow, WorkflowStatus } from "../db/schema";
import type { CodeRange, WorkflowCodeErrorCode } from "./code.errors";
import type { WorkflowRegistryRow } from "./stats.repository";

/** The directory the workflow files live in. */
export const WORKFLOW_FILE_DIRECTORY = "workflows";

/** What a workflow file's name ends with — mockup 05's `standard-fix.loop.ts`. */
export const WORKFLOW_FILE_SUFFIX = ".loop.ts";

/** The read-only projection of the workspace's workflow configuration. */
export const CONFIG_FILE_PATH = "ouroboros.config.ts";

/**
 * The code a save reports when the file's `defineLoop` names another workflow.
 *
 * Not one of the parser's codes: the file reads fine, and what is wrong is that it is being saved
 * as a different workflow. The slug names the entity and cannot be changed (`PATCH` refuses it),
 * so a renamed `defineLoop("…")` is refused where it is written rather than ignored.
 */
export const CODE_SLUG_MISMATCH = "code_slug_mismatch";

/** One reason a saved file was refused, anchored where an editor underlines it. */
export interface WorkflowCodeIssue extends CodeRange {
  /** One of the parser's three codes, or {@link CODE_SLUG_MISMATCH}. */
  code: WorkflowCodeErrorCode | typeof CODE_SLUG_MISMATCH;
  /** What a person should read. */
  message: string;
  /** Where support for the construct would come from. Present on `code_out_of_grammar` only. */
  hint?: string;
}

/** One workflow as a file of the code view. */
export interface WorkflowCode {
  /** Where the file sits in the virtual project — `workflows/standard-fix.loop.ts`. */
  readonly path: string;
  /** The workflow's slug, which `defineLoop` names. */
  readonly slug: string;
  /** The file. */
  readonly text: string;
  /**
   * The draft slot's etag — the `If-Match` of the next save, from either editor.
   *
   * The draft's whichever version the text was printed from, so a person reading history still
   * holds the token their next save needs. Opaque: compare it for equality and nothing else.
   */
  readonly etag: string;
  /** `true` for a published version, which nothing edits; `false` for the draft. */
  readonly readOnly: boolean;
  /**
   * The published version the text was printed from, or `null` when it was printed from the draft.
   *
   * A workflow with no draft opens on the version in force, editable, exactly as the canvas does;
   * its first save creates the draft.
   */
  readonly version: number | null;
  /** The version in force — the `v14` chip — or `null` for a workflow that has published nothing. */
  readonly currentVersion: number | null;
  /** Where the outline payload is read from. `null` until W.2 (#178) serves it. */
  readonly outlineRef: string | null;
  /** Where the Loop Checks payload is read from. `null` until W.2 (#178) serves it. */
  readonly checksRef: string | null;
}

/** What a file of the explorer is. */
export type WorkflowCodeFileKind = "workflow" | "config";

/** One file of the explorer. */
export interface WorkflowCodeTreeFile {
  /** Where it sits — `workflows/hotfix-p0.loop.ts`, `ouroboros.config.ts`. */
  readonly path: string;
  /** A workflow's file, or the configuration projection. */
  readonly kind: WorkflowCodeFileKind;
  /** Whether a save is refused. `true` for the configuration and nothing else. */
  readonly readOnly: boolean;
  /** The workflow's slug — its `GET …/{slug}/code` — or `null` for the configuration. */
  readonly slug: string | null;
  /** `active`, or `paused` for the rail's err-dot; `null` for the configuration. */
  readonly status: WorkflowStatus | null;
}

/** The explorer. */
export interface WorkflowCodeTree {
  /** The workflows in the rail's order, then `ouroboros.config.ts`. */
  readonly files: readonly WorkflowCodeTreeFile[];
}

/** `ouroboros.config.ts`, as the code view opens it. */
export interface WorkflowCodeConfig {
  /** {@link CONFIG_FILE_PATH}. */
  readonly path: string;
  /** The file. */
  readonly text: string;
  /** Always `true`: a `PUT` is a `405`. */
  readonly readOnly: true;
}

/** What {@link workflowCode} is told beyond the workflow row. */
export interface ProjectedFile {
  /** The file, from `code.projection.ts`. */
  readonly text: string;
  /** The draft slot's etag. */
  readonly etag: string;
  /** The published version it was printed from, or `null` for the draft. */
  readonly version: number | null;
  /** Whether it is a published version being read. */
  readonly readOnly: boolean;
}

/**
 * Where a workflow's file sits.
 *
 * @param slug - The workflow's slug.
 * @returns `workflows/<slug>.loop.ts`.
 */
export function workflowFilePath(slug: string): string {
  return `${WORKFLOW_FILE_DIRECTORY}/${slug}${WORKFLOW_FILE_SUFFIX}`;
}

/**
 * One workflow as a file.
 *
 * @param workflow - The entity: its slug and the version in force.
 * @param file - The printed text and what it was printed from.
 * @returns The file.
 */
export function workflowCode(
  workflow: Pick<Workflow, "slug" | "current_version">,
  file: ProjectedFile,
): WorkflowCode {
  return {
    path: workflowFilePath(workflow.slug),
    slug: workflow.slug,
    text: file.text,
    etag: file.etag,
    readOnly: file.readOnly,
    version: file.version,
    currentVersion: workflow.current_version,
    outlineRef: null,
    checksRef: null,
  };
}

/**
 * The explorer, from the rail.
 *
 * @param rail - The workspace's non-archived workflows in the rail's order, as
 *   `WorkflowStatsRepository.registryEntries` reads them — so the explorer and the rail cannot
 *   list different workflows.
 * @returns One file per workflow, then the configuration.
 */
export function workflowCodeTree(
  rail: readonly Pick<WorkflowRegistryRow, "slug" | "status">[],
): WorkflowCodeTree {
  return {
    files: [
      ...rail.map((entry): WorkflowCodeTreeFile => ({
        path: workflowFilePath(entry.slug),
        kind: "workflow",
        readOnly: false,
        slug: entry.slug,
        status: entry.status,
      })),
      { path: CONFIG_FILE_PATH, kind: "config", readOnly: true, slug: null, status: null },
    ],
  };
}

/**
 * The configuration file.
 *
 * @param text - The file, from `code.config.ts`.
 * @returns The file, read-only.
 */
export function workflowCodeConfig(text: string): WorkflowCodeConfig {
  return { path: CONFIG_FILE_PATH, text, readOnly: true };
}

/**
 * The issue a save reports for a file that names a different workflow.
 *
 * @param range - Where the file's slug literal is written.
 * @param written - The slug the file names.
 * @param expected - The slug of the workflow being saved.
 * @returns The issue.
 */
export function slugMismatch(
  range: CodeRange,
  written: string,
  expected: string,
): WorkflowCodeIssue {
  return {
    code: CODE_SLUG_MISMATCH,
    message:
      `This file defines ${JSON.stringify(written)}, and it is being saved as ` +
      `${JSON.stringify(expected)}. A workflow's slug cannot be changed, so write ` +
      `defineLoop(${JSON.stringify(expected)}, …).`,
    ...range,
  };
}
