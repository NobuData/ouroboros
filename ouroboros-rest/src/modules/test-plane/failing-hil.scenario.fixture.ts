/**
 * The `failing-HIL` scenario, played on the REST integration harness (AT.6,
 * [#334](https://github.com/NobuData/ouroboros/issues/334)).
 *
 * ```
 * open run (simulator, /internal/runs) ─ implement(1) active
 *   Build 1 ─ submitForRun ─▶ job.offer ─▶ runner accepts ─▶ POST /farm/jobs/:id/artifacts ─▶ 49/63
 *   Build 2 ─ …same path…                                                                   ─▶ 61/63
 *   person  ─ POST /test-runs/:build2/cases/:overshoot/classify {product_bug, note}  ─▶ correction round
 *   executor ─ /controls/fetch (steer = note, retryStage) ─ ack ─ implement(1) failed ─ implement(2) active
 *   Build 3 ─ …same path…                                                                   ─▶ 63/63
 * ```
 *
 * **Every result arrives through AT.2's path** (#330): the runner is enrolled through the real
 * routes, connected over the real gateway, handed each build in a `job.offer`, and uploads with
 * that offer's single-use token over HTTP. Nothing here writes a test result, a case or an
 * artifact to the database; the only direct statement is the rig pool, which has no route yet.
 *
 * **One seam stands in for AJ.3** ([#265](https://github.com/NobuData/ouroboros/issues/265)):
 * a loop's build stage submitting its build, which is `FarmJobsService.submitForRun` — defined
 * and not yet wired to a route. The scenario calls it exactly as that stage will, the way the
 * upload suite does. The run itself is opened and moved over the internal channel as the
 * simulated driver (`ouroboros_simulator`) does, and the person's half goes through the public API.
 *
 * `test-plane.integration-spec.ts` replays it; AU.8's e2e leg (#342) follows the same script
 * once AJ.3 lets a live runner receive a run's build.
 */

import { ApiHarness, type Person } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import type { ControlsFetchedResource } from "../controls/controls.resources";
import { SCHEMA_NAME } from "../db/schema";
import { INTERNAL_KEY_HEADER } from "../engine/engine.contract";
import { uploadBody } from "../farm/artifacts/upload.fixture";
import type { UploadReceipt } from "../farm/artifacts/upload.service";
import { FarmJobsService } from "../farm/dispatch/jobs.service";
import { certificationRequest } from "../farm/farm.fixture";
import type { EnrollmentResource, MintedTokenResource } from "../farm/farm.resources";
import { FakeAgent, isRefused } from "../farm/gateway/fake.agent.fixture";
import { fixtureFrame } from "../farm/gateway/gateway.fixture";
import { seedIngestBench, type IngestBench } from "../ingest/ingest.fixture";
import type { RunOpenedResource } from "../ingest/ingest.resources";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import type { TestRunPageResource } from "../test-results-read/results.resources";
import type { ClassifyResultResource } from "../triage/triage.resources";
import {
  BUILDS,
  CORRECTION_NOTE,
  OVERSHOOT_CASE,
  RIG,
  buildFiles,
  commitOf,
  expectedCounts,
  type BuildPlan,
} from "./failing-hil.fixture";

/** The header the scenario's application trusts a proxy to forward a client certificate in. */
export const CLIENT_CERT_HEADER = "x-ouro-client-cert";

/** The simulated driver's credential. */
export const SIMULATOR_SECRET = "integration-run-simulator-secret";

/** The rig pool the builds run on. */
export const RIG_POOL = "rig-pool";

/** The branch the loop works on — mockup 11's `loop/482-canbus-flake`. */
export const BRANCH = "loop/482-canbus-flake";

/**
 * The environment an application needs to play the scenario.
 *
 * @param artifactDir - A scratch directory for the local artifact store.
 * @returns The `ApiHarness.start` overrides.
 */
export function scenarioEnvironment(artifactDir: string): NodeJS.ProcessEnv {
  return {
    OURO_FARM_CLIENT_CERT_HEADER: CLIENT_CERT_HEADER,
    OURO_RUN_SIMULATOR_SECRET: SIMULATOR_SECRET,
    // No sweep may expire the steer between the classification and the executor's fetch.
    OURO_RUN_CONTROL_SWEEP_SECONDS: "3600",
    OURO_ARTIFACT_STORE: "local",
    OURO_ARTIFACT_DIR: artifactDir,
  };
}

/** One build as the scenario played it. */
export interface PlayedBuild {
  readonly plan: BuildPlan;
  readonly jobId: string;
  /** The attempt the upload's parse wrote. */
  readonly testRunId: string;
  readonly receipt: UploadReceipt;
}

/** Everything a suite may ask of a played scenario. */
export interface FailingHilPlay {
  readonly owner: Person;
  readonly bench: IngestBench;
  readonly run: RunOpenedResource;
  readonly runnerId: string;
  readonly builds: readonly [PlayedBuild, PlayedBuild, PlayedBuild];
  /** Build 2's overshoot case — the one classified. */
  readonly overshootCaseId: string;
  readonly classification: ClassifyResultResource;
  /** The steer the executor claimed. */
  readonly steer: ControlsFetchedResource["controls"][number];
}

/**
 * Plays the scenario against a started harness. One instance per play; {@link drop} closes the
 * runner's socket.
 */
export class FailingHilScenario {
  private readonly agents: FakeAgent[] = [];
  private transitions = 0;

  /**
   * @param api - A harness started with {@link scenarioEnvironment}.
   */
  constructor(private readonly api: ApiHarness) {}

  /**
   * Play the whole story: two failing builds, the classification, the correction round, and the
   * green build.
   *
   * @returns What was played.
   * @throws {Error} When any step answers other than the contract says — the scenario is a test.
   */
  async play(): Promise<FailingHilPlay> {
    const owner = await this.api.signUp();
    const bench = await seedIngestBench(this.api, owner);
    const run = bodyOf<RunOpenedResource>(
      await this.simulator("post", "/internal/runs", {
        idempotencyKey: "failing-hil-open",
        ...bench.open,
      }).expect(201),
    );

    await this.pool(bench);
    const { agent, runnerId } = await this.runner(owner, bench);

    await this.move(run, { stageKey: "implement", status: "active" });
    const build1 = await this.build(bench, run, agent, 0);
    const build2 = await this.build(bench, run, agent, 1);

    const page = bodyOf<TestRunPageResource>(
      await this.as(owner, bench, "get", `/api/v1/test-runs/${build2.testRunId}`).expect(200),
    );
    const overshoot = page.physical.find((kase) => kase.name === OVERSHOOT_CASE);
    if (overshoot === undefined) throw new Error("Build 2 has no overshoot case");

    const classification = bodyOf<ClassifyResultResource>(
      await this.as(
        owner,
        bench,
        "post",
        `/api/v1/test-runs/${build2.testRunId}/cases/${overshoot.caseId}/classify`,
      )
        .send({ class: "product_bug", note: CORRECTION_NOTE })
        .expect(201),
    );

    // The executor's half, as `ouroboros_simulator` plays it: claim the steer at a safe
    // boundary, acknowledge it naming the attempt it opens, and open that attempt.
    const fetched = bodyOf<ControlsFetchedResource>(
      await this.simulator("post", `/internal/runs/${run.id}/controls/fetch`).expect(200),
    );
    const steer = fetched.controls.find((control) => control.kind === "steer");
    if (steer === undefined) throw new Error("the correction round sent no steer");

    await this.simulator("post", `/internal/runs/${run.id}/controls/${steer.id}/ack`, {
      effect: `correction round queued: implement attempt ${String(classification.routing.targetAttempt)}`,
    }).expect(200);
    await this.move(run, { stageKey: "implement", status: "failed" });
    await this.move(run, {
      stageKey: "implement",
      status: "active",
      attempt: classification.routing.targetAttempt,
    });

    const build3 = await this.build(bench, run, agent, 2);
    await this.move(run, { stageKey: "implement", status: "succeeded" });

    return {
      owner,
      bench,
      run,
      runnerId,
      builds: [build1, build2, build3],
      overshootCaseId: overshoot.caseId,
      classification,
      steer,
    };
  }

  /** Close every socket this play opened. */
  drop(): void {
    for (const agent of this.agents.splice(0)) agent.drop();
  }

  /**
   * A request on the public API as somebody, in the bench's workspace.
   *
   * @param person - Who.
   * @param bench - The workspace.
   * @param method - The verb.
   * @param path - The path.
   * @returns The Supertest request.
   */
  as(person: Person, bench: IngestBench, method: "get" | "post", path: string) {
    return this.api.as(person)(method, path).set(TENANT_HEADER, bench.workspace.slug);
  }

  /**
   * A request on the internal channel as the simulated driver.
   *
   * @param method - The verb.
   * @param path - The path.
   * @param body - The body.
   * @returns The Supertest request.
   */
  private simulator(method: "post", path: string, body: object = {}) {
    return this.api.anonymous(method, path).set(INTERNAL_KEY_HEADER, SIMULATOR_SECRET).send(body);
  }

  /**
   * Report a stage transition, each with its own idempotency key.
   *
   * @param run - The run.
   * @param body - The transition.
   */
  private async move(run: RunOpenedResource, body: Record<string, unknown>): Promise<void> {
    this.transitions += 1;
    await this.simulator("post", `/internal/runs/${run.id}/stage-transitions`, {
      idempotencyKey: `failing-hil-t${String(this.transitions)}`,
      ...body,
    }).expect(200);
  }

  /**
   * The rig pool. Pools have no creation route yet, so this is the scenario's one direct write.
   *
   * @param bench - The workspace.
   */
  private async pool(bench: IngestBench): Promise<void> {
    await this.api.sql.query(
      `insert into ${SCHEMA_NAME}.runner_pools
         (organization_id, name, executor, default_command, max_concurrency)
       values ($1, $2, 'shell', 'west twister', 3)`,
      [bench.workspace.id, RIG_POOL],
    );
  }

  /**
   * Enrol the rig's runner through the real routes, connect it, and say hello.
   *
   * @param owner - Who mints the enrolment token.
   * @param bench - The workspace.
   * @returns The connected agent and the runner's id.
   */
  private async runner(
    owner: Person,
    bench: IngestBench,
  ): Promise<{ agent: FakeAgent; runnerId: string }> {
    const minted = bodyOf<MintedTokenResource>(
      await this.as(owner, bench, "post", "/api/v1/farm/enrollment-tokens")
        .send({ pool: RIG_POOL })
        .expect(201),
    );
    const enrollment = bodyOf<EnrollmentResource>(
      await this.api
        .anonymous("post", "/api/v1/farm/registrations")
        .send({ token: minted.token, name: RIG, arch: "linux/arm64", csr: certificationRequest() })
        .expect(201),
    );

    const agent = await FakeAgent.connect(this.api.baseUrl, {
      certificate: enrollment.certificate as string,
      header: CLIENT_CERT_HEADER,
    });
    if (isRefused(agent)) throw new Error(`refused: ${String(agent.status)} ${agent.code}`);
    this.agents.push(agent);

    const hello = fixtureFrame("valid/hello.json");
    Object.assign(hello.payload.capabilities as object, { docker: false, shell: true });
    agent.send(hello);
    await agent.next("ack");

    return { agent, runnerId: enrollment.runnerId };
  }

  /**
   * One build: submitted for the run, offered to the rig, accepted, started, uploaded with the
   * offer's token, and finished with the exit code its results imply.
   *
   * @param bench - The workspace.
   * @param run - The run.
   * @param agent - The rig's agent.
   * @param index - The build's position in {@link BUILDS}.
   * @returns What was played.
   */
  private async build(
    bench: IngestBench,
    run: RunOpenedResource,
    agent: FakeAgent,
    index: number,
  ): Promise<PlayedBuild> {
    const plan = BUILDS[index];
    const job = await this.api.nest.get(FarmJobsService).submitForRun(bench.workspace.id, run.id, {
      pool: RIG_POOL,
      repository: `${bench.workspace.slug}/helios-firmware`,
      ref: `refs/heads/${BRANCH}`,
      commit: commitOf(plan),
    });

    const offer = await agent.next("job.offer");
    const upload = offer.payload.upload;
    if (!upload?.path.includes(job.id)) {
      throw new Error(`${plan.label}'s offer carried no upload for job ${job.id}`);
    }
    agent.accept(offer);
    agent.start(offer);

    const body = uploadBody(buildFiles(plan, index));
    const receipt = bodyOf<UploadReceipt>(
      await this.api
        .anonymous("post", upload.path)
        .set("authorization", `Bearer ${upload.token}`)
        .set("content-type", body.contentType)
        .send(body.body)
        .expect(201),
    );

    const failed = expectedCounts(plan).failed > 0;
    await agent.finish(offer, failed ? "failed" : "succeeded", { exitCode: failed ? 1 : 0 });

    return { plan, jobId: job.id, testRunId: receipt.testRun, receipt };
  }
}
