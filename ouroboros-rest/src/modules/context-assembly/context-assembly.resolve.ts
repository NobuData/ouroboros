/**
 * **The** resolution — scoped knowledge in, one manifest out (BF.5,
 * [#414](https://github.com/NobuData/ouroboros/issues/414), decisions **K8** and **K9**).
 *
 * Mockup 14's ladder says *"Closest scope wins on conflict."* That caption is this file, and this
 * file is its only implementation: the estimator, the preview, and AR.1's execution (#315) all
 * reach it through `ContextAssemblyService`, so no two consumers can disagree about which skills
 * apply. It is pure — rows in, manifest out, no clock and no I/O — which is what makes the
 * resolution matrix a table of fixtures and the preview byte-identical to an assembly.
 *
 * ---------------------------------------------------------------------------
 * ## Resolution rules
 *
 *  1. **In scope.** An `org` skill is always in scope; a `repo` skill when its repository is the
 *     scope's (case-insensitive); a `workflow` skill when its workflow is the scope's.
 *  2. **Draft never.** A `draft` skill is left out whatever `enabled` says, and so is a skill with
 *     no published version. They are not even *excluded* — they were never candidates.
 *  3. **Closest scope wins on conflict.** Slugs are unique per workspace (V069), so a conflict is
 *     two in-scope skills with the same **name**, compared case-insensitively — BF.1's scope-move
 *     clash rule. The closest scope wins (`workflow` > `repo` > `org`); the others are
 *     `shadowed`. A winner that is switched off takes its name out of the manifest (`disabled`):
 *     that is how a workflow-level skill switches a farther one off.
 *  4. **Required cannot be overridden off, at any scope.** A `required` skill always holds its
 *     name: a closer same-name skill cannot shadow it (the closer one is `shadowed` instead), a
 *     `disable` override naming it is refused and recorded, and the trim never drops it.
 *  5. **Overrides are applied last** — V072's `{enable, disable}` delta of skill ids. `disable`
 *     removes a resolved skill (`override_disabled`); `enable` re-admits a skill that won its name
 *     but is switched off. Anything else is refused with its reason: `required`, `shadowed`, or
 *     `not_resolved` (not in scope, a draft, unpublished, or another workspace's).
 *  6. **Facts: confirmed only.** `proposed`, `stale`, `rejected` and `expired` facts never
 *     appear. A workspace-wide fact is in every scope; a repository's fact only in that
 *     repository's.
 *
 * ## Trim policy
 *
 * Applied only when the consumer's limits demand it, and **every drop is recorded** in `trimmed`.
 * Keep-priority is `required` > `workflow` > `repo` > `org`, so the drop order is the reverse:
 *
 *   * the tier: `org` first, then `repo`, then `workflow` — `required` is never dropped;
 *   * within a tier, skills before facts (a fact is one line; a skill is a document);
 *   * within those, the largest estimate first, ties broken by slug or fact id.
 *
 * The consumer's fact cap (the estimator's 64) is applied first, over facts alone, in the same
 * order, as `item_limit`; the token budget second, as `over_budget`. A manifest is over budget
 * after its trim only when its required skills alone exceed it.
 *
 * ## Identity
 *
 * `manifestHash` is sha256 over the manifest's identity — consumer, scope, budget, each kept skill
 * version id, each kept fact's id and text, and each trim — as canonical JSON. Skill versions are
 * immutable, so the same hash means the same injected text.
 */

import { createHash } from "node:crypto";

import type { FactStatus, SkillScope } from "../db/schema";
import { CONSUMER_PROFILES, estimateTokens } from "./context-assembly.profiles";
import {
  MANIFEST_TIERS,
  type ContextConsumer,
  type ContextManifest,
  type ExcludedSkill,
  type ManifestFact,
  type ManifestSkill,
  type ManifestTier,
  type RefusedOverride,
  type SkillLoad,
  type TrimmedEntry,
} from "./context-assembly.resources";

/** One of the workspace's skills, with its version in force — what the repository reads. */
export interface CandidateSkill {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly scope: SkillScope;
  readonly repoRef: string | null;
  readonly workflowId: string | null;
  readonly enabled: boolean;
  readonly required: boolean;
  readonly draft: boolean;
  /** The version in force; null when none is published. */
  readonly versionId: string | null;
  readonly version: number | null;
  readonly body: string | null;
  /** The version's typed frontmatter (V069's `skill_frontmatter_typed`). */
  readonly frontmatter: unknown;
}

/** One of the workspace's facts. */
export interface CandidateFact {
  readonly id: string;
  readonly text: string;
  readonly repoRef: string | null;
  readonly status: FactStatus;
}

/** A skill-id delta applied after resolution (V072's `skill_overrides`). */
export interface SkillOverrides {
  readonly enable: readonly string[];
  readonly disable: readonly string[];
}

/** No delta. */
export const NO_OVERRIDES: SkillOverrides = Object.freeze({ enable: [], disable: [] });

/** Everything one resolution reads. */
export interface ResolveInput {
  readonly consumer: ContextConsumer;
  /** `owner/name` as the caller named it, or null. */
  readonly repo: string | null;
  /** The workflow's slug as the caller named it, or null. */
  readonly workflow: string | null;
  /** That workflow's id, resolved within the workspace; null when no workflow is in scope. */
  readonly workflowId: string | null;
  /** The workspace's skills — every one; scope is decided here. */
  readonly skills: readonly CandidateSkill[];
  /** The workspace's facts; status and scope are decided here. */
  readonly facts: readonly CandidateFact[];
  readonly overrides: SkillOverrides;
  readonly budgetTokens: number;
}

/** A published skill in scope, before its name is contested. */
type Published = CandidateSkill & { versionId: string; version: number; body: string };

/** How close each scope is: lower wins. */
const CLOSENESS: Readonly<Record<SkillScope, number>> = { workflow: 0, repo: 1, org: 2 };

/**
 * Resolve one manifest.
 *
 * @param input - The scope, the consumer, the workspace's rows and the delta.
 * @returns The manifest — see this file's header for every rule it follows.
 */
export function resolveManifest(input: ResolveInput): ContextManifest {
  const profile = CONSUMER_PROFILES[input.consumer];

  const resolution = profile.skills
    ? resolveSkills(input)
    : { kept: [], excluded: [], refusedOverrides: [] };
  const facts = profile.facts ? resolveFacts(input) : [];

  const trim = trimToLimits(resolution.kept, facts, input.budgetTokens, profile.maxFacts);

  const identity = {
    consumer: input.consumer,
    scope: { repo: input.repo, workflow: input.workflow },
    budgetTokens: input.budgetTokens,
    skillVersions: trim.skills.map((skill) => skill.versionId),
    facts: trim.facts.map((fact) => [fact.id, fact.text]),
    trimmed: trim.trimmed.map((entry) => [entry.kind, entry.id, entry.reason]),
  };

  return {
    consumer: input.consumer,
    scope: identity.scope,
    budgetTokens: input.budgetTokens,
    estTokens: sumTokens(trim.skills) + sumTokens(trim.facts),
    skillVersions: trim.skills,
    facts: trim.facts,
    trimmed: trim.trimmed,
    excluded: resolution.excluded,
    refusedOverrides: resolution.refusedOverrides,
    manifestHash: createHash("sha256").update(JSON.stringify(identity)).digest("hex"),
  };
}

/**
 * Rules 1–5: scope, drafts, closest-wins, the required lock and the overrides.
 *
 * @param input - The resolution's input.
 * @returns The kept skills in manifest order, what was left out, and the refused overrides.
 */
function resolveSkills(input: ResolveInput): {
  kept: ManifestSkill[];
  excluded: ExcludedSkill[];
  refusedOverrides: RefusedOverride[];
} {
  const candidates = input.skills.filter(
    (skill): skill is Published =>
      !skill.draft &&
      skill.versionId !== null &&
      skill.version !== null &&
      skill.body !== null &&
      inScope(skill, input),
  );

  const kept = new Map<string, Published>();
  const excluded = new Map<string, ExcludedSkill>();

  for (const group of byName(candidates)) {
    const required = group.filter((skill) => skill.required);
    const holders = required.length > 0 ? required : [group[0]];
    const holder = holders[0];

    for (const skill of group) {
      if (holders.includes(skill)) {
        if (skill.enabled || skill.required) {
          kept.set(skill.id, skill);
        } else {
          excluded.set(skill.id, exclusion(skill, "disabled", null));
        }
      } else {
        excluded.set(skill.id, exclusion(skill, "shadowed", holder.slug));
      }
    }
  }

  const refusedOverrides: RefusedOverride[] = [];

  for (const skillId of input.overrides.disable) {
    const skill = kept.get(skillId);

    if (skill === undefined) {
      refusedOverrides.push({ skillId, action: "disable", reason: "not_resolved" });
    } else if (skill.required) {
      refusedOverrides.push({ skillId, action: "disable", reason: "required" });
    } else {
      kept.delete(skillId);
      excluded.set(skillId, exclusion(skill, "override_disabled", null));
    }
  }

  for (const skillId of input.overrides.enable) {
    const left = excluded.get(skillId);
    const skill = candidates.find((candidate) => candidate.id === skillId);

    if (kept.has(skillId)) {
      continue;
    }

    if (skill === undefined || left === undefined) {
      refusedOverrides.push({ skillId, action: "enable", reason: "not_resolved" });
    } else if (left.reason === "disabled") {
      excluded.delete(skillId);
      kept.set(skillId, skill);
    } else {
      // Shadowed, or disabled by the delta itself — V072 keeps enable and disable disjoint, and
      // the request DTO does too, so only a shadowed skill reaches this branch.
      refusedOverrides.push({ skillId, action: "enable", reason: "shadowed" });
    }
  }

  return {
    kept: [...kept.values()].map(toManifestSkill).sort(byTierThen((skill) => skill.slug)),
    excluded: [...excluded.values()].sort((a, b) => compare(a.slug, b.slug)),
    refusedOverrides,
  };
}

/**
 * Rule 6: confirmed facts in scope.
 *
 * @param input - The resolution's input.
 * @returns The facts in manifest order — the repository's first, then the workspace's, by id.
 */
function resolveFacts(input: ResolveInput): ManifestFact[] {
  const repo = input.repo?.toLowerCase() ?? null;

  return input.facts
    .filter(
      (fact) =>
        fact.status === "confirmed" &&
        (fact.repoRef === null || (repo !== null && fact.repoRef.toLowerCase() === repo)),
    )
    .map((fact): ManifestFact => ({
      id: fact.id,
      text: fact.text,
      repoRef: fact.repoRef,
      tier: fact.repoRef === null ? "org" : "repo",
      estTokens: estimateTokens(fact.text),
    }))
    .sort(byTierThen((fact) => fact.id));
}

/** What the trim kept and dropped. */
interface Trim {
  readonly skills: ManifestSkill[];
  readonly facts: ManifestFact[];
  readonly trimmed: TrimmedEntry[];
}

/**
 * The trim policy — the fact cap, then the budget. See this file's header.
 *
 * @param skills - The resolved skills.
 * @param facts - The resolved facts.
 * @param budgetTokens - The budget.
 * @param maxFacts - The consumer's fact cap, or null.
 * @returns What was kept, in manifest order, and what was dropped, in drop order.
 */
function trimToLimits(
  skills: readonly ManifestSkill[],
  facts: readonly ManifestFact[],
  budgetTokens: number,
  maxFacts: number | null,
): Trim {
  type Entry =
    | { kind: "skill"; key: string; tier: ManifestTier; estTokens: number; item: ManifestSkill }
    | { kind: "fact"; key: string; tier: ManifestTier; estTokens: number; item: ManifestFact };

  const entries: Entry[] = [
    ...skills.map((item): Entry => ({
      kind: "skill",
      key: item.slug,
      tier: item.tier,
      estTokens: item.estTokens,
      item,
    })),
    ...facts.map((item): Entry => ({
      kind: "fact",
      key: item.id,
      tier: item.tier,
      estTokens: item.estTokens,
      item,
    })),
  ];

  // Everything droppable, in the order it is dropped. Required skills are not in it.
  const dropOrder = entries
    .filter((entry) => entry.tier !== "required")
    .sort(
      (a, b) =>
        MANIFEST_TIERS.indexOf(b.tier) - MANIFEST_TIERS.indexOf(a.tier) ||
        (a.kind === b.kind ? 0 : a.kind === "skill" ? -1 : 1) ||
        b.estTokens - a.estTokens ||
        compare(a.key, b.key),
    );

  const dropped = new Map<Entry, TrimmedEntry["reason"]>();

  if (maxFacts !== null) {
    let excess = facts.length - maxFacts;

    for (const entry of dropOrder) {
      if (excess <= 0) {
        break;
      }
      if (entry.kind === "fact") {
        dropped.set(entry, "item_limit");
        excess -= 1;
      }
    }
  }

  let total = entries
    .filter((entry) => !dropped.has(entry))
    .reduce((sum, entry) => sum + entry.estTokens, 0);

  for (const entry of dropOrder) {
    if (total <= budgetTokens) {
      break;
    }
    if (!dropped.has(entry)) {
      dropped.set(entry, "over_budget");
      total -= entry.estTokens;
    }
  }

  const trimmed = dropOrder
    .filter((entry) => dropped.has(entry))
    .map((entry): TrimmedEntry => ({
      kind: entry.kind,
      id: entry.kind === "skill" ? entry.item.versionId : entry.item.id,
      slug: entry.kind === "skill" ? entry.item.slug : null,
      tier: entry.tier,
      estTokens: entry.estTokens,
      reason: dropped.get(entry) ?? "over_budget",
    }));
  const survivors = new Set(
    entries.filter((entry) => !dropped.has(entry)).map((entry) => entry.item),
  );

  return {
    skills: skills.filter((skill) => survivors.has(skill)),
    facts: facts.filter((fact) => survivors.has(fact)),
    trimmed,
  };
}

/**
 * Whether a skill is in the scope assembled for — rule 1.
 *
 * @param skill - The skill.
 * @param input - The scope.
 * @returns `true` for an org skill, a skill of the scope's repository, or of its workflow.
 */
function inScope(skill: CandidateSkill, input: ResolveInput): boolean {
  switch (skill.scope) {
    case "org":
      return true;
    case "repo":
      return (
        input.repo !== null &&
        skill.repoRef !== null &&
        skill.repoRef.toLowerCase() === input.repo.toLowerCase()
      );
    case "workflow":
      return input.workflowId !== null && skill.workflowId === input.workflowId;
  }
}

/**
 * The in-scope skills grouped by case-insensitive name, each group closest scope first.
 *
 * @param skills - The candidates.
 * @returns The groups, in no particular order — each is resolved on its own.
 */
function byName(skills: readonly Published[]): Published[][] {
  const groups = new Map<string, Published[]>();

  for (const skill of skills) {
    const key = skill.name.trim().toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), skill]);
  }

  return [...groups.values()].map((group) =>
    group.sort((a, b) => CLOSENESS[a.scope] - CLOSENESS[b.scope] || compare(a.slug, b.slug)),
  );
}

/**
 * A resolved skill as the manifest carries it.
 *
 * @param skill - The published candidate.
 * @returns The entry.
 */
function toManifestSkill(skill: Published): ManifestSkill {
  const frontmatter = (skill.frontmatter ?? {}) as { load?: unknown; triggers?: unknown };
  const load: SkillLoad = frontmatter.load === "on_trigger" ? "on_trigger" : "always";
  const triggers = Array.isArray(frontmatter.triggers)
    ? frontmatter.triggers.filter((trigger): trigger is string => typeof trigger === "string")
    : [];

  return {
    skillId: skill.id,
    slug: skill.slug,
    name: skill.name,
    scope: skill.scope,
    tier: skill.required ? "required" : skill.scope,
    required: skill.required,
    versionId: skill.versionId,
    version: skill.version,
    load,
    triggers,
    estTokens: estimateTokens(skill.body),
    body: skill.body,
  };
}

/**
 * An exclusion record.
 *
 * @param skill - The skill left out.
 * @param reason - Why.
 * @param by - The slug that shadowed it, or null.
 * @returns The record.
 */
function exclusion(
  skill: Published,
  reason: ExcludedSkill["reason"],
  by: string | null,
): ExcludedSkill {
  return { skillId: skill.id, slug: skill.slug, scope: skill.scope, reason, by };
}

/**
 * A comparator: keep-priority tier first, then a key.
 *
 * @param key - The tie-breaker.
 * @returns The comparator.
 */
function byTierThen<T extends { tier: ManifestTier }>(key: (item: T) => string) {
  return (a: T, b: T): number =>
    MANIFEST_TIERS.indexOf(a.tier) - MANIFEST_TIERS.indexOf(b.tier) || compare(key(a), key(b));
}

/**
 * A locale-free string comparison, so the order is the same on every machine.
 *
 * @param a - One string.
 * @param b - The other.
 * @returns Negative, zero or positive.
 */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The sum of the entries' estimates.
 *
 * @param entries - Skills or facts.
 * @returns The total.
 */
function sumTokens(entries: readonly { estTokens: number }[]): number {
  return entries.reduce((sum, entry) => sum + entry.estTokens, 0);
}
