import { ApiHarness, type Person, type Workspace } from "../../../testing/harness.fixture";
import { bodyOf } from "../../../testing/integration.fixture";
import { TENANT_HEADER } from "../../tenancy/tenant.resolver";
import { certificationRequest } from "../farm.fixture";
import type { EnrollmentResource, MintedTokenResource } from "../farm.resources";
import { FakeAgent, isRefused } from "../gateway/fake.agent.fixture";
import { GATEWAY_CLOCK } from "../gateway/gateway.clock";
import { fixtureFrame } from "../gateway/gateway.fixture";
import { PRESENCE_THRESHOLD_MS } from "../gateway/gateway.policy";
import { PresenceSweeper } from "../gateway/presence.sweeper";
import { RunnerControl } from "../gateway/runner.control";
import type { Envelope } from "../protocol/protocol";
import { newUlid, uuidOf } from "../protocol/ulid";
import { DECLINE_COOLDOWN_MS, LOST_RUNNER_AFTER_MS, OFFER_RECLAIM_MS } from "./dispatch.policy";
import { DispatchRepository } from "./dispatch.repository";
import { DispatchService } from "./dispatcher";
import { JobCompletions, type JobCompleted } from "./job.completions";
import type { BuildJobResource } from "./jobs.resources";

/**
 * Build dispatch, end to end — fake agents over real WebSockets, against the whole application
 * and a migrated database ([#252](https://github.com/NobuData/ouroboros/issues/252)).
 *
 * Every acceptance criterion the issue lists is asked here as an operator and an agent would
 * ask it:
 *
 *   * **The dispatch matrix** — capability, drain, capacity, offline and disconnected runners
 *     beside one that can take the job, and only that one is offered it.
 *   * **A container job is never offered to a runner without docker**, even when it is the only
 *     runner there is.
 *   * **A runner lost mid-job → requeue once → a second failure is terminal**, with the gateway's
 *     clock moved rather than a suite waiting five minutes.
 *   * **`retried` counts only infrastructure-classed failures** — an `errored` finish is retried,
 *     a non-zero exit is `failed`.
 *   * **Cancellation propagates to the agent** as a `job.cancel`, and the job ends `canceled`.
 *   * **Queue depths are accurate under concurrent submission** and match the agent's `q:N`.
 *   * **A declined offer returns the job to the queue** rather than stranding it.
 *   * **Organization isolation** on submission, dispatch and cancellation.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

/** The header this suite's application trusts a proxy to forward a certificate in. */
const HEADER = "x-ouro-client-cert";

/** How far the gateway's clock is moved ahead of the real one. */
const clock = { offset: 0 };

/** Every clock-driven step moves this far past a runner going offline and its resume window. */
const LOST = PRESENCE_THRESHOLD_MS + LOST_RUNNER_AFTER_MS + 5_000;

/** The commit every build here is of. */
const COMMIT = "9e7bd4034c1f1b2a6d8e0f5c7a9b3d1e2f4a6c80";

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
  readonly certificate: string;
}

/** What a pool is created with. */
interface PoolShape {
  readonly executor?: "container" | "shell";
  readonly maxConcurrency?: number;
  readonly defaultCommand?: string | null;
  readonly enabled?: boolean;
}

/** A `build_jobs` row, as the suite reads it back. */
interface JobRow {
  id: string;
  number: number;
  status: string;
  runner_id: string | null;
  retry_of: string | null;
  exit_code: number | null;
  finished_at: Date | null;
}

describe("build dispatch", () => {
  let api: ApiHarness;
  const agents: FakeAgent[] = [];
  const completed: JobCompleted[] = [];

  beforeAll(async () => {
    api = await ApiHarness.start({ OURO_FARM_CLIENT_CERT_HEADER: HEADER }, [
      { provide: GATEWAY_CLOCK, useValue: () => new Date(Date.now() + clock.offset) },
    ]);
    api.nest.get(JobCompletions).subscribe((event) => {
      completed.push(event);
    });
  });

  afterAll(() => api.close());

  afterEach(async () => {
    for (const agent of agents.splice(0)) agent.drop();
    clock.offset = 0;
    completed.splice(0);
    await api.truncate();
  });

  /** The dispatcher, for a suite that drives its tick rather than waiting for it. */
  function dispatcher(): DispatchService {
    return api.nest.get(DispatchService);
  }

  /** A workspace with pool-a and a mirrored repository. */
  async function farm(shape: PoolShape = {}): Promise<Farm> {
    const owner = await api.signIn();
    const workspace = await api.workspace(owner);
    const executor = shape.executor ?? "container";

    const { rows: pools } = await api.sql.query<{ id: string }>(
      `insert into ouroboros.runner_pools
         (organization_id, name, executor, image, max_concurrency, default_command, enabled)
       values ($1, 'pool-a', $2, $3, $4, $5, $6) returning id`,
      [
        workspace.id,
        executor,
        executor === "container" ? "img:0.17" : null,
        shape.maxConcurrency ?? 1,
        shape.defaultCommand === undefined ? "make all" : shape.defaultCommand,
        shape.enabled ?? true,
      ],
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

  /** Enrol a machine into pool-a through the real routes. */
  async function enrol(context: Farm, name: string): Promise<Enrolled> {
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

    return { runnerId: enrollment.runnerId, certificate: enrollment.certificate as string };
  }

  /** Connect an enrolled runner and say hello, with the capabilities a case gives it. */
  async function connect(
    runner: Enrolled,
    capabilities: { docker?: boolean; shell?: boolean } = {},
  ): Promise<FakeAgent> {
    const agent = await FakeAgent.connect(api.baseUrl, {
      certificate: runner.certificate,
      header: HEADER,
    });
    if (isRefused(agent)) throw new Error(`refused: ${String(agent.status)} ${agent.code}`);
    agents.push(agent);

    const hello = fixtureFrame("valid/hello.json");
    Object.assign(hello.payload.capabilities as object, capabilities);
    agent.send(hello);
    await agent.next("ack");

    return agent;
  }

  /** Submit a build as the workspace's owner. */
  async function submit(
    context: Farm,
    body: Record<string, unknown> = {},
    person: Person = context.owner,
    expected = 201,
  ) {
    return api
      .as(person)("post", "/api/v1/farm/jobs")
      .set(TENANT_HEADER, context.workspace.id)
      .send({
        pool: "pool-a",
        repository: "acme-robotics/helios-firmware",
        ref: "refs/heads/main",
        commit: COMMIT,
        ...body,
      })
      .expect(expected);
  }

  /** Submit, and read the job back. */
  async function submitted(
    context: Farm,
    body: Record<string, unknown> = {},
  ): Promise<BuildJobResource> {
    return bodyOf<BuildJobResource>(await submit(context, body));
  }

  /** Cancel a build. */
  function cancel(context: Farm, jobId: string, person: Person = context.owner) {
    return api
      .as(person)("post", `/api/v1/farm/jobs/${jobId}/cancel`)
      .set(TENANT_HEADER, context.workspace.id);
  }

  /** An agent's answer to an offer, built from the golden frame of its type. */
  function answer(
    type: "job.accept" | "job.decline" | "job.start" | "job.finish",
    offer: Envelope<"job.offer">,
    payload: Record<string, unknown> = {},
  ): object {
    const fixture = {
      "job.accept": "valid/job-accept.json",
      "job.decline": "valid/job-decline.json",
      "job.start": "valid/job-start.json",
      "job.finish": "valid/job-finish.json",
    }[type];
    const value = fixtureFrame(fixture);
    const at = new Date().toISOString();

    value.id = newUlid();
    Object.assign(value.payload, { job: offer.payload.job });
    if (type === "job.accept" || type === "job.decline") value.payload.offer = offer.id;
    if (type === "job.decline") Object.assign(value.payload, { reason: "busy", detail: "full up" });
    if (type === "job.start") {
      Object.assign(value.payload, {
        attempt: offer.payload.attempt ?? 1,
        executor: offer.payload.executor,
        started_at: at,
      });
    }
    if (type === "job.finish") {
      Object.assign(value.payload, {
        attempt: offer.payload.attempt ?? 1,
        started_at: at,
        finished_at: at,
        ccache: null,
      });
    }
    Object.assign(value.payload, payload);

    return value;
  }

  /** Accept and start an offer, as an agent that took it does, and wait until it is running. */
  async function run(agent: FakeAgent, offer: Envelope<"job.offer">): Promise<void> {
    agent.send(answer("job.accept", offer));
    agent.send(answer("job.start", offer));
    await eventually(
      () => jobRow(uuidOf("job", offer.payload.job) as string),
      (row) => row.status === "running",
    );
  }

  /** Finish an offer's job with an outcome, and wait for the receipt. */
  async function finish(
    agent: FakeAgent,
    offer: Envelope<"job.offer">,
    outcome: string,
    exitCode: number | null,
  ): Promise<void> {
    agent.send(
      answer("job.finish", offer, {
        outcome,
        exit_code: exitCode,
        error:
          outcome === "errored"
            ? { code: "image.pull_failed", detail: "the registry answered 503" }
            : null,
      }),
    );
    await agent.next("receipt");
  }

  /** A job's row. */
  async function jobRow(id: string): Promise<JobRow> {
    const { rows } = await api.sql.query<JobRow>(
      `select id, number, status, runner_id, retry_of, exit_code, finished_at
         from ouroboros.build_jobs where id = $1`,
      [id],
    );

    return rows[0];
  }

  /** Every job of a workspace, oldest number first. */
  async function jobs(context: Farm): Promise<JobRow[]> {
    const { rows } = await api.sql.query<JobRow>(
      `select id, number, status, runner_id, retry_of, exit_code, finished_at
         from ouroboros.build_jobs where organization_id = $1 order by number`,
      [context.workspace.id],
    );

    return rows;
  }

  /** The job types an agent received that nobody has read yet. */
  async function offersIn(agent: FakeAgent, ms = 400): Promise<Envelope[]> {
    return (await agent.quiet(ms)).filter((envelope) => envelope.type === "job.offer");
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

  /** Move the gateway's clock past a runner's resume window, and let the sweeps notice. */
  async function loseTime(ms: number = LOST): Promise<void> {
    clock.offset += ms;
    await api.nest.get(PresenceSweeper).sweep();
    await dispatcher().tick();
  }

  describe("submission", () => {
    it("queues a build with the pool's snapshot and default command, numbered in its workspace", async () => {
      const context = await farm();

      const job = await submitted(context);

      expect(job).toMatchObject({
        number: 1,
        status: "queued",
        pool: "pool-a",
        repository: "acme-robotics/helios-firmware",
        ref: "refs/heads/main",
        commit: COMMIT,
        command: ["make", "all"],
        commandLine: "make all",
        executor: "container",
        image: "img:0.17",
        label: "pool-a",
        runnerId: null,
        runId: null,
        retryOf: null,
      });
      expect((await submitted(context, { command: ["sh", "-c", "make test"] })).number).toBe(2);
    });

    it("refuses what it cannot queue — each with its own code", async () => {
      const context = await farm({ defaultCommand: null });

      expect(bodyOf<{ code: string }>(await submit(context, {}, context.owner, 422)).code).toBe(
        "farm_command_required",
      );
      expect(
        bodyOf<{ code: string }>(await submit(context, { pool: "pool-z" }, context.owner, 404))
          .code,
      ).toBe("farm_pool_not_found");
      expect(
        bodyOf<{ code: string }>(
          await submit(
            context,
            { repository: "acme-robotics/nope", command: ["make"] },
            context.owner,
            404,
          ),
        ).code,
      ).toBe("farm_repository_not_found");
      expect(
        bodyOf<{ code: string }>(await submit(context, { command: "make all" }, context.owner, 422))
          .code,
      ).toBe("validation_failed");

      await api.sql.query("update ouroboros.runner_pools set enabled = false where id = $1", [
        context.poolId,
      ]);
      expect(
        bodyOf<{ code: string }>(await submit(context, { command: ["make"] }, context.owner, 409))
          .code,
      ).toBe("farm_pool_disabled");
      expect(await jobs(context)).toEqual([]);
    });

    it("lets a member submit and cancel, and refuses a viewer", async () => {
      const context = await farm();
      const member = await api.signIn();
      const viewer = await api.signIn();
      await api.join(context.workspace.id, member, "member");
      await api.join(context.workspace.id, viewer, "viewer");

      const job = bodyOf<BuildJobResource>(await submit(context, {}, member));
      expect(bodyOf<{ code: string }>(await submit(context, {}, viewer, 403)).code).toBe(
        "forbidden",
      );
      await cancel(context, job.id, viewer).expect(403);
      await cancel(context, job.id, member).expect(200);
    });
  });

  describe("the dispatch matrix", () => {
    it("OFFERS ONLY THE RUNNER THAT CAN TAKE IT — not the docker-less, drained, full, offline or disconnected", async () => {
      const context = await farm({ maxConcurrency: 1 });
      const noDocker = await enrol(context, "anvil-mac");
      const drained = await enrol(context, "bigiron");
      const full = await enrol(context, "forge-01");
      await enrol(context, "forge-03"); // offline: enrolled, never connected
      const disconnected = await enrol(context, "forge-04");
      const eligible = await enrol(context, "forge-02");

      const agentNoDocker = await connect(noDocker, { docker: false });
      const agentDrained = await connect(drained);
      await api.nest.get(RunnerControl).drain(context.workspace.id, drained.runnerId, {
        reason: "operator",
        deadline_ms: 0,
        detail: "maintenance",
      });
      const agentFull = await connect(full);
      await api.sql.query(
        `insert into ouroboros.build_jobs
           (organization_id, number, pool_id, runner_id, github_repo_id, git_ref, commit_sha,
            label, title, executor, image, command, status, offered_at, started_at)
         values ($1, 100, $2, $3, $4, 'refs/heads/main', $5, 'build', 'Already running',
                 'container', 'img:0.17', 'make all', 'running', now(), now())`,
        [context.workspace.id, context.poolId, full.runnerId, context.repoId, COMMIT],
      );
      const agentDisconnected = await connect(disconnected);
      agentDisconnected.drop();
      await new Promise((resolve) => setTimeout(resolve, 200));
      const agentEligible = await connect(eligible);

      const job = await submitted(context);
      const offer = await agentEligible.next("job.offer");

      expect(uuidOf("job", offer.payload.job)).toBe(job.id);
      expect(offer.payload).toMatchObject({
        pool: "pool-a",
        executor: "container",
        image: "img:0.17",
        command: ["make", "all"],
        repository: {
          url: "https://github.com/acme-robotics/helios-firmware.git",
          ref: "refs/heads/main",
          commit: COMMIT,
        },
      });
      expect((await jobRow(job.id)).runner_id).toBe(eligible.runnerId);

      await dispatcher().tick();
      for (const agent of [agentNoDocker, agentDrained, agentFull]) {
        expect(await offersIn(agent)).toEqual([]);
      }
      expect(agentEligible.violations).toEqual([]);
    });

    it("NEVER OFFERS A CONTAINER JOB TO A RUNNER WITHOUT DOCKER — even when it is the only runner", async () => {
      const context = await farm();
      const shellOnly = await connect(await enrol(context, "anvil-mac"), { docker: false });

      const job = await submitted(context);
      await dispatcher().tick();

      expect(await offersIn(shellOnly)).toEqual([]);
      expect(await jobRow(job.id)).toMatchObject({ status: "queued", runner_id: null });

      // A runner with a daemon arriving is what places it.
      const docker = await connect(await enrol(context, "forge-01"));
      expect(uuidOf("job", (await docker.next("job.offer")).payload.job)).toBe(job.id);
    });

    it("offers a shell job to a docker-less runner that runs shell jobs", async () => {
      const context = await farm({ executor: "shell" });
      const mac = await connect(await enrol(context, "anvil-mac"), { docker: false });

      const job = await submitted(context);
      const offer = await mac.next("job.offer");

      expect(uuidOf("job", offer.payload.job)).toBe(job.id);
      expect(offer.payload).not.toHaveProperty("image");
      expect(offer.payload.workdir).toBe("/");
    });
  });

  describe("the lifecycle", () => {
    it("runs an accepted build to success, counting it in the runner's queue until it starts", async () => {
      const context = await farm();
      const runner = await enrol(context, "forge-01");
      const agent = await connect(runner);
      const repository = api.nest.get(DispatchRepository);

      const job = await submitted(context);
      const offer = await agent.next("job.offer");
      expect((await jobRow(job.id)).status).toBe("offered");
      expect(await repository.queueDepth(context.workspace.id, runner.runnerId)).toBe(0);

      agent.send(answer("job.accept", offer));
      await eventually(
        () => repository.queueDepth(context.workspace.id, runner.runnerId),
        (depth) => depth === 1,
      );
      expect(await jobRow(job.id)).toMatchObject({ status: "queued", runner_id: runner.runnerId });

      agent.send(answer("job.start", offer));
      await eventually(
        () => jobRow(job.id),
        (row) => row.status === "running",
      );
      expect(await repository.queueDepth(context.workspace.id, runner.runnerId)).toBe(0);

      await finish(agent, offer, "succeeded", 0);
      expect(await jobRow(job.id)).toMatchObject({ status: "succeeded", exit_code: 0 });
      await eventually(
        () => Promise.resolve(completed),
        (events) => events.length === 1,
      );
      expect(completed).toEqual([
        { organizationId: context.workspace.id, jobId: job.id, status: "succeeded" },
      ]);
    });

    it("FAILS A BUILD THAT EXITED NON-ZERO — failed, never retried", async () => {
      const context = await farm();
      const agent = await connect(await enrol(context, "forge-01"));

      const job = await submitted(context);
      const offer = await agent.next("job.offer");
      await run(agent, offer);
      await finish(agent, offer, "failed", 2);

      expect(await jobs(context)).toEqual([
        expect.objectContaining({ id: job.id, status: "failed", exit_code: 2 }),
      ]);
    });

    it("RETRIES AN INFRASTRUCTURE FAILURE ONCE — the second is terminal", async () => {
      const context = await farm();
      const agent = await connect(await enrol(context, "forge-01"));

      const first = await submitted(context);
      const offer = await agent.next("job.offer");
      await run(agent, offer);
      await finish(agent, offer, "errored", null);

      // The retry is a new job, offered as attempt 2, whose retry_of names the first.
      const retryOffer = await agent.next("job.offer");
      expect(retryOffer.payload.attempt).toBe(2);
      const retryId = uuidOf("job", retryOffer.payload.job) as string;
      expect(await jobRow(retryId)).toMatchObject({ retry_of: first.id, number: 2 });
      expect((await jobRow(first.id)).status).toBe("retried");

      await run(agent, retryOffer);
      await finish(agent, retryOffer, "errored", null);

      expect((await jobs(context)).map((row) => row.status)).toEqual(["retried", "failed"]);
      expect(await offersIn(agent)).toEqual([]);
      await eventually(
        () => Promise.resolve(completed.map((event) => event.status)),
        (statuses) => statuses.length === 2,
      );
      expect(completed.map((event) => event.status)).toEqual(["retried", "failed"]);
    });

    it("A DECLINED OFFER RETURNS TO THE QUEUE and goes to another runner", async () => {
      const context = await farm();
      const first = await connect(await enrol(context, "forge-01"));
      const second = await connect(await enrol(context, "forge-02"));

      const job = await submitted(context);
      const offer = await first.next("job.offer");
      first.send(answer("job.decline", offer));

      const next = await second.next("job.offer");
      expect(next.payload.job).toBe(offer.payload.job);
      expect(next.id).not.toBe(offer.id);
      await eventually(
        () => jobRow(job.id),
        (row) => row.status === "offered" && row.runner_id !== null,
      );
    });

    it("keeps a job declined by the only runner waiting, and offers it again after the cooldown", async () => {
      const context = await farm();
      const agent = await connect(await enrol(context, "forge-01"));

      const job = await submitted(context);
      agent.send(answer("job.decline", await agent.next("job.offer")));
      await eventually(
        () => jobRow(job.id),
        (row) => row.status === "queued" && row.runner_id === null,
      );
      await dispatcher().tick();
      expect(await offersIn(agent)).toEqual([]);

      clock.offset += DECLINE_COOLDOWN_MS + 1_000;
      await dispatcher().tick();

      expect(uuidOf("job", (await agent.next("job.offer")).payload.job)).toBe(job.id);
    });

    it("takes back an offer nobody answered, and tells a runner that accepts it late to stop", async () => {
      const context = await farm();
      const slow = await enrol(context, "forge-01");
      const slowAgent = await connect(slow);
      const fast = await connect(await enrol(context, "forge-02"));

      const job = await submitted(context);
      const offer = await slowAgent.next("job.offer");
      slowAgent.drop();
      clock.offset += OFFER_RECLAIM_MS + 1_000;
      await dispatcher().tick();

      // Re-dispatched to the runner still connected …
      expect((await fast.next("job.offer")).payload.job).toBe(offer.payload.job);
      await eventually(
        () => jobRow(job.id),
        (row) => row.status === "offered" && row.runner_id !== slow.runnerId,
      );

      // … so the slow runner's late accept, from its next connection, is told to stop.
      const back = await connect(slow);
      back.send(answer("job.accept", offer));
      const told = await back.next("job.cancel");

      expect(told.payload).toMatchObject({ job: offer.payload.job, reason: "reassigned" });
      expect(back.violations).toEqual([]);
    });
  });

  describe("lost runners", () => {
    it("A RUNNER LOST MID-JOB → REQUEUE ONCE → A SECOND FAILURE IS TERMINAL", async () => {
      const context = await farm();
      const first = await connect(await enrol(context, "forge-01"));

      const job = await submitted(context);
      const offer = await first.next("job.offer");
      await run(first, offer);
      first.drop();

      await loseTime();

      expect((await jobRow(job.id)).status).toBe("retried");
      const [, retry] = await jobs(context);
      expect(retry).toMatchObject({ status: "queued", runner_id: null, retry_of: job.id });

      // The retry goes to the next runner that can take it, as attempt 2 …
      const second = await connect(await enrol(context, "forge-02"));
      const retryOffer = await second.next("job.offer");
      expect(retryOffer.payload).toMatchObject({ attempt: 2 });
      await run(second, retryOffer);
      second.drop();

      // … and when that runner is lost too, the build fails for good.
      await loseTime();

      expect((await jobs(context)).map((row) => row.status)).toEqual(["retried", "failed"]);
      await eventually(
        () => Promise.resolve(completed.map((event) => event.status)),
        (statuses) => statuses.length === 2,
      );
      expect(completed.map((event) => event.status)).toEqual(["retried", "failed"]);
    });

    it("leaves a job alone while its runner is inside the resume window", async () => {
      const context = await farm();
      const agent = await connect(await enrol(context, "forge-01"));

      const job = await submitted(context);
      await run(agent, await agent.next("job.offer"));
      agent.drop();

      await loseTime(PRESENCE_THRESHOLD_MS + 10_000);

      expect((await jobRow(job.id)).status).toBe("running");
      expect(await jobs(context)).toHaveLength(1);
    });

    it("returns a job a lost runner accepted and never started to the queue — nothing ran, so no retry", async () => {
      const context = await farm();
      const agent = await connect(await enrol(context, "forge-01"));

      const job = await submitted(context);
      agent.send(answer("job.accept", await agent.next("job.offer")));
      await eventually(
        () => jobRow(job.id),
        (row) => row.status === "queued" && row.runner_id !== null,
      );
      agent.drop();

      await loseTime();

      expect(await jobs(context)).toEqual([
        expect.objectContaining({ id: job.id, status: "queued", runner_id: null, retry_of: null }),
      ]);
    });
  });

  describe("cancellation", () => {
    it("CANCELS A RUNNING BUILD AND PROPAGATES IT TO THE AGENT", async () => {
      const context = await farm();
      const agent = await connect(await enrol(context, "forge-01"));

      const job = await submitted(context);
      const offer = await agent.next("job.offer");
      await run(agent, offer);

      const canceled = bodyOf<BuildJobResource>(await cancel(context, job.id).expect(200));
      expect(canceled).toMatchObject({ id: job.id, status: "canceled" });

      const told = await agent.next("job.cancel");
      expect(told.payload).toMatchObject({ job: offer.payload.job, reason: "operator" });

      // The agent stops the build and reports it; the job was already over, so nothing changes.
      await finish(agent, offer, "cancelled", 143);
      expect(await jobRow(job.id)).toMatchObject({ status: "canceled", exit_code: null });
      expect(agent.violations).toEqual([]);
    });

    it("cancels a waiting build without telling any runner, and refuses a finished one", async () => {
      const context = await farm();

      const job = await submitted(context);
      await cancel(context, job.id).expect(200);
      expect((await jobRow(job.id)).status).toBe("canceled");

      const refused = bodyOf<{ code: string; details: { status: string } }>(
        await cancel(context, job.id).expect(409),
      );
      expect(refused).toMatchObject({
        code: "farm_job_not_cancellable",
        details: { status: "canceled" },
      });
    });
  });

  describe("queue depth", () => {
    it("IS ACCURATE UNDER CONCURRENT SUBMISSION AND MATCHES THE AGENT'S q:N", async () => {
      const context = await farm({ maxConcurrency: 3 });
      const runner = await enrol(context, "forge-01");
      const agent = await connect(runner);
      const repository = api.nest.get(DispatchRepository);

      const submissions = await Promise.all(
        Array.from({ length: 6 }, () => submit(context).then((r) => bodyOf<BuildJobResource>(r))),
      );
      expect(new Set(submissions.map((job) => job.number)).size).toBe(6);

      // The agent accepts everything it is offered, and starts nothing.
      const accepted: Envelope<"job.offer">[] = [];
      for (let i = 0; i < 3; i += 1) {
        const offer = await agent.next("job.offer");
        agent.send(answer("job.accept", offer));
        accepted.push(offer);
      }
      await dispatcher().tick();
      expect(await offersIn(agent)).toEqual([]);

      await eventually(
        () => repository.queueDepth(context.workspace.id, runner.runnerId),
        (depth) => depth === 3,
      );
      const statuses = (await jobs(context)).map(
        (row) => `${row.status}:${String(row.runner_id !== null)}`,
      );
      expect(statuses.filter((s) => s === "queued:true")).toHaveLength(3);
      expect(statuses.filter((s) => s === "queued:false")).toHaveLength(3);

      // The agent's own count, as its heartbeat reports it, is the server's.
      const beat = fixtureFrame("valid/heartbeat.json");
      Object.assign(beat.payload, {
        queue_depth: accepted.length,
        sent_at: new Date().toISOString(),
      });
      agent.send(beat);
      const telemetry = await eventually(
        async () =>
          (
            await api.sql.query<{ telemetry: { queue_depth?: number } }>(
              "select telemetry from ouroboros.runners where id = $1",
              [runner.runnerId],
            )
          ).rows[0].telemetry,
        (snapshot) => snapshot.queue_depth === 3,
      );
      expect(telemetry.queue_depth).toBe(
        await repository.queueDepth(context.workspace.id, runner.runnerId),
      );

      // Starting one moves it out of the queue; finishing it makes room for the fourth.
      agent.send(answer("job.start", accepted[0]));
      await eventually(
        () => repository.queueDepth(context.workspace.id, runner.runnerId),
        (depth) => depth === 2,
      );
      await finish(agent, accepted[0], "succeeded", 0);
      await agent.next("job.offer");
    });

    it("never lets two placements over-fill one runner — capacity is decided under its lock", async () => {
      const context = await farm({ maxConcurrency: 2 });
      const runner = await enrol(context, "forge-01");
      // Live in the database, connected nowhere — so only this suite places onto it.
      await api.sql.query(
        `update ouroboros.runners
            set status = 'online', last_seen_at = now(),
                capabilities = '{"executors": ["container"], "docker": true}'
          where id = $1`,
        [runner.runnerId],
      );
      const waiting = await Promise.all(Array.from({ length: 5 }, () => submitted(context)));
      const repository = api.nest.get(DispatchRepository);

      const placements = await Promise.all(
        waiting.map((job) =>
          repository.place(
            {
              id: job.id,
              organization_id: context.workspace.id,
              pool_id: context.poolId,
              executor: "container",
              command: "make all",
              commit_sha: COMMIT,
            },
            runner.runnerId,
            new Date(),
          ),
        ),
      );

      expect(placements.filter((placement) => placement.kind === "placed")).toHaveLength(2);
      expect(
        placements.filter((placement) => placement.kind === "runner_unavailable"),
      ).toHaveLength(3);
    });
  });

  describe("organization isolation", () => {
    it("holds on submission, dispatch and cancellation", async () => {
      const mine = await farm();
      const theirs = await farm();
      const theirSecret = await api.sql.query<{ id: string }>(
        `insert into ouroboros.github_repos (org_id, name, enabled)
         select id, 'secret-firmware', true from ouroboros.github_orgs where organization_id = $1
         returning id`,
        [theirs.workspace.id],
      );
      expect(theirSecret.rows).toHaveLength(1);
      const theirAgent = await connect(await enrol(theirs, "forge-01"));

      // Submission: my pool-a is mine, and their repository is not one I can name.
      const job = await submitted(mine);
      expect(
        bodyOf<{ code: string }>(
          await submit(mine, { repository: "acme-robotics/secret-firmware" }, mine.owner, 404),
        ).code,
      ).toBe("farm_repository_not_found");

      // Dispatch: their runner, in a pool of the same name, is never offered my build.
      await dispatcher().tick();
      expect(await offersIn(theirAgent)).toEqual([]);
      expect(await jobRow(job.id)).toMatchObject({ status: "queued", runner_id: null });

      // Cancellation: my job is not theirs to cancel — the same 404 as a job that does not exist.
      const refused = bodyOf<{ code: string }>(
        await cancel(theirs, job.id, theirs.owner).expect(404),
      );
      expect(refused.code).toBe("farm_job_not_found");
      expect((await jobRow(job.id)).status).toBe("queued");
    });
  });
});
