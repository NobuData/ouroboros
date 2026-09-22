import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { ConsoleRepository } from "./console.repository";

/**
 * The console's statements, compiled — real Kysely over a recording driver, per
 * `runs.repository.spec.ts`'s argument: this layer holds statements, not rules, so what is
 * asserted is the SQL PostgreSQL would receive.
 *
 * Two properties are asserted over the whole surface rather than sampled. **Workspace rows are
 * read under the workspace** — the repository, the pin, the route and the build job each carry
 * the `organization_id` predicate with the run's workspace, so nothing of another workspace's is
 * ever borrowed. **Transcript reads are bounded on both sides** — `seq > after` and
 * `seq <= upTo`, ordered by `seq` — which is the exactness argument in the file's header.
 */

const WORKSPACE = "acme-robotics-id";
const RUN = "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94";

describe("the console repository", () => {
  let database: RecordingDatabase;
  let console: ConsoleRepository;

  beforeEach(() => {
    database = recordingDatabase();
    console = new ConsoleRepository(database.service);
  });

  /** The one statement a call issued. */
  function only(): { sql: string; parameters: readonly unknown[] } {
    expect(database.statements).toHaveLength(1);
    return database.statements[0];
  }

  describe("workspace rows", () => {
    const scoped: readonly [string, (repository: ConsoleRepository) => Promise<unknown>][] = [
      ["repository", (repository) => repository.repository(WORKSPACE, "repo-id")],
      [
        "pinnedDefinition",
        (repository) => repository.pinnedDefinition(WORKSPACE, "standard-fix", 14),
      ],
      ["routeCap", (repository) => repository.routeCap(WORKSPACE, "implement")],
      ["reservation", (repository) => repository.reservation(WORKSPACE, "job-id")],
    ];

    it.each(scoped)("%s is read under the run's workspace", async (_name, read) => {
      await read(console);

      const { sql, parameters } = only();
      expect(sql).toMatch(/"organization_id" = \$\d/);
      expect(parameters).toContain(WORKSPACE);
    });

    it("names a repository by its GitHub org's login and its own name", async () => {
      database.answers({ rows: [{ owner: "acme", name: "helios-firmware" }] });

      expect(await console.repository(WORKSPACE, "repo-id")).toEqual({
        owner: "acme",
        name: "helios-firmware",
      });
      expect(only().sql).toContain('inner join "ouroboros"."github_orgs"');
    });

    it("finds a route by its task kind's name", async () => {
      database.answers({ rows: [{ tag: "implement-primary", max_cost_cents_per_run: 250 }] });

      expect(await console.routeCap(WORKSPACE, "implement")).toEqual({
        tag: "implement-primary",
        maxCostCentsPerRun: 250,
      });

      const { sql, parameters } = only();
      expect(sql).toContain('"task_kinds"."name" = $');
      expect(parameters).toContain("implement");
    });

    it("reads a reservation's runner through a left join, so an untaken job still answers", async () => {
      database.answers({
        rows: [{ id: "job-id", number: 483, status: "queued", runner_name: null }],
      });

      expect(await console.reservation(WORKSPACE, "job-id")).toEqual({
        id: "job-id",
        number: 483,
        status: "queued",
        runnerName: null,
      });
      expect(only().sql).toContain('left join "ouroboros"."runners"');
    });

    it.each([
      ["repository", (repository: ConsoleRepository) => repository.repository(WORKSPACE, "r")],
      ["routeCap", (repository: ConsoleRepository) => repository.routeCap(WORKSPACE, "x")],
      ["reservation", (repository: ConsoleRepository) => repository.reservation(WORKSPACE, "j")],
    ])("%s answers undefined when the row is not the workspace's", async (_name, read) => {
      expect(await read(console)).toBeUndefined();
    });
  });

  describe("run rows", () => {
    it.each([
      ["stages", (repository: ConsoleRepository) => repository.stages(RUN), "run_stages"],
      ["files", (repository: ConsoleRepository) => repository.files(RUN), "run_files"],
      ["commits", (repository: ConsoleRepository) => repository.commits(RUN), "run_commits"],
      [
        "guardrails",
        (repository: ConsoleRepository) => repository.guardrails(RUN),
        "v_run_guardrails_latest",
      ],
    ])("%s is keyed by the run", async (_name, read, table) => {
      await read(console);

      const { sql, parameters } = only();
      expect(sql).toContain(`from "ouroboros"."${table}"`);
      expect(sql).toContain('"run_id" = $1');
      expect(parameters).toEqual([RUN]);
    });

    it("orders the stepper by position, then key, then attempt", async () => {
      await console.stages(RUN);

      expect(only().sql).toMatch(/order by "position" asc, "stage_key" asc, "attempt" asc$/);
    });

    it("orders files by when they joined the change-set, and commits by the writer's seq", async () => {
      await console.files(RUN);
      await console.commits(RUN);

      expect(database.statements[0].sql).toMatch(/order by "created_at" asc, "id" asc$/);
      expect(database.statements[1].sql).toMatch(/order by "seq" asc$/);
    });

    it("sums spend through the shared ledger statement", async () => {
      database.answers({
        rows: [{ tokens_in: "0", tokens_out: "0", cost_cents: null, unpriced: "0" }],
      });

      expect(await console.spend(RUN)).toEqual({
        tokensIn: 0,
        tokensOut: 0,
        costCents: null,
        unpricedEvents: 0,
      });
      expect(only().sql).toContain('from "ouroboros"."token_usage"');
    });
  });

  describe("the transcript", () => {
    it("pages the tail between the cursor and the bound, in seq order, limited", async () => {
      await console.events(RUN, 7, 9, 200);

      const { sql, parameters } = only();
      expect(sql).toContain('from "ouroboros"."run_events"');
      expect(sql).toMatch(/"seq" > \$2 and "seq" <= \$3 order by "seq" asc limit \$4$/);
      expect(parameters).toEqual([RUN, 7, 9, 200]);
    });

    it("reads the export's lines from the projection view — never re-serialized here", async () => {
      await console.jsonl(RUN, 0, 1200, 500);

      const { sql, parameters } = only();
      expect(sql).toContain('select "seq", "line" from "ouroboros"."run_events_jsonl"');
      expect(sql).toMatch(/"seq" > \$2 and "seq" <= \$3 order by "seq" asc limit \$4$/);
      expect(parameters).toEqual([RUN, 0, 1200, 500]);
    });
  });
});
