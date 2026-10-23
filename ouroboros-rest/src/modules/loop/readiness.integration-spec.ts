/**
 * `GET /api/v1/loop/readiness` against a migrated database (DK.1,
 * [#1318](https://github.com/NobuData/ouroboros/issues/1318)) — the two acceptance criteria that
 * only a real database can show:
 *
 *   * **It invokes no model and dispatches no job.** The workspace's connection points at a
 *     {@link ProviderStub}, which records every request it is sent; the farm's and the queue's
 *     tables are counted before and after.
 *   * **Organisation isolation holds.** Two workspaces mirror the same GitHub login and the same
 *     repository name; neither's connection, nor its repository, reaches the other's answer.
 */

import { ApiHarness, type Person } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { ProviderStub } from "../provider-health/provider.stub.fixture";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import { READINESS_CHECK_IDS, type LoopReadinessResource } from "./readiness";

/** The GitHub login both workspaces mirror. */
const LOGIN = "acme-live-slice";

/** The repository both workspaces mirror. */
const REPO = "helios-greeter";

/** A workspace with the repository. */
interface Bench {
  readonly owner: Person;
  readonly id: string;
  readonly slug: string;
}

describe("GET /api/v1/loop/readiness (DK.1, #1318)", () => {
  let api: ApiHarness;
  let provider: ProviderStub;

  beforeAll(async () => {
    api = await ApiHarness.start();
    provider = await ProviderStub.start(() => ({ data: [] }));
  });

  afterAll(async () => {
    await provider.stop();
    await api.close();
  });

  afterEach(() => api.truncate());

  /**
   * A workspace mirroring `acme-live-slice/<repo>`.
   *
   * @param repo - The repository's name.
   * @returns The workspace and its owner.
   */
  async function bench(repo: string = REPO): Promise<Bench> {
    const owner = await api.signIn();
    const workspace = await api.workspace(owner);
    const { rows } = await api.sql.query<{ id: string }>(
      `insert into ouroboros.github_orgs (organization_id, login, enabled)
       values ($1, $2, true) returning id`,
      [workspace.id, LOGIN],
    );
    await api.sql.query(
      `insert into ouroboros.github_repos (org_id, name, enabled) values ($1, $2, true)`,
      [rows[0].id, repo],
    );

    return { owner, id: workspace.id, slug: workspace.slug };
  }

  /**
   * Give a workspace a tested, invocable connection at the provider stub.
   *
   * @param at - The workspace.
   */
  async function connect(at: Bench): Promise<void> {
    await api.sql.query(
      `insert into ouroboros.provider_connections
              (organization_id, kind, display_name, status, enabled, base_url, last_checked_at)
       values ($1, 'anthropic', 'Anthropic', 'active', true, $2, now())`,
      [at.id, provider.baseUrl],
    );
  }

  /**
   * Ask the preflight.
   *
   * @param at - The workspace asking.
   * @param repository - `owner/name`.
   * @returns The pending request.
   */
  function ask(at: Bench, repository = `${LOGIN}/${REPO}`) {
    return api
      .as(at.owner)("get", `/api/v1/loop/readiness?repository=${repository}&workflow=live-slice`)
      .set(TENANT_HEADER, at.slug);
  }

  /** What the run, queue and farm tables hold, in rows. */
  async function counts(): Promise<Record<string, number>> {
    const { rows } = await api.sql.query<Record<string, number>>(
      `select (select count(*)::integer from ouroboros.build_jobs) as build_jobs,
              (select count(*)::integer from ouroboros.queue_items) as queue_items,
              (select count(*)::integer from ouroboros.runs) as runs`,
    );

    return rows[0];
  }

  it("answers every check, in order, without a model call, a job or a write", async () => {
    const at = await bench();
    await connect(at);
    const before = await counts();

    const readiness = bodyOf<LoopReadinessResource>(await ask(at).expect(200));

    expect(readiness.checks.map((check) => check.id)).toEqual([...READINESS_CHECK_IDS]);
    expect(readiness.repository).toBe(`${LOGIN}/${REPO}`);
    expect(readiness.ready).toBe(false);
    const byId = Object.fromEntries(readiness.checks.map((check) => [check.id, check]));
    expect(byId.provider_connection).toMatchObject({ state: "pass" });
    expect(byId.repository).toMatchObject({ state: "pass" });
    expect(byId.push_credential).toMatchObject({ state: "fail", code: "github_not_configured" });
    expect(byId.workflow_published).toMatchObject({ state: "fail", code: "workflow_not_found" });
    // The provider was never contacted, and nothing was queued, opened or dispatched.
    expect(provider.received).toHaveLength(0);
    expect(await counts()).toEqual(before);
  });

  it("never lets one workspace's connection answer for another's", async () => {
    const connected = await bench();
    const bare = await bench();
    await connect(connected);

    const theirs = bodyOf<LoopReadinessResource>(await ask(connected).expect(200));
    const ours = bodyOf<LoopReadinessResource>(await ask(bare).expect(200));

    expect(theirs.checks.find((c) => c.id === "provider_connection")?.state).toBe("pass");
    expect(ours.checks.find((c) => c.id === "provider_connection")).toMatchObject({
      state: "fail",
      code: "no_invocable_connection",
    });
  });

  it("answers 404 for a repository only another workspace has", async () => {
    const other = await bench("private-thing");
    const at = await bench();

    const refusal = bodyOf<ErrorEnvelope>(await ask(at, `${LOGIN}/private-thing`).expect(404));

    expect(refusal.code).toBe("repository_not_found");
    await ask(other, `${LOGIN}/private-thing`).expect(200);
  });

  it("refuses a malformed query", async () => {
    const at = await bench();

    await ask(at, "not-a-repository").expect(422);
  });
});
