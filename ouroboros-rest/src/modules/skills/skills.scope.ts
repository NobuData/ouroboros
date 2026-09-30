/**
 * A scope move, worked out before it is made (BF.1,
 * [#410](https://github.com/NobuData/ouroboros/issues/410)).
 *
 * Moving a skill between `org`, `repo` and `workflow` changes what it applies to, so the move is
 * previewed first and committed second, and this file is the preview's arithmetic — pure, so the
 * service and its specs compute it the same way.
 *
 * ```
 * reach(org)          every repository, every workflow
 * reach(repo R)       R, every workflow (run in R)
 * reach(workflow W)   every repository, W alone
 * ```
 *
 * **What the preview reports** — decided on the issue, since V069 keeps slugs unique per
 * workspace and so no two skills can share one:
 *
 *   * **reach** — the repositories and workflows the move adds and takes away;
 *   * **references** — every published workflow naming the skill, and whether the move puts it
 *     outside the skill's reach (only a move *to* `workflow` scope can: every other scope reaches
 *     every workflow);
 *   * **clashes** — another skill at the destination scope and referent with the same name,
 *     compared case-insensitively. A clashing move is refused unless the commit says
 *     `resolve: "keep_both"`.
 *
 * **The token is the preview.** {@link previewToken} digests everything the preview says, so a
 * commit whose recomputed preview differs — a skill renamed, a clash created, a workflow
 * published — is told to preview again rather than committing something nobody saw.
 */

import { createHash } from "node:crypto";

import type {
  ScopeClash,
  ScopeReference,
  SkillReach,
  SkillReference,
  SkillScopePreview,
  SkillTarget,
  WorkflowRef,
} from "./skills.resources";

/** What a reach is measured against: the workspace's repositories and live workflows. */
export interface ReachUniverse {
  readonly repos: readonly string[];
  readonly workflows: readonly WorkflowRef[];
}

/**
 * Where a skill at a target applies.
 *
 * @param target - The scope and its referent.
 * @param universe - The workspace's repositories and workflows.
 * @returns The repositories and workflows it applies to. A repository or workflow named by the
 *   target is included even when the universe does not list it — a repo-scoped skill still names
 *   its repository after a mirror row is removed.
 */
export function reachOf(target: SkillTarget, universe: ReachUniverse): SkillReach {
  switch (target.scope) {
    case "org":
      return { repos: [...universe.repos], workflows: [...universe.workflows] };
    case "repo":
      return { repos: [target.repoRef ?? ""], workflows: [...universe.workflows] };
    case "workflow":
      return {
        repos: [...universe.repos],
        workflows: target.workflow === null ? [] : [target.workflow],
      };
  }
}

/**
 * What moving from one reach to another adds and takes away.
 *
 * @param from - The reach now.
 * @param to - The reach after the move.
 * @returns The gains and the losses, each in the order the reach lists them.
 */
export function reachDelta(
  from: SkillReach,
  to: SkillReach,
): { gains: SkillReach; loses: SkillReach } {
  return { gains: minus(to, from), loses: minus(from, to) };
}

/**
 * Whether the skill still applies to a workflow after it moves to a target.
 *
 * @param target - The destination.
 * @param workflowId - The workflow.
 * @returns `false` only for a workflow-scoped target naming another workflow.
 */
export function reaches(target: SkillTarget, workflowId: string): boolean {
  return target.scope !== "workflow" || target.workflow?.id === workflowId;
}

/**
 * Whether two targets are the same place.
 *
 * @param a - One target.
 * @param b - Another.
 * @returns `true` when scope and referent agree.
 */
export function sameTarget(a: SkillTarget, b: SkillTarget): boolean {
  return (
    a.scope === b.scope &&
    (a.repoRef ?? null) === (b.repoRef ?? null) &&
    (a.workflow?.id ?? null) === (b.workflow?.id ?? null)
  );
}

/** Everything {@link buildScopePreview} is given. */
export interface ScopePreviewInput {
  readonly skillId: string;
  readonly slug: string;
  readonly from: SkillTarget;
  readonly to: SkillTarget;
  readonly universe: ReachUniverse;
  readonly references: readonly SkillReference[];
  readonly clashes: readonly ScopeClash[];
}

/**
 * The preview a caller is shown, token included.
 *
 * @param input - The skill, the two targets, the universe, its references and the clashes found.
 * @returns The preview.
 */
export function buildScopePreview(input: ScopePreviewInput): SkillScopePreview {
  const reach = reachDelta(reachOf(input.from, input.universe), reachOf(input.to, input.universe));
  const references: ScopeReference[] = input.references.map((workflow) => ({
    workflow,
    outOfReach: !reaches(input.to, workflow.id),
  }));
  const body = {
    slug: input.slug,
    from: input.from,
    to: input.to,
    reach,
    references,
    clashes: input.clashes,
  };

  return { ...body, previewToken: previewToken(input.skillId, body) };
}

/**
 * The digest a commit is checked against.
 *
 * @param skillId - The skill — so one skill's token never commits another's move.
 * @param preview - Everything the preview says.
 * @returns 64 lower-case hex characters. Opaque.
 */
export function previewToken(skillId: string, preview: unknown): string {
  return createHash("sha256")
    .update(skillId)
    .update("\n")
    .update(JSON.stringify(preview))
    .digest("hex");
}

/**
 * One reach less another.
 *
 * @param a - The reach to take from.
 * @param b - What to take away.
 * @returns What `a` has that `b` does not.
 */
function minus(a: SkillReach, b: SkillReach): SkillReach {
  const repos = new Set(b.repos);
  const workflows = new Set(b.workflows.map((workflow) => workflow.id));

  return {
    repos: a.repos.filter((repo) => !repos.has(repo)),
    workflows: a.workflows.filter((workflow) => !workflows.has(workflow.id)),
  };
}
