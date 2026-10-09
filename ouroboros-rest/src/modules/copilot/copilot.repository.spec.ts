import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { CopilotRepository, EMPTY_TRACE, MAX_TICKET_CANDIDATES } from "./copilot.repository";

const WORKSPACE = "acme-robotics-id";
const WORKFLOW = "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94";
const SESSION = "5eed008a-0000-4000-8000-000000000001";

describe("the copilot repository", () => {
  let database: RecordingDatabase;
  let copilots: CopilotRepository;

  beforeEach(() => {
    database = recordingDatabase();
    copilots = new CopilotRepository(database.service);
  });

  it("reads the active session by workspace, workflow and status", async () => {
    await copilots.activeSession(WORKSPACE, WORKFLOW);

    const [statement] = database.statements;
    expect(statement.sql).toContain('from "ouroboros"."copilot_sessions"');
    expect(statement.sql).toContain('"status" = $3');
    expect(statement.parameters).toEqual([WORKSPACE, WORKFLOW, "active"]);
  });

  it("starts a session with its draft tag and author, letting the database allocate the rest", async () => {
    database.answers({ rows: [{ id: SESSION }] });

    await copilots.createSession(WORKSPACE, WORKFLOW, "security-patch", "user-1");

    const [statement] = database.statements;
    expect(statement.sql).toContain('insert into "ouroboros"."copilot_sessions"');
    expect(statement.sql).toContain(
      '("organization_id", "workflow_id", "draft_name", "created_by")',
    );
    expect(statement.parameters).toEqual([WORKSPACE, WORKFLOW, "security-patch", "user-1"]);
  });

  it("appends to the model provenance under a lock, never rewriting what is recorded", async () => {
    database.answers({ rows: [{ model_provenance: [{ seq: 2, alias: "a", model_id: "m" }] }] });

    await copilots.appendProvenance(SESSION, {
      seq: 4,
      alias: "coder-max",
      model_id: "claude-fable-5",
    });

    const sql = database.sql();
    expect(sql[0]).toBe("begin");
    expect(sql[1]).toContain("for update");
    expect(sql[2]).toContain('update "ouroboros"."copilot_sessions" set "model_provenance"');
    expect(database.statements[2].parameters[0]).toBe(
      JSON.stringify([
        { seq: 2, alias: "a", model_id: "m" },
        { seq: 4, alias: "coder-max", model_id: "claude-fable-5" },
      ]),
    );
    expect(sql.at(-1)).toBe("commit");
  });

  it("records a user message plain, and opens a reply streaming with an empty body", async () => {
    database.answers({ rows: [{ id: "m-1" }] }, { rows: [{ id: "m-2" }] });

    await copilots.insertUserMessage(WORKSPACE, SESSION, "label security.");
    await copilots.insertStreamingReply(WORKSPACE, SESSION);

    expect(database.statements[0].sql).toContain(
      '("organization_id", "session_id", "role", "body")',
    );
    expect(database.statements[0].parameters).toEqual([
      WORKSPACE,
      SESSION,
      "user",
      "label security.",
    ]);
    expect(database.statements[1].sql).toContain(
      '("organization_id", "session_id", "role", "status")',
    );
    expect(database.statements[1].parameters).toEqual([WORKSPACE, SESSION, "copilot", "streaming"]);
    // Never a supplied seq: the trigger allocates it.
    for (const statement of database.statements) expect(statement.sql).not.toContain('"seq"');
  });

  it("closes a reply with its text, chips, trace and metering as JSON", async () => {
    database.answers({ rows: [{ id: "m-2" }] });

    await copilots.finishReply("m-2", {
      body: "Drafted.",
      choices: [{ prompt: "?", options: ["a", "b"], selected: null, answered_at: null }],
      tool_trace: EMPTY_TRACE,
      tokens_in: 10,
      tokens_out: 2,
      cost_cents: null,
      status: "complete",
    });

    const [statement] = database.statements;
    expect(statement.sql).toContain('update "ouroboros"."copilot_messages" set');
    expect(statement.parameters).toEqual([
      "Drafted.",
      JSON.stringify([{ prompt: "?", options: ["a", "b"], selected: null, answered_at: null }]),
      JSON.stringify(EMPTY_TRACE),
      10,
      2,
      null,
      "complete",
      "m-2",
    ]);
  });

  it("applies a batch through apply_draft_batch() as the copilot, inside the caller's transaction", async () => {
    database.answers({ rows: [{ draft_rev: 2, batch_id: "batch-2" }] });
    const operations = [{ kind: "add_stage", params: { node: { id: "exploit-verify" } } }];

    const applied = await database.service.transaction((trx) =>
      copilots.applyBatch(WORKSPACE, WORKFLOW, "user-1", SESSION, operations, trx),
    );

    expect(applied).toEqual({ draft_rev: 2, batch_id: "batch-2" });
    const call = database.statements[1];
    expect(call.sql).toContain("ouroboros.apply_draft_batch(");
    expect(call.sql).toContain("'copilot'");
    expect(call.parameters).toEqual([
      WORKSPACE,
      WORKFLOW,
      "user-1",
      SESSION,
      JSON.stringify(operations),
    ]);
  });

  it("looks open tickets up newest first, by title or label, bounded", async () => {
    database.answers({
      rows: [{ external_key: "#489", title: "CAN arbitration storm", labels: ["bug"] }],
    });

    const found = await copilots.openTickets(WORKSPACE, "security_%", 50);

    expect(found).toEqual([{ key: "#489", title: "CAN arbitration storm", labels: ["bug"] }]);
    const [statement] = database.statements;
    expect(statement.sql).toContain('"state" = $2');
    expect(statement.sql).toContain('"title" ilike $3');
    expect(statement.sql).toContain("jsonb_array_elements_text");
    expect(statement.sql).toContain('order by "source_updated_at" desc');
    expect(statement.parameters).toEqual([
      WORKSPACE,
      "open",
      "%security\\_\\%%",
      "%security\\_\\%%",
      MAX_TICKET_CANDIDATES,
    ]);
  });

  it("looks every open ticket up when the query is blank", async () => {
    await copilots.openTickets(WORKSPACE, "  ", 3);

    const [statement] = database.statements;
    expect(statement.sql).not.toContain("ilike");
    expect(statement.parameters).toEqual([WORKSPACE, "open", 3]);
  });
});
