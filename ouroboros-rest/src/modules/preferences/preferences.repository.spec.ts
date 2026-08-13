import type { UserPreferences } from "../db/schema";
import { PreferencesRepository } from "./preferences.repository";
import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";

/**
 * The two statements, and the two properties they must have: every read and write is keyed
 * by the caller's own id and nothing else, and the write is a *single* upsert — a
 * read-then-write pair would be a race the primary key exists to make unnecessary.
 */

const PERSON = "user-someone";

const ROW = {
  user_id: PERSON,
  font_scale: "125",
  created_at: new Date("2026-08-11T10:20:23.114Z"),
  updated_at: new Date("2026-08-13T09:00:00.000Z"),
} satisfies UserPreferences;

describe("the preferences repository", () => {
  let database: RecordingDatabase;
  let preferences: PreferencesRepository;

  beforeEach(() => {
    database = recordingDatabase();
    preferences = new PreferencesRepository(database.service);
  });

  it("reads by the person, and nothing else", async () => {
    database.answers({ rows: [ROW] });

    expect(await preferences.findFor(PERSON)).toEqual(ROW);
    expect(database.statements[0].sql).toContain('where "user_id" = $1');
    expect(database.statements[0].parameters).toEqual([PERSON]);
  });

  it("answers undefined for a person who has never chosen", async () => {
    database.answers({ rows: [] });

    expect(await preferences.findFor(PERSON)).toBeUndefined();
  });

  it("writes as one upsert on the primary key", async () => {
    // `on conflict … do update` rather than read-then-write: the database arbitrates two
    // racing writes, and "set my scale" is the same request whether it is the person's
    // first choice or their fortieth.
    database.answers({ rows: [ROW] });

    const stored = await preferences.upsertFontScale(PERSON, "125");

    expect(stored).toEqual(ROW);
    expect(database.statements[0].sql).toContain('insert into "ouroboros"."user_preferences"');
    expect(database.statements[0].sql).toContain('on conflict ("user_id") do update set');
    expect(database.statements[0].parameters).toEqual([PERSON, "125", "125"]);
  });

  it("never writes updated_at, which is the trigger's", async () => {
    // `Stamped` makes this a compile-time fact, but the statement is the artefact a reader
    // checks: nothing in the upsert names the column, so the server clock is the only writer.
    database.answers({ rows: [ROW] });
    await preferences.upsertFontScale(PERSON, "100");

    expect(database.statements[0].sql).not.toContain("updated_at");
  });
});
