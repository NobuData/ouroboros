import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { FactList } from "@/app/api/facts";
import type { Reading } from "@/app/api/reading";
import type { SkillList } from "@/app/api/skills";
import {
  ALL_REPOS,
  type LadderInput,
  NOT_READ,
  NO_FACTS_AT_SCOPE,
  NO_WORKFLOW_FACTS,
  SCOPE_CAPTION,
  WORKFLOW_NAME,
  factInFilter,
  filterNote,
  focusedRepo,
  ladder,
  ladderIsCold,
  noFactsNote,
  skillInFilter,
} from "@/app/knowledge/scope";
import { ALL_REPOS_LABEL } from "@/app/shell/focus-repo";

import {
  SEEDED_REPO,
  enabledRepo,
  fact,
  seededFacts,
  seededFactRows,
  seededRepos,
  seededSkills,
  skillSummary,
  skillsWithOverrides,
} from "../helpers/knowledge";

/**
 * The scope ladder's judgements (#421): the three steps count registry truth — what is in force
 * at each scope — the current one is the tenant chip's, every count follows a switch, a move or a
 * create, and each step's filter keeps exactly its scope.
 */

const MOCKUP = join(import.meta.dirname, "..", "..", "..", "docs", "mockups", "14-knowledge.html");

/** The chip, looking at the seeded repository. */
const HELIOS = { id: enabledRepo().id, name: enabledRepo().name };

/**
 * A ladder's input over the seed, the chip on `helios-firmware`.
 *
 * @param over What differs.
 * @returns The input.
 */
function input(over: Partial<LadderInput> = {}): LadderInput {
  return {
    skills: { ok: true, value: seededSkills() },
    facts: { ok: true, value: seededFacts() },
    repos: { ok: true, value: seededRepos() },
    focus: HELIOS,
    workspace: "acme-robotics",
    ...over,
  };
}

/**
 * The skills reading with one skill changed.
 *
 * @param slug The skill.
 * @param change What changes.
 * @returns The reading.
 */
function withSkill(slug: string, change: Parameters<typeof skillSummary>[0]): Reading<SkillList> {
  const list = seededSkills();

  return { ok: true, value: { ...list, skills: list.skills.map((skill) => (skill.slug === slug ? { ...skill, ...change } : skill)) } };
}

/** Each step as `level name count`. */
function lines(steps: ReturnType<typeof ladder>): string[] {
  return steps.map((step) => `${step.level} ${step.name} ${step.count}`);
}

describe("the caption", () => {
  it("is the mockup's, verbatim", () => {
    expect(readFileSync(MOCKUP, "utf8")).toContain(`>${SCOPE_CAPTION}</p>`);
    expect(SCOPE_CAPTION).toBe("Closest scope wins on conflict.");
  });
});

describe("the three steps", () => {
  it("are the mockup's Org ↓ Repo ↓ Workflow, counting what is in force at each scope", () => {
    // The seed: two org-wide skills; three repo skills in force and a draft; one confirmed
    // repository fact among four; no workflow-scoped skill.
    expect(lines(ladder(input()))).toEqual([
      "Org acme-robotics 2 skills",
      "Repo helios-firmware 3 skills + 1 fact",
      `Workflow ${WORKFLOW_NAME} 0`,
    ]);
  });

  it("counts a workflow's overrides — the ones in force", () => {
    const steps = ladder(input({ skills: { ok: true, value: skillsWithOverrides() } }));

    // Three workflow-scoped skills, two of them switched off.
    expect(steps[2]?.count).toBe("1");
    expect(steps[2]?.note).toContain("1 of 3 workflow-scoped skills in force");
  });

  it("explains each count: how many the step holds, and why a draft is not among them", () => {
    const [org, repo] = ladder(input());

    expect(org?.note).toBe(
      "2 of 2 org-wide skills in force — enabled, published and not a draft. A draft or a switched-off skill is not counted, because it would not inject.",
    );
    expect(repo?.note).toContain("3 of 4 skills of helios-firmware in force");
    expect(repo?.note).toContain("1 of 4 repository facts confirmed — only confirmed facts inject.");
  });

  it("never counts a draft, whatever its switch says", () => {
    const steps = ladder(input({ skills: withSkill("power-budget-checks", { enabled: true }) }));

    expect(steps[1]?.count).toBe("3 skills + 1 fact");
  });
});

describe("the current step", () => {
  it("is the Repo step, named for the repository the tenant chip is looking at", () => {
    const steps = ladder(input());

    expect(steps.map((step) => step.current)).toEqual([false, true, false]);
    expect(steps[1]?.filter).toEqual({ scope: "repo", repo: SEEDED_REPO });
  });

  it("is the Org step under All repos, and the Repo step then counts every repository's", () => {
    const other = skillSummary({ id: "5eed0410-0000-4000-8000-0000000000aa", slug: "tools-style", repoRef: "acme-robotics/helios-tools" });
    const list = seededSkills();
    const skills: Reading<SkillList> = { ok: true, value: { ...list, skills: [...list.skills, other] } };
    const steps = ladder(input({ focus: null, skills }));

    expect(steps.map((step) => step.current)).toEqual([true, false, false]);
    expect(steps[1]).toMatchObject({ name: ALL_REPOS, count: "4 skills + 1 fact", filter: { scope: "repo", repo: null } });
    expect(steps[1]?.note).toContain("4 of 5 repository-scoped skills in force");

    // With the chip on helios-firmware, the other repository's skill is not this step's.
    expect(ladder(input({ skills }))[1]?.count).toBe("3 skills + 1 fact");
  });

  it("says All repos in the chip's own words", () => {
    expect(ALL_REPOS).toBe(ALL_REPOS_LABEL);
  });

  it("reads a focus that is no longer an enabled repository, or an unread list, as none", () => {
    const gone = { id: "5eed0044-0000-4000-8000-0000000009ff", name: "retired" };

    expect(focusedRepo({ ok: true, value: seededRepos() }, gone)).toBeNull();
    expect(focusedRepo({ ok: false, reason: "unreachable" }, HELIOS)).toBeNull();
    expect(ladder(input({ focus: gone })).map((step) => step.current)).toEqual([true, false, false]);
  });

  it("matches a repository's skills and facts whatever the case of their reference", () => {
    const steps = ladder(
      input({
        skills: withSkill("zephyr-conventions", { repoRef: "Acme-Robotics/Helios-Firmware" }),
        facts: { ok: true, value: seededFacts(seededFactRows().map((one) => ({ ...one, repoRef: one.repoRef?.toUpperCase() ?? null }))) },
      }),
    );

    expect(steps[1]?.count).toBe("3 skills + 1 fact");
  });
});

describe("live counts", () => {
  it("drop a skill from its step when it is switched off, and take it back when switched on", () => {
    const off = ladder(input({ skills: withSkill("zephyr-conventions", { enabled: false, active: false }) }));

    expect(off[1]?.count).toBe("2 skills + 1 fact");
    expect(ladder(input())[1]?.count).toBe("3 skills + 1 fact");
  });

  it("carry a moved skill from one step to another", () => {
    const moved = ladder(input({ skills: withSkill("zephyr-conventions", { scope: "org", repoRef: null }) }));

    expect(lines(moved).slice(0, 2)).toEqual(["Org acme-robotics 3 skills", "Repo helios-firmware 2 skills + 1 fact"]);
  });

  it("count a created skill once it is in force — and not while it is a draft", () => {
    const list = seededSkills();
    const created = skillSummary({ id: "5eed0410-0000-4000-8000-0000000000bb", slug: "new-rules", scope: "org", repoRef: null, draft: true, active: false });
    const drafted: Reading<SkillList> = { ok: true, value: { ...list, skills: [...list.skills, created] } };
    const promoted: Reading<SkillList> = { ok: true, value: { ...list, skills: [...list.skills, { ...created, draft: false, active: true }] } };

    expect(ladder(input({ skills: drafted }))[0]?.count).toBe("2 skills");
    expect(ladder(input({ skills: promoted }))[0]?.count).toBe("3 skills");
  });

  it("count a fact at the repo step once it is confirmed", () => {
    const confirmed = seededFactRows().map((one) => (one.text.startsWith("Team") ? { ...one, status: "confirmed" as const } : one));

    expect(ladder(input({ facts: { ok: true, value: seededFacts(confirmed) } }))[1]?.count).toBe("3 skills + 2 facts");
  });
});

describe("empty, cold and unread", () => {
  it("counts zero at every step of a workspace with no skills, and calls the ladder cold", () => {
    const none: Reading<SkillList> = { ok: true, value: { skills: [], active: 0 } };
    const nothing: Reading<FactList> = { ok: true, value: seededFacts([]) };
    const steps = ladder(input({ skills: none, facts: nothing }));

    expect(lines(steps)).toEqual(["Org acme-robotics 0 skills", "Repo helios-firmware 0 skills + 0 facts", `Workflow ${WORKFLOW_NAME} 0`]);
    expect(steps[0]?.note).toBe("No org-wide skills yet.");
    expect(steps[1]?.note).toBe("No skills of helios-firmware yet. No repository facts yet.");
    expect(ladderIsCold(none)).toBe(true);
    expect(ladderIsCold({ ok: true, value: seededSkills() })).toBe(false);
  });

  it("says not read, with the reason, rather than a zero nobody counted", () => {
    const unread: Reading<SkillList> = { ok: false, reason: "The registry is unreachable." };
    const steps = ladder(input({ skills: unread }));

    expect(steps.map((step) => step.count)).toEqual([NOT_READ, NOT_READ, NOT_READ]);
    expect(steps[1]?.note).toBe("The skills could not be read: The registry is unreachable.");
    expect(ladderIsCold(unread)).toBe(false);
  });

  it("keeps the skills count when only the facts could not be read", () => {
    const steps = ladder(input({ facts: { ok: false, reason: "The facts are unreachable." } }));

    expect(steps[1]?.count).toBe(`3 skills + facts ${NOT_READ}`);
    expect(steps[1]?.note).toContain("The facts could not be read: The facts are unreachable.");
  });
});

describe("the filter", () => {
  const [org, repo, workflow] = ladder(input({ skills: { ok: true, value: skillsWithOverrides() } })).map((step) => step.filter);

  /** The slugs a filter keeps. */
  function kept(filter: typeof org): string[] {
    return skillsWithOverrides().skills.filter((skill) => filter !== undefined && skillInFilter(skill, filter)).map((skill) => skill.slug);
  }

  it("keeps exactly a step's skills — drafts and switched-off ones included, since the table shows them", () => {
    expect(kept(org)).toEqual(["commit-style", "pr-etiquette"]);
    expect(kept(repo)).toEqual(["hil-safety", "power-budget-checks", "repo-map", "zephyr-conventions"]);
    expect(kept(workflow)).toEqual(["commit-style-fix", "hil-safety-off", "pr-etiquette-off"]);
  });

  it("keeps only the named repository's skills, and every repository's when it names none", () => {
    const elsewhere = skillSummary({ slug: "tools-style", repoRef: "acme-robotics/helios-tools" });

    expect(skillInFilter(elsewhere, { scope: "repo", repo: SEEDED_REPO })).toBe(false);
    expect(skillInFilter(elsewhere, { scope: "repo", repo: null })).toBe(true);
  });

  it("keeps workspace-wide facts at Org, a repository's at Repo, and none at Workflow", () => {
    const wide = fact();
    const local = fact({ repoRef: SEEDED_REPO });
    const elsewhere = fact({ repoRef: "acme-robotics/helios-tools" });

    expect([wide, local, elsewhere].map((one) => factInFilter(one, { scope: "org", repo: null }))).toEqual([true, false, false]);
    expect([wide, local, elsewhere].map((one) => factInFilter(one, { scope: "repo", repo: SEEDED_REPO }))).toEqual([false, true, false]);
    expect([wide, local, elsewhere].map((one) => factInFilter(one, { scope: "repo", repo: null }))).toEqual([false, true, true]);
    expect([wide, local, elsewhere].map((one) => factInFilter(one, { scope: "workflow", repo: null }))).toEqual([false, false, false]);
  });

  it("says what the page is narrowed to, and why a workflow has no facts", () => {
    const steps = ladder(input());

    expect(filterNote(steps[1]!)).toBe("Showing only the Repo scope — helios-firmware. Skills and facts at other scopes are hidden.");
    expect(noFactsNote({ scope: "workflow", repo: null })).toBe(NO_WORKFLOW_FACTS);
    expect(noFactsNote({ scope: "org", repo: null })).toBe(NO_FACTS_AT_SCOPE);
  });
});
