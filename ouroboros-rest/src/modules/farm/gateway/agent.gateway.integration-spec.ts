import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ApiHarness, type Person, type Workspace } from "../../../testing/harness.fixture";
import { bodyOf } from "../../../testing/integration.fixture";
import { TENANT_HEADER } from "../../tenancy/tenant.resolver";
import { authority, certificate, certificationRequest } from "../farm.fixture";
import type { EnrollmentResource, MintedTokenResource } from "../farm.resources";
import { decode, type Envelope } from "../protocol/protocol";
import type { JobOfferPayload } from "../protocol/protocol.messages";
import { uuidOf, wireId } from "../protocol/ulid";
import { AgentSessions } from "./agent.sessions";
import { supportsExecutor } from "./capabilities";
import { FakeAgent, isRefused, type Credentials } from "./fake.agent.fixture";
import { GATEWAY_CLOCK } from "./gateway.clock";
import { FIXTURES, fixtureFrame } from "./gateway.fixture";
import { GatewayMetrics } from "./gateway.metrics";
import { MIB, PRESENCE_THRESHOLD_MS, SESSION_LIMITS } from "./gateway.policy";
import { AgentGatewayRepository } from "./gateway.repository";
import { PresenceSweeper } from "./presence.sweeper";
import { RunnerControl } from "./runner.control";

/**
 * The agent gateway, end to end — a fake agent over a real WebSocket, against the whole
 * application and a migrated database ([#251](https://github.com/NobuData/ouroboros/issues/251)).
 *
 * Every acceptance criterion the issue lists is asked here as an agent would ask it:
 *
 *   * **The fake-agent contract suite passes in both directions** — the golden transcripts in
 *     `schemas/runner-protocol/fixtures/sessions/` replayed frame by frame; the gateway accepts
 *     every agent frame and every frame it writes passes the agent's own judgement.
 *   * **Presence flips to offline at the documented threshold and recovers on reconnect**, and
 *     **`last_seen_at` is the last real heartbeat**, not the sweep time — with the gateway's clock
 *     moved rather than a suite waiting 32 seconds.
 *   * **A reconnect during `job.finish` yields one finished job, and a dropped acknowledgement
 *     does not lose one.**
 *   * **The version floor refuses with a reason**, from an application configured with one.
 *   * **A revoked certificate is refused at handshake**, and **a connection missing a client
 *     certificate is rejected** rather than silently accepted.
 *   * **Capabilities from `hello` are stored** and answer the dispatch-eligibility question.
 *   * **Drain and undrain reach a connected agent** and show in its status.
 *   * **Organization isolation**: a session cannot affect another organization's runners.
 *
 * AH.4 (dispatch) does not exist yet, so where a transcript has the gateway offer a job, the suite
 * plays dispatch's part through `AgentSessions.offer` — the exact method AH.4 will call — and a
 * job is a `build_jobs` row the suite inserts.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

/** The header this suite's application trusts a proxy to forward a certificate in. */
const HEADER = "x-ouro-client-cert";

/** The golden job id every fixture names. */
const FIXTURE_JOB = "job_01KE7J4EZ3204KQXMHJRPQPWQ6";

/** The golden `job.finish`'s envelope id. */
const FIXTURE_FINISH = "01KE7PDZMQDPKXES55PN5RZM7Q";

/** The golden offer's envelope id, which `job.accept` and `job.decline` name. */
const FIXTURE_OFFER = "01KE76GYFT5404Q2FA41RMP9PE";

/** How far the gateway's clock is moved ahead of the real one. */
const clock = { offset: 0 };

/** A workspace with a pool and a repository, and an owner holding a session in it. */
interface Farm {
  readonly owner: Person;
  readonly workspace: Workspace;
  readonly poolId: string;
  readonly repoId: string;
}

/** An enrolled runner. */
interface Enrolled {
  readonly runnerId: string;
  readonly certificate: string | null;
  readonly bearer: string | null;
}

/** A `runners` row, as the suite reads it back. */
interface RunnerRow {
  status: string;
  desired_state: string;
  last_seen_at: Date | null;
  hostname: string | null;
  arch: string;
  agent_version: string | null;
  capabilities: Record<string, unknown>;
  telemetry: Record<string, unknown>;
  uptime_seconds: string | null;
}

/** A `build_jobs` row, as the suite reads it back. */
interface JobRow {
  status: string;
  exit_code: number | null;
  started_at: Date | null;
  finished_at: Date | null;
  ccache_stats: Record<string, number> | null;
}

describe("the agent gateway", () => {
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

  /** A workspace with one pool and one repository. */
  async function farm(poolName = "arm-builders"): Promise<Farm> {
    const owner = await api.signIn();
    const workspace = await api.workspace(owner);

    const { rows: pools } = await api.sql.query<{ id: string }>(
      `insert into ouroboros.runner_pools (organization_id, name, executor, image)
       values ($1, $2, 'container', 'img:0.17') returning id`,
      [workspace.id, poolName],
    );
    const { rows: orgs } = await api.sql.query<{ id: string }>(
      `insert into ouroboros.github_orgs (organization_id, login, enabled)
       values ($1, $2, true) returning id`,
      [workspace.id, workspace.slug],
    );
    const { rows: repos } = await api.sql.query<{ id: string }>(
      `insert into ouroboros.github_repos (org_id, name, enabled) values ($1, 'firmware', true)
       returning id`,
      [orgs[0].id],
    );

    return { owner, workspace, poolId: pools[0].id, repoId: repos[0].id };
  }

  /** Enrol a machine through the real routes: mint a token, register with a CSR or the fallback. */
  async function enrol(context: Farm, name = "shed-pi-01", bearer = false): Promise<Enrolled> {
    const minted = bodyOf<MintedTokenResource>(
      await api
        .as(context.owner)("post", "/api/v1/farm/enrollment-tokens")
        .set(TENANT_HEADER, context.workspace.id)
        .send({ pool: "arm-builders" })
        .expect(201),
    );

    const body = bearer
      ? { token: minted.token, name, arch: "linux/arm64", securityMode: "bearer_fallback" }
      : { token: minted.token, name, arch: "linux/x86_64", csr: certificationRequest() };

    const enrollment = bodyOf<EnrollmentResource>(
      await api.anonymous("post", "/api/v1/farm/registrations").send(body).expect(201),
    );

    return {
      runnerId: enrollment.runnerId,
      certificate: enrollment.certificate,
      bearer: enrollment.bearerToken,
    };
  }

  /** Dial the gateway, expecting to be let in. */
  async function dial(credentials: Credentials, harness: ApiHarness = api): Promise<FakeAgent> {
    const agent = await FakeAgent.connect(harness.baseUrl, credentials);
    if (isRefused(agent)) throw new Error(`refused: ${String(agent.status)} ${agent.code}`);

    agents.push(agent);
    return agent;
  }

  /** Dial as an enrolled mTLS runner, and say the golden hello. */
  async function connect(runner: Enrolled, hello: string | object = "valid/hello.json") {
    const agent = await dial({ certificate: runner.certificate ?? undefined, header: HEADER });
    agent.send(hello);

    return { agent, ack: await agent.next("ack") };
  }

  /** A runner's row. */
  async function runnerRow(runnerId: string): Promise<RunnerRow> {
    const { rows } = await api.sql.query<RunnerRow>(
      `select status, desired_state, last_seen_at, hostname, arch, agent_version, capabilities,
              telemetry, uptime_seconds
         from ouroboros.runners where id = $1`,
      [runnerId],
    );

    return rows[0];
  }

  /** A job offered to a runner, under a wire id the fixtures (or the suite) name. */
  async function job(context: Farm, runnerId: string, wire = FIXTURE_JOB): Promise<string> {
    const id = uuidOf("job", wire) as string;

    await api.sql.query(
      `insert into ouroboros.build_jobs
         (id, organization_id, number, pool_id, runner_id, github_repo_id, git_ref, label, title,
          executor, image, command, status, offered_at)
       values ($1, $2, (select coalesce(max(number), 0) + 1 from ouroboros.build_jobs
                         where organization_id = $2),
               $3, $4, $5, 'refs/heads/main', 'build', 'Build firmware', 'container', 'img:0.17',
               'make all', 'offered', now())`,
      [id, context.workspace.id, context.poolId, runnerId, context.repoId],
    );

    return id;
  }

  /** A job's row. */
  async function jobRow(id: string): Promise<JobRow> {
    const { rows } = await api.sql.query<JobRow>(
      "select status, exit_code, started_at, finished_at, ccache_stats from ouroboros.build_jobs where id = $1",
      [id],
    );

    return rows[0];
  }

  /** The terminal-frame ledger. */
  async function ledger(): Promise<
    { runner_id: string; frame_id: string; job_id: string | null; applied: boolean }[]
  > {
    const { rows } = await api.sql.query<{
      runner_id: string;
      frame_id: string;
      job_id: string | null;
      applied: boolean;
    }>("select runner_id, frame_id, job_id, applied from ouroboros.runner_terminal_frames");

    return rows;
  }

  /** Wait until an asynchronous effect is visible. */
  async function eventually<T>(read: () => Promise<T>, holds: (value: T) => boolean): Promise<T> {
    let value = await read();

    for (let i = 0; i < 100 && !holds(value); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      value = await read();
    }

    expect(holds(value)).toBe(true);
    return value;
  }

  /** The golden offer, for dispatch's part, expiring a minute from now. */
  function offer(): JobOfferPayload {
    return {
      ...(fixtureFrame("valid/job-offer.json").payload as unknown as JobOfferPayload),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    };
  }

  describe("the handshake", () => {
    it("REJECTS A CONNECTION MISSING A CLIENT CERTIFICATE rather than silently accepting it", async () => {
      const context = await farm();
      await enrol(context);

      const refused = await FakeAgent.connect(api.baseUrl, {});

      expect(refused).toEqual({
        refused: true,
        status: 401,
        code: "farm_client_certificate_required",
      });
      expect(
        api.nest.get(GatewayMetrics).snapshot({ attached: 0, detached: 0 }).refused.no_certificate,
      ).toBeGreaterThan(0);
    });

    it("REFUSES A REVOKED CERTIFICATE AT HANDSHAKE", async () => {
      const context = await farm();
      const runner = await enrol(context);

      // Connects before…
      await connect(runner);

      await api
        .as(context.owner)("delete", `/api/v1/farm/runners/${runner.runnerId}/certificate`)
        .set(TENANT_HEADER, context.workspace.id)
        .expect(200);

      // …and not after.
      const refused = await FakeAgent.connect(api.baseUrl, {
        certificate: runner.certificate ?? undefined,
        header: HEADER,
      });

      expect(refused).toEqual({ refused: true, status: 401, code: "farm_identity_refused" });
    });

    it("refuses a certificate its workspace's own CA did not sign", async () => {
      const context = await farm();
      const runner = await enrol(context);
      const forged = certificate(authority(context.workspace.id), { runnerId: runner.runnerId });

      const refused = await FakeAgent.connect(api.baseUrl, {
        certificate: forged.pem,
        header: HEADER,
      });

      expect(refused).toMatchObject({ status: 401, code: "farm_identity_refused" });
    });

    it("refuses a runner an operator has removed", async () => {
      const context = await farm();
      const runner = await enrol(context);
      await api.sql.query(
        "update ouroboros.runners set desired_state = 'removed', status = 'removed' where id = $1",
        [runner.runnerId],
      );

      const refused = await FakeAgent.connect(api.baseUrl, {
        certificate: runner.certificate ?? undefined,
        header: HEADER,
      });

      expect(refused).toMatchObject({ status: 401, code: "farm_identity_refused" });
    });
  });

  describe("hello", () => {
    it("records what the machine reported, and answers with the runner and pool of record", async () => {
      const context = await farm();
      const runner = await enrol(context, "forge-01");

      const { agent, ack } = await connect(runner);

      expect(ack.payload).toMatchObject({
        protocol: 1,
        resumed: false,
        runner: { id: wireId("rnr", runner.runnerId), name: "forge-01", pool: "arm-builders" },
        limits: SESSION_LIMITS,
      });
      expect(uuidOf("rnr", ack.payload.runner.id)).toBe(runner.runnerId);
      expect(agent.violations).toEqual([]);

      const row = await runnerRow(runner.runnerId);
      expect(row).toMatchObject({
        status: "online",
        hostname: "shed-pi-01",
        arch: "linux/arm64",
        agent_version: "0.1.0",
      });
      expect(row.last_seen_at).toBeInstanceOf(Date);
    });

    it("STORES CAPABILITIES where dispatch eligibility reads them", async () => {
      const context = await farm();
      const runner = await enrol(context);
      const hello = fixtureFrame("valid/hello.json");
      (hello.payload.capabilities as { docker: boolean }).docker = false;

      await connect(runner, hello);

      const row = await runnerRow(runner.runnerId);
      expect(row.capabilities).toEqual({
        docker: false,
        shell: true,
        ccache: true,
        cpu_count: 8,
        memory_mb: 16384,
        executors: ["shell"],
      });
      expect(supportsExecutor(row.capabilities, "container")).toBe(false);
      expect(supportsExecutor(row.capabilities, "shell")).toBe(true);
    });

    it("refuses a hello whose security mode contradicts the transport", async () => {
      const context = await farm();
      const runner = await enrol(context);
      const agent = await dial({ certificate: runner.certificate ?? undefined, header: HEADER });

      agent.send("valid/hello-bearer-fallback.json");

      expect((await agent.next("refuse")).payload.code).toBe("identity.unknown");
      expect(await agent.closed).toBe(1000);
      expect((await runnerRow(runner.runnerId)).hostname).toBeNull();
    });

    describe("behind a version floor", () => {
      let floored: ApiHarness;

      beforeAll(async () => {
        floored = await ApiHarness.start({
          OURO_FARM_CLIENT_CERT_HEADER: HEADER,
          OURO_FARM_MIN_AGENT_VERSION: "0.2.0",
        });
      });

      afterAll(() => floored.close());

      it("REFUSES AN AGENT BELOW THE FLOOR, WITH A CLEAR REASON — the refuse transcript", async () => {
        const context = await farm();
        const runner = await enrol(context);
        const agent = await dial(
          { certificate: runner.certificate ?? undefined, header: HEADER },
          floored,
        );

        // sessions/refuse.json: hello, refuse with the minimum named, disconnect.
        agent.send("valid/hello.json");
        const refusal = await agent.next("refuse");

        expect(refusal.payload).toEqual({
          code: "version.below_minimum",
          minimum: 1,
          detail: "agent 0.1.0 is below this farm's minimum agent version 0.2.0; upgrade the agent",
          retry_after_ms: null,
        });
        expect(await agent.closed).toBe(1000);
        expect(agent.violations).toEqual([]);
        expect((await runnerRow(runner.runnerId)).hostname).toBeNull();
      });

      it("admits an agent at the floor", async () => {
        const context = await farm();
        const runner = await enrol(context);
        const agent = await dial(
          { certificate: runner.certificate ?? undefined, header: HEADER },
          floored,
        );
        const hello = fixtureFrame("valid/hello.json");
        (hello.payload.agent as { version: string }).version = "0.2.0";

        agent.send(hello);

        expect((await agent.next("ack")).payload.resumed).toBe(false);
      });
    });
  });

  describe("presence", () => {
    it("ingests a heartbeat: telemetry, uptime, the pill, and last_seen_at at this beat", async () => {
      const context = await farm();
      const runner = await enrol(context);
      const { agent } = await connect(runner);
      clock.offset = 5_000;
      const beat = Date.now() + clock.offset;

      agent.send("valid/heartbeat-busy.json");

      const row = await eventually(
        () => runnerRow(runner.runnerId),
        (r) => r.status === "building",
      );
      expect(row.telemetry).toEqual({
        cpu_pct: 96.25,
        ram_used_bytes: 7040 * MIB,
        ram_total_bytes: 16384 * MIB,
        queue_depth: 1,
        sampled_at: "2026-09-18T12:04:10.000Z",
      });
      expect(row.uptime_seconds).toBe("86650");
      expect(row.last_seen_at?.getTime()).toBeGreaterThanOrEqual(beat - 1000);
    });

    it("FLIPS TO OFFLINE AT THE DOCUMENTED THRESHOLD, keeps last_seen_at at the last real beat, and RECOVERS on reconnect", async () => {
      const context = await farm();
      const runner = await enrol(context);
      const { agent } = await connect(runner);
      const sweeper = api.nest.get(PresenceSweeper);

      agent.send("valid/heartbeat.json");
      const beaten = await eventually(
        () => runnerRow(runner.runnerId),
        (r) => r.uptime_seconds === "86400",
      );
      const lastBeat = beaten.last_seen_at?.getTime() as number;
      agent.drop();

      // Just inside the threshold: one late beat is a network, not a dead machine.
      clock.offset = PRESENCE_THRESHOLD_MS - 2_000;
      await sweeper.sweep();
      expect((await runnerRow(runner.runnerId)).status).toBe("online");

      // Past it: offline — and last_seen_at is still the beat, not the sweep.
      clock.offset = PRESENCE_THRESHOLD_MS + 2_000;
      await sweeper.sweep();
      const gone = await runnerRow(runner.runnerId);
      expect(gone).toMatchObject({ status: "offline", telemetry: {}, uptime_seconds: null });
      expect(gone.last_seen_at?.getTime()).toBe(lastBeat);

      // And back, the moment it says hello — not when something else refreshes it.
      await connect(runner);
      const back = await runnerRow(runner.runnerId);
      expect(back.status).toBe("online");
      expect(back.last_seen_at?.getTime()).toBeGreaterThan(lastBeat);
    });

    it("goes offline at once, deliberately, on the agent's bye", async () => {
      const context = await farm();
      const runner = await enrol(context);
      const { agent } = await connect(runner);

      agent.send("valid/bye.json");

      expect(await agent.closed).toBe(1000);
      await eventually(
        () => runnerRow(runner.runnerId),
        (r) => r.status === "offline",
      );
    });
  });

  describe("exactly-once terminal delivery", () => {
    it("finishes a job once and receipts it", async () => {
      const context = await farm();
      const runner = await enrol(context);
      const jobId = await job(context, runner.runnerId);
      const { agent } = await connect(runner);

      agent.send("valid/job-finish.json");

      expect((await agent.next("receipt")).payload).toEqual({
        of: FIXTURE_FINISH,
        of_type: "job.finish",
        duplicate: false,
      });
      const row = await jobRow(jobId);
      expect(row).toMatchObject({ status: "succeeded", exit_code: 0 });
      expect(row.finished_at).toBeInstanceOf(Date);
      expect(row.ccache_stats).toEqual({
        hits: 812,
        misses: 140,
        size_bytes: 1024 * MIB,
        max_size_bytes: 4096 * MIB,
      });
      expect(await ledger()).toEqual([
        { runner_id: runner.runnerId, frame_id: FIXTURE_FINISH, job_id: jobId, applied: true },
      ]);
    });

    it("A RECONNECT DURING job.finish YIELDS ONE FINISHED JOB, and a dropped acknowledgement loses nothing", async () => {
      const context = await farm();
      const runner = await enrol(context);
      const jobId = await job(context, runner.runnerId);
      const { agent, ack } = await connect(runner);

      agent.send("valid/job-finish.json");
      // The socket dies before the agent reads anything more: whatever receipt was on its way is
      // lost with it. The job is finished regardless — recorded before it was answered.
      await eventually(ledger, (rows) => rows.length === 1);
      agent.drop();
      const finished = await jobRow(jobId);
      expect(finished.status).toBe("succeeded");

      const resume = fixtureFrame("valid/hello-resume.json");
      resume.payload.resume = ack.payload.session;
      const { agent: again, ack: resumed } = await connect(runner, resume);
      expect(resumed.payload).toMatchObject({ session: ack.payload.session, resumed: true });

      again.send("valid/job-finish.json");

      // A receipt the drop swallowed may be replayed first; it names the same frame, and it is
      // not a second finished job. The re-send's own answer is the duplicate.
      let receipt = await again.next("receipt");
      if (!receipt.payload.duplicate) receipt = await again.next("receipt");

      expect(receipt.payload).toEqual({
        of: FIXTURE_FINISH,
        of_type: "job.finish",
        duplicate: true,
      });
      expect(await ledger()).toHaveLength(1);
      expect((await jobRow(jobId)).finished_at).toEqual(finished.finished_at);
    });

    it("answers a re-send on a session that did NOT survive with duplicate too — the ledger knows no sessions", async () => {
      const context = await farm();
      const runner = await enrol(context);
      await job(context, runner.runnerId);
      const { agent } = await connect(runner);

      agent.send("valid/job-finish.json");
      await agent.next("receipt");
      agent.drop();

      const { agent: fresh, ack } = await connect(runner);
      expect(ack.payload.resumed).toBe(false);
      fresh.send("valid/job-finish.json");

      expect((await fresh.next("receipt")).payload.duplicate).toBe(true);
      expect(await ledger()).toHaveLength(1);
    });

    it("applies two copies racing to the database exactly once", async () => {
      const context = await farm();
      const runner = await enrol(context);
      const jobId = await job(context, runner.runnerId);
      const repository = api.nest.get(AgentGatewayRepository);
      const write = {
        organizationId: context.workspace.id,
        runnerId: runner.runnerId,
        frameId: FIXTURE_FINISH,
        jobId,
        state: { status: "succeeded" as const, exitCode: 0, ccacheStats: null },
        agentStartedAt: new Date(),
      };

      const results = await Promise.all([
        repository.recordTerminal(write, new Date()),
        repository.recordTerminal(write, new Date()),
      ]);

      expect(results.map((r) => r.duplicate).sort()).toEqual([false, true]);
      expect(results.filter((r) => r.applied)).toHaveLength(1);
      expect(await ledger()).toHaveLength(1);
    });

    it("records, receipts and changes nothing for a finish naming a job that is not this runner's", async () => {
      const context = await farm();
      const runner = await enrol(context);
      const other = await enrol(context, "forge-02");
      const jobId = await job(context, other.runnerId);
      const { agent } = await connect(runner);

      agent.send("valid/job-finish.json");

      expect((await agent.next("receipt")).payload.duplicate).toBe(false);
      expect((await jobRow(jobId)).status).toBe("offered");
      expect(await ledger()).toEqual([
        { runner_id: runner.runnerId, frame_id: FIXTURE_FINISH, job_id: null, applied: false },
      ]);
    });

    it("starts the job a job.start names", async () => {
      const context = await farm();
      const runner = await enrol(context);
      const jobId = await job(context, runner.runnerId);
      const { agent } = await connect(runner);

      agent.send("valid/job-start.json");

      const row = await eventually(
        () => jobRow(jobId),
        (r) => r.status === "running",
      );
      expect(row.started_at).toBeInstanceOf(Date);
    });
  });

  describe("drain and undrain", () => {
    it("REACH A CONNECTED AGENT AND SHOW IN ITS STATUS — the drain transcript", async () => {
      const context = await farm();
      const runner = await enrol(context);
      const { agent } = await connect(runner);
      const control = api.nest.get(RunnerControl);
      const sessions = api.nest.get(AgentSessions);

      // sessions/drain.json: drain …
      const drained = await control.drain(context.workspace.id, runner.runnerId, {
        reason: "upgrade",
        deadline_ms: 900000,
        detail: "agent 0.1.0 is below the fleet floor for 2026-10",
      });
      expect(drained).toMatchObject({ pushed: true, runner: { desired_state: "draining" } });
      expect((await agent.next("drain")).payload.reason).toBe("upgrade");

      const beat = fixtureFrame("valid/heartbeat.json");
      beat.payload.state = "draining";
      agent.send(beat);
      await eventually(
        () => runnerRow(runner.runnerId),
        (r) => r.status === "draining",
      );

      // … an offer, declined because it is draining …
      sessions.offer(context.workspace.id, runner.runnerId, offer(), FIXTURE_OFFER);
      expect((await agent.next("job.offer")).id).toBe(FIXTURE_OFFER);
      agent.send("valid/job-decline.json");
      await eventually(
        () => Promise.resolve(sessions.find(context.workspace.id, runner.runnerId)?.outbox.length),
        (owed) => owed === 0,
      );

      // … undrained …
      await control.undrain(context.workspace.id, runner.runnerId);
      expect((await agent.next("undrain")).payload).toEqual({});
      expect(await runnerRow(runner.runnerId)).toMatchObject({
        status: "online",
        desired_state: "active",
      });

      // … and the orderly close.
      agent.send("valid/bye.json");
      expect(await agent.closed).toBe(1000);
      expect(agent.violations).toEqual([]);
    });

    it("tells a runner drained while it was away, right after its ack", async () => {
      const context = await farm();
      const runner = await enrol(context);

      const drained = await api.nest
        .get(RunnerControl)
        .drain(context.workspace.id, runner.runnerId, {
          reason: "operator",
          deadline_ms: 0,
          detail: "maintenance",
        });
      expect(drained?.pushed).toBe(false);

      const { agent } = await connect(runner);

      expect((await agent.next("drain")).payload.reason).toBe("operator");
    });
  });

  describe("organization isolation", () => {
    it("A SESSION CANNOT AFFECT ANOTHER ORGANIZATION'S RUNNERS OR JOBS", async () => {
      const mine = await farm();
      const theirs = await farm();
      const myRunner = await enrol(mine);
      const theirRunner = await enrol(theirs);
      const myJob = await job(mine, myRunner.runnerId);
      const { agent: me, ack: myAck } = await connect(myRunner);
      const { agent: them } = await connect(theirRunner);

      // Their agent names my job — start and finish — and my session.
      them.send("valid/job-start.json");
      them.send("valid/job-finish.json");
      expect((await them.next("receipt")).payload.duplicate).toBe(false);
      expect(await jobRow(myJob)).toMatchObject({ status: "offered", finished_at: null });
      expect((await ledger()).find((row) => row.runner_id === theirRunner.runnerId)).toMatchObject({
        job_id: null,
        applied: false,
      });

      const hijack = fixtureFrame("valid/hello-resume.json");
      hijack.payload.resume = myAck.payload.session;
      const { ack: theirAck } = await connect(theirRunner, hijack);
      expect(theirAck.payload.resumed).toBe(false);
      expect(api.nest.get(AgentSessions).isConnected(mine.workspace.id, myRunner.runnerId)).toBe(
        true,
      );

      // Their workspace cannot drain my runner.
      expect(
        await api.nest.get(RunnerControl).drain(theirs.workspace.id, myRunner.runnerId, {
          reason: "operator",
          deadline_ms: 0,
          detail: "not yours",
        }),
      ).toBeUndefined();
      expect((await runnerRow(myRunner.runnerId)).desired_state).toBe("active");
      expect(await me.quiet()).toEqual([]);
    });
  });

  describe("the bearer fallback", () => {
    it("admits a fallback runner by its secret, and only while its workspace permits it", async () => {
      const context = await farm();
      await api.sql.query(
        `insert into ouroboros.workspace_settings (organization_id, runner_bearer_fallback)
         values ($1, true)`,
        [context.workspace.id],
      );
      const runner = await enrol(context, "anvil-mac", true);

      const agent = await dial({ bearer: runner.bearer ?? undefined });
      agent.send("valid/hello-bearer-fallback.json");
      expect((await agent.next("ack")).payload.runner.id).toBe(wireId("rnr", runner.runnerId));

      const wrong = await FakeAgent.connect(api.baseUrl, {
        bearer: randomUUID().replace(/-/g, "").padEnd(43, "x"),
      });
      expect(wrong).toMatchObject({ status: 401, code: "farm_identity_refused" });

      await api.sql.query(
        "update ouroboros.workspace_settings set runner_bearer_fallback = false where organization_id = $1",
        [context.workspace.id],
      );
      const switchedOff = await FakeAgent.connect(api.baseUrl, {
        bearer: runner.bearer ?? undefined,
      });
      expect(switchedOff).toMatchObject({ status: 401, code: "farm_identity_refused" });
    });
  });

  describe("the golden transcripts, in both directions", () => {
    /** One `sessions/*.json` entry. */
    interface Step {
      readonly from?: "agent" | "server";
      readonly message?: string;
      readonly event?: "disconnect";
    }

    /** `expected.json`'s transcript verdicts. */
    const verdicts = (
      JSON.parse(readFileSync(join(FIXTURES, "expected.json"), "utf8")) as {
        transcripts: { name: string; document: string; duplicate_terminals: number }[];
      }
    ).transcripts;

    it.each(verdicts.filter((t) => t.name !== "refuse").map((t) => [t.name, t] as const))(
      "%s — every agent frame accepted, every gateway frame the agent's to read",
      async (_name, transcript) => {
        const context = await farm();
        const runner = await enrol(context);
        const jobId = await job(context, runner.runnerId);
        const control = api.nest.get(RunnerControl);
        const sessions = api.nest.get(AgentSessions);
        const steps = (
          JSON.parse(readFileSync(join(FIXTURES, transcript.document), "utf8")) as {
            frames: Step[];
          }
        ).frames;

        let agent = await dial({ certificate: runner.certificate ?? undefined, header: HEADER });
        let session = "";
        let duplicates = 0;
        const seen: FakeAgent[] = [agent];

        // Dispatch's and the operator's parts, for the frames only they can make the gateway send.
        const triggers: Record<string, () => Promise<unknown>> = {
          "valid/job-offer.json": () =>
            Promise.resolve(
              sessions.offer(context.workspace.id, runner.runnerId, offer(), FIXTURE_OFFER),
            ),
          "valid/drain.json": () =>
            control.drain(context.workspace.id, runner.runnerId, {
              reason: "upgrade",
              deadline_ms: 900000,
              detail: "agent 0.1.0 is below the fleet floor for 2026-10",
            }),
          "valid/undrain.json": () => control.undrain(context.workspace.id, runner.runnerId),
        };

        for (const step of steps) {
          if (step.event === "disconnect") {
            // The drop: the last frame the agent wrote is recorded before anything answers it.
            if (steps.some((s) => s.message === "valid/hello-resume.json")) {
              await eventually(ledger, (rows) => rows.length > 0);
              agent.drop();
            }
            continue;
          }

          const message = step.message as string;
          const golden = decode(readFileSync(join(FIXTURES, message))).envelope as Envelope;

          if (step.from === "agent") {
            if (message === "valid/hello-resume.json") {
              agent = await dial({ certificate: runner.certificate ?? undefined, header: HEADER });
              seen.push(agent);
              const resume = fixtureFrame(message);
              resume.payload.resume = session;
              agent.send(resume);
            } else {
              agent.send(message);
            }
            continue;
          }

          await triggers[message]?.();

          let got = await agent.next(golden.type);
          if (golden.type === "receipt") {
            const wanted = (golden.payload as { duplicate: boolean }).duplicate;
            while ((got.payload as { duplicate: boolean }).duplicate !== wanted) {
              got = await agent.next("receipt");
            }
            if (wanted) duplicates += 1;
            expect(got.payload).toEqual(golden.payload);
          }
          if (golden.type === "ack") {
            expect((got.payload as { resumed: boolean }).resumed).toBe(
              (golden.payload as { resumed: boolean }).resumed,
            );
            session = (got.payload as { session: string }).session;
          }
          if (golden.type === "job.offer") expect(got.id).toBe(FIXTURE_OFFER);
        }

        expect(duplicates).toBe(transcript.duplicate_terminals);
        for (const each of seen) expect(each.violations).toEqual([]);

        // Exactly one finished job, whatever the transcript did to the socket in between.
        const finishes = (await ledger()).filter((row) => row.frame_id === FIXTURE_FINISH);
        const finishedInTranscript = steps.some((s) => s.message === "valid/job-finish.json");
        expect(finishes).toHaveLength(finishedInTranscript ? 1 : 0);
        if (finishedInTranscript) expect((await jobRow(jobId)).status).toBe("succeeded");
      },
    );
  });
});
