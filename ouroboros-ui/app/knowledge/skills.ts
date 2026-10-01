/**
 * Every sentence the skills table says, and every decision it makes that is not a write
 * (BG.2, [#418](https://github.com/NobuData/ouroboros/issues/418)) — mockup 14's skills card.
 *
 * **Framework-free and pure**, like `app/knowledge/view.ts`: the table (`skills-table.tsx`) and its
 * suite read from here, so a cell the reader sees is the cell the suite asserts.
 *
 * ### Six rows, four kinds of truth
 *
 * The mockup's six rows are one table with four states, and each state is a fact the service
 * states rather than a flag the page invents:
 *
 * - **The locked switch is the API's refusal, not a `disabled` attribute.** `hil-safety` is
 *   `required`, and `PATCH /api/v1/skills/{slug}` with `enabled: false` is `403
 *   skill_required_locked` for every role. The switch is drawn locked and stays pressable: the
 *   press makes the call, the call is refused, and the refusal's own sentence is what the row
 *   shows and announces. {@link switchFailure} turns the envelope into that sentence.
 * - **Used-by is a statistic and carries its footnote.** `61% of runs` has a numerator, a
 *   denominator and a window, and {@link usedBy} states all three in the cell's note. `—` is a
 *   real zero — *enabled, and nothing has used it* — unless the row is a draft, where it means
 *   *nothing can*.
 * - **`auto-generated nightly` is a promise about maintenance.** The tag carries when the
 *   generator last published ({@link generatedNote}), a regenerate action, and the warning that a
 *   manual edit is overwritten by the next generation ({@link GENERATED_OVERWRITE}).
 * - **The draft row is tinted because it is inert.** `power-budget-checks` does nothing to any
 *   run, and {@link DRAFT_NEVER_INJECTS} says so where the reader looks for its use.
 *
 * ### The editor door, honestly
 *
 * The issue opens a row in the code-view frame. That frame opens `skills/<slug>.skill.md` with
 * X.2 ([#181](https://github.com/NobuData/ouroboros/issues/181)), which is not built — the same
 * fact BG.1 recorded for the create's landing. A door that opens nothing is what the design
 * system forbids (§ 3.5), so the row's door is drawn inert with {@link editorReason} as the
 * reason a press reveals, and the generated row's carries {@link GENERATED_OVERWRITE} with it,
 * so the warning the issue asks for is where the door is on the day it opens. The card head's
 * **Open in editor →** and the caption's link lead to the Workflow Studio itself, which exists.
 */

import type { ErrorEnvelope } from "@/app/api/errors";
import type { Reading } from "@/app/api/reading";
import type { RepoMapReport } from "@/app/api/repo-map";
import type { SkillList, SkillScope, SkillStat, SkillStats, SkillSummary } from "@/app/api/skills";
import { coarseAgo } from "@/app/format";
import type { SortDirection } from "@/app/ui";

import type { KnowledgeToast } from "./toast";

/* ------------------------------------------------------------------ the head */

/** The card head's link — the mockup's `Open in editor →`. */
export const OPEN_IN_EDITOR = "Open in editor →";

/** What the head's link and the caption's say about where they lead, until #181. */
export const STUDIO_NOTE =
  "Opens the Workflow Studio. Its tree lists skills/<slug>.skill.md with #181; until then a skill " +
  "is edited from its row once that lands.";

/**
 * The head's count — the mockup's `6 active` pill, from the service's own figure, which never
 * counts a draft.
 *
 * @param list The skills.
 * @returns `5 active`, or `1 active`.
 */
export function activeCount(list: SkillList): string {
  return `${String(list.active)} active`;
}

/* ------------------------------------------------------------------ the table */

/** The table's name in the accessibility tree — the mockup's card has no visible caption. */
export const SKILLS_TABLE_NAME = "Skills of the workspace";

/** The five headings, as the mockup spells them. */
export const COLUMN_SKILL = "Skill";
export const COLUMN_SCOPE = "Scope";
export const COLUMN_USED_BY = "Used by";
export const COLUMN_UPDATED = "Updated";
export const COLUMN_ON = "On";

/** The caption under the table, in three parts around its link. */
export const CAPTION_LEAD = "Skills are markdown with frontmatter — edit in the ";
export const CAPTION_LINK = "Workflow Studio editor";
export const CAPTION_TAIL = ".";

/** What stands in the card when the list could not be read. */
export const SKILLS_UNREAD_TITLE = "The skills could not be read.";

/**
 * What stands in the card when the workspace has no skills at all. The note under it — what a
 * skill is, and the two ways one arrives — is `states.ts`'s `noSkillsNote` (#422).
 */
export const NO_SKILLS_TITLE = "No skills yet.";

/* ------------------------------------------------------------------ scope */

/** The scope tag's text — the mockup's `repo` and `org-wide`. */
const SCOPE_LABEL: Record<SkillScope, string> = {
  org: "org-wide",
  repo: "repo",
  workflow: "workflow",
};

/**
 * The scope tag.
 *
 * @param scope The scope.
 * @returns `org-wide`, `repo` or `workflow`.
 */
export function scopeLabel(scope: SkillScope): string {
  return SCOPE_LABEL[scope];
}

/**
 * What the scope tag stands for, as its tooltip — the referent the tag compresses away.
 *
 * @param skill The skill.
 * @returns A sentence naming the repository, the workflow, or the whole workspace.
 */
export function scopeNote(skill: SkillSummary): string {
  if (skill.scope === "repo") return `Applies to ${skill.repoRef ?? "one repository"}.`;
  if (skill.scope === "workflow") return `Applies to the workflow ${skill.workflow?.slug ?? "it names"}.`;

  return "Applies to every repository of the workspace.";
}

/* ------------------------------------------------------------------ used by */

/** The Used-by cell: its text, its footnote, and what kind of figure it is. */
export interface UsedBy {
  /** The cell's text — `61% of runs`, `every run`, `—`. */
  readonly label: string;
  /** The footnote: the window and the denominator, or why there is no figure. */
  readonly note: string;
  /** Whether the label is a real zero — nothing used it — rather than a share or an absence. */
  readonly zero: boolean;
  /** Whether the row is a draft, whose `—` means *nothing can use it*. */
  readonly inert: boolean;
}

/** The mockup's `—`: the service's own label for a skill nothing carried. */
export const NONE_LABEL = "—";

/** What stands in the cell when the stats could not be read. */
export const NOT_COUNTED_LABEL = "not counted";

/** The draft row's footnote: its `—` is inert, not merely unused. */
export const DRAFT_NEVER_INJECTS =
  "Drafts never inject. This skill does nothing to any run until it is published and promoted " +
  "out of draft, so — here means nothing can use it, not that nothing has.";

/**
 * A window's bounds as dates, for a footnote — `2026-09-01 to 2026-09-30`.
 *
 * The calendar date of each ISO instant, which is deterministic in every locale and time zone a
 * server and a browser might disagree about.
 *
 * @param window The stats' window.
 * @returns The two dates joined.
 */
function windowDates(window: SkillStats["window"]): string {
  return `${window.from.slice(0, 10)} to ${window.to.slice(0, 10)}`;
}

/**
 * The footnote behind one skill's figure: the numerator, the denominator, the window, and the
 * injection count across every consumer.
 *
 * @param stat The skill's line.
 * @param window The stats' window.
 * @param enabled Whether the skill is switched on, which is what a zero means differently by.
 * @returns The sentence.
 */
function usedByNote(stat: SkillStat, window: SkillStats["window"], enabled: boolean): string {
  const { carried, inScope } = stat.usedBy;
  const share =
    `${String(carried)} of ${String(inScope)} runs in its scope carried it over the last ` +
    `${String(window.days)} days (${windowDates(window)}); ${String(stat.injections)} injections ` +
    "across every consumer.";

  if (carried > 0) return share;

  return `${share} ${enabled ? "It is enabled, and nothing has used it yet." : "It is switched off, so nothing can use it."}`;
}

/**
 * The Used-by cell for one skill.
 *
 * @param skill The skill.
 * @param stats The stats reading — every skill's line, or why none could be read.
 * @returns The cell. A draft answers `—` and {@link DRAFT_NEVER_INJECTS} whatever the stats say,
 *   because a draft is never active; an unread stats reading answers {@link NOT_COUNTED_LABEL}
 *   with the service's reason, never a `—` that would claim a zero nobody counted.
 */
export function usedBy(skill: SkillSummary, stats: Reading<SkillStats>): UsedBy {
  if (skill.draft) return { label: NONE_LABEL, note: DRAFT_NEVER_INJECTS, zero: true, inert: true };

  if (!stats.ok) {
    return { label: NOT_COUNTED_LABEL, note: `Use could not be counted: ${stats.reason}`, zero: false, inert: false };
  }

  const stat = stats.value.skills.find((line) => line.slug === skill.slug);

  if (stat === undefined) {
    return {
      label: NOT_COUNTED_LABEL,
      note: "Use could not be counted: the stats named no line for this skill.",
      zero: false,
      inert: false,
    };
  }

  return {
    label: stat.usedBy.label,
    note: usedByNote(stat, stats.value.window, skill.enabled),
    zero: stat.usedBy.carried === 0,
    inert: false,
  };
}

/* ------------------------------------------------------------------ updated */

/** The mockup's warn tag on the required row. */
export const REQUIRED_TAG = "required — cannot disable";

/** What the required tag stands for — the switch's description before any press. */
export const REQUIRED_NOTE =
  "Required by policy: the switch is locked on, and the service refuses to switch it off.";

/** The mockup's tag on the generated row. */
export const GENERATED_TAG = "auto-generated nightly";

/** What opening a generated skill in the editor must say first. */
export const GENERATED_OVERWRITE =
  "This skill is generated. A nightly job rebuilds repo-map from the repository, and manual " +
  "edits are overwritten by the next generation — regenerate it rather than editing it.";

/** The regenerate action's visible glyph and its accessible name's verb. */
export const REGENERATE_GLYPH = "↻";

/** The regenerate action while its call is in flight. */
export const REGENERATING = "Regenerating…";

/** Why a member's regenerate is inert. */
export const MEMBER_REGENERATE_REASON = "Only an owner or an admin can regenerate a skill.";

/** Why a generated skill with no repository cannot be regenerated — a row the seed never makes. */
export const NO_REPO_REASON = "This generated skill names no repository to regenerate from.";

/**
 * The regenerate action's accessible name.
 *
 * @param slug The skill's slug.
 * @returns `Regenerate repo-map now`.
 */
export function regenerateName(slug: string): string {
  return `Regenerate ${slug} now`;
}

/** The Updated cell, in the four shapes the mockup draws it. */
export type Updated =
  /** `v12 · 2d ago` — the version in force and how old it is. */
  | { readonly kind: "version"; readonly text: string }
  /** A skill with no version yet — a fresh create, before its first publish. */
  | { readonly kind: "unpublished"; readonly text: string }
  /** The required row: the warn tag, with the version behind it in the note. */
  | { readonly kind: "required"; readonly tag: string; readonly note: string }
  /** The generated row: the tag, when the generator last published, and the regenerate. */
  | { readonly kind: "generated"; readonly tag: string; readonly note: string };

/** What an unpublished skill's cell says. */
export const UNPUBLISHED_TEXT = "no version yet";

/**
 * The version in force and its age — `v12 · 2d ago`.
 *
 * @param skill The skill.
 * @param now The instant the page was read.
 * @returns The phrase, or `null` before a first publish.
 */
export function versionAge(skill: SkillSummary, now: Date): string | null {
  if (skill.currentVersion === null) return null;

  const version = `v${String(skill.currentVersion)}`;

  return skill.publishedAt === null ? version : `${version} · ${coarseAgo(skill.publishedAt, now)}`;
}

/**
 * When the generator last published — the `auto-generated nightly` tag's footnote, which is
 * what tells the reader whether it actually ran last night.
 *
 * @param skill The generated skill.
 * @param now The instant the page was read.
 * @returns `Last generated 7h ago (2026-09-30T03:00:00.000Z), v60.`, or a sentence for a
 *   generator that has not published yet.
 */
export function generatedNote(skill: SkillSummary, now: Date): string {
  if (skill.publishedAt === null || skill.currentVersion === null) {
    return "Not generated yet: the nightly job has not published a version.";
  }

  return (
    `Last generated ${coarseAgo(skill.publishedAt, now)} (${skill.publishedAt}), ` +
    `v${String(skill.currentVersion)}. A nightly job rebuilds it.`
  );
}

/**
 * The Updated cell for one skill.
 *
 * The required tag wins over everything, as the mockup draws `hil-safety` (its `v3` is in the
 * note); the generated tag next, as it draws `repo-map`; then the version and its age.
 *
 * @param skill The skill.
 * @param now The instant the page was read.
 * @returns The cell.
 */
export function updated(skill: SkillSummary, now: Date): Updated {
  if (skill.required) {
    const version = versionAge(skill, now);

    return { kind: "required", tag: REQUIRED_TAG, note: version === null ? REQUIRED_NOTE : `${REQUIRED_NOTE} ${version}.` };
  }

  if (skill.origin === "generated") return { kind: "generated", tag: GENERATED_TAG, note: generatedNote(skill, now) };

  const text = versionAge(skill, now);

  return text === null ? { kind: "unpublished", text: UNPUBLISHED_TEXT } : { kind: "version", text };
}

/* ------------------------------------------------------------------ the switch */

/** Why a member's switches are read-only. */
export const MEMBER_SWITCH_REASON =
  "Only an owner or an admin can switch a skill; the service refuses anyone else.";

/** The switch, in the three ways it is drawn. */
export type SwitchState =
  /** An ordinary switch: a press records the change. */
  | { readonly kind: "toggle"; readonly label: string }
  /** The locked switch: drawn locked, pressable, and refused by the service on press. */
  | { readonly kind: "locked"; readonly label: string; readonly description: string }
  /** A member's switch: its real state, inert, with the reason. */
  | { readonly kind: "readonly"; readonly label: string; readonly reason: string };

/**
 * The switch's accessible name — what a press would do.
 *
 * @param skill The skill.
 * @returns `Disable zephyr-conventions` or `Enable power-budget-checks`.
 */
export function switchLabel(skill: SkillSummary): string {
  return `${skill.enabled ? "Disable" : "Enable"} ${skill.slug}`;
}

/**
 * How one skill's switch is drawn.
 *
 * @param skill The skill.
 * @param mayAdminister Whether the reader is an `owner` or an `admin`.
 * @returns The state. A member's is read-only whatever the row; a required row's is locked;
 *   any other is an ordinary toggle.
 */
export function switchState(skill: SkillSummary, mayAdminister: boolean): SwitchState {
  const label = switchLabel(skill);

  if (!mayAdminister) return { kind: "readonly", label, reason: MEMBER_SWITCH_REASON };
  if (skill.required) return { kind: "locked", label, description: REQUIRED_NOTE };

  return { kind: "toggle", label };
}

/**
 * The sentence a refused switch shows — the service's own reason, led by what did not happen.
 *
 * @param refusal The service's envelope.
 * @returns `Not changed: required by policy — cannot disable.` for the lock; the role sentence
 *   for a member who reached the action anyway; the service's message otherwise.
 */
export function switchFailure(refusal: ErrorEnvelope): string {
  if (refusal.code === "forbidden") return `Not changed: ${MEMBER_SWITCH_REASON}`;

  return `Not changed: ${refusal.message.replace(/\.$/, "")}.`;
}

/* ------------------------------------------------------------------ the draft row */

/** The mockup's `draft` pill. */
export const DRAFT_PILL = "draft";

/* ------------------------------------------------------------------ the editor door */

/** A row's door into the editor: what it is called, why it is closed, and what it must say. */
export interface EditorAffordance {
  /** The door's accessible name. */
  readonly label: string;
  /** Why it is inert until #181. */
  readonly reason: string;
  /** The overwrite warning, for a generated skill; `null` for any other. */
  readonly warning: string | null;
}

/**
 * Why a row's editor door is closed.
 *
 * @param path Where the code view will open the skill — `skills/hil-safety.skill.md`.
 * @returns The sentence.
 */
export function editorReason(path: string): string {
  return `Opening ${path} in the code-view editor arrives with #181; until then this row opens nothing.`;
}

/**
 * One row's editor door.
 *
 * @param skill The skill.
 * @returns The door, with {@link GENERATED_OVERWRITE} on a generated skill's.
 */
export function editorAffordance(skill: SkillSummary): EditorAffordance {
  return {
    label: `Open ${skill.slug} in the editor`,
    reason: editorReason(skill.path),
    warning: skill.origin === "generated" ? GENERATED_OVERWRITE : null,
  };
}

/* ------------------------------------------------------------------ regenerate */

/** Why a generation was skipped, as a clause. */
const SKIP_REASON: Record<NonNullable<RepoMapReport["reason"]>, string> = {
  no_source: "the repository could not be read",
  rate_limit: "the host rate-limited the read",
  host_error: "the host failed",
};

/**
 * The toast a regenerate leaves — the report, in one sentence.
 *
 * @param report The generator's report.
 * @param now The instant the report was read.
 * @returns The toast, with no links: the row it names is the one the reader pressed.
 */
export function regenerateToast(report: RepoMapReport, now: Date): KnowledgeToast {
  const skill = report.skill ?? "repo-map";
  const version = report.version === null ? "" : `v${String(report.version)}`;

  if (report.outcome === "published") {
    return {
      text:
        `${skill} regenerated for ${report.repo}: ${version} published ` +
        `${coarseAgo(report.generatedAt, now)}, ${String(report.modules)} modules` +
        `${report.truncated ? " (tree listing truncated)" : ""}.`,
      links: [],
    };
  }

  if (report.outcome === "unchanged") {
    return { text: `${skill} regenerated for ${report.repo}: unchanged since ${version} — nothing written.`, links: [] };
  }

  const why = report.reason === null ? "the generator skipped it" : SKIP_REASON[report.reason];

  return { text: `${skill} was not regenerated for ${report.repo}: ${why}.`, links: [] };
}

/**
 * The sentence a refused regenerate shows.
 *
 * @param refusal The service's envelope.
 * @returns The wait for a run within a minute of the last; the role sentence for a member; the
 *   service's message otherwise.
 */
export function regenerateFailure(refusal: ErrorEnvelope): string {
  if (refusal.code === "repo_map_regenerate_too_soon") {
    const seconds = refusal.details["retryAfterSeconds"];
    const wait = typeof seconds === "number" ? ` — try again in ${String(seconds)}s` : "";

    return `Regenerated under a minute ago${wait}.`;
  }

  if (refusal.code === "forbidden") return MEMBER_REGENERATE_REASON;

  return refusal.message;
}

/* ------------------------------------------------------------------ sorting */

/** The columns the reader may sort by — every one but the switches. */
export type SortKey = "skill" | "scope" | "usedBy" | "updated";

/** Which column the table is sorted by, and which way. */
export interface SortState {
  readonly key: SortKey;
  readonly direction: SortDirection;
}

/**
 * What a press on a heading does: sort by it ascending; press again, descending; a third time,
 * back to the service's order.
 *
 * @param current The sort in force, or `null` for the service's order.
 * @param key The heading pressed.
 * @returns The next sort.
 */
export function nextSort(current: SortState | null, key: SortKey): SortState | null {
  if (current === null || current.key !== key) return { key, direction: "ascending" };
  if (current.direction === "ascending") return { key, direction: "descending" };

  return null;
}

/**
 * A column's `aria-sort`.
 *
 * @param current The sort in force, or `null`.
 * @param key The column.
 * @returns Its direction while it is the sorted column, else `null`.
 */
export function sortDirection(current: SortState | null, key: SortKey): SortDirection | null {
  return current !== null && current.key === key ? current.direction : null;
}

/** The scopes in order of reach — the ladder's, widest first. */
const SCOPE_RANK: Record<SkillScope, number> = { org: 0, repo: 1, workflow: 2 };

/**
 * A skill's share of its scope's runs, for sorting — `-1` where there is no figure, so drafts
 * and uncounted rows sort below a real zero.
 *
 * @param skill The skill.
 * @param stats The stats reading.
 * @returns The share, or `-1`.
 */
function share(skill: SkillSummary, stats: Reading<SkillStats>): number {
  if (skill.draft || !stats.ok) return -1;

  const stat = stats.value.skills.find((line) => line.slug === skill.slug);
  if (stat === undefined) return -1;

  return stat.usedBy.inScope === 0 ? 0 : stat.usedBy.carried / stat.usedBy.inScope;
}

/**
 * The instant a skill's version in force was published, for sorting — `-1` before a publish.
 *
 * @param skill The skill.
 * @returns Milliseconds since the epoch, or `-1`.
 */
function publishedMs(skill: SkillSummary): number {
  return skill.publishedAt === null ? -1 : new Date(skill.publishedAt).getTime();
}

/**
 * The rows in the order the sort asks for.
 *
 * Ties break on the slug, so two `repo` rows keep a stable order across presses; the service's
 * order is kept exactly when there is no sort.
 *
 * @param skills The rows, in the service's order.
 * @param sort The sort in force, or `null`.
 * @param stats The stats reading, which the Used-by column sorts by.
 * @returns A new array, sorted.
 */
export function sortSkills(
  skills: readonly SkillSummary[],
  sort: SortState | null,
  stats: Reading<SkillStats>,
): readonly SkillSummary[] {
  if (sort === null) return [...skills];

  const bySlug = (a: SkillSummary, b: SkillSummary): number => a.slug.localeCompare(b.slug);
  const compare: Record<SortKey, (a: SkillSummary, b: SkillSummary) => number> = {
    skill: bySlug,
    scope: (a, b) => SCOPE_RANK[a.scope] - SCOPE_RANK[b.scope] || bySlug(a, b),
    usedBy: (a, b) => share(a, stats) - share(b, stats) || bySlug(a, b),
    updated: (a, b) => publishedMs(a) - publishedMs(b) || bySlug(a, b),
  };
  const sign = sort.direction === "ascending" ? 1 : -1;

  return [...skills].sort((a, b) => sign * compare[sort.key](a, b));
}
