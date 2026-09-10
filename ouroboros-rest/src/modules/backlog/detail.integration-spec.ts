import { ApiHarness, type Person } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import {
  PRIMARY_REPO,
  workspaceWithRepo,
  type SeededWorkspace,
} from "../../testing/dashboard.fixture";
import { INTAKE_ESTIMATES, INTAKE_ISSUES, seedIntake } from "../../testing/intake.fixture";
import { SCHEMA_NAME } from "../db/schema";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { ESTIMATION_ERRORS } from "../estimation/estimation.errors";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import type { BacklogListing } from "./listing.resources";
import type { IssueDetail } from "./detail.resources";

/**
 * `GET /api/v1/backlog/{id}` over the whole pipeline — session guard, tenant guard, pipe,
 * router, two statements, error filter — against a migrated database and mockup 03's own rows
 * ([#111](https://github.com/NobuData/ouroboros/issues/111)).
 *
 * The unit suites cover the statements, the rules and the mapping. What only a running database
 * and a real router can answer is this ticket's five acceptance criteria and the routing rule
 * it introduced:
 *
 *   * **The seeded `#485` returns every field the mockup panel displays** — read out of the
 *     fixture rather than retyped, so a seed that changed and an endpoint that did not is a red
 *     suite rather than a panel with the wrong numbers.
 *   * **An unsized issue answers the issue-only shape.** `#483` has no `issue_estimates` row at
 *     all, which is what `estimating` means; a lateral or a join written the wrong way would
 *     answer a `404` or an object of nulls, and only a real statement over a real absence shows
 *     which.
 *   * **A cross-org id is a `404`**, not a `403` and not a body. The predicate is in the
 *     statement, and this is where a missing one would surface.
 *   * **The trace's `estimator` reflects reality** — `heuristic-v0`, from the stored document
 *     rather than from anything this service composes.
 *   * **The history lists `#487`'s two versions oldest→newest.** Against an issue with one
 *     estimate, an ascending order, a descending one and no order at all are indistinguishable.
 *   * **`GET /backlog/sync-status` still reaches the sync**, which is the consequence of the
 *     controller order `backlog.module.ts` now fixes. Express matches in registration order, and
 *     only a real router can be asked whether the literal segment still wins.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

const PATH = "/api/v1/backlog";

/** Mockup 03's `#485` — the issue the panel is drawn from. */
const PANEL = 485;

/** `#483`: `estimating`, and deliberately without an `issue_estimates` row. */
const UNSIZED = 483;

/** `#487`: the one issue carrying two versions. */
const TWICE = 487;

describe("the issue detail panel, against a migrated database", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    // A day, so the application's own sync loop cannot poll in the middle of a test.
    api = await ApiHarness.start({ OURO_BACKLOG_SYNC_INTERVAL_SECONDS: "86400" });
  });

  afterAll(() => api.close());

  afterEach(async () => {
    await api.truncate();
  });

  /**
   * A workspace with mockup 03's backlog in it, owned by its only member.
   *
   * @param email - Whose workspace, for a test that wants two.
   * @returns The workspace, and the person who may read it.
   */
  async function backlog(email?: string): Promise<{ workspace: SeededWorkspace; owner: Person }> {
    const owner = await api.signIn(email === undefined ? {} : { email });
    const workspace = await workspaceWithRepo(api, owner);

    await seedIntake(api, workspace);

    return { workspace, owner };
  }

  /**
   * The row id the seed gave one issue number.
   *
   * Read from the database rather than constructed, because `github_issues.id` is generated —
   * the development seed's `5eed0018-…` uuids are that file's, and this fixture writes its own.
   *
   * @param workspace - Whose backlog.
   * @param number - GitHub's issue number.
   * @returns `github_issues.id`.
   */
  async function idOf(workspace: SeededWorkspace, number: number): Promise<string> {
    const { rows } = await api.sql.query<{ id: string }>(
      `select id from ${SCHEMA_NAME}.github_issues
        where organization_id = $1 and number = $2::int`,
      [workspace.id, number],
    );

    return rows[0].id;
  }

  /**
   * Open the panel as somebody.
   *
   * @param person - Who is asking.
   * @param workspace - Which workspace, as `X-Ouro-Tenant`.
   * @param issueId - The row id in the path.
   * @param status - The status expected.
   * @returns The response body.
   */
  async function open(
    person: Person,
    workspace: SeededWorkspace,
    issueId: string,
    status = 200,
  ): Promise<IssueDetail> {
    const response = await api
      .as(person)("get", `${PATH}/${issueId}`)
      .set(TENANT_HEADER, workspace.slug)
      .expect(status);

    return bodyOf<IssueDetail>(response);
  }

  describe("the mockup's panel", () => {
    it("returns every field `#485` displays, as the fixture seeded them", async () => {
      // The ticket's first criterion. Every value is read out of the fixture rather than
      // retyped, so a seed that moved and an endpoint that did not is a failure here.
      const { workspace, owner } = await backlog();
      const seeded = INTAKE_ISSUES.find((issue) => issue.number === PANEL)!;
      const estimate = INTAKE_ESTIMATES.find(
        (candidate) => candidate.number === PANEL && candidate.version === 1,
      )!;

      const detail = await open(owner, workspace, await idOf(workspace, PANEL));

      expect(detail.issue).toMatchObject({
        number: PANEL,
        title: seeded.title,
        labels: [...seeded.labels],
        state: "open",
        sizingStatus: seeded.sizingStatus,
        body: seeded.body,
        authorLogin: seeded.author,
        // `owner/name` as the statement assembles it from `github_orgs.login` and
        // `github_repos.name` — the harness names the GitHub organisation after the workspace,
        // where the development seed names it `acme-robotics`.
        repository: `${workspace.slug}/${PRIMARY_REPO}`,
        ghUrl: `https://github.com/acme-robotics/helios-firmware/issues/${PANEL}`,
      });
      // `toEqual` rather than `toMatchObject`, so a field this endpoint publishes and the panel
      // has no use for fails here too. `sizedAt` is the one value the fixture writes relative to
      // `now()`, so it is asserted as an instant beside the rest rather than as a literal.
      const { trace, ...estimated } = detail.estimate!;

      expect(estimated).toEqual({
        version: 1,
        effort: estimate.effort,
        confidence: estimate.confidence,
        suggestedWorkflow: estimate.suggestedWorkflow,
        routedModel: estimate.routedModel,
        breakdown: {
          files: [...estimate.files],
          estTokens: estimate.estTokens,
          cycleMin: estimate.cycleMin,
          cycleMax: estimate.cycleMax,
          estMinutes: estimate.estMinutes,
        },
        risk: estimate.risk,
        riskNote: estimate.riskNote,
      });
      expect(trace).toEqual({
        estimator: "heuristic-v0",
        sizedAt: trace.sizedAt,
        tokensUsed: 0,
        signals: [],
      });
      expect(Number.isNaN(Date.parse(trace.sizedAt))).toBe(false);
    });

    it("publishes `opened … by …` as an instant and a login", async () => {
      // The panel's meta line is `#485 · opened 2d ago by field-support`, and the fixture opens
      // it 48 hours ago. The phrase is the client's; the instant is this endpoint's.
      const { workspace, owner } = await backlog();

      const detail = await open(owner, workspace, await idOf(workspace, PANEL));
      const openedHoursAgo = (Date.now() - Date.parse(detail.issue.ghCreatedAt)) / 3_600_000;

      expect(detail.issue.authorLogin).toBe("field-support");
      expect(openedHoursAgo).toBeGreaterThan(47);
      expect(openedHoursAgo).toBeLessThan(49);
    });

    it("carries the body raw, so the client is what truncates it", async () => {
      const { workspace, owner } = await backlog();
      const seeded = INTAKE_ISSUES.find((issue) => issue.number === PANEL)!;

      const detail = await open(owner, workspace, await idOf(workspace, PANEL));

      expect(detail.issue.body).toBe(seeded.body);
    });

    it("carries a null body for an issue opened without one", async () => {
      // `#488`, the documentation sweep. `null` and `""` are different facts, and the column
      // holds the first.
      const { workspace, owner } = await backlog();

      const detail = await open(owner, workspace, await idOf(workspace, 488));

      expect(detail.issue.body).toBeNull();
    });

    it("agrees with the listing row it was opened from, field for field", async () => {
      // The panel head and the table row are the same eight fields by construction; this is the
      // assertion that they stay the same eight over the wire.
      const { workspace, owner } = await backlog();
      const listing = bodyOf<BacklogListing>(
        await api.as(owner)("get", PATH).set(TENANT_HEADER, workspace.slug).expect(200),
      );
      const row = listing.items.find((item) => item.number === PANEL)!;

      const detail = await open(owner, workspace, row.id);

      expect(detail.issue).toMatchObject({
        id: row.id,
        number: row.number,
        title: row.title,
        labels: row.labels,
        state: row.state,
        sizingStatus: row.sizingStatus,
        githubRepoId: row.githubRepoId,
        repository: row.repository,
      });
      expect(detail.estimate).toMatchObject({
        effort: row.estimate!.effort,
        confidence: row.estimate!.confidence,
        suggestedWorkflow: row.estimate!.suggestedWorkflow,
        routedModel: row.estimate!.routedModel,
      });
    });
  });

  describe("an issue with no estimate", () => {
    it("answers the issue-only shape rather than a 404 or an object of nulls", async () => {
      // The ticket's second criterion. `#483` is `estimating` and has no `issue_estimates` row,
      // which is what that word means.
      const { workspace, owner } = await backlog();
      const seeded = INTAKE_ISSUES.find((issue) => issue.number === UNSIZED)!;

      const detail = await open(owner, workspace, await idOf(workspace, UNSIZED));

      expect(detail.estimate).toBeNull();
      expect(detail.history).toEqual([]);
      expect(detail.issue).toMatchObject({
        number: UNSIZED,
        title: seeded.title,
        sizingStatus: "estimating",
        body: seeded.body,
        authorLogin: seeded.author,
      });
    });

    it("keeps the status and the estimate as separate answers", async () => {
      // `#490` is the other way round: sized by the pipeline and then held for a human. A panel
      // that derived one from the other would lose the row that is both.
      const { workspace, owner } = await backlog();

      const detail = await open(owner, workspace, await idOf(workspace, 490));

      expect(detail.issue.sizingStatus).toBe("needs_human");
      expect(detail.estimate).toMatchObject({ effort: "xl", confidence: 61 });
    });
  });

  describe("the estimate history", () => {
    it("lists `#487`'s two versions oldest first, each with what produced it", async () => {
      // The ticket's fifth criterion, and the fixture that makes it mean something: against an
      // issue with one estimate every ordering looks the same.
      const { workspace, owner } = await backlog();

      const detail = await open(owner, workspace, await idOf(workspace, TWICE));

      expect(detail.history.map((entry) => entry.version)).toEqual([1, 2]);
      expect(detail.history.every((entry) => entry.estimator === "heuristic-v0")).toBe(true);
      expect(Date.parse(detail.history[0].createdAt)).toBeLessThan(
        Date.parse(detail.history[1].createdAt),
      );
    });

    it("publishes the version in force, not the one it superseded", async () => {
      // Decision K4: re-estimation writes a new row and the highest version wins. Every visible
      // field of `#487`'s two differs, so a reader taking the wrong one is visible here.
      const { workspace, owner } = await backlog();
      const superseded = INTAKE_ESTIMATES.find(
        (candidate) => candidate.number === TWICE && candidate.version === 1,
      )!;
      const inForce = INTAKE_ESTIMATES.find(
        (candidate) => candidate.number === TWICE && candidate.version === 2,
      )!;

      const detail = await open(owner, workspace, await idOf(workspace, TWICE));

      expect(detail.estimate).toMatchObject({
        version: 2,
        effort: inForce.effort,
        confidence: inForce.confidence,
        suggestedWorkflow: inForce.suggestedWorkflow,
        routedModel: inForce.routedModel,
        risk: inForce.risk,
      });
      expect(detail.estimate!.effort).not.toBe(superseded.effort);
      expect(detail.history.at(-1)!.version).toBe(detail.estimate!.version);
    });

    it("names an estimator on every entry, because the database refuses an estimate without one", async () => {
      // The ticket's fourth criterion. `issue_estimates_provenance` is decision K10 as a
      // constraint, and `heuristic-v0` is the honest answer for a rule engine that called no
      // model — not the mockup's `claude-sonnet-5`, which is design copy.
      const { workspace, owner } = await backlog();

      const detail = await open(owner, workspace, await idOf(workspace, PANEL));

      expect(detail.estimate!.trace.estimator).toBe("heuristic-v0");
      expect(detail.estimate!.trace.tokensUsed).toBe(0);
      expect(detail.history[0].estimator).toBe("heuristic-v0");
    });

    it("dates a history entry by the row's own timestamp, not the trace's", async () => {
      // `db/schema.ts` keeps `trace.sized_at` and `created_at` apart deliberately. The fixture
      // writes both from the same instant, so what is asserted is that both are published and
      // both are instants — a panel reading one for the other would still be wrong later.
      const { workspace, owner } = await backlog();

      const detail = await open(owner, workspace, await idOf(workspace, PANEL));

      expect(Number.isNaN(Date.parse(detail.estimate!.trace.sizedAt))).toBe(false);
      expect(Number.isNaN(Date.parse(detail.history[0].createdAt))).toBe(false);
    });
  });

  describe("isolation and refusals", () => {
    it("answers a 404 for an issue in another workspace, with no body of theirs in it", async () => {
      // The ticket's third criterion. A `403` would confirm that the id names a real issue
      // somewhere, which is exactly what cross-tenant probing is looking for.
      const theirs = await backlog("other-owner@ouroboros.invalid");
      const mine = await backlog("my-owner@ouroboros.invalid");
      const theirIssue = await idOf(theirs.workspace, PANEL);

      const refused = await api
        .as(mine.owner)("get", `${PATH}/${theirIssue}`)
        .set(TENANT_HEADER, mine.workspace.slug)
        .expect(404);

      const envelope = bodyOf<ErrorEnvelope>(refused);

      expect(envelope.code).toBe(ESTIMATION_ERRORS.issueNotFound);
      expect(envelope.details).toEqual({ issueId: theirIssue });
      expect(JSON.stringify(envelope)).not.toContain("Watchdog");
    });

    it("answers the same 404 for an id that names nothing at all", async () => {
      // The two are deliberately one answer: a caller cannot tell a real id they may not see
      // from an id nobody has.
      const { workspace, owner } = await backlog();
      const unknown = "0f9e4b7a-1c2d-4e3f-8a9b-0c1d2e3f4a5b";

      const refused = await api
        .as(owner)("get", `${PATH}/${unknown}`)
        .set(TENANT_HEADER, workspace.slug)
        .expect(404);

      expect(bodyOf<ErrorEnvelope>(refused).code).toBe(ESTIMATION_ERRORS.issueNotFound);
    });

    it("refuses a path that could not name a row before it issues a statement", async () => {
      const { workspace, owner } = await backlog();

      const refused = await api
        .as(owner)("get", `${PATH}/485`)
        .set(TENANT_HEADER, workspace.slug)
        .expect(422);

      expect(bodyOf<ErrorEnvelope>(refused).code).toBe("validation_failed");
    });

    it("refuses a workspace the caller is not a member of", async () => {
      const theirs = await backlog("owner-a@ouroboros.invalid");
      const stranger = await api.signIn({ email: "stranger@ouroboros.invalid" });
      const theirIssue = await idOf(theirs.workspace, PANEL);

      await api
        .as(stranger)("get", `${PATH}/${theirIssue}`)
        .set(TENANT_HEADER, theirs.workspace.slug)
        .expect(404);
    });

    it("refuses a request with no session at all", async () => {
      const { workspace } = await backlog();
      const issue = await idOf(workspace, PANEL);

      await api.anonymous("get", `${PATH}/${issue}`).set(TENANT_HEADER, workspace.slug).expect(401);
    });

    it("is readable by a viewer, because opening a panel spends nothing", async () => {
      const { workspace } = await backlog();
      const viewer = await api.signIn({ email: "viewer@ouroboros.invalid" });

      await api.join(workspace.id, viewer, "viewer");

      expect((await open(viewer, workspace, await idOf(workspace, PANEL))).issue.number).toBe(
        PANEL,
      );
    });
  });

  describe("the routes it shares a prefix with", () => {
    it("does not shadow `GET /backlog/sync-status`", async () => {
      // The routing rule `backlog.module.ts` now fixes, asserted over a real router rather than
      // over the list: with this controller registered first, a freshness poll would become a
      // request for an issue whose id is the word *sync-status* — a `422` on a route that exists.
      const { workspace, owner } = await backlog();

      const response = await api
        .as(owner)("get", `${PATH}/sync-status`)
        .set(TENANT_HEADER, workspace.slug)
        .expect(200);

      expect(bodyOf<Record<string, unknown>>(response)).toHaveProperty("syncedAt");
    });

    it("does not shadow `GET /backlog` itself", async () => {
      const { workspace, owner } = await backlog();

      const listing = bodyOf<BacklogListing>(
        await api.as(owner)("get", PATH).set(TENANT_HEADER, workspace.slug).expect(200),
      );

      expect(listing.items).not.toHaveLength(0);
    });
  });
});
