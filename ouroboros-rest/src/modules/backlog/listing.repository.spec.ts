import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { ISSUE_ESTIMATE_EFFORTS } from "../db/schema";
import { BACKLOG_SORTS } from "./listing.dto";
import { BacklogListingRepository, type BacklogFilter } from "./listing.repository";

/**
 * The three statements, and the properties the endpoint rests on.
 *
 * Real Kysely over a recording driver, per `runs.repository.spec.ts`' argument: this layer holds
 * statements rather than rules, so what is asserted is the SQL PostgreSQL would receive. Four
 * things only this suite can see:
 *
 *   * **Every statement is scoped to one workspace** — the ticket's cross-org criterion, which
 *     is a `where` rather than a comparison somebody remembers to make.
 *   * **Each filter compiles to the operator its index answers** — `@>` for the chip set,
 *     `ilike` for the search — which is what *"every supported filter combination is
 *     index-served"* means one level above `EXPLAIN`.
 *   * **Label filtering is AND**, and is one containment rather than a chain of them.
 *   * **The estimate is a lateral**, so a twice-estimated issue is one row and not two. A plain
 *     join would pass every assertion about *content* and double the seeded `#487`.
 */

const WORKSPACE = "acme-robotics-id";
const REPO = "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10";

/** The default window, spelled out — what `windowOf({})` resolves to. */
const WINDOW = { limit: 25, offset: 0 };

/** The filter a request with no query string resolves to: open issues, nothing else. */
const OPEN: BacklogFilter = { state: "open" };

describe("the backlog listing repository", () => {
  let database: RecordingDatabase;
  let backlog: BacklogListingRepository;

  beforeEach(() => {
    database = recordingDatabase();
    backlog = new BacklogListingRepository(database.service);
  });

  /** Queue the one row `counts` reads, so the statement can be compiled. */
  function answerCounts(): void {
    database.answers({ rows: [{ total: "9", openCount: "9", sizedCount: "7" }] });
  }

  describe("scoping", () => {
    /**
     * Every read this repository can perform, as a callable — the assertion is over the surface
     * rather than a sample, so a method added without the predicate fails on the day it is
     * written.
     */
    const everyRead: readonly [
      string,
      (repository: BacklogListingRepository) => Promise<unknown>,
    ][] = [
      ["list", (repository) => repository.list(WORKSPACE, OPEN, "effort", WINDOW)],
      [
        "counts",
        (repository) => {
          answerCounts();
          return repository.counts(WORKSPACE, OPEN);
        },
      ],
      ["labelFacets", (repository) => repository.labelFacets(WORKSPACE)],
    ];

    it.each(everyRead)("%s is scoped to the workspace", async (_name, read) => {
      await read(backlog);

      expect(database.statements[0].sql).toContain("organization_id");
      expect(database.statements[0].parameters).toContain(WORKSPACE);
    });

    /** The same three reads, each narrowed to one repository. */
    const everyNarrowedRead: readonly [
      string,
      (repository: BacklogListingRepository) => Promise<unknown>,
    ][] = [
      [
        "list",
        (repository) => repository.list(WORKSPACE, { ...OPEN, repoId: REPO }, "effort", WINDOW),
      ],
      [
        "counts",
        (repository) => {
          answerCounts();
          return repository.counts(WORKSPACE, { ...OPEN, repoId: REPO });
        },
      ],
      ["labelFacets", (repository) => repository.labelFacets(WORKSPACE, REPO)],
    ];

    it.each(everyNarrowedRead)(
      "%s narrows to a repository under that scope",
      async (_name, read) => {
        // The repository is a second predicate rather than an alternative to the first, which is
        // what makes another workspace's repository id narrow to nothing rather than reach rows.
        await read(backlog);

        const { sql, parameters } = database.statements[0];

        expect(sql).toContain("github_repo_id");
        expect(parameters).toContain(WORKSPACE);
        expect(parameters).toContain(REPO);
      },
    );
  });

  describe("the rows", () => {
    it("reads the estimate in force through a lateral, newest version first", async () => {
      // Decision K4: re-estimation is a new row and the highest version wins. A plain join would
      // return the seeded `#487` twice.
      await backlog.list(WORKSPACE, OPEN, "effort", WINDOW);

      const { sql } = database.statements[0];

      expect(sql).toContain("left join lateral");
      expect(sql).toMatch(/order by "ouroboros"\."issue_estimates"\."version" desc limit \$/);
      expect(sql).toContain(
        'where "ouroboros"."issue_estimates"."github_issue_id" = "ouroboros"."github_issues"."id"',
      );
    });

    it("keeps an unestimated issue, because the table draws one", async () => {
      // `left`, not `inner`: `unsized` and `estimating` are two of the four status pills.
      await backlog.list(WORKSPACE, OPEN, "effort", WINDOW);

      expect(database.statements[0].sql).not.toContain("inner join lateral");
    });

    it("assembles `owner/name` in the statement", async () => {
      await backlog.list(WORKSPACE, OPEN, "effort", WINDOW);

      const { sql } = database.statements[0];

      expect(sql).toContain(
        '"ouroboros"."github_orgs"."login" || \'/\' || "ouroboros"."github_repos"."name"',
      );
    });

    it("windows the page, per the #31 convention", async () => {
      await backlog.list(WORKSPACE, OPEN, "effort", { limit: 10, offset: 20 });

      const { sql, parameters } = database.statements[0];

      expect(sql).toMatch(/limit \$\d+ offset \$\d+$/);
      expect(parameters).toContain(10);
      expect(parameters).toContain(20);
    });

    it("maps the joined row onto the names the resource uses", async () => {
      database.answers({
        rows: [
          {
            id: "5eed0018-0000-4000-8000-000000000485",
            number: 485,
            title: "Watchdog reset on I²C bus lockup",
            labels: ["bug", "i2c"],
            state: "open",
            sizingStatus: "sized",
            githubRepoId: REPO,
            repository: "acme-robotics/helios-firmware",
            effort: "m",
            confidence: 92,
            suggestedWorkflow: "standard-fix",
            routedModel: "claude-fable-5",
          },
        ],
      });

      const [row] = await backlog.list(WORKSPACE, OPEN, "effort", WINDOW);

      expect(row.number).toBe(485);
      expect(row.repository).toBe("acme-robotics/helios-firmware");
      expect(row.effort).toBe("m");
    });
  });

  describe("the state filter", () => {
    it("asks for one state when one was named", async () => {
      await backlog.list(WORKSPACE, { state: "closed" }, "effort", WINDOW);

      const { sql, parameters } = database.statements[0];

      expect(sql).toContain('"ouroboros"."github_issues"."state" = $');
      expect(parameters).toContain("closed");
    });

    it("asks for no state at all when `all` was", async () => {
      // The same set as `state in ('open', 'closed')`, and the shorter question keeps the index
      // prefix usable.
      await backlog.list(WORKSPACE, { state: "all" }, "effort", WINDOW);

      const { sql, parameters } = database.statements[0];

      expect(sql).not.toContain('"state" = $');
      expect(parameters).not.toContain("all");
    });

    it("compiles to the scope alone when nothing narrows it", async () => {
      // No `where true` for the planner to look past: `state=all`, no chips, no search.
      await backlog.list(WORKSPACE, { state: "all" }, "effort", WINDOW);

      const { sql } = database.statements[0];

      expect(sql).toContain('where "ouroboros"."github_issues"."organization_id" = $');
      expect(sql).not.toContain("true and");
    });
  });

  describe("the chip set", () => {
    it("ANDs the labels as one containment, which is what the GIN index answers", async () => {
      // The ticket's *multi-label filtering is AND, not OR*, and one index probe rather than a
      // chain the planner then has to intersect.
      await backlog.list(
        WORKSPACE,
        { state: "open", labels: ["bug", "tech-debt"] },
        "effort",
        WINDOW,
      );

      const { sql, parameters } = database.statements[0];

      expect(sql).toContain('"ouroboros"."github_issues"."labels" @> $');
      expect(sql.match(/@>/g)).toHaveLength(1);
      expect(parameters).toContain('["bug","tech-debt"]');
    });

    it("is absent when no chip is on", async () => {
      await backlog.list(WORKSPACE, { state: "open", labels: [] }, "effort", WINDOW);

      expect(database.statements[0].sql).not.toContain("@>");
    });
  });

  describe("the search box", () => {
    it("matches the title, a label name, and the number the text names", async () => {
      // One box, the placeholder's three matches: `ilike` on the title through the trigram index,
      // `?` on the labels through the GIN one, and an equality on the number.
      await backlog.list(WORKSPACE, { state: "open", search: "#485" }, "effort", WINDOW);

      const { sql, parameters } = database.statements[0];

      expect(sql).toContain('"ouroboros"."github_issues"."title" ilike $');
      expect(sql).toContain('"ouroboros"."github_issues"."labels" ? $');
      expect(sql).toContain('"ouroboros"."github_issues"."number" = $');
      expect(parameters).toContain("%#485%");
      expect(parameters).toContain(485);
    });

    it("asks for the label name whole, so every disjunct has an index behind it", async () => {
      // One unindexable branch makes the whole disjunction a scan — which is what a
      // `jsonb_array_elements_text(...) ilike` subquery would have been.
      await backlog.list(WORKSPACE, { state: "open", search: "watchdog" }, "effort", WINDOW);

      const { sql, parameters } = database.statements[0];

      expect(sql).not.toContain("jsonb_array_elements_text");
      expect(parameters).toContain("watchdog");
    });

    it("omits the number match when the text is not one", async () => {
      await backlog.list(WORKSPACE, { state: "open", search: "watchdog" }, "effort", WINDOW);

      const { sql, parameters } = database.statements[0];

      expect(sql).not.toContain('"number" = $');
      expect(parameters).toContain("%watchdog%");
    });

    it("sends the pattern escaped, so a wildcard a person typed is a character", async () => {
      await backlog.list(WORKSPACE, { state: "open", search: "100%" }, "effort", WINDOW);

      expect(database.statements[0].parameters).toContain("%100\\%%");
    });
  });

  describe("the orderings", () => {
    it("puts the chip order first and the unsized last", async () => {
      // The mockup's default sort, and the ticket's own words. `nulls last` is the *unsized
      // last* half: an issue with no estimate has no position in the effort array.
      await backlog.list(WORKSPACE, OPEN, "effort", WINDOW);

      const { sql, parameters } = database.statements[0];

      expect(sql).toContain("array_position(");
      expect(sql).toContain('"estimate"."effort") asc nulls last');
      expect(sql).toContain('"estimate"."confidence" desc nulls last');
      expect(parameters).toEqual(expect.arrayContaining([[...ISSUE_ESTIMATE_EFFORTS]]));
    });

    it("sorts confidence downwards, with the unestimated last rather than first", async () => {
      // PostgreSQL's default for `desc` is `nulls first`, which would float every unsized issue
      // to the top of the one sort that is about how sure the estimator is.
      await backlog.list(WORKSPACE, OPEN, "confidence", WINDOW);

      expect(database.statements[0].sql).toContain('"estimate"."confidence" desc nulls last');
    });

    it("sorts `updated` and `number` on the issue's own columns, newest first", async () => {
      await backlog.list(WORKSPACE, OPEN, "updated", WINDOW);
      await backlog.list(WORKSPACE, OPEN, "number", WINDOW);

      expect(database.statements[0].sql).toContain(
        '"ouroboros"."github_issues"."gh_updated_at" desc',
      );
      expect(database.statements[1].sql).toContain('"ouroboros"."github_issues"."number" desc');
    });

    it.each([...BACKLOG_SORTS])(
      "ends `%s` on a total order, so paging cannot repeat a row",
      async (sort) => {
        // Without the id, two rows equal on every key could swap between page 1 and page 2 — one
        // shown twice and one never.
        await backlog.list(WORKSPACE, OPEN, sort, WINDOW);

        expect(database.statements[0].sql).toMatch(
          /"ouroboros"\."github_issues"\."id" asc$|"id" asc limit/,
        );
      },
    );
  });

  describe("the counts", () => {
    it("reads all three in one pass, so the head cannot disagree with the list", async () => {
      answerCounts();

      await backlog.counts(WORKSPACE, OPEN);

      expect(database.statements).toHaveLength(1);
      expect(database.statements[0].sql.match(/count\(\*\) filter/g)).toHaveLength(3);
    });

    it("counts the head's figures over the scope and the total over the filter", async () => {
      // The head describes the backlog and the table describes the filter — so the chip set and
      // the search reach the `total`'s own `filter (where …)` and nothing else.
      answerCounts();

      await backlog.counts(WORKSPACE, { state: "closed", labels: ["bug"], search: "watchdog" });

      const { sql } = database.statements[0];
      const [total, open, sized] = sql.split(" as ");

      expect(total).toContain("@>");
      expect(total).toContain("ilike");
      expect(open).not.toContain("@>");
      expect(sized).not.toContain("ilike");
    });

    it("asks for open issues, and for the sized among them", async () => {
      // *"9 open issues. 7 already sized."* is one sentence about one set: an issue sized and
      // then closed is in neither figure.
      answerCounts();

      await backlog.counts(WORKSPACE, OPEN);

      const { sql, parameters } = database.statements[0];

      expect(sql).toContain('"ouroboros"."github_issues"."sizing_status" = $');
      expect(parameters).toContain("sized");
      expect(parameters).toContain("open");
    });

    it("reads a bigint count as a number", async () => {
      // `pg` hands `count(*)` back as a string rather than risk losing precision. A `total` left
      // as one is a `"9"` on the wire where the specification says integer.
      answerCounts();

      expect(await backlog.counts(WORKSPACE, OPEN)).toEqual({
        total: 9,
        openCount: 9,
        sizedCount: 7,
      });
    });
  });

  describe("the chip set's facets", () => {
    it("collapses every row's labels into a distinct, ordered set", async () => {
      await backlog.labelFacets(WORKSPACE);

      const { sql } = database.statements[0];

      expect(sql).toContain("select distinct names.label");
      expect(sql).toContain("cross join lateral jsonb_array_elements_text(issues.labels)");
      expect(sql).toContain("order by names.label asc");
    });

    it("is scoped by the workspace and the repository and by nothing else", async () => {
      // Not by the chip set itself: `labels=bug` ANDed here would leave only the labels that
      // co-occur with `bug`, so selecting one chip would delete the set it was selected from.
      await backlog.labelFacets(WORKSPACE, REPO);

      const { sql } = database.statements[0];

      expect(sql).not.toContain("@>");
      expect(sql).not.toContain("ilike");
      expect(sql).not.toContain("state");
    });

    it("qualifies the schema, which a raw fragment does not get for free", async () => {
      // `WithSchemaPlugin` rewrites the builder's tables and cannot reach inside a template.
      await backlog.labelFacets(WORKSPACE);

      expect(database.statements[0].sql).toContain('"ouroboros".github_issues');
    });

    it("answers the names, in the order the statement asked for", async () => {
      database.answers({ rows: [{ label: "bug" }, { label: "i2c" }, { label: "watchdog" }] });

      expect(await backlog.labelFacets(WORKSPACE)).toEqual(["bug", "i2c", "watchdog"]);
    });
  });
});
