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
import type { DraftedBatch } from "../actions/actions.service";
import {
  analyze,
  BENCH_REPO,
  seedSeededIdsWorkspace,
  suggestionId,
} from "../analyzer.integration.fixture";
import { POOL_A_ID } from "../composer/composer.seed.fixture";
import type { TicketsResource } from "./tickets.resources";

/**
 * The drafted-tickets card's read against a migrated database (BW.4,
 * [#519](https://github.com/NobuData/ouroboros/issues/519)).
 *
 * What only real rows can prove: that a ticket suggestion is **un-drafted until it is drafted and
 * in its batch after**; that the batch is planning's own — its checkbox, its estimator-summed
 * footer, its push states — so what the planning page changes is what this read answers; that a
 * draft's evidence is read from its **body as it stands**; that a batch and a suggestion leave the
 * card by the suggestion cards' currency rule and no sooner; and that regenerating an
 * analyzer-drafted batch, which would replace its drafts, is refused.
 *
 * ```bash
 * env -u OURO_DATABASE_URL yarn test:integration src/modules/analyzer/tickets
 * ```
 */

/** The bench's three ticket suggestions (a waiver cite needs a loop plane no bench builds). */
const TITLES = {
  ota: "Refactor tests/",
  ccache: "Bump ccache",
  kconfig: "Delete ",
} as const;

/** What the estimator answers for every draft — one size, so the total is plain arithmetic. */
const EST_MINUTES = 23;

/** The analyzers the bench's ticket suggestions cite. */
const TICKET_ANALYZERS = ["log_signature", "config_usage"];

describe("the drafted-tickets card read", () => {
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

  afterEach(async () => {
    // A draft is sized in the background; a truncate under a sizing still in flight can deadlock.
    await api.nest.get(EstimationOrchestrator).settled();
    await api.truncate();
  });

  /** A request as somebody, in the bench workspace. */
  function as(person: Person, method: "get" | "post" | "patch", path: string) {
    return api.as(person)(method, path).set(TENANT_HEADER, workspace.slug);
  }

  /** The read, as the owner. */
  async function read(): Promise<TicketsResource> {
    return bodyOf<TicketsResource>(
      await as(owner, "get", `/api/v1/analyzer/tickets?repo=${BENCH_REPO}`).expect(200),
    );
  }

  /**
   * Draft ticket suggestions into a batch, as **Draft N tickets** does.
   *
   * @param prefixes - The start of each suggestion's title, in batch order.
   * @returns The batch as the draft answered it.
   */
  async function draft(...prefixes: string[]): Promise<BatchResource> {
    const suggestionIds = await Promise.all(
      prefixes.map((prefix) => suggestionId(api, workspace, prefix)),
    );
    const drafted = bodyOf<DraftedBatch>(
      await as(owner, "post", "/api/v1/analyzer/suggestions/draft")
        .send({ suggestionIds, targetSourceId: sourceId })
        .expect(201),
    );

    return drafted.batch;
  }

  it("answers nothing before an analysis has ended with suggestions — a failed run is not one", async () => {
    const empty = { repo: BENCH_REPO, undrafted: [], batches: [] };

    expect(await read()).toEqual(empty);

    await analyze(api, workspace);

    expect(await read()).toEqual(empty);
  });

  it("lists an analysis's open ticket suggestions as un-drafted, with what their drafts will carry", async () => {
    await analyze(api, workspace, [], { ending: "complete" });

    const body = await read();

    expect(body.batches).toEqual([]);
    expect(body.undrafted.map((entry) => entry.title.slice(0, 12))).toEqual(
      expect.arrayContaining(["Refactor tes", "Bump ccache "]),
    );
    expect(body.undrafted).toHaveLength(3);
    // Most confident first.
    const confidences = body.undrafted.map((entry) => entry.confidence);
    expect(confidences).toEqual([...confidences].sort((a, b) => b - a));

    for (const entry of body.undrafted) {
      expect(entry.evidenceLine).not.toBe("");
      // Each cited finding carries the same reference; a draft lists it once.
      expect(entry.evidenceTotal).toBe(1);
      expect(entry.evidence).toEqual([
        expect.objectContaining({
          kind: "runner_pool",
          id: POOL_A_ID,
          label: "pool-a",
          surface: "farm",
        }),
      ]);
    }
    // Never a card suggestion: those are the suggestion cards'.
    expect(body.undrafted.map((entry) => entry.title).join(" ")).not.toContain("forge-02");
  });

  it("moves a drafted suggestion into its batch, sized for real, with its evidence read from the body", async () => {
    await analyze(api, workspace, [], { ending: "complete" });
    const before = await read();
    const lineOf = (prefix: string) =>
      before.undrafted.find((entry) => entry.title.startsWith(prefix))?.evidenceLine;

    const batch = await draft(TITLES.ccache, TITLES.ota);
    await api.nest.get(EstimationOrchestrator).settled();

    const body = await read();

    // What was drafted is no longer un-drafted; what was not, still is.
    expect(body.undrafted.map((entry) => entry.title.slice(0, 7))).toEqual(["Delete "]);
    expect(body.batches).toHaveLength(1);

    const [card] = body.batches;

    expect(card.batch).toMatchObject({
      id: batch.id,
      planner: "analyzer-v1",
      status: "sized",
      targetSourceId: sourceId,
      summary: { draftCount: 2, selectedCount: 2, allSized: true, estMinutes: 2 * EST_MINUTES },
    });
    // The batch is exactly planning's own answer.
    expect(card.batch).toEqual(
      bodyOf<BatchResource>(
        await as(owner, "get", `/api/v1/planning/batches/${batch.id}`).expect(200),
      ),
    );
    // In the order drafted, each with the line its suggestion composed — out of the body.
    expect(card.drafts).toEqual([
      {
        localKey: "BA-1",
        evidenceLine: lineOf(TITLES.ccache),
        evidence: [
          expect.objectContaining({ kind: "runner_pool", label: "pool-a", surface: "farm" }),
        ],
        evidenceTotal: 1,
      },
      {
        localKey: "BA-2",
        evidenceLine: lineOf(TITLES.ota),
        evidence: [
          expect.objectContaining({ kind: "runner_pool", label: "pool-a", surface: "farm" }),
        ],
        evidenceTotal: 1,
      },
    ]);
    expect(card.batch.drafts.map((entry) => entry.estimate?.effort)).toEqual(["s", "s"]);
  });

  it("answers what the planning page changed: a deselected draft, an edited title, a rewritten body", async () => {
    await analyze(api, workspace, [], { ending: "complete" });
    const batch = await draft(TITLES.ota, TITLES.ccache, TITLES.kconfig);
    await api.nest.get(EstimationOrchestrator).settled();
    const drafts = `/api/v1/planning/batches/${batch.id}/drafts`;
    const kept = batch.drafts[1].body ?? "";

    await as(owner, "patch", `${drafts}/BA-1`).send({ selected: false }).expect(200);
    await as(owner, "patch", `${drafts}/BA-2`)
      .send({ title: "Bump ccache to 4.11", body: `Seen again on the 9th.\n\n${kept}` })
      .expect(200);
    await as(owner, "patch", `${drafts}/BA-3`)
      .send({ body: "Rewritten by hand — see the incident doc." })
      .expect(200);

    const [card] = (await read()).batches;

    expect(card.batch.drafts.map((entry) => [entry.localKey, entry.selected, entry.title])).toEqual(
      [
        ["BA-1", false, batch.drafts[0].title],
        ["BA-2", true, "Bump ccache to 4.11"],
        ["BA-3", true, batch.drafts[2].title],
      ],
    );
    // The footer is the estimator's sum over what is still selected.
    expect(card.batch.summary).toMatchObject({ selectedCount: 2, estMinutes: 2 * EST_MINUTES });
    // An edit that kept the evidence keeps it; one that rewrote the body has none to show.
    expect(card.drafts[1]).toMatchObject({ evidenceTotal: 1 });
    expect(card.drafts[1].evidenceLine).not.toBeNull();
    expect(card.drafts[2]).toEqual({
      localKey: "BA-3",
      evidenceLine: null,
      evidence: [],
      evidenceTotal: 0,
    });
  });

  it("never sends a reference somebody typed to a typed lookup", async () => {
    await analyze(api, workspace, [], { ending: "complete" });
    const batch = await draft(TITLES.ota);
    const body = [
      "**Evidence:** typed by hand",
      "",
      "**References:**",
      "- build `not-a-uuid`",
      "- merge `zzzzzzz`",
      `- runner_pool \`${POOL_A_ID}\``,
      "- runner_pool `00000000-0000-4000-8000-000000000000`",
    ].join("\n");

    await as(owner, "patch", `/api/v1/planning/batches/${batch.id}/drafts/BA-1`)
      .send({ body })
      .expect(200);

    const [card] = (await read()).batches;

    // The two malformed lines are prose; the well-formed one that names nothing opens nothing.
    expect(card.drafts[0]).toMatchObject({ evidenceLine: "typed by hand", evidenceTotal: 2 });
    expect(card.drafts[0].evidence.map((ref) => [ref.label, ref.surface])).toEqual([
      ["pool-a", "farm"],
      [null, null],
    ]);
  });

  it("holds a batch per draft action, newest first", async () => {
    await analyze(api, workspace, [], { ending: "complete" });
    const first = await draft(TITLES.ota);
    // `created_at` is the statement's clock; a second batch in the same millisecond would tie.
    await api.sql.query(
      `update ${SCHEMA_NAME}.draft_batches set created_at = created_at - interval '1 hour' where id = $1`,
      [first.id],
    );
    const second = await draft(TITLES.ccache, TITLES.kconfig);

    const body = await read();

    expect(body.undrafted).toEqual([]);
    expect(body.batches.map((entry) => entry.batch.id)).toEqual([second.id, first.id]);
    expect(body.batches.map((entry) => entry.drafts.map((row) => row.localKey))).toEqual([
      ["BA-1", "BA-2"],
      ["BA-1"],
    ]);
  });

  it("leaves a spike's batch to the suggestion cards: this card is the ticket suggestions'", async () => {
    await analyze(api, workspace, [], { ending: "complete" });
    // *Draft spike ticket* on the suggestion cards' spike row (BW.3) makes an analyzer batch too.
    const spike = await draft("Link ");

    expect(spike.drafts.map((entry) => entry.title.slice(0, 6))).toEqual(["Spike:"]);

    const body = await read();

    expect(body.batches).toEqual([]);
    expect(body.undrafted).toHaveLength(3);
  });

  it("answers one repository's tickets, not the workspace's", async () => {
    const other = "acme-robotics/atlas-scheduler";

    await analyze(api, workspace, [], { ending: "complete" });
    const mine = await draft(TITLES.ota);
    await analyze(api, workspace, [], { ending: "complete", repo: other });

    const here = await read();
    const there = bodyOf<TicketsResource>(
      await as(owner, "get", `/api/v1/analyzer/tickets?repo=${other}`).expect(200),
    );

    // The same three patterns were found in both; each repository answers its own.
    expect(here.undrafted).toHaveLength(2);
    expect(here.batches.map((entry) => entry.batch.id)).toEqual([mine.id]);
    expect(there.repo).toBe(other);
    expect(there.undrafted).toHaveLength(3);
    expect(there.batches).toEqual([]);
  });

  describe("what stays on the card", () => {
    it("keeps everything through a run that did not look: in flight, failed, or with its analyzers skipped", async () => {
      await analyze(api, workspace, [], { ending: "complete" });
      const batch = await draft(TITLES.ota);

      await analyze(api, workspace, [], { ending: "failed", only: () => false });
      await analyze(api, workspace, [], {
        ending: "complete",
        only: () => false,
        skipped: TICKET_ANALYZERS,
      });
      await analyze(api, workspace, [], { ending: "running", only: () => false });

      const body = await read();

      expect(body.undrafted).toHaveLength(2);
      expect(body.batches.map((entry) => entry.batch.id)).toEqual([batch.id]);
    });

    it("drops what a later analysis looked for and no longer finds — un-drafted and drafted alike", async () => {
      await analyze(api, workspace, [], { ending: "complete" });
      const batch = await draft(TITLES.ota);

      expect((await read()).batches.map((entry) => entry.batch.id)).toEqual([batch.id]);

      // Every analyzer ran and found nothing.
      await analyze(api, workspace, [], { ending: "complete", only: () => false });

      expect(await read()).toEqual({ repo: BENCH_REPO, undrafted: [], batches: [] });
      // The batch itself is untouched — it is planning's, and still opens there.
      await as(owner, "get", `/api/v1/planning/batches/${batch.id}`).expect(200);
    });

    it("judges each suggestion by its own analyzers: one re-found keeps its batch while the others leave", async () => {
      await analyze(api, workspace, [], { ending: "complete" });
      const batch = await draft(TITLES.kconfig);

      // The log-signature analyzer ran and found nothing; the option analyzer did not look.
      await analyze(api, workspace, [], {
        ending: "complete",
        only: () => false,
        skipped: ["config_usage"],
      });

      const body = await read();

      // The two log-signature tickets are gone; the Kconfig one's batch is still here.
      expect(body.undrafted).toEqual([]);
      expect(body.batches.map((entry) => entry.batch.id)).toEqual([batch.id]);
    });

    it("keeps a batch while any ticket drafted into it is still found", async () => {
      await analyze(api, workspace, [], { ending: "complete" });
      const batch = await draft(TITLES.ota, TITLES.kconfig);

      // Log signatures looked and found nothing: the OTA ticket is no longer current. The option
      // analyzer did not look, so the Kconfig ticket is — and the batch stays, with both drafts.
      await analyze(api, workspace, [], {
        ending: "complete",
        only: () => false,
        skipped: ["config_usage"],
      });

      const [card] = (await read()).batches;

      expect(card.batch.id).toBe(batch.id);
      expect(card.drafts.map((entry) => entry.localKey)).toEqual(["BA-1", "BA-2"]);
    });

    it("still lists a re-found suggestion once — drafted stays drafted, never un-drafted again", async () => {
      await analyze(api, workspace, [], { ending: "complete" });
      const batch = await draft(TITLES.ota);

      await analyze(api, workspace, [], { ending: "complete" });

      const body = await read();

      expect(body.undrafted.map((entry) => entry.title.slice(0, 7)).sort()).toEqual([
        "Bump cc",
        "Delete ",
      ]);
      expect(body.batches.map((entry) => entry.batch.id)).toEqual([batch.id]);
    });
  });

  it("shows a push as it lands: each draft's state and tracker link, and the batch closed", async () => {
    await analyze(api, workspace, [], { ending: "complete" });
    const batch = await draft(TITLES.ota, TITLES.ccache);
    await api.nest.get(EstimationOrchestrator).settled();
    await as(owner, "patch", `/api/v1/planning/batches/${batch.id}/drafts/BA-2`)
      .send({ selected: false })
      .expect(200);

    const filedBefore = github.issues.length;
    const report = bodyOf<PushReport>(
      await as(owner, "post", `/api/v1/analyzer/batches/${batch.id}/push`).expect(200),
    );

    // The deselected draft was not filed: one issue, not two.
    expect(report).toMatchObject({ outcome: "pushed", pushedThisRun: 1 });
    expect(github.issues.length).toBe(filedBefore + 1);

    const [card] = (await read()).batches;

    expect(card.batch.status).toBe("pushed");
    expect(
      card.batch.drafts.map((entry) => [entry.localKey, entry.selected, entry.pushState]),
    ).toEqual([
      ["BA-1", true, "pushed"],
      ["BA-2", false, "pending"],
    ]);
    expect(card.batch.drafts[0].pushedTicket).toMatchObject({
      externalKey: expect.stringMatching(/^#\d+$/) as string,
      url: expect.stringContaining("/issues/") as string,
    });
    // What was filed carries the evidence and its references.
    const filed = github.issues[github.issues.length - 1];
    expect(filed.body).toContain(`**Evidence:** ${card.drafts[0].evidenceLine ?? "<none>"}`);
    expect(filed.body).toContain(`- runner_pool \`${POOL_A_ID}\``);
  });

  it("refuses to regenerate an analyzer-drafted batch, leaving its drafts as composed", async () => {
    await analyze(api, workspace, [], { ending: "complete" });
    const batch = await draft(TITLES.ota, TITLES.ccache);

    const refusal = await as(owner, "post", `/api/v1/planning/batches/${batch.id}/regenerate`)
      .send({})
      .expect(409);

    expect(bodyOf<{ code: string }>(refusal).code).toBe("batch_not_regenerable");
    // No planner was asked.
    expect(engine.plans).toEqual([]);

    const [card] = (await read()).batches;

    expect(card.batch.planner).toBe("analyzer-v1");
    expect(card.batch.drafts.map((entry) => [entry.localKey, entry.title, entry.body])).toEqual(
      batch.drafts.map((entry) => [entry.localKey, entry.title, entry.body]),
    );
  });

  it("answers one workspace's tickets when another mirrors the same repository", async () => {
    await analyze(api, workspace, [], { ending: "complete" });
    const mine = await draft(TITLES.ota);

    // Their workspace found the same three patterns in a repository of the same name, and
    // drafted one of them into a batch of its own.
    const them = await api.signIn();
    const theirs = await api.workspace(them);
    const pool = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.runner_pools (organization_id, name, executor)
       values ($1, 'pool-z', 'shell') returning id`,
      [theirs.id],
    );
    await analyze(api, theirs, [], {
      ending: "complete",
      only: (analyzer) => TICKET_ANALYZERS.includes(analyzer),
      evidence: [{ kind: "runner_pool", id: pool.rows[0].id }],
    });
    const source = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.ticket_sources (organization_id, kind, display_name, config)
       values ($1, 'github', 'GitHub', $2::jsonb) returning id`,
      [theirs.id, JSON.stringify(SOURCE_CONFIG)],
    );
    const batch = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.draft_batches
         (organization_id, source_prompt, planner, target_source_id)
       values ($1, 'Build Analyzer: drafted', 'analyzer-v1', $2) returning id`,
      [theirs.id, source.rows[0].id],
    );
    await api.sql.query(
      `update ${SCHEMA_NAME}.analysis_suggestions
          set status = 'drafted', draft_batch_id = $2, resolved_at = now()
        where id = $1`,
      [await suggestionId(api, theirs, TITLES.ccache), batch.rows[0].id],
    );

    const here = await read();
    const there = bodyOf<TicketsResource>(
      await api
        .as(them)("get", `/api/v1/analyzer/tickets?repo=${BENCH_REPO}`)
        .set(TENANT_HEADER, theirs.slug)
        .expect(200),
    );

    expect(here.undrafted).toHaveLength(2);
    expect(here.batches.map((entry) => entry.batch.id)).toEqual([mine.id]);
    expect(there.undrafted).toHaveLength(2);
    expect(there.batches.map((entry) => entry.batch.id)).toEqual([batch.rows[0].id]);
    // Each side's evidence resolves among its own rows.
    expect(here.undrafted[0].evidence[0].label).toBe("pool-a");
    expect(there.undrafted[0].evidence[0].label).toBe("pool-z");
  });

  it("is a member's to read, and a viewer's", async () => {
    await analyze(api, workspace, [], { ending: "complete" });
    await draft(TITLES.ota);
    const member = await api.signIn();
    const viewer = await api.signIn();
    await api.join(workspace.id, member, "member");
    await api.join(workspace.id, viewer, "viewer");

    for (const person of [member, viewer]) {
      const body = bodyOf<TicketsResource>(
        await as(person, "get", `/api/v1/analyzer/tickets?repo=${BENCH_REPO}`).expect(200),
      );

      expect(body.undrafted).toHaveLength(2);
      expect(body.batches).toHaveLength(1);
    }
  });

  it("refuses a repository that is not owner/name", async () => {
    const refusal = await as(owner, "get", "/api/v1/analyzer/tickets?repo=helios").expect(422);

    expect(bodyOf<{ code: string }>(refusal).code).toBe("validation_failed");
  });
});
