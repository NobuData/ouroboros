/**
 * The shapes context assembly answers with (BF.5,
 * [#414](https://github.com/NobuData/ouroboros/issues/414)) — the **manifest** every consumer
 * injects, and the **injection record** a consumer posts back.
 *
 * ```
 * ContextManifest     what would go in, for one scope and one consumer — and what did not, and why
 *   skillVersions     resolved skills, by the version in force (never a bare slug)
 *   facts             confirmed facts in scope
 *   estTokens         the sum of every entry's estimate; budgetTokens is what it was held to
 *   trimmed           what the budget or the consumer's item cap dropped — never silent
 *   excluded          what resolution left out: switched off, shadowed, or disabled by override
 *   refusedOverrides  overrides that were not honoured — a `required` skill cannot be disabled
 *   manifestHash      sha256 identity, what an injection record names
 * InjectionResource   one context_injections row (V071), as recorded
 * ```
 *
 * On the wire the fields are `camelCase`, as every resource in this service is; the issue's
 * `skill_versions` / `est_tokens` / `manifest_hash` are these.
 */

import type { ContextInjectionConsumer, SkillScope } from "../db/schema";

/** Who a manifest is assembled for — `context_injections.consumer` (V071). */
export type ContextConsumer = ContextInjectionConsumer;

/** The consumers, in V071's `context_injections_consumer_valid` order. */
export const CONTEXT_CONSUMERS: readonly ContextConsumer[] = ["estimator", "run_stage", "playbook"];

/**
 * A manifest entry's trim tier, in keep-priority order: `required` is kept longest and never
 * trimmed, `org` is trimmed first. A skill's tier is `required` when it is required and its scope
 * otherwise; a fact's is `repo` when it names a repository and `org` when it is workspace-wide.
 */
export type ManifestTier = "required" | "workflow" | "repo" | "org";

/** The tiers, from kept longest to trimmed first. */
export const MANIFEST_TIERS: readonly ManifestTier[] = ["required", "workflow", "repo", "org"];

/** When a skill loads — its frontmatter's `load`, `always` when the author set none. */
export type SkillLoad = "always" | "on_trigger";

/** Where a manifest was assembled for. */
export interface AssemblyScopeResource {
  /** `owner/name`, or null for a workspace-wide manifest. */
  readonly repo: string | null;
  /** A workflow's slug, or null when no workflow is in scope. */
  readonly workflow: string | null;
}

/** One resolved skill, at the version in force. */
export interface ManifestSkill {
  readonly skillId: string;
  readonly slug: string;
  readonly name: string;
  readonly scope: SkillScope;
  readonly tier: ManifestTier;
  readonly required: boolean;
  /** `skill_versions.id` — what an injection record names. */
  readonly versionId: string;
  /** The published version number — the `v12` of `zephyr-conventions@v12`. */
  readonly version: number;
  /**
   * The frontmatter's `load`. Assembly does not match triggers — the consumer does, with the task
   * text it holds — so an `on_trigger` skill is resolved like any other and says so here.
   */
  readonly load: SkillLoad;
  /** The frontmatter's `triggers`; empty when it has none. */
  readonly triggers: readonly string[];
  readonly estTokens: number;
  /** The markdown to inject. */
  readonly body: string;
}

/** One confirmed fact. */
export interface ManifestFact {
  readonly id: string;
  readonly text: string;
  /** `owner/name`, or null for a workspace-wide fact. */
  readonly repoRef: string | null;
  readonly tier: "repo" | "org";
  readonly estTokens: number;
}

/**
 * Why a trim happened: the manifest was over the consumer's token budget, or held more facts than
 * the consumer can carry (the estimator's engine contract accepts 64).
 */
export type TrimReason = "over_budget" | "item_limit";

/** One entry the trim dropped. */
export interface TrimmedEntry {
  readonly kind: "skill" | "fact";
  /** The skill version's id, or the fact's. */
  readonly id: string;
  /** The skill's slug; null for a fact. */
  readonly slug: string | null;
  readonly tier: ManifestTier;
  readonly estTokens: number;
  readonly reason: TrimReason;
}

/**
 * Why resolution left a skill out.
 *
 *   * `disabled` — it won its name but is switched off (an `enable` override re-admits it);
 *   * `shadowed` — a closer skill of the same name won, or a `required` one holds the name;
 *   * `override_disabled` — the caller's `disable` override removed it.
 */
export type ExclusionReason = "disabled" | "shadowed" | "override_disabled";

/** One skill resolution left out. */
export interface ExcludedSkill {
  readonly skillId: string;
  readonly slug: string;
  readonly scope: SkillScope;
  readonly reason: ExclusionReason;
  /** The slug of the skill that shadowed it; null for any other reason. */
  readonly by: string | null;
}

/**
 * Why an override was not honoured.
 *
 *   * `required` — a `disable` of a required skill: what `required` means (decision K8);
 *   * `shadowed` — an `enable` of a skill a closer or required same-name skill replaces;
 *   * `not_resolved` — the skill is not in this scope, is a draft, has no published version, or
 *     is not this workspace's (V072: *"assembly ignores an override naming a skill it did not
 *     resolve"*).
 */
export type RefusalReason = "required" | "shadowed" | "not_resolved";

/** One override that was not honoured. */
export interface RefusedOverride {
  readonly skillId: string;
  readonly action: "enable" | "disable";
  readonly reason: RefusalReason;
}

/** What {@link ContextManifest.skillVersions} and the rest were assembled from. */
export interface ContextManifest {
  readonly consumer: ContextConsumer;
  readonly scope: AssemblyScopeResource;
  /** The budget the manifest was held to — the consumer's, or a lower one the caller asked for. */
  readonly budgetTokens: number;
  /**
   * The sum of every kept entry's estimate. Above {@link budgetTokens} only when the `required`
   * skills alone exceed it: they are never trimmed.
   */
  readonly estTokens: number;
  readonly skillVersions: readonly ManifestSkill[];
  readonly facts: readonly ManifestFact[];
  readonly trimmed: readonly TrimmedEntry[];
  readonly excluded: readonly ExcludedSkill[];
  readonly refusedOverrides: readonly RefusedOverride[];
  /** sha256, 64 lower-case hex — V071's `context_injections_manifest_hash_format`. */
  readonly manifestHash: string;
}

/** One recorded injection — a `context_injections` row (V071). */
export interface InjectionResource {
  readonly id: string;
  readonly consumer: ContextConsumer;
  readonly estimateId: string | null;
  readonly runStageId: string | null;
  readonly runId: string | null;
  readonly skillVersionIds: readonly string[];
  readonly factIds: readonly string[];
  readonly manifestHash: string;
  readonly injectedAt: string;
}
