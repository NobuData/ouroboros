import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { PlanningRepository } from "./planning.repository";

/**
 * The planning statements (AL.4, #280), asserted as SQL — where a missing workspace predicate or a
 * write outside its transaction shows up. `planning.integration-spec.ts` runs them against
 * PostgreSQL.
 */

const ORG = "org-planning";
const BATCH = "5eed0280-0000-4000-8000-0000000000b1";
const DRAFT = "5eed0280-0000-4000-8000-0000000000d1";

describe("PlanningRepository", () => {
  let database: RecordingDatabase;
  let repository: PlanningRepository;

  beforeEach(() => {
    database = recordingDatabase();
    repository = new PlanningRepository(database.service);
  });

  it("reads a source through the credential-free view, inside the workspace", async () => {
    await expect(repository.source(ORG, "s")).resolves.toBeUndefined();

    const [sql] = database.sql();

    expect(sql).toContain('from "ouroboros"."ticket_sources_public"');
    expect(sql).toContain('"organization_id" = $1');
    expect(sql).not.toContain("credentials");
    expect(database.statements[0]?.parameters).toEqual([ORG, "s"]);
  });

  it("reads a batch and its source inside the workspace, joined on the workspace too", async () => {
    await expect(repository.batch(ORG, BATCH)).resolves.toBeUndefined();

    const [sql] = database.sql();

    expect(sql).toContain('"s"."organization_id" = "b"."organization_id"');
    expect(sql).toContain('"b"."organization_id" = $1');
  });

  it("maps a batch row", async () => {
    const at = new Date("2026-09-16T15:00:00.000Z");

    database.answers({
      rows: [
        {
          id: BATCH,
          organization_id: ORG,
          status: "sized",
          planner: "outline-v0",
          source_prompt: "p",
          outline: null,
          target_milestone: "Helios 2.1",
          epic_id: null,
          auto_size: true,
          queue_small: false,
          created_at: at,
          updated_at: at,
          source_id: "s",
          kind: "github",
          display_name: "GitHub",
          config: {},
          sync_cursor: null,
          synced_at: null,
        },
      ],
    });

    await expect(repository.batch(ORG, BATCH)).resolves.toMatchObject({
      id: BATCH,
      prompt: "p",
      targetMilestone: "Helios 2.1",
      source: { sourceId: "s", organizationId: ORG, kind: "github" },
    });
  });

  it("reads drafts with the latest estimate and the one pricing lookup", async () => {
    database.answers({
      rows: [
        {
          id: DRAFT,
          local_key: "OTA-10",
          title: "t",
          body: null,
          selected: true,
          suggested_workflow: "feature-loop",
          provenance: "edited",
          push_state: "pending",
          pushed_ticket_id: null,
          push_error: null,
          version: 2,
          effort: "s",
          confidence: 80,
          routed_model: "claude-fable-5",
          est_minutes: 90,
          est_tokens: 120000,
          estimator: "heuristic-v0",
          billing_mode: "token",
          input_cents_per_1m: "300.0000",
        },
        {
          id: "d2",
          local_key: "OTA-2",
          title: "t",
          body: null,
          selected: false,
          suggested_workflow: null,
          provenance: "planned",
          push_state: "pending",
          pushed_ticket_id: null,
          push_error: null,
          version: null,
          effort: null,
          confidence: null,
          routed_model: null,
          est_minutes: null,
          est_tokens: null,
          estimator: null,
          billing_mode: null,
          input_cents_per_1m: null,
        },
      ],
    });

    const drafts = await repository.drafts(ORG, BATCH);
    const [sql] = database.sql();

    expect(sql).toContain("order by ie.version desc");
    expect(sql).toContain('"ouroboros".model_price(');
    expect(drafts.map((draft) => draft.localKey)).toEqual(["OTA-2", "OTA-10"]);
    expect(drafts[1]).toMatchObject({
      provenance: "edited",
      estimate: { version: 2, effort: "s", estMinutes: 90, estTokens: 120000 },
      price: { billingMode: "token", inputCentsPer1m: "300.0000" },
    });
    expect(drafts[0]).toMatchObject({ estimate: null, price: null });
  });

  it("reads a batch's edges inside the workspace, through the blocked draft's batch", async () => {
    await repository.edges(ORG, BATCH);

    const [sql] = database.sql();

    expect(sql).toContain('inner join "ouroboros"."ticket_drafts" as "d"');
    expect(sql).toContain('"t"."organization_id" = $1');
    expect(sql).toContain('"d"."batch_id" = $2');
  });

  it("stores a batch, its drafts and their edges in one transaction", async () => {
    database.answers(
      { rows: [{ id: BATCH }] },
      {
        rows: [
          { id: "d1", local_key: "OTA-1" },
          { id: "d3", local_key: "OTA-3" },
        ],
      },
      {},
    );

    const stored = await repository.insertBatch(
      {
        organizationId: ORG,
        prompt: "p",
        outline: null,
        planner: "outline-v0",
        targetSourceId: "s",
        targetMilestone: null,
        epicId: null,
        autoSize: true,
        queueSmall: false,
        createdBy: null,
      },
      [
        {
          localKey: "OTA-1",
          title: "a",
          body: null,
          suggestedWorkflow: "x",
          selected: true,
          dependencies: [],
        },
        {
          localKey: "OTA-3",
          title: "c",
          body: null,
          suggestedWorkflow: "x",
          selected: true,
          dependencies: ["OTA-1"],
        },
      ],
    );

    const sql = database.sql();

    expect(stored).toEqual({
      batchId: BATCH,
      drafts: new Map([
        ["OTA-1", "d1"],
        ["OTA-3", "d3"],
      ]),
    });
    expect(sql[0]).toBe("begin");
    expect(sql[1]).toContain('insert into "ouroboros"."draft_batches"');
    expect(sql[2]).toContain('insert into "ouroboros"."ticket_drafts"');
    expect(sql[3]).toContain('insert into "ouroboros"."ticket_dependencies"');
    expect(database.statements[3]?.parameters).toEqual([ORG, "d1", null, "d3", "planned"]);
    expect(sql[4]).toBe("commit");
  });

  it("replaces only unpushed drafts, and points a new draft at a pushed blocker's ticket", async () => {
    database.answers(
      {},
      { rows: [{ id: "d1", local_key: "OTA-1", pushed_ticket_id: "ticket-612" }] },
      { rows: [{ id: "d3", local_key: "OTA-3" }] },
      {},
      {},
    );

    await repository.replaceUnpushed(ORG, BATCH, "outline-v0", [
      {
        localKey: "OTA-3",
        title: "c",
        body: null,
        suggestedWorkflow: "x",
        selected: false,
        dependencies: ["OTA-1"],
      },
    ]);

    const sql = database.sql();

    expect(sql[1]).toContain('delete from "ouroboros"."ticket_drafts"');
    expect(sql[1]).toContain('"push_state" <> $2');
    expect(database.statements[1]?.parameters).toEqual([BATCH, "pushed"]);
    expect(database.statements[4]?.parameters).toEqual([ORG, null, "ticket-612", "d3", "planned"]);
    expect(sql[5]).toContain('update "ouroboros"."draft_batches"');
    expect(sql[6]).toBe("commit");
  });

  it("patches only the fields present, and nothing at all for an empty patch", async () => {
    await repository.patchDraft(BATCH, DRAFT, {});

    expect(database.sql()).toEqual([]);

    await repository.patchDraft(BATCH, DRAFT, { title: "t", provenance: "edited" });

    const [sql] = database.sql();

    expect(sql).toContain('set "title" = $1, "provenance" = $2');
    expect(sql).toContain('"batch_id" = $4');
  });

  it("replaces a draft's in-batch blockers and leaves a synced ticket blocker alone", async () => {
    await repository.setDraftBlockers(
      ORG,
      DRAFT,
      [{ draftId: "d2" }, { ticketId: "ticket-612" }],
      ["ticket-612"],
    );

    const sql = database.sql();

    expect(sql[1]).toContain('delete from "ouroboros"."ticket_dependencies"');
    expect(sql[1]).toContain('"blocker_draft_id" is not null or "blocker_ticket_id" in ($3)');
    expect(sql[2]).toContain('insert into "ouroboros"."ticket_dependencies"');
    expect(database.statements[2]?.parameters).toEqual([
      ORG,
      "d2",
      null,
      DRAFT,
      "planned",
      ORG,
      null,
      "ticket-612",
      DRAFT,
      "planned",
    ]);
  });

  it("moves a status only from the one expected", async () => {
    database.answers({ numAffectedRows: 0n });

    await expect(repository.moveStatus(ORG, BATCH, "drafting", "sized")).resolves.toBe(false);
    expect(database.sql()[0]).toContain('"status" = $4');
  });

  it("counts selected drafts with no estimate", async () => {
    database.answers({ rows: [{ unsized: "2" }] });

    await expect(repository.unsizedSelected(BATCH)).resolves.toBe(2);
    expect(database.sql()[0]).toContain("not exists");
  });

  it("reads pushed drafts inside the workspace", async () => {
    database.answers({ rows: [{ local_key: "OTA-1", external_id: "612", effort: "xs" }] });

    await expect(repository.pushedDrafts(ORG, BATCH)).resolves.toEqual([
      { localKey: "OTA-1", externalId: "612", effort: "xs" },
    ]);
    expect(database.sql()[0]).toContain("t.organization_id = b.organization_id");
  });

  it("matches mirrored issues by workspace, owner, repository and number", async () => {
    await expect(repository.mirroredIssues(ORG, "not-a-repo", [1])).resolves.toEqual([]);
    await expect(repository.mirroredIssues(ORG, "acme/helios", [])).resolves.toEqual([]);
    expect(database.sql()).toEqual([]);

    await repository.mirroredIssues(ORG, "acme-robotics/helios-firmware", [612]);

    expect(database.statements[0]?.parameters).toEqual([
      ORG,
      "acme-robotics",
      "helios-firmware",
      612,
    ]);
  });

  it("reads lanes from the progress view with months as text", async () => {
    database.answers({
      rows: [
        {
          epic_id: "e",
          name: "OTA",
          tint: "accent",
          status: "active",
          start_month: "2026-07",
          end_month: "2026-09",
          sort_order: 1,
          roadmap_name: null,
          roadmap_window: null,
          ticket_count: "12",
          done_count: "8",
        },
      ],
    });

    await expect(repository.epics(ORG)).resolves.toEqual([
      expect.objectContaining({ startMonth: "2026-07", ticketCount: 12, doneCount: 8 }),
    ]);

    const [sql] = database.sql();

    expect(sql).toContain('from "ouroboros"."planning_epic_progress"');
    expect(sql).toContain("to_char(start_month, 'YYYY-MM')");
    expect(sql).toContain('order by "sort_order"');
  });

  it("creates a lane below the last one, months as first-of-month dates", async () => {
    database.answers({ rows: [{ highest: 4 }] }, { rows: [{ id: "e" }] });

    await expect(
      repository.createEpic(ORG, {
        name: "OTA",
        tint: "accent",
        status: "active",
        startMonth: "2026-07",
        endMonth: "2026-09",
        roadmapName: null,
        roadmapWindow: null,
      }),
    ).resolves.toBe("e");

    expect(database.sql()[2]).toContain("::date");
    expect(database.statements[2]?.parameters).toEqual(
      expect.arrayContaining(["2026-07-01", "2026-09-01", 5]),
    );
  });

  it("reorders inside one transaction, scoped to the workspace", async () => {
    await repository.reorderEpics(ORG, ["e2", "e1"]);

    const sql = database.sql();

    expect(sql[0]).toBe("begin");
    expect(database.statements[1]?.parameters).toEqual([1, ORG, "e2"]);
    expect(database.statements[2]?.parameters).toEqual([2, ORG, "e1"]);
    expect(sql[3]).toBe("commit");
  });

  it("scopes update, delete and the ticket lookup to the workspace", async () => {
    database.answers({ numAffectedRows: 1n }, { numAffectedRows: 0n });

    await expect(
      repository.updateEpic(ORG, "e", {
        name: "n",
        tint: "ok",
        status: "done",
        startMonth: null,
        endMonth: null,
        roadmapName: null,
        roadmapWindow: null,
      }),
    ).resolves.toBe(true);
    await expect(repository.deleteEpic(ORG, "e")).resolves.toBe(false);
    await repository.ticketIdsIn(ORG, ["t"]);

    for (const sql of database.sql()) {
      expect(sql).toContain('"organization_id" = $');
    }
  });

  it("links idempotently and unlinks by epic", async () => {
    await repository.linkTickets("e", ["t1"]);
    await repository.unlinkTickets("e", ["t1"]);

    const sql = database.sql();

    expect(sql[0]).toContain("on conflict");
    expect(sql[1]).toContain('delete from "ouroboros"."epic_tickets"');
  });
});
