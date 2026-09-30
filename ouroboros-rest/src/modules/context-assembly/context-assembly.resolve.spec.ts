/**
 * The one resolution, cell by cell ([#414](https://github.com/NobuData/ouroboros/issues/414),
 * decision K8). Removing the required lock, the draft gate or closest-wins turns a named case here
 * red — which is what BF.7's *"removing the required-lock or closest-wins turns fixtures red"* asks
 * of the integration suite, held first at the unit.
 */

import type { SkillScope } from "../db/schema";
import {
  DOCS_LOOP_ID,
  HELIOS,
  TELEMETRY,
  fact,
  input,
  repoSkill,
  skill,
  uuid,
  workflowSkill,
} from "./context-assembly.fixture";
import { estimateTokens } from "./context-assembly.profiles";
import { resolveManifest, type CandidateSkill } from "./context-assembly.resolve";
import type { ContextManifest } from "./context-assembly.resources";

/** The slugs a manifest carries, in order. */
function slugs(manifest: ContextManifest): string[] {
  return manifest.skillVersions.map((entry) => entry.slug);
}

/** A manifest's exclusion for one slug, if any. */
function exclusionOf(manifest: ContextManifest, slug: string) {
  return manifest.excluded.find((entry) => entry.slug === slug);
}

// ---------------------------------------------------------------------------
// The single-skill matrix: scope × in-scope × enabled × required × draft × override
// ---------------------------------------------------------------------------

type Override = "none" | "enable" | "disable";

interface Cell {
  scope: SkillScope;
  inScope: boolean;
  enabled: boolean;
  required: boolean;
  draft: boolean;
  override: Override;
}

/** Every cell V069 can store: a required skill is enabled and never a draft. */
const CELLS: Cell[] = (["org", "repo", "workflow"] as SkillScope[]).flatMap((scope) =>
  [true, false].flatMap((inScope) =>
    // An org skill is in every scope; there is no out-of-scope org cell.
    scope === "org" && !inScope
      ? []
      : [true, false].flatMap((enabled) =>
          [true, false].flatMap((required) =>
            [true, false].flatMap((draft) =>
              required && (!enabled || draft)
                ? []
                : (["none", "enable", "disable"] as Override[]).map((override) => ({
                    scope,
                    inScope,
                    enabled,
                    required,
                    draft,
                    override,
                  })),
            ),
          ),
        ),
  ),
);

/** The candidate a cell describes. */
function candidate(cell: Cell): CandidateSkill {
  const referent =
    cell.scope === "repo"
      ? { repoRef: cell.inScope ? HELIOS : TELEMETRY }
      : cell.scope === "workflow"
        ? { workflowId: cell.inScope ? input().workflowId : DOCS_LOOP_ID }
        : {};

  return skill({
    slug: "the-skill",
    scope: cell.scope,
    enabled: cell.enabled,
    required: cell.required,
    draft: cell.draft,
    ...referent,
  });
}

/** What the rules say a cell resolves to — the oracle, written from the service header. */
function expected(cell: Cell): {
  kept: boolean;
  excluded: string | null;
  refused: string | null;
} {
  const candidateAtAll = cell.inScope && !cell.draft;

  if (!candidateAtAll) {
    return {
      kept: false,
      excluded: null,
      refused: cell.override === "none" ? null : "not_resolved",
    };
  }
  if (cell.required) {
    return { kept: true, excluded: null, refused: cell.override === "disable" ? "required" : null };
  }
  if (cell.enabled) {
    return cell.override === "disable"
      ? { kept: false, excluded: "override_disabled", refused: null }
      : { kept: true, excluded: null, refused: null };
  }
  if (cell.override === "enable") {
    return { kept: true, excluded: null, refused: null };
  }
  return {
    kept: false,
    excluded: "disabled",
    refused: cell.override === "disable" ? "not_resolved" : null,
  };
}

describe("the resolution matrix — scope × in-scope × enabled × required × draft × override", () => {
  it("has every storable cell", () => {
    // 3 scopes' in/out (5) × enabled/required/draft combinations V069 admits (5) × 3 overrides.
    expect(CELLS).toHaveLength(5 * 5 * 3);
  });

  it.each(CELLS.map((cell) => [JSON.stringify(cell), cell] as const))("%s", (_name, cell) => {
    const subject = candidate(cell);
    const overrides =
      cell.override === "none"
        ? { enable: [], disable: [] }
        : cell.override === "enable"
          ? { enable: [subject.id], disable: [] }
          : { enable: [], disable: [subject.id] };

    const manifest = resolveManifest(input({ skills: [subject], overrides }));
    const want = expected(cell);

    expect(slugs(manifest)).toEqual(want.kept ? ["the-skill"] : []);
    expect(exclusionOf(manifest, "the-skill")?.reason ?? null).toBe(want.excluded);
    expect(manifest.refusedOverrides.map((refusal) => refusal.reason)).toEqual(
      want.refused === null ? [] : [want.refused],
    );
  });
});

// ---------------------------------------------------------------------------
// Closest scope wins on conflict
// ---------------------------------------------------------------------------

describe("closest scope wins on a name conflict", () => {
  const pairs: [SkillScope, SkillScope][] = [
    ["workflow", "repo"],
    ["workflow", "org"],
    ["repo", "org"],
  ];

  /** A skill named `Zephyr conventions` at a scope. */
  function named(scope: SkillScope, overrides: Partial<CandidateSkill> = {}): CandidateSkill {
    const slug = `zephyr-at-${scope}`;
    const base = { slug, name: "Zephyr conventions", ...overrides };

    return scope === "workflow"
      ? workflowSkill(base)
      : scope === "repo"
        ? repoSkill(base)
        : skill(base);
  }

  it.each(pairs)("%s beats %s", (closer, farther) => {
    const manifest = resolveManifest(input({ skills: [named(farther), named(closer)] }));

    expect(slugs(manifest)).toEqual([`zephyr-at-${closer}`]);
    expect(exclusionOf(manifest, `zephyr-at-${farther}`)).toMatchObject({
      reason: "shadowed",
      by: `zephyr-at-${closer}`,
    });
  });

  it.each(pairs)("a switched-off %s skill switches the %s one off", (closer, farther) => {
    const manifest = resolveManifest(
      input({ skills: [named(farther), named(closer, { enabled: false })] }),
    );

    expect(slugs(manifest)).toEqual([]);
    expect(exclusionOf(manifest, `zephyr-at-${closer}`)?.reason).toBe("disabled");
    expect(exclusionOf(manifest, `zephyr-at-${farther}`)?.reason).toBe("shadowed");
  });

  it("compares names case-insensitively, as BF.1's clash rule does", () => {
    const manifest = resolveManifest(
      input({
        skills: [
          skill({ slug: "a", name: "Commit Style" }),
          repoSkill({ slug: "b", name: "commit style " }),
        ],
      }),
    );

    expect(slugs(manifest)).toEqual(["b"]);
  });

  it("does not contest skills of different names", () => {
    const manifest = resolveManifest(
      input({
        skills: [skill({ slug: "a" }), repoSkill({ slug: "b" }), workflowSkill({ slug: "c" })],
      }),
    );

    expect(slugs(manifest)).toEqual(["c", "b", "a"]);
  });

  it("resolves deterministically whatever order the rows arrive in", () => {
    const rows = [
      skill({ slug: "org-one", name: "Same" }),
      repoSkill({ slug: "repo-one", name: "Same" }),
      repoSkill({ slug: "repo-two", name: "Same" }),
      workflowSkill({ slug: "wf", name: "Other" }),
      skill({ slug: "zeta" }),
    ];
    const forwards = resolveManifest(input({ skills: rows }));
    const backwards = resolveManifest(input({ skills: [...rows].reverse() }));

    expect(JSON.stringify(backwards)).toBe(JSON.stringify(forwards));
    // Two repo skills of one name: the tie at the same scope is broken by slug.
    expect(slugs(forwards)).toEqual(["wf", "repo-one", "zeta"]);
  });
});

// ---------------------------------------------------------------------------
// Required cannot be overridden off, at any scope
// ---------------------------------------------------------------------------

describe("the required lock", () => {
  const hil = repoSkill({ slug: "hil-safety", name: "HIL safety", required: true });

  it("cannot be switched off by a workflow-scoped skill of the same name", () => {
    const off = workflowSkill({ slug: "hil-safety-off", name: "HIL safety", enabled: false });
    const manifest = resolveManifest(input({ skills: [hil, off] }));

    expect(slugs(manifest)).toEqual(["hil-safety"]);
    expect(exclusionOf(manifest, "hil-safety-off")).toMatchObject({
      reason: "shadowed",
      by: "hil-safety",
    });
  });

  it("cannot be replaced by a closer enabled skill of the same name", () => {
    const weaker = workflowSkill({ slug: "hil-lite", name: "hil safety" });
    const manifest = resolveManifest(input({ skills: [hil, weaker] }));

    expect(slugs(manifest)).toEqual(["hil-safety"]);
    expect(exclusionOf(manifest, "hil-lite")?.reason).toBe("shadowed");
  });

  it("cannot be disabled by an override — the refusal is recorded", () => {
    const manifest = resolveManifest(
      input({ skills: [hil], overrides: { enable: [], disable: [hil.id] } }),
    );

    expect(slugs(manifest)).toEqual(["hil-safety"]);
    expect(manifest.refusedOverrides).toEqual([
      { skillId: hil.id, action: "disable", reason: "required" },
    ]);
  });

  it("is carried in the required tier, first", () => {
    const manifest = resolveManifest(
      input({ skills: [workflowSkill({ slug: "a" }), hil, skill({ slug: "b" })] }),
    );

    expect(manifest.skillVersions.map((entry) => [entry.slug, entry.tier])).toEqual([
      ["hil-safety", "required"],
      ["a", "workflow"],
      ["b", "org"],
    ]);
  });
});

// ---------------------------------------------------------------------------
// Overrides beyond the matrix
// ---------------------------------------------------------------------------

describe("overrides", () => {
  it("refuses to enable a shadowed skill", () => {
    const org = skill({ slug: "org-style", name: "Style" });
    const repo = repoSkill({ slug: "repo-style", name: "Style" });
    const manifest = resolveManifest(
      input({ skills: [org, repo], overrides: { enable: [org.id], disable: [] } }),
    );

    expect(slugs(manifest)).toEqual(["repo-style"]);
    expect(manifest.refusedOverrides).toEqual([
      { skillId: org.id, action: "enable", reason: "shadowed" },
    ]);
  });

  it("ignores an override naming a skill it never saw — another workspace's, say", () => {
    const stranger = uuid(999_999);
    const manifest = resolveManifest(
      input({
        skills: [skill({ slug: "a" })],
        overrides: { enable: [stranger], disable: [stranger] },
      }),
    );

    expect(slugs(manifest)).toEqual(["a"]);
    expect(manifest.refusedOverrides.map((refusal) => refusal.reason)).toEqual([
      "not_resolved",
      "not_resolved",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Drafts and non-confirmed facts never appear
// ---------------------------------------------------------------------------

describe("what never appears", () => {
  it("never carries a draft skill, whatever else is true of it", () => {
    for (const scope of ["org", "repo", "workflow"] as SkillScope[]) {
      for (const enabled of [true, false]) {
        const draft = skill({
          slug: "power-budget-checks",
          scope,
          repoRef: scope === "repo" ? HELIOS : null,
          workflowId: scope === "workflow" ? input().workflowId : null,
          enabled,
          draft: true,
        });
        const manifest = resolveManifest(
          input({ skills: [draft], overrides: { enable: [draft.id], disable: [] } }),
        );

        expect(manifest.skillVersions).toEqual([]);
        expect(manifest.excluded).toEqual([]);
      }
    }
  });

  it("never carries a skill with no published version", () => {
    const unpublished = skill({ slug: "new", versionId: null, version: null, body: null });

    expect(resolveManifest(input({ skills: [unpublished] })).skillVersions).toEqual([]);
  });

  it.each([["proposed"], ["stale"], ["rejected"], ["expired"]] as const)(
    "never carries a %s fact",
    (status) => {
      const manifest = resolveManifest(
        input({ facts: [fact({ status }), fact({ status, repoRef: HELIOS })] }),
      );

      expect(manifest.facts).toEqual([]);
    },
  );

  it("carries confirmed facts: the workspace's always, a repository's only in it", () => {
    const wide = fact({ text: "workspace-wide" });
    const ours = fact({ text: "ours", repoRef: "Acme-Robotics/Helios-Firmware" });
    const theirs = fact({ text: "theirs", repoRef: TELEMETRY });

    const inHelios = resolveManifest(input({ facts: [wide, theirs, ours] }));
    const nowhere = resolveManifest(input({ repo: null, facts: [wide, theirs, ours] }));

    expect(inHelios.facts.map((entry) => [entry.text, entry.tier])).toEqual([
      ["ours", "repo"],
      ["workspace-wide", "org"],
    ]);
    expect(nowhere.facts.map((entry) => entry.text)).toEqual(["workspace-wide"]);
  });
});

// ---------------------------------------------------------------------------
// The manifest names versions
// ---------------------------------------------------------------------------

describe("the manifest's entries", () => {
  it("name the version in force, not the slug alone", () => {
    const zephyr = repoSkill({
      slug: "zephyr-conventions",
      versionId: uuid(12, "5eed0070"),
      version: 12,
      frontmatter: { load: "on_trigger", triggers: ["Kconfig", "ISR"] },
    });
    const [entry] = resolveManifest(input({ skills: [zephyr] })).skillVersions;

    expect(entry).toMatchObject({
      slug: "zephyr-conventions",
      versionId: uuid(12, "5eed0070"),
      version: 12,
      load: "on_trigger",
      triggers: ["Kconfig", "ISR"],
      estTokens: estimateTokens(zephyr.body ?? ""),
    });
  });

  it("change their hash when a skill's version in force changes", () => {
    const v12 = repoSkill({ slug: "zephyr", versionId: uuid(12, "5eed0070"), version: 12 });
    const v13 = { ...v12, versionId: uuid(13, "5eed0070"), version: 13 };

    expect(resolveManifest(input({ skills: [v12] })).manifestHash).not.toBe(
      resolveManifest(input({ skills: [v13] })).manifestHash,
    );
  });

  it("hash the same for the same inputs, as lower-case sha256", () => {
    const rows = input({ skills: [skill({ slug: "a" })], facts: [fact()] });

    expect(resolveManifest(rows).manifestHash).toBe(resolveManifest(rows).manifestHash);
    expect(resolveManifest(rows).manifestHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("carry facts only for the estimator, whose engine contract takes nothing else", () => {
    const manifest = resolveManifest(
      input({
        consumer: "estimator",
        skills: [skill({ slug: "a", required: true })],
        facts: [fact()],
      }),
    );

    expect(manifest.skillVersions).toEqual([]);
    expect(manifest.facts).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// The trim policy
// ---------------------------------------------------------------------------

describe("the trim policy", () => {
  /** A skill whose body costs `tokens`. */
  function sized(
    make: (overrides: Partial<CandidateSkill> & { slug: string }) => CandidateSkill,
    slug: string,
    tokens: number,
    overrides: Partial<CandidateSkill> = {},
  ): CandidateSkill {
    return make({ slug, body: "x".repeat(tokens * 4), ...overrides });
  }

  const required = sized(repoSkill, "hil-safety", 100, { required: true });
  const wf = sized(workflowSkill, "wf-skill", 100);
  const repo = sized(repoSkill, "repo-skill", 100);
  const org = sized(skill, "org-skill", 100);
  const repoFact = fact({ text: "r".repeat(40), repoRef: HELIOS });
  const orgFact = fact({ text: "o".repeat(40) });
  const rows = { skills: [org, repo, wf, required], facts: [orgFact, repoFact] };

  it("trims nothing when the budget allows", () => {
    const manifest = resolveManifest(input({ ...rows, budgetTokens: 1_000 }));

    expect(manifest.trimmed).toEqual([]);
    expect(manifest.estTokens).toBe(420);
  });

  it("drops org first, skills before facts, then repo, then workflow — and records each", () => {
    const manifest = resolveManifest(input({ ...rows, budgetTokens: 200 }));

    expect(
      manifest.trimmed.map((entry) => [
        entry.kind,
        entry.slug ?? entry.id,
        entry.tier,
        entry.reason,
      ]),
    ).toEqual([
      ["skill", "org-skill", "org", "over_budget"],
      ["fact", orgFact.id, "org", "over_budget"],
      ["skill", "repo-skill", "repo", "over_budget"],
      ["fact", repoFact.id, "repo", "over_budget"],
    ]);
    expect(slugs(manifest)).toEqual(["hil-safety", "wf-skill"]);
    expect(manifest.estTokens).toBe(200);
  });

  it("never drops a required skill, even over budget", () => {
    const manifest = resolveManifest(input({ ...rows, budgetTokens: 50 }));

    expect(slugs(manifest)).toEqual(["hil-safety"]);
    expect(manifest.facts).toEqual([]);
    expect(manifest.estTokens).toBe(100);
    expect(manifest.estTokens).toBeGreaterThan(manifest.budgetTokens);
  });

  it("drops the largest first within a tier, ties by slug", () => {
    const big = sized(skill, "big", 90);
    const smallA = sized(skill, "small-a", 10);
    const smallB = sized(skill, "small-b", 10);
    const manifest = resolveManifest(input({ skills: [smallB, big, smallA], budgetTokens: 15 }));

    expect(manifest.trimmed.map((entry) => entry.slug)).toEqual(["big", "small-a"]);
    expect(slugs(manifest)).toEqual(["small-b"]);
  });

  it("records the skill version it dropped, not the slug alone", () => {
    const manifest = resolveManifest(input({ skills: [org], budgetTokens: 1 }));

    expect(manifest.trimmed[0]).toMatchObject({
      kind: "skill",
      id: org.versionId,
      slug: "org-skill",
    });
  });

  it("caps the estimator at 64 facts, repository facts kept longest", () => {
    const facts = [
      ...Array.from({ length: 60 }, () => fact({ text: "wide" })),
      ...Array.from({ length: 10 }, () => fact({ text: "ours", repoRef: HELIOS })),
    ];
    const manifest = resolveManifest(input({ consumer: "estimator", facts, budgetTokens: 8_000 }));

    expect(manifest.facts).toHaveLength(64);
    expect(manifest.facts.filter((entry) => entry.tier === "repo")).toHaveLength(10);
    expect(manifest.trimmed).toHaveLength(6);
    expect(new Set(manifest.trimmed.map((entry) => entry.reason))).toEqual(new Set(["item_limit"]));
  });

  it("is deterministic: the same rows trim the same way in any order", () => {
    const a = resolveManifest(input({ ...rows, budgetTokens: 250 }));
    const b = resolveManifest(
      input({
        skills: [...rows.skills].reverse(),
        facts: [...rows.facts].reverse(),
        budgetTokens: 250,
      }),
    );

    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it("changes the hash when a trim changes what goes in", () => {
    expect(resolveManifest(input({ ...rows, budgetTokens: 200 })).manifestHash).not.toBe(
      resolveManifest(input({ ...rows, budgetTokens: 1_000 })).manifestHash,
    );
  });
});
