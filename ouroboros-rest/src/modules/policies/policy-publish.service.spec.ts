import type { AuditRecord } from "../audit/audit.events";
import type { OrganizationRole } from "../db/schema";
import type { PolicyPublishStore, StoredPolicyVersion } from "./org-policy.repository";
import {
  POLICY_PUBLISH_ERRORS,
  PolicyPublishService,
  policyResource,
} from "./policy-publish.service";
import type { PolicyResolutionService } from "./policy-resolution.service";

/**
 * The publish flow (BQ.2, #481): validated against the committed grammar, decided under the lock
 * against the version in force, classified per rule — a loosening is the owner's alone — then
 * published as vN+1 with an audit row naming the version and the changed rules.
 */

/** Mockup 17's policy v7, as stored. */
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

/**
 * V7 with one rule replaced.
 *
 * @param ruleId - The rule.
 * @param rule - Its replacement.
 * @returns The document.
 */
function edit(ruleId: string, rule: unknown): Record<string, unknown> {
  return { ...V7_DOCUMENT, [ruleId]: rule };
}

/** Auto-merge switched off — tightening. */
const AUTO_MERGE_OFF = edit("auto_merge", { ...V7_DOCUMENT.auto_merge, enabled: false });

/** Human review switched off — loosening. */
const HUMAN_REVIEW_OFF = edit("human_review", { ...V7_DOCUMENT.human_review, enabled: false });

/** An in-memory store: the version in force, and every publish. */
class MemoryStore implements PolicyPublishStore {
  current: StoredPolicyVersion | null;
  published: { document: Record<string, unknown>; by: string; note: string | null }[] = [];

  constructor(current: StoredPolicyVersion | null) {
    this.current = current;
  }

  version(): Promise<StoredPolicyVersion | null> {
    return Promise.resolve(this.current);
  }

  async publish(
    _organizationId: string,
    document: Record<string, unknown>,
    publishedBy: string,
    changeNote: string | null,
    decide: (current: StoredPolicyVersion | null) => void,
  ): Promise<{ version: number; publishedAt: Date }> {
    decide(this.current);

    const version = (this.current?.version ?? 0) + 1;
    const publishedAt = new Date("2026-10-04T13:48:00Z");

    this.published.push({ document, by: publishedBy, note: changeNote });
    this.current = { version, document, publishedAt, publishedBy, changeNote };

    return Promise.resolve({ version, publishedAt });
  }
}

/** Version 7 in force. */
function v7(): StoredPolicyVersion {
  return {
    version: 7,
    document: V7_DOCUMENT,
    publishedAt: new Date("2026-10-01T09:00:00Z"),
    publishedBy: "user-ken",
    changeNote: null,
  };
}

/**
 * The service over a store.
 *
 * @param current - The version in force.
 * @returns The service and its collaborators.
 */
function harness(current: StoredPolicyVersion | null = v7()) {
  const store = new MemoryStore(current);
  const resolver = { invalidate: jest.fn() };
  const audit = { records: [] as AuditRecord[], record: jest.fn() };

  audit.record.mockImplementation((record: AuditRecord) => {
    audit.records.push(record);
    return Promise.resolve("audit-1");
  });

  const service = new PolicyPublishService(
    store,
    resolver as unknown as PolicyResolutionService,
    audit,
  );

  return { store, resolver, audit, service };
}

const OWNER = { id: "user-ken", roles: ["owner"] as OrganizationRole[] };
const ADMIN = { id: "user-maya", roles: ["admin"] as OrganizationRole[] };

describe("reading the policy", () => {
  it("answers the version in force verbatim", async () => {
    expect(await harness().service.read("org")).toEqual({
      version: 7,
      document: V7_DOCUMENT,
      publishedAt: "2026-10-01T09:00:00.000Z",
      publishedBy: "user-ken",
      changeNote: null,
    });
  });

  it("answers no version for a workspace that has published nothing", async () => {
    expect(await harness(null).service.read("org")).toEqual(policyResource(null));
    expect(policyResource(null).version).toBeNull();
  });
});

describe("the role matrix", () => {
  it.each([
    ["owner", OWNER, AUTO_MERGE_OFF, true],
    ["admin", ADMIN, AUTO_MERGE_OFF, true],
    ["owner", OWNER, HUMAN_REVIEW_OFF, true],
    ["admin", ADMIN, HUMAN_REVIEW_OFF, false],
  ] as const)("%s publishing %#: accepted = %s", async (_role, actor, document, accepted) => {
    const { service, store } = harness();
    const publish = service.publish("org", actor, { document, baseVersion: 7 });

    if (accepted) {
      await expect(publish).resolves.toMatchObject({ version: 8 });
      expect(store.current?.version).toBe(8);
    } else {
      await expect(publish).rejects.toMatchObject({
        response: {
          code: POLICY_PUBLISH_ERRORS.ownerRequired,
          details: { loosening: ["human_review"] },
        },
      });
      expect(store.published).toHaveLength(0);
    }
  });

  it("accepts a neutral change from an admin", async () => {
    const { service } = harness();
    const reordered = edit("protected_paths", {
      enabled: true,
      conditions: { path_globs: [".github/**", "boot/**", "keys/**"] },
    });

    await expect(
      service.publish("org", ADMIN, { document: reordered, baseVersion: 7 }),
    ).resolves.toMatchObject({
      classification: "neutral",
    });
  });
});

describe("publishing", () => {
  it("publishes vN+1, clears the resolver's cache, and audits the version, the rules and the line", async () => {
    const { service, store, resolver, audit } = harness();

    const published = await service.publish("org", OWNER, {
      document: edit("auto_merge", { ...V7_DOCUMENT.auto_merge, enabled: false }),
      baseVersion: 7,
      changeNote: "  Pausing unattended merges for the release.  ",
    });

    expect(published).toMatchObject({
      version: 8,
      publishedBy: "user-ken",
      changeNote: "Pausing unattended merges for the release.",
      classification: "tightening",
      changes: [
        { ruleId: "auto_merge", classification: "tightening", summary: "disabled auto-merge" },
      ],
      summary: "disabled auto-merge (policy v8)",
    });
    expect(store.published[0].note).toBe("Pausing unattended merges for the release.");
    expect(resolver.invalidate).toHaveBeenCalledWith("org");
    expect(audit.records).toEqual([
      {
        organizationId: "org",
        actorId: "user-ken",
        action: "policy.published",
        subjectType: "org_policy",
        subjectId: "org",
        at: new Date("2026-10-04T13:48:00Z"),
        detail: {
          version: 8,
          previous_version: 7,
          classification: "tightening",
          changed_rules: "auto_merge",
          loosening_rules: "",
          tightening_rules: "auto_merge",
          summary: "disabled auto-merge (policy v8)",
          change_note: "Pausing unattended merges for the release.",
        },
      },
    ]);
  });

  it("audits the mockup's line for enabling auto-merge — the owner's to publish", async () => {
    const { service, audit } = harness({ ...v7(), document: AUTO_MERGE_OFF });

    await service.publish("org", OWNER, { document: V7_DOCUMENT, baseVersion: 7 });

    expect(audit.records[0].detail).toMatchObject({
      summary: "enabled auto-merge (policy v8)",
      classification: "loosening",
      loosening_rules: "auto_merge",
    });
  });

  it("publishes a workspace's first version against no policy", async () => {
    const { service } = harness(null);

    await expect(
      service.publish("org", ADMIN, { document: V7_DOCUMENT, baseVersion: null }),
    ).resolves.toMatchObject({
      version: 1,
      classification: "tightening",
    });
  });

  it("treats a blank change note as none", async () => {
    const { service, store } = harness();

    await service.publish("org", OWNER, {
      document: AUTO_MERGE_OFF,
      baseVersion: 7,
      changeNote: "   ",
    });

    expect(store.published[0].note).toBeNull();
  });

  it("refuses a publish when another landed since the edit began — and writes nothing", async () => {
    const { service, store, audit, resolver } = harness();

    await expect(
      service.publish("org", OWNER, { document: AUTO_MERGE_OFF, baseVersion: 6 }),
    ).rejects.toMatchObject({
      response: {
        code: POLICY_PUBLISH_ERRORS.conflict,
        details: { baseVersion: 6, currentVersion: 7 },
      },
    });
    await expect(
      service.publish("org", OWNER, { document: AUTO_MERGE_OFF, baseVersion: null }),
    ).rejects.toMatchObject({
      response: { code: POLICY_PUBLISH_ERRORS.conflict },
    });
    await expect(
      harness(null).service.publish("org", OWNER, { document: AUTO_MERGE_OFF, baseVersion: 3 }),
    ).rejects.toMatchObject({
      response: { code: POLICY_PUBLISH_ERRORS.conflict, details: { currentVersion: null } },
    });
    expect(store.published).toHaveLength(0);
    expect(audit.record).not.toHaveBeenCalled();
    expect(resolver.invalidate).not.toHaveBeenCalled();
  });

  it("refuses a document that changes nothing", async () => {
    const { service, store } = harness();

    await expect(
      service.publish("org", OWNER, { document: V7_DOCUMENT, baseVersion: 7 }),
    ).rejects.toMatchObject({
      response: { code: POLICY_PUBLISH_ERRORS.unchanged },
    });
    expect(store.published).toHaveLength(0);
  });

  it("refuses a document the grammar refuses, listing where and why", async () => {
    const { service, store } = harness();
    const floatCents = edit("spend_guard", {
      enabled: true,
      conditions: { per_run_cap_cents: 2.5 },
    });

    await expect(
      service.publish("org", OWNER, { document: floatCents, baseVersion: 7 }),
    ).rejects.toMatchObject({
      response: {
        code: POLICY_PUBLISH_ERRORS.invalid,
        details: {
          errors: expect.arrayContaining([
            expect.objectContaining({ path: "/spend_guard/conditions/per_run_cap_cents" }),
          ]) as unknown,
        },
      },
    });
    await expect(
      service.publish("org", OWNER, { document: "v8", baseVersion: 7 }),
    ).rejects.toMatchObject({
      response: {
        code: POLICY_PUBLISH_ERRORS.invalid,
        details: { errors: [expect.objectContaining({ path: "/" })] },
      },
    });
    expect(store.published).toHaveLength(0);
  });
});

describe("previewing", () => {
  it("classifies each change against the version in force, and says whether this caller may publish", async () => {
    const { service, store } = harness();

    expect(await service.preview("org", ADMIN, HUMAN_REVIEW_OFF)).toEqual({
      baseVersion: 7,
      classification: "loosening",
      changes: [
        { ruleId: "human_review", classification: "loosening", summary: "disabled human review" },
      ],
      requiresOwner: true,
      mayPublish: false,
    });
    expect((await service.preview("org", OWNER, HUMAN_REVIEW_OFF)).mayPublish).toBe(true);
    expect(await service.preview("org", ADMIN, AUTO_MERGE_OFF)).toMatchObject({
      requiresOwner: false,
      mayPublish: true,
    });
    expect(store.published).toHaveLength(0);
  });

  it("refuses to classify a document the grammar refuses", async () => {
    await expect(
      harness().service.preview("org", OWNER, { auto_merge: true }),
    ).rejects.toMatchObject({
      response: { code: POLICY_PUBLISH_ERRORS.invalid },
    });
  });
});
