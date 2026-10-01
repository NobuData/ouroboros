/**
 * Every sentence the scope card says, and every decision its ladder makes
 * (BG.5, [#421](https://github.com/NobuData/ouroboros/issues/421)) — mockup 14's `SCOPE` card.
 *
 * **Framework-free and pure**, like `app/knowledge/facts.ts`: the card (`scope-card.tsx`), the
 * screen's filter and the suites read from here.
 *
 * ### The ladder is a diagram of the resolution, so it counts what resolves
 *
 * Decision **K8**: workflow beats repo beats org, and the caption — *Closest scope wins on
 * conflict.* — is that algorithm printed on the page. The three steps count **registry truth**:
 * each skill the list calls `active` (enabled, published, not a draft — the service's own word
 * for *context assembly could inject it*), at the scope the registry holds it at, and at the repo
 * step the **confirmed** facts of that repository, since only confirmed facts inject. So a switch
 * moves a count, a scope move carries a skill from one step to another, and a draft is in no
 * count at all — the note behind each count says how many the step holds altogether, so the
 * difference is explained rather than discovered.
 *
 * ### The current step is the tenant chip's
 *
 * The header's chip is the reader's standing answer to *where am I looking*
 * (`app/shell/focus-repo.ts`). With a repository in focus the **Repo** step names it, counts it
 * and is highlighted; with *All repos* the **Org** step is the current one and the Repo step
 * counts every repository's. A focus that is no longer an enabled repository reads as none,
 * rather than highlighting a step that names nothing.
 *
 * ### Each step filters the page
 *
 * Pressing a step narrows the skills table and the facts card to that scope
 * ({@link skillInFilter}, {@link factInFilter}); pressing it again, or the note's own action,
 * shows every scope. Facts are workspace-wide or a repository's — none belongs to a workflow —
 * which the facts card says in place of an empty list.
 */

import type { EnabledRepo } from "@/app/api/enablement";
import type { Fact, FactList } from "@/app/api/facts";
import type { Reading } from "@/app/api/reading";
import type { SkillList, SkillScope, SkillSummary } from "@/app/api/skills";
import type { FocusRepo } from "@/app/shell/focus-repo";

import { repoRef } from "./create";
import { counted } from "./import";

/* ------------------------------------------------------------------ the card */

/** The caption under the ladder, verbatim: the resolution algorithm in one sentence. */
export const SCOPE_CAPTION = "Closest scope wins on conflict.";

/** The ladder's name in the accessibility tree. */
export const LADDER_NAME = "Scope ladder — farthest to closest";

/** The arrow between two steps. */
export const LADDER_ARROW = "↓";

/** What the current step is called, for a reader who cannot see the highlight. */
export const CURRENT_LABEL = "current";

/** The Repo step's name with no repository in focus — the tenant chip's own words. */
export const ALL_REPOS = "All repos";

/** The Workflow step's name — the mockup's `overrides`. */
export const WORKFLOW_NAME = "overrides";

/** What a count reads when its list could not be read. */
export const NOT_READ = "not read";

/** Under the ladder in a workspace with no skills at all. */
export const SCOPE_COLD =
  "No skills yet. Each step counts up as skills are written or imported and switched on.";

/* ------------------------------------------------------------------ the steps */

/** What narrows the page: one scope, and for the Repo step the repository it names. */
export interface ScopeFilter {
  /** The scope the page is narrowed to. */
  readonly scope: SkillScope;
  /** `owner/name` when the Repo step names one repository; `null` for every repository. */
  readonly repo: string | null;
}

/** One step of the ladder, as the card draws it. */
export interface LadderStep {
  /** The scope the step stands for. */
  readonly scope: SkillScope;
  /** The mockup's level — `Org`, `Repo`, `Workflow`. */
  readonly level: string;
  /** What the step names — the workspace, the repository, or `overrides`. */
  readonly name: string;
  /** The count — `3 skills`, `4 skills + 5 facts`, `1`. */
  readonly count: string;
  /** What the count is of, and how many the step holds altogether — the count's footnote. */
  readonly note: string;
  /** Whether this is the scope the tenant chip is looking at. */
  readonly current: boolean;
  /** What pressing the step narrows the page to. */
  readonly filter: ScopeFilter;
}

/** What the ladder is drawn from. */
export interface LadderInput {
  /** The workspace's skills, or why they could not be read. */
  readonly skills: Reading<SkillList>;
  /** The workspace's facts, or why they could not be read. */
  readonly facts: Reading<FactList>;
  /** The enabled repositories, or why they could not be read. */
  readonly repos: Reading<readonly EnabledRepo[]>;
  /** The tenant chip's choice for this workspace, or `null` for *All repos*. */
  readonly focus: FocusRepo | null;
  /** The workspace's slug — the Org step's name. */
  readonly workspace: string;
}

/**
 * The repository the tenant chip is looking at, when it is one the workspace has enabled.
 *
 * @param repos The enabled repositories, or why they could not be read.
 * @param focus The chip's choice, or `null`.
 * @returns The repository; `null` for *All repos*, an unread list, or a choice no longer enabled.
 */
export function focusedRepo(repos: Reading<readonly EnabledRepo[]>, focus: FocusRepo | null): EnabledRepo | null {
  if (focus === null || !repos.ok) return null;

  return repos.value.find((repo) => repo.id === focus.id) ?? null;
}

/**
 * Whether two `owner/name` references are the same repository — compared as the service does,
 * case-insensitively.
 *
 * @param a One reference, or `null`.
 * @param b The other.
 * @returns `true` when both name the same repository.
 */
function sameRepo(a: string | null, b: string): boolean {
  return a !== null && a.toLowerCase() === b.toLowerCase();
}

/**
 * Whether the filter keeps a skill.
 *
 * @param skill The skill.
 * @param filter The filter.
 * @returns `true` for a skill at the filter's scope — and, when the filter names a repository,
 *   of that repository.
 */
export function skillInFilter(skill: SkillSummary, filter: ScopeFilter): boolean {
  if (skill.scope !== filter.scope) return false;

  return filter.scope !== "repo" || filter.repo === null || sameRepo(skill.repoRef, filter.repo);
}

/**
 * Whether the filter keeps a fact.
 *
 * @param fact The fact.
 * @param filter The filter.
 * @returns `true` for a workspace-wide fact under the Org filter, a repository's under the Repo
 *   filter (the named repository's, when it names one), and never under the Workflow filter — a
 *   fact has no workflow scope.
 */
export function factInFilter(fact: Fact, filter: ScopeFilter): boolean {
  if (filter.scope === "org") return fact.repoRef === null;
  if (filter.scope === "workflow") return false;

  return fact.repoRef !== null && (filter.repo === null || sameRepo(fact.repoRef, filter.repo));
}

/**
 * The footnote behind a skills count: what is counted, and how many the step holds altogether.
 *
 * @param inForce The skills counted.
 * @param held Every skill at the step.
 * @param what The step's skills, as a phrase — `org-wide skills`.
 * @returns The sentence.
 */
function skillsNote(inForce: number, held: number, what: string): string {
  if (held === 0) return `No ${what} yet.`;

  return (
    `${String(inForce)} of ${String(held)} ${what} in force — enabled, published and not a draft. ` +
    "A draft or a switched-off skill is not counted, because it would not inject."
  );
}

/**
 * The three steps, farthest scope first — the mockup's Org ↓ Repo ↓ Workflow.
 *
 * @param input See {@link LadderInput}.
 * @returns The steps. With the skills unread every count is {@link NOT_READ} and carries the
 *   service's reason; with only the facts unread the Repo step says so beside its skills.
 */
export function ladder({ skills, facts, repos, focus, workspace }: LadderInput): readonly LadderStep[] {
  const focused = focusedRepo(repos, focus);
  const repo = focused === null ? null : repoRef(focused);

  const filters: Record<SkillScope, ScopeFilter> = {
    org: { scope: "org", repo: null },
    repo: { scope: "repo", repo },
    workflow: { scope: "workflow", repo: null },
  };

  /**
   * The skills a step holds, and how many of them are in force.
   *
   * @param scope The step.
   * @returns Both figures, or `null` with the list unread.
   */
  function figures(scope: SkillScope): { readonly inForce: number; readonly held: number } | null {
    if (!skills.ok) return null;

    const held = skills.value.skills.filter((skill) => skillInFilter(skill, filters[scope]));

    return { inForce: held.filter((skill) => skill.active).length, held: held.length };
  }

  const unread = skills.ok ? "" : `The skills could not be read: ${skills.reason}`;
  const org = figures("org");
  const atRepo = figures("repo");
  const workflow = figures("workflow");
  const where = focused === null ? "repository-scoped skills" : `skills of ${focused.name}`;

  return [
    {
      scope: "org",
      level: "Org",
      name: workspace,
      count: org === null ? NOT_READ : counted(org.inForce, "skill"),
      note: org === null ? unread : skillsNote(org.inForce, org.held, "org-wide skills"),
      current: focused === null,
      filter: filters.org,
    },
    {
      scope: "repo",
      level: "Repo",
      name: focused === null ? ALL_REPOS : focused.name,
      count: atRepo === null ? NOT_READ : `${counted(atRepo.inForce, "skill")} + ${factsCount(facts, filters.repo)}`,
      note: atRepo === null ? unread : `${skillsNote(atRepo.inForce, atRepo.held, where)} ${factsNote(facts, filters.repo)}`,
      current: focused !== null,
      filter: filters.repo,
    },
    {
      scope: "workflow",
      level: "Workflow",
      name: WORKFLOW_NAME,
      count: workflow === null ? NOT_READ : String(workflow.inForce),
      note:
        workflow === null
          ? unread
          : `${skillsNote(workflow.inForce, workflow.held, "workflow-scoped skills")} ` +
            "A workflow's skill is the closest scope, so it overrides a repository's or the workspace's of the same name.",
      current: false,
      filter: filters.workflow,
    },
  ];
}

/**
 * The Repo step's facts — the confirmed ones the filter keeps.
 *
 * @param facts The facts, or why they could not be read.
 * @param filter The Repo step's filter.
 * @returns `5 facts`, or `facts not read`.
 */
function factsCount(facts: Reading<FactList>, filter: ScopeFilter): string {
  if (!facts.ok) return `facts ${NOT_READ}`;

  return counted(facts.value.items.filter((fact) => fact.status === "confirmed" && factInFilter(fact, filter)).length, "fact");
}

/**
 * The footnote behind the Repo step's facts.
 *
 * @param facts The facts, or why they could not be read.
 * @param filter The Repo step's filter.
 * @returns The sentence.
 */
function factsNote(facts: Reading<FactList>, filter: ScopeFilter): string {
  if (!facts.ok) return `The facts could not be read: ${facts.reason}`;

  const held = facts.value.items.filter((fact) => factInFilter(fact, filter));
  const confirmed = held.filter((fact) => fact.status === "confirmed").length;

  if (held.length === 0) return "No repository facts yet.";

  return `${String(confirmed)} of ${String(held.length)} repository facts confirmed — only confirmed facts inject.`;
}

/**
 * Whether the ladder is cold: the list was read, and the workspace has no skills at all.
 *
 * @param skills The skills, or why they could not be read.
 * @returns `true` for a read, empty list.
 */
export function ladderIsCold(skills: Reading<SkillList>): boolean {
  return skills.ok && skills.value.skills.length === 0;
}

/* ------------------------------------------------------------------ the filter */

/** The action that clears the filter. */
export const SHOW_EVERY_SCOPE = "Show every scope";

/** The skills table, narrowed to a scope that holds no skill. */
export const NO_SKILLS_AT_SCOPE = "No skill at this scope.";

/** The facts card, narrowed to a scope that holds no fact. */
export const NO_FACTS_AT_SCOPE = "No fact at this scope.";

/** The facts card under the Workflow filter: a fact has no workflow scope. */
export const NO_WORKFLOW_FACTS =
  "Facts are workspace-wide or a repository's — none belongs to a workflow.";

/**
 * What the page says while it is narrowed.
 *
 * @param step The step the page is narrowed to.
 * @returns The sentence.
 */
export function filterNote(step: LadderStep): string {
  return `Showing only the ${step.level} scope — ${step.name}. Skills and facts at other scopes are hidden.`;
}

/**
 * What an empty facts card says under a filter.
 *
 * @param filter The filter.
 * @returns The sentence for its scope.
 */
export function noFactsNote(filter: ScopeFilter): string {
  return filter.scope === "workflow" ? NO_WORKFLOW_FACTS : NO_FACTS_AT_SCOPE;
}
