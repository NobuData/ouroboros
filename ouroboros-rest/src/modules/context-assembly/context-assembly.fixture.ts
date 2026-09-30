/**
 * Mockup 14's knowledge, as context assembly's candidates
 * ([#414](https://github.com/NobuData/ouroboros/issues/414)) — the builders every suite here uses.
 *
 * The ids are uuid-shaped so a manifest built from them validates against the documented schemas.
 */

import type { CandidateFact, CandidateSkill, ResolveInput } from "./context-assembly.resolve";
import { NO_OVERRIDES } from "./context-assembly.resolve";

/** The workspace. */
export const WORKSPACE = "org_acme_robotics";

/** Another workspace — the isolation cases'. */
export const OTHER_WORKSPACE = "org_other";

/** The repository in scope. */
export const HELIOS = "acme-robotics/helios-firmware";

/** Another repository. */
export const TELEMETRY = "acme-robotics/helios-telemetry";

/** The workflow in scope, and its id. */
export const STANDARD_FIX = "standard-fix";
export const STANDARD_FIX_ID = "5eed0029-0000-4000-8000-000000000001";

/** Another workflow's id. */
export const DOCS_LOOP_ID = "5eed0029-0000-4000-8000-000000000002";

/**
 * A uuid from a small number, so fixtures read as `id(3)` rather than a wall of hex.
 *
 * @param n - The distinguishing number.
 * @param prefix - Eight hex characters, per kind of row.
 * @returns A canonical lower-case uuid.
 */
export function uuid(n: number, prefix = "5eed0069"): string {
  return `${prefix}-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}

let nextSkill = 1;

/**
 * An enabled, published, org-scoped skill; anything else is an override.
 *
 * @param overrides - What differs.
 * @returns The candidate.
 */
export function skill(overrides: Partial<CandidateSkill> & { slug: string }): CandidateSkill {
  const n = nextSkill++;

  return {
    id: uuid(n),
    name: overrides.slug,
    scope: "org",
    repoRef: null,
    workflowId: null,
    enabled: true,
    required: false,
    draft: false,
    versionId: uuid(n, "5eed0070"),
    version: 1,
    body: `# ${overrides.slug}\n\nThe rules of ${overrides.slug}.`,
    frontmatter: { name: overrides.slug, load: "always" },
    ...overrides,
  };
}

/**
 * A repo-scoped skill of helios-firmware.
 *
 * @param overrides - What differs.
 * @returns The candidate.
 */
export function repoSkill(overrides: Partial<CandidateSkill> & { slug: string }): CandidateSkill {
  return skill({ scope: "repo", repoRef: HELIOS, ...overrides });
}

/**
 * A workflow-scoped skill of standard-fix.
 *
 * @param overrides - What differs.
 * @returns The candidate.
 */
export function workflowSkill(
  overrides: Partial<CandidateSkill> & { slug: string },
): CandidateSkill {
  return skill({ scope: "workflow", workflowId: STANDARD_FIX_ID, ...overrides });
}

let nextFact = 1;

/**
 * A confirmed, workspace-wide fact.
 *
 * @param overrides - What differs.
 * @returns The candidate.
 */
export function fact(overrides: Partial<CandidateFact> = {}): CandidateFact {
  const n = nextFact++;

  return {
    id: uuid(n, "5eed0044"),
    text: `Fact number ${String(n)}.`,
    repoRef: null,
    status: "confirmed",
    ...overrides,
  };
}

/**
 * A resolution input for a `run_stage` in helios-firmware under standard-fix.
 *
 * @param overrides - What differs.
 * @returns The input.
 */
export function input(overrides: Partial<ResolveInput> = {}): ResolveInput {
  return {
    consumer: "run_stage",
    repo: HELIOS,
    workflow: STANDARD_FIX,
    workflowId: STANDARD_FIX_ID,
    skills: [],
    facts: [],
    overrides: NO_OVERRIDES,
    budgetTokens: 32_000,
    ...overrides,
  };
}
