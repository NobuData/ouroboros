import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { InboxActionsRepository } from "./inbox-actions.repository";

/**
 * The statements the executor's guarantees rest on: an item read only inside its workspace and
 * locked for the claim, an attempt finished only while running, a human resolution, and a grant
 * expiring at the workspace's own ceiling.
 */

const ORG = "org-acme";
const ITEM = "5eed0082-0000-4000-8000-000000000002";

describe("InboxActionsRepository", () => {
  let database: RecordingDatabase;
  let repository: InboxActionsRepository;

  beforeEach(() => {
    database = recordingDatabase();
    repository = new InboxActionsRepository(database.service);
  });

  it("reads an item inside its workspace, and locks it for the claim", async () => {
    database.answers({
      rows: [
        {
          id: ITEM,
          organization_id: ORG,
          kind_id: "protected_path_allow_once",
          kind_version: 1,
          status: "open",
          payload: { path: "boot/rollback_flag.c" },
          refs: [],
          source_ref: "run:r:path:boot/rollback_flag.c",
        },
      ],
    });

    const read = await repository.item(database.service.db, ORG, ITEM, true);

    expect(read).toMatchObject({ id: ITEM, kindId: "protected_path_allow_once", status: "open" });
    expect(database.statements[0].sql).toContain('"organization_id" = $1');
    expect(database.statements[0].sql).toMatch(/for update$/);
    expect(database.statements[0].parameters).toEqual([ORG, ITEM]);
  });

  it("reads an item unlocked by default, and answers undefined for one it does not have", async () => {
    expect(await repository.item(database.service.db, ORG, ITEM)).toBeUndefined();
    expect(database.statements[0].sql).not.toContain("for update");
  });

  it("records a press running — the status is the column default", async () => {
    database.answers({ rows: [{ id: "attempt-1" }] });

    await repository.insertAttempt(database.service.db, {
      organizationId: ORG,
      itemId: ITEM,
      actionId: "allow_once",
      actorId: "user-ken",
      channel: "web",
      idempotencyKey: "key-1",
    });

    expect(database.statements[0].sql).toContain(
      'insert into "ouroboros"."decision_action_attempts"',
    );
    expect(database.statements[0].sql).not.toContain('"status"');
  });

  it("finishes only a running attempt, either way", async () => {
    await repository.succeed(database.service.db, "attempt-1", { exception_id: "e-1" });
    await repository.fail(database.service.db, "attempt-2", {
      code: "forbidden",
      message: "x".repeat(3000),
      status: 403,
    });

    expect(database.statements[0].sql).toContain('"status" = $');
    expect(database.statements[0].parameters).toEqual(
      expect.arrayContaining(["succeeded", '{"exception_id":"e-1"}', "attempt-1", "running"]),
    );
    expect(database.statements[1].parameters).toEqual(
      expect.arrayContaining([
        "failed",
        "forbidden",
        "x".repeat(2000),
        403,
        "attempt-2",
        "running",
      ]),
    );
  });

  it("writes a person's answer as a human resolution", async () => {
    await repository.insertResolution(database.service.db, {
      itemId: ITEM,
      organizationId: ORG,
      actionId: "allow_once",
      userId: "user-ken",
      channel: "web",
      note: null,
      outcome: { exception_id: "e-1" },
    });

    expect(database.statements[0].sql).toContain('insert into "ouroboros"."decision_resolutions"');
    expect(database.statements[0].parameters).toEqual(
      expect.arrayContaining([ITEM, ORG, "allow_once", "human", "user-ken", null, "web"]),
    );
  });

  it("grants an exception expiring at the workspace's own ceiling", async () => {
    database.answers({ rows: [{ id: "exception-1" }] });

    await repository.grantException(database.service.db, {
      organizationId: ORG,
      runId: "run-1",
      pathGlob: "boot/rollback_flag.c",
      grantedBy: "user-ken",
      itemId: ITEM,
    });

    expect(database.statements[0].sql).toContain('insert into "ouroboros"."guardrail_exceptions"');
    expect(database.statements[0].sql).toContain("ouroboros.decision_ttl_settings(");
    expect(database.statements[0].parameters).toEqual(
      expect.arrayContaining([ORG, "run-1", "boot/rollback_flag.c", "user-ken", ITEM]),
    );
  });

  it("reads a PR's latest revision and ticket source inside the workspace", async () => {
    database.answers({
      rows: [
        {
          external_number: 504,
          source_id: "src-1",
          external_key: "#465",
          latest_revision_id: "rev-1",
        },
      ],
    });

    await expect(repository.pullRequest(ORG, "pr-1")).resolves.toEqual({
      number: 504,
      latestRevisionId: "rev-1",
      ticketSourceId: "src-1",
      ticketKey: "#465",
    });
    expect(database.statements[0].sql).toContain('"pr"."organization_id" = $');
  });
});
