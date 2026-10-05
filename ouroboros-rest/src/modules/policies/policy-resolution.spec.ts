import type { PublishedOrgPolicy } from "./org-policy.document";
import {
  autoMergeVerdict,
  dryRunNewReposVerdict,
  effectiveDryRun,
  effectivePerRunCap,
  humanReviewVerdict,
  protectedPathsVerdict,
  resolveRule,
  spendGuardVerdict,
} from "./policy-resolution";

/**
 * What each rule of the published org policy decides (BQ.2, #481) — one evaluator per rule, every
 * verdict attributed to its rule and version.
 */

/** Mockup 17's policy v7, as V092's header and the dev seed store it. */
const V7: PublishedOrgPolicy = {
  version: 7,
  publishedAt: new Date("2026-10-04T13:48:00Z"),
  rules: {
    auto_merge: {
      enabled: true,
      conditions: { all: [{ effort_lte: "m" }, { not: { label: "refactor" } }] },
    },
    human_review: {
      enabled: true,
      conditions: { any: [{ label: "refactor" }, { effort_gte: "l" }] },
    },
    protected_paths: {
      enabled: true,
      conditions: { path_globs: ["keys/**", "boot/**", ".github/**"] },
    },
    spend_guard: {
      enabled: true,
      conditions: { per_run_cap_cents: 250, monthly_cap_cents: 60000 },
    },
    dry_run_new_repos: { enabled: true, conditions: { first_n_loops: 10 } },
  },
};

/**
 * V7 with one rule replaced.
 *
 * @param ruleId - The rule.
 * @param rule - Its replacement.
 * @returns The policy, at v8.
 */
function v8With(
  ruleId: string,
  rule: { enabled: boolean; conditions: Record<string, unknown> },
): PublishedOrgPolicy {
  return { ...V7, version: 8, rules: { ...V7.rules, [ruleId]: rule } };
}

const SMALL_FIX = { labels: ["bug"], effort: "s" as const };
const REFACTOR = { labels: ["refactor"], effort: "s" as const };
const LARGE = { labels: ["bug"], effort: "l" as const };

describe("auto_merge", () => {
  it("lets a small non-refactor PR merge unattended under policy v7", () => {
    expect(autoMergeVerdict(V7, SMALL_FIX)).toEqual({
      ruleId: "auto_merge",
      version: 7,
      enabled: true,
      value: { eligible: true },
      reason: "The PR meets auto_merge in policy v7.",
    });
  });

  it("refuses it once the ticket is labelled refactor, or its effort rises above M", () => {
    for (const ticket of [REFACTOR, LARGE, { labels: [], effort: "xl" as const }]) {
      const verdict = autoMergeVerdict(V7, ticket);

      expect(verdict.value.eligible).toBe(false);
      expect(verdict.version).toBe(7);
      expect(verdict.reason).toBe(
        "The PR's ticket does not meet the auto_merge conditions in policy v7.",
      );
    }
  });

  it("refuses an unestimated ticket — it satisfies no size comparison", () => {
    expect(autoMergeVerdict(V7, { labels: [], effort: undefined }).value.eligible).toBe(false);
  });

  it("refuses everything while the rule is off", () => {
    const verdict = autoMergeVerdict(
      v8With("auto_merge", { ...V7.rules.auto_merge, enabled: false }),
      SMALL_FIX,
    );

    expect(verdict).toMatchObject({ enabled: false, version: 8, value: { eligible: false } });
    expect(verdict.reason).toBe("Auto-merge is off in policy v8.");
  });

  it("refuses, rather than guesses, under conditions it cannot read", () => {
    const verdict = autoMergeVerdict(
      v8With("auto_merge", { enabled: true, conditions: { sometimes: true } }),
      SMALL_FIX,
    );

    expect(verdict.value.eligible).toBe(false);
    expect(verdict.reason).toContain("could not be read");
  });

  it("leaves the pinned workflow to decide when nothing is published", () => {
    expect(autoMergeVerdict(null, REFACTOR)).toMatchObject({
      version: null,
      enabled: false,
      value: { eligible: true },
    });
  });
});

describe("human_review", () => {
  it("requires a person for a refactor-labelled PR, naming the label and the version", () => {
    expect(humanReviewVerdict(V7, REFACTOR)).toMatchObject({
      ruleId: "human_review",
      version: 7,
      value: { required: true, label: "refactor" },
      reason: "policy v7 requires a human review of anything labeled refactor.",
    });
  });

  it("requires one for a large PR without naming a label it did not match", () => {
    expect(humanReviewVerdict(V7, LARGE).value).toEqual({ required: true, label: null });
  });

  it("requires nothing of a small fix, while the rule is off, or with nothing published", () => {
    expect(humanReviewVerdict(V7, SMALL_FIX).value.required).toBe(false);
    expect(
      humanReviewVerdict(
        v8With("human_review", { ...V7.rules.human_review, enabled: false }),
        REFACTOR,
      ),
    ).toMatchObject({
      version: 8,
      value: { required: false },
      reason: "Human review is off in policy v8.",
    });
    expect(humanReviewVerdict(null, REFACTOR)).toMatchObject({
      version: null,
      value: { required: false },
    });
  });
});

describe("protected_paths", () => {
  it("answers the org globs sorted and deduplicated", () => {
    expect(
      protectedPathsVerdict(
        v8With("protected_paths", {
          enabled: true,
          conditions: { path_globs: ["b/**", "a/**", "b/**", 7] },
        }),
      ).value,
    ).toEqual({
      globs: ["a/**", "b/**"],
    });
    expect(protectedPathsVerdict(V7).value.globs).toEqual([".github/**", "boot/**", "keys/**"]);
  });

  it("answers none while the rule is off or nothing is published", () => {
    expect(
      protectedPathsVerdict(
        v8With("protected_paths", { ...V7.rules.protected_paths, enabled: false }),
      ).value.globs,
    ).toEqual([]);
    expect(protectedPathsVerdict(null).value.globs).toEqual([]);
  });
});

describe("spend_guard and the per-run cap's precedence", () => {
  it("reads the caps in cents", () => {
    expect(spendGuardVerdict(V7).value).toEqual({ perRunCapCents: 250, monthlyCapCents: 60000 });
    expect(
      spendGuardVerdict(
        v8With("spend_guard", { enabled: true, conditions: { monthly_cap_cents: 500 } }),
      ).value,
    ).toEqual({
      perRunCapCents: null,
      monthlyCapCents: 500,
    });
    expect(
      spendGuardVerdict(v8With("spend_guard", { ...V7.rules.spend_guard, enabled: false })).value
        .perRunCapCents,
    ).toBeNull();
  });

  it("caps with the guard when it is stricter than the route — and names it", () => {
    expect(effectivePerRunCap(400, spendGuardVerdict(V7))).toEqual({
      capCents: 250,
      limit: "spend_guard",
      version: 7,
    });
  });

  it("keeps the route's cap when it is the stricter — the other direction", () => {
    expect(effectivePerRunCap(100, spendGuardVerdict(V7))).toEqual({
      capCents: 100,
      limit: "route",
      version: null,
    });
  });

  it("names the route on a tie, and lends the guard's cap to a route with none", () => {
    expect(effectivePerRunCap(250, spendGuardVerdict(V7)).limit).toBe("route");
    expect(effectivePerRunCap(null, spendGuardVerdict(V7))).toEqual({
      capCents: 250,
      limit: "spend_guard",
      version: 7,
    });
  });

  it("leaves the route alone while the guard is off, and caps nothing when neither sets a cap", () => {
    const off = spendGuardVerdict(
      v8With("spend_guard", { ...V7.rules.spend_guard, enabled: false }),
    );

    expect(effectivePerRunCap(400, off)).toEqual({ capCents: 400, limit: "route", version: null });
    expect(effectivePerRunCap(null, off)).toEqual({ capCents: null, limit: null, version: null });
  });
});

describe("dry_run_new_repos and the org-wide override", () => {
  it("keeps a repository's first 10 loops in dry-run, and lets the 11th out", () => {
    expect(dryRunNewReposVerdict(V7, 1).value).toEqual({ active: true, firstNLoops: 10 });
    expect(dryRunNewReposVerdict(V7, 10).value.active).toBe(true);
    expect(dryRunNewReposVerdict(V7, 11).value.active).toBe(false);
  });

  it("reads an unknown repository the stricter way", () => {
    expect(dryRunNewReposVerdict(V7, null).value.active).toBe(true);
  });

  it("puts nothing in dry-run while the rule is off, at zero loops, or with nothing published", () => {
    expect(
      dryRunNewReposVerdict(
        v8With("dry_run_new_repos", { enabled: false, conditions: { first_n_loops: 10 } }),
        1,
      ).value.active,
    ).toBe(false);
    expect(
      dryRunNewReposVerdict(
        v8With("dry_run_new_repos", { enabled: true, conditions: { first_n_loops: 0 } }),
        1,
      ).value.active,
    ).toBe(false);
    expect(
      dryRunNewReposVerdict(
        v8With("dry_run_new_repos", { enabled: true, conditions: { first_n_loops: 0 } }),
        null,
      ).value.active,
    ).toBe(false);
    expect(dryRunNewReposVerdict(null, 1).value.active).toBe(false);
  });

  it("lets the org-wide switch force dry-run whatever the counter says — the stricter override", () => {
    expect(effectiveDryRun(true, dryRunNewReposVerdict(V7, 40))).toEqual({
      active: true,
      source: "org_override",
      version: null,
    });
    expect(effectiveDryRun(true, dryRunNewReposVerdict(null, 1)).source).toBe("org_override");
  });

  it("defers to the rule while the switch is off, naming the rule and its version", () => {
    expect(effectiveDryRun(false, dryRunNewReposVerdict(V7, 3))).toEqual({
      active: true,
      source: "dry_run_new_repos",
      version: 7,
    });
    expect(effectiveDryRun(false, dryRunNewReposVerdict(V7, 11))).toEqual({
      active: false,
      source: null,
      version: null,
    });
  });
});

describe("resolveRule", () => {
  it("dispatches each rule with the facts it needs, against the one version it is handed", () => {
    expect(resolveRule(V7, "auto_merge", { ticket: SMALL_FIX }).value).toEqual({ eligible: true });
    expect(resolveRule(V7, "human_review", { ticket: REFACTOR }).value.label).toBe("refactor");
    expect(resolveRule(V7, "protected_paths").value.globs).toHaveLength(3);
    expect(resolveRule(V7, "spend_guard").value.perRunCapCents).toBe(250);
    expect(resolveRule(V7, "dry_run_new_repos", { loop: 11 }).value.active).toBe(false);
  });

  it("reads a missing ticket as an empty one, and a missing loop as unknown", () => {
    expect(resolveRule(V7, "auto_merge").value.eligible).toBe(false);
    expect(resolveRule(V7, "dry_run_new_repos").value.active).toBe(true);
  });

  it("attributes every verdict to its rule and the version it read", () => {
    for (const ruleId of [
      "auto_merge",
      "human_review",
      "protected_paths",
      "spend_guard",
      "dry_run_new_repos",
    ] as const) {
      expect(resolveRule(V7, ruleId)).toMatchObject({ ruleId, version: 7 });
      expect(resolveRule(null, ruleId)).toMatchObject({ ruleId, version: null });
    }
  });
});
