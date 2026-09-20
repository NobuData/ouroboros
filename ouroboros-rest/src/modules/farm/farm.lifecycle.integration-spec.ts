import { ApiHarness, type Person, type Workspace } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import { certificationRequest } from "./farm.fixture";
import type { EnrollmentResource, MintedTokenResource } from "./farm.resources";
import type { BuildJobResource } from "./dispatch/jobs.resources";
import { DispatchService } from "./dispatch/dispatcher";
import { LOST_RUNNER_AFTER_MS } from "./dispatch/dispatch.policy";
import type { FarmResource } from "./fleet/fleet.resources";
import { FakeAgent, isRefused } from "./gateway/fake.agent.fixture";
import { GATEWAY_CLOCK } from "./gateway/gateway.clock";
import { PRESENCE_THRESHOLD_MS } from "./gateway/gateway.policy";
import { PresenceSweeper } from "./gateway/presence.sweeper";
import type { BuildLogResource } from "./logs/logs.resources";
import type { Envelope } from "./protocol/protocol";

/**
 * **The farm, end to end, through one scripted agent.**
 *
 * AH.7 ([#255](https://github.com/NobuData/ouroboros/issues/255)). Enrolment, the gateway,
 * dispatch, log ingest and the read APIs each have a suite of their own, and each of those
 * suites reaches for the seam next to it: `dispatch.integration-spec.ts` inserts the log it
 * never streams, `logs.integration-spec.ts` inserts the running job nothing dispatched, and
 * `agent.gateway.integration-spec.ts` plays dispatch's part by hand. Every one of those seams is
 * a place where two modules can agree with their own suites and disagree with each other.
 *
 * This file has no seams. One machine is enrolled with a real token, connects with the
 * certificate that enrolment issued, heartbeats, is offered the build a person submitted over
 * HTTP, accepts it, streams its output, finishes it — and the assertions are made on what a
 * person then reads back: the build's row, its log through the log route, and the stat row the
 * farm page draws from. **What it adds over the five suites below it is not coverage of any one
 * module but the claim that the chain joins up.**
 *
 * The failure modes it scripts are the ones that *cross* those boundaries, which is why they are
 * here rather than in the module suites that own their halves:
 *
 *   * **A runner killed mid-job requeues once and then fails terminally** — and the log the dead
 *     attempt streamed is still readable afterwards. Dispatch's suite proves the requeue against
 *     a job with no log; this one proves the retry does not take the evidence with it.
 *   * **A terminal frame delivered twice applies once** — after a real reconnect, with real
 *     chunks already ingested, so the assertion covers the log as well as the row. A duplicate
 *     that appended the output twice would pass a suite that only counted finished jobs.
 *   * **A declined offer is run by somebody else** — end to end, so the job that comes back is
 *     the second runner's work rather than a row that merely changed hands.
 *   * **Chunks that arrive out of order reassemble** on the path a real agent uses, which is the
 *     gateway's ingest rather than the repository the log suite calls directly.
 *
 * Time is moved rather than waited out: `GATEWAY_CLOCK` is overridden, so "five minutes later"
 * costs nothing and the whole file runs in seconds.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

/** The header this suite's application trusts a proxy to forward a certificate in. */
const HEADER = "x-ouro-client-cert";

/** The farm's HTTP surface. */
const FARM = "/api/v1/farm";

/** The commit every build here is of. */
const COMMIT = "9e7bd4034c1f1b2a6d8e0f5c7a9b3d1e2f4a6c80";

/** How far the gateway's clock is moved ahead of the real one. */
const clock = { offset: 0 };

/** Far enough past a runner going quiet that it is offline *and* out of its resume window. */
const LOST = PRESENCE_THRESHOLD_MS + LOST_RUNNER_AFTER_MS + 5_000;

/** A workspace with a pool and a mirrored repository, and an owner holding a session in it. */
interface Farm {
  readonly owner: Person;
  readonly workspace: Workspace;
}

/** An enrolled, connected machine. */
interface Runner {
  readonly id: string;
  readonly agent: FakeAgent;
}

/** A `build_jobs` row, as this suite reads it back. */
interface JobRow {
  id: string;
  status: string;
  exit_code: number | null;
  retry_of: string | null;
  runner_id: string | null;
}

describe("the build farm, end to end", () => {
  let api: ApiHarness;
  const agents: FakeAgent[] = [];

  beforeAll(async () => {
    api = await ApiHarness.start({ OURO_FARM_CLIENT_CERT_HEADER: HEADER }, [
      { provide: GATEWAY_CLOCK, useValue: () => new Date(Date.now() + clock.offset) },
    ]);
  });

  afterAll(() => api.close());

  afterEach(async () => {
    for (const agent of agents.splice(0)) agent.drop();
    clock.offset = 0;
    await api.truncate();
  });

  /** A workspace with `pool-a` and one mirrored repository. */
  async function farm(): Promise<Farm> {
    const owner = await api.signIn();
    const workspace = await api.workspace(owner);

    await api.sql.query(
      `insert into ouroboros.runner_pools
         (organization_id, name, executor, image, default_command, max_concurrency)
       values ($1, 'pool-a', 'container', 'img:0.17', 'make all', 1)`,
      [workspace.id],
    );
    const { rows: orgs } = await api.sql.query<{ id: string }>(
      `insert into ouroboros.github_orgs (organization_id, login, enabled)
       values ($1, 'acme-robotics', true) returning id`,
      [workspace.id],
    );
    await api.sql.query(
      `insert into ouroboros.github_repos (org_id, name, enabled)
       values ($1, 'helios-firmware', true)`,
      [orgs[0].id],
    );

    return { owner, workspace };
  }

  /**
   * Enrol a machine through the real routes and connect it with the certificate it was issued.
   *
   * Nothing here is inserted: the token is minted over HTTP, spent over HTTP, and the
   * certificate that comes back is what the socket presents. That chain — a token becoming a
   * connected agent — is the first thing this file exists to assert, so every case runs it.
   *
   * @param name - The machine's name.
   * @returns The runner id and its connected agent.
   */
  async function enrol(context: Farm, name: string): Promise<Runner> {
    const minted = bodyOf<MintedTokenResource>(
      await api
        .as(context.owner)("post", `${FARM}/enrollment-tokens`)
        .set(TENANT_HEADER, context.workspace.id)
        .send({ pool: "pool-a" })
        .expect(201),
    );
    const enrollment = bodyOf<EnrollmentResource>(
      await api
        .anonymous("post", `${FARM}/registrations`)
        .send({
          token: minted.token,
          name,
          arch: "linux/x86_64",
          csr: certificationRequest(),
        })
        .expect(201),
    );

    const agent = await FakeAgent.connect(api.baseUrl, {
      certificate: enrollment.certificate as string,
      header: HEADER,
    });
    if (isRefused(agent)) throw new Error(`refused: ${String(agent.status)} ${agent.code}`);
    agents.push(agent);
    await agent.hello();

    return { id: enrollment.runnerId, agent };
  }

  /** Submit a build as the workspace's owner. */
  async function submit(context: Farm): Promise<BuildJobResource> {
    return bodyOf<BuildJobResource>(
      await api
        .as(context.owner)("post", `${FARM}/jobs`)
        .set(TENANT_HEADER, context.workspace.id)
        .send({
          pool: "pool-a",
          repository: "acme-robotics/helios-firmware",
          ref: "refs/heads/main",
          commit: COMMIT,
        })
        .expect(201),
    );
  }

  /** Run a dispatch tick, which is what turns a queued build into an offer. */
  async function dispatch(): Promise<void> {
    await api.nest.get(DispatchService).tick();
  }

  /** Submit, dispatch, and hand back the offer the agent received. */
  async function offered(context: Farm, runner: Runner): Promise<Envelope<"job.offer">> {
    await submit(context);
    await dispatch();

    return runner.agent.next("job.offer");
  }

  /** A job's row. */
  async function jobRow(id: string): Promise<JobRow> {
    const { rows } = await api.sql.query<JobRow>(
      "select id, status, exit_code, retry_of, runner_id from ouroboros.build_jobs where id = $1",
      [id],
    );

    return rows[0];
  }

  /** Every job of a workspace, oldest first. */
  async function jobs(context: Farm): Promise<JobRow[]> {
    const { rows } = await api.sql.query<JobRow>(
      `select id, status, exit_code, retry_of, runner_id from ouroboros.build_jobs
        where organization_id = $1 order by number`,
      [context.workspace.id],
    );

    return rows;
  }

  /** Read a job's whole log the way the live card does — a page at a time, following the offset. */
  async function log(context: Farm, jobId: string): Promise<{ text: string; capped: boolean }> {
    let offset = 0;
    let text = "";
    let capped = false;

    for (let i = 0; i < 100; i += 1) {
      const page = bodyOf<BuildLogResource>(
        await api
          .as(context.owner)("get", `${FARM}/jobs/${jobId}/log?after=${String(offset)}`)
          .set(TENANT_HEADER, context.workspace.id)
          .expect(200),
      );

      text += page.bytes;
      capped ||= page.elisions.length > 0;
      if (page.nextOffset === offset) break;
      offset = page.nextOffset;
    }

    return { text, capped };
  }

  /** The farm page, which is where the stat row is drawn from. */
  async function page(context: Farm): Promise<FarmResource> {
    return bodyOf<FarmResource>(
      await api.as(context.owner)("get", FARM).set(TENANT_HEADER, context.workspace.id).expect(200),
    );
  }

  /** Wait until an asynchronous effect is visible, rather than sleeping a guess. */
  async function eventually<T>(read: () => Promise<T>, holds: (value: T) => boolean): Promise<T> {
    let value = await read();

    for (let i = 0; i < 100 && !holds(value); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      value = await read();
    }

    expect(holds(value)).toBe(true);
    return value;
  }

  /** Wait until a job's log has reached a length, which ingest does asynchronously. */
  async function stored(jobId: string, bytes: number): Promise<void> {
    await eventually(
      async () => {
        const { rows } = await api.sql.query<{ log_bytes: string }>(
          "select log_bytes from ouroboros.build_jobs where id = $1",
          [jobId],
        );

        return Number(rows[0].log_bytes);
      },
      (stored_) => stored_ >= bytes,
    );
  }

  /** Move the clock past a runner's resume window, and let the sweeps notice. */
  async function loseTime(): Promise<void> {
    clock.offset += LOST;
    await api.nest.get(PresenceSweeper).sweep();
    await dispatch();
  }

  it("RUNS THE WHOLE CHAIN: enrol → connect → heartbeat → offer → accept → stream → finish", async () => {
    const context = await farm();
    const runner = await enrol(context, "forge-01");

    // Presence, from the agent's own beat rather than from the enrolment.
    runner.agent.beat("idle");
    await eventually(
      async () => (await page(context)).runners[0].status,
      (status) => status === "online",
    );

    const offer = await offered(context, runner);
    const jobId = (await jobs(context))[0].id;

    runner.agent.accept(offer);
    runner.agent.start(offer);
    await eventually(
      () => jobRow(jobId),
      (row) => row.status === "running",
    );

    // The build's output, streamed as an agent streams it.
    const parts = ["make: entering\n", "cc -c main.c\n", "make: leaving\n"];
    runner.agent.stream(jobId, parts);
    await stored(jobId, parts.join("").length);

    const receipt = await runner.agent.finish(offer, "succeeded", {
      exitCode: 0,
      log: { bytes: parts.join("").length, chunks: parts.length },
    });

    expect(receipt.payload.duplicate).toBe(false);

    const row = await jobRow(jobId);
    expect(row.status).toBe("succeeded");
    expect(row.exit_code).toBe(0);
    expect(row.runner_id).toBe(runner.id);

    // What a person reads back: the output in the order it was produced, and the stat row.
    expect((await log(context, jobId)).text).toBe(parts.join(""));

    const stats = (await page(context)).stats.buildsToday;
    expect(stats).toMatchObject({ total: 1, clean: 1, retried: 0, failed: 0, canceled: 0 });

    // …and the machine shuts down on purpose, which is not the same as vanishing: an orderly
    // `bye` takes it offline at once rather than after the presence threshold no clock here
    // has been moved past.
    runner.agent.bye("shutdown");
    await eventually(
      async () => (await page(context)).runners[0].status,
      (status) => status === "offline",
    );

    // And the gateway never wrote a frame the contract refuses.
    expect(runner.agent.violations).toEqual([]);
  });

  it("REASSEMBLES OUT-OF-ORDER CHUNKS on the path a real agent streams through", async () => {
    const context = await farm();
    const runner = await enrol(context, "forge-01");
    const offer = await offered(context, runner);
    const jobId = (await jobs(context))[0].id;

    runner.agent.accept(offer);
    runner.agent.start(offer);

    // Produced 0,1,2,3 — sent 2,0,3,1. The gateway has to put them back by `seq`, not by
    // arrival, and the reader must never see them interleaved.
    const parts = ["alpha\n", "bravo\n", "charlie\n", "delta\n"];
    runner.agent.stream(jobId, parts, { order: [2, 0, 3, 1] });
    await stored(jobId, parts.join("").length);

    expect((await log(context, jobId)).text).toBe(parts.join(""));
    expect(runner.agent.violations).toEqual([]);
  });

  it("REQUEUES A RUNNER KILLED MID-JOB ONCE, FAILS THE SECOND TERMINALLY, and keeps the dead attempt's log", async () => {
    const context = await farm();
    const first = await enrol(context, "forge-01");

    const offer = await offered(context, first);
    const original = (await jobs(context))[0].id;

    first.agent.accept(offer);
    first.agent.start(offer);
    await eventually(
      () => jobRow(original),
      (row) => row.status === "running",
    );

    // It got far enough to say something before the machine died.
    const said = "cc -c main.c\n";
    first.agent.stream(original, [said]);
    await stored(original, said.length);

    first.agent.drop();
    await loseTime();

    const requeued = await jobs(context);
    expect(requeued[0].status).toBe("retried");
    expect(requeued[1]).toMatchObject({ status: "queued", runner_id: null, retry_of: original });

    // Attempt two, on a machine enrolled now rather than earlier — the sweep above moved the
    // clock past every runner's presence threshold, so one connected before it would have been
    // marked offline by the same tick that noticed the death this case is about.
    const second = await enrol(context, "forge-02");
    const retry = await second.agent.next("job.offer");
    expect(retry.payload).toMatchObject({ attempt: 2 });

    second.agent.accept(retry);
    second.agent.start(retry);
    await eventually(
      () => jobRow(requeued[1].id),
      (row) => row.status === "running",
    );

    second.agent.drop();
    await loseTime();

    // Once, and only once: the second death is terminal rather than a third attempt.
    const after = await jobs(context);
    expect(after).toHaveLength(2);
    expect(after[1].status).toBe("failed");

    // …and the evidence from the attempt that died is still readable.
    expect((await log(context, original)).text).toBe(said);
  });

  it("APPLIES A TERMINAL FRAME DELIVERED TWICE EXACTLY ONCE — the log included", async () => {
    const context = await farm();
    const runner = await enrol(context, "forge-01");
    const offer = await offered(context, runner);
    const jobId = (await jobs(context))[0].id;

    runner.agent.accept(offer);
    runner.agent.start(offer);

    const said = "linking\ndone\n";
    runner.agent.stream(jobId, [said]);
    await stored(jobId, said.length);

    // The frame the agent will re-send — built once, so the second delivery is the same bytes
    // rather than a second frame that merely says the same thing.
    const terminal = runner.agent.terminal(offer, "succeeded", {
      exitCode: 0,
      log: { bytes: said.length, chunks: 1 },
    });

    runner.agent.send(terminal);
    await eventually(
      () => jobRow(jobId),
      (row) => row.status === "succeeded",
    );

    // The receipt never reached it, so it comes back and says it again.
    const resumed = await runner.agent.reconnect();
    agents.push(resumed);
    await resumed.hello();
    resumed.send(terminal);

    const receipt = await resumed.next("receipt");
    expect(receipt.payload.duplicate).toBe(true);

    const row = await jobRow(jobId);
    expect(row.status).toBe("succeeded");
    expect(row.exit_code).toBe(0);

    // One finished build, counted once…
    expect((await page(context)).stats.buildsToday).toMatchObject({ total: 1, clean: 1 });
    // …and one copy of the output.
    expect((await log(context, jobId)).text).toBe(said);
    expect(resumed.violations).toEqual([]);
  });

  it("GIVES A DECLINED BUILD TO ANOTHER RUNNER, which runs it to completion", async () => {
    const context = await farm();
    const first = await enrol(context, "forge-01");
    const second = await enrol(context, "forge-02");

    const offer = await offered(context, first);
    const jobId = (await jobs(context))[0].id;

    first.agent.decline(offer, "busy", "already building");
    await dispatch();

    const second_ = await second.agent.next("job.offer");
    second.agent.accept(second_);
    second.agent.start(second_);

    const said = "built by forge-02\n";
    second.agent.stream(jobId, [said]);
    await stored(jobId, said.length);
    await second.agent.finish(second_, "succeeded", {
      exitCode: 0,
      log: { bytes: said.length, chunks: 1 },
    });

    // One build, run once, by the machine that took it.
    const rows = await jobs(context);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("succeeded");
    expect(rows[0].runner_id).toBe(second.id);
    expect((await log(context, jobId)).text).toBe(said);
    expect(first.agent.violations).toEqual([]);
    expect(second.agent.violations).toEqual([]);
  });
});
