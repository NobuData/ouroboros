import { addRepo, workspaceWithRepo, type SeededWorkspace } from "../../testing/dashboard.fixture";
import { ApiHarness, type Person } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import {
  PRIMARY_VOLUME,
  SECOND_VOLUME,
  seedVolume,
  volumeCounts,
  volumeFacets,
  volumeMatching,
  volumeOrdered,
  type VolumeFilter,
  type VolumeIssue,
  type VolumeSort,
} from "../../testing/volume.fixture";
import {
  FIXTURE_OWNER,
  FIXTURE_REPO,
  issuePayload,
  stubIssues,
  type IssuesStub,
} from "../backlog-sync/backlog-sync.fixture";
import { BacklogSyncService } from "../backlog-sync/backlog-sync.service";
import { SCHEMA_NAME } from "../db/schema";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { FIXTURE_TOKEN } from "../github/github.fixture";
import { DEFAULT_LIMIT } from "../tenancy/pagination";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import { MINIMUM_SYNC_INTERVAL_SECONDS } from "./debounce";
import type { IssueDetail } from "./detail.resources";
import type { BacklogListing } from "./listing.resources";
import { QUEUE_ERRORS, QUEUE_ISSUE_PROBLEMS, type QueueIssueProblem } from "./queue.errors";
import type { QueuedSelection } from "./queue.resources";
import { BACKLOG_SYNC_ERRORS } from "./sync.errors";
import type { SyncStatusResource } from "./sync.resources";

/**
 * The backlog API as one surface, over a population big enough for its parameters to matter
 * (M.5, [#114](https://github.com/NobuData/ouroboros/issues/114)).
 *
 * M.1–M.4 each shipped an integration suite of its own, and each is a suite about *one route*
 * against mockup 03's nine rows: does the listing reproduce the screen, does the panel carry
 * the fields `#485` displays, does a queue write roll back, does the trigger advance freshness.
 * They are the right tests and they are deliberately not repeated here. What none of them can
 * be is the thing this ticket names: the **matrix** — every ordering, every state, chips ANDed,
 * the search box's three matches and the window, over a backlog too large to read at a glance,
 * with a second organisation holding an *identical* backlog on the other side of the tenant
 * boundary.
 *
 * ---------------------------------------------------------------------------
 * ## Every filter case is also an isolation case
 *
 * The ticket asks for a filter matrix and it asks that *no parameter combination leak rows
 * across the tenant boundary*. Written as two suites those are thirty cases and thirty more,
 * and the second thirty are the ones that would quietly stop covering the first thirty's
 * parameters the day a case was added to one and not the other.
 *
 * So they are one suite. {@link arrange} seeds **two** workspaces with the same generated
 * population — the same issue numbers, the same titles, the same labels — and every case
 * asserts three things about the answer one of them gets:
 *
 *   * the rows, in order, are exactly what {@link volumeOrdered} says they should be;
 *   * the counts beside them are exactly what {@link volumeCounts} says;
 *   * and **every row id returned belongs to the workspace that asked**.
 *
 * The identical seeds are what make that last assertion sharp. Numbers would not catch a leak
 * between two backlogs numbered the same, and a count would not catch a swap — `github_issues.id`
 * is the only field that distinguishes one workspace's `#1005` from the other's, so it is the
 * field the sweep is written against. Drop `where organization_id = …` from
 * `BacklogListingRepository.scope` and every one of these cases fails on the row count *and* on
 * the ids; narrow it to the wrong workspace and only the ids notice.
 *
 * ## The expected answer is computed, never recorded
 *
 * `volume.fixture.ts` carries the population **and** a plain restatement of the endpoint's own
 * rules over it. A case here says *which parameters*, and the expectation is derived by running
 * that restatement — so a case cannot be "fixed" by pasting in what the endpoint returned, and
 * a change to the population reaches every expectation at once. The fixture's header argues the
 * trade in full.
 *
 * ## What the other four suites are, and why they are short
 *
 * The queue, the panel and the trigger each already have a thorough suite of their own. What
 * they get here is the half that only volume and a second organisation can show: an
 * all-or-nothing rollback where the batch is twenty rows rather than three, a panel read for
 * both shapes off a backlog where most issues are neither, the minimum-interval guard *and* the
 * in-flight refusal as two separate answers, and the cross-tenant `404`s asserted from a
 * workspace that holds an issue with the same number.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

const BACKLOG = "/api/v1/backlog";
const QUEUE = "/api/v1/backlog/queue";
const SYNC_PATH = "/api/v1/backlog/sync";
const STATUS_PATH = "/api/v1/backlog/sync-status";
const TOKEN_PATH = "/api/v1/settings/github-token";

/** How long a test waits for a cycle it did not start to finish. */
const CYCLE_DEADLINE_MS = 10_000;

/**
 * How far back a test dates the cycle it runs to arrange one.
 *
 * Past {@link MINIMUM_SYNC_INTERVAL_SECONDS}, so the trigger under test is refused by nothing
 * that came before it. `BacklogSyncService.cycle()` takes its clock for exactly this reason.
 */
const BACKDATED_MS = (MINIMUM_SYNC_INTERVAL_SECONDS + 30) * 1000;

/**
 * Compare two numbers. `Array.prototype.sort`'s default is lexicographic, which puts `#1005`
 * before `#484` and would make a set comparison over issue numbers pass or fail by accident.
 *
 * @param left - One number.
 * @param right - The other.
 * @returns Their difference, which is what `sort` wants.
 */
const ascending = (left: number, right: number): number => left - right;

/** The two workspaces a case reads across, and the repositories in the first. */
interface Arrangement {
  /** The workspace every request is made against unless a case says otherwise. */
  readonly workspace: SeededWorkspace;
  /** Its only member, who owns it. */
  readonly owner: Person;
  /** A second repository in {@link workspace}, holding {@link SECOND_VOLUME}. */
  readonly secondRepoId: string;
  /** The other workspace, seeded identically — the boundary every case is read across. */
  readonly neighbour: SeededWorkspace;
  /** Its only member, who is a stranger to {@link workspace}. */
  readonly neighbourOwner: Person;
}

/** Which repository a case narrows to, for the one parameter that could reach across. */
type RepoChoice = "primary" | "second" | "foreign";

/**
 * One cell of the matrix — the controls a person set, and nothing about the answer.
 *
 * The query string is **built** from these fields by {@link queryOf} and the expectation is
 * **derived** from them by {@link expected}, so the two cannot describe different requests.
 */
interface MatrixCase {
  /** What the case is, as the test's name. */
  readonly name: string;
  /** The *Repository* select. Absent is the whole workspace. */
  readonly repo?: RepoChoice;
  /** The chip set, ANDed. */
  readonly labels?: readonly string[];
  /**
   * How the chips are written into the URL.
   *
   * `?labels=bug,tech-debt` is what a URL-writing filter bar produces; `?labels=bug&labels=…`
   * is what most HTTP libraries emit for a list. Both are things a real client sends, so the
   * matrix runs one combination each way and expects the same answer.
   */
  readonly labelsSpelling?: "comma" | "repeated";
  /** The *State* select. Absent is the endpoint's default, `open`. */
  readonly state?: "open" | "closed" | "all";
  /** The *Sort* select. Absent is the endpoint's default, `effort`. */
  readonly sort?: VolumeSort;
  /** The search box. */
  readonly q?: string;
  /** The window. Absent is the #31 convention's own default. */
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * The matrix.
 *
 * Grouped by the control each case is about, and every group ends with a case that combines
 * its control with another — because a filter that works alone and a filter that works beside
 * a sort are two claims, and it is the second that a `where` folded into the wrong clause
 * breaks.
 */
const MATRIX: readonly MatrixCase[] = [
  { name: "the screen as it first draws, with no query string at all" },

  // --- the four orderings -------------------------------------------------
  { name: "sort=effort, the default written out", sort: "effort" },
  { name: "sort=confidence, most certain first, unestimated last", sort: "confidence" },
  { name: "sort=updated, most recently touched first", sort: "updated" },
  { name: "sort=number, newest issue first", sort: "number" },

  // --- the state select ---------------------------------------------------
  { name: "state=closed, which the default hides", state: "closed" },
  { name: "state=all, the only way to ask for both", state: "all" },
  { name: "state=all beside a sort that reads the estimate", state: "all", sort: "confidence" },

  // --- the chip set -------------------------------------------------------
  { name: "one chip", labels: ["bug"] },
  { name: "two chips, ANDed rather than ORed", labels: ["bug", "priority-high"] },
  {
    name: "the same two spelled as repeated parameters",
    labels: ["bug", "priority-high"],
    labelsSpelling: "repeated",
  },
  { name: "three chips", labels: ["bug", "priority-high", "tech-debt"] },
  { name: "two chips no issue carries together", labels: ["bug", "enhancement"] },
  { name: "a chip across every state", labels: ["telemetry"], state: "all" },
  { name: "a chip beside a sort", labels: ["tech-debt"], sort: "number" },

  // --- the search box -----------------------------------------------------
  { name: "a #number", q: "#1005" },
  { name: "the same number without the hash", q: "1005" },
  { name: "a substring of the title", q: "watchdog" },
  { name: "a label name in full", q: "motor-control" },
  { name: "a term that is both a label and a word in titles", q: "telemetry" },
  { name: "digits that name no issue but appear in two titles", q: "100" },
  { name: "a per cent sign a person typed", q: "100%" },
  { name: "an underscore a person typed", q: "duty_cycle" },
  { name: "a search nothing matches", q: "no-such-issue-anywhere" },
  { name: "a search beside a state", q: "motor", state: "closed" },
  { name: "a search beside a chip", q: "watchdog", labels: ["tech-debt"] },

  // --- the repository select ----------------------------------------------
  { name: "narrowed to the primary repository", repo: "primary" },
  { name: "narrowed to the second repository", repo: "second" },
  { name: "narrowed to a repository the other workspace owns", repo: "foreign" },
  {
    name: "narrowed to the second repository, filtered and sorted",
    repo: "second",
    labels: ["bug"],
    state: "all",
    sort: "number",
  },

  // --- the window ---------------------------------------------------------
  { name: "the second page", limit: DEFAULT_LIMIT, offset: DEFAULT_LIMIT },
  { name: "a full page of a hundred", limit: 100 },
  { name: "a window past the end of the match", limit: 10, offset: 500 },

  // --- all of them at once ------------------------------------------------
  {
    name: "every control at once",
    repo: "primary",
    labels: ["bug"],
    state: "all",
    sort: "confidence",
    q: "watchdog",
    limit: 5,
    offset: 1,
  },
];

describe("the backlog API, over seeded volume and beside a second organisation", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    // A day, so the application's own sync loop cannot poll in the middle of a test and move a
    // freshness stamp — or trip the minimum-interval guard — under an assertion about it.
    api = await ApiHarness.start({ OURO_BACKLOG_SYNC_INTERVAL_SECONDS: "86400" });
  });

  afterAll(() => api.close());

  /**
   * Two workspaces holding the same backlog, on an empty database.
   *
   * The neighbour is seeded with the **same** populations rather than a different one, which is
   * what makes the id assertions in {@link assertListing} meaningful — see this file's header.
   *
   * @returns Both workspaces, their owners, and the second repository's id.
   */
  async function arrange(): Promise<Arrangement> {
    await api.truncate();

    const owner = await api.signIn();
    const workspace = await workspaceWithRepo(api, owner);
    const secondRepoId = await addRepo(api, workspace);

    await seedVolume(api, workspace, PRIMARY_VOLUME);
    await seedVolume(api, workspace, SECOND_VOLUME, secondRepoId);

    const neighbourOwner = await api.signIn({ email: "neighbour@ouroboros.invalid" });
    const neighbour = await workspaceWithRepo(api, neighbourOwner);
    // Named differently from the first workspace's second repository on purpose: the rollback
    // case re-parents that one *into this organisation*, and two repositories with one name
    // under one GitHub organisation is a collision the unique key would refuse before the
    // trigger under test ever saw the row.
    const neighbourSecond = await addRepo(api, neighbour, "atlas-tools");

    await seedVolume(api, neighbour, PRIMARY_VOLUME);
    await seedVolume(api, neighbour, SECOND_VOLUME, neighbourSecond);

    return { workspace, owner, secondRepoId, neighbour, neighbourOwner };
  }

  /**
   * Read the listing as somebody.
   *
   * @param person - Who is asking.
   * @param workspace - Which workspace, as `X-Ouro-Tenant`.
   * @param query - The query string, already encoded.
   * @param status - The status expected.
   * @returns The response body.
   */
  async function list(
    person: Person,
    workspace: SeededWorkspace,
    query = "",
    status = 200,
  ): Promise<BacklogListing> {
    const response = await api
      .as(person)("get", query === "" ? BACKLOG : `${BACKLOG}?${query}`)
      .set(TENANT_HEADER, workspace.slug)
      .expect(status);

    return bodyOf<BacklogListing>(response);
  }

  /**
   * Every `github_issues.id` a workspace owns.
   *
   * Read from the database rather than from a listing, so the set a leak would be measured
   * against is not itself produced by the endpoint under test.
   *
   * @param workspace - Whose issues.
   * @returns The ids.
   */
  async function issueIdsOf(workspace: SeededWorkspace): Promise<Set<string>> {
    const { rows } = await api.sql.query<{ id: string }>(
      `select id from ${SCHEMA_NAME}.github_issues where organization_id = $1`,
      [workspace.id],
    );

    return new Set(rows.map((row) => row.id));
  }

  /**
   * The row ids a workspace gave these issue numbers, in the order asked for.
   *
   * @param workspace - Whose backlog.
   * @param numbers - GitHub's issue numbers.
   * @param repoId - Which repository, for a workspace holding the number twice.
   * @returns `github_issues.id`, one per number, in the same order.
   */
  async function idsOf(
    workspace: SeededWorkspace,
    numbers: readonly number[],
    repoId: string = workspace.repoId,
  ): Promise<string[]> {
    const { rows } = await api.sql.query<{ id: string; number: number }>(
      `select id, number from ${SCHEMA_NAME}.github_issues
        where organization_id = $1 and github_repo_id = $2 and number = any($3::int[])`,
      [workspace.id, repoId, [...numbers]],
    );

    return numbers.map((number) => rows.find((row) => row.number === number)!.id);
  }

  /**
   * The rows a case's request should be able to see at all — its *scope*.
   *
   * The workspace's whole backlog, or one repository's, or — for a repository another
   * workspace owns — nothing. The scope is what the page head's two figures and the chip set
   * are computed over, because neither narrows with the row filters.
   *
   * @param matrixCase - The cell.
   * @returns The rows in scope, in the population's own order.
   */
  function scopeOf(matrixCase: MatrixCase): readonly VolumeIssue[] {
    switch (matrixCase.repo) {
      case "primary":
        return PRIMARY_VOLUME;
      case "second":
        return SECOND_VOLUME;
      case "foreign":
        // A repository belonging to another workspace is a predicate under the workspace
        // scope, not an error: *"your backlog, in a repository that is not yours"* is honestly
        // empty. A leak here would be the worst of the thirty, so the case is in the matrix
        // rather than in a test of its own.
        return [];
      default:
        return [...PRIMARY_VOLUME, ...SECOND_VOLUME];
    }
  }

  /**
   * The query string a case sends.
   *
   * @param matrixCase - The cell.
   * @param context - The arrangement, for the repository ids only a run knows.
   * @returns The encoded query string, empty when the case sets no control at all.
   */
  function queryOf(matrixCase: MatrixCase, context: Arrangement): string {
    const parameters = new URLSearchParams();

    if (matrixCase.repo !== undefined) {
      parameters.set(
        "repo",
        matrixCase.repo === "primary"
          ? context.workspace.repoId
          : matrixCase.repo === "second"
            ? context.secondRepoId
            : context.neighbour.repoId,
      );
    }

    if (matrixCase.labels !== undefined) {
      if (matrixCase.labelsSpelling === "repeated") {
        for (const label of matrixCase.labels) parameters.append("labels", label);
      } else {
        parameters.set("labels", matrixCase.labels.join(","));
      }
    }

    if (matrixCase.state !== undefined) parameters.set("state", matrixCase.state);
    if (matrixCase.sort !== undefined) parameters.set("sort", matrixCase.sort);
    if (matrixCase.q !== undefined) parameters.set("q", matrixCase.q);
    if (matrixCase.limit !== undefined) parameters.set("limit", String(matrixCase.limit));
    if (matrixCase.offset !== undefined) parameters.set("offset", String(matrixCase.offset));

    return parameters.toString();
  }

  /** What a case's request should answer with, computed from the model alone. */
  interface Expectation {
    /** The issue numbers, in order, for the window the request asked for. */
    readonly numbers: readonly number[];
    /** How many rows the whole filter matched, before the window. */
    readonly total: number;
    /** The page head's two figures, over the scope rather than the filter. */
    readonly openCount: number;
    readonly sizedCount: number;
    /** The chip set, over the scope rather than the filter. */
    readonly labelFacets: readonly string[];
  }

  /**
   * Derive what a case should get, by running the endpoint's rules over the model.
   *
   * @param matrixCase - The cell.
   * @returns The expected answer.
   */
  function expected(matrixCase: MatrixCase): Expectation {
    const scope = scopeOf(matrixCase);
    const filter: VolumeFilter = {
      ...(matrixCase.labels === undefined ? {} : { labels: matrixCase.labels }),
      ...(matrixCase.state === undefined ? {} : { state: matrixCase.state }),
      ...(matrixCase.q === undefined ? {} : { q: matrixCase.q }),
    };

    const matching = volumeMatching(scope, filter);
    const ordered = volumeOrdered(matching, matrixCase.sort ?? "effort");
    const offset = matrixCase.offset ?? 0;
    const limit = matrixCase.limit ?? DEFAULT_LIMIT;

    return {
      numbers: ordered.slice(offset, offset + limit).map((issue) => issue.number),
      total: matching.length,
      ...volumeCounts(scope),
      labelFacets: volumeFacets(scope),
    };
  }

  describe("the filter, sort and search matrix", () => {
    let context: Arrangement;
    let mine: Set<string>;

    // Arranged once: every case in this block reads and none of them writes, so re-seeding
    // thirty times would be thirty times the setup for the same database. The blocks that do
    // write arrange per test, and each block empties the database before it arranges.
    beforeAll(async () => {
      context = await arrange();
      mine = await issueIdsOf(context.workspace);
    });

    it.each(MATRIX)("answers $name", async (matrixCase) => {
      const answer = expected(matrixCase);
      const listing = await list(context.owner, context.workspace, queryOf(matrixCase, context));

      // The rows and their order, as one equality rather than a spot check: every one of the
      // four sorts is total over this population, so there is exactly one right answer.
      expect(listing.items.map((row) => row.number)).toEqual(answer.numbers);
      expect(listing.total).toBe(answer.total);

      // The head and the chip set describe the *scope*, so they do not move when the filter
      // bar does — which is only visible in a matrix where most cases do filter.
      expect(listing.meta.openCount).toBe(answer.openCount);
      expect(listing.meta.sizedCount).toBe(answer.sizedCount);
      expect(listing.labelFacets).toEqual(answer.labelFacets);

      // The isolation half. The neighbour holds the same numbers, so the id is the only field
      // that can tell whose row this is.
      for (const row of listing.items) {
        expect(mine.has(row.id)).toBe(true);
      }
    });

    it("gives the neighbour their own rows for the identical request", async () => {
      // The other direction of the same claim, and the one that catches a scope narrowed to a
      // *constant* workspace rather than to the caller's: every case above would still pass.
      const theirs = await issueIdsOf(context.neighbour);
      const listing = await list(context.neighbourOwner, context.neighbour, "sort=number");

      expect(listing.items.map((row) => row.number)).toEqual(
        expected({ name: "", sort: "number" }).numbers,
      );

      for (const row of listing.items) {
        expect(theirs.has(row.id)).toBe(true);
        expect(mine.has(row.id)).toBe(false);
      }
    });

    it("pages through the whole match without repeating or losing a row", async () => {
      // The window, walked. A tie-break that is not total shows up here and nowhere else: two
      // rows equal on every ordering key can swap between pages, so one is served twice and
      // another never.
      const seen: number[] = [];
      const limit = 50;

      for (let offset = 0; ; offset += limit) {
        const page = await list(
          context.owner,
          context.workspace,
          `state=all&sort=effort&limit=${limit}&offset=${offset}`,
        );

        seen.push(...page.items.map((row) => row.number));

        if (page.items.length < limit) break;
      }

      const whole = volumeOrdered(
        volumeMatching([...PRIMARY_VOLUME, ...SECOND_VOLUME], { state: "all" }),
        "effort",
      );

      expect(seen).toEqual(whole.map((issue) => issue.number));
      expect(new Set(seen).size).toBe(seen.length);
    });

    it("reads the estimate in force on an issue estimated twice", async () => {
      // Latest wins, at volume. The population re-estimates every twentieth issue and makes
      // every visible field differ between the two versions, so a join that took an arbitrary
      // row would answer the superseded effort about half the time.
      const listing = await list(
        context.owner,
        context.workspace,
        `repo=${context.workspace.repoId}&state=all&sort=number&limit=100`,
      );
      const rows = new Map(listing.items.map((row) => [row.number, row]));
      const twice = PRIMARY_VOLUME.filter(
        (issue) => issue.superseded !== null && rows.has(issue.number),
      );

      // Asserted rather than assumed: a window that happened to contain none of them would
      // otherwise make this test pass by checking nothing.
      expect(twice.length).toBeGreaterThan(1);

      for (const issue of twice) {
        const row = rows.get(issue.number)!;

        expect(row.estimate).not.toBeNull();
        expect(row.estimate!.effort).toBe(issue.estimate!.effort);
        expect(row.estimate!.confidence).toBe(issue.estimate!.confidence);
        expect(row.estimate!.effort).not.toBe(issue.superseded!.effort);
      }
    });

    it("keeps the sizing status and the estimate as separate answers", async () => {
      // `needs_human` *with* an estimate and `estimating` *without* one are the two shapes that
      // stop either column being derived from the other — and at volume there are a dozen of
      // each rather than one of each.
      //
      // Read under `sort=number` deliberately. `sort=effort` puts every unestimated row last,
      // so a page of it would be a hundred `sized` rows and would prove nothing about the two
      // shapes this test is named for.
      const listing = await list(
        context.owner,
        context.workspace,
        `repo=${context.workspace.repoId}&state=all&sort=number&limit=100`,
      );
      const model = new Map(PRIMARY_VOLUME.map((issue) => [issue.number, issue]));

      for (const row of listing.items) {
        const issue = model.get(row.number)!;

        expect(row.sizingStatus).toBe(issue.sizingStatus);
        // The claim, row by row: the estimate is present exactly when the population wrote one,
        // and never because of what the status says.
        expect(row.estimate === null).toBe(issue.estimate === null);
      }

      const held = listing.items.filter((row) => row.sizingStatus === "needs_human");
      const working = listing.items.filter((row) => row.sizingStatus === "estimating");

      expect(held.length).toBeGreaterThan(0);
      expect(working.length).toBeGreaterThan(0);
      expect(held.every((row) => row.estimate !== null)).toBe(true);
      expect(working.every((row) => row.estimate === null)).toBe(true);
    });

    it("refuses a value outside a parameter's vocabulary, before a statement is issued", async () => {
      // The pipe, not the database: a request that could not name rows costs no connection.
      // One per parameter that has a vocabulary, because an `@IsIn` deleted from one leaves
      // every other parameter's assertion green.
      for (const query of ["state=archived", "sort=alphabetical", "limit=101", "repo=not-a-uuid"]) {
        const response = await api
          .as(context.owner)("get", `${BACKLOG}?${query}`)
          .set(TENANT_HEADER, context.workspace.slug)
          .expect(422);

        expect(bodyOf<ErrorEnvelope>(response).code).toBe("validation_failed");
      }
    });
  });

  describe("the transactional queue write", () => {
    let context: Arrangement;

    beforeEach(async () => {
      context = await arrange();
    });

    /**
     * Press a queue button as somebody.
     *
     * @param person - Who is asking.
     * @param workspace - Which workspace, as `X-Ouro-Tenant`.
     * @param body - The selection, and the workflow when one is named.
     * @param status - The status expected.
     * @returns The response.
     */
    function queue(
      person: Person,
      workspace: SeededWorkspace,
      body: { issueIds: string[]; workflow?: string },
      status = 201,
    ) {
      return api
        .as(person)("post", QUEUE)
        .set(TENANT_HEADER, workspace.slug)
        .send(body)
        .expect(status);
    }

    /**
     * How many rows a workspace's queue holds — what *"nothing is written"* is a claim about.
     *
     * @param workspace - Whose queue.
     * @returns The count.
     */
    async function queueSize(workspace: SeededWorkspace): Promise<number> {
      const { rows } = await api.sql.query<{ count: string }>(
        `select count(*)::text as count from ${SCHEMA_NAME}.queue_items where organization_id = $1`,
        [workspace.id],
      );

      return Number(rows[0].count);
    }

    /** The population's issues that may be queued, in number order. */
    const queueable = PRIMARY_VOLUME.filter((issue) => issue.sizingStatus === "sized");

    it("queues a selection and answers the sum of the estimates it wrote", async () => {
      const selected = queueable.slice(0, 12);
      const issueIds = await idsOf(
        context.workspace,
        selected.map((issue) => issue.number),
      );

      const created = bodyOf<QueuedSelection>(
        await queue(context.owner, context.workspace, { issueIds }),
      );

      // The order is the caller's and it is kept: positions are handed out down the list.
      expect(created.items.map((item) => item.issueNumber)).toEqual(
        selected.map((issue) => issue.number),
      );
      expect(created.items.map((item) => item.position)).toEqual(
        selected.map((_unused, index) => index + 1),
      );

      // Copied from the estimate's breakdown rather than recomputed — so the number here is
      // the population's own arithmetic, summed in this test and nowhere in the service.
      expect(created.estMinutes).toBe(
        selected.reduce((total, issue) => total + issue.estimate!.estMinutes, 0),
      );
      expect(created.items.map((item) => item.workflowTag)).toEqual(
        selected.map((issue) => issue.estimate!.suggestedWorkflow),
      );
      expect(await queueSize(context.workspace)).toBe(selected.length);
    });

    it("refuses a selection holding an unsized issue with a 422, and writes nothing", async () => {
      // The three ways an issue is not ready, all in one selection, among a dozen that are —
      // which is the shape a person actually produces by selecting a page of the table.
      const notReady = (["estimating", "unsized", "needs_human"] as const).map((status) =>
        PRIMARY_VOLUME.find((issue) => issue.sizingStatus === status)!,
      );
      const selected = [...queueable.slice(0, 12), ...notReady];
      const issueIds = await idsOf(
        context.workspace,
        selected.map((issue) => issue.number),
      );

      const envelope = bodyOf<ErrorEnvelope>(
        await queue(context.owner, context.workspace, { issueIds }, 422),
      );

      expect(envelope.code).toBe(QUEUE_ERRORS.notQueueable);

      // Per-issue, so N.4 can name the offenders rather than showing a generic failure — and
      // *only* the offenders, which is what makes the list worth rendering.
      const problems = envelope.details.issues as readonly QueueIssueProblem[];

      // Flattened rather than mapped with a `!`, so a problem that named no issue number drops
      // out of the comparison and fails it — which is the honest reading of *"names the
      // offender"*.
      const offenders = problems.flatMap((problem) =>
        problem.issueNumber === undefined ? [] : [problem.issueNumber],
      );

      expect(offenders.sort(ascending)).toEqual(
        notReady.map((issue) => issue.number).sort(ascending),
      );
      expect(problems.every((problem) => problem.code === QUEUE_ISSUE_PROBLEMS.notSized)).toBe(
        true,
      );

      // Not even the twelve that were ready.
      expect(await queueSize(context.workspace)).toBe(0);
    });

    it("refuses a second press with a 409, and writes nothing the second time", async () => {
      const selected = queueable.slice(0, 8);
      const issueIds = await idsOf(
        context.workspace,
        selected.map((issue) => issue.number),
      );

      await queue(context.owner, context.workspace, { issueIds });

      // A selection that overlaps the queue by one row is still refused whole — the overlap is
      // the last of the eight, so a service that checked only the first would answer `201`.
      const again = await idsOf(
        context.workspace,
        queueable.slice(7, 15).map((issue) => issue.number),
      );
      const envelope = bodyOf<ErrorEnvelope>(
        await queue(context.owner, context.workspace, { issueIds: again }, 409),
      );

      expect(envelope.code).toBe(QUEUE_ERRORS.conflict);
      expect((envelope.details.issues as readonly QueueIssueProblem[]).length).toBe(1);
      expect(await queueSize(context.workspace)).toBe(selected.length);
    });

    it("rolls the whole batch back when the database refuses its last row", async () => {
      // The all-or-nothing criterion, at a batch size where a partial write would be obvious
      // and unrecoverable: twenty rows accepted and one refused. The refusal is arranged in the
      // *database* — a repository re-parented onto another workspace's GitHub organisation,
      // which the shared `repo_in_organization` trigger refuses on the next row written against
      // it while leaving the issues already mirrored under it in place.
      await api.sql.query(
        `update ${SCHEMA_NAME}.github_repos
            set org_id = (select id from ${SCHEMA_NAME}.github_orgs where organization_id = $2)
          where id = $1`,
        [context.secondRepoId, context.neighbour.id],
      );

      const good = await idsOf(
        context.workspace,
        queueable.slice(0, 20).map((issue) => issue.number),
      );
      const [poisoned] = await idsOf(
        context.workspace,
        [SECOND_VOLUME.find((issue) => issue.sizingStatus === "sized")!.number],
        context.secondRepoId,
      );

      const envelope = bodyOf<ErrorEnvelope>(
        await queue(context.owner, context.workspace, { issueIds: [...good, poisoned] }, 500),
      );

      // Nothing survives — not the twenty that were written before the twenty-first failed.
      expect(await queueSize(context.workspace)).toBe(0);

      // And the answer says nothing about the database that refused it.
      expect(envelope.code).toBe("internal_error");
      expect(JSON.stringify(envelope)).not.toContain("queue_items");
    });

    it("answers a 404 for the neighbour's issues, which carry the same numbers", async () => {
      // The cross-org criterion where it is sharpest: the ids are real, the numbers are ones
      // this workspace also holds, and the only thing separating them is the scope.
      const theirs = await idsOf(
        context.neighbour,
        queueable.slice(0, 3).map((issue) => issue.number),
      );
      const mineToo = await idsOf(context.workspace, [queueable[5].number]);

      const envelope = bodyOf<ErrorEnvelope>(
        await queue(context.owner, context.workspace, { issueIds: [...mineToo, ...theirs] }, 404),
      );

      expect(envelope.code).toBe(QUEUE_ERRORS.notFound);

      // Only the ids that were refused, and a `404` rather than a `403`: a `403` would confirm
      // that a guessed id names a real issue somewhere.
      expect(
        (envelope.details.issues as readonly QueueIssueProblem[])
          .map((problem) => problem.issueId)
          .sort(),
      ).toEqual([...theirs].sort());
      expect(await queueSize(context.workspace)).toBe(0);
      expect(await queueSize(context.neighbour)).toBe(0);
    });

    it("flips the listing's queued pill for the rows it wrote and no others", async () => {
      const selected = queueable.slice(0, 6);
      const issueIds = await idsOf(
        context.workspace,
        selected.map((issue) => issue.number),
      );

      await queue(context.owner, context.workspace, { issueIds });

      const queued = new Set(selected.map((issue) => issue.number));
      const listing = await list(
        context.owner,
        context.workspace,
        `repo=${context.workspace.repoId}&state=all&limit=100`,
      );

      for (const row of listing.items) {
        expect(row.queued).toBe(queued.has(row.number));
      }

      // The neighbour's identical backlog is untouched, pills included.
      const theirs = await list(
        context.neighbourOwner,
        context.neighbour,
        `repo=${context.neighbour.repoId}&state=all&limit=100`,
      );

      expect(theirs.items.some((row) => row.queued)).toBe(false);
    });
  });

  describe("the detail panel's two shapes", () => {
    let context: Arrangement;

    beforeAll(async () => {
      context = await arrange();
    });

    /**
     * Open the panel on an issue.
     *
     * @param person - Who is asking.
     * @param workspace - Which workspace.
     * @param id - `github_issues.id`.
     * @param status - The status expected.
     * @returns The response body.
     */
    async function open(
      person: Person,
      workspace: SeededWorkspace,
      id: string,
      status = 200,
    ): Promise<IssueDetail> {
      const response = await api
        .as(person)("get", `${BACKLOG}/${id}`)
        .set(TENANT_HEADER, workspace.slug)
        .expect(status);

      return bodyOf<IssueDetail>(response);
    }

    it("returns a renderable payload for a sized issue, history and all", async () => {
      const issue = PRIMARY_VOLUME.find((row) => row.superseded !== null)!;
      const [id] = await idsOf(context.workspace, [issue.number]);
      const detail = await open(context.owner, context.workspace, id);

      expect(detail.issue).toMatchObject({
        number: issue.number,
        title: issue.title,
        state: issue.state,
        sizingStatus: issue.sizingStatus,
        authorLogin: issue.author,
      });
      expect(detail.issue.labels).toEqual(issue.labels);

      // The estimate in force, with the panel's own fields — not the one it replaced.
      expect(detail.estimate).not.toBeNull();
      expect(detail.estimate!.version).toBe(issue.estimate!.version);
      expect(detail.estimate!.effort).toBe(issue.estimate!.effort);
      expect(detail.estimate!.breakdown.estMinutes).toBe(issue.estimate!.estMinutes);
      expect(detail.estimate!.trace.estimator).toBe("heuristic-v0");

      // Both versions, oldest first, each naming what produced it.
      expect(detail.history.map((entry) => entry.version)).toEqual([
        issue.superseded!.version,
        issue.estimate!.version,
      ]);
      expect(detail.history.every((entry) => entry.estimator === "heuristic-v0")).toBe(true);
    });

    it("returns the issue-only shape for an unsized issue, rather than a 404", async () => {
      const issue = PRIMARY_VOLUME.find((row) => row.sizingStatus === "unsized")!;
      const [id] = await idsOf(context.workspace, [issue.number]);
      const detail = await open(context.owner, context.workspace, id);

      expect(detail.issue.number).toBe(issue.number);
      expect(detail.issue.sizingStatus).toBe("unsized");
      expect(detail.estimate).toBeNull();
      expect(detail.history).toEqual([]);
    });

    it("keeps the status and the estimate as separate answers for a held issue", async () => {
      const issue = PRIMARY_VOLUME.find((row) => row.sizingStatus === "needs_human")!;
      const [id] = await idsOf(context.workspace, [issue.number]);
      const detail = await open(context.owner, context.workspace, id);

      expect(detail.issue.sizingStatus).toBe("needs_human");
      expect(detail.estimate).not.toBeNull();
      expect(detail.estimate!.effort).toBe(issue.estimate!.effort);
    });

    it("carries a null body for an issue opened without one", async () => {
      const issue = PRIMARY_VOLUME.find((row) => row.body === null)!;
      const [id] = await idsOf(context.workspace, [issue.number]);

      expect((await open(context.owner, context.workspace, id)).issue.body).toBeNull();
    });

    it("agrees with the listing row the panel was opened from", async () => {
      // Two endpoints, two statements, one row. They are written separately on purpose, so
      // only a suite that reads both can hold them together.
      const issue = PRIMARY_VOLUME.find((row) => row.sizingStatus === "sized")!;
      const [id] = await idsOf(context.workspace, [issue.number]);
      const listing = await list(
        context.owner,
        context.workspace,
        `repo=${context.workspace.repoId}&q=%23${issue.number}`,
      );
      const detail = await open(context.owner, context.workspace, id);
      const row = listing.items[0];

      expect(row.id).toBe(detail.issue.id);
      expect(detail.issue).toMatchObject({
        number: row.number,
        title: row.title,
        state: row.state,
        sizingStatus: row.sizingStatus,
        repository: row.repository,
        queued: row.queued,
      });
      expect(detail.estimate!.effort).toBe(row.estimate!.effort);
      expect(detail.estimate!.confidence).toBe(row.estimate!.confidence);
    });

    it("answers a 404 for the neighbour's issue of the same number", async () => {
      // The panel's isolation case, and the one with a body in it: a `403` would be a leak of
      // its own, and a `200` would be the neighbour's description on this workspace's screen.
      const issue = PRIMARY_VOLUME[0];
      const [theirs] = await idsOf(context.neighbour, [issue.number]);
      const refused = await open(context.owner, context.workspace, theirs, 404);

      expect(JSON.stringify(refused)).not.toContain(issue.title);
    });
  });

  describe("the sync trigger's two guards", () => {
    let github: IssuesStub;
    let owner: Person;
    let workspace: SeededWorkspace;

    beforeEach(async () => {
      await api.truncate();
      github = stubIssues();
      github.answer([issuePayload({ number: 1 })]);

      owner = await api.signIn();
      workspace = await workspaceWithRepo(api, owner, FIXTURE_REPO);

      // The sync sends the GitHub organisation's login as the route's `owner`, so it has to be
      // the login the stub answers for.
      await api.sql.query(
        `update ${SCHEMA_NAME}.github_orgs set login = $1 where organization_id = $2`,
        [FIXTURE_OWNER, workspace.id],
      );

      await api
        .as(owner)("put", TOKEN_PATH)
        .set(TENANT_HEADER, workspace.slug)
        .send({ token: FIXTURE_TOKEN })
        .expect(200);
    });

    afterEach(() => {
      github.restore();
    });

    /**
     * Hold every GitHub call open until the test lets it go.
     *
     * Wrapped **over** the stub rather than inside it, so `github.restore()` still puts the
     * process's own `fetch` back: the stub captured that before this wrapper existed.
     *
     * This is what makes *"a cycle is already running"* a fact rather than a timing. Without
     * it a test would have to race a cycle that finishes in microseconds, and the refusal it
     * collected would be `backlog_sync_too_soon` about half the time — a green test asserting
     * the wrong guard.
     *
     * @returns The release, which lets every held and future call through.
     */
    function stall(): () => void {
      const stubbed = globalThis.fetch;
      let open!: () => void;
      const gate = new Promise<void>((resolve) => {
        open = resolve;
      });

      globalThis.fetch = async (...args: Parameters<typeof fetch>) => {
        await gate;
        return stubbed(...args);
      };

      return open;
    }

    /**
     * Read the freshness stamp.
     *
     * @returns The stamp, or `null` before any cycle has written one.
     */
    async function syncedAt(): Promise<string | null> {
      const response = await api
        .as(owner)("get", STATUS_PATH)
        .set(TENANT_HEADER, workspace.slug)
        .expect(200);

      return bodyOf<SyncStatusResource>(response).syncedAt;
    }

    /**
     * Wait for the freshness stamp to become something other than what it was.
     *
     * @param before - The stamp as it stood when the trigger was accepted.
     * @returns When it has moved.
     * @throws {Error} When it has not moved inside {@link CYCLE_DEADLINE_MS}.
     */
    async function freshnessAdvances(before: string | null): Promise<void> {
      const deadline = Date.now() + CYCLE_DEADLINE_MS;

      while (Date.now() < deadline) {
        const current = await syncedAt();

        if (current !== null && current !== before) return;

        await new Promise((resolve) => setTimeout(resolve, 25));
      }

      throw new Error("the trigger was accepted and the freshness stamp never moved");
    }

    it("refuses a second trigger while the first one's cycle is still running", async () => {
      // The debounce proper — *a cycle is in flight* — which is checked before the interval,
      // because *"it is happening now"* is the more useful of the two true things to be told.
      //
      // The backdated cycle first, because the minimum-interval guard is process-wide and
      // lives in this process's memory, which `truncate` cannot reach: without it this test
      // would depend on whether anything earlier in the run had polled, and the refusal it
      // collected would be the *other* guard's.
      await api.nest.get(BacklogSyncService).cycle(new Date(Date.now() - BACKDATED_MS));

      const release = stall();
      const before = await syncedAt();

      await api.as(owner)("post", SYNC_PATH).set(TENANT_HEADER, workspace.slug).expect(202);

      const refused = await api
        .as(owner)("post", SYNC_PATH)
        .set(TENANT_HEADER, workspace.slug)
        .expect(409);

      expect(bodyOf<ErrorEnvelope>(refused).code).toBe(BACKLOG_SYNC_ERRORS.running);

      release();
      await freshnessAdvances(before);
    });

    it("refuses a trigger inside the minimum interval, with how long to wait", async () => {
      // The other guard, from a cycle that has *finished*: the clock is the last cycle's
      // start, so a cycle nobody is waiting on still holds the door for thirty seconds.
      await api.nest.get(BacklogSyncService).cycle();

      const refused = await api
        .as(owner)("post", SYNC_PATH)
        .set(TENANT_HEADER, workspace.slug)
        .expect(409);
      const envelope = bodyOf<ErrorEnvelope>(refused);

      expect(envelope.code).toBe(BACKLOG_SYNC_ERRORS.tooSoon);
      expect(envelope.details.retryAfterSeconds).toBeGreaterThan(0);
      expect(envelope.details.retryAfterSeconds).toBeLessThanOrEqual(MINIMUM_SYNC_INTERVAL_SECONDS);
    });

    it("accepts one again once the interval has passed", async () => {
      // The same arrangement with the clock moved back past the interval — which is what makes
      // the refusal above a *guard* rather than a permanent refusal after the first cycle.
      await api.nest.get(BacklogSyncService).cycle(new Date(Date.now() - BACKDATED_MS));

      const before = await syncedAt();
      const accepted = await api
        .as(owner)("post", SYNC_PATH)
        .set(TENANT_HEADER, workspace.slug)
        .expect(202);

      // The body is the status at acceptance: the cycle is running and has moved nothing yet.
      expect(bodyOf<SyncStatusResource>(accepted)).toMatchObject({
        running: true,
        syncedAt: before,
      });

      await freshnessAdvances(before);
    });
  });
});
