import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { QuestionLookupRepository } from "./question.lookup.repository";

/**
 * The read `/ouro answer q-231 …` rests on (#537): one item by its short number, inside the
 * workspace, whatever its status — so an answered question can be told from one that never was.
 */

const ORG = "org-acme";

describe("QuestionLookupRepository", () => {
  let database: RecordingDatabase;
  let questions: QuestionLookupRepository;

  beforeEach(() => {
    database = recordingDatabase();
    questions = new QuestionLookupRepository(database.service);
  });

  it("reads the item by short number, scoped to the workspace, and only reads", async () => {
    const row = {
      itemId: "item-1",
      shortSeq: 231,
      status: "resolved",
      kindId: "protected_path_allow_once",
      kindVersion: 1,
    };
    database.answers({ rows: [row] });

    expect(await questions.byShortSeq(ORG, 231)).toEqual(row);

    const [statement] = database.statements;
    expect(database.statements).toHaveLength(1);
    expect(statement.sql).toMatch(/^select /);
    expect(statement.sql).toContain('"organization_id" = $');
    expect(statement.sql).toContain("short_seq = $");
    // No status filter: the caller says "already answered" or "expired" from the row.
    expect(statement.sql).not.toContain('"status" =');
    expect(statement.parameters).toEqual([ORG, 231]);
  });

  it("answers undefined for a number no item of the workspace carries", async () => {
    expect(await questions.byShortSeq(ORG, 999)).toBeUndefined();
  });
});
