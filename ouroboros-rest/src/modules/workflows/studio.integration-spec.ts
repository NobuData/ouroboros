import { readFileSync } from "node:fs";
import { join } from "node:path";

import { workspaceWithRepo, type SeededWorkspace } from "../../testing/dashboard.fixture";
import {
  contractViolation,
  dryRunExample,
  ENGINE_STUB_SECRET,
  engineFailure,
  startEngineStub,
  validationFindings,
  WORKFLOW_DRY_RUN_PATH,
  type EngineStub,
} from "../../testing/engine.stub.fixture";
import { ApiHarness, type Method, type Person } from "../../testing/harness.fixture";
import { INTAKE_ESTIMATES, seedIntake } from "../../testing/intake.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { seedTriggerWorkflow, type TriggerWorkflowOptions } from "../../testing/workflow.fixture";
import { routeTable } from "../auth/route.table.fixture";
import type { QueuedSelection } from "../backlog/queue.resources";
import { SCHEMA_NAME, type QueueWorkflowPinReason } from "../db/schema";
import { INTERNAL_KEY_HEADER } from "../engine/engine.contract";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import type { StageCatalog } from "./catalog.resources";
import type { WorkflowCodeConfig, WorkflowCodeTree } from "./code.resources";
import type { CodeSymbolTable } from "./code.symbols";
import { EffortSchema, TriggerSchema, type SourceKind } from "./dsl.schema";
import type { PublishFinding } from "./publish.gate";
import { triggerMatches } from "./trigger.evaluation";
import type { WorkflowDetail, WorkflowDraft, WorkflowVersionResource } from "./workflows.resources";
import type { WorkflowRail } from "./workflows.service";

/**
 * The studio's cross-service behaviour, against a migrated database and a contract-faithful
 * engine — R.4 ([#146](https://github.com/NobuData/ouroboros/issues/146)).
 *
 * Publishing, trigger precedence and the dry-run contract are each a claim about more than one
 * service agreeing: REST validates, the engine validates, the database records, and the studio
 * renders what came back. The unit suites prove each side keeps its own rules; this suite is where
 * the sides are held to each other.
 *
 *   * **The publish gate** — both validators, over a socket. A document the engine finds fault
 *     with, and an engine that cannot answer, are each refused with *nothing* written, counted in
 *     the table rather than trusted from the status. `lifecycle.integration-spec.ts` owns the
 *     lifecycle; this owns the refusals the engine causes.
 *   * **The trigger matrix** — every R.1 rule
 *     ([#143](https://github.com/NobuData/ouroboros/issues/143)) through the queue write that
 *     applies it: effort bounds, labels, source, paused/archived/draft-only workflows, an explicit
 *     choice, and the precedence order with its reasons. Each case is asserted on the response
 *     *and* on the stored `queue_items` row, because the pin is what T.6 will read.
 *   * **Dry-run contract fidelity** — nothing in this service calls
 *     `POST /v0/workflows/dry-run` yet (S.6, [#152](https://github.com/NobuData/ouroboros/issues/152),
 *     will), so what can be proved is that what REST *holds* already fits what the engine *takes*:
 *     the seeded `#485` is the ticket the engine's own example sends, a stored canvas and that
 *     ticket make a request the contract accepts, and REST's trigger evaluator agrees with the
 *     engine's documented verdict.
 *   * **Org isolation on every workflow route**, enumerated from the route table rather than
 *     listed: a workflow route added without a case here fails the suite.
 *
 * The engine stub's violations are asserted empty after every test.
 *
 * **Each guard was broken once, deliberately, to see this suite notice — and then restored:**
 *
 *   * The gate's engine leg removed (`publish.gate.ts` answering green without asking): four red —
 *     the happy path, the race, the engine's finding and the engine's failure. The DSL-refused case
 *     stays green, as it should: it never reaches the engine.
 *   * The workspace predicate dropped from `WorkflowsRepository.find`: the four `:id` routes that
 *     resolve through it go red. `PATCH` stays green, because `rename` carries its own predicate.
 *   * Dropped from `WorkflowCatalogRepository`: `catalog` and `code-symbols`. From
 *     `WorkflowStatsRepository`'s rail: the rail and create. From `TriggerRepository`:
 *     `queue.integration-spec.ts`' cross-workspace case, which owns that rule.
 *
 * ```bash
 * yarn test:integration src/modules/workflows/studio.integration-spec.ts
 * ```
 */

/** Where the shared contract lives — the same directory `dsl.golden.fixture.ts` reads. */
const FIXTURES = join(__dirname, "..", "..", "..", "..", "schemas", "workflow-dsl", "fixtures");

/** Read one committed DSL fixture. */
function fixture(relativePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(FIXTURES, relativePath), "utf8")) as Record<string, unknown>;
}

/** Mockup 04's canvas, as P.2 committed it. */
const STANDARD_FIX = fixture("valid/standard-fix.json");

/** The smallest document the DSL accepts — used where the point is *a different document*. */
const MINIMAL = fixture("valid/minimal.json");

/** A document P.2 refuses before the engine is ever asked. */
const NO_TRIGGER = fixture("invalid/no-trigger.json");

const WORKFLOWS = "/api/v1/workflows";
const QUEUE = "/api/v1/backlog/queue";

describe("the studio across services, against a migrated database", () => {
  let api: ApiHarness;
  let engine: EngineStub;

  beforeAll(async () => {
    engine = await startEngineStub();
    api = await ApiHarness.start({
      OURO_ENGINE_URL: engine.url,
      // A day, so the application's own sync loop cannot poll in the middle of a test.
      OURO_BACKLOG_SYNC_INTERVAL_SECONDS: "86400",
    });
  });

  afterAll(async () => {
    await api.close();
    await engine.stop();
  });

  beforeEach(() => {
    engine.reset();
  });

  afterEach(async () => {
    // Read first, truncate, assert last — `lifecycle.integration-spec.ts`' order and reason.
    const unfaithful = new Set(engine.violations);

    await api.truncate();

    expect([...unfaithful]).toEqual([]);
  });

  /** A workspace with a repository, and its owner. */
  interface Bench {
    readonly owner: Person;
    readonly workspace: SeededWorkspace;
  }

  /**
   * A workspace with a repository and an owner signed in.
   *
   * @param email - The owner's address, so two benches in one test get two people.
   * @returns The bench.
   */
  async function bench(email = "owner@ouroboros.invalid"): Promise<Bench> {
    const owner = await api.signIn({ email });

    return { owner, workspace: await workspaceWithRepo(api, owner) };
  }

  /** A request as a bench's owner, already carrying its workspace. */
  function as(place: Bench) {
    return (method: Method, path: string) =>
      api.as(place.owner)(method, path).set(TENANT_HEADER, place.workspace.slug);
  }

  /**
   * Create a workflow through the API.
   *
   * @param place - Where.
   * @param name - Its title, from which its slug is derived.
   * @returns The detail, with the draft's first etag.
   */
  async function create(place: Bench, name = "Standard Fix"): Promise<WorkflowDetail> {
    return bodyOf<WorkflowDetail>(await as(place)("post", WORKFLOWS).send({ name }).expect(201));
  }

  /**
   * Save a draft, guarded, expecting it to succeed.
   *
   * @param place - Where.
   * @param id - The workflow.
   * @param etag - The etag the write is based on.
   * @param definition - The document.
   * @returns The draft slot afterwards.
   */
  async function saveDraft(
    place: Bench,
    id: string,
    etag: string,
    definition: Record<string, unknown>,
  ): Promise<WorkflowDraft> {
    const response = await as(place)("put", `${WORKFLOWS}/${id}/draft`)
      .set("If-Match", etag)
      .send({ definition })
      .expect(200);

    return bodyOf<WorkflowDraft>(response);
  }

  /**
   * How many published versions a workflow has — *nothing is written*, counted.
   *
   * @param workflowId - The workflow.
   * @returns The count, drafts excluded.
   */
  async function publishedVersions(workflowId: string): Promise<number> {
    const { rows } = await api.sql.query<{ count: string }>(
      `select count(*)::text as count from ${SCHEMA_NAME}.workflow_versions
        where workflow_id = $1 and version is not null`,
      [workflowId],
    );

    return Number(rows[0].count);
  }

  describe("the publish gate", () => {
    it("publishes a document both validators accept, having shown the engine exactly it", async () => {
      const place = await bench();
      const created = await create(place);
      await saveDraft(place, created.id, created.draft.etag, STANDARD_FIX);

      const response = await as(place)("post", `${WORKFLOWS}/${created.id}/publish`)
        .send({})
        .expect(200);

      expect(bodyOf<WorkflowVersionResource>(response).version).toBe(1);
      expect(engine.validations).toEqual([{ definition: STANDARD_FIX }]);
      expect(await publishedVersions(created.id)).toBe(1);
    });

    it("refuses a document the engine finds fault with, anchored to its node, and writes nothing", async () => {
      // The criterion *removing the engine gate from publish turns tests red*: the DSL accepts
      // this canvas, so only the engine's opinion stands between it and a version.
      const place = await bench();
      const created = await create(place);
      await saveDraft(place, created.id, created.draft.etag, STANDARD_FIX);
      const node = (STANDARD_FIX.nodes as { id: string }[])[1].id;
      const finding = {
        code: "node.unreachable",
        message: "No path of edges reaches this stage from the trigger.",
        path: "/nodes/1",
        node_id: node,
      };
      engine.respondToValidation(() => validationFindings(finding));

      const response = await as(place)("post", `${WORKFLOWS}/${created.id}/publish`)
        .send({ changeNote: "Should not exist." })
        .expect(422);

      const body = bodyOf<ErrorEnvelope & { details: { findings: PublishFinding[] } }>(response);
      expect(body.code).toBe("workflow_definition_invalid");
      // The engine's `node_id` arrives as the studio's `node`, so the canvas can select it.
      expect(body.details.findings).toEqual([
        { source: "engine", code: finding.code, message: finding.message, path: "/nodes/1", node },
      ]);
      expect(engine.validations).toHaveLength(1);
      expect(await publishedVersions(created.id)).toBe(0);

      const detail = bodyOf<WorkflowDetail>(
        await as(place)("get", `${WORKFLOWS}/${created.id}`).expect(200),
      );
      expect(detail.currentVersion).toBeNull();
    });

    it("refuses to publish when the engine cannot answer, rather than publishing un-seconded", async () => {
      const place = await bench();
      const created = await create(place);
      await saveDraft(place, created.id, created.draft.etag, STANDARD_FIX);
      engine.respondToValidation(() => engineFailure());

      const response = await as(place)("post", `${WORKFLOWS}/${created.id}/publish`)
        .send({})
        .expect(502);

      expect(bodyOf<ErrorEnvelope>(response).code).toBe("engine_unavailable");
      expect(await publishedVersions(created.id)).toBe(0);
    });

    it("never asks the engine about a document the DSL already refuses", async () => {
      const place = await bench();
      const created = await create(place);
      await saveDraft(place, created.id, created.draft.etag, NO_TRIGGER);

      const response = await as(place)("post", `${WORKFLOWS}/${created.id}/publish`)
        .send({})
        .expect(422);

      const { findings } = bodyOf<{ details: { findings: PublishFinding[] } }>(response).details;
      expect(findings.length).toBeGreaterThan(0);
      expect(new Set(findings.map((finding) => finding.source))).toEqual(new Set(["dsl"]));
      expect(engine.validations).toEqual([]);
      expect(await publishedVersions(created.id)).toBe(0);
    });

    it("publishes the draft that won a race, never the one that lost it", async () => {
      // Two tabs hold the etag the create handed out. The first saves; the second is a `409`; the
      // publish that follows is judged — by both validators — on the first tab's document.
      const place = await bench();
      const created = await create(place);
      const stale = created.draft.etag;
      await saveDraft(place, created.id, stale, STANDARD_FIX);

      const conflict = await as(place)("put", `${WORKFLOWS}/${created.id}/draft`)
        .set("If-Match", stale)
        .send({ definition: MINIMAL })
        .expect(409);
      expect(bodyOf<ErrorEnvelope>(conflict).code).toBe("workflow_draft_conflict");

      const published = await as(place)("post", `${WORKFLOWS}/${created.id}/publish`)
        .send({})
        .expect(200);

      expect(bodyOf<WorkflowVersionResource>(published).definition).toEqual(STANDARD_FIX);
      expect(engine.validations).toEqual([{ definition: STANDARD_FIX }]);
    });
  });

  describe("the trigger matrix", () => {
    /**
     * The issues every case queues, in this order: `#488` is `xs`, `#491` is `s`, `#485` is `m`
     * and `#486` is `l` — all sized, all ready, all from GitHub. `#488` carries `docs`, `#491`
     * `bug`, `#485` `bug` and `watchdog`, and `#486` neither.
     *
     * Two R.1 facts cannot be reached over HTTP and stay in `trigger.evaluation.spec.ts`: an
     * unsized ticket (the queue write refuses it before a trigger is read), and a source other
     * than GitHub (the queue is still keyed on GitHub's cache).
     */
    const SELECTION = [488, 491, 485, 486] as const;

    /** A pin a case expects: the tag, the version, and the rung of the order that decided it. */
    type Pin = readonly [slug: string, version: number | null, reason: QueueWorkflowPinReason];

    /** The estimate's own suggestion stood — which slug that is, is the seed's business. */
    const SUGGESTED = "suggested";

    /** One workflow a case seeds. */
    interface SeededTrigger {
      readonly slug: string;
      readonly conditions: Record<string, unknown>;
      readonly options?: TriggerWorkflowOptions;
    }

    /** One row of the matrix. */
    interface MatrixCase {
      readonly name: string;
      readonly workflows: readonly SeededTrigger[];
      /** The workflow the request names, when it names one. */
      readonly explicit?: string;
      /** One expectation per issue in {@link SELECTION}, in the same order. */
      readonly expected: readonly (Pin | typeof SUGGESTED)[];
    }

    /** A predicate win for a seeded workflow at version 1. */
    const matched = (slug: string): Pin => [slug, 1, "predicate"];

    const MATRIX: MatrixCase[] = [
      {
        name: "effort_lte xs holds for xs alone",
        workflows: [{ slug: "bounded", conditions: { effort_lte: "xs" } }],
        expected: [matched("bounded"), SUGGESTED, SUGGESTED, SUGGESTED],
      },
      {
        name: "effort_lte s holds for xs and s",
        workflows: [{ slug: "bounded", conditions: { effort_lte: "s" } }],
        expected: [matched("bounded"), matched("bounded"), SUGGESTED, SUGGESTED],
      },
      {
        name: "effort_lte m holds up to and including m",
        workflows: [{ slug: "bounded", conditions: { effort_lte: "m" } }],
        expected: [matched("bounded"), matched("bounded"), matched("bounded"), SUGGESTED],
      },
      {
        name: "effort_lte l holds for every queueable effort here",
        workflows: [{ slug: "bounded", conditions: { effort_lte: "l" } }],
        expected: [matched("bounded"), matched("bounded"), matched("bounded"), matched("bounded")],
      },
      {
        name: "a required label holds for the tickets that carry it",
        workflows: [{ slug: "bugs", conditions: { labels: ["bug"] } }],
        expected: [SUGGESTED, matched("bugs"), matched("bugs"), SUGGESTED],
      },
      {
        name: "every required label must be carried",
        workflows: [{ slug: "watchdogs", conditions: { labels: ["bug", "watchdog"] } }],
        expected: [SUGGESTED, SUGGESTED, matched("watchdogs"), SUGGESTED],
      },
      {
        name: "labels are compared exactly — `Bug` is not `bug`",
        workflows: [{ slug: "bugs", conditions: { labels: ["Bug"] } }],
        expected: [SUGGESTED, SUGGESTED, SUGGESTED, SUGGESTED],
      },
      {
        name: "source github holds for a GitHub ticket",
        workflows: [{ slug: "from-github", conditions: { source: "github" } }],
        expected: [
          matched("from-github"),
          matched("from-github"),
          matched("from-github"),
          matched("from-github"),
        ],
      },
      {
        name: "source jira never holds for a GitHub ticket",
        workflows: [{ slug: "from-jira", conditions: { source: "jira" } }],
        expected: [SUGGESTED, SUGGESTED, SUGGESTED, SUGGESTED],
      },
      {
        name: "conditions are ANDed",
        workflows: [{ slug: "small-bugs", conditions: { effort_lte: "s", labels: ["bug"] } }],
        expected: [SUGGESTED, matched("small-bugs"), SUGGESTED, SUGGESTED],
      },
      {
        name: "a paused workflow never matches, however well it fits",
        workflows: [{ slug: "catch-all", conditions: {}, options: { status: "paused" } }],
        expected: [SUGGESTED, SUGGESTED, SUGGESTED, SUGGESTED],
      },
      {
        name: "an archived workflow never matches",
        workflows: [{ slug: "catch-all", conditions: {}, options: { status: "archived" } }],
        expected: [SUGGESTED, SUGGESTED, SUGGESTED, SUGGESTED],
      },
      {
        name: "a trigger only a draft carries never matches",
        workflows: [{ slug: "catch-all", conditions: {}, options: { versions: 0 } }],
        expected: [SUGGESTED, SUGGESTED, SUGGESTED, SUGGESTED],
      },
      {
        name: "an explicit choice wins over every predicate, pinned at its version in force",
        workflows: [
          { slug: "bugs", conditions: { labels: ["bug"] } },
          {
            slug: "chosen",
            conditions: { labels: ["nothing-carries-this"] },
            options: { versions: 2 },
          },
        ],
        explicit: "chosen",
        expected: [
          ["chosen", 2, "explicit"],
          ["chosen", 2, "explicit"],
          ["chosen", 2, "explicit"],
          ["chosen", 2, "explicit"],
        ],
      },
      {
        name: "the most specific match wins",
        workflows: [
          { slug: "catch-all", conditions: {} },
          { slug: "bugs", conditions: { labels: ["bug"] } },
        ],
        expected: [
          matched("catch-all"),
          ["bugs", 1, "most_specific"],
          ["bugs", 1, "most_specific"],
          matched("catch-all"),
        ],
      },
      {
        name: "a tie goes to the lowest slug",
        workflows: [
          { slug: "beta-bugs", conditions: { labels: ["bug"] } },
          { slug: "alpha-small", conditions: { effort_lte: "s" } },
        ],
        expected: [
          matched("alpha-small"),
          ["alpha-small", 1, "alphabetical"],
          matched("beta-bugs"),
          SUGGESTED,
        ],
      },
      {
        name: "the lowest slug is decided in code points, not by the collation",
        // `-` is U+002D and `a` is U+0061, so `fix-b` sorts first; a collation that ignores
        // punctuation would compare `fixb` with `fixa` and choose the other.
        workflows: [
          { slug: "fixa", conditions: { labels: ["bug"] } },
          { slug: "fix-b", conditions: { labels: ["bug"] } },
        ],
        expected: [
          SUGGESTED,
          ["fix-b", 1, "alphabetical"],
          ["fix-b", 1, "alphabetical"],
          SUGGESTED,
        ],
      },
      {
        name: "a repeated label buys no precedence",
        workflows: [
          { slug: "a-medium", conditions: { effort_lte: "m" } },
          { slug: "z-bugs", conditions: { labels: ["bug", "bug"] } },
        ],
        expected: [
          matched("a-medium"),
          ["a-medium", 1, "alphabetical"],
          ["a-medium", 1, "alphabetical"],
          SUGGESTED,
        ],
      },
      {
        name: "a catch-all still beats the estimate's suggestion",
        workflows: [{ slug: "catch-all", conditions: {} }],
        expected: [
          matched("catch-all"),
          matched("catch-all"),
          matched("catch-all"),
          matched("catch-all"),
        ],
      },
      {
        name: "the pin names the version in force, not the newest",
        workflows: [{ slug: "pinned", conditions: {}, options: { versions: 3, inForce: 2 } }],
        expected: [
          ["pinned", 2, "predicate"],
          ["pinned", 2, "predicate"],
          ["pinned", 2, "predicate"],
          ["pinned", 2, "predicate"],
        ],
      },
    ];

    /**
     * The workflow an issue's estimate in force suggests — the newest version's.
     *
     * @param number - GitHub's issue number.
     * @returns The slug.
     */
    function suggestionFor(number: number): string {
      const [latest] = INTAKE_ESTIMATES.filter((estimate) => estimate.number === number).sort(
        (left, right) => right.version - left.version,
      );

      return latest.suggestedWorkflow;
    }

    /**
     * The row ids the seed gave these issue numbers, in the order asked for.
     *
     * @param workspace - Whose backlog.
     * @param numbers - GitHub's issue numbers.
     * @returns `github_issues.id`, one per number.
     */
    async function idsOf(
      workspace: SeededWorkspace,
      numbers: readonly number[],
    ): Promise<string[]> {
      const { rows } = await api.sql.query<{ id: string; number: number }>(
        `select id, number from ${SCHEMA_NAME}.github_issues
          where organization_id = $1 and number = any($2::int[])`,
        [workspace.id, [...numbers]],
      );

      return numbers.map((number) => rows.find((row) => row.number === number)!.id);
    }

    it("covers every rung of the resolution order", () => {
      // A reason no case expects is a rule nothing here proves.
      const reasons = new Set(
        MATRIX.flatMap((row) =>
          row.expected.map((pin) => (pin === SUGGESTED ? SUGGESTED : pin[2])),
        ),
      );

      expect([...reasons].sort()).toEqual(
        ["alphabetical", "explicit", "most_specific", "predicate", "suggested"].sort(),
      );
    });

    it.each(MATRIX)("$name", async ({ workflows, explicit, expected }) => {
      const place = await bench();
      await seedIntake(api, place.workspace);

      for (const workflow of workflows) {
        await seedTriggerWorkflow(
          api,
          place.workspace.id,
          workflow.slug,
          workflow.conditions,
          workflow.options,
        );
      }

      const response = await as(place)("post", QUEUE)
        .send({
          issueIds: await idsOf(place.workspace, SELECTION),
          ...(explicit === undefined ? {} : { workflow: explicit }),
        })
        .expect(201);

      const pins = SELECTION.map((number, index) => {
        const pin = expected[index];

        return [number, ...(pin === SUGGESTED ? [suggestionFor(number), null, SUGGESTED] : pin)];
      });

      expect(
        bodyOf<QueuedSelection>(response).items.map((item) => [
          item.issueNumber,
          item.workflowTag,
          item.workflowVersion,
          item.workflowPinReason,
        ]),
      ).toEqual(pins);

      // Stored, not only answered: the pin is what T.6 will read.
      const { rows } = await api.sql.query<{
        issue_number: number;
        workflow_tag: string;
        workflow_version: number | null;
        workflow_pin_reason: string | null;
      }>(
        `select issue_number, workflow_tag, workflow_version, workflow_pin_reason
           from ${SCHEMA_NAME}.queue_items where organization_id = $1 order by position`,
        [place.workspace.id],
      );

      expect(
        rows.map((row) => [
          row.issue_number,
          row.workflow_tag,
          row.workflow_version,
          row.workflow_pin_reason,
        ]),
      ).toEqual(pins);
    });
  });

  describe("dry-run contract fidelity", () => {
    /** The ticket shape the engine's `DryRunTicket` takes. */
    interface DryRunTicketBody {
      readonly external_key: string;
      readonly source: string;
      readonly labels: readonly string[];
      readonly estimate: { readonly effort: string } | null;
    }

    /**
     * `#485` as this service holds it — the mirrored issue's labels and the effort of the
     * estimate in force — in the engine's names.
     *
     * @param place - A bench whose backlog has been seeded.
     * @returns The ticket.
     */
    async function heldTicket(place: Bench): Promise<DryRunTicketBody> {
      const { rows } = await api.sql.query<{ labels: string[]; effort: string }>(
        `select issues.labels, latest.effort
           from ${SCHEMA_NAME}.github_issues issues
           join lateral (select effort from ${SCHEMA_NAME}.issue_estimates
                          where github_issue_id = issues.id
                          order by version desc limit 1) latest on true
          where issues.organization_id = $1 and issues.number = 485`,
        [place.workspace.id],
      );

      return {
        external_key: "#485",
        source: "github",
        labels: rows[0].labels,
        estimate: { effort: rows[0].effort },
      };
    }

    /**
     * Ask the engine for a dry run, the way a caller holding the shared secret would.
     *
     * @param body - The request body.
     * @returns The status and the parsed answer.
     */
    async function dryRun(body: unknown): Promise<{ status: number; body: unknown }> {
      const response = await fetch(`${engine.url}${WORKFLOW_DRY_RUN_PATH}`, {
        method: "POST",
        headers: { "content-type": "application/json", [INTERNAL_KEY_HEADER]: ENGINE_STUB_SECRET },
        body: JSON.stringify(body),
      });

      return { status: response.status, body: await response.json() };
    }

    it("holds the seeded #485 in exactly the shape the engine's own example sends", async () => {
      // The engine documents its dry run with mockup 03's `#485`; this service seeds the same
      // issue. If either side's copy moves, the studio's *Dry run with issue #485* stops being
      // the walk the engine describes.
      const place = await bench();
      await seedIntake(api, place.workspace);

      expect(await heldTicket(place)).toEqual(dryRunExample().request.ticket);
    });

    it("sends a stored canvas and a held ticket, and receives a walk the contract allows", async () => {
      const place = await bench();
      await seedIntake(api, place.workspace);
      const created = await create(place);
      await saveDraft(place, created.id, created.draft.etag, STANDARD_FIX);
      const stored = bodyOf<WorkflowDetail>(
        await as(place)("get", `${WORKFLOWS}/${created.id}`).expect(200),
      ).draft.definition;
      const request = { definition: stored, ticket: await heldTicket(place) };

      const answered = await dryRun(request);

      expect(answered.status).toBe(200);
      expect(engine.dryRuns).toEqual([request]);
      expect(contractViolation("dryRun", answered.body)).toBeUndefined();
    });

    it("reads a trigger the way the engine's example says it fires — one language, two evaluators", () => {
      const { request, answer } = dryRunExample();
      const trigger = TriggerSchema.parse((request.definition as { trigger: unknown }).trigger);
      const ticket = request.ticket as DryRunTicketBody;
      const facts = {
        source: ticket.source as SourceKind,
        labels: ticket.labels,
        effort: ticket.estimate === null ? null : EffortSchema.parse(ticket.estimate.effort),
      };
      const [first] = answer.steps as { node_id: string; verdict: string }[];

      expect(first.verdict).toBe(triggerMatches(trigger, facts) ? "matched" : "not_matched");
      // …and the comparison is not vacuous: the same trigger refuses a larger ticket.
      expect(triggerMatches(trigger, { ...facts, effort: "l" })).toBe(false);
    });

    it("refuses a ticket in this service's names, so the check above is not vacuous", async () => {
      const place = await bench();
      await seedIntake(api, place.workspace);
      const { external_key: externalKey, ...rest } = await heldTicket(place);

      const refused = await dryRun({
        definition: STANDARD_FIX,
        ticket: { externalKey, ...rest },
      });

      expect(refused.status).toBe(422);
      expect(engine.dryRuns).toEqual([]);
      expect(engine.violations).toHaveLength(1);
      expect(engine.violations[0]).toContain("external_key");

      // Consumed deliberately: the refusal *is* the assertion, not a fault in this service.
      engine.reset();
    });
  });

  describe("org isolation, on every workflow route", () => {
    /** Two workspaces, with the other one's workflow published and its task kinds seeded. */
    interface Isolation {
      readonly ours: Bench;
      readonly theirs: Bench;
      /** Their workflow, published at v1 — `workflows.id`. */
      readonly theirId: string;
      /** The etag of their draft, which a write from our side presents. */
      readonly theirEtag: string;
    }

    /** What one route must do across the boundary. */
    type IsolationCase = (world: Isolation) => Promise<void>;

    /**
     * Give a workspace task kinds, as the routing matrix holds them.
     *
     * @param organizationId - The workspace.
     * @param names - The kinds.
     */
    async function seedTaskKinds(organizationId: string, names: readonly string[]): Promise<void> {
      for (const [index, name] of names.entries()) {
        await api.sql.query(
          `insert into ${SCHEMA_NAME}.task_kinds (organization_id, name, description, sort_order)
           values ($1, $2, $3, $4)`,
          [organizationId, name, `The ${name} kind of work.`, index + 1],
        );
      }
    }

    /**
     * Their workflow, its draft and its versions, exactly as stored — what *their data is
     * unchanged* is compared against.
     *
     * @param workflowId - Their workflow.
     * @returns The rows.
     */
    async function snapshot(workflowId: string): Promise<unknown> {
      const workflow = await api.sql.query(
        `select slug, name, status, current_version from ${SCHEMA_NAME}.workflows where id = $1`,
        [workflowId],
      );
      const versions = await api.sql.query(
        `select version, definition, change_note, updated_at from ${SCHEMA_NAME}.workflow_versions
          where workflow_id = $1 order by version nulls first`,
        [workflowId],
      );

      return { workflow: workflow.rows, versions: versions.rows };
    }

    /**
     * Stand up both sides.
     *
     * @returns The two workspaces and their workflow.
     */
    async function arrange(): Promise<Isolation> {
      const theirs = await bench("them@ouroboros.invalid");
      const ours = await bench("us@ouroboros.invalid");
      await seedTaskKinds(theirs.workspace.id, ["theirs-only"]);
      await seedTaskKinds(ours.workspace.id, ["ours-only"]);

      const created = await create(theirs);
      const drafted = await saveDraft(theirs, created.id, created.draft.etag, STANDARD_FIX);
      await as(theirs)("post", `${WORKFLOWS}/${created.id}/publish`).send({}).expect(200);

      return { ours, theirs, theirId: created.id, theirEtag: drafted.etag };
    }

    /**
     * Expect a request to be the `404` a stranger's id gets — never a `403`, which would confirm
     * the id names something real.
     *
     * @param pending - The request.
     */
    async function notFound(pending: ReturnType<ReturnType<typeof as>>): Promise<void> {
      const response = await pending.expect(404);

      expect(bodyOf<ErrorEnvelope>(response).code).toBe("workflow_not_found");
    }

    /** Every workflow route, and what it must do. Keyed by the route table's own signature. */
    const ISOLATION: Record<string, IsolationCase> = {
      [`GET ${WORKFLOWS}`]: async ({ ours }) => {
        await create(ours, "Docs Loop");

        const rail = bodyOf<WorkflowRail>(await as(ours)("get", WORKFLOWS).expect(200));

        expect(rail.workflows.map((entry) => entry.slug)).toEqual(["docs-loop"]);
      },
      [`POST ${WORKFLOWS}`]: async ({ ours, theirs, theirId }) => {
        // The same title, so the same slug: unique per workspace, never across them.
        const mine = await create(ours);

        expect(mine.slug).toBe("standard-fix");
        expect(mine.id).not.toBe(theirId);

        const rail = bodyOf<WorkflowRail>(await as(theirs)("get", WORKFLOWS).expect(200));
        expect(rail.workflows.map((entry) => entry.id)).toEqual([theirId]);
      },
      [`GET ${WORKFLOWS}/catalog`]: async ({ ours }) => {
        const catalog = bodyOf<StageCatalog>(
          await as(ours)("get", `${WORKFLOWS}/catalog`).expect(200),
        );

        expect(catalog.suggestions.taskRoutes).toEqual(["ours-only"]);
      },
      [`GET ${WORKFLOWS}/code-symbols`]: async ({ ours }) => {
        const table = bodyOf<CodeSymbolTable>(
          await as(ours)("get", `${WORKFLOWS}/code-symbols`).expect(200),
        );

        expect(
          table.scopes
            .find((entry) => entry.scope === "route.task")
            ?.completions.map((completion) => completion.label),
        ).toEqual(["ours-only"]);
      },
      [`GET ${WORKFLOWS}/:id`]: async ({ ours, theirId }) => {
        await notFound(as(ours)("get", `${WORKFLOWS}/${theirId}`));
        await notFound(as(ours)("get", `${WORKFLOWS}/${theirId}?version=1`));
      },
      [`PATCH ${WORKFLOWS}/:id`]: async ({ ours, theirId }) => {
        await notFound(
          as(ours)("patch", `${WORKFLOWS}/${theirId}`).send({ name: "Hijacked", status: "paused" }),
        );
      },
      [`PUT ${WORKFLOWS}/:id/draft`]: async ({ ours, theirId, theirEtag }) => {
        await notFound(
          as(ours)("put", `${WORKFLOWS}/${theirId}/draft`)
            .set("If-Match", theirEtag)
            .send({ definition: MINIMAL }),
        );
      },
      [`POST ${WORKFLOWS}/:id/publish`]: async ({ ours, theirId }) => {
        const asked = engine.validations.length;

        await notFound(as(ours)("post", `${WORKFLOWS}/${theirId}/publish`).send({}));

        // Refused before the gate: the engine is never shown another workspace's document.
        expect(engine.validations).toHaveLength(asked);
      },
      [`GET ${WORKFLOWS}/:id/versions`]: async ({ ours, theirId }) => {
        await notFound(as(ours)("get", `${WORKFLOWS}/${theirId}/versions`));
      },
      [`GET ${WORKFLOWS}/code-tree`]: async ({ ours }) => {
        await create(ours, "Docs Loop");

        const tree = bodyOf<WorkflowCodeTree>(
          await as(ours)("get", `${WORKFLOWS}/code-tree`).expect(200),
        );

        expect(tree.files.map((file) => file.path)).toEqual([
          "workflows/docs-loop.loop.ts",
          "ouroboros.config.ts",
        ]);
      },
      [`GET ${WORKFLOWS}/code-config`]: async ({ ours }) => {
        const config = bodyOf<WorkflowCodeConfig>(
          await as(ours)("get", `${WORKFLOWS}/code-config`).expect(200),
        );

        expect(config.text).toContain(`workspace: "${ours.workspace.slug}"`);
        expect(config.text).toContain("workflows: [],");
      },
      [`PUT ${WORKFLOWS}/code-config`]: async ({ ours }) => {
        await as(ours)("put", `${WORKFLOWS}/code-config`)
          .send({ text: "export default {};" })
          .expect(405);
      },
      [`GET ${WORKFLOWS}/:slug/code`]: async ({ ours }) => {
        // Their workflow is `standard-fix`; this workspace has no workflow by that slug.
        await notFound(as(ours)("get", `${WORKFLOWS}/standard-fix/code`));
        await notFound(as(ours)("get", `${WORKFLOWS}/standard-fix/code?version=1`));
      },
      [`GET ${WORKFLOWS}/:slug/code/checks`]: async ({ ours }) => {
        // The Loop Checks of a file this workspace cannot open are as absent as the file.
        await notFound(as(ours)("get", `${WORKFLOWS}/standard-fix/code/checks`));
        await notFound(as(ours)("get", `${WORKFLOWS}/standard-fix/code/checks?version=1`));
      },
      [`PUT ${WORKFLOWS}/:slug/code`]: async ({ ours, theirEtag }) => {
        const theirFile = readFileSync(join(FIXTURES, "code", "standard-fix.loop.ts"), "utf8");

        await notFound(
          as(ours)("put", `${WORKFLOWS}/standard-fix/code`)
            .set("If-Match", theirEtag)
            .send({ text: theirFile }),
        );
      },
    };

    it("has a case for every workflow route the application registered", () => {
      // Enumerated rather than listed: a route added to the controller without a case below is
      // a route whose isolation nothing asserts, and this is where that becomes a failure.
      const registered = routeTable(api.nest)
        .filter((route) => route.path === WORKFLOWS || route.path.startsWith(`${WORKFLOWS}/`))
        .map((route) => route.signature);

      expect([...registered].sort()).toEqual(Object.keys(ISOLATION).sort());
    });

    it.each(Object.entries(ISOLATION))(
      "%s keeps to the asking workspace, and leaves the other's rows as they were",
      async (_signature, check) => {
        const world = await arrange();
        const before = await snapshot(world.theirId);

        await check(world);

        expect(await snapshot(world.theirId)).toEqual(before);
      },
    );
  });
});
