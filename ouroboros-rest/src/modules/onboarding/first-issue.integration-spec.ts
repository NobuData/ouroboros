/**
 * The safe-first-issue picker against a real database
 * ([#387](https://github.com/NobuData/ouroboros/issues/387), BB.4).
 *
 * The acceptance criteria that are claims about real rows and a real request:
 *
 *   * **Against the seeded backlog the picker selects `#488`** with the mockup's line — over
 *     `intake.fixture.ts`, the dev seed's nine issues and estimates reproduced row for row — and
 *     with **no cost**, because its routed model resolves to no rate.
 *   * **A protected path disqualifies** — a `protected_path_policies` row takes `#491` out of the
 *     ranking rather than down it.
 *   * **Cold states** — an unsized backlog answers the nightly job's real last run, an empty one
 *     the planning pointer — and another workspace's backlog is never read.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

import { ApiHarness, type Person } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import {
  PRIMARY_REPO,
  workspaceWithRepo,
  type SeededWorkspace,
} from "../../testing/dashboard.fixture";
import { seedIntake } from "../../testing/intake.fixture";
import { SCHEMA_NAME } from "../db/schema";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import type { FirstIssueAlternativesResource, FirstIssueResource } from "./first-issue.resources";

describe("the safe-first-issue picker, against a migrated database", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    // A day, so the application's own sync loop cannot poll in the middle of a test.
    api = await ApiHarness.start({ OURO_BACKLOG_SYNC_INTERVAL_SECONDS: "86400" });
  });

  afterAll(() => api.close());

  afterEach(async () => {
    await api.truncate();
  });

  /** A workspace with a mirrored repository, and its owner. */
  async function bench(): Promise<{ workspace: SeededWorkspace; owner: Person; repo: string }> {
    const owner = await api.signIn();
    const workspace = await workspaceWithRepo(api, owner);

    return { workspace, owner, repo: `${workspace.slug}/${PRIMARY_REPO}` };
  }

  /** `GET` a picker route as somebody, in their workspace. */
  function get(owner: Person, workspace: SeededWorkspace, path: string) {
    return api.as(owner)("get", path).set(TENANT_HEADER, workspace.slug);
  }

  /** The card. */
  async function card(owner: Person, workspace: SeededWorkspace, repo: string) {
    const response = await get(
      owner,
      workspace,
      `/api/v1/onboarding/first-issue?repo=${encodeURIComponent(repo)}`,
    ).expect(200);

    return bodyOf<FirstIssueResource>(response);
  }

  it("picks #488 from the seeded backlog with the mockup's line and no cost", async () => {
    const { workspace, owner, repo } = await bench();
    await seedIntake(api, workspace);

    const answer = await card(owner, workspace, repo);

    expect(answer).toMatchObject({
      state: "picked",
      weightsVersion: "safety-v1",
      backlog: { open: 9, sized: 7, sizing: 1, needsHuman: 1 },
      planning: null,
      excluded: { protectedPath: 0, tooLarge: 2, belowBar: 3 },
    });
    expect(answer.pick).toMatchObject({
      number: 488,
      effort: "xs",
      suggestedWorkflow: "docs-loop",
      estimate: { loopMinutes: 4 },
      reasoning: { line: "no code paths touched · est. 4 min" },
    });
    expect(answer.pick).not.toHaveProperty("cost");
    expect(answer.estimator?.lastRun).toBeNull();
  });

  it("ranks the alternatives, each with its own reasoning", async () => {
    const { workspace, owner, repo } = await bench();
    await seedIntake(api, workspace);

    const response = await get(
      owner,
      workspace,
      `/api/v1/onboarding/first-issue/alternatives?repo=${encodeURIComponent(repo)}&limit=3`,
    ).expect(200);
    const alternatives = bodyOf<FirstIssueAlternativesResource>(response);

    expect(alternatives.candidates.map((c) => c.number)).toEqual([488, 491, 485]);
    expect(alternatives.candidates.map((c) => c.reasoning.line)).toEqual([
      "no code paths touched · est. 4 min",
      "2 code paths touched · est. 11 min",
      "3 code paths touched · est. 15 min",
    ]);
  });

  it("disqualifies an issue touching a protected path rather than down-ranking it", async () => {
    const { workspace, owner, repo } = await bench();
    await seedIntake(api, workspace);
    await api.sql.query(
      `insert into ${SCHEMA_NAME}.protected_path_policies (organization_id, repo_ref, path_glob, source)
       values ($1, $2, 'src/config/**', 'edited')`,
      [workspace.id, repo.toLowerCase()],
    );

    const response = await get(
      owner,
      workspace,
      `/api/v1/onboarding/first-issue/alternatives?repo=${encodeURIComponent(repo)}`,
    ).expect(200);
    const alternatives = bodyOf<FirstIssueAlternativesResource>(response);

    expect(alternatives.candidates.map((c) => c.number)).not.toContain(491);
    expect(alternatives.excluded.protectedPath).toBe(1);
  });

  it("answers an unsized backlog with the nightly job's real last run", async () => {
    const { workspace, owner, repo } = await bench();
    await api.sql.query(
      `insert into ${SCHEMA_NAME}.github_issues
              (organization_id, github_repo_id, number, title, state, labels, gh_created_at,
               gh_updated_at, gh_url, sizing_status)
       values ($1, $2, 1, 'Fresh import', 'open', '[]'::jsonb, now(), now(),
               'https://github.com/acme/x/issues/1', 'unsized')`,
      [workspace.id, workspace.repoId],
    );
    await api.sql.query(
      `insert into ${SCHEMA_NAME}.reestimation_runs (night, batch_limit, status, started_at)
       values (current_date, 200, 'running', now() - interval '5 minutes')`,
    );

    const answer = await card(owner, workspace, repo);

    expect(answer).toMatchObject({ state: "sizing", pick: null, planning: null });
    expect(answer.estimator?.lastRun).toMatchObject({ status: "running", finishedAt: null });
  });

  it("points an empty backlog at planning", async () => {
    const { workspace, owner, repo } = await bench();

    const answer = await card(owner, workspace, repo);

    expect(answer).toMatchObject({
      state: "empty",
      pick: null,
      estimator: null,
      planning: { path: "/planning" },
    });
  });

  it("never reads another workspace's backlog", async () => {
    const other = await bench();
    await seedIntake(api, other.workspace);
    const owner = await api.signIn({ email: "second@example.com" });
    const workspace = await workspaceWithRepo(api, owner);

    // The same repository reference, asked from a workspace that mirrors nothing under it.
    const answer = await card(owner, workspace, other.repo);

    expect(answer.state).toBe("empty");
    expect(answer.backlog.open).toBe(0);
  });

  it("refuses a limit outside 1–50 with 422", async () => {
    const { workspace, owner, repo } = await bench();

    const response = await get(
      owner,
      workspace,
      `/api/v1/onboarding/first-issue/alternatives?repo=${encodeURIComponent(repo)}&limit=0`,
    ).expect(422);

    expect(bodyOf<ErrorEnvelope>(response).code).toBe("validation_failed");
  });
});
