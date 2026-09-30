import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { RepoMapRepository } from "./repo-map.repository";

/**
 * The repo-map generator's own statements (#415), as the compiler produces them: which
 * repositories are mapped, and which skill is a repository's map.
 */

const WORKSPACE = "acme-robotics-id";

describe("the repo-map repository", () => {
  let database: RecordingDatabase;
  let store: RepoMapRepository;

  beforeEach(() => {
    database = recordingDatabase();
    store = new RepoMapRepository(database.service);
  });

  it("maps only repositories enabled under an enabled GitHub org, lower-cased", async () => {
    await store.enabledRepos();

    const [sql] = database.sql();

    expect(sql).toContain('"gr"."enabled" = $1');
    expect(sql).toContain('"go"."enabled" = $2');
    expect(sql).toContain("lower(go.login || '/' || gr.name)");
  });

  it("finds the map as the generated repo skill of this workspace and repository", async () => {
    database.answers({ rows: [{ id: "s", slug: "repo-map", currentVersion: 3, body: "# map" }] });

    await expect(store.skillFor(WORKSPACE, "acme/helios")).resolves.toEqual({
      id: "s",
      slug: "repo-map",
      currentVersion: 3,
      body: "# map",
    });

    const [statement] = database.statements;

    expect(statement.sql).toContain('"s"."organization_id" = $1');
    expect(statement.sql).toContain('"s"."origin" = $2');
    expect(statement.sql).toContain('"sv"."version" = "s"."current_version"');
    expect(statement.parameters).toEqual(
      expect.arrayContaining([
        WORKSPACE,
        "generated",
        "repo",
        "acme/helios",
        "repo-map",
        "repo-map-%",
      ]),
    );
  });

  it("answers which candidate slugs the workspace already uses", async () => {
    database.answers({ rows: [{ slug: "repo-map" }] });

    await expect(store.takenSlugs(WORKSPACE, ["repo-map", "repo-map-helios"])).resolves.toEqual([
      "repo-map",
    ]);
    expect(database.statements[0].parameters).toEqual([WORKSPACE, "repo-map", "repo-map-helios"]);
  });
});
