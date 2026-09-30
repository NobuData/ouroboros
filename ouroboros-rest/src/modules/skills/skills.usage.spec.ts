import { inScope, usedBy, type InjectedRun, type UsageSkill } from "./skills.usage";

/**
 * The Used-by rule (#410), as `ouroboros-db/tests/seed.sql` applies it to BE.5's records: `—`,
 * `every run`, `every PR`, `physical tests`, or the rounded share.
 */

const HELIOS = "acme-robotics/helios-firmware";
const APP = "acme-robotics/helios-app";

/**
 * A run context was assembled for.
 *
 * @param runId - Its id.
 * @param overrides - What differs from a helios-firmware standard-fix run with no PR or HIL.
 * @returns The run.
 */
function run(runId: string, overrides: Partial<InjectedRun> = {}): InjectedRun {
  return {
    runId,
    repoRef: HELIOS,
    workflowSlug: "standard-fix",
    openedPr: false,
    physical: false,
    ...overrides,
  };
}

const REPO_SKILL: UsageSkill = { scope: "repo", repoRef: HELIOS, workflowSlug: null, draft: false };
const ORG_SKILL: UsageSkill = { scope: "org", repoRef: null, workflowSlug: null, draft: false };

describe("which runs are in a skill's scope", () => {
  it("is every run for org, the repository's for repo, the workflow's for workflow", () => {
    const other = run("r2", { repoRef: APP, workflowSlug: "hotfix-p0" });

    expect(inScope(ORG_SKILL, other)).toBe(true);
    expect(inScope(REPO_SKILL, run("r1"))).toBe(true);
    expect(inScope(REPO_SKILL, other)).toBe(false);
    expect(
      inScope({ scope: "workflow", repoRef: null, workflowSlug: "hotfix-p0", draft: false }, other),
    ).toBe(true);
    expect(
      inScope(
        { scope: "workflow", repoRef: null, workflowSlug: "hotfix-p0", draft: false },
        run("r1"),
      ),
    ).toBe(false);
  });
});

describe("the Used-by label", () => {
  const runs = [
    run("r1", { openedPr: true }),
    run("r2", { openedPr: true, physical: true }),
    run("r3"),
    run("r4", { physical: true }),
    run("r5", { repoRef: APP }),
  ];

  it("is a dash when no run carried it", () => {
    expect(usedBy(REPO_SKILL, runs, new Set())).toEqual({ label: "—", carried: 0, inScope: 4 });
  });

  it("is `every run` when every in-scope run carried it", () => {
    expect(usedBy(REPO_SKILL, runs, new Set(["r1", "r2", "r3", "r4"])).label).toBe("every run");
    expect(usedBy(ORG_SKILL, runs, new Set(["r1", "r2", "r3", "r4", "r5"])).label).toBe(
      "every run",
    );
  });

  it("is `every PR` when exactly the runs that opened a PR carried it", () => {
    expect(usedBy(REPO_SKILL, runs, new Set(["r1", "r2"])).label).toBe("every PR");
  });

  it("is `physical tests` when exactly the runs with HIL measurements carried it", () => {
    expect(usedBy(REPO_SKILL, runs, new Set(["r2", "r4"])).label).toBe("physical tests");
  });

  it("is the rounded share otherwise — 11 of 18 is the mockup's 61%", () => {
    const eighteen = Array.from({ length: 18 }, (_, i) => run(`r${i}`));
    const eleven = new Set(eighteen.slice(0, 11).map((r) => r.runId));

    expect(usedBy(REPO_SKILL, eighteen, eleven)).toEqual({
      label: "61% of runs",
      carried: 11,
      inScope: 18,
    });
  });

  it("is a dash for a draft whatever the records say — a draft is never active", () => {
    expect(usedBy({ ...REPO_SKILL, draft: true }, runs, new Set(["r1", "r2", "r3", "r4"]))).toEqual(
      { label: "—", carried: 0, inScope: 4 },
    );
  });
});
