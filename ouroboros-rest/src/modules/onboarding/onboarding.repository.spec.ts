/**
 * The onboarding statements, compiled ([#385](https://github.com/NobuData/ouroboros/issues/385)).
 * Every one is scoped by the workspace, and the writes touch only the wizard's choice columns.
 */

import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { OnboardingRepository } from "./onboarding.repository";

const ORG = "org-1";
const REPO = "acme-robotics/helios-firmware";

describe("the onboarding repository", () => {
  let database: RecordingDatabase;
  let repository: OnboardingRepository;

  beforeEach(() => {
    database = recordingDatabase();
    repository = new OnboardingRepository(database.service);
  });

  it("reads one repository's wizard, scoped by workspace", async () => {
    await repository.state(ORG, REPO);

    expect(database.statements[0].sql).toContain('from "ouroboros"."onboarding_state"');
    expect(database.statements[0].parameters).toEqual([ORG, REPO]);
  });

  it("upserts choices on the (workspace, repository) key, setting only what was sent", async () => {
    database.answers({ rows: [{ id: "x" }] });

    await repository.saveChoices(ORG, REPO, { selected_template: "quick-fixes" });

    const [statement] = database.statements;

    expect(statement.sql).toContain('insert into "ouroboros"."onboarding_state"');
    expect(statement.sql).toContain('on conflict ("organization_id", "repo_ref") do update set');
    expect(statement.sql).toContain('"selected_template" = $4');
    expect(statement.sql).not.toContain("dismissed");
    expect(statement.parameters).toEqual([ORG, REPO, "quick-fixes", "quick-fixes"]);
  });

  it("keeps the first completion time", async () => {
    database.answers({ rows: [{ id: "x" }] });

    await repository.markCompleted(ORG, REPO);

    expect(database.statements[0].sql).toContain(
      '"completed_at" = coalesce(onboarding_state.completed_at, now())',
    );
  });

  it("keeps the first bypass time", async () => {
    database.answers({ rows: [{ id: "x" }] });

    await repository.markBypassed(ORG, REPO);

    expect(database.statements[0].sql).toContain(
      '"bypassed_at" = coalesce(onboarding_state.bypassed_at, now())',
    );
  });

  it("counts a completed, dismissed or bypassed wizard as finished", async () => {
    database.answers({ rows: [{ id: "x" }] });

    await expect(repository.anyWizardFinished(ORG)).resolves.toBe(true);
    expect(database.statements[0].sql).toContain(
      '("completed_at" is not null or "dismissed" = $2 or "bypassed_at" is not null)',
    );
    await expect(repository.anyWizardFinished(ORG)).resolves.toBe(false);
  });

  it("reads GitHub sources through the credential-free view", async () => {
    await repository.githubSources(ORG);

    expect(database.statements[0].sql).toContain('from "ouroboros"."ticket_sources_public"');
    expect(database.statements[0].parameters).toEqual([ORG, "github"]);
  });

  it("reads the App installation off the account", async () => {
    database.answers({ rows: [{ installed_at: new Date() }] });

    await expect(repository.appInstalled(ORG, "acme-robotics")).resolves.toBe(true);
    await expect(repository.appInstalled(ORG, "acme-robotics")).resolves.toBe(false);
    database.answers({ rows: [{ installed_at: null }] });
    await expect(repository.appInstalled(ORG, "acme-robotics")).resolves.toBe(false);
  });

  it("resolves owner/name through the account, inside the workspace", async () => {
    await repository.repository(ORG, "acme-robotics", "helios-firmware");

    const [statement] = database.statements;

    expect(statement.sql).toContain('inner join "ouroboros"."github_orgs"');
    expect(statement.sql).toContain('"github_orgs"."enabled" as "account_enabled"');
    expect(statement.parameters).toEqual([ORG, "acme-robotics", "helios-firmware"]);
  });

  it("finds the newest workflow instantiated from a template", async () => {
    database.answers({
      rows: [{ slug: "quick-fixes", template_slug: "quick-fixes", template_version: 1 }],
    });

    await expect(repository.instantiatedWorkflow(ORG, "quick-fixes")).resolves.toEqual({
      slug: "quick-fixes",
      template_slug: "quick-fixes",
      template_version: 1,
    });
    expect(database.statements[0].sql).toContain('order by "created_at" desc');
    await expect(repository.instantiatedWorkflow(ORG, "quick-fixes")).resolves.toBeUndefined();
  });

  it("reads a ticket only inside the workspace", async () => {
    await repository.ticket(ORG, "7c1e2d3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f");

    expect(database.statements[0].sql).toContain('"tickets"."organization_id" = $1');
    expect(database.statements[0].parameters).toEqual([
      ORG,
      "7c1e2d3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f",
    ]);
  });

  it("finds a mirrored issue only inside the workspace and the repository (#388)", async () => {
    database.answers({ rows: [{ number: 488 }] });

    await expect(repository.mirroredIssue(ORG, "repo-1", "issue-488")).resolves.toEqual({
      number: 488,
    });

    const [statement] = database.statements;

    expect(statement.sql).toContain('from "ouroboros"."github_issues"');
    expect(statement.sql).toContain('"organization_id" = $1');
    expect(statement.sql).toContain('"github_repo_id" = $2');
    expect(statement.sql).toContain('"id" = $3');
    expect(statement.parameters).toEqual([ORG, "repo-1", "issue-488"]);
  });

  it("finds an issue's canonical ticket by GitHub kind, number and repository (#388)", async () => {
    await repository.ticketOfIssue(ORG, "acme-robotics", "helios-firmware", 488);

    const [statement] = database.statements;

    expect(statement.sql).toContain('inner join "ouroboros"."ticket_sources"');
    expect(statement.sql).toContain('"tickets"."organization_id" = $1');
    expect(statement.sql).toContain('"ticket_sources"."kind" = $2');
    expect(statement.sql).toContain('"tickets"."external_id" = $3');
    expect(statement.sql).toContain(`lower("ouroboros"."tickets"."meta"->'github'->>'owner') = $4`);
    expect(statement.sql).toContain(`lower("ouroboros"."tickets"."meta"->'github'->>'repo') = $5`);
    // One stable answer when two sources both read the issue: the oldest ticket.
    expect(statement.sql).toContain(
      'order by "ouroboros"."tickets"."created_at", "ouroboros"."tickets"."id"',
    );
    expect(statement.parameters).toEqual([
      ORG,
      "github",
      "488",
      "acme-robotics",
      "helios-firmware",
      1,
    ]);
  });

  it("asks the queue and the runs whether an issue reached the loop", async () => {
    database.answers({ rows: [{ id: "q" }] }, { rows: [] });

    await expect(repository.reachedLoop(ORG, "repo-1", 488)).resolves.toEqual({
      queued: true,
      run: false,
    });
    expect(database.statements[0].sql).toContain('from "ouroboros"."queue_items"');
    expect(database.statements[1].sql).toContain('from "ouroboros"."runs"');
    expect(database.statements[1].parameters).toEqual([ORG, "repo-1", 488, 1]);
  });

  it("asks whether the workspace has ever had a run", async () => {
    database.answers({ rows: [{ id: "r" }] });

    await expect(repository.hasRuns(ORG)).resolves.toBe(true);
    await expect(repository.hasRuns(ORG)).resolves.toBe(false);
  });

  it("reads the newest detection scan", async () => {
    await repository.latestScan(ORG, REPO);

    expect(database.statements[0].sql).toContain('order by "scan_seq" desc');
  });

  it("reads the offered templates through V068's resolver", async () => {
    database.answers({
      rows: [{ slug: "quick-fixes", version: 1, tier: "starter", organization_id: null }],
    });

    await expect(repository.templates(ORG)).resolves.toHaveLength(1);
    expect(database.statements[0].sql).toContain("ouroboros.workflow_templates_for($1)");
    expect(database.statements[0].parameters).toEqual([ORG]);
  });
});
