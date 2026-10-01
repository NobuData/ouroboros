import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { EnvRecipesRepository } from "./env-recipes.repository";
import { HELIOS, KEN, currentRow } from "./env-recipes.fixture";

/**
 * V073's statements (#420): the read is the current view joined to the editor's name and scoped to
 * the workspace and the repository; the write is an insert of one `edited` version and nothing
 * else — no update, no delete, no version arithmetic in SQL.
 */

const ORG = "org-helios";

describe("the env-recipe repository", () => {
  let database: RecordingDatabase;
  let recipes: EnvRecipesRepository;

  beforeEach(() => {
    database = recordingDatabase();
    recipes = new EnvRecipesRepository(database.service);
  });

  it("reads the current view for one repository of the workspace, with the editor's name", async () => {
    database.answers({ rows: [currentRow()] });

    expect(await recipes.current(ORG, HELIOS)).toEqual(currentRow());

    const [statement] = database.statements;

    expect(statement.sql).toContain('from "ouroboros"."env_recipes_current" as "r"');
    expect(statement.sql).toContain(
      'left join "ouroboros"."user" as "u" on "u"."id" = "r"."updated_by"',
    );
    expect(statement.sql).toContain('"u"."name" as "editor_name"');
    expect(statement.sql).toContain('"r"."organization_id" = $1');
    expect(statement.sql).toContain('"r"."repo_ref" = $2');
    expect(statement.parameters).toEqual([ORG, HELIOS]);
  });

  it("answers undefined for a repository with no recipe", async () => {
    database.answers({ rows: [] });

    expect(await recipes.current(ORG, HELIOS)).toBeUndefined();
  });

  it("inserts one edited version in the person's name and returns its id and number", async () => {
    database.answers({ rows: [{ id: "recipe-4", version: 4 }] });
    const commands = JSON.stringify([{ command: "west update" }]);

    await expect(recipes.insert(ORG, HELIOS, 4, commands, KEN.id)).resolves.toEqual({
      id: "recipe-4",
      version: 4,
    });

    const [statement] = database.statements;

    expect(statement.sql).toContain('insert into "ouroboros"."env_recipes"');
    expect(statement.sql).toContain('returning "id", "version"');
    expect(statement.sql).not.toContain("update ");
    expect(statement.parameters).toEqual([ORG, HELIOS, 4, commands, "edited", KEN.id]);
  });
});
