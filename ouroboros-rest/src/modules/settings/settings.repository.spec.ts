import type { WorkspaceSettings, WorkspaceSettingsEffective } from "../db/schema";
import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { SettingsRepository } from "./settings.repository";

/**
 * The two statements, and the properties they must have: the read is the *view* and the
 * write is the *table* — V011's read-here-write-there split, held as SQL — every statement
 * is keyed by the workspace and nothing else, and the write is a *single* upsert, because a
 * read-then-write pair would be a race the primary key exists to make unnecessary.
 */

const WORKSPACE = "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10";
const ADMINISTRATOR = "user-someone";

const EFFECTIVE = {
  organization_id: WORKSPACE,
  auto_merge_on_checks: true,
  is_explicit: true,
  updated_at: new Date("2026-08-13T09:00:00.000Z"),
  updated_by: ADMINISTRATOR,
} satisfies WorkspaceSettingsEffective;

const ROW = {
  organization_id: WORKSPACE,
  auto_merge_on_checks: true,
  updated_by: ADMINISTRATOR,
  created_at: new Date("2026-08-11T10:20:23.114Z"),
  updated_at: new Date("2026-08-13T09:00:00.000Z"),
} satisfies WorkspaceSettings;

describe("the settings repository", () => {
  let database: RecordingDatabase;
  let settings: SettingsRepository;

  beforeEach(() => {
    database = recordingDatabase();
    settings = new SettingsRepository(database.service);
  });

  it("reads the effective view, scoped to the workspace and nothing else", async () => {
    database.answers({ rows: [EFFECTIVE] });

    expect(await settings.effective(WORKSPACE)).toEqual(EFFECTIVE);
    expect(database.statements[0].sql).toContain('from "ouroboros"."workspace_settings_effective"');
    expect(database.statements[0].sql).toContain('where "organization_id" = $1');
    expect(database.statements[0].parameters).toEqual([WORKSPACE]);
  });

  it("answers undefined for a workspace the view has no row for", async () => {
    database.answers({ rows: [] });

    expect(await settings.effective(WORKSPACE)).toBeUndefined();
  });

  it("writes the table as one upsert on the primary key, attribution included", async () => {
    // `on conflict … do update` rather than read-then-write: the database arbitrates two
    // racing administrators, and "flip the switch" is the same request whether it is the
    // workspace's first choice or its fortieth. `updated_by` is in both halves, because a
    // re-affirmation by a different administrator must still say who.
    database.answers({ rows: [ROW] });

    const stored = await settings.upsertAutoMerge(WORKSPACE, true, ADMINISTRATOR);

    expect(stored).toEqual(ROW);
    expect(database.statements[0].sql).toContain('insert into "ouroboros"."workspace_settings"');
    expect(database.statements[0].sql).toContain('on conflict ("organization_id") do update set');
    expect(database.statements[0].parameters).toEqual([
      WORKSPACE,
      true,
      ADMINISTRATOR,
      true,
      ADMINISTRATOR,
    ]);
  });

  it("never writes updated_at, which is the trigger's", async () => {
    // `Stamped` makes this a compile-time fact, but the statement is the artefact a reader
    // checks: nothing in the upsert names the column, so the server clock is the only writer.
    database.answers({ rows: [ROW] });
    await settings.upsertAutoMerge(WORKSPACE, false, ADMINISTRATOR);

    expect(database.statements[0].sql).not.toContain("updated_at");
  });
});
