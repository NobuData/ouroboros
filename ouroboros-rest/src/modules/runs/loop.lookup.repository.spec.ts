import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { ACTIVE_RUN_STATUSES } from "../db/schema";
import { LoopLookupRepository } from "./loop.lookup.repository";

/**
 * The two reads `/ouro pause loop 1847` rests on (#537), as the SQL PostgreSQL would receive —
 * `runs.repository.spec.ts`' argument. What only this suite can see: both are scoped to one
 * workspace, the number is matched **exactly**, and neither statement can change a row.
 */

const WORKSPACE = "acme-robotics-id";

describe("the loop lookup repository", () => {
  let database: RecordingDatabase;
  let loops: LoopLookupRepository;

  beforeEach(() => {
    database = recordingDatabase();
    loops = new LoopLookupRepository(database.service);
  });

  const everyRead: readonly [string, (repository: LoopLookupRepository) => Promise<unknown>][] = [
    ["byLoopSeq", (repository) => repository.byLoopSeq(WORKSPACE, 1847)],
    ["live", (repository) => repository.live(WORKSPACE, "18", 5)],
  ];

  it.each(everyRead)("%s is scoped to the workspace, and only reads", async (_name, read) => {
    await read(loops);

    const [statement] = database.statements;
    expect(database.statements).toHaveLength(1);
    expect(statement.sql).toMatch(/^select /);
    expect(statement.sql).toContain('"organization_id" = $');
    expect(statement.parameters).toContain(WORKSPACE);
  });

  it("matches the loop number exactly, as a parameter", async () => {
    database.answers({
      rows: [
        {
          runId: "run-1",
          loopSeq: 1847,
          status: "coding",
          issueNumber: 482,
          issueTitle: "Fix the ISR",
          finishedAt: null,
        },
      ],
    });

    expect(await loops.byLoopSeq(WORKSPACE, 1847)).toMatchObject({ runId: "run-1", loopSeq: 1847 });

    const [statement] = database.statements;
    expect(statement.sql).toContain('"loop_seq" = $');
    expect(statement.sql).not.toContain("like");
    expect(statement.parameters).toEqual([WORKSPACE, 1847]);
  });

  it("answers undefined for a number no run of the workspace carries", async () => {
    expect(await loops.byLoopSeq(WORKSPACE, 9999)).toBeUndefined();
  });

  it("lists the loops in flight by number prefix, newest first", async () => {
    await loops.live(WORKSPACE, "18", 5);

    const [statement] = database.statements;
    expect(statement.sql).toContain('"status" in ($');
    expect(statement.sql).toContain("loop_seq::text like $");
    expect(statement.sql).toMatch(/order by "loop_seq" desc limit \$/);
    expect(statement.parameters).toEqual([WORKSPACE, ...ACTIVE_RUN_STATUSES, "18%", 5]);
  });

  it("lists every loop in flight when nothing has been typed", async () => {
    await loops.live(WORKSPACE, "", 5);

    expect(database.statements[0].sql).not.toContain("like");
  });
});
