/**
 * What the skills API looks like on the wire (BF.1,
 * [#410](https://github.com/NobuData/ouroboros/issues/410)).
 *
 * ```
 * SkillList            mockup 14's skills card: every skill, and the `6 active` count
 * SkillDetail          one skill, one of its versions, and its draft slot's etag
 * SkillVersionSummary  one row of the history — no body; a version is read by number
 * SkillDraft           the mutable draft after a save
 * SkillCode            skills/<slug>.skill.md as the code view opens it (X.2, #181)
 * SkillScopePreview    what a scope move would change, before it is committed
 * SkillStats           the Used-by column, counted from injection records over a stated window
 * ```
 *
 * **Draft skills are never active.** `active` in {@link SkillList} counts skills that context
 * assembly could inject — enabled, not a draft, with a published version — and the Used-by label
 * of a draft is `—` whatever the records say. A draft is shown, tinted, and never counted.
 */

import type { Skill, SkillOrigin, SkillScope, SkillVersion } from "../db/schema";
import { draftEtag, type DraftIdentity } from "../workflows/draft.etag";
import { printSkillDocument } from "./skills.frontmatter";

/** Where a skill's file sits in the code view's virtual project. */
export const SKILL_FILE_DIRECTORY = "skills";

/** What a skill's file name ends with — mockup 05's `skills/…` section, X.2's `*.skill.md`. */
export const SKILL_FILE_SUFFIX = ".skill.md";

/** Where the skills routes are served, as a client requests them. */
export const SKILLS_PATH = "/api/v1/skills";

/** The Used-by label for a skill no manifest carried — mockup 14's dash. */
export const USED_BY_NONE = "—";

/** A workflow, as a skill names it. */
export interface WorkflowRef {
  readonly id: string;
  readonly slug: string;
}

/** Where a skill applies: its scope and that scope's referent. */
export interface SkillTarget {
  readonly scope: SkillScope;
  /** `owner/name`, exactly when `scope` is `repo`. */
  readonly repoRef: string | null;
  /** The workflow, exactly when `scope` is `workflow`. */
  readonly workflow: WorkflowRef | null;
}

/** One skill as the table lists it. */
export interface SkillSummary extends SkillTarget {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  /** The switch. */
  readonly enabled: boolean;
  /** The locked switch — `required — cannot disable`. */
  readonly required: boolean;
  /** The tinted row: never injected, never counted as active. */
  readonly draft: boolean;
  readonly origin: SkillOrigin;
  /** The version in force — the `v12` of `v12 · 2d ago` — or `null` before a first publish. */
  readonly currentVersion: number | null;
  /** When the version in force was published — the `2d ago` — or `null`. */
  readonly publishedAt: string | null;
  /** Whether context assembly could inject it: enabled, not a draft, and published. */
  readonly active: boolean;
  /** Where the code view opens it — `skills/<slug>.skill.md`. */
  readonly path: string;
  readonly updatedAt: string;
}

/** Mockup 14's skills card. */
export interface SkillList {
  /** Every skill of the workspace, by slug. */
  readonly skills: readonly SkillSummary[];
  /** The card's `6 active` — drafts never counted. */
  readonly active: number;
}

/** One published version, whole. */
export interface SkillVersionResource {
  readonly version: number;
  readonly frontmatter: unknown;
  readonly body: string;
  readonly publishedAt: string;
  readonly publishedBy: string | null;
  readonly changeNote: string | null;
}

/** One row of the history, without the document. */
export interface SkillVersionSummary {
  readonly version: number;
  readonly publishedAt: string;
  readonly publishedBy: string | null;
  readonly changeNote: string | null;
  /** Whether this is the version in force. */
  readonly isCurrent: boolean;
}

/** The draft slot. */
export interface SkillDraft {
  /** The `If-Match` of the next save; `none` when there is no draft. */
  readonly etag: string;
  readonly frontmatter: unknown;
  readonly body: string;
  readonly updatedAt: string;
}

/** One skill, a version of it, and its draft slot. */
export interface SkillDetail {
  readonly skill: SkillSummary;
  /** The version asked for, or the one in force, or `null` before a first publish. */
  readonly version: SkillVersionResource | null;
  /** The draft, or `null` when there is none. */
  readonly draft: SkillDraft | null;
  /** The draft slot's etag, always — `none` when empty — so a first save has a token to send. */
  readonly draftEtag: string;
}

/** `skills/<slug>.skill.md`, as the code view opens it — `WorkflowCode`'s shape, for a skill. */
export interface SkillCode {
  readonly path: string;
  readonly slug: string;
  /** The markdown with its frontmatter. */
  readonly text: string;
  /** The draft slot's etag — the `If-Match` of the next save. */
  readonly etag: string;
  /** `true` for a published version read with `?version=`; `false` for the editable file. */
  readonly readOnly: boolean;
  /** The published version the text was printed from, or `null` for the draft. */
  readonly version: number | null;
  /** The version in force, or `null`. */
  readonly currentVersion: number | null;
}

/** A published workflow whose version in force names a skill. */
export interface SkillReference {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  /** The version in force that holds the reference. */
  readonly version: number;
}

/** Another skill at the destination with the same name. */
export interface ScopeClash {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
}

/** Where a skill applies, spelled out. */
export interface SkillReach {
  /** The repositories it applies in, as `owner/name`. */
  readonly repos: readonly string[];
  /** The workflows it applies to. */
  readonly workflows: readonly WorkflowRef[];
}

/** A referencing workflow, and whether the move leaves it outside the skill's reach. */
export interface ScopeReference {
  readonly workflow: SkillReference;
  /** `true` when, after the move, the skill no longer applies to this workflow. */
  readonly outOfReach: boolean;
}

/** What a scope move would do — shown before it is committed. */
export interface SkillScopePreview {
  readonly slug: string;
  readonly from: SkillTarget;
  readonly to: SkillTarget;
  /** What the move adds to the skill's reach, and what it takes away. */
  readonly reach: { readonly gains: SkillReach; readonly loses: SkillReach };
  /** Every published workflow referencing the skill, and whether it falls out of reach. */
  readonly references: readonly ScopeReference[];
  /** Skills at the destination with the same name. Non-empty means the commit needs `keep_both`. */
  readonly clashes: readonly ScopeClash[];
  /** Send this back to commit; a different answer on commit is `409 skill_scope_preview_stale`. */
  readonly previewToken: string;
}

/** The Used-by cell. */
export interface SkillUsedBy {
  /** `61% of runs`, `every run`, `every PR`, `physical tests` or `—`. */
  readonly label: string;
  /** Runs in the window whose manifests carried a version of the skill. */
  readonly carried: number;
  /** Runs in the window, in the skill's scope, that context was assembled for. */
  readonly inScope: number;
}

/** One skill's figures. */
export interface SkillStatsRow {
  readonly slug: string;
  /** As {@link SkillSummary.active}: a draft is never active. */
  readonly active: boolean;
  readonly usedBy: SkillUsedBy;
  /** Manifests in the window carrying a version of it — every consumer, runs or not. */
  readonly injections: number;
}

/** The window the figures were counted over — stated, never implied. */
export interface StatsWindow {
  readonly days: number;
  readonly from: string;
  readonly to: string;
}

/** The skills card's Used-by column. */
export interface SkillStats {
  readonly window: StatsWindow;
  readonly skills: readonly SkillStatsRow[];
}

/** A skill row with the workflow slug its scope names, when it names one. */
export interface SkillRow extends Skill {
  /** The workflow's slug for a workflow-scoped skill, else `null`. */
  readonly workflow_slug: string | null;
  /** When the version in force was published, else `null`. */
  readonly current_published_at: Date | null;
}

/**
 * The draft identity an etag is computed from — `draft.etag.ts`' input, for a skill draft.
 *
 * @param draft - The draft row, or `undefined`.
 * @returns The identity, or `undefined` for an empty slot.
 */
export function skillDraftIdentity(draft: SkillVersion | undefined): DraftIdentity | undefined {
  return draft === undefined
    ? undefined
    : {
        id: draft.id,
        updated_at: draft.updated_at,
        definition: { frontmatter: draft.frontmatter, body: draft.body },
      };
}

/**
 * The draft slot's etag.
 *
 * @param draft - The draft row, or `undefined`.
 * @returns `none`, or a digest of the draft's identity and content.
 */
export function skillDraftEtag(draft: SkillVersion | undefined): string {
  return draftEtag(skillDraftIdentity(draft));
}

/**
 * Whether context assembly could inject a skill.
 *
 * @param row - The skill.
 * @returns `true` when it is enabled, not a draft, and published.
 */
export function isActive(row: Pick<Skill, "enabled" | "draft" | "current_version">): boolean {
  return row.enabled && !row.draft && row.current_version !== null;
}

/**
 * A skill's file path.
 *
 * @param slug - The skill.
 * @returns `skills/<slug>.skill.md`.
 */
export function skillFilePath(slug: string): string {
  return `${SKILL_FILE_DIRECTORY}/${slug}${SKILL_FILE_SUFFIX}`;
}

/**
 * Where a row says the skill applies.
 *
 * @param row - The skill.
 * @returns Its target.
 */
export function skillTarget(row: SkillRow): SkillTarget {
  return {
    scope: row.scope,
    repoRef: row.repo_ref,
    workflow:
      row.workflow_id === null ? null : { id: row.workflow_id, slug: row.workflow_slug ?? "" },
  };
}

/**
 * @param row - The skill.
 * @returns The table row.
 */
export function skillSummary(row: SkillRow): SkillSummary {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    ...skillTarget(row),
    enabled: row.enabled,
    required: row.required,
    draft: row.draft,
    origin: row.origin,
    currentVersion: row.current_version,
    publishedAt: row.current_published_at?.toISOString() ?? null,
    active: isActive(row),
    path: skillFilePath(row.slug),
    updatedAt: row.updated_at.toISOString(),
  };
}

/**
 * @param rows - Every skill, in the table's order.
 * @returns The card.
 */
export function skillList(rows: readonly SkillRow[]): SkillList {
  const skills = rows.map(skillSummary);

  return { skills, active: skills.filter((skill) => skill.active).length };
}

/**
 * @param row - A published version.
 * @returns It, whole.
 */
export function skillVersion(row: SkillVersion): SkillVersionResource {
  return {
    version: row.version as number,
    frontmatter: row.frontmatter,
    body: row.body,
    publishedAt: (row.published_at as Date).toISOString(),
    publishedBy: row.published_by,
    changeNote: row.change_note,
  };
}

/**
 * @param row - A published version.
 * @param current - The version in force.
 * @returns The history row.
 */
export function skillVersionSummary(
  row: Pick<SkillVersion, "version" | "published_at" | "published_by" | "change_note">,
  current: number | null,
): SkillVersionSummary {
  return {
    version: row.version as number,
    publishedAt: (row.published_at as Date).toISOString(),
    publishedBy: row.published_by,
    changeNote: row.change_note,
    isCurrent: row.version === current,
  };
}

/**
 * @param row - The draft row.
 * @returns The draft slot.
 */
export function skillDraft(row: SkillVersion): SkillDraft {
  return {
    etag: skillDraftEtag(row),
    frontmatter: row.frontmatter,
    body: row.body,
    updatedAt: row.updated_at.toISOString(),
  };
}

/**
 * @param row - The skill.
 * @param version - The version to carry, or `undefined`.
 * @param draft - The draft, or `undefined`.
 * @returns The detail.
 */
export function skillDetail(
  row: SkillRow,
  version: SkillVersion | undefined,
  draft: SkillVersion | undefined,
): SkillDetail {
  return {
    skill: skillSummary(row),
    version: version === undefined ? null : skillVersion(version),
    draft: draft === undefined ? null : skillDraft(draft),
    draftEtag: skillDraftEtag(draft),
  };
}

/**
 * A skill as a file.
 *
 * @param row - The skill.
 * @param shown - The version whose text is shown — the draft, a requested version, or the one in
 *   force.
 * @param draft - The draft slot, for the etag.
 * @param readOnly - Whether the file was asked for by version.
 * @returns The file.
 */
export function skillCode(
  row: SkillRow,
  shown: SkillVersion,
  draft: SkillVersion | undefined,
  readOnly: boolean,
): SkillCode {
  return {
    path: skillFilePath(row.slug),
    slug: row.slug,
    text: printSkillDocument(shown.frontmatter as Record<string, unknown>, shown.body),
    etag: skillDraftEtag(draft),
    readOnly,
    version: shown.version,
    currentVersion: row.current_version,
  };
}
