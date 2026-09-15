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

import type { DraftEditor, WorkflowVersion } from "../db/schema";
import {
  BadRequestError,
  ConflictError,
  InvalidRequestError,
  MethodNotAllowedError,
  NotFoundError,
} from "../errors/error.envelope";
import { isDatabaseFailure } from "../tenancy/constraints";
import { fromParseIssues } from "./code.diagnostics";
import type { WorkflowCodeIssue } from "./code.resources";
import { draftEtag } from "./draft.etag";
import type { DslDiagnostic } from "./dsl.errors";
import type { PublishFinding } from "./publish.gate";

/** The codes, as one object — see `tenancy.errors.ts` for why `as const` matters. */
export const WORKFLOW_ERRORS = {
  /** The code view could not read a saved file, so nothing was written (U.3, #167). */
  codeInvalid: "workflow_code_invalid",
  /** The document cannot be shown as code without changing it (U.3, #167). */
  codeUnprojectable: "workflow_code_unprojectable",
  /** A write to a read-only file of the code view (U.3, #167). */
  codeReadOnly: "workflow_code_read_only",
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
  /** The issue a dry run was asked about is not this workspace's (S.6, #152). */
  dryRunIssueNotFound: "workflow_dry_run_issue_not_found",
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
 * `404` — the issue a dry run names does not exist for this caller.
 *
 * Distinct from {@link workflowNotFound} because the two are different things to pick again: the
 * workflow is readable, and the *issue* is what names nothing — one synced away since the picker
 * listed it, or another workspace's, which the org-scoped read cannot tell apart from absent.
 *
 * @param issueId - The id the request named, echoed into `details.issueId`.
 * @returns The error to throw.
 */
export function dryRunIssueNotFound(issueId: string): NotFoundError {
  return new NotFoundError(
    WORKFLOW_ERRORS.dryRunIssueNotFound,
    "No such issue to dry-run this workflow with.",
    { issueId },
  );
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
 * The draft a stale write lost to, as its `409` describes it.
 *
 * Built by {@link conflictingDraft} from the one row the guard read, so the etag, the editor and
 * the stamp in an answer all describe the same write.
 */
export interface ConflictingDraft {
  /** The etag the draft has now — {@link draftEtag} of the row. */
  readonly etag: string;
  /** Which editor wrote it last (V033), or `null` when neither has since it was created. */
  readonly editedIn: DraftEditor | null;
  /** When it was last written, or `null` when there is no draft at all. */
  readonly updatedAt: Date | null;
}

/**
 * What a draft row says about a conflict.
 *
 * @param row - The draft the guard read under its lock, or `undefined` when the workflow has
 *   none — which a writer loses to when its draft was deleted out from under it.
 * @returns The row's etag, editor and stamp.
 */
export function conflictingDraft(row: WorkflowVersion | undefined): ConflictingDraft {
  return {
    etag: draftEtag(row),
    editedIn: row?.edited_in ?? null,
    updatedAt: row?.updated_at ?? null,
  };
}

/** What a `409` says, by the editor whose change the writer lost to (U.3, #167). */
const CONFLICT_MESSAGES: Readonly<Record<DraftEditor | "unknown", string>> = {
  visual: "This draft was changed in the visual editor. Reload it before saving again.",
  code: "This draft was changed in the code editor. Reload it before saving again.",
  unknown: "This draft was changed by someone else. Reload it before saving again.",
};

/**
 * `409` — the draft is not the one this writer read.
 *
 * **It names the other editor's change** (U.3,
 * [#167](https://github.com/NobuData/ouroboros/issues/167)). A workflow has one draft and two
 * editors (decision **C3**), so *somebody changed it* would leave the conflict dialog guessing:
 * the message and `details.editedIn` say which editor wrote the draft this request lost to, and
 * `details.updatedAt` says when. Both describe a row this caller may already read.
 *
 * @param expected - The etag the request sent.
 * @param current - The draft as it is now, when it is known. Its etag is published so the
 *   studio can decide whether to reload without a second round trip; it is a digest of a row
 *   this caller may already read, so it discloses nothing the `GET` does not. Omitted where it
 *   genuinely is not known — a draft created concurrently is reported by a unique index,
 *   inside a transaction that cannot then be read from, and inventing a token there would put
 *   a value in the envelope that matches nothing.
 * @returns The error to throw. `details` is `{expected}` without a current draft, and
 *   `{expected, current, editedIn, updatedAt}` with one.
 */
export function draftConflict(expected: string, current?: ConflictingDraft): ConflictError {
  if (current === undefined) {
    return new ConflictError(WORKFLOW_ERRORS.draftConflict, CONFLICT_MESSAGES.unknown, {
      expected,
    });
  }

  return new ConflictError(
    WORKFLOW_ERRORS.draftConflict,
    CONFLICT_MESSAGES[current.editedIn ?? "unknown"],
    {
      expected,
      current: current.etag,
      editedIn: current.editedIn,
      updatedAt: current.updatedAt === null ? null : current.updatedAt.toISOString(),
    },
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
 * `404` — no workflow with that slug, for this caller.
 *
 * The code view's addressing (U.3, [#167](https://github.com/NobuData/ouroboros/issues/167)) under
 * {@link workflowNotFound}'s rule: the org-scoped read cannot tell a slug nobody has from another
 * workspace's, so neither can a caller. The same code, with the slug the request sent in place of
 * an id.
 *
 * @param slug - The slug the request named.
 * @returns The error to throw.
 */
export function workflowSlugNotFound(slug: string): NotFoundError {
  return new NotFoundError(WORKFLOW_ERRORS.workflowNotFound, "No such workflow.", { slug });
}

/**
 * `422` — a saved file does not read as this workflow, and nothing was written.
 *
 * Decision **C4**: a typo mid-keystroke never becomes the stored draft. Every issue travels in
 * `details.errors` with a 1-based line and column range, so the editor underlines each where it
 * is written, while the visual editor keeps showing the last draft that did read.
 *
 * `details.diagnostics` carries the same issues as the code view's one diagnostics stream (W.2,
 * [#178](https://github.com/NobuData/ouroboros/issues/178)) — `{severity, range, code, message,
 * note?}`, the shape a successful read or save carries its validation findings in — so the editor
 * renders a refusal and a finding with one code path. `errors` stays, unchanged, for the clients
 * that already read it.
 *
 * @param errors - The parser's errors, or the slug check's one. Carried in `details` rather than
 *   the message, because the editor places them and a message it had to parse would break when the
 *   wording changed.
 * @returns The error to throw.
 */
export function codeInvalid(errors: readonly WorkflowCodeIssue[]): InvalidRequestError {
  return new InvalidRequestError(
    WORKFLOW_ERRORS.codeInvalid,
    "This file does not read as a workflow, so it was not saved. The draft is unchanged.",
    { errors, diagnostics: fromParseIssues(errors) },
  );
}

/**
 * `409` — this document cannot be shown as code without changing it.
 *
 * `code.projection.ts`' rule: a document is shown as code only when the file would read back as
 * that document. A draft the canvas saved half-built — a blank canvas, a model stage with no route
 * yet — is the ordinary case, and `details.findings` is what the shared validator says about it,
 * node-anchored, so the page can say what to finish on the canvas. A `409` rather than a `422`:
 * nothing about the request is wrong, and it is the document's state that refuses it.
 *
 * @param slug - The workflow.
 * @param version - The published version asked for, or `null` for the draft.
 * @param findings - The validator's errors for the document. Empty when it validates and still does
 *   not read back as itself, which would be a printer or parser defect rather than the author's.
 * @returns The error to throw.
 */
export function codeUnprojectable(
  slug: string,
  version: number | null,
  findings: readonly DslDiagnostic[],
): ConflictError {
  return new ConflictError(
    WORKFLOW_ERRORS.codeUnprojectable,
    version === null
      ? "This draft cannot be shown as code yet. Finish it in the visual editor first."
      : "This version cannot be shown as code.",
    { slug, version, findings },
  );
}

/**
 * `405` — a read-only file of the code view.
 *
 * Decision **C6**: `ouroboros.config.ts` is a projection of the registry, printed on every read
 * and stored nowhere, so there is no document for a save to change. The handler that throws this
 * sets `Allow: GET`.
 *
 * @param path - The file, echoed so an editor with several tabs open knows which save was refused.
 * @returns The error to throw.
 */
export function codeReadOnly(path: string): MethodNotAllowedError {
  return new MethodNotAllowedError(
    WORKFLOW_ERRORS.codeReadOnly,
    `${path} is read-only. Change a workflow in the studio, and this file follows.`,
    { path },
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
