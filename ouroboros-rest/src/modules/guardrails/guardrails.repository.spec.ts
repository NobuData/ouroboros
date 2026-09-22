import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { GuardrailsRepository, type RunPolicyRow } from "./guardrails.repository";

/**
 * The statements — and the two properties they exist to keep: every read after the run is
 * scoped to the run's own workspace, and verdicts are appended, never updated.
 */

const RUN = "5eed0009-0000-4000-8000-000000000482";
const ORG = "org-acme";
const POLICY: RunPolicyRow = {
  organizationId: ORG,
  githubRepoId: "5eed0003-0000-4000-8000-000000000001",
  issueNumber: 482,
  workflowTag: "standard-fix",
  workflowVersionPin: 14,
};

describe("the guardrails repository", () => {
  let database: RecordingDatabase;
  let repository: GuardrailsRepository;

  beforeEach(() => {
    database = recordingDatabase();
    repository = new GuardrailsRepository();
  });

  it("reads the run's policy columns and maps them", async () => {
    database.answers({
      rows: [
        {
          organization_id: ORG,
          github_repo_id: POLICY.githubRepoId,
          issue_number: 482,
          workflow_tag: "standard-fix",
          workflow_version_pin: 14,
        },
      ],
    });

    expect(await repository.runPolicy(database.service.db, RUN)).toEqual(POLICY);
    expect(database.statements[0].sql).toContain('from "ouroboros"."runs"');
    expect(database.statements[0].parameters).toEqual([RUN]);
  });

  it("answers undefined for a run that does not exist", async () => {
    expect(await repository.runPolicy(database.service.db, RUN)).toBeUndefined();
  });

  it("reads the pinned definition inside the run's workspace only", async () => {
    await repository.pinnedDefinition(database.service.db, ORG, "standard-fix", 14);

    expect(database.statements[0].sql).toContain('"workflows"."organization_id" = $1');
    expect(database.statements[0].parameters).toEqual([ORG, "standard-fix", 14]);
  });

  it("lists reported stages newest first, once each", async () => {
    database.answers({
      rows: [{ stage_key: "implement" }, { stage_key: "checks-green" }, { stage_key: "implement" }],
    });

    expect(await repository.reportedStages(database.service.db, RUN)).toEqual([
      "implement",
      "checks-green",
    ]);
    expect(database.statements[0].sql).toContain('order by "updated_at" desc, "attempt" desc');
  });

  it("reads the ticket through the workspace's own mirror, then its latest estimate", async () => {
    database.answers(
      { rows: [{ id: "issue-1", labels: ["security"] }] },
      { rows: [{ breakdown: { files: ["drivers/can/a.c"] }, effort: "m" }] },
    );

    expect(await repository.ticketFacts(database.service.db, POLICY)).toEqual({
      labels: ["security"],
      planFiles: ["drivers/can/a.c"],
      effort: "m",
    });
    expect(database.statements[0].sql).toContain('"organization_id" = $1');
    expect(database.statements[0].parameters).toEqual([ORG, POLICY.githubRepoId, 482]);
    expect(database.statements[1].sql).toContain('order by "version" desc');
  });

  it("has no labels and no plan for an issue that is not mirrored", async () => {
    expect(await repository.ticketFacts(database.service.db, POLICY)).toEqual({ labels: [] });
    expect(database.statements).toHaveLength(1);
  });

  it("has labels and no plan for an issue that was never estimated", async () => {
    database.answers({ rows: [{ id: "issue-1", labels: [] }] });

    expect(await repository.ticketFacts(database.service.db, POLICY)).toEqual({ labels: [] });
  });

  it("reads only the workspace's enabled rules, in order", async () => {
    await repository.enabledRules(database.service.db, ORG);

    expect(database.statements[0].sql).toContain('"enabled" = $2');
    expect(database.statements[0].sql).toContain('order by "sort_order"');
    expect(database.statements[0].parameters).toEqual([ORG, true]);
  });

  it("appends verdicts in one insert and never updates", async () => {
    await repository.appendVerdicts(database.service.db, RUN, 14, [
      {
        check: "secrets",
        verdict: "fail",
        evidence: { path: "a.c", line: 3, rule_id: "github-pat" },
        rulesetVersion: "v3",
        changeSetSeq: 2,
      },
      {
        check: "review_required",
        verdict: "not_applicable",
        evidence: null,
        rulesetVersion: null,
        changeSetSeq: null,
      },
    ]);

    expect(database.statements).toHaveLength(1);
    expect(database.statements[0].sql).toContain('insert into "ouroboros"."guardrail_evaluations"');
    expect(database.sql().join(" ")).not.toMatch(/update|delete/i);
    expect(database.statements[0].parameters).toEqual(
      expect.arrayContaining([
        RUN,
        "secrets",
        "fail",
        "v3",
        14,
        2,
        "review_required",
        "not_applicable",
      ]),
    );
  });
});
