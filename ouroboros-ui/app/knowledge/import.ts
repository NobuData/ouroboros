/**
 * Every decision the **Import CLAUDE.md / .cursorrules** sheet makes, and every sentence it says
 * (BG.1, [#417](https://github.com/NobuData/ouroboros/issues/417)).
 *
 * **Framework-free and pure**, like `create.ts` beside it. The sheet is
 * `app/knowledge/import-sheet.tsx` and its server hop is `app/knowledge/import-actions.ts`.
 *
 * ---------------------------------------------------------------------------
 * ### Probe → preview → apply, and the preview is the point
 *
 * A reader pressing the import has no idea how many rules are in their files, and applying forty
 * fact candidates without warning would bury the review queue and feel like the tool took over. So
 * the sheet asks which repository, shows **what would be written** — which files were found, the
 * counts per kind, samples, how many candidates dedupe against what the workspace already knows —
 * and only then offers **Apply**, which writes exactly the preview or nothing (BF.4's fingerprint).
 *
 * ### The honest statement belongs in the preview
 *
 * Nothing imported is enabled: skills arrive as drafts, facts as candidates. {@link NOTHING_ENABLED}
 * is drawn in the preview because it is what makes pressing **Apply** an easy decision, and the
 * toast repeats it because it is what the reader most needs to know once the sheet is gone.
 *
 * ### Three previews are not imports, and each says which it is
 *
 * The service answers `200` for all three, so the decision is this module's ({@link previewKind}):
 * no rules files at all (the honest empty result, with what to do instead), files found but every
 * section and rule already in the workspace (an unchanged re-import — it says so rather than
 * offering an apply that would create nothing), and files found that parse to nothing (no headings
 * and no imperative bullets). **Apply** is drawn inert for all three, with the reason.
 */

import type { EnabledRepo } from "@/app/api/enablement";
import type { ErrorEnvelope } from "@/app/api/errors";
// Types only: `app/api/knowledge-import.ts` is server-only, and this module is imported by the sheet.
import type {
  RuleImportFile,
  RuleImportPreview,
  RuleImportResult,
  RuleImportTotals,
} from "@/app/api/knowledge-import";
import type { FocusRepo } from "@/app/shell/focus-repo";

import { repoRef } from "./create";
import type { KnowledgeToast } from "./toast";
import { FACTS_REGION_ID, SKILLS_REGION_ID } from "./view";

export { repoRef };

/* ------------------------------------------------------------------ the repository */

/**
 * The repository the sheet opens on.
 *
 * The header's focus-repo chip is the reader's standing answer to *which repository*, so when it
 * names one of the enabled repositories that is the choice; otherwise the first enabled one; and
 * `""` when there is none to import from.
 *
 * @param repos The enabled repositories the page read.
 * @param focus The chip's choice for this workspace, or `null` for *All repos*.
 * @returns The opening `owner/name`, or `""`.
 */
export function defaultRepo(repos: readonly EnabledRepo[], focus: FocusRepo | null): string {
  const focused = focus === null ? undefined : repos.find((repo) => repo.id === focus.id);
  const chosen = focused ?? repos[0];

  return chosen === undefined ? "" : repoRef(chosen);
}

/** Why the import cannot start: nothing to import from. */
export const IMPORT_NO_REPOS = "No repository is enabled in this workspace yet, so there is nothing to import from.";

/** Why the import cannot start: the list could not be read. */
export const IMPORT_REPOS_UNREAD = "The enabled repositories could not be read, so there is nothing to import from.";

/**
 * Why the head's import action is inert, or `undefined` when it is live.
 *
 * @param repos The enabled repositories, or `null` when the list could not be read.
 * @returns The reason, or `undefined`.
 */
export function importReason(repos: readonly EnabledRepo[] | null): string | undefined {
  if (repos === null) return IMPORT_REPOS_UNREAD;
  if (repos.length === 0) return IMPORT_NO_REPOS;

  return undefined;
}

/* ------------------------------------------------------------------ what a preview is */

/** Which of the four things a preview turned out to be. */
export type PreviewKind =
  /** Something would be written. */
  | "ready"
  /** The repository has none of the four files. */
  | "none-found"
  /** Files were found, and everything in them is already in the workspace. */
  | "unchanged"
  /** Files were found, and nothing in them reads as a section or a rule. */
  | "nothing-usable";

/**
 * How many rows an apply would write.
 *
 * @param totals The preview's totals.
 * @returns Drafts, updates and candidates, summed.
 */
export function plannedCount(totals: RuleImportTotals): number {
  return totals.skillDrafts + totals.skillUpdates + totals.factCandidates;
}

/**
 * How many candidates deduped away.
 *
 * @param totals The preview's totals.
 * @returns Skills and facts, summed.
 */
export function dedupedCount(totals: RuleImportTotals): number {
  return totals.dedupedSkills + totals.dedupedFacts;
}

/**
 * Which of the four things a preview is.
 *
 * @param preview The preview.
 * @returns Its kind.
 */
export function previewKind(preview: RuleImportPreview): PreviewKind {
  const { totals } = preview;

  if (totals.filesFound === 0) return "none-found";
  if (plannedCount(totals) > 0) return "ready";
  if (dedupedCount(totals) > 0) return "unchanged";

  return "nothing-usable";
}

/** The empty result's heading. */
export const NONE_FOUND_TITLE = "No rules files found";

/**
 * The empty result's guidance — what was looked for, and the two ways forward.
 *
 * @param repo The repository, `owner/name`.
 * @returns The sentence.
 */
export function noneFoundNote(repo: string): string {
  return (
    `${repo} has none of CLAUDE.md, AGENTS.md, .cursorrules or .github/copilot-instructions.md ` +
    "at its root. Add one and preview again — or write a skill directly with + New skill."
  );
}

/** The unchanged re-import's heading. */
export const UNCHANGED_TITLE = "Nothing has changed since the last import";

/** …and its note. */
export const UNCHANGED_NOTE =
  "Every section and rule in these files is already in this workspace — as an imported skill, or " +
  "as a fact in some status. There is nothing to apply.";

/** The parsed-to-nothing result's heading. */
export const NOTHING_USABLE_TITLE = "Nothing in these files reads as a skill or a rule";

/** …and its note. */
export const NOTHING_USABLE_NOTE =
  "A section becomes a skill draft when the file has headings to split at, and a line becomes a " +
  "fact candidate when it is a short imperative bullet. These files have neither, so there is " +
  "nothing to apply.";

/** Why **Apply** is inert, per kind — or `undefined` when it is live. */
export function applyReason(kind: PreviewKind): string | undefined {
  switch (kind) {
    case "none-found":
      return NONE_FOUND_TITLE;
    case "unchanged":
      return UNCHANGED_TITLE;
    case "nothing-usable":
      return NOTHING_USABLE_TITLE;
    default:
      return undefined;
  }
}

/* ------------------------------------------------------------------ what the preview says */

/**
 * `1 skill draft`, `3 skill drafts` — one count with its noun.
 *
 * @param count The count.
 * @param noun The noun, singular.
 * @returns The phrase.
 */
export function counted(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * The totals line: what an apply writes, and what it leaves out.
 *
 * `3 skill drafts · 1 skill update · 9 fact candidates (3 already known)`. Updates are listed only
 * when there are any — a first import has none, and a zero would be a claim about a mechanism the
 * reader has not met.
 *
 * @param totals The preview's totals.
 * @returns The line.
 */
export function totalsLine(totals: RuleImportTotals): string {
  const parts = [counted(totals.skillDrafts, "skill draft")];

  if (totals.skillUpdates > 0) parts.push(counted(totals.skillUpdates, "skill update"));
  parts.push(counted(totals.factCandidates, "fact candidate"));

  const deduped = dedupedCount(totals);
  const line = parts.join(" · ");

  return deduped === 0 ? line : `${line} (${String(deduped)} already known)`;
}

/** The statement the preview makes about what it will not do. */
export const NOTHING_ENABLED =
  "Nothing imported is enabled: skills arrive as drafts, facts as candidates awaiting review. " +
  "Applying changes what is stored, not what the loop uses.";

/**
 * One file's count line — `2 skill drafts · 5 fact candidates`, or `not found`.
 *
 * @param file The file as probed.
 * @returns The line.
 */
export function fileLine(file: RuleImportFile): string {
  if (!file.found) return FILE_NOT_FOUND;

  const line = `${counted(file.skills.planned, "skill draft")} · ${counted(file.facts.planned, "fact candidate")}`;

  return file.truncated ? `${line} · ${FILE_TRUNCATED}` : line;
}

/** What a probed-and-absent file says. */
export const FILE_NOT_FOUND = "not found";

/** What a file read only in part says. */
export const FILE_TRUNCATED = "first 256 KiB read";

/** The files table's caption. */
export const FILES_CAPTION = "Rules files probed";

/** Its two columns. */
export const FILE_COLUMN = "File";

/** …the second. */
export const YIELD_COLUMN = "Would create";

/** The skill samples' heading. */
export const SKILL_SAMPLES_TITLE = "Skill drafts, sampled";

/** The fact samples' heading. */
export const FACT_SAMPLES_TITLE = "Fact candidates, sampled";

/**
 * How a sample names its section — `§ Kconfig`, or the file when there was no heading.
 *
 * @param section The heading, or `null` for a file with no headings.
 * @param path The file.
 * @returns The provenance line.
 */
export function sectionLine(section: string | null, path: string): string {
  return section === null ? `${path} · whole file` : `${path} · § ${section}`;
}

/** What an `update` sample is marked with — its section changed since an earlier import. */
export const UPDATE_MARK = "update";

/* ------------------------------------------------------------------ what a refusal says */

/** The `code` for a role that may read knowledge and not import into it. */
export const FORBIDDEN_CODE = "forbidden";

/** The `code` for a repository no connected source can read. */
export const SOURCE_MISSING_CODE = "detection_source_missing";

/** The `code` for files or a workspace that changed since the preview. */
export const PREVIEW_STALE_CODE = "knowledge_import_preview_stale";

/** The `code` for an import past the caps. */
export const TOO_LARGE_CODE = "knowledge_import_too_large";

/** The `code` for a source holding its budget back. */
export const RATE_LIMITED_CODE = "knowledge_import_rate_limited";

/** The `code` for a host that refused the read. */
export const SOURCE_FAILED_CODE = "knowledge_import_source_failed";

/** The clause every refusal ends on. */
export const NOTHING_IMPORTED = "Nothing was imported.";

/** What a member who reached the write anyway is told. */
export const IMPORT_READ_ONLY = `Importing rules files is for workspace owners and admins. ${NOTHING_IMPORTED}`;

/** What a repository with no source is told. */
export const IMPORT_SOURCE_MISSING =
  `No connected source can read that repository. Connect one under Settings → Ticket sources. ${NOTHING_IMPORTED}`;

/** What a stale apply is told — and the way forward. */
export const IMPORT_STALE =
  `The files or this workspace changed since the preview, so the plan shown is no longer the plan. ${NOTHING_IMPORTED} Preview again.`;

/** What an import past the caps is told. */
export const IMPORT_TOO_LARGE =
  `These files would create more than an import may — 100 skill drafts or 500 fact candidates. Split the files, or write skills directly. ${NOTHING_IMPORTED}`;

/** What a rate-limited read is told. */
export const IMPORT_RATE_LIMITED = `The source is holding its budget back for the backlog sync. Try again in a minute. ${NOTHING_IMPORTED}`;

/** What a host refusal is told. */
export const IMPORT_SOURCE_FAILED = `The host refused to read the repository. ${NOTHING_IMPORTED}`;

/** What any other refusal is told, with the service's own sentence after it. */
export const IMPORT_FAILED = `The import could not run. ${NOTHING_IMPORTED}`;

/**
 * The service's refusal, as the sheet draws it.
 *
 * @param refusal The service's envelope, as `import-actions.ts` handed it back.
 * @returns The sentence.
 */
export function importFailure(refusal: ErrorEnvelope): string {
  switch (refusal.code) {
    case FORBIDDEN_CODE:
      return IMPORT_READ_ONLY;
    case SOURCE_MISSING_CODE:
      return IMPORT_SOURCE_MISSING;
    case PREVIEW_STALE_CODE:
      return IMPORT_STALE;
    case TOO_LARGE_CODE:
      return IMPORT_TOO_LARGE;
    case RATE_LIMITED_CODE:
      return IMPORT_RATE_LIMITED;
    case SOURCE_FAILED_CODE:
      return IMPORT_SOURCE_FAILED;
    default:
      return `${IMPORT_FAILED} ${refusal.message}`;
  }
}

/* ------------------------------------------------------------------ what the sheet says */

/** The sheet's heading, and its accessible name. */
export const IMPORT_TITLE = "Import rules files";

/** The note under the heading — what the flow does and in what order. */
export const IMPORT_NOTE =
  "Reads the repository's CLAUDE.md, AGENTS.md, .cursorrules and .github/copilot-instructions.md, " +
  "shows what an import would create, and writes only what was shown.";

/** The repository select. */
export const IMPORT_REPO_LABEL = "Repository";

/** The first step's control. */
export const PREVIEW_SUBMIT = "Preview";

/** …and what it says while the read is in flight. */
export const PREVIEWING = "Reading the rules files…";

/** The second step's primary control. */
export const APPLY_SUBMIT = "Apply";

/** …and what it says while the write is in flight. */
export const APPLYING = "Creating the drafts and candidates…";

/** The second step's way back to the first. */
export const PREVIEW_AGAIN = "Preview again";

/** The way out without writing anything. */
export const IMPORT_CANCEL = "Cancel";

/** The way out after the empty result — nothing to apply, so *Cancel* would be the wrong word. */
export const IMPORT_CLOSE = "Close";

/* ------------------------------------------------------------------ what the toast says */

/** The toast's link to the skills table's draft rows. */
export const DRAFTS_LINK = "Draft skills ↓";

/** The toast's link to the facts card's awaiting queue. */
export const AWAITING_LINK = "Facts awaiting review ↓";

/**
 * The toast an apply leaves under the head — what was written, from where, that none of it is
 * live, and the two places to look.
 *
 * The counts are the service's `created` lists, not the preview's totals: the apply wrote exactly
 * the preview or nothing, and the toast quotes what it wrote.
 *
 * @param result What the apply answered.
 * @returns The toast.
 */
export function importToast(result: RuleImportResult): KnowledgeToast {
  const skills = result.created.skills.length;
  const facts = result.created.facts.length;

  return {
    text:
      `Imported ${counted(skills, "skill draft")} and ${counted(facts, "fact candidate")} from ` +
      `${result.repo}. Nothing is enabled yet.`,
    links: [
      ...(skills > 0 ? [{ label: DRAFTS_LINK, href: `#${SKILLS_REGION_ID}` }] : []),
      ...(facts > 0 ? [{ label: AWAITING_LINK, href: `#${FACTS_REGION_ID}` }] : []),
    ],
  };
}
