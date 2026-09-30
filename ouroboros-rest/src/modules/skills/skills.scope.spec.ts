import type { SkillTarget } from "./skills.resources";
import {
  buildScopePreview,
  reachDelta,
  reachOf,
  reaches,
  sameTarget,
  type ReachUniverse,
} from "./skills.scope";

/** A scope move's arithmetic (#410): reach, references, clashes, token. */

const STANDARD = { id: "wf-1", slug: "standard-fix" };
const HOTFIX = { id: "wf-2", slug: "hotfix-p0" };

const UNIVERSE: ReachUniverse = {
  repos: ["acme-robotics/helios-firmware", "acme-robotics/helios-app"],
  workflows: [HOTFIX, STANDARD],
};

const ORG: SkillTarget = { scope: "org", repoRef: null, workflow: null };
const HELIOS: SkillTarget = {
  scope: "repo",
  repoRef: "acme-robotics/helios-firmware",
  workflow: null,
};
const STANDARD_ONLY: SkillTarget = { scope: "workflow", repoRef: null, workflow: STANDARD };

describe("a scope's reach", () => {
  it("is everything for org scope", () => {
    expect(reachOf(ORG, UNIVERSE)).toEqual(UNIVERSE);
  });

  it("is one repository and every workflow for repo scope", () => {
    expect(reachOf(HELIOS, UNIVERSE)).toEqual({
      repos: ["acme-robotics/helios-firmware"],
      workflows: [HOTFIX, STANDARD],
    });
  });

  it("is every repository and one workflow for workflow scope", () => {
    expect(reachOf(STANDARD_ONLY, UNIVERSE)).toEqual({
      repos: UNIVERSE.repos,
      workflows: [STANDARD],
    });
  });

  it("names a repo scope's repository even when the mirror no longer lists it", () => {
    const gone = { ...HELIOS, repoRef: "acme-robotics/retired" };

    expect(reachOf(gone, UNIVERSE).repos).toEqual(["acme-robotics/retired"]);
  });
});

describe("what a move gains and loses", () => {
  it("repo → org gains the other repositories and loses nothing", () => {
    expect(reachDelta(reachOf(HELIOS, UNIVERSE), reachOf(ORG, UNIVERSE))).toEqual({
      gains: { repos: ["acme-robotics/helios-app"], workflows: [] },
      loses: { repos: [], workflows: [] },
    });
  });

  it("org → workflow loses every other workflow", () => {
    expect(reachDelta(reachOf(ORG, UNIVERSE), reachOf(STANDARD_ONLY, UNIVERSE))).toEqual({
      gains: { repos: [], workflows: [] },
      loses: { repos: [], workflows: [HOTFIX] },
    });
  });
});

describe("whether a workflow stays in reach", () => {
  it("only a workflow-scoped target can leave a workflow out", () => {
    expect(reaches(ORG, HOTFIX.id)).toBe(true);
    expect(reaches(HELIOS, HOTFIX.id)).toBe(true);
    expect(reaches(STANDARD_ONLY, STANDARD.id)).toBe(true);
    expect(reaches(STANDARD_ONLY, HOTFIX.id)).toBe(false);
  });
});

describe("the same place", () => {
  it("compares the scope and its referent", () => {
    expect(sameTarget(HELIOS, { ...HELIOS })).toBe(true);
    expect(sameTarget(HELIOS, { ...HELIOS, repoRef: "acme-robotics/helios-app" })).toBe(false);
    expect(sameTarget(ORG, HELIOS)).toBe(false);
  });
});

describe("the preview", () => {
  const references = [
    { id: HOTFIX.id, slug: HOTFIX.slug, name: "Hotfix", version: 3 },
    { id: STANDARD.id, slug: STANDARD.slug, name: "Standard fix", version: 14 },
  ];

  it("marks the references a move leaves out of reach", () => {
    const preview = buildScopePreview({
      skillId: "skill-1",
      slug: "repo-map",
      from: HELIOS,
      to: STANDARD_ONLY,
      universe: UNIVERSE,
      references,
      clashes: [],
    });

    expect(preview.references).toEqual([
      { workflow: references[0], outOfReach: true },
      { workflow: references[1], outOfReach: false },
    ]);
  });

  it("carries the clashes and a 64-hex token", () => {
    const clashes = [{ id: "skill-2", slug: "repo-map-org", name: "repo-map" }];
    const preview = buildScopePreview({
      skillId: "skill-1",
      slug: "repo-map",
      from: HELIOS,
      to: ORG,
      universe: UNIVERSE,
      references: [],
      clashes,
    });

    expect(preview.clashes).toEqual(clashes);
    expect(preview.previewToken).toMatch(/^[0-9a-f]{64}$/);
  });

  it("gives the same token for the same preview, and another when anything it says changes", () => {
    const input = {
      skillId: "skill-1",
      slug: "repo-map",
      from: HELIOS,
      to: ORG,
      universe: UNIVERSE,
      references,
      clashes: [],
    };

    const token = buildScopePreview(input).previewToken;

    expect(buildScopePreview(input).previewToken).toBe(token);
    expect(
      buildScopePreview({ ...input, clashes: [{ id: "s", slug: "s", name: "repo-map" }] })
        .previewToken,
    ).not.toBe(token);
    expect(buildScopePreview({ ...input, references: [] }).previewToken).not.toBe(token);
    expect(buildScopePreview({ ...input, skillId: "skill-2" }).previewToken).not.toBe(token);
  });
});
