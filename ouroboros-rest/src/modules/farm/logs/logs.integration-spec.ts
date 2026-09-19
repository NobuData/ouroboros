import { ApiHarness, type Person, type Workspace } from "../../../testing/harness.fixture";
import { bodyOf } from "../../../testing/integration.fixture";
import { TENANT_HEADER } from "../../tenancy/tenant.resolver";
import { certificationRequest } from "../farm.fixture";
import type { EnrollmentResource, MintedTokenResource } from "../farm.resources";
import { FakeAgent, isRefused } from "../gateway/fake.agent.fixture";
import { GATEWAY_CLOCK } from "../gateway/gateway.clock";
import { fixtureFrame } from "../gateway/gateway.fixture";
import { newUlid, wireId } from "../protocol/ulid";
import { LogIngest } from "./log.ingest";
import { LOG_GAP_WAIT_MS } from "./log.policy";
import { LogRetentionSweeper } from "./log.retention";
import type { BuildLogResource } from "./logs.resources";
import { FARM_LOG_RATE_GUARD, RateGuard } from "./rate.guard";

/**
 * Build logs, end to end — a fake agent streaming `log.chunk` over a real WebSocket, against the
 * whole application and a migrated database ([#253](https://github.com/NobuData/ouroboros/issues/253)).
 *
 * Every acceptance criterion, as a reader of the log would ask it:
 *
 *   * **Chunks reassemble in order** under deliberately out-of-order arrival.
 *   * **Offset fetch resumes exactly** — no byte duplicated or skipped across successive polls,
 *     multi-byte characters split across chunks included.
 *   * **Byte caps are enforced server-side**, and the cap's elision and the agent's own are **one**
 *     tail figure.
 *   * **Retention** removes what the policy says — whole logs, by age and by budget — and nothing
 *     else.
 *   * **`live` is truthful**: a finished job answers `false` at once, whatever just arrived.
 *   * **A per-workspace rate guard** keeps one workspace's flood from starving another's ingest.
 *   * **Organization isolation**: another workspace's job log is unreachable, and unwritable.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

/** The header this suite's application trusts a proxy to forward a certificate in. */
const HEADER = "x-ouro-client-cert";

/** How far the gateway's clock is moved ahead of the real one. */
const clock = { offset: 0 };

/** The log budget this suite's application is started with — the setting's floor, 1 MiB. */
const BUDGET = 1_048_576;

/** Workspaces whose ingest this suite throttles, and the guard each is held to. */
const throttled = new Map<string, RateGuard>();

/** A workspace with a pool and a repository, and an owner holding a session in it. */
interface Farm {
  readonly owner: Person;
  readonly workspace: Workspace;
  readonly poolId: string;
  readonly repoId: string;
}

describe("build logs", () => {
  let api: ApiHarness;
  const agents: FakeAgent[] = [];

  beforeAll(async () => {
    api = await ApiHarness.start(
      { OURO_FARM_CLIENT_CERT_HEADER: HEADER, OURO_FARM_LOG_BUDGET_BYTES: String(BUDGET) },
      [
        { provide: GATEWAY_CLOCK, useValue: () => new Date(Date.now() + clock.offset) },
        {
          provide: FARM_LOG_RATE_GUARD,
          useValue: {
            admit: (organizationId: string, bytes: number, now: number) =>
              throttled.get(organizationId)?.admit(organizationId, bytes, now) ?? true,
            prune: () => undefined,
          },
        },
      ],
    );
  });

  afterAll(() => api.close());

  afterEach(async () => {
    for (const agent of agents.splice(0)) agent.drop();
    clock.offset = 0;
    throttled.clear();
    await api.truncate();
  });

  /** A workspace with pool-a and a mirrored repository. */
  async function farm(): Promise<Farm> {
    const owner = await api.signIn();
    const workspace = await api.workspace(owner);

    const { rows: pools } = await api.sql.query<{ id: string }>(
      `insert into ouroboros.runner_pools (organization_id, name, executor, image)
       values ($1, 'pool-a', 'container', 'img:0.17') returning id`,
      [workspace.id],
    );
    const { rows: orgs } = await api.sql.query<{ id: string }>(
      `insert into ouroboros.github_orgs (organization_id, login, enabled)
       values ($1, 'acme-robotics', true) returning id`,
      [workspace.id],
    );
    const { rows: repos } = await api.sql.query<{ id: string }>(
      `insert into ouroboros.github_repos (org_id, name, enabled)
       values ($1, 'helios-firmware', true) returning id`,
      [orgs[0].id],
    );

    return { owner, workspace, poolId: pools[0].id, repoId: repos[0].id };
  }

  /** Enrol a machine into pool-a through the real routes, and connect it. */
  async function runner(
    context: Farm,
    name = "forge-01",
  ): Promise<{ id: string; agent: FakeAgent }> {
    const minted = bodyOf<MintedTokenResource>(
      await api
        .as(context.owner)("post", "/api/v1/farm/enrollment-tokens")
        .set(TENANT_HEADER, context.workspace.id)
        .send({ pool: "pool-a" })
        .expect(201),
    );
    const enrollment = bodyOf<EnrollmentResource>(
      await api
        .anonymous("post", "/api/v1/farm/registrations")
        .send({ token: minted.token, name, arch: "linux/x86_64", csr: certificationRequest() })
        .expect(201),
    );

    const agent = await FakeAgent.connect(api.baseUrl, {
      certificate: enrollment.certificate as string,
      header: HEADER,
    });
    if (isRefused(agent)) throw new Error(`refused: ${String(agent.status)} ${agent.code}`);
    agents.push(agent);
    agent.send("valid/hello.json");
    await agent.next("ack");

    return { id: enrollment.runnerId, agent };
  }

  /** A job running on a runner, as dispatch would have left it. */
  async function job(context: Farm, runnerId: string, capBytes = 67_108_864): Promise<string> {
    const { rows } = await api.sql.query<{ id: string }>(
      `insert into ouroboros.build_jobs
         (organization_id, number, pool_id, runner_id, github_repo_id, git_ref, commit_sha,
          label, title, executor, image, command, status, offered_at, started_at, log_cap_bytes)
       values ($1, (select coalesce(max(number), 0) + 1 from ouroboros.build_jobs
                     where organization_id = $1),
               $2, $3, $4, 'refs/heads/main', repeat('a', 40), 'build', 'Build firmware',
               'container', 'img:0.17', 'make all', 'running', now(), now(), $5)
       returning id`,
      [context.workspace.id, context.poolId, runnerId, context.repoId, capBytes],
    );

    return rows[0].id;
  }

  /** Send a `log.chunk` for a job. */
  function chunk(
    agent: FakeAgent,
    jobId: string,
    seq: number,
    bytes: Buffer,
    droppedBytes = 0,
  ): void {
    const frame = fixtureFrame("valid/log-chunk.json");
    frame.id = newUlid();
    Object.assign(frame.payload, {
      job: wireId("job", jobId),
      seq,
      data: bytes.toString("base64"),
      dropped_bytes: droppedBytes,
    });
    agent.send(frame);
  }

  /** Send a `job.finish` for a job, and wait for its receipt. */
  async function finish(
    agent: FakeAgent,
    jobId: string,
    log: { chunks: number; dropped_bytes: number },
  ): Promise<void> {
    const frame = fixtureFrame("valid/job-finish.json");
    const at = new Date().toISOString();
    frame.id = newUlid();
    Object.assign(frame.payload, {
      job: wireId("job", jobId),
      started_at: at,
      finished_at: at,
      ccache: null,
      log: { bytes: 0, ...log },
    });
    agent.send(frame);
    await agent.next("receipt");
  }

  /** Read a page of a job's log. */
  async function read(context: Farm, jobId: string, after?: number, person = context.owner) {
    return api
      .as(person)(
        "get",
        `/api/v1/farm/jobs/${jobId}/log${after === undefined ? "" : `?after=${String(after)}`}`,
      )
      .set(TENANT_HEADER, context.workspace.id);
  }

  /** Read a page, expecting it. */
  async function page(context: Farm, jobId: string, after?: number): Promise<BuildLogResource> {
    const response = await read(context, jobId, after);
    expect(response.status).toBe(200);

    return bodyOf<BuildLogResource>(response);
  }

  /** Read the whole log a page at a time, as the live card does. */
  async function readAll(
    context: Farm,
    jobId: string,
  ): Promise<{ text: string; pages: BuildLogResource[] }> {
    const pages: BuildLogResource[] = [];
    let offset = 0;
    let text = "";

    for (let i = 0; i < 1_000; i += 1) {
      const next = await page(context, jobId, offset);
      pages.push(next);
      text += next.bytes;
      if (next.nextOffset === offset) break;
      offset = next.nextOffset;
    }

    return { text, pages };
  }

  /** Wait until the stored log reaches a length. */
  async function stored(jobId: string, bytes: number): Promise<void> {
    for (let i = 0; i < 100; i += 1) {
      const { rows } = await api.sql.query<{ log_bytes: string }>(
        "select log_bytes from ouroboros.build_jobs where id = $1",
        [jobId],
      );
      if (Number(rows[0].log_bytes) >= bytes) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`the log of ${jobId} never reached ${String(bytes)} bytes`);
  }

  it("REASSEMBLES CHUNKS IN ORDER under deliberately out-of-order arrival", async () => {
    const context = await farm();
    const { id, agent } = await runner(context);
    const jobId = await job(context, id);

    chunk(agent, jobId, 0, Buffer.from("$ west build\n"));
    chunk(agent, jobId, 2, Buffer.from("[6/7] Linking zephyr.elf\n"));
    chunk(agent, jobId, 1, Buffer.from("[5/7] Compiling rollback.c\n"));
    await stored(jobId, 64);

    expect((await page(context, jobId)).bytes).toBe(
      "$ west build\n[5/7] Compiling rollback.c\n[6/7] Linking zephyr.elf\n",
    );
  });

  it("RESUMES AN OFFSET FETCH EXACTLY — nothing duplicated or skipped across polls", async () => {
    const context = await farm();
    const { id, agent } = await runner(context);
    const jobId = await job(context, id);
    const text = "ok ✓ héllo 𝄞 — ".repeat(300);
    const bytes = Buffer.from(text, "utf8");
    // Chunk boundaries inside multi-byte characters: "✓" at 3–5, "é" at 8–9, "𝄞" at 14–17 and
    // "—" at 19–21 of each 23-byte repeat.
    const cuts = [0, 4, 9, 15, 43, 1_005, 2_067, bytes.length];

    let offset = 0;
    let read = "";
    for (let seq = 0; seq < cuts.length - 1; seq += 1) {
      chunk(agent, jobId, seq, bytes.subarray(cuts[seq], cuts[seq + 1]));
      await stored(jobId, cuts[seq + 1]);

      const next = await page(context, jobId, offset);
      expect(next.offset).toBe(offset);
      read += next.bytes;
      offset = next.nextOffset;
    }

    expect(read).toBe(text);
    expect(offset).toBe(bytes.length);
    expect((await page(context, jobId, offset)).bytes).toBe("");
  });

  it("ENFORCES THE CAP SERVER-SIDE, and the cap and the agent's own tail are ONE marker", async () => {
    const context = await farm();
    const { id, agent } = await runner(context);
    const jobId = await job(context, id, 65_536);

    chunk(agent, jobId, 0, Buffer.alloc(30_000, "a"));
    chunk(agent, jobId, 1, Buffer.alloc(30_000, "b"));
    // The agent's throttle dropped 100 bytes before this chunk — which crosses the cap.
    chunk(agent, jobId, 2, Buffer.alloc(30_000, "c"), 100);
    // Past the cap: nothing stored, and the 50 the agent dropped before it go to the tail too.
    chunk(agent, jobId, 3, Buffer.alloc(1_000, "d"), 50);
    await stored(jobId, 65_536);
    // The agent hit its own cap and dropped 7000 more after its last chunk.
    await finish(agent, jobId, { chunks: 4, dropped_bytes: 100 + 50 + 7_000 });

    const whole = await readAll(context, jobId);
    const last = whole.pages[whole.pages.length - 1];

    expect(whole.text).toBe("a".repeat(30_000) + "b".repeat(30_000) + "c".repeat(5_536));
    expect(whole.pages.flatMap((p) => p.elisions)).toEqual([
      { offset: 60_000, bytes: 100, missingChunks: 0 },
    ]);
    // The cap's 24464 + 1000, the 50 carried past it, and the agent's own 7000: one figure.
    expect(last.tail).toEqual({
      bytes: 24_464 + 1_000 + 50 + 7_000,
      missingChunks: 0,
      capped: true,
    });
    expect(last).toMatchObject({ end: 65_536, nextOffset: 65_536, live: false });
  });

  it("KEEPS `live` TRUTHFUL — a finished job is not live, however recent its last chunk", async () => {
    const context = await farm();
    const { id, agent } = await runner(context);
    const jobId = await job(context, id);

    chunk(agent, jobId, 0, Buffer.from("building…\n"));
    await stored(jobId, 1);
    const running = await read(context, jobId);
    expect(bodyOf<BuildLogResource>(running)).toMatchObject({ live: true, pollAfter: 2 });
    expect(running.headers["x-ouro-poll-after"]).toBe("2");
    expect(running.headers["cache-control"]).toBe("private, no-cache");

    chunk(agent, jobId, 1, Buffer.from("done\n"));
    await finish(agent, jobId, { chunks: 2, dropped_bytes: 0 });

    const done = await read(context, jobId);
    expect(bodyOf<BuildLogResource>(done)).toMatchObject({
      live: false,
      bytes: "building…\ndone\n",
      tail: null,
      pollAfter: 15,
    });
    expect(done.headers["x-ouro-poll-after"]).toBe("15");
  });

  it("CLOSES A FINISHED JOB'S LOG — a cancelled build's later output is not written", async () => {
    const context = await farm();
    const { id, agent } = await runner(context);
    const jobId = await job(context, id);

    chunk(agent, jobId, 0, Buffer.from("before the cancel\n"));
    await stored(jobId, 18);
    await api
      .as(context.owner)("post", `/api/v1/farm/jobs/${jobId}/cancel`)
      .set(TENANT_HEADER, context.workspace.id)
      .expect(200);

    chunk(agent, jobId, 1, Buffer.from("after the cancel\n"));
    await agent.next("job.cancel");
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(await page(context, jobId)).toMatchObject({
      live: false,
      bytes: "before the cancel\n",
      end: 18,
    });
  });

  it("marks a lost frame, once its gap has been waited out, where it was lost", async () => {
    const context = await farm();
    const { id, agent } = await runner(context);
    const jobId = await job(context, id);

    chunk(agent, jobId, 0, Buffer.from("first\n"));
    chunk(agent, jobId, 2, Buffer.from("third\n"));
    await stored(jobId, 6);
    expect((await page(context, jobId)).bytes).toBe("first\n");

    clock.offset += LOG_GAP_WAIT_MS + 1_000;
    await api.nest.get(LogIngest).housekeep();

    const whole = await readAll(context, jobId);
    expect(whole.text).toBe("first\nthird\n");
    expect(whole.pages.flatMap((p) => p.elisions)).toEqual([
      { offset: 6, bytes: 0, missingChunks: 1 },
    ]);
  });

  it("RATE-GUARDS EACH WORKSPACE — one flood is elided and marked while another's ingest carries on", async () => {
    const flooding = await farm();
    const quiet = await farm();
    const loud = await runner(flooding);
    const calm = await runner(quiet, "forge-09");
    const loudJob = await job(flooding, loud.id);
    const calmJob = await job(quiet, calm.id);
    // Ten bytes, never refilled: the flooding workspace can afford one small chunk.
    throttled.set(flooding.workspace.id, new RateGuard(0, 10));

    chunk(loud.agent, loudJob, 0, Buffer.from("ok\n"));
    chunk(loud.agent, loudJob, 1, Buffer.alloc(20_000, "x"));
    chunk(loud.agent, loudJob, 2, Buffer.from("tail\n"));
    chunk(calm.agent, calmJob, 0, Buffer.alloc(20_000, "y"));
    await stored(loudJob, 8);
    await stored(calmJob, 20_000);

    const flooded = await readAll(flooding, loudJob);
    expect(flooded.text).toBe("ok\ntail\n");
    expect(flooded.pages.flatMap((p) => p.elisions)).toEqual([
      { offset: 3, bytes: 20_000, missingChunks: 0 },
    ]);
    expect((await readAll(quiet, calmJob)).text).toBe("y".repeat(20_000));
  });

  describe("retention", () => {
    it("REMOVES A FINISHED LOG PAST ITS WINDOW — whole — and leaves a running one alone", async () => {
      const context = await farm();
      const { id, agent } = await runner(context);
      const old = await job(context, id);
      const running = await job(context, id);

      chunk(agent, old, 0, Buffer.from("old build\n"));
      chunk(agent, running, 0, Buffer.from("still building\n"));
      await stored(old, 10);
      await stored(running, 15);
      await finish(agent, old, { chunks: 1, dropped_bytes: 0 });
      await api.sql.query(
        `update ouroboros.build_log_chunks
            set received_at = now() - interval '31 days', retain_until = now() - interval '1 day'`,
      );

      const report = await api.nest.get(LogRetentionSweeper).sweep();

      expect(report).toMatchObject({ byAge: 1, chunks: 1, bytes: 10 });
      expect(await page(context, old)).toMatchObject({ retained: false, bytes: "", end: 10 });
      expect(await page(context, running)).toMatchObject({
        retained: true,
        bytes: "still building\n",
      });
    });

    it("HOLDS EACH WORKSPACE TO ITS BUDGET, oldest finished log first", async () => {
      const context = await farm();
      const { id } = await runner(context);
      const logs: string[] = [];
      // Three finished jobs of 400 KiB each against a 1 MiB budget: the oldest goes.
      for (const hoursAgo of [3, 2, 1]) {
        const jobId = await job(context, id);
        await api.sql.query(
          `insert into ouroboros.build_log_chunks (job_id, seq, content) values ($1, 0, $2)`,
          [jobId, Buffer.alloc(409_600, "z")],
        );
        await api.sql.query(
          `update ouroboros.build_jobs
              set status = 'succeeded', exit_code = 0,
                  queued_at = now() - make_interval(hours => $2, mins => 3),
                  offered_at = now() - make_interval(hours => $2, mins => 2),
                  started_at = now() - make_interval(hours => $2, mins => 1),
                  finished_at = now() - make_interval(hours => $2)
            where id = $1`,
          [jobId, hoursAgo],
        );
        logs.push(jobId);
      }

      const report = await api.nest.get(LogRetentionSweeper).sweep();

      expect(report).toMatchObject({ byAge: 0, byBudget: 1, bytes: 409_600 });
      expect((await page(context, logs[0])).retained).toBe(false);
      expect((await page(context, logs[1])).retained).toBe(true);
      expect((await page(context, logs[2])).retained).toBe(true);
    });
  });

  describe("who may read", () => {
    it("lets every member of the workspace read — a viewer included", async () => {
      const context = await farm();
      const { id } = await runner(context);
      const jobId = await job(context, id);
      const viewer = await api.signIn();
      await api.join(context.workspace.id, viewer, "viewer");

      expect((await read(context, jobId, 0, viewer)).status).toBe(200);
    });

    it("HOLDS ORGANIZATION ISOLATION — another workspace's log is unreachable and unwritable", async () => {
      const mine = await farm();
      const theirs = await farm();
      const me = await runner(mine);
      const them = await runner(theirs, "forge-02");
      const myJob = await job(mine, me.id);

      chunk(me.agent, myJob, 0, Buffer.from("mine\n"));
      // Their runner, naming my job: not its job, so nothing is stored.
      chunk(them.agent, myJob, 1, Buffer.from("theirs\n"));
      await stored(myJob, 5);
      await new Promise((resolve) => setTimeout(resolve, 200));

      const refused = await read(theirs, myJob);
      expect(refused.status).toBe(404);
      expect(bodyOf<{ code: string }>(refused).code).toBe("farm_job_not_found");
      expect((await page(mine, myJob)).bytes).toBe("mine\n");
    });
  });

  it("refuses an offset past the end, and one that is not an offset", async () => {
    const context = await farm();
    const { id, agent } = await runner(context);
    const jobId = await job(context, id);
    chunk(agent, jobId, 0, Buffer.from("12345"));
    await stored(jobId, 5);

    const past = await read(context, jobId, 6);
    expect(past.status).toBe(422);
    expect(bodyOf<{ code: string; details: { end: number } }>(past)).toMatchObject({
      code: "farm_log_offset_out_of_range",
      details: { end: 5 },
    });

    const garbage = await api
      .as(context.owner)("get", `/api/v1/farm/jobs/${jobId}/log?after=abc`)
      .set(TENANT_HEADER, context.workspace.id);
    expect(garbage.status).toBe(422);
    expect(bodyOf<{ code: string }>(garbage).code).toBe("validation_failed");
  });
});
