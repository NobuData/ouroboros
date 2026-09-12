import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ApiHarness, type Person } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { startEngineStub, type EngineStub } from "../../testing/engine.stub.fixture";
import type { Page } from "../tenancy/pagination";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import { ENGINE_WORKFLOW_VALIDATE_ROUTE } from "../engine/engine.contract";
import type { WorkflowStats } from "./stats.resources";
import type {
  WorkflowDetail,
  WorkflowDraft,
  WorkflowSummary,
  WorkflowVersionResource,
  WorkflowVersionSummary,
} from "./workflows.resources";
import type { WorkflowRail } from "./workflows.service";

/**
 * The whole lifecycle, against a migrated database — P.3
 * ([#134](https://github.com/NobuData/ouroboros/issues/134)).
 *
 * The unit suites hold each layer to its own rules: the statements to their workspace
 * predicate, the etag to what it is a function of, the gate to its order, the controller to
 * its `@Roles()`. What only this one can certify is the ticket's acceptance criteria, because
 * every one of them is a claim about a real request against real rows:
 *
 *   * **create → draft → publish v1 → edit → publish v2 → history lists both**, which is the
 *     criterion written as one test, in that order, through the API.
 *   * **Pausing flips the rail state** — the mockup's err-dot, and P.4's caption following the
 *     column with no second write.
 *   * **A publish the validator refuses creates nothing**, asserted by counting the versions
 *     before and after rather than by trusting the `422`.
 *   * **A stale `If-Match` is a `409` with no silent clobber**, asserted by reading the draft
 *     afterwards and finding the *first* writer's document still there.
 *   * **A member may read and may not write**, which no unit suite can see: a `@Roles()`
 *     deleted from the controller leaves every one of them green.
 *   * **Cross-org ids are `404`**, over every route, from a workspace that really exists.
 *
 * **The engine stub answers `404` to the validate route, and that is the point of it being
 * here.** R.2 ([#144](https://github.com/NobuData/ouroboros/issues/144)) has not landed, so
 * the stub — which serves exactly what `ouroboros-engine/openapi.yaml` publishes and nothing
 * else — refuses the path the way the real engine would today. So this suite exercises the
 * gate's documented tolerance against a real socket rather than against a mock, and
 * {@link EngineStub.violations} is asserted to hold *that one line and no other*: the day the
 * engine publishes the operation, the violation disappears and this expectation asks to be
 * updated alongside the tolerance.
 *
 * The definitions are the committed DSL fixtures rather than documents written here:
 * `schemas/workflow-dsl/fixtures/valid/standard-fix.json` *is* mockup 04's canvas, node for
 * node.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

/** Where the shared contract lives — the same directory `dsl.golden.fixture.ts` reads. */
const FIXTURES = join(__dirname, "..", "..", "..", "..", "schemas", "workflow-dsl", "fixtures");

/** Read one committed fixture. */
function fixture(relativePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(FIXTURES, relativePath), "utf8")) as Record<string, unknown>;
}

/** Mockup 04's canvas, as P.2 committed it: twelve nodes, two terminals, the loop edge. */
const STANDARD_FIX = fixture("valid/standard-fix.json");

/** The smallest document the DSL accepts — used where the point is *a different document*. */
const MINIMAL = fixture("valid/minimal.json");

/** A document P.2 refuses, and the reason the publish gate exists. */
const NO_TRIGGER = fixture("invalid/no-trigger.json");

/** How many stages mockup 04's canvas holds. */
const STANDARD_FIX_STAGES = (STANDARD_FIX.nodes as unknown[]).length;

const WORKFLOWS = "/api/v1/workflows";

/** The violation the stub records for every call to a route the engine does not publish yet. */
const UNPUBLISHED_VALIDATE = `POST /${ENGINE_WORKFLOW_VALIDATE_ROUTE} is not a route ouroboros-engine publishes`;

describe("the workflow lifecycle, against a migrated database", () => {
  let api: ApiHarness;
  let engine: EngineStub;

  beforeAll(async () => {
    engine = await startEngineStub();
    api = await ApiHarness.start({ OURO_ENGINE_URL: engine.url });
  });

  afterAll(async () => {
    await api.close();
    await engine.stop();
  });

  beforeEach(() => {
    engine.reset();
  });

  afterEach(async () => {
    // Read first, truncate, assert last: an assertion that throws would skip whatever came
    // after it, and the one thing that must not be skipped is emptying the tables.
    const unfaithful = new Set(engine.violations);

    await api.truncate();

    // The only thing this service may do to the engine that its committed contract does not
    // describe is ask for R.2's route — see this file's header.
    expect([...unfaithful].filter((line) => line !== UNPUBLISHED_VALIDATE)).toEqual([]);
  });

  /** A workspace, its owner, and the header that names it. */
  interface Bench {
    owner: Person;
    slug: string;
  }

  /**
   * A workspace with an owner signed in.
   *
   * @param email - The owner's address, so two benches in one test get two people.
   * @returns The bench.
   */
  async function bench(email = "owner@ouroboros.invalid"): Promise<Bench> {
    const owner = await api.signIn({ email });
    const workspace = await api.workspace(owner);

    return { owner, slug: workspace.slug };
  }

  /** A request as somebody, already carrying the workspace. */
  function as(person: Person, workspace: Bench) {
    return (method: "get" | "post" | "put" | "patch", path: string) =>
      api.as(person)(method, path).set(TENANT_HEADER, workspace.slug);
  }

  /**
   * Create a workflow through the API.
   *
   * @param place - The bench to create it in.
   * @param name - Its title.
   * @returns The detail, including the draft's first etag.
   */
  async function create(place: Bench, name = "Standard Fix"): Promise<WorkflowDetail> {
    const response = await as(place.owner, place)("post", WORKFLOWS).send({ name }).expect(201);

    return bodyOf<WorkflowDetail>(response);
  }

  /**
   * Save a draft, guarded.
   *
   * @param place - The bench.
   * @param id - The workflow.
   * @param etag - The etag the write is based on.
   * @param definition - The document to store.
   * @returns The draft slot afterwards.
   */
  async function saveDraft(
    place: Bench,
    id: string,
    etag: string,
    definition: Record<string, unknown>,
  ): Promise<WorkflowDraft> {
    const response = await as(place.owner, place)("put", `${WORKFLOWS}/${id}/draft`)
      .set("If-Match", etag)
      .send({ definition })
      .expect(200);

    return bodyOf<WorkflowDraft>(response);
  }

  /**
   * Publish, expecting it to succeed.
   *
   * @param place - The bench.
   * @param id - The workflow.
   * @param changeNote - What changed.
   * @returns The version that is now in force.
   */
  async function publish(
    place: Bench,
    id: string,
    changeNote?: string,
  ): Promise<WorkflowVersionResource> {
    const response = await as(place.owner, place)("post", `${WORKFLOWS}/${id}/publish`)
      .send(changeNote === undefined ? {} : { changeNote })
      .expect(200);

    return bodyOf<WorkflowVersionResource>(response);
  }

  /** Read the detail. */
  async function read(place: Bench, id: string, version?: number): Promise<WorkflowDetail> {
    const path =
      version === undefined
        ? `${WORKFLOWS}/${id}`
        : `${WORKFLOWS}/${id}?version=${String(version)}`;

    return bodyOf<WorkflowDetail>(await as(place.owner, place)("get", path).expect(200));
  }

  /** Read the rail. */
  async function rail(place: Bench): Promise<readonly WorkflowStats[]> {
    return bodyOf<WorkflowRail>(await as(place.owner, place)("get", WORKFLOWS).expect(200))
      .workflows;
  }

  /** Read the history. */
  async function history(place: Bench, id: string): Promise<Page<WorkflowVersionSummary>> {
    return bodyOf<Page<WorkflowVersionSummary>>(
      await as(place.owner, place)("get", `${WORKFLOWS}/${id}/versions`).expect(200),
    );
  }

  describe("the whole lifecycle", () => {
    it("creates, drafts, publishes twice, and lists both versions", async () => {
      const place = await bench();

      // --- create ---------------------------------------------------------------------
      const created = await create(place);

      expect(created).toMatchObject({
        slug: "standard-fix",
        name: "Standard Fix",
        status: "active",
        currentVersion: null,
        version: null,
      });
      expect(created.draft.definition).toEqual({});

      // --- the first draft ------------------------------------------------------------
      const drafted = await saveDraft(place, created.id, created.draft.etag, STANDARD_FIX);

      expect(drafted.definition).toEqual(STANDARD_FIX);
      expect(drafted.etag).not.toBe(created.draft.etag);

      // --- publish v1 -----------------------------------------------------------------
      const first = await publish(place, created.id, "The first cut.");

      expect(first).toMatchObject({ version: 1, changeNote: "The first cut." });
      expect(first.definition).toEqual(STANDARD_FIX);
      expect(first.publishedBy).toBe(place.owner.id);

      // The draft survives the publish, which is what lets the canvas keep autosaving.
      const afterFirst = await read(place, created.id);
      expect(afterFirst.currentVersion).toBe(1);
      expect(afterFirst.draft.definition).toEqual(STANDARD_FIX);

      // --- edit, then publish v2 ------------------------------------------------------
      await saveDraft(place, created.id, afterFirst.draft.etag, MINIMAL);
      const second = await publish(place, created.id, "Trimmed to the smallest graph.");

      expect(second.version).toBe(2);
      expect(second.definition).toEqual(MINIMAL);

      // --- the history ----------------------------------------------------------------
      const page = await history(place, created.id);

      expect(page.total).toBe(2);
      expect(page.items.map((item) => item.version)).toEqual([2, 1]);
      expect(page.items[0]).toMatchObject({
        isCurrent: true,
        changeNote: "Trimmed to the smallest graph.",
      });
      expect(page.items[1]).toMatchObject({ isCurrent: false, changeNote: "The first cut." });

      // A history row carries no document — one is read by number instead.
      expect(page.items[0]).not.toHaveProperty("definition");
      expect((await read(place, created.id, 1)).version?.definition).toEqual(STANDARD_FIX);
    });

    it("refuses to rewrite a published version, because the database refuses it", async () => {
      // Decision **P1**, and V029 enforces it for every role. Publishing twice from the same
      // draft is the closest this API can come to asking: it writes a *new* version rather than
      // editing the one in force.
      const place = await bench();
      const created = await create(place);

      await saveDraft(place, created.id, created.draft.etag, STANDARD_FIX);
      const first = await publish(place, created.id);
      const second = await publish(place, created.id);

      expect([first.version, second.version]).toEqual([1, 2]);
      expect((await read(place, created.id, 1)).version?.definition).toEqual(STANDARD_FIX);
    });
  });

  describe("the rail", () => {
    it("carries P.4's caption, computed from the definition that is in force", async () => {
      const place = await bench();
      const created = await create(place);

      expect(await rail(place)).toEqual([
        expect.objectContaining({
          slug: "standard-fix",
          stageCount: null,
          caption: "not published",
        }),
      ]);

      await saveDraft(place, created.id, created.draft.etag, STANDARD_FIX);
      await publish(place, created.id);

      const [entry] = await rail(place);
      expect(entry.stageCount).toBe(STANDARD_FIX_STAGES);
      expect(entry.caption).toContain(`${String(STANDARD_FIX_STAGES)} stages`);
      expect(entry.usageCaption).toBe("no runs yet");
    });

    it("flips to the paused state when a workflow is paused", async () => {
      // The mockup's err-dot, and the caption following the column with no second write.
      const place = await bench();
      const created = await create(place);

      await saveDraft(place, created.id, created.draft.etag, STANDARD_FIX);
      await publish(place, created.id);

      const response = await as(place.owner, place)("patch", `${WORKFLOWS}/${created.id}`)
        .send({ status: "paused" })
        .expect(200);

      expect(bodyOf<WorkflowSummary>(response).status).toBe("paused");

      const [entry] = await rail(place);
      expect(entry.status).toBe("paused");
      expect(entry.caption).toContain("paused");
    });

    it("drops an archived workflow off the rail and keeps its history readable", async () => {
      const place = await bench();
      const created = await create(place);

      await saveDraft(place, created.id, created.draft.etag, STANDARD_FIX);
      await publish(place, created.id);

      await as(place.owner, place)("patch", `${WORKFLOWS}/${created.id}`)
        .send({ status: "archived" })
        .expect(200);

      expect(await rail(place)).toEqual([]);
      expect((await history(place, created.id)).total).toBe(1);
    });

    it("renames without touching the slug a stored workflow_tag resolves through", async () => {
      const place = await bench();
      const created = await create(place);

      const response = await as(place.owner, place)("patch", `${WORKFLOWS}/${created.id}`)
        .send({ name: "Standard fix (v2 rules)" })
        .expect(200);

      expect(bodyOf<WorkflowSummary>(response)).toMatchObject({
        name: "Standard fix (v2 rules)",
        slug: "standard-fix",
      });
    });

    it("refuses a second workflow with the same slug", async () => {
      const place = await bench();
      await create(place);

      const response = await as(place.owner, place)("post", WORKFLOWS)
        .send({ name: "Standard Fix" })
        .expect(409);

      expect(bodyOf<{ code: string }>(response).code).toBe("workflow_slug_taken");
    });
  });

  describe("the publish gate", () => {
    it("refuses an invalid definition with node-anchored findings, and creates nothing", async () => {
      const place = await bench();
      const created = await create(place);

      await saveDraft(place, created.id, created.draft.etag, NO_TRIGGER);

      const response = await as(place.owner, place)("post", `${WORKFLOWS}/${created.id}/publish`)
        .send({ changeNote: "Should not exist." })
        .expect(422);

      const body = bodyOf<{
        code: string;
        details: { findings: { source: string; code: string; path: string; node?: string }[] };
      }>(response);

      expect(body.code).toBe("workflow_definition_invalid");
      expect(body.details.findings.length).toBeGreaterThan(0);
      for (const finding of body.details.findings) {
        expect(finding.source).toBe("dsl");
        expect(typeof finding.path).toBe("string");
      }

      // *Creates nothing*, counted rather than trusted.
      expect((await history(place, created.id)).total).toBe(0);
      expect((await read(place, created.id)).currentVersion).toBeNull();
    });

    it("refuses a publish with no draft at all", async () => {
      const place = await bench();
      const created = await create(place);

      await api.sql.query("delete from ouroboros.workflow_versions where workflow_id = $1", [
        created.id,
      ]);

      const response = await as(place.owner, place)("post", `${WORKFLOWS}/${created.id}/publish`)
        .send({})
        .expect(409);

      expect(bodyOf<{ code: string }>(response).code).toBe("workflow_draft_absent");
    });

    it("asks the engine for a second opinion, and survives a build that has no answer", async () => {
      // The documented tolerance, against a real socket: the stub serves exactly what
      // `ouroboros-engine/openapi.yaml` publishes, and R.2's route is not in it yet (#144).
      const place = await bench();
      const created = await create(place);

      await saveDraft(place, created.id, created.draft.etag, STANDARD_FIX);
      await publish(place, created.id);

      expect(engine.violations).toContain(UNPUBLISHED_VALIDATE);
    });
  });

  describe("the draft guard", () => {
    it("refuses a stale If-Match and leaves the first writer's document in place", async () => {
      const place = await bench();
      const created = await create(place);

      // Both tabs hold the etag the create handed out.
      const stale = created.draft.etag;
      await saveDraft(place, created.id, stale, STANDARD_FIX);

      const response = await as(place.owner, place)("put", `${WORKFLOWS}/${created.id}/draft`)
        .set("If-Match", stale)
        .send({ definition: MINIMAL })
        .expect(409);

      const body = bodyOf<{ code: string; details: { expected: string; current: string } }>(
        response,
      );
      expect(body.code).toBe("workflow_draft_conflict");
      expect(body.details.expected).toBe(stale);

      // No silent clobber: the *first* writer's canvas is what is stored, and the etag the
      // conflict reported is the one a reload would find.
      const after = await read(place, created.id);
      expect(after.draft.definition).toEqual(STANDARD_FIX);
      expect(after.draft.etag).toBe(body.details.current);
    });

    it("lets the loser save once it has reloaded", async () => {
      const place = await bench();
      const created = await create(place);

      await saveDraft(place, created.id, created.draft.etag, STANDARD_FIX);
      const reloaded = await read(place, created.id);

      const saved = await saveDraft(place, created.id, reloaded.draft.etag, MINIMAL);

      expect(saved.definition).toEqual(MINIMAL);
    });

    it("refuses a draft write with no If-Match at all, and differently", async () => {
      // Forgetting the guard and losing a race are different mistakes; a client fixes them
      // differently, so they are different answers.
      const place = await bench();
      const created = await create(place);

      const response = await as(place.owner, place)("put", `${WORKFLOWS}/${created.id}/draft`)
        .send({ definition: MINIMAL })
        .expect(400);

      expect(bodyOf<{ code: string }>(response).code).toBe("workflow_draft_etag_required");
      expect((await read(place, created.id)).draft.definition).toEqual({});
    });

    it("accepts a document as large as the DSL admits", async () => {
      // `express.json()`'s default of 100 kB is smaller than a definition
      // `workflows/dsl.schema.ts` *accepts* — twelve stages with real prompts already clear
      // it — so this is the assertion behind `REQUEST_BODY_LIMIT` in `src/auth/auth.module.ts`.
      // Without it the failure is an `internal_error` on an autosave, which is the worst way
      // for a limit to be discovered.
      const place = await bench();
      const created = await create(place);

      const large = {
        ...STANDARD_FIX,
        nodes: (STANDARD_FIX.nodes as Record<string, unknown>[]).map((node) => ({
          ...node,
          description: "x".repeat(20_000),
        })),
      };

      const saved = await saveDraft(place, created.id, created.draft.etag, large);

      expect(JSON.stringify(saved.definition).length).toBeGreaterThan(200_000);
      expect((await read(place, created.id)).draft.definition).toEqual(large);
    });

    it("creates the first draft of a workflow that lost one", async () => {
      const place = await bench();
      const created = await create(place);

      await api.sql.query("delete from ouroboros.workflow_versions where workflow_id = $1", [
        created.id,
      ]);

      const empty = await read(place, created.id);
      expect(empty.draft).toMatchObject({ definition: null, updatedAt: null });

      const saved = await saveDraft(place, created.id, empty.draft.etag, MINIMAL);
      expect(saved.definition).toEqual(MINIMAL);
    });
  });

  describe("the role gate", () => {
    /** A workspace, a published workflow, and one person of each role in it. */
    async function staffed() {
      const owner = await api.signIn({ email: "owner@ouroboros.invalid" });
      const workspace = await api.workspace(owner);
      const place: Bench = { owner, slug: workspace.slug };

      const member = await api.signIn({ email: "member@ouroboros.invalid" });
      const viewer = await api.signIn({ email: "viewer@ouroboros.invalid" });
      await api.join(workspace.id, member, "member");
      await api.join(workspace.id, viewer, "viewer");

      const created = await create(place);
      await saveDraft(place, created.id, created.draft.etag, STANDARD_FIX);
      await publish(place, created.id);

      return {
        place,
        member,
        viewer,
        workflow: created.id,
        etag: (await read(place, created.id)).draft.etag,
      };
    }

    it("lets a member and a viewer read everything", async () => {
      const { place, member, viewer, workflow } = await staffed();

      for (const person of [member, viewer]) {
        await as(person, place)("get", WORKFLOWS).expect(200);
        await as(person, place)("get", `${WORKFLOWS}/${workflow}`).expect(200);
        await as(person, place)("get", `${WORKFLOWS}/${workflow}/versions`).expect(200);
      }
    });

    it("refuses a member every write", async () => {
      // A `member` is somebody who works here; publishing changes what every future run of this
      // workspace does. A `@Roles()` deleted from the controller leaves every unit spec green
      // and fails here.
      const { place, member, workflow, etag } = await staffed();

      await as(member, place)("post", WORKFLOWS).send({ name: "Sneaky" }).expect(403);
      await as(member, place)("patch", `${WORKFLOWS}/${workflow}`)
        .send({ status: "paused" })
        .expect(403);
      await as(member, place)("put", `${WORKFLOWS}/${workflow}/draft`)
        .set("If-Match", etag)
        .send({ definition: MINIMAL })
        .expect(403);
      await as(member, place)("post", `${WORKFLOWS}/${workflow}/publish`).send({}).expect(403);
    });

    it("changes nothing when it refuses one", async () => {
      const { place, member, workflow, etag } = await staffed();

      await as(member, place)("put", `${WORKFLOWS}/${workflow}/draft`)
        .set("If-Match", etag)
        .send({ definition: MINIMAL })
        .expect(403);

      const after = await read(place, workflow);
      expect(after.draft.definition).toEqual(STANDARD_FIX);
      expect(after.currentVersion).toBe(1);
    });
  });

  describe("another workspace's workflow", () => {
    it("does not exist, over every route", async () => {
      const theirs = await bench("them@ouroboros.invalid");
      const ours = await bench("us@ouroboros.invalid");

      const created = await create(theirs);
      const path = `${WORKFLOWS}/${created.id}`;

      // A 403 would confirm that an identifier names something real, which is the whole of
      // what somebody enumerating uuids is trying to learn.
      await as(ours.owner, ours)("get", path).expect(404);
      await as(ours.owner, ours)("get", `${path}/versions`).expect(404);
      await as(ours.owner, ours)("patch", path).send({ status: "paused" }).expect(404);
      await as(ours.owner, ours)("put", `${path}/draft`)
        .set("If-Match", created.draft.etag)
        .send({ definition: MINIMAL })
        .expect(404);
      await as(ours.owner, ours)("post", `${path}/publish`).send({}).expect(404);
    });

    it("keeps the rails apart even when both hold the same slug", async () => {
      const theirs = await bench("them@ouroboros.invalid");
      const ours = await bench("us@ouroboros.invalid");

      await create(theirs);
      await create(ours);

      expect((await rail(ours)).map((entry) => entry.slug)).toEqual(["standard-fix"]);
      expect((await rail(theirs)).map((entry) => entry.slug)).toEqual(["standard-fix"]);
      expect((await rail(ours))[0].id).not.toBe((await rail(theirs))[0].id);
    });

    it("answers 404 for a version number that names nothing", async () => {
      const place = await bench();
      const created = await create(place);

      const response = await as(place.owner, place)(
        "get",
        `${WORKFLOWS}/${created.id}?version=9`,
      ).expect(404);

      expect(bodyOf<{ code: string }>(response).code).toBe("workflow_version_not_found");
    });
  });
});
