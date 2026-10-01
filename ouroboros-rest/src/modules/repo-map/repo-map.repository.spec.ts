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

  it("narrows the repositories to one workspace for the status read (#422)", async () => {
    await store.enabledRepos(WORKSPACE);

    const [statement] = database.statements;

    expect(statement.sql).toContain('"go"."organization_id" = $3');
    expect(statement.parameters).toEqual([true, true, WORKSPACE]);
  });

  it("lists a workspace's map skills by slug, so the first for a repository is its map (#422)", async () => {
    database.answers({ rows: [{ repo: "acme/helios", slug: "repo-map", currentVersion: 3 }] });

    await expect(store.mapSkills(WORKSPACE)).resolves.toEqual([
      { repo: "acme/helios", slug: "repo-map", currentVersion: 3 },
    ]);

    const [statement] = database.statements;

    expect(statement.sql).toContain('"s"."organization_id" = $1');
    expect(statement.sql).toContain("lower(s.repo_ref)");
    expect(statement.sql).toContain('order by "s"."slug"');
    expect(statement.parameters).toEqual([
      WORKSPACE,
      "generated",
      "repo",
      "repo-map",
      "repo-map-%",
    ]);
  });

  it("reads the newest recorded generation of each repository, scoped to the workspace (#422)", async () => {
    const occurredAt = new Date("2026-09-30T05:12:00.000Z");

    database.answers({
      rows: [
        { repo: "acme/helios", detail: { outcome: "skipped" }, occurredAt },
        { repo: null, detail: {}, occurredAt },
      ],
    });

    // A row with no subject names no repository, and is left out.
    await expect(store.lastGenerations(WORKSPACE)).resolves.toEqual([
      { repo: "acme/helios", detail: { outcome: "skipped" }, occurredAt },
    ]);

    const [statement] = database.statements;

    expect(statement.sql).toContain('distinct on ("ae"."subject_id")');
    expect(statement.sql).toContain('"ae"."organization_id" = $1');
    expect(statement.sql).toContain('order by "ae"."subject_id", "ae"."occurred_at" desc');
    expect(statement.parameters).toEqual([WORKSPACE, "knowledge.repo_map_generated", "repository"]);
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
