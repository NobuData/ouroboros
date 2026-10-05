import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { OrgPolicyRepository } from "./org-policy.repository";

/**
 * BQ.2's statements (#481): the version in force (typed and verbatim), the per-repository loop
 * count, and the publish — handle created and locked, decided under the lock, then V092's
 * `org_policy_publish`. The integration suites run them against a migrated PostgreSQL.
 */

const ORG = "org-481";
const AT = new Date("2026-10-04T13:48:00.000Z");

/** @returns The statements, without the transaction's own. */
function queries(database: RecordingDatabase): string[] {
  return database.statements
    .map((statement) => statement.sql)
    .filter((sql) => !["begin", "commit", "rollback"].includes(sql));
}

describe("the org policy repository — the document (#481)", () => {
  let database: RecordingDatabase;
  let policies: OrgPolicyRepository;

  beforeEach(() => {
    database = recordingDatabase();
    policies = new OrgPolicyRepository(database.service);
  });

  it("reads the version the handle points at, its rules typed", async () => {
    database.answers({
      rows: [
        {
          version: 7,
          published_at: AT,
          document: { auto_merge: { enabled: true, conditions: {} }, junk: 1 },
        },
      ],
    });

    expect(await policies.current(ORG)).toEqual({
      version: 7,
      publishedAt: AT,
      rules: { auto_merge: { enabled: true, conditions: {} } },
    });
    expect(database.statements[0].sql).toContain("v.version = p.current_version");
    expect(database.statements[0].parameters).toEqual([ORG]);
  });

  it("reads nothing when nothing is published", async () => {
    expect(await policies.current(ORG)).toBeNull();
    expect(await policies.version(ORG)).toBeNull();
  });

  it("reads the version in force verbatim, with its attribution", async () => {
    const document = {
      auto_merge: { enabled: true, conditions: {} },
      "custom:x": { enabled: false, conditions: {} },
    };

    database.answers({
      rows: [
        { version: 7, document, published_at: AT, published_by: "user-ken", change_note: "Why." },
      ],
    });

    expect(await policies.version(ORG)).toEqual({
      version: 7,
      document,
      publishedAt: AT,
      publishedBy: "user-ken",
      changeNote: "Why.",
    });
  });

  it("counts the runs of the workspace that opened a PR on a repository, recorded or mirrored", async () => {
    database.answers({ rows: [{ loops: 9 }] });

    expect(await policies.loopsOpened(ORG, "repo-helios")).toBe(9);
    expect(database.statements[0].sql).toContain("r.pr_number is not null");
    expect(database.statements[0].sql).toContain("p.run_id = r.id");
    expect(database.statements[0].parameters).toEqual([ORG, "repo-helios"]);
  });

  it("publishes under the handle's lock, deciding against the version in force first", async () => {
    const decided: unknown[] = [];

    database.answers(
      { rows: [] },
      { rows: [{ organization_id: ORG }] },
      {
        rows: [
          { version: 7, document: {}, published_at: AT, published_by: null, change_note: null },
        ],
      },
      { rows: [{ version: 8 }] },
      { rows: [{ version: 8, published_at: AT }] },
    );

    expect(
      await policies.publish(ORG, { a: 1 }, "user-ken", "Why.", (current) =>
        decided.push(current?.version),
      ),
    ).toEqual({ version: 8, publishedAt: AT });

    const [create, lock, read, publish, written] = queries(database);

    expect(create).toContain("on conflict");
    expect(lock).toContain("for update");
    expect(read).toContain("v.version = p.current_version");
    expect(publish).toContain("ouroboros.org_policy_publish(");
    expect(written).toContain("org_policy_versions");
    expect(decided).toEqual([7]);
  });

  it("writes nothing when the decision refuses", async () => {
    database.answers({ rows: [] }, { rows: [{ organization_id: ORG }] });

    await expect(
      policies.publish(ORG, {}, "user-ken", null, () => {
        throw new Error("refused");
      }),
    ).rejects.toThrow("refused");
    expect(queries(database).some((sql) => sql.includes("org_policy_publish"))).toBe(false);
  });

  it("refuses to answer a publish that wrote no version", async () => {
    database.answers(
      { rows: [] },
      { rows: [{ organization_id: ORG }] },
      { rows: [] },
      { rows: [] },
    );

    await expect(policies.publish(ORG, {}, "user-ken", null, () => undefined)).rejects.toThrow(
      /wrote no version/,
    );

    database.answers(
      { rows: [] },
      { rows: [{ organization_id: ORG }] },
      { rows: [] },
      { rows: [{ version: 8 }] },
      { rows: [] },
    );

    await expect(policies.publish(ORG, {}, "user-ken", null, () => undefined)).rejects.toThrow(
      /wrote no version/,
    );
  });
});
