import type { OrgPolicies, OrgPoliciesEffective } from "../db/schema";
import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { OrgPolicyRepository } from "./org-policy.repository";

/**
 * V075's statements: the read is the view, the onboarding default never overwrites an answer,
 * and the flip reads the value it replaces under the row's lock.
 */

const ORG = "org-dry";
const ACTOR = "user-owner";
const AT = new Date("2026-09-30T12:00:00.000Z");

const EFFECTIVE = {
  organization_id: ORG,
  dry_run: true,
  is_explicit: false,
  updated_at: null,
  updated_by: null,
} satisfies OrgPoliciesEffective;

const ROW = {
  organization_id: ORG,
  dry_run: false,
  updated_by: ACTOR,
  created_at: AT,
  updated_at: AT,
  current_version: null,
} satisfies OrgPolicies;

/** @returns The statements, without the transaction's own. */
function queries(database: RecordingDatabase): string[] {
  return database.statements
    .map((statement) => statement.sql)
    .filter((sql) => !["begin", "commit", "rollback"].includes(sql));
}

describe("the org policy repository", () => {
  let database: RecordingDatabase;
  let policies: OrgPolicyRepository;

  beforeEach(() => {
    database = recordingDatabase();
    policies = new OrgPolicyRepository(database.service);
  });

  it("reads the effective view, scoped to the workspace", async () => {
    database.answers({ rows: [EFFECTIVE] });

    expect(await policies.effective(ORG)).toEqual(EFFECTIVE);
    expect(database.statements[0].sql).toContain('from "ouroboros"."org_policies_effective"');
    expect(database.statements[0].parameters).toEqual([ORG]);
  });

  it("writes the onboarding default only where there is no answer", async () => {
    database.answers({ rows: [{ organization_id: ORG }] });

    await expect(policies.adoptDefault(ORG)).resolves.toBe(true);
    expect(database.statements[0].sql).toContain('insert into "ouroboros"."org_policies"');
    // V092: an existing row is answered only while its dry_run is null — a handle a policy
    // publish created — so an explicit false is never overwritten.
    expect(database.statements[0].sql).toContain(
      'on conflict ("organization_id") do update set "dry_run" = $3 where "ouroboros"."org_policies"."dry_run" is null',
    );
    expect(database.statements[0].parameters).toEqual([ORG, true, true]);
  });

  it("reports an explicit answer left alone", async () => {
    database.answers({ rows: [] });

    await expect(policies.adoptDefault(ORG)).resolves.toBe(false);
  });

  it("flips under the row's lock, reading the prior value — a workspace never asked", async () => {
    // The row this flip created carries the column default; the value it replaced is the view's
    // answer for a workspace that never answered — off.
    database.answers(
      { rows: [{ organization_id: ORG }] },
      { rows: [{ dry_run: true }] },
      { rows: [ROW] },
    );

    await expect(policies.setDryRun(ORG, false, ACTOR)).resolves.toEqual({
      row: ROW,
      previous: false,
      previousExplicit: false,
    });

    const [ensure, lock, update] = queries(database);

    expect(ensure).toContain('on conflict ("organization_id") do nothing');
    expect(lock).toContain("for update");
    expect(update).toContain('update "ouroboros"."org_policies" set "dry_run" = $1');
    expect(update).not.toContain("updated_at");
  });

  it("reads a handle a policy publish created (dry_run null) as never answered", async () => {
    database.answers(
      { rows: [] },
      { rows: [{ dry_run: null }] },
      { rows: [{ ...ROW, dry_run: true, current_version: 7 }] },
    );

    await expect(policies.setDryRun(ORG, true, ACTOR)).resolves.toMatchObject({
      previous: false,
      previousExplicit: false,
    });
  });

  it("names an explicit prior value as explicit", async () => {
    database.answers(
      { rows: [] },
      { rows: [{ dry_run: false }] },
      { rows: [{ ...ROW, dry_run: true }] },
    );

    await expect(policies.setDryRun(ORG, true, ACTOR)).resolves.toMatchObject({
      previous: false,
      previousExplicit: true,
    });
  });
});
