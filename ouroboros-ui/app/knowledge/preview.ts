/**
 * Every sentence the manifest preview says, and every decision it makes that is not the service's
 * (BG.5, [#421](https://github.com/NobuData/ouroboros/issues/421)) — the scope card's
 * **Preview injection ▾**.
 *
 * **Framework-free and pure**, like `app/knowledge/scope.ts`: the dialog (`manifest-preview.tsx`)
 * and the suites read from here.
 *
 * ### The check on the page's central promise
 *
 * The facts card says *"Confirmed facts are injected into every run's context"*, and a claim
 * nobody can check is one that quietly stops being true. The preview is the check: choose a scope
 * and a consumer, and see BF.5's manifest (#414) — the answer a consumer would be handed, not a
 * second resolution written here. {@link previewView} only **arranges** it:
 *
 * - the resolved skills in the manifest's own order, `required` ones badged and said to be
 *   un-overridable;
 * - the confirmed facts;
 * - the token estimate against the budget it was held to;
 * - **every trim, named** — what was dropped, from which tier, and why. A context truncated in
 *   silence is the hardest problem to diagnose from outside, so a trim is the one thing here drawn
 *   in the warn hue;
 * - and **what is not there, with the reason**: the service's `excluded` (switched off, or
 *   overridden by a closer or a required skill), joined by the registry's skills the manifest
 *   never considered — a draft, a skill scoped elsewhere, one with nothing published.
 *
 * That last list is the only thing derived on this side, and only as an explanation: *why didn't
 * my skill take effect?* has four answers — draft, wrong scope, overridden, trimmed — and each is
 * a line here. What is in the manifest is never recomputed.
 */

import type { ContextConsumer, ContextManifest, ExcludedSkill, TrimmedEntry } from "@/app/api/context";
import type { EnabledRepo } from "@/app/api/enablement";
import type { ErrorEnvelope } from "@/app/api/errors";
import type { FactList } from "@/app/api/facts";
import type { Reading } from "@/app/api/reading";
import type { SkillList, SkillSummary } from "@/app/api/skills";
import { compactNumber } from "@/app/format";

import { repoRef } from "./create";
import { counted } from "./import";
import { scopeLabel } from "./skills";

/* ------------------------------------------------------------------ the action and its dialog */

/** The scope card's action — the issue's `Preview injection ▾`. */
export const PREVIEW_ACTION = "Preview injection ▾";

/** The dialog's title. */
export const PREVIEW_TITLE = "What would be injected";

/** What the dialog is, under its title. */
export const PREVIEW_NOTE =
  "The manifest context assembly hands a consumer for this scope — the same answer a run gets, " +
  "and what it leaves out and why. Looking writes nothing and records nothing.";

/** The repository select. */
export const PREVIEW_REPO_LABEL = "Repository";

/** The repository select's first choice: a workspace-wide manifest. */
export const WORKSPACE_WIDE = "Whole workspace — no repository";

/** The workflow select. */
export const PREVIEW_WORKFLOW_LABEL = "Workflow";

/** The workflow select's first choice. */
export const NO_WORKFLOW = "No workflow";

/** Why the workflow select is short: only a workflow with a skill of its own changes a manifest. */
export const PREVIEW_WORKFLOW_HINT =
  "Only workflows a skill is scoped to are listed. Any other resolves exactly as no workflow does.";

/** The consumer select. */
export const PREVIEW_CONSUMER_LABEL = "Consumer";

/** The consumers, in the order the select offers them — a run's stage first, since that is the page's promise. */
export const CONSUMERS: readonly { readonly value: ContextConsumer; readonly label: string }[] = [
  { value: "run_stage", label: "Run stage" },
  { value: "playbook", label: "Playbook launch" },
  { value: "estimator", label: "Estimator" },
];

/** The consumer the dialog opens on. */
export const DEFAULT_CONSUMER: ContextConsumer = "run_stage";

/** The dialog's close. */
export const PREVIEW_CLOSE = "Close";

/** While the manifest is being assembled. */
export const PREVIEW_LOADING = "Assembling…";

/**
 * Whether a string is a consumer the select offers.
 *
 * @param value A select's value.
 * @returns `true` for one of {@link CONSUMERS}.
 */
export function isConsumer(value: string): value is ContextConsumer {
  return CONSUMERS.some((consumer) => consumer.value === value);
}

/**
 * The repositories the select offers.
 *
 * @param repos The enabled repositories, or why they could not be read.
 * @returns Each as `owner/name`; none when the list could not be read, which leaves the
 *   workspace-wide choice.
 */
export function repoChoices(repos: Reading<readonly EnabledRepo[]>): readonly string[] {
  return repos.ok ? repos.value.map(repoRef) : [];
}

/**
 * The workflows the select offers: the ones a skill is scoped to, since no other changes what
 * resolves.
 *
 * @param skills The workspace's skills, or why they could not be read.
 * @returns Their slugs, sorted, each once.
 */
export function workflowChoices(skills: Reading<SkillList>): readonly string[] {
  if (!skills.ok) return [];

  const slugs = new Set<string>();

  for (const skill of skills.value.skills) {
    if (skill.scope === "workflow" && skill.workflow !== null) slugs.add(skill.workflow.slug);
  }

  return [...slugs].sort();
}

/**
 * The dialog when the manifest could not be assembled.
 *
 * @param refusal The service's envelope.
 * @returns The sentence.
 */
export function previewFailure(refusal: ErrorEnvelope): string {
  if (refusal.code === "context_workflow_not_found") {
    return "That workflow is no longer in this workspace. Choose another, or no workflow.";
  }

  return `The preview could not be assembled: ${refusal.message.replace(/\.$/, "")}.`;
}

/* ------------------------------------------------------------------ what a preview says */

/** The four sections' headings. */
export const SKILLS_HEADING = "Skills";
export const FACTS_HEADING = "Confirmed facts";
export const TRIMMED_HEADING = "Trimmed";
export const ABSENT_HEADING = "Not in this manifest";

/** The badge a required skill wears. */
export const REQUIRED_BADGE = "required";

/** What the badge means — beside it for assistive technology, and as its tooltip. */
export const UNOVERRIDABLE_NOTE =
  "Required: no closer scope and no override can switch it off, and a trim never drops it.";

/** The tag an `on_trigger` skill wears. */
export const ON_TRIGGER_TAG = "on trigger";

/** Nothing at all resolved. */
export const PREVIEW_NOTHING = "Nothing would be injected for this scope and consumer.";

/** The skills section, with none resolved. */
export const NO_SKILLS_RESOLVED = "No skill resolves in this scope.";

/** The skills section for the estimator, whose manifest never carries one. */
export const ESTIMATOR_FACTS_ONLY =
  "The estimator's manifest carries facts only — that is all its engine contract takes — so no " +
  "skill is injected for an estimate.";

/** The facts section, with none in scope. */
export const NO_FACTS_RESOLVED = "No confirmed fact is in this scope.";

/** Above the trims: the policy that chose them. */
export const TRIM_POLICY =
  "Dropped to fit this consumer's limits — org first, then repo, then workflow; required skills are never dropped.";

/** The manifest is over its budget after the trim: only its required skills can do that. */
export const OVER_BUDGET_NOTE =
  "Over budget: the required skills alone exceed it, and a required skill is never trimmed.";

/** Under the absences, when the skills list could not be read to explain them. */
export const ABSENT_UNREAD =
  "The skills list could not be read, so a skill missing from this manifest cannot be explained here.";

/** Why the trim dropped an entry. */
const TRIM_REASON: Record<TrimmedEntry["reason"], string> = {
  over_budget: "over the token budget",
  item_limit: "over the consumer's fact cap",
};

/** What the manifest's identity is, as its tooltip. */
export const HASH_NOTE = "The manifest's identity — what an injection record names.";

/** A trimmed fact whose text this page did not read. */
export const UNREAD_FACT = "a fact this page has not read";

/**
 * A token estimate — `~6.2k tokens`, `~84 tokens`, `~1 token`.
 *
 * @param estimate The estimate.
 * @returns The phrase. The `~` is the estimate's honesty: a quarter of the character count, not a
 *   tokenizer's answer.
 */
export function tokens(estimate: number): string {
  return `~${compactNumber(estimate)} token${estimate === 1 ? "" : "s"}`;
}

/** One resolved skill, as the preview lists it. */
export interface SkillLine {
  /** The skill version's id. */
  readonly key: string;
  /** `zephyr-conventions@v12`. */
  readonly label: string;
  /** The scope tag — `repo`, `org-wide`, `workflow`. */
  readonly scope: string;
  /** Whether it is required, and so badged. */
  readonly required: boolean;
  /** The triggers of an `on_trigger` skill as a sentence, or `null` for one that always loads. */
  readonly trigger: string | null;
  /** `~1.2k tokens`. */
  readonly tokens: string;
}

/** One confirmed fact, as the preview lists it. */
export interface FactLine {
  /** The fact's id. */
  readonly key: string;
  /** The fact's text, backticks included. */
  readonly text: string;
  /** The tier tag — `repo` or `org-wide`. */
  readonly scope: string;
  /** `~16 tokens`. */
  readonly tokens: string;
}

/** One entry the trim dropped. */
export interface TrimLine {
  /** The dropped entry's id. */
  readonly key: string;
  /** What was dropped — a skill's slug, or a fact's text. */
  readonly name: string;
  /** Whether the name is a slug, drawn in the mono face. */
  readonly slug: boolean;
  /** The tier it was dropped from — `org`. */
  readonly tier: string;
  /** Why — `over the token budget`. */
  readonly why: string;
  /** What dropping it saved — `~32.5k tokens`. */
  readonly tokens: string;
}

/** One skill that is not in the manifest, and why. */
export interface AbsentLine {
  /** The skill's id. */
  readonly key: string;
  /** The skill's slug. */
  readonly slug: string;
  /** The scope tag. */
  readonly scope: string;
  /** Why it is absent. */
  readonly why: string;
}

/** A preview, arranged for the dialog. */
export interface PreviewView {
  /** `~6.2k tokens of the 32.0k budget`. */
  readonly budget: string;
  /** Whether the kept entries exceed the budget — the required skills alone. */
  readonly overBudget: boolean;
  /** The resolved skills, in the manifest's order. */
  readonly skills: readonly SkillLine[];
  /** What stands in the skills section when it is empty; `null` when it is not. */
  readonly skillsEmpty: string | null;
  /** The confirmed facts, in the manifest's order. */
  readonly facts: readonly FactLine[];
  /** Every trim, in drop order. */
  readonly trimmed: readonly TrimLine[];
  /** Every skill that is not in the manifest, with its reason. */
  readonly absent: readonly AbsentLine[];
  /** Why the absences cannot be fully explained, or `null` when they can. */
  readonly absentNote: string | null;
  /** Whether nothing at all would be injected. */
  readonly nothing: boolean;
  /** The manifest's identity, shortened — `manifest 529a6a637e3b`. */
  readonly hash: string;
}

/**
 * A section heading with its count — `Skills (5)`.
 *
 * @param heading The heading.
 * @param count How many lines the section holds.
 * @returns The heading.
 */
export function counting(heading: string, count: number): string {
  return `${heading} (${String(count)})`;
}

/**
 * Why resolution left a skill out, from the service's own record.
 *
 * @param entry The exclusion.
 * @param manifest The manifest it is from.
 * @returns The reason as a sentence fragment.
 */
function exclusionReason(entry: ExcludedSkill, manifest: ContextManifest): string {
  if (entry.reason === "override_disabled") return "disabled by an override";

  if (entry.reason === "disabled") {
    const holdsName = manifest.excluded.some((other) => other.by === entry.slug);

    return holdsName
      ? "switched off — and as the closest skill of its name, it keeps farther ones out too"
      : "switched off";
  }

  const by = entry.by ?? "another skill";
  const holder = manifest.skillVersions.find((skill) => skill.slug === entry.by);

  if (holder?.required === true) {
    return `overridden by ${by}, which is required — a required skill cannot be overridden`;
  }

  const holderScope = holder?.scope ?? manifest.excluded.find((other) => other.slug === entry.by)?.scope;

  return holderScope === entry.scope
    ? `overridden by ${by} — the same name at the same scope, where the first slug holds it`
    : `overridden by ${by} — the closest scope wins`;
}

/**
 * Why the manifest never considered a skill of the registry, or `null` when it should have.
 *
 * @param skill The skill.
 * @param manifest The manifest.
 * @returns The reason: a draft, scoped elsewhere, or unpublished — in that order, since a draft
 *   is inert wherever it is scoped.
 */
function neverCandidate(skill: SkillSummary, manifest: ContextManifest): string | null {
  if (skill.draft) return "a draft — drafts never inject";

  if (skill.scope === "repo") {
    const scoped = skill.repoRef ?? "a repository";

    if (manifest.scope.repo === null) return `scoped to ${scoped} — this preview names no repository`;
    if (skill.repoRef?.toLowerCase() !== manifest.scope.repo.toLowerCase()) {
      return `scoped to ${scoped} — not the repository in this scope`;
    }
  }

  if (skill.scope === "workflow") {
    const scoped = skill.workflow?.slug ?? "a workflow";

    if (manifest.scope.workflow === null) return `scoped to the workflow ${scoped} — this preview names no workflow`;
    if (skill.workflow?.slug !== manifest.scope.workflow) {
      return `scoped to the workflow ${scoped} — not the workflow in this scope`;
    }
  }

  if (skill.currentVersion === null) return "no published version yet";

  return null;
}

/** A skill the manifest should hold by this page's list, and does not. */
export const ABSENT_STALE =
  "not in the manifest — this page's list may be older than the preview; reload to compare";

/**
 * Arrange a manifest for the dialog.
 *
 * @param manifest The service's answer — never recomputed here.
 * @param skills The workspace's skills as the page read them, to explain an absence.
 * @param facts The workspace's facts as the page read them, to name a trimmed fact.
 * @returns The view.
 */
export function previewView(
  manifest: ContextManifest,
  skills: Reading<SkillList>,
  facts: Reading<FactList>,
): PreviewView {
  const carriesSkills = manifest.consumer !== "estimator";

  const trimmed = manifest.trimmed.map((entry): TrimLine => {
    const text = facts.ok ? facts.value.items.find((fact) => fact.id === entry.id)?.text : undefined;

    return {
      key: entry.id,
      name: entry.slug ?? text ?? UNREAD_FACT,
      slug: entry.slug !== null,
      tier: entry.tier,
      why: TRIM_REASON[entry.reason],
      tokens: tokens(entry.estTokens),
    };
  });

  const absent: AbsentLine[] = manifest.excluded.map((entry) => ({
    key: entry.skillId,
    slug: entry.slug,
    scope: scopeLabel(entry.scope),
    why: exclusionReason(entry, manifest),
  }));

  if (carriesSkills && skills.ok) {
    // What the manifest accounts for itself: kept, left out by resolution, or trimmed.
    const accounted = new Set([
      ...manifest.skillVersions.map((skill) => skill.slug),
      ...manifest.excluded.map((entry) => entry.slug),
      ...manifest.trimmed.flatMap((entry) => (entry.slug === null ? [] : [entry.slug])),
    ]);

    for (const skill of skills.value.skills) {
      if (accounted.has(skill.slug)) continue;

      absent.push({
        key: skill.id,
        slug: skill.slug,
        scope: scopeLabel(skill.scope),
        why: neverCandidate(skill, manifest) ?? ABSENT_STALE,
      });
    }
  }

  return {
    budget: `${tokens(manifest.estTokens)} of the ${compactNumber(manifest.budgetTokens)} budget`,
    overBudget: manifest.estTokens > manifest.budgetTokens,
    skills: manifest.skillVersions.map((skill) => ({
      key: skill.versionId,
      label: `${skill.slug}@v${String(skill.version)}`,
      scope: scopeLabel(skill.scope),
      required: skill.required,
      trigger:
        skill.load === "on_trigger"
          ? `Loads when the task matches ${skill.triggers.length === 0 ? "its triggers" : skill.triggers.join(", ")}; the consumer decides.`
          : null,
      tokens: tokens(skill.estTokens),
    })),
    skillsEmpty: manifest.skillVersions.length > 0 ? null : carriesSkills ? NO_SKILLS_RESOLVED : ESTIMATOR_FACTS_ONLY,
    facts: manifest.facts.map((fact) => ({
      key: fact.id,
      text: fact.text,
      scope: scopeLabel(fact.tier),
      tokens: tokens(fact.estTokens),
    })),
    trimmed,
    absent,
    absentNote: carriesSkills && !skills.ok ? ABSENT_UNREAD : null,
    nothing: manifest.skillVersions.length === 0 && manifest.facts.length === 0 && manifest.trimmed.length === 0,
    hash: `manifest ${manifest.manifestHash.slice(0, 12)}`,
  };
}

/**
 * The trim chip in the summary — `1 trimmed`.
 *
 * @param view The view.
 * @returns The chip's text, or `null` with nothing trimmed.
 */
export function trimChip(view: PreviewView): string | null {
  return view.trimmed.length === 0 ? null : `${String(view.trimmed.length)} trimmed`;
}

/**
 * What the live region says once a manifest lands, so a change of scope is heard as well as seen.
 *
 * @param view The view.
 * @returns `5 skills, 2 facts, ~84 tokens of the 32.0k budget; 1 trimmed.`
 */
export function previewAnnouncement(view: PreviewView): string {
  const trim = trimChip(view);

  return (
    `${counted(view.skills.length, "skill")}, ${counted(view.facts.length, "fact")}, ${view.budget}` +
    `${trim === null ? "" : `; ${trim}`}.`
  );
}
