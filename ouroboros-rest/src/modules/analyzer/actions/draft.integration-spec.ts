import { Logger } from "@nestjs/common";

import {
  estimateAnswer,
  startEngineStub,
  type EngineStub,
} from "../../../testing/engine.stub.fixture";
import { ApiHarness, type Person, type Workspace } from "../../../testing/harness.fixture";
import { bodyOf } from "../../../testing/integration.fixture";
import { SCHEMA_NAME } from "../../db/schema";
import { EstimationOrchestrator } from "../../estimation/estimation.orchestrator";
import { OCTOKIT_FACTORY } from "../../github/github.client.factory";
import type { BatchResource } from "../../planning/planning.resources";
import type { PushReport } from "../../planning/push.service";
import { seedRoutingBench } from "../../routing/workspace.fixture";
import { TENANT_HEADER } from "../../tenancy/tenant.resolver";
import {
  SOURCE_CONFIG,
  SOURCE_TOKEN,
  recordingFactory,
} from "../../ticket-sources/providers/github.provider.fixture";
import {
  writeRecording,
  type WriteRecording,
} from "../../ticket-sources/providers/github.write-recordings.fixture";
import { VaultService } from "../../vault/vault.service";
import { analyze, seedSeededIdsWorkspace, suggestionId } from "../analyzer.integration.fixture";
import type { DraftedBatch } from "./actions.service";

/**
 * Drafted tickets, end to end (BV.5 #514, covered by BV.6 #515): ticket and spike suggestions
 * drafted into an ordinary AK batch with `analyzer-v1` provenance, sized by the application's own
 * estimator so the card's total is real, and pushed through AL.3 to the sandbox tracker — a recorded
 * GitHub behind the real provider — **idempotently**: a retried push files nothing twice.
 *
 * ```bash
 * yarn test:integration src/modules/analyzer/actions/draft
 * ```
 */

/** What the estimator answers for every draft — one size, so the total is plain arithmetic. */
const EST_MINUTES = 23;

describe("drafting and pushing the analyzer's tickets", () => {
  let api: ApiHarness;
  let engine: EngineStub;
  let github: WriteRecording;
  let owner: Person;
  let workspace: Workspace;
  let sourceId: string;

  beforeAll(async () => {
    engine = await startEngineStub();
    github = writeRecording();
    api = await ApiHarness.start(
      {
        OURO_ENGINE_URL: engine.url,
        OURO_BACKLOG_SYNC_INTERVAL_SECONDS: "86400",
        OURO_ESTIMATION_SWEEP_INTERVAL_SECONDS: "86400",
      },
      [{ provide: OCTOKIT_FACTORY, useValue: recordingFactory(github.octokit).factory }],
    );
  });

  afterAll(async () => {
    await api.close();
    await engine.stop();
  });

  beforeEach(async () => {
    engine.reset();
    engine.respond(() => estimateAnswer({ effort: "s" }));
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);

    owner = await api.signIn();
    const bench = await seedRoutingBench(api, owner);
    workspace = { id: bench.id, slug: bench.slug, name: bench.slug };
    await seedSeededIdsWorkspace(api, workspace);
    await analyze(api, workspace);

    const { rows } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.ticket_sources (organization_id, kind, display_name, config)
       values ($1, 'github', 'GitHub · acme-robotics', $2::jsonb) returning id`,
      [workspace.id, JSON.stringify(SOURCE_CONFIG)],
    );
    sourceId = rows[0].id;
    const sealed = await api.nest
      .get(VaultService)
      .encryptText(workspace.id, sourceId, SOURCE_TOKEN);
    await api.sql.query(
      `update ${SCHEMA_NAME}.ticket_sources set credentials_encrypted = $2 where id = $1`,
      [sourceId, sealed],
    );
  });

  afterEach(() => api.truncate());

  /** A request as the owner, in the workspace. */
  function call(method: "get" | "post", path: string) {
    return api.as(owner)(method, path).set(TENANT_HEADER, workspace.slug);
  }

  it("drafts an analyzer-v1 batch, sizes it for real, and pushes it once however often it is pushed", async () => {
    const tickets = [
      await suggestionId(api, workspace, "Refactor tests/"),
      await suggestionId(api, workspace, "Bump ccache"),
      await suggestionId(api, workspace, "Link "),
    ];

    const drafted = bodyOf<DraftedBatch>(
      await call("post", "/api/v1/analyzer/suggestions/draft")
        .send({ suggestionIds: tickets, targetSourceId: sourceId })
        .expect(201),
    );

    expect(drafted.suggestionIds).toEqual(tickets);
    expect(drafted.batch.planner).toBe("analyzer-v1");
    expect(drafted.batch.drafts.map((draft) => draft.localKey)).toEqual(["BA-1", "BA-2", "BA-3"]);
    expect(drafted.batch.drafts[0].body).toContain("**Evidence:**");
    expect(drafted.batch.drafts[0].body).toContain("- runner_pool `");
    // The spike drafts an investigation, stating the uncertainty rather than an estimate.
    expect(drafted.batch.drafts[2].title).toMatch(/^Spike: Link /);
    expect(drafted.batch.drafts[2].body).toContain("asserts no impact");

    // Sized through the one estimator — so the card's total is the real sum.
    await api.nest.get(EstimationOrchestrator).settled();
    const sized = bodyOf<BatchResource>(
      await call("get", `/api/v1/planning/batches/${drafted.batch.id}`).expect(200),
    );
    expect(sized.status).toBe("sized");
    expect(sized.summary).toMatchObject({ allSized: true, estMinutes: 3 * EST_MINUTES });

    // Pushed to the sandbox tracker…
    const filedBefore = github.issues.length;
    const first = bodyOf<PushReport>(
      await call("post", `/api/v1/analyzer/batches/${drafted.batch.id}/push`).expect(200),
    );
    expect(first).toMatchObject({ outcome: "pushed", pushedThisRun: 3 });
    expect(github.issues.length).toBe(filedBefore + 3);

    // …and a retried push files nothing twice: AL.3 refuses a batch it has already pushed.
    const again = await call("post", `/api/v1/analyzer/batches/${drafted.batch.id}/push`).expect(
      409,
    );
    expect(bodyOf<{ code: string }>(again).code).toBe("batch_not_pushable");
    expect(github.issues.length).toBe(filedBefore + 3);

    const { rows } = await api.sql.query<{ status: string }>(
      `select status from ${SCHEMA_NAME}.analysis_suggestions where id = any($1::uuid[])`,
      [tickets],
    );
    expect(rows.map((row) => row.status)).toEqual(["drafted", "drafted", "drafted"]);
  });
});
