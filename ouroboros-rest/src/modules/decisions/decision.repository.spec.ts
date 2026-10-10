import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { DecisionRepository } from "./decision.repository";
import { FIXTURE_KIND, SEEDED_PAYLOADS } from "./decision.kinds.fixture";

/**
 * The decision statements (#461): writes go through V093's upsert and V097's closure, never around
 * them; reads map rows to declarations and fold the feed.
 */

const ORG = "acme-robotics";
const RUN = "0a1b2c3d-0000-4000-8000-000000001851";

let database: RecordingDatabase;
let repository: DecisionRepository;

beforeEach(() => {
  database = recordingDatabase();
  repository = new DecisionRepository(database.service);
});

describe("emit", () => {
  it("files through decision_item_emit with the facts and refs as jsonb, and answers the id", async () => {
    database.answers({ rows: [{ id: "item-1" }] });

    const id = await repository.emit(database.service.db, {
      organizationId: ORG,
      kindId: "protected_path_allow_once",
      payload: SEEDED_PAYLOADS.protected_path_allow_once,
      refs: [{ type: "run", id: RUN, label: "loop #1851" }],
      key: { plane: "guardrails", sourceRef: `run:${RUN}:path:boot/rollback_flag.c` },
    });

    expect(id).toBe("item-1");
    expect(database.statements[0].sql).toContain("ouroboros.decision_item_emit(");
    expect(database.statements[0].parameters).toEqual([
      ORG,
      "protected_path_allow_once",
      JSON.stringify(SEEDED_PAYLOADS.protected_path_allow_once),
      JSON.stringify([{ type: "run", id: RUN, label: "loop #1851" }]),
      "guardrails",
      `run:${RUN}:path:boot/rollback_flag.c`,
      null,
    ]);
  });
});

describe("sourceResolve", () => {
  it("closes through decision_item_source_resolve with the channel and the receipt", async () => {
    database.answers({ rows: [{ closed: true }] });

    expect(await repository.sourceResolve("item-1", "github", { source: "pr_merged" })).toBe(true);
    expect(database.statements[0].sql).toContain("ouroboros.decision_item_source_resolve(");
    expect(database.statements[0].parameters).toEqual([
      "item-1",
      "github",
      '{"source":"pr_merged"}',
    ]);
  });

  it("answers false when the item was no longer asking", async () => {
    database.answers({ rows: [{ closed: false }] });

    expect(await repository.sourceResolve("item-1", "api", {})).toBe(false);
  });
});

describe("itemByKey and lockKey", () => {
  it("looks an item up by the generated idempotency key, in its own workspace", async () => {
    await repository.itemByKey(database.service.db, ORG, { plane: "pr.gates", sourceRef: "pr:1" });

    expect(database.statements[0].sql).toContain('"idempotency_key" = $');
    expect(database.statements[0].parameters).toEqual([ORG, "pr.gates:pr:1"]);
  });

  it("serialises a key with a transaction-scoped advisory lock", async () => {
    await repository.transaction((trx) =>
      repository.lockKey(trx, ORG, { plane: "facts", sourceRef: "f:1" }),
    );

    expect(database.sql().map((sql) => sql.trim())).toEqual([
      "begin",
      "select pg_advisory_xact_lock(hashtextextended($1, 0))",
      "commit",
    ]);
    expect(database.statements[1].parameters).toEqual([`decision:${ORG}:facts:f:1`]);
  });
});

describe("kinds", () => {
  it("maps the newest row to a declaration, the interval read as text", async () => {
    database.answers({
      rows: [
        {
          kind_id: FIXTURE_KIND.kindId,
          version: 3,
          severity_default: "warn",
          question_template: FIXTURE_KIND.questionTemplate,
          why_template: FIXTURE_KIND.whyTemplate,
          payload_schema: FIXTURE_KIND.payloadSchema,
          actions: FIXTURE_KIND.actions,
          resolution_semantics: FIXTURE_KIND.resolutionSemantics,
          ref_shape: FIXTURE_KIND.refShape,
          merge_class: false,
          escalation_window_text: "00:30:00",
        },
      ],
    });

    expect(await repository.currentKind(FIXTURE_KIND.kindId)).toEqual({
      ...FIXTURE_KIND,
      version: 3,
    });
    expect(database.statements[0].sql).toContain('order by "version" desc limit $');
    expect(database.statements[0].sql).toContain("escalation_window::text");
  });

  it("publishes the version it names, which the database checks is the next one", async () => {
    database.answers({ rows: [{ version: 2 }] });

    const { version: _version, ...declaration } = FIXTURE_KIND;

    expect(await repository.publishKind(declaration, 2, database.service.db)).toBe(2);
    expect(database.statements[0].sql).toMatch(/^insert into "ouroboros"."decision_kinds"/);
    expect(database.statements[0].parameters).toEqual(
      expect.arrayContaining([FIXTURE_KIND.kindId, 2]),
    );
  });

  it("serialises registrations of one kind with a transaction-scoped advisory lock", async () => {
    await repository.transaction((trx) => repository.lockKind(trx, FIXTURE_KIND.kindId));

    expect(database.statements[1].sql).toBe(
      "select pg_advisory_xact_lock(hashtextextended($1, 0))",
    );
    expect(database.statements[1].parameters).toEqual([`decision-kind:${FIXTURE_KIND.kindId}`]);
  });
});

describe("feed", () => {
  it("counts open and elapsed-snooze items apart from hidden ones, per severity, in one workspace", async () => {
    const now = new Date("2026-10-04T09:12:00Z");
    database.answers({
      rows: [
        {
          severity: "warn",
          open: "2",
          snoozed: "1",
          next_wake_at: new Date("2026-10-04T10:00:00Z"),
        },
      ],
    });

    expect(await repository.feed(ORG, now)).toEqual([
      { severity: "warn", open: 2, snoozed: 1, nextWakeAt: new Date("2026-10-04T10:00:00Z") },
    ]);
    expect(database.statements[0].sql).toContain("filter(where");
    expect(database.statements[0].sql).toContain('group by "severity"');
    expect(database.statements[0].parameters).toEqual(expect.arrayContaining([ORG, now]));
  });
});

describe("asking", () => {
  it("asks nothing for a detector with no kinds", async () => {
    expect(await repository.asking([], null)).toEqual([]);
    expect(database.statements).toEqual([]);
  });

  it("reads open and snoozed items of the kinds, scoped to a workspace when one is named", async () => {
    await repository.asking(["merge_approval"], ORG);

    expect(database.statements[0].parameters).toEqual(["open", "snoozed", "merge_approval", ORG]);
  });
});
