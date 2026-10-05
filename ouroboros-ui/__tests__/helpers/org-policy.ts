import type { OrgPolicy } from "@/app/api/org-policy";
import type { PolicyPreview, PolicyVersionEntry } from "@/app/policies/card-view";
import type { PolicyDocument } from "@/app/policies/document";

/**
 * The Autonomy policies card's fixtures (BS.4, #494) — mockup 17's `policy v7`, as
 * `schemas/org-policy/fixtures/valid/policy-v7.json` holds it and the dev seed publishes it.
 */

/** Mockup 17's document: every rule on, with the chips the card draws. */
export const POLICY_V7: PolicyDocument = {
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
    conditions: { path_globs: ["boot/**", "keys/**", ".github/**"] },
  },
  spend_guard: {
    enabled: true,
    conditions: { per_run_cap_cents: 250, monthly_cap_cents: 60_000 },
  },
  dry_run_new_repos: { enabled: true, conditions: { first_n_loops: 10 } },
};

/** The seed's v6: v7 before auto-merge was turned on. */
export const POLICY_V6: PolicyDocument = {
  ...POLICY_V7,
  auto_merge: { ...POLICY_V7.auto_merge, enabled: false },
};

/**
 * The version in force, as `GET /api/v1/policies` answers it.
 *
 * @param overrides Fields to replace.
 * @returns The payload.
 */
export function orgPolicyV7(overrides: Partial<OrgPolicy> = {}): OrgPolicy {
  return {
    version: 7,
    document: POLICY_V7,
    publishedAt: "2026-10-04T13:48:00.000Z",
    publishedBy: "user-ken",
    changeNote: "Enable auto-merge",
    ...overrides,
  };
}

/** A workspace that has published nothing. */
export const UNPUBLISHED: OrgPolicy = {
  version: null,
  document: null,
  publishedAt: null,
  publishedBy: null,
  changeNote: null,
};

/** The seed's v7 in the history: one rule changed, and it loosened. */
export const VERSION_7: PolicyVersionEntry = {
  version: 7,
  publishedAt: "2026-10-04T13:48:00.000Z",
  publishedBy: "user-ken",
  publisherName: "Ken",
  changeNote: "Enable auto-merge",
  classification: "loosening",
  changes: [
    { ruleId: "auto_merge", classification: "loosening", verb: "enabled", summary: "enabled auto-merge" },
  ],
  summary: "enabled auto-merge (policy v7)",
  document: POLICY_V7,
};

/** The seed's v6 in the history. */
export const VERSION_6: PolicyVersionEntry = {
  version: 6,
  publishedAt: "2026-10-01T09:12:00.000Z",
  publishedBy: "user-maya",
  publisherName: "Maya Chen",
  changeNote: null,
  classification: "tightening",
  changes: [
    {
      ruleId: "spend_guard",
      classification: "tightening",
      verb: "changed",
      summary: "changed spend guard",
    },
  ],
  summary: "changed spend guard (policy v6)",
  document: POLICY_V6,
};

/**
 * A preview, as `POST /api/v1/policies/preview` answers it.
 *
 * @param overrides Fields to replace. Defaults to a tightening this reader may publish.
 * @returns The preview.
 */
export function policyPreview(overrides: Partial<PolicyPreview> = {}): PolicyPreview {
  return {
    baseVersion: 7,
    classification: "tightening",
    changes: [
      {
        ruleId: "spend_guard",
        classification: "tightening",
        verb: "changed",
        summary: "changed spend guard",
      },
    ],
    requiresOwner: false,
    mayPublish: true,
    ...overrides,
  };
}

/** A preview of a loosening an admin may not publish. */
export const GATED_PREVIEW: PolicyPreview = policyPreview({
  classification: "loosening",
  changes: [
    {
      ruleId: "human_review",
      classification: "loosening",
      verb: "disabled",
      summary: "disabled human review",
    },
  ],
  requiresOwner: true,
  mayPublish: false,
});
