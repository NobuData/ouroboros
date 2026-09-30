import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { PlaybooksRepository } from "./playbooks.repository";

/**
 * The playbooks statements (#415), as the compiler produces them. Three properties are invisible
 * from a mocked method and are asserted here: every statement is **scoped to the workspace**, the
 * launch count is **counted from runs** (never read from a column), and the picker's filter is
 * **V072's own function**.
 */

const WORKSPACE = "acme-robotics-id";
const PLAYBOOK = "5eed0046-0000-4000-8000-000000000001";
const RUN = "5eed0009-0000-4000-8000-000000001791";
const FILTER = { labels: ["flaky"] };

describe("the playbooks repository", () => {
  let database: RecordingDatabase;
  let store: PlaybooksRepository;

  beforeEach(() => {
    database = recordingDatabase();
    store = new PlaybooksRepository(database.service);
  });

  /** The one statement issued. */
  function only(): { sql: string; parameters: readonly unknown[] } {
    expect(database.statements).toHaveLength(1);

    return database.statements[0];
  }

  it.each([
    ["list", (s: PlaybooksRepository) => s.list(WORKSPACE)],
    ["find", (s: PlaybooksRepository) => s.find(WORKSPACE, PLAYBOOK)],
    ["counts", (s: PlaybooksRepository) => s.counts(WORKSPACE)],
    ["delete", (s: PlaybooksRepository) => s.delete(WORKSPACE, PLAYBOOK)],
    ["workflowBySlug", (s: PlaybooksRepository) => s.workflowBySlug(WORKSPACE, "standard-fix")],
    ["runSource", (s: PlaybooksRepository) => s.runSource(WORKSPACE, RUN)],
    ["runSteers", (s: PlaybooksRepository) => s.runSteers(WORKSPACE, RUN)],
    ["issues", (s: PlaybooksRepository) => s.issues(WORKSPACE, null, { limit: 25 })],
    ["issue", (s: PlaybooksRepository) => s.issue(WORKSPACE, null, PLAYBOOK)],
  ])("%s is scoped to the workspace", async (_name, call) => {
    await call(store);

    expect(database.statements[0].parameters).toContain(WORKSPACE);
    expect(database.statements[0].sql).toMatch(/"organization_id" = \$\d/);
  });

  it("counts a playbook's launches from runs.playbook_id, in the statement", async () => {
    await store.find(WORKSPACE, PLAYBOOK);

    expect(only().sql).toContain('from "ouroboros"."runs" as "r"');
    expect(only().sql).toContain('"r"."playbook_id" = "p"."id"');
    expect(only().sql).toContain("count(*)");
  });

  it("answers counts per playbook, zero included, as numbers", async () => {
    database.answers({ rows: [{ playbookId: PLAYBOOK, runs: "9" }] });

    await expect(store.counts(WORKSPACE)).resolves.toEqual([{ playbookId: PLAYBOOK, runs: 9 }]);
    expect(only().sql).toContain('left join "ouroboros"."runs"');
  });

  it("inserts the recipe and nothing that could be a counter", async () => {
    database.answers({ rows: [{ id: PLAYBOOK }] });

    await store.insert(WORKSPACE, {
      name: "Flaky test hunt",
      description: "Hunt",
      workflowId: "wf",
      workflowVersion: 14,
      skillOverrides: "{}",
      contextPreset: "{}",
      issueFilter: null,
      sourceRunId: RUN,
    });

    expect(only().sql).toMatch(/^insert into "ouroboros"\."playbooks"/);
    expect(only().sql).not.toMatch(/count|uses|last_run/);
    expect(only().parameters).toContain(RUN);
  });

  it("never changes a playbook's provenance on update", async () => {
    database.answers({ numAffectedRows: 1n });

    await expect(
      store.update(WORKSPACE, PLAYBOOK, {
        name: "n",
        description: "d",
        workflowId: "wf",
        workflowVersion: 14,
        skillOverrides: "{}",
        contextPreset: "{}",
        issueFilter: null,
      }),
    ).resolves.toBe(true);
    expect(only().sql).not.toContain("source_run_id");
  });

  it("checks a pin against published versions only", async () => {
    await store.versionPublished("wf", 14);

    expect(only().sql).toContain('from "ouroboros"."workflow_versions"');
    expect(only().parameters).toEqual(["wf", 14]);
  });

  it("reads a run's injected skills through its injection records' skill versions", async () => {
    database.answers(
      { rows: [{ skill_version_ids: ["v1", "v2"] }, { skill_version_ids: ["v2"] }] },
      { rows: [{ id: "skill-a" }] },
    );

    await expect(store.runInjections(WORKSPACE, RUN)).resolves.toEqual({
      records: 2,
      skillIds: ["skill-a"],
    });
    expect(database.statements[1].parameters).toEqual([WORKSPACE, "v1", "v2"]);
  });

  it("reads no skill versions for a run with no injection record", async () => {
    await expect(store.runInjections(WORKSPACE, RUN)).resolves.toEqual({
      records: 0,
      skillIds: [],
    });
    expect(database.statements).toHaveLength(1);
  });

  it("reads a run's steers oldest first, leaving out the refused ones", async () => {
    database.answers({ rows: [{ payload: "focus" }, { payload: null }] });

    await expect(store.runSteers(WORKSPACE, RUN)).resolves.toEqual(["focus"]);
    expect(only().sql).toContain('"rc"."kind" = $');
    expect(only().parameters).toEqual(expect.arrayContaining(["steer", "rejected"]));
    expect(only().sql).toContain('order by "rc"."requested_at"');
  });

  it("narrows the picker with V072's playbook_issue_filter_admits, open issues only", async () => {
    await store.issues(WORKSPACE, FILTER, { q: "#485", limit: 10 });

    expect(only().sql).toContain("ouroboros.playbook_issue_filter_admits(");
    expect(only().parameters).toContain(JSON.stringify(FILTER));
    expect(only().parameters).toEqual(expect.arrayContaining(["open", "%#485%", 485, 10]));
  });

  it("passes a null filter as SQL null — V072 reads that as every issue", async () => {
    await store.issue(WORKSPACE, null, PLAYBOOK);

    expect(only().sql).toContain("ouroboros.playbook_issue_filter_admits($");
    expect(only().parameters).toContain(null);
  });

  it("escapes LIKE wildcards in the title search", async () => {
    await store.issues(WORKSPACE, null, { q: "100%_done", limit: 5 });

    expect(only().parameters).toContain("%100\\%\\_done%");
  });
});
