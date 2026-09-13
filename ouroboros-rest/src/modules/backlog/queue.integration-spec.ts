import { workspaceWithRepo, addRepo, type SeededWorkspace } from "../../testing/dashboard.fixture";
import { ApiHarness, type Person } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { INTAKE_ESTIMATES, MOCKUP_03, seedIntake } from "../../testing/intake.fixture";
import type { DashboardResource } from "../dashboard/resources";
import { SCHEMA_NAME } from "../db/schema";
import type { ErrorEnvelope } from "../errors/error.envelope";
import type { QueuePage } from "../queue/queue.service";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import type { BacklogListing } from "./listing.resources";
import { QUEUE_ERRORS } from "./queue.errors";
import type { QueuedSelection } from "./queue.resources";

/**
 * `POST /api/v1/backlog/queue` over the whole pipeline — session guard, tenant guard, roles
 * guard, pipe, router, three statements and the error filter — against a migrated database and
 * mockup 03's own rows ([#112](https://github.com/NobuData/ouroboros/issues/112)).
 *
 * The unit suites cover the statements, the rules and the mapping. What only a running database
 * and a real router can answer is this ticket's own acceptance criteria:
 *
 *   * **Queueing the three seeded selected issues yields their combined estimate, and the items
 *     appear on the dashboard queue card** — the cross-roadmap verification against #85. Two
 *     modules state the queue's totals independently on purpose (the dashboard exports no
 *     provider), so only a suite that reads both over one population can hold them together.
 *   * **An unsized issue in the selection is a `422` naming the offenders, and nothing is
 *     written.** The listing is re-read afterwards, because *"nothing is written"* is a claim
 *     about the database rather than about the response.
 *   * **An already-queued issue is a per-issue `409`, and nothing is written** — including the
 *     issues in the same request that had no conflict.
 *   * **All-or-nothing holds under a failure inside the write.** Harness-verified, by arranging
 *     the one refusal V009's header says can happen — a repository re-parented onto another
 *     workspace — so the *third* row of three is refused after the first two are written. The
 *     two before it must not survive, which no unit test over a double can demonstrate.
 *   * **`est_minutes` on each row is the estimate's own number**, read back out of the queue and
 *     compared against `issue_estimates.breakdown`.
 *   * **Member+ is enforced and cross-org ids are `404`**, both asserted through the real guards
 *     over two real workspaces in one database.
 *   * **The backlog's `queued` pill flips**, which is the presentation half of the ticket.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

const QUEUE = "/api/v1/backlog/queue";
const BACKLOG = "/api/v1/backlog";
const QUEUE_LISTING = "/api/v1/queue";
const DASHBOARD = "/api/v1/dashboard";

/** `#483`: `estimating`, and deliberately without an `issue_estimates` row. */
const UNSIZED = 483;

/** `#490`: sized by the pipeline and then held for a human — not work the loop may take. */
const HELD = 490;

describe("the bulk queue action, against a migrated database", () => {
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
   * @returns The workspace, and the person who may queue in it.
   */
  async function backlog(email?: string): Promise<{ workspace: SeededWorkspace; owner: Person }> {
    const owner = await api.signIn(email === undefined ? {} : { email });
    const workspace = await workspaceWithRepo(api, owner);

    await seedIntake(api, workspace);

    return { workspace, owner };
  }

  /**
   * The row ids the seed gave these issue numbers, in the order asked for.
   *
   * Read from the database rather than constructed: `github_issues.id` is generated.
   *
   * @param workspace - Whose backlog.
   * @param numbers - GitHub's issue numbers.
   * @returns `github_issues.id`, one per number, in the same order.
   */
  async function idsOf(workspace: SeededWorkspace, numbers: readonly number[]): Promise<string[]> {
    const { rows } = await api.sql.query<{ id: string; number: number }>(
      `select id, number from ${SCHEMA_NAME}.github_issues
        where organization_id = $1 and number = any($2::int[])`,
      [workspace.id, [...numbers]],
    );

    return numbers.map((number) => rows.find((row) => row.number === number)!.id);
  }

  /**
   * Press a queue button as somebody.
   *
   * @param person - Who is asking.
   * @param workspace - Which workspace, as `X-Ouro-Tenant`.
   * @param body - The selection, and the workflow when one is named.
   * @param status - The status expected.
   * @returns The response body, whichever shape the status implies.
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
   * How many rows the workspace's queue holds — the claim *"nothing is written"* is about.
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

  describe("who may ask", () => {
    it("refuses a stranger", async () => {
      await api.anonymous("post", QUEUE).send({ issueIds: [] }).expect(401);
    });

    it("asks a session acting in no workspace to choose one", async () => {
      const nomad = await api.signIn();

      const response = await api
        .as(nomad)("post", QUEUE)
        .send({ issueIds: ["5eed0018-0000-4000-8000-000000000485"] })
        .expect(400);

      expect(bodyOf<ErrorEnvelope>(response).code).toBe("organization_required");
    });

    it("refuses a viewer, because queueing is work rather than looking", async () => {
      // The BA-C.3 policy the ticket names, asserted through the router: a role gate deleted
      // from the controller leaves every unit spec in this module green.
      const { workspace } = await backlog();
      const viewer = await api.signIn({ email: "viewer@ouroboros.invalid" });
      await api.join(workspace.id, viewer, "viewer");

      const [issueId] = await idsOf(workspace, [485]);

      await queue(viewer, workspace, { issueIds: [issueId] }, 403);
      expect(await queueSize(workspace)).toBe(0);
    });

    it("allows a member, which is what `member+` means", async () => {
      const { workspace } = await backlog();
      const member = await api.signIn({ email: "member@ouroboros.invalid" });
      await api.join(workspace.id, member, "member");

      const [issueId] = await idsOf(workspace, [485]);

      await queue(member, workspace, { issueIds: [issueId] });
      expect(await queueSize(workspace)).toBe(1);
    });
  });

  describe("the mockup's selection", () => {
    it("queues the three selected issues and answers their combined estimate", async () => {
      // The first acceptance criterion. The mockup's own *"est. 1h 10m"* is design copy over a
      // backlog of nine, exactly as its *"42 open issues"* is; what the criterion is about is
      // that the number is the sum of the estimates the rows were written with.
      const { workspace, owner } = await backlog();
      const issueIds = await idsOf(workspace, MOCKUP_03.selection);

      const response = await queue(owner, workspace, { issueIds, workflow: "standard-fix" });
      const queued = bodyOf<QueuedSelection>(response);

      expect(queued.items.map((item) => item.issueNumber)).toEqual([...MOCKUP_03.selection]);
      expect(queued.estMinutes).toBe(MOCKUP_03.selectionEstMinutes);
    });

    it("appends in the order the selection was sent, from position 1 on an empty queue", async () => {
      const { workspace, owner } = await backlog();
      const issueIds = await idsOf(workspace, MOCKUP_03.selection);

      const queued = bodyOf<QueuedSelection>(
        await queue(owner, workspace, { issueIds, workflow: "standard-fix" }),
      );

      expect(queued.items.map((item) => item.position)).toEqual([1, 2, 3]);
    });

    it("appends after what the queue already holds rather than renumbering it", async () => {
      const { workspace, owner } = await backlog();
      const [first] = await idsOf(workspace, [485]);
      const rest = await idsOf(workspace, [484, 491]);

      await queue(owner, workspace, { issueIds: [first] });
      const second = bodyOf<QueuedSelection>(await queue(owner, workspace, { issueIds: rest }));

      expect(second.items.map((item) => item.position)).toEqual([2, 3]);
    });

    it("copies `est_minutes` from the estimate breakdown rather than recomputing it", async () => {
      // The acceptance criterion, read back out of the stored row: the chip is a size somebody
      // chose and the estimate is minutes something measured, and deriving one from the other
      // would make the *Queued issues* stat a restatement of the chips.
      const { workspace, owner } = await backlog();
      const issueIds = await idsOf(workspace, MOCKUP_03.selection);

      await queue(owner, workspace, { issueIds, workflow: "standard-fix" });

      const { rows } = await api.sql.query<{ issue_number: number; est_minutes: number }>(
        `select issue_number, est_minutes from ${SCHEMA_NAME}.queue_items
          where organization_id = $1 order by position`,
        [workspace.id],
      );

      for (const row of rows) {
        const estimate = INTAKE_ESTIMATES.filter(
          (candidate) => candidate.number === row.issue_number,
        ).at(-1)!;

        expect(row.est_minutes).toBe(estimate.estMinutes);
      }
    });

    it("copies the effort chip off the same estimate", async () => {
      const { workspace, owner } = await backlog();
      const issueIds = await idsOf(workspace, MOCKUP_03.selection);

      const queued = bodyOf<QueuedSelection>(
        await queue(owner, workspace, { issueIds, workflow: "standard-fix" }),
      );

      // `#485` and `#484` are M, `#491` is S — the mockup's own chips.
      expect(queued.items.map((item) => item.effort)).toEqual(["m", "m", "s"]);
    });
  });

  describe("the workflow", () => {
    /**
     * A workflow with published versions, one of them in force, written straight into the tables.
     *
     * `workflows.integration-spec.ts`' shape and its reason: what these cases are about is the
     * trigger the version in force carries, and P.3's create goes through a publish gate that asks
     * the engine for a second opinion nothing here needs.
     *
     * @param where - Whose workspace.
     * @param slug - The workflow's slug.
     * @param conditions - Its trigger's conditions, published identically in every version.
     * @param options - Its status, how many versions to publish, and which one is in force.
     */
    async function publishedWorkflow(
      where: SeededWorkspace,
      slug: string,
      conditions: Record<string, unknown>,
      options: { status?: string; versions?: number; inForce?: number } = {},
    ): Promise<void> {
      const versions = options.versions ?? 1;
      const { rows } = await api.sql.query<{ id: string }>(
        `insert into ${SCHEMA_NAME}.workflows (organization_id, slug, name, status)
         values ($1, $2, $2, $3) returning id`,
        [where.id, slug, options.status ?? "active"],
      );
      const definition = JSON.stringify({
        dsl_version: "1.0",
        trigger: { event: "ticket_queued", conditions },
        nodes: [],
        edges: [],
      });

      for (let version = 1; version <= versions; version += 1) {
        await api.sql.query(
          `insert into ${SCHEMA_NAME}.workflow_versions (workflow_id, version, definition, published_at)
           values ($1, $2, $3::jsonb, now())`,
          [rows[0].id, version, definition],
        );
      }

      await api.sql.query(
        `update ${SCHEMA_NAME}.workflows set current_version = $2 where id = $1`,
        [rows[0].id, options.inForce ?? versions],
      );
    }

    it("uses the one the request names for every issue", async () => {
      const { workspace, owner } = await backlog();
      // `#488` suggests `docs-loop` and `#486` suggests `feature-loop`; both are overridden.
      const issueIds = await idsOf(workspace, [488, 486]);

      const queued = bodyOf<QueuedSelection>(
        await queue(owner, workspace, { issueIds, workflow: "deps-refresh" }),
      );

      expect(queued.items.map((item) => item.workflowTag)).toEqual([
        "deps-refresh",
        "deps-refresh",
      ]);
      // A bootstrap workspace's built-in has nothing published, so the pin says why and names
      // no version.
      expect(queued.items.map((item) => [item.workflowVersion, item.workflowPinReason])).toEqual([
        [null, "explicit"],
        [null, "explicit"],
      ]);
    });

    it("uses each issue's own suggestion when the request names none", async () => {
      const { workspace, owner } = await backlog();
      const issueIds = await idsOf(workspace, [488, 486]);

      const queued = bodyOf<QueuedSelection>(await queue(owner, workspace, { issueIds }));

      expect(queued.items.map((item) => item.workflowTag)).toEqual(["docs-loop", "feature-loop"]);
      expect(queued.items.map((item) => [item.workflowVersion, item.workflowPinReason])).toEqual([
        [null, "suggested"],
        [null, "suggested"],
      ]);
    });

    it("lets a published workflow's trigger claim an issue, pinned at the version in force", async () => {
      // R.1 (#143) end to end: `#491` is S and `quick-fix` runs for effort ≤ S, while `#485` is M
      // and keeps its estimate's suggestion. Two versions exist and v1 is in force — a pin names
      // the pointer, never the newest row.
      const { workspace, owner } = await backlog();
      await publishedWorkflow(
        workspace,
        "quick-fix",
        { effort_lte: "s" },
        { versions: 2, inForce: 1 },
      );

      const queued = bodyOf<QueuedSelection>(
        await queue(owner, workspace, { issueIds: await idsOf(workspace, [491, 485]) }),
      );

      expect(
        queued.items.map((item) => [
          item.issueNumber,
          item.workflowVersion,
          item.workflowPinReason,
        ]),
      ).toEqual([
        [491, 1, "predicate"],
        [485, null, "suggested"],
      ]);
      expect(queued.items[0].workflowTag).toBe("quick-fix");
      expect(queued.items[1].workflowTag).not.toBe("quick-fix");

      // Stored, not only answered: the pin is what T.6 will read.
      const { rows } = await api.sql.query<{
        workflow_tag: string;
        workflow_version: number | null;
        workflow_pin_reason: string | null;
      }>(
        `select workflow_tag, workflow_version, workflow_pin_reason from ${SCHEMA_NAME}.queue_items
          where organization_id = $1 and issue_number = 491`,
        [workspace.id],
      );
      expect(rows).toEqual([
        { workflow_tag: "quick-fix", workflow_version: 1, workflow_pin_reason: "predicate" },
      ]);
    });

    it("lets an explicit choice win over a trigger that would have claimed the issue", async () => {
      const { workspace, owner } = await backlog();
      await publishedWorkflow(workspace, "catch-all", {});
      await publishedWorkflow(
        workspace,
        "docs-sweep",
        { labels: ["nothing-carries-this"] },
        { versions: 3 },
      );

      const queued = bodyOf<QueuedSelection>(
        await queue(owner, workspace, {
          issueIds: await idsOf(workspace, [485]),
          workflow: "docs-sweep",
        }),
      );

      expect(
        queued.items.map((item) => [
          item.workflowTag,
          item.workflowVersion,
          item.workflowPinReason,
        ]),
      ).toEqual([["docs-sweep", 3, "explicit"]]);
    });

    it("never lets a paused workflow's trigger claim an issue, however well it fits", async () => {
      // A catch-all would claim every ticket if pausing did not take it out of the candidates.
      const { workspace, owner } = await backlog();
      await publishedWorkflow(workspace, "hotfix-p0", {}, { status: "paused" });

      const queued = bodyOf<QueuedSelection>(
        await queue(owner, workspace, { issueIds: await idsOf(workspace, [485]) }),
      );

      expect(queued.items[0].workflowTag).not.toBe("hotfix-p0");
      expect(queued.items[0].workflowPinReason).toBe("suggested");
    });

    it("never lets another workspace's workflow claim this workspace's issue", async () => {
      // The ticket's cross-org criterion, through the router and a real database: the rival's
      // catch-all fires for every ticket it can see, and this workspace's are not among them.
      const { workspace, owner } = await backlog();
      const rival = await backlog("rival@ouroboros.invalid");
      await publishedWorkflow(rival.workspace, "rival-fix", {});

      const queued = bodyOf<QueuedSelection>(
        await queue(owner, workspace, { issueIds: await idsOf(workspace, [485]) }),
      );

      expect(queued.items[0].workflowTag).not.toBe("rival-fix");
      expect([queued.items[0].workflowVersion, queued.items[0].workflowPinReason]).toEqual([
        null,
        "suggested",
      ]);
    });

    it("refuses a workflow this workspace does not have, and writes nothing", async () => {
      // P.4 ([#135](https://github.com/NobuData/ouroboros/issues/135)) moved this refusal from
      // the pipe to the service: the vocabulary is the workspace's registry rather than
      // decision K5's four names, so a well-formed slug now reaches a handler and is refused
      // for a reason a client can act on — `details.offered` is the menu, redrawn.
      const { workspace, owner } = await backlog();
      const issueIds = await idsOf(workspace, [485]);

      const response = await queue(owner, workspace, { issueIds, workflow: "midnight-loop" }, 422);

      const envelope = bodyOf<ErrorEnvelope>(response);
      expect(envelope.code).toBe(QUEUE_ERRORS.workflowUnknown);
      expect(envelope.details).toMatchObject({ workflow: "midnight-loop" });
      expect((envelope.details as { offered: string[] }).offered).toContain("standard-fix");
      expect(await queueSize(workspace)).toBe(0);
    });

    it("still refuses a value that is not a slug at all, from the pipe", async () => {
      // The shape stays the body's: `workflows_slug_format`, mirrored. Refused before a
      // connection is taken from the pool, which is why it is a `validation_failed`.
      const { workspace, owner } = await backlog();
      const issueIds = await idsOf(workspace, [485]);

      const response = await queue(owner, workspace, { issueIds, workflow: "Midnight Loop" }, 422);

      expect(bodyOf<ErrorEnvelope>(response).code).toBe("validation_failed");
      expect(await queueSize(workspace)).toBe(0);
    });

    it("accepts a workflow only this workspace has, and no built-in beside it", async () => {
      // The amendment carried in from #124, end to end: the assign vocabulary *is* the
      // registry, so a workspace's own slug is queueable and the four names it replaced are
      // not. Written straight into `workflows` because P.3's create does not exist yet.
      const { workspace, owner } = await backlog();
      await api.sql.query(
        `insert into ${SCHEMA_NAME}.workflows (organization_id, slug, name, status)
         values ($1, 'release-train', 'release-train', 'active')`,
        [workspace.id],
      );

      const queued = bodyOf<QueuedSelection>(
        await queue(owner, workspace, {
          issueIds: await idsOf(workspace, [488]),
          workflow: "release-train",
        }),
      );
      expect(queued.items.map((item) => item.workflowTag)).toEqual(["release-train"]);
      // Active, and never published: chosen explicitly, it pins no version rather than an
      // invented one.
      expect(queued.items.map((item) => [item.workflowVersion, item.workflowPinReason])).toEqual([
        [null, "explicit"],
      ]);

      const response = await queue(
        owner,
        workspace,
        { issueIds: await idsOf(workspace, [486]), workflow: "standard-fix" },
        422,
      );
      expect(bodyOf<ErrorEnvelope>(response).code).toBe(QUEUE_ERRORS.workflowUnknown);
    });

    it("does not offer a paused workflow, though the rail still lists it", async () => {
      // `hotfix-p0` on the mockup's rail, err-dot and all. Queueing an issue under it would be
      // queueing work onto something the workspace has switched off.
      const { workspace, owner } = await backlog();
      await api.sql.query(
        `insert into ${SCHEMA_NAME}.workflows (organization_id, slug, name, status)
         values ($1, 'hotfix-p0', 'hotfix-p0', 'paused')`,
        [workspace.id],
      );

      const response = await queue(
        owner,
        workspace,
        { issueIds: await idsOf(workspace, [485]), workflow: "hotfix-p0" },
        422,
      );

      expect(bodyOf<ErrorEnvelope>(response).code).toBe(QUEUE_ERRORS.workflowUnknown);
      expect(await queueSize(workspace)).toBe(0);
    });
  });

  describe("issues that are not ready", () => {
    it("refuses the whole selection, naming the offender per-issue", async () => {
      // The acceptance criterion: an unsized issue in the selection is a `422` with per-issue
      // codes naming the offenders, so N.4 can name them instead of showing a generic failure.
      const { workspace, owner } = await backlog();
      const issueIds = await idsOf(workspace, [485, UNSIZED]);
      const [, unsizedId] = issueIds;

      const response = await queue(owner, workspace, { issueIds }, 422);
      const error = bodyOf<ErrorEnvelope>(response);

      expect(error.code).toBe(QUEUE_ERRORS.notQueueable);
      expect(error.details.issues).toEqual([
        {
          issueId: unsizedId,
          code: "issue_not_sized",
          issueNumber: UNSIZED,
          sizingStatus: "estimating",
        },
      ]);
    });

    it("writes nothing — not even the issue that was ready", async () => {
      const { workspace, owner } = await backlog();
      const issueIds = await idsOf(workspace, [485, UNSIZED]);

      await queue(owner, workspace, { issueIds }, 422);

      expect(await queueSize(workspace)).toBe(0);
    });

    it("refuses an issue held for a human, estimate or no estimate", async () => {
      // `#490` is `needs_human` *with* an estimate: it has an effort to copy and is still not
      // work the loop should pick up on its own.
      const { workspace, owner } = await backlog();
      const issueIds = await idsOf(workspace, [HELD]);

      const error = bodyOf<ErrorEnvelope>(await queue(owner, workspace, { issueIds }, 422));

      expect(error.code).toBe(QUEUE_ERRORS.notQueueable);
      expect(await queueSize(workspace)).toBe(0);
    });
  });

  describe("issues the queue already holds", () => {
    it("refuses the second attempt per-issue, and writes nothing", async () => {
      // The acceptance criterion, and the duplicate `queue_items_organization_issue_key`
      // exists to refuse: a queue is a plan, and a plan holds each issue once.
      const { workspace, owner } = await backlog();
      const [queuedId, freshId] = await idsOf(workspace, [485, 484]);

      await queue(owner, workspace, { issueIds: [queuedId] });

      const error = bodyOf<ErrorEnvelope>(
        await queue(owner, workspace, { issueIds: [queuedId, freshId] }, 409),
      );

      expect(error.code).toBe(QUEUE_ERRORS.conflict);
      expect(error.details.issues).toEqual([
        { issueId: queuedId, code: "issue_already_queued", issueNumber: 485 },
      ]);
      // The one that had no conflict is not written either — all-or-nothing.
      expect(await queueSize(workspace)).toBe(1);
    });

    it("refuses two issues in one selection that share a GitHub number", async () => {
      // `queue_items_organization_issue_key` is `(organization_id, issue_number)`, so a
      // workspace watching two repositories cannot queue both of their `#485`s — V009's
      // deliberate over-reach, refused before either row is written rather than half-applied.
      const { workspace, owner } = await backlog();
      const second = await addRepo(api, workspace, "helios-tools");
      await seedIntake(api, workspace, second);

      const { rows } = await api.sql.query<{ id: string }>(
        `select id from ${SCHEMA_NAME}.github_issues
          where organization_id = $1 and number = 485 order by github_repo_id`,
        [workspace.id],
      );

      const error = bodyOf<ErrorEnvelope>(
        await queue(owner, workspace, { issueIds: rows.map((row) => row.id) }, 409),
      );

      expect(error.code).toBe(QUEUE_ERRORS.conflict);
      expect(error.details.issues).toEqual([
        { issueId: rows[1].id, code: "issue_number_taken", issueNumber: 485 },
      ]);
      expect(await queueSize(workspace)).toBe(0);
    });
  });

  describe("all-or-nothing", () => {
    it("writes none of the batch when the database refuses the last row of it", async () => {
      // Harness-verified, which is the criterion's own word: the refusal is arranged in the
      // *database*, and it is the one V009's header says can happen — a repository re-parented
      // onto another workspace's GitHub organisation, which the shared
      // `repo_in_organization` trigger refuses on the next row written against it while
      // leaving the issues already mirrored under it in place.
      //
      // So the third row of three is refused after the first two have been written, and the
      // question is whether those two survive. Nothing over a double can answer it: this is
      // the transaction, and it either rolls back or it does not.
      const { workspace, owner } = await backlog();
      const stranger = await backlog("reparent@ouroboros.invalid");

      const second = await addRepo(api, workspace, "helios-tools");
      await seedIntake(api, workspace, second);

      await api.sql.query(
        `update ${SCHEMA_NAME}.github_repos
            set org_id = (select id from ${SCHEMA_NAME}.github_orgs where organization_id = $2)
          where id = $1`,
        [second, stranger.workspace.id],
      );

      const [first, next] = await idsOf(workspace, [485, 484]);
      const { rows } = await api.sql.query<{ id: string }>(
        `select id from ${SCHEMA_NAME}.github_issues
          where organization_id = $1 and github_repo_id = $2 and number = 489`,
        [workspace.id, second],
      );

      await queue(owner, workspace, { issueIds: [first, next, rows[0].id] }, 500);

      expect(await queueSize(workspace)).toBe(0);
    });

    it("says nothing about the database when it fails", async () => {
      // A failure the *service* had names a table, a column or a constraint; the client gets a
      // constant. `error.envelope.ts`' rule, and this is the one path in this operation that
      // can reach it.
      const { workspace, owner } = await backlog();
      const stranger = await backlog("reparent2@ouroboros.invalid");

      const second = await addRepo(api, workspace, "helios-tools");
      await seedIntake(api, workspace, second);
      await api.sql.query(
        `update ${SCHEMA_NAME}.github_repos
            set org_id = (select id from ${SCHEMA_NAME}.github_orgs where organization_id = $2)
          where id = $1`,
        [second, stranger.workspace.id],
      );

      const { rows } = await api.sql.query<{ id: string }>(
        `select id from ${SCHEMA_NAME}.github_issues
          where organization_id = $1 and github_repo_id = $2 and number = 489`,
        [workspace.id, second],
      );

      const error = bodyOf<ErrorEnvelope>(
        await queue(owner, workspace, { issueIds: [rows[0].id] }, 500),
      );

      expect(error.code).toBe("internal_error");
      expect(JSON.stringify(error)).not.toContain("queue_items");
    });
  });

  describe("another workspace's issues", () => {
    it("are a 404 rather than a 403, naming only the ids the caller sent", async () => {
      // The cross-org criterion. A `403` would confirm that the id names a real issue
      // somewhere, which is the whole of what an enumerator is trying to learn.
      const mine = await backlog();
      const theirs = await backlog("stranger@ouroboros.invalid");
      const [theirIssue] = await idsOf(theirs.workspace, [485]);

      const error = bodyOf<ErrorEnvelope>(
        await queue(mine.owner, mine.workspace, { issueIds: [theirIssue] }, 404),
      );

      expect(error.code).toBe(QUEUE_ERRORS.notFound);
      expect(error.details.issues).toEqual([{ issueId: theirIssue, code: "issue_not_found" }]);
      expect(await queueSize(theirs.workspace)).toBe(0);
    });

    it("are a 404 even beside ids that are the caller's own", async () => {
      const mine = await backlog();
      const theirs = await backlog("stranger2@ouroboros.invalid");
      const [myIssue] = await idsOf(mine.workspace, [485]);
      const [theirIssue] = await idsOf(theirs.workspace, [485]);

      await queue(mine.owner, mine.workspace, { issueIds: [myIssue, theirIssue] }, 404);

      expect(await queueSize(mine.workspace)).toBe(0);
    });
  });

  describe("what the rest of the product sees", () => {
    it("puts the items on the queue listing and the dashboard card, with one total", async () => {
      // The cross-roadmap verification against #85: the dashboard module exports no provider,
      // so its stat and the queue listing's total are two independently-stated sentences over
      // the same rows. Only a suite reading both over one population holds them together —
      // and this ticket adds the third statement that has to agree, the one that wrote them.
      const { workspace, owner } = await backlog();
      const issueIds = await idsOf(workspace, MOCKUP_03.selection);

      const queued = bodyOf<QueuedSelection>(
        await queue(owner, workspace, { issueIds, workflow: "standard-fix" }),
      );

      const listing = bodyOf<QueuePage>(
        await api.as(owner)("get", QUEUE_LISTING).set(TENANT_HEADER, workspace.slug).expect(200),
      );
      const dashboard = bodyOf<DashboardResource>(
        await api.as(owner)("get", DASHBOARD).set(TENANT_HEADER, workspace.slug).expect(200),
      );

      expect(listing.items).toEqual(queued.items);
      expect(listing.totalEstMinutes).toBe(queued.estMinutes);
      expect(dashboard.stats.queued.count).toBe(MOCKUP_03.selection.length);
      expect(dashboard.stats.queued.estMinutes).toBe(queued.estMinutes);
      expect(dashboard.queueHead).toEqual(queued.items);
    });

    it("flips the backlog table's rows to the `queued` pill", async () => {
      // The presentation half of the ticket. `queued` is not a sizing status — it is a
      // presentation over `queue_items` — so the pill moves and the status does not.
      const { workspace, owner } = await backlog();
      const issueIds = await idsOf(workspace, MOCKUP_03.selection);

      await queue(owner, workspace, { issueIds, workflow: "standard-fix" });

      const listing = bodyOf<BacklogListing>(
        await api
          .as(owner)("get", `${BACKLOG}?limit=100`)
          .set(TENANT_HEADER, workspace.slug)
          .expect(200),
      );

      const queuedNumbers = listing.items
        .filter((row) => row.queued)
        .map((row) => row.number)
        .sort((left, right) => left - right);

      expect(queuedNumbers).toEqual([...MOCKUP_03.selection].sort((a, b) => a - b));
      expect(listing.items.every((row) => row.sizingStatus !== ("queued" as string))).toBe(true);
    });

    it("leaves the page head's counts alone, because queueing is not sizing", async () => {
      const { workspace, owner } = await backlog();
      const issueIds = await idsOf(workspace, MOCKUP_03.selection);

      await queue(owner, workspace, { issueIds, workflow: "standard-fix" });

      const listing = bodyOf<BacklogListing>(
        await api.as(owner)("get", BACKLOG).set(TENANT_HEADER, workspace.slug).expect(200),
      );

      expect(listing.meta.openCount).toBe(MOCKUP_03.openCount);
      expect(listing.meta.sizedCount).toBe(MOCKUP_03.sizedCount);
    });
  });
});
