import type { PolicyHistoryStore, StoredPolicyHistoryVersion } from "./org-policy.repository";
import {
  POLICY_HISTORY_PAGE_DEFAULT,
  PolicyHistoryService,
  policyVersionResource,
} from "./policy-history.service";
import { diffPolicies, publishSummary } from "./policy-publish";
import { rulesOf } from "./org-policy.document";

/**
 * The version history (BS.4, #494): newest first, each version diffed against the one before it by
 * the publish's own functions, the first against "no policy", and paged by one extra row.
 */

/** Mockup 17's policy v7. */
const V7_DOCUMENT = {
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
  spend_guard: { enabled: true, conditions: { per_run_cap_cents: 250, monthly_cap_cents: 60000 } },
  dry_run_new_repos: { enabled: true, conditions: { first_n_loops: 10 } },
};

/** v6: auto-merge still off. */
const V6_DOCUMENT = { ...V7_DOCUMENT, auto_merge: { ...V7_DOCUMENT.auto_merge, enabled: false } };

/**
 * A stored version.
 *
 * @param version - Its number.
 * @param document - Its document.
 * @param overrides - Fields to change.
 * @returns The row.
 */
function stored(
  version: number,
  document: Record<string, unknown>,
  overrides: Partial<StoredPolicyHistoryVersion> = {},
): StoredPolicyHistoryVersion {
  return {
    version,
    document,
    publishedAt: new Date(`2026-10-0${String(Math.min(version, 9))}T13:48:00.000Z`),
    publishedBy: "user-ken",
    publisherName: "Ken",
    changeNote: null,
    ...overrides,
  };
}

/**
 * A store over a list of versions, recording what it was asked.
 *
 * @param rows - Every version, any order.
 * @returns The store and its calls.
 */
function storeOf(rows: readonly StoredPolicyHistoryVersion[]) {
  const calls: { organizationId: string; before: number | null; take: number }[] = [];
  const store: PolicyHistoryStore = {
    versions(organizationId, before, take) {
      calls.push({ organizationId, before, take });

      return Promise.resolve(
        [...rows]
          .sort((left, right) => right.version - left.version)
          .filter((row) => before === null || row.version < before)
          .slice(0, take),
      );
    },
  };

  return { store, calls };
}

describe("the policy version history", () => {
  it("answers an empty page for a workspace that has published nothing", async () => {
    const { store, calls } = storeOf([]);

    await expect(new PolicyHistoryService(store).list("org-494")).resolves.toEqual({
      items: [],
      nextBefore: null,
    });
    expect(calls).toEqual([
      { organizationId: "org-494", before: null, take: POLICY_HISTORY_PAGE_DEFAULT + 1 },
    ]);
  });

  it("lists newest first, each version diffed against the one before it", async () => {
    const { store } = storeOf([
      stored(6, V6_DOCUMENT, { changeNote: "Baseline." }),
      stored(7, V7_DOCUMENT, { changeNote: "Enable auto-merge" }),
    ]);

    const page = await new PolicyHistoryService(store).list("org-494");

    expect(page.nextBefore).toBeNull();
    expect(page.items.map((item) => item.version)).toEqual([7, 6]);
    expect(page.items[0]).toEqual({
      version: 7,
      publishedAt: "2026-10-07T13:48:00.000Z",
      publishedBy: "user-ken",
      publisherName: "Ken",
      changeNote: "Enable auto-merge",
      document: V7_DOCUMENT,
      classification: "loosening",
      changes: [
        {
          ruleId: "auto_merge",
          classification: "loosening",
          verb: "enabled",
          summary: "enabled auto-merge",
        },
      ],
      summary: "enabled auto-merge (policy v7)",
    });
  });

  it("diffs the first version against no policy, exactly as its publish did", async () => {
    const { store } = storeOf([stored(1, V6_DOCUMENT)]);

    const [first] = (await new PolicyHistoryService(store).list("org-494")).items;
    const publish = diffPolicies(null, rulesOf(V6_DOCUMENT));

    expect(first.changes).toEqual(publish.changes);
    expect(first.classification).toBe(publish.classification);
    expect(first.summary).toBe(publishSummary(publish, 1));
    expect(first.changes.length).toBeGreaterThan(0);
  });

  it("pages by one extra row: the last item's predecessor, and the next page's cursor", async () => {
    const { store, calls } = storeOf([
      stored(5, V6_DOCUMENT),
      stored(6, V6_DOCUMENT),
      stored(7, V7_DOCUMENT),
    ]);
    const history = new PolicyHistoryService(store);

    const first = await history.list("org-494", 2);

    expect(first.items.map((item) => item.version)).toEqual([7, 6]);
    expect(first.nextBefore).toBe(6);
    // v6 is diffed against v5 — the extra row — not against "no policy".
    expect(first.items[1].changes).toEqual([]);
    expect(first.items[1].summary).toBe("republished the policy (policy v6)");

    const second = await history.list("org-494", 2, first.nextBefore);

    expect(second.items.map((item) => item.version)).toEqual([5]);
    expect(second.nextBefore).toBeNull();
    expect(calls.map((call) => [call.before, call.take])).toEqual([
      [null, 3],
      [6, 3],
    ]);
  });

  it("keeps a deleted publisher as nulls rather than dropping the version", () => {
    const resource = policyVersionResource(
      stored(1, V6_DOCUMENT, { publishedBy: null, publisherName: null }),
      null,
    );

    expect(resource).toMatchObject({ version: 1, publishedBy: null, publisherName: null });
  });
});
