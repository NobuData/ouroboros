import type { PublishedOrgPolicy } from "../policies/org-policy.document";
import {
  CLAIM_WAIVER_ROW,
  DRY_RUN_CAPTION,
  MERGES_ITSELF,
  POLICIES_HREF,
  PROTECTED_PATHS_HREF,
  humanReviewRows,
  policyCard,
  protectedPathsRow,
  spendRow,
  type PolicySources,
} from "./inbox-policies.compose";

/**
 * The What Needs A Human card (#464, X7): every row derives from the config that enforces it, the
 * rows nothing enforces are absent, and the caption follows dry-run.
 */

/** Policy v7, as the dev seed publishes it. */
const V7: PublishedOrgPolicy = {
  version: 7,
  publishedAt: new Date("2026-10-04T00:00:00Z"),
  rules: {
    human_review: {
      enabled: true,
      conditions: { any: [{ label: "refactor" }, { effort_gte: "l" }] },
    },
    spend_guard: {
      enabled: true,
      conditions: { per_run_cap_cents: 250, monthly_cap_cents: 50000 },
    },
  },
};

/** The seeded workspace's sources. */
const SEEDED: PolicySources = {
  policy: V7,
  protectedPaths: [
    { glob: "boot/**", repos: 2 },
    { glob: "keys/**", repos: 1 },
  ],
  spendDormant: true,
  dryRun: false,
};

describe("policyCard", () => {
  it("reads the mockup's rows that something enforces, in its order, under its caption", () => {
    const card = policyCard(SEEDED);

    expect(card.rows.map((row) => `${row.rule} → ${row.outcome}`)).toEqual([
      "refactor label → human review",
      "effort L+ → human review",
      "protected paths → allow-once",
      "unverifiable claims → explicit waiver",
    ]);
    expect(card.caption).toBe(MERGES_ITSELF);
    expect(card.policyVersion).toBe(7);
    expect(card.dryRun).toBe(false);
  });

  it("leaves out the spend row while no per-run cap is enforced (AF.4), and plan sign-off always", () => {
    const ids = policyCard(SEEDED).rows.map((row) => row.id);

    expect(ids).not.toContain("spend_guard");
    expect(ids.some((id) => id.includes("plan"))).toBe(false);
  });

  it("shows the spend row, from the document's cap, once spend approval is live", () => {
    expect(policyCard({ ...SEEDED, spendDormant: false }).rows.at(-1)).toMatchObject({
      id: "spend_guard",
      rule: "spend > $2.50/run",
      outcome: "approval",
      editHref: POLICIES_HREF,
    });
  });

  it("drops the refactor row when the policy turns human review off", () => {
    const off: PublishedOrgPolicy = {
      ...V7,
      rules: { ...V7.rules, human_review: { enabled: false, conditions: { label: "refactor" } } },
    };

    expect(policyCard({ ...SEEDED, policy: off }).rows.map((row) => row.id)).toEqual([
      "protected_paths",
      "claim_waiver",
    ]);
  });

  it("changes the protected-paths row's text when a path changes, and drops it when none is protected", () => {
    const before = policyCard(SEEDED).rows.find((row) => row.id === "protected_paths");
    const after = policyCard({
      ...SEEDED,
      protectedPaths: [{ glob: ".github/**", repos: 1 }],
    }).rows.find((row) => row.id === "protected_paths");

    expect(before?.detail).toBe("boot/** · keys/**");
    expect(after?.detail).toBe(".github/**");
    expect(policyCard({ ...SEEDED, protectedPaths: [] }).rows.map((row) => row.id)).not.toContain(
      "protected_paths",
    );
  });

  it("changes the caption truthfully when dry-run is on", () => {
    expect(policyCard({ ...SEEDED, dryRun: true })).toMatchObject({
      caption: DRY_RUN_CAPTION,
      dryRun: true,
    });
  });

  it("has no document rows for a workspace that published no policy", () => {
    const card = policyCard({ ...SEEDED, policy: null });

    expect(card.rows.map((row) => row.id)).toEqual(["protected_paths", "claim_waiver"]);
    expect(card.policyVersion).toBeNull();
  });

  it("points every row at the surface that owns it", () => {
    const hrefs = Object.fromEntries(policyCard(SEEDED).rows.map((row) => [row.id, row.editHref]));

    expect(hrefs).toEqual({
      "human_review:label:refactor": POLICIES_HREF,
      "human_review:effort": POLICIES_HREF,
      protected_paths: PROTECTED_PATHS_HREF,
      claim_waiver: POLICIES_HREF,
    });
    expect(CLAIM_WAIVER_ROW.source).toContain("AX.3");
  });
});

describe("humanReviewRows", () => {
  it("reads a single condition, and gathers anything not atomic into one row", () => {
    expect(
      humanReviewRows({ enabled: true, conditions: { label: "security" } }, 3).map(
        (row) => row.rule,
      ),
    ).toEqual(["security label"]);
    expect(
      humanReviewRows(
        {
          enabled: true,
          conditions: {
            any: [
              { not: { label: "docs" } },
              { all: [{ effort_lte: "s" }] },
              { label: "refactor" },
            ],
          },
        },
        3,
      ).map((row) => row.id),
    ).toEqual(["human_review:label:refactor", "human_review:other"]);
  });

  it("names the policy version it was read from", () => {
    expect(
      humanReviewRows({ enabled: true, conditions: { label: "refactor" } }, 7)[0].source,
    ).toContain("Org policy v7");
  });

  it("has no rows for a missing or disabled rule", () => {
    expect(humanReviewRows(undefined, 7)).toEqual([]);
  });
});

describe("the protected-paths row, from the same resolver as AP.3 (BQ.2, #481)", () => {
  /** V7 protecting OTA manifests in every repository. */
  const WITH_ORG_GLOBS: PublishedOrgPolicy = {
    ...V7,
    rules: {
      ...V7.rules,
      protected_paths: { enabled: true, conditions: { path_globs: ["ota/**", "boot/**"] } },
    },
  };

  it("lists the union AP.3 gates on — the document's globs and each repository's rows — once each", () => {
    const row = policyCard({ ...SEEDED, policy: WITH_ORG_GLOBS }).rows.find(
      (each) => each.id === "protected_paths",
    );

    expect(row).toMatchObject({
      detail: "boot/** · keys/** · ota/**",
      source:
        "Org policy v7 · protected_paths in every repository, and BA.1's rows · up to 2 repositories — AP.3 stops an edit, a person may allow it once",
      editHref: POLICIES_HREF,
    });
  });

  it("shows the row for a workspace whose only protection is the document's", () => {
    const row = policyCard({ ...SEEDED, policy: WITH_ORG_GLOBS, protectedPaths: [] }).rows.find(
      (each) => each.id === "protected_paths",
    );

    expect(row).toMatchObject({
      detail: "boot/** · ota/**",
      source:
        "Org policy v7 · protected_paths in every repository — AP.3 stops an edit, a person may allow it once",
    });
  });

  it("changes its text when the document's globs are edited, and drops them while the rule is off", () => {
    const edited: PublishedOrgPolicy = {
      ...V7,
      version: 8,
      rules: {
        ...V7.rules,
        protected_paths: { enabled: true, conditions: { path_globs: ["ota/manifest.json"] } },
      },
    };
    const off: PublishedOrgPolicy = {
      ...V7,
      version: 8,
      rules: {
        ...V7.rules,
        protected_paths: { enabled: false, conditions: { path_globs: ["ota/**"] } },
      },
    };

    expect(
      policyCard({ ...SEEDED, policy: edited, protectedPaths: [] }).rows.find(
        (each) => each.id === "protected_paths",
      )?.detail,
    ).toBe("ota/manifest.json");
    expect(
      policyCard({ ...SEEDED, policy: off, protectedPaths: [] }).rows.map((each) => each.id),
    ).not.toContain("protected_paths");
    expect(
      policyCard({ ...SEEDED, policy: off }).rows.find((each) => each.id === "protected_paths")
        ?.editHref,
    ).toBe(PROTECTED_PATHS_HREF);
  });
});

describe("protectedPathsRow and spendRow", () => {
  it("counts the repositories that protect a path", () => {
    expect(protectedPathsRow([{ glob: "boot/**", repos: 1 }])?.source).toContain("1 repository");
    expect(protectedPathsRow([])).toBeNull();
  });

  it("needs an enabled spend guard naming a per-run cap", () => {
    expect(
      spendRow({ enabled: true, conditions: { monthly_cap_cents: 100 } }, false, 7),
    ).toBeNull();
    expect(
      spendRow({ enabled: false, conditions: { per_run_cap_cents: 250 } }, false, 7),
    ).toBeNull();
    expect(spendRow(undefined, false, 7)).toBeNull();
  });
});
