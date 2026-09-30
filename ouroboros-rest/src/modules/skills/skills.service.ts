/**
 * The rules of the skills registry — BF.1 ([#410](https://github.com/NobuData/ouroboros/issues/410)).
 *
 * ```
 * create      parse ─▶ slug ─▶ target ─▶ skill + first draft
 * save        parse ─▶ If-Match against the locked draft ─▶ write        (code view: same path)
 * publish     the draft ─▶ frontmatter complete? scope agrees? ─▶ lock ─▶ still that draft? ─▶ vN+1
 * update      the switch (required ⇒ 403 designed) · the lock (owner-only) · the draft flag
 * scope       preview (reach · references · clashes · token) ─▶ commit (same token, clashes resolved)
 * delete      required ⇒ 403 · referenced by published workflows ⇒ 409 naming them
 * stats       injection records over a stated window ─▶ the Used-by rule
 * ```
 *
 * Four rules hold across all of them, each the workflow lifecycle's (`workflows.service.ts`):
 *
 *   * **Absence answers `404`, and so does another workspace's skill** — every operation resolves
 *     the skill through the org-scoped `findBySlug`, which is also the tenancy check for every
 *     `skill_versions` statement after it.
 *   * **A draft write is guarded or refused.** `If-Match` is compared against the draft read
 *     `for update` in the write's own transaction (WF-P.3's no-silent-clobber rule).
 *   * **A document is refused before anything opens.** A file that does not parse is a `422` with
 *     line-anchored issues and the stored draft untouched.
 *   * **The database's rules are caught by name** — slug uniqueness, the one-draft index and
 *     dense numbering become `409`s the client can act on.
 *
 * **The required lock is enforced here, not only in the UI.** Mockup 14 greys `hil-safety`'s
 * switch; this service answers a direct `PATCH {enabled: false}` with the same designed `403`,
 * and V069's `skills_required_enabled` holds it once more beneath. Changing `required` itself is
 * owner-only, because it is the flag that makes a skill impossible to turn off.
 */

import { Injectable } from "@nestjs/common";

import type { Transaction } from "kysely";

import type { Database, OrganizationRole, SkillVersion } from "../db/schema";
import { DatabaseService } from "../db/db.service";
import { pageOf, windowOf, type Page, type PageQuery } from "../tenancy/pagination";
import { ifMatchAdmits } from "../workflows/draft.etag";
import { slugify } from "../workflows/slug";
import {
  DEFAULT_STATS_DAYS,
  type CreateSkillBody,
  type MoveSkillScopeBody,
  type PublishSkillBody,
  type ScopeTargetBody,
  type UpdateSkillBody,
} from "./skills.dto";
import {
  SKILL_CONSTRAINTS,
  documentInvalid,
  draftAbsent,
  draftConflict,
  draftEtagRequired,
  publishConflict,
  referenced,
  requiredDraft,
  requiredLocked,
  requiredOwnerOnly,
  scopeConflict,
  scopeInvalid,
  scopeMismatch,
  scopePreviewStale,
  skillNotFound,
  slugRequired,
  slugTaken,
  unpublished,
  versionNotFound,
  violates,
} from "./skills.errors";
import {
  FrontmatterSchema,
  parseSkillDocument,
  type ParsedSkillDocument,
  type SkillFrontmatter,
} from "./skills.frontmatter";
import { SkillsRepository } from "./skills.repository";
import {
  isActive,
  skillCode,
  skillDetail,
  skillDraft,
  skillDraftEtag,
  skillList,
  skillSummary,
  skillTarget,
  skillVersion,
  skillVersionSummary,
  type SkillCode,
  type SkillDetail,
  type SkillDraft,
  type SkillList,
  type SkillRow,
  type SkillScopePreview,
  type SkillStats,
  type SkillSummary,
  type SkillTarget,
  type SkillVersionResource,
  type SkillVersionSummary,
} from "./skills.resources";
import { buildScopePreview, sameTarget } from "./skills.scope";
import { usedBy } from "./skills.usage";

/** A day, in milliseconds — the stats window's unit. */
const DAY_MS = 86_400_000;

/** The role that may change `required`. */
const LOCK_KEEPER: OrganizationRole = "owner";

@Injectable()
export class SkillsService {
  /**
   * @param skills - The registry's statements.
   * @param database - For the operations that are only correct as a unit of work.
   */
  constructor(
    private readonly skills: SkillsRepository,
    private readonly database: DatabaseService,
  ) {}

  /**
   * Mockup 14's skills card.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @returns Every skill by slug, and the active count — drafts never counted.
   */
  async list(organizationId: string): Promise<SkillList> {
    return skillList(await this.skills.list(organizationId));
  }

  /**
   * One skill, one of its versions, and its draft slot.
   *
   * @param organizationId - The workspace.
   * @param slug - The skill.
   * @param version - A published version to carry instead of the one in force.
   * @returns The detail.
   * @throws {NotFoundError} `skill_not_found`, or `skill_version_not_found` for `?version=`.
   */
  async read(organizationId: string, slug: string, version?: number): Promise<SkillDetail> {
    const row = await this.require(organizationId, slug);
    const [draft, shown] = await Promise.all([
      this.skills.draftOf(row.id),
      this.versionToShow(row, version),
    ]);

    return skillDetail(row, shown, draft);
  }

  /**
   * **+ New skill** — a skill and the draft its editor opens on. Nothing is published.
   *
   * @param organizationId - The workspace.
   * @param body - The document, and optionally its slug and where it applies.
   * @returns The detail, with the draft and no version.
   * @throws {InvalidRequestError} `skill_document_invalid`, `skill_slug_required`,
   *   `skill_scope_invalid` or `skill_scope_mismatch` — nothing written.
   * @throws {ConflictError} `skill_slug_taken`.
   */
  async create(organizationId: string, body: CreateSkillBody): Promise<SkillDetail> {
    const document = parseOrRefuse(body.text);
    const { frontmatter } = document;
    const slug = body.slug ?? slugify(frontmatter.name);

    if (slug === undefined) throw slugRequired(frontmatter.name);

    const scope = body.scope ?? frontmatter.scope ?? "org";
    const target = await this.resolveTarget(organizationId, { ...body, scope });

    if (frontmatter.scope !== undefined && frontmatter.scope !== target.scope) {
      throw scopeMismatch(slug, frontmatter.scope, target.scope);
    }

    try {
      await this.skills.create(organizationId, {
        slug,
        name: frontmatter.name,
        description: frontmatter.description,
        scope: target.scope,
        repoRef: target.repoRef,
        workflowId: target.workflow?.id ?? null,
        origin: "authored",
        draft: false,
        frontmatter,
        body: document.body,
      });
    } catch (error) {
      if (violates(error, SKILL_CONSTRAINTS.slugUnique)) throw slugTaken(slug);

      throw error;
    }

    return this.read(organizationId, slug);
  }

  /**
   * Save the draft, if it is still the draft the writer read — WF-P.3's draft-save.
   *
   * @param organizationId - The workspace.
   * @param slug - The skill.
   * @param ifMatch - The `If-Match` header, verbatim, or `undefined`.
   * @param text - The whole document.
   * @returns The draft after the write.
   * @throws {NotFoundError} `skill_not_found`.
   * @throws {BadRequestError} `skill_draft_etag_required`.
   * @throws {InvalidRequestError} `skill_document_invalid` — the draft unchanged.
   * @throws {ConflictError} `skill_draft_conflict`.
   */
  async saveDraft(
    organizationId: string,
    slug: string,
    ifMatch: string | undefined,
    text: string,
  ): Promise<SkillDraft> {
    const row = await this.require(organizationId, slug);

    if (ifMatch === undefined) throw draftEtagRequired();

    return skillDraft(await this.writeGuarded(row.id, ifMatch, parseOrRefuse(text)));
  }

  /**
   * Publish the draft as the next immutable version.
   *
   * @param organizationId - The workspace.
   * @param slug - The skill.
   * @param body - The change note.
   * @param publishedBy - Who pressed Publish.
   * @param now - The publish instant.
   * @returns The version, now in force.
   * @throws {NotFoundError} `skill_not_found`.
   * @throws {ConflictError} `skill_draft_absent`, `skill_draft_conflict` (the draft moved) or
   *   `skill_publish_conflict` (somebody published first).
   * @throws {InvalidRequestError} `skill_document_invalid` for a draft that is incomplete, and
   *   `skill_scope_mismatch` for one declaring another scope than the skill's.
   */
  async publish(
    organizationId: string,
    slug: string,
    body: PublishSkillBody,
    publishedBy: string,
    now: Date = new Date(),
  ): Promise<SkillVersionResource> {
    const row = await this.require(organizationId, slug);
    const draft = await this.skills.draftOf(row.id);

    if (draft === undefined) throw draftAbsent(slug);

    const frontmatter = publishable(draft);

    if (frontmatter.scope !== undefined && frontmatter.scope !== row.scope) {
      throw scopeMismatch(slug, frontmatter.scope, row.scope);
    }

    const validated = skillDraftEtag(draft);

    return this.database.transaction(async (trx) => {
      const locked = await this.skills.lock(organizationId, slug, trx);

      if (locked === undefined) throw skillNotFound(slug);

      const current = await this.skills.draftOf(row.id, trx, true);

      if (current === undefined) throw draftAbsent(slug);

      // What becomes immutable is the draft that was checked.
      if (skillDraftEtag(current) !== validated) {
        throw draftConflict(validated, skillDraftEtag(current));
      }

      try {
        return skillVersion(
          await this.skills.publish(
            row.id,
            current.id,
            {
              changeNote: body.changeNote ?? null,
              publishedBy,
              publishedAt: now,
              name: frontmatter.name,
              description: frontmatter.description,
            },
            trx,
          ),
        );
      } catch (error) {
        if (
          violates(error, SKILL_CONSTRAINTS.versionUnique) ||
          violates(error, SKILL_CONSTRAINTS.versionDense)
        ) {
          throw publishConflict(slug);
        }

        throw error;
      }
    });
  }

  /**
   * One page of the history, newest first.
   *
   * @param organizationId - The workspace.
   * @param slug - The skill.
   * @param query - `limit` and `offset`.
   * @returns The page, without documents.
   * @throws {NotFoundError} `skill_not_found`.
   */
  async versions(
    organizationId: string,
    slug: string,
    query: PageQuery,
  ): Promise<Page<SkillVersionSummary>> {
    const row = await this.require(organizationId, slug);
    const window = windowOf(query);
    const [rows, total] = await Promise.all([
      this.skills.versions(row.id, window),
      this.skills.countVersions(row.id),
    ]);

    return pageOf(
      rows.map((version) => skillVersionSummary(version, row.current_version)),
      total,
      window,
    );
  }

  /**
   * The switch, the lock and the draft flag.
   *
   * @param organizationId - The workspace.
   * @param slug - The skill.
   * @param body - What to change.
   * @param roles - The caller's roles — `required` is an owner's to change.
   * @returns The skill after the change.
   * @throws {NotFoundError} `skill_not_found`.
   * @throws {ForbiddenError} `skill_required_owner_only` when a non-owner changes `required`, and
   *   `skill_required_locked` — the designed reason — when a required skill would be switched off.
   * @throws {InvalidRequestError} `skill_required_draft` for a required draft.
   * @throws {ConflictError} `skill_unpublished` when promoting a skill with nothing published.
   */
  async update(
    organizationId: string,
    slug: string,
    body: UpdateSkillBody,
    roles: readonly OrganizationRole[],
  ): Promise<SkillSummary> {
    await this.database.transaction(async (trx) => {
      const row = await this.skills.lock(organizationId, slug, trx);

      if (row === undefined) throw skillNotFound(slug);

      if (body.required !== undefined && body.required !== row.required) {
        if (!roles.includes(LOCK_KEEPER)) throw requiredOwnerOnly(slug, roles.join(","));
      }

      const required = body.required ?? row.required;
      const draft = body.draft ?? row.draft;
      // Setting the lock switches the skill on: required implies enabled (V069).
      const enabled = body.enabled ?? (required && !row.required ? true : row.enabled);

      if (required && !enabled) throw requiredLocked(slug);
      if (required && draft) throw requiredDraft(slug);
      if (row.draft && !draft && row.current_version === null) throw unpublished(slug);

      await this.skills.update(row.id, { enabled, required, draft }, trx);
    });

    return skillSummary(await this.require(organizationId, slug));
  }

  /**
   * What a scope move would do, before it is made.
   *
   * @param organizationId - The workspace.
   * @param slug - The skill.
   * @param body - The destination.
   * @returns The preview, with the token a commit sends back.
   * @throws {NotFoundError} `skill_not_found`.
   * @throws {InvalidRequestError} `skill_scope_invalid`.
   */
  async previewScope(
    organizationId: string,
    slug: string,
    body: ScopeTargetBody,
  ): Promise<SkillScopePreview> {
    const row = await this.require(organizationId, slug);
    const to = await this.resolveTarget(organizationId, body);

    return this.preview(organizationId, row, to);
  }

  /**
   * Commit a previewed scope move.
   *
   * @param organizationId - The workspace.
   * @param slug - The skill.
   * @param body - The destination, the preview's token, and `resolve` when it showed clashes.
   * @returns The skill in its new scope.
   * @throws {NotFoundError} `skill_not_found`.
   * @throws {InvalidRequestError} `skill_scope_invalid`.
   * @throws {ConflictError} `skill_scope_preview_stale` when the move would now do something other
   *   than what was previewed, and `skill_scope_conflict` for clashes not resolved.
   */
  async moveScope(
    organizationId: string,
    slug: string,
    body: MoveSkillScopeBody,
  ): Promise<SkillSummary> {
    const to = await this.resolveTarget(organizationId, body);

    await this.database.transaction(async (trx) => {
      if ((await this.skills.lock(organizationId, slug, trx)) === undefined) {
        throw skillNotFound(slug);
      }

      const row = await this.skills.findBySlug(organizationId, slug, trx);

      if (row === undefined) throw skillNotFound(slug);

      const preview = await this.preview(organizationId, row, to, trx);

      if (preview.previewToken !== body.previewToken) {
        throw scopePreviewStale(slug, body.previewToken, preview.previewToken);
      }

      if (preview.clashes.length > 0 && body.resolve !== "keep_both") {
        throw scopeConflict(slug, preview.clashes);
      }

      await this.skills.update(
        row.id,
        { scope: to.scope, repo_ref: to.repoRef, workflow_id: to.workflow?.id ?? null },
        trx,
      );

      // A draft declaring the old scope would refuse to publish; it follows the move.
      const draft = await this.skills.draftOf(row.id, trx, true);
      const declared = draft?.frontmatter as Record<string, unknown> | undefined;

      if (draft !== undefined && declared?.scope !== undefined && declared.scope !== to.scope) {
        await this.skills.writeDraft(draft.id, { ...declared, scope: to.scope }, draft.body, trx);
      }
    });

    return skillSummary(await this.require(organizationId, slug));
  }

  /**
   * Delete a skill — guarded.
   *
   * @param organizationId - The workspace.
   * @param slug - The skill.
   * @throws {NotFoundError} `skill_not_found`.
   * @throws {ForbiddenError} `skill_required_locked` — a required skill cannot be removed any
   *   more than it can be switched off.
   * @throws {ConflictError} `skill_referenced`, naming the published workflows that reference it.
   */
  async delete(organizationId: string, slug: string): Promise<void> {
    await this.database.transaction(async (trx) => {
      const row = await this.skills.lock(organizationId, slug, trx);

      if (row === undefined) throw skillNotFound(slug);
      if (row.required) throw requiredLocked(slug);

      const workflows = await this.skills.referencingWorkflows(organizationId, slug, trx);

      if (workflows.length > 0) throw referenced(slug, workflows);

      await this.skills.delete(row.id, trx);
    });
  }

  /**
   * The Used-by column, counted from injection records over a stated window.
   *
   * @param organizationId - The workspace.
   * @param days - The window, in days back from `now`.
   * @param now - The window's end.
   * @returns The window and every skill's figures, by slug.
   */
  async stats(
    organizationId: string,
    days: number = DEFAULT_STATS_DAYS,
    now: Date = new Date(),
  ): Promise<SkillStats> {
    const from = new Date(now.getTime() - days * DAY_MS);
    const [rows, usage] = await Promise.all([
      this.skills.list(organizationId),
      this.skills.usage(organizationId, from, now),
    ]);

    return {
      window: { days, from: from.toISOString(), to: now.toISOString() },
      skills: rows.map((row) => {
        const carried = new Set(
          usage.carried.filter((pair) => pair.skillId === row.id).map((pair) => pair.runId),
        );

        return {
          slug: row.slug,
          active: isActive(row),
          usedBy: usedBy(
            {
              scope: row.scope,
              repoRef: row.repo_ref,
              workflowSlug: row.workflow_slug,
              draft: row.draft,
            },
            usage.runs,
            carried,
          ),
          injections: usage.injections.get(row.id) ?? 0,
        };
      }),
    };
  }

  /**
   * `skills/<slug>.skill.md` — the code view's document read.
   *
   * @param organizationId - The workspace.
   * @param slug - The skill.
   * @param version - A published version, read-only.
   * @returns The file: the draft, else the version in force, editable; or the version asked for.
   * @throws {NotFoundError} `skill_not_found` or `skill_version_not_found`.
   * @throws {ConflictError} `skill_draft_absent` for a skill with neither a draft nor a version.
   */
  async readCode(organizationId: string, slug: string, version?: number): Promise<SkillCode> {
    const row = await this.require(organizationId, slug);
    const draft = await this.skills.draftOf(row.id);

    if (version !== undefined) {
      const requested = await this.skills.versionAt(row.id, version);

      if (requested === undefined) throw versionNotFound(slug, version);

      return skillCode(row, requested, draft, true);
    }

    const shown = draft ?? (await this.versionToShow(row, undefined));

    if (shown === undefined) throw draftAbsent(slug);

    return skillCode(row, shown, draft, false);
  }

  /**
   * The code view's document save — the draft-save, answered as a file.
   *
   * @param organizationId - The workspace.
   * @param slug - The skill.
   * @param ifMatch - The `If-Match` header, verbatim, or `undefined`.
   * @param text - The whole file.
   * @returns The file as stored, with the draft's new etag.
   * @throws As {@link saveDraft}.
   */
  async saveCode(
    organizationId: string,
    slug: string,
    ifMatch: string | undefined,
    text: string,
  ): Promise<SkillCode> {
    const row = await this.require(organizationId, slug);

    if (ifMatch === undefined) throw draftEtagRequired();

    const written = await this.writeGuarded(row.id, ifMatch, parseOrRefuse(text));

    return skillCode(row, written, written, false);
  }

  /**
   * Write a skill's draft under the `If-Match` guard.
   *
   * @param skillId - A skill resolved through {@link require}.
   * @param ifMatch - The header.
   * @param document - The parsed document.
   * @param trx - An enclosing transaction, when there is one.
   * @returns The draft after the write.
   * @throws {ConflictError} `skill_draft_conflict` when the draft moved, or was created by another
   *   request between this one's read and its insert.
   */
  private async writeGuarded(
    skillId: string,
    ifMatch: string,
    document: ParsedSkillDocument,
    trx?: Transaction<Database>,
  ): Promise<SkillVersion> {
    if (trx === undefined) {
      return this.database.transaction((own) => this.writeGuarded(skillId, ifMatch, document, own));
    }

    const existing = await this.skills.draftOf(skillId, trx, true);
    const current = skillDraftEtag(existing);

    if (!ifMatchAdmits(ifMatch, current)) throw draftConflict(ifMatch, current);

    if (existing !== undefined) {
      const written = await this.skills.writeDraft(
        existing.id,
        document.frontmatter,
        document.body,
        trx,
      );

      if (written === undefined) throw draftConflict(ifMatch, current);

      return written;
    }

    try {
      return await this.skills.insertDraft(skillId, document.frontmatter, document.body, trx);
    } catch (error) {
      if (violates(error, SKILL_CONSTRAINTS.oneDraft)) throw draftConflict(ifMatch, current);

      throw error;
    }
  }

  /**
   * The preview, from a row and a resolved destination.
   *
   * @param organizationId - The workspace.
   * @param row - The skill.
   * @param to - Where it would move.
   * @param trx - The transaction, when committing.
   * @returns The preview.
   * @throws {InvalidRequestError} `skill_scope_invalid` when the destination is where it already is.
   */
  private async preview(
    organizationId: string,
    row: SkillRow,
    to: SkillTarget,
    trx?: Transaction<Database>,
  ): Promise<SkillScopePreview> {
    const from = skillTarget(row);

    if (sameTarget(from, to)) {
      throw scopeInvalid("The skill already applies there.", { slug: row.slug, scope: to.scope });
    }

    const [universe, references, clashes] = await Promise.all([
      this.skills.universe(organizationId, trx),
      this.skills.referencingWorkflows(organizationId, row.slug, trx),
      this.skills.nameClashes(
        organizationId,
        row.id,
        row.name,
        { scope: to.scope, repoRef: to.repoRef, workflowId: to.workflow?.id ?? null },
        trx,
      ),
    ]);

    return buildScopePreview({
      skillId: row.id,
      slug: row.slug,
      from,
      to,
      universe,
      references,
      clashes,
    });
  }

  /**
   * A requested scope, checked against its referent and this workspace.
   *
   * @param organizationId - The workspace.
   * @param body - The scope, and the referent it needs.
   * @returns The target.
   * @throws {InvalidRequestError} `skill_scope_invalid` — a referent missing, one too many, or a
   *   workflow this workspace does not have.
   */
  private async resolveTarget(
    organizationId: string,
    body: Pick<ScopeTargetBody, "scope" | "repoRef" | "workflowId">,
  ): Promise<SkillTarget> {
    const { scope, repoRef, workflowId } = body;

    if (scope !== "repo" && repoRef !== undefined) {
      throw scopeInvalid("repoRef is only for repo scope.", { scope, repoRef });
    }

    if (scope !== "workflow" && workflowId !== undefined) {
      throw scopeInvalid("workflowId is only for workflow scope.", { scope, workflowId });
    }

    if (scope === "repo") {
      if (repoRef === undefined) throw scopeInvalid("repo scope needs repoRef.", { scope });

      return { scope, repoRef, workflow: null };
    }

    if (scope === "workflow") {
      if (workflowId === undefined) {
        throw scopeInvalid("workflow scope needs workflowId.", { scope });
      }

      const workflow = await this.skills.workflowRef(organizationId, workflowId);

      if (workflow === undefined) {
        throw scopeInvalid("No such workflow in this workspace.", { scope, workflowId });
      }

      return { scope, repoRef: null, workflow };
    }

    return { scope, repoRef: null, workflow: null };
  }

  /**
   * The skill, or the `404` covering both ways it can be missing.
   *
   * @param organizationId - The workspace.
   * @param slug - The skill.
   * @returns The row.
   * @throws {NotFoundError} `skill_not_found`.
   */
  private async require(organizationId: string, slug: string): Promise<SkillRow> {
    const row = await this.skills.findBySlug(organizationId, slug);

    if (row === undefined) throw skillNotFound(slug);

    return row;
  }

  /**
   * The version a read carries.
   *
   * @param row - The skill.
   * @param version - The number asked for, or `undefined` for the one in force.
   * @returns The row, or `undefined` before a first publish.
   * @throws {NotFoundError} `skill_version_not_found` when an asked-for number names nothing.
   */
  private async versionToShow(
    row: SkillRow,
    version: number | undefined,
  ): Promise<SkillVersion | undefined> {
    if (version !== undefined) {
      const found = await this.skills.versionAt(row.id, version);

      if (found === undefined) throw versionNotFound(row.slug, version);

      return found;
    }

    return row.current_version === null
      ? undefined
      : this.skills.versionAt(row.id, row.current_version);
  }
}

/**
 * Parse a document, or refuse the request with its issues.
 *
 * @param text - The whole file.
 * @returns The document.
 * @throws {InvalidRequestError} `skill_document_invalid`.
 */
function parseOrRefuse(text: string): ParsedSkillDocument {
  const result = parseSkillDocument(text);

  if (!result.ok) throw documentInvalid(result.issues);

  return result.document;
}

/**
 * A stored draft's frontmatter, checked complete enough to publish.
 *
 * Every draft this service writes has passed {@link parseOrRefuse}; a draft another writer
 * stored (an import, a seed) is held to the same shape here, where it is about to become the
 * version in force.
 *
 * @param draft - The draft.
 * @returns Its frontmatter, typed.
 * @throws {InvalidRequestError} `skill_document_invalid` — an incomplete frontmatter, or an empty
 *   body (V069 refuses a blank published body).
 */
function publishable(draft: SkillVersion): SkillFrontmatter {
  const checked = FrontmatterSchema.safeParse(draft.frontmatter);

  if (!checked.success) {
    throw documentInvalid(
      checked.error.issues.map((issue) => {
        const path = issue.path.map(String).join(".");

        return {
          path,
          line: null,
          message: path === "" ? issue.message : `${path}: ${issue.message}`,
        };
      }),
    );
  }

  if (draft.body.trim() === "") {
    throw documentInvalid([
      { path: "", line: null, message: "A published skill says something: the body is empty." },
    ]);
  }

  return checked.data;
}
