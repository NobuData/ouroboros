import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  engineFailure,
  startEngineStub,
  validationFindings,
  type EngineStub,
} from "../../testing/engine.stub.fixture";
import { ApiHarness, type Person } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { SCHEMA_NAME } from "../db/schema";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import { parseWorkflowCode } from "./code.parser";
import { edit, golden } from "./code.parser.fixture";
import type {
  WorkflowCode,
  WorkflowCodeChecks,
  WorkflowCodeConfig,
  WorkflowCodeIssue,
  WorkflowCodeTree,
  WorkflowCodeValidation,
} from "./code.resources";
import { seedPinnedAliases } from "./pins.fixture";
import type { WorkflowDetail } from "./workflows.resources";

/**
 * The code view, against a migrated database — U.3
 * ([#167](https://github.com/NobuData/ouroboros/issues/167)).
 *
 * Every acceptance criterion is a claim about real requests against real rows, and each has a
 * test here:
 *
 *   * **GET → edit → PUT → GET round-trips stably**, and the canvas's own read sees the edit —
 *     one draft, two editors (decision **C3**).
 *   * **A stale etag is a `409` naming the other editor's change**: the visual editor when the
 *     canvas saved in between, the code editor when another code tab did.
 *   * **A `422` leaves the stored draft byte-identical**, compared as the row PostgreSQL renders
 *     before and after — every column, the document's text and the microsecond stamp included —
 *     rather than by reading the API's answer (decision **C4**).
 *   * **`ouroboros.config.ts` carries its read-only flag, and a `PUT` is a `405`.**
 *   * **The explorer lists only what exists** (decision **C6**): no `skills/`, no `lib/`, nothing
 *     archived.
 *   * **Members read and may not write; another workspace's slug is `404`.** The route-by-route
 *     isolation matrix is `studio.integration-spec.ts`'.
 *   * **Two editors on one draft converge** (U.4, [#168](https://github.com/NobuData/ouroboros/issues/168)).
 *     A visual save followed by a stale code save is a `409`, and the code editor's reload and re-save
 *     keep both edits. Saves alternating between the editors leave both reading one document under
 *     one etag. Of two saves racing on one etag, exactly one is written. A `422` in the code editor
 *     moves nothing the canvas holds, its etag included.
 *
 * ```bash
 * yarn test:integration src/modules/workflows/code.integration-spec.ts
 * ```
 */

/** Where the shared contract lives — the same directory `dsl.golden.fixture.ts` reads. */
const FIXTURES = join(__dirname, "..", "..", "..", "..", "schemas", "workflow-dsl", "fixtures");

/** Read one committed DSL fixture. */
function fixture(relativePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(FIXTURES, relativePath), "utf8")) as Record<string, unknown>;
}

/** Mockup 04's canvas, as P.2 committed it, and the file U.1 committed as its projection. */
const STANDARD_FIX = fixture("valid/standard-fix.json");
const STANDARD_FIX_FILE = golden("standard-fix");

/** The file with its trigger stage retitled — an edit the code editor could make. */
const RETITLED_FILE = edit(STANDARD_FIX_FILE, 'title: "Issue queued"', 'title: "Ticket queued"');

const WORKFLOWS = "/api/v1/workflows";
const CODE = `${WORKFLOWS}/standard-fix/code`;

describe("the code view, against a migrated database", () => {
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
    // Read first, truncate, assert last — `lifecycle.integration-spec.ts`' order and reason.
    const unfaithful = new Set(engine.violations);

    await api.truncate();

    expect([...unfaithful]).toEqual([]);
  });

  /** A workspace and its owner. */
  interface Bench {
    readonly owner: Person;
    readonly slug: string;
    readonly id: string;
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

    // Publishing mockup 04's canvas resolves its pins against this registry (CH.6, #589).
    await seedPinnedAliases(api, workspace.id);

    return { owner, slug: workspace.slug, id: workspace.id };
  }

  /** A request as somebody, already carrying the workspace. */
  function as(person: Person, place: Bench) {
    return (method: "get" | "post" | "put" | "patch", path: string) =>
      api.as(person)(method, path).set(TENANT_HEADER, place.slug);
  }

  /**
   * Create a workflow and give it a draft through the canvas's own route.
   *
   * @param place - Where.
   * @param name - Its title, from which its slug is derived.
   * @param definition - The document the canvas saves, or `null` to leave the blank canvas the
   *   create wrote. `null` rather than `undefined`, which a default parameter would replace.
   * @returns The workflow's detail as it was created.
   */
  async function workflow(
    place: Bench,
    name = "Standard Fix",
    definition: Record<string, unknown> | null = STANDARD_FIX,
  ): Promise<WorkflowDetail> {
    const created = bodyOf<WorkflowDetail>(
      await as(place.owner, place)("post", WORKFLOWS).send({ name }).expect(201),
    );

    if (definition !== null) {
      await canvasSave(place, created.id, created.draft.etag, definition).expect(200);
    }

    return created;
  }

  /** A save from the visual editor. */
  function canvasSave(place: Bench, id: string, etag: string, definition: unknown) {
    return as(place.owner, place)("put", `${WORKFLOWS}/${id}/draft`)
      .set("If-Match", etag)
      .send({ definition });
  }

  /** A save from the code editor. */
  function codeSave(place: Bench, etag: string, text: string, person: Person = place.owner) {
    return as(person, place)("put", CODE).set("If-Match", etag).send({ text });
  }

  /**
   * Read `standard-fix` as a file.
   *
   * @param place - Where.
   * @param query - A query string, `?version=1`, or nothing.
   * @param person - Who reads it; the owner by default.
   * @returns The file.
   */
  async function readFile(place: Bench, query = "", person: Person = place.owner) {
    return bodyOf<WorkflowCode>(await as(person, place)("get", `${CODE}${query}`).expect(200));
  }

  /** The canvas's read of a workflow. */
  async function detail(place: Bench, id: string): Promise<WorkflowDetail> {
    return bodyOf<WorkflowDetail>(
      await as(place.owner, place)("get", `${WORKFLOWS}/${id}`).expect(200),
    );
  }

  /**
   * The draft row exactly as stored: every column, rendered by PostgreSQL.
   *
   * @param workflowId - The workflow.
   * @returns The row as JSON text — the document as `jsonb` prints it, the stamp to the
   *   microsecond, the editor — so two readings are equal only if nothing about the row changed.
   */
  async function storedDraft(workflowId: string): Promise<string> {
    const { rows } = await api.sql.query<{ row: string }>(
      `select row_to_json(v)::text as row from ${SCHEMA_NAME}.workflow_versions v
        where workflow_id = $1 and version is null`,
      [workflowId],
    );

    expect(rows).toHaveLength(1);
    return rows[0].row;
  }

  /** The canvas's document with its first stage retitled — a different edit, from the canvas. */
  function retitledOnCanvas(): Record<string, unknown> {
    const document = structuredClone(STANDARD_FIX) as { nodes: { title: string }[] };
    document.nodes[0].title = "Queued on the canvas";
    return document;
  }

  describe("GET → edit → PUT → GET", () => {
    it("round-trips, and the canvas reads what the code editor saved", async () => {
      const place = await bench();
      const created = await workflow(place);

      const opened = await readFile(place);
      expect(opened).toMatchObject({
        path: "workflows/standard-fix.loop.ts",
        slug: "standard-fix",
        text: STANDARD_FIX_FILE,
        readOnly: false,
        version: null,
        currentVersion: null,
      });
      // One draft, two editors: the file's etag is the canvas's etag.
      expect(opened.etag).toBe((await detail(place, created.id)).draft.etag);

      const saved = bodyOf<WorkflowCode>(
        await codeSave(place, opened.etag, RETITLED_FILE).expect(200),
      );
      expect(saved.text).toBe(RETITLED_FILE);
      expect(saved.etag).not.toBe(opened.etag);

      expect(await readFile(place)).toEqual(saved);

      const canvas = await detail(place, created.id);
      expect(canvas.draft.etag).toBe(saved.etag);
      expect((canvas.draft.definition as { nodes: { title: string }[] }).nodes[0].title).toBe(
        "Ticket queued",
      );
    });

    it("stays stable when the file it served is saved back unchanged", async () => {
      const place = await bench();
      await workflow(place);

      const first = await readFile(place);
      const again = bodyOf<WorkflowCode>(await codeSave(place, first.etag, first.text).expect(200));
      const third = bodyOf<WorkflowCode>(await codeSave(place, again.etag, again.text).expect(200));

      expect(again.text).toBe(first.text);
      expect(third.text).toBe(first.text);
      expect((await readFile(place)).text).toBe(first.text);
    });

    it("answers a respelled file with its canonical form", async () => {
      const place = await bench();
      await workflow(place);
      const opened = await readFile(place);

      const saved = bodyOf<WorkflowCode>(
        await codeSave(
          place,
          opened.etag,
          edit(opened.text, 'dsl: "1.0",', "dsl:   '1.0',"),
        ).expect(200),
      );

      expect(saved.text).toBe(STANDARD_FIX_FILE);
    });
  });

  describe("a stale etag", () => {
    it("is a 409 naming the visual editor when the canvas saved in between", async () => {
      const place = await bench();
      const created = await workflow(place);
      const opened = await readFile(place);

      await canvasSave(place, created.id, opened.etag, retitledOnCanvas()).expect(200);
      const response = await codeSave(place, opened.etag, RETITLED_FILE).expect(409);
      const body = bodyOf<ErrorEnvelope>(response);

      expect(body.code).toBe("workflow_draft_conflict");
      expect(body.message).toContain("visual editor");
      expect(body.details).toMatchObject({ expected: opened.etag, editedIn: "visual" });

      // No silent clobber: the canvas's edit is what is stored, and the etag the 409 reported is
      // the one a reload finds.
      const canvas = await detail(place, created.id);
      expect(canvas.draft.definition).toEqual(retitledOnCanvas());
      expect(canvas.draft.etag).toBe(body.details.current);
    });

    it("is a 409 naming the code editor when another code tab saved in between", async () => {
      const place = await bench();
      await workflow(place);
      const opened = await readFile(place);

      await codeSave(place, opened.etag, RETITLED_FILE).expect(200);
      const body = bodyOf<ErrorEnvelope>(
        await codeSave(place, opened.etag, STANDARD_FIX_FILE).expect(409),
      );

      expect(body.message).toContain("code editor");
      expect(body.details.editedIn).toBe("code");
    });

    it("names the code editor to the canvas too, since the two share the guard", async () => {
      const place = await bench();
      const created = await workflow(place);
      const opened = await readFile(place);

      await codeSave(place, opened.etag, RETITLED_FILE).expect(200);
      const body = bodyOf<ErrorEnvelope>(
        await canvasSave(place, created.id, opened.etag, retitledOnCanvas()).expect(409),
      );

      expect(body.details.editedIn).toBe("code");
    });
  });

  describe("two editors on one draft (U.4)", () => {
    /** The parts of `standard-fix`'s document these cases edit. */
    interface EditedDocument {
      nodes: { title: string; position: { x: number; y: number } }[];
    }

    /** What both editors hold once they agree. */
    interface Converged {
      /** The draft's document, as the canvas reads it. */
      readonly definition: EditedDocument;
      /** The file, as the code editor reads it. */
      readonly text: string;
      /** The etag either editor would save with. */
      readonly etag: string;
    }

    /**
     * Read the draft through both editors and hold the two readings to each other: the file parses
     * back to exactly the canvas's document, under the canvas's etag.
     *
     * @param place - Where.
     * @param id - The workflow.
     * @returns What both editors now hold.
     */
    async function converged(place: Bench, id: string): Promise<Converged> {
      const file = await readFile(place);
      const canvas = await detail(place, id);

      expect(file.etag).toBe(canvas.draft.etag);
      expect(parseWorkflowCode(file.text)).toStrictEqual({
        slug: "standard-fix",
        document: canvas.draft.definition,
        errors: [],
      });

      return {
        definition: canvas.draft.definition as EditedDocument,
        text: file.text,
        etag: file.etag,
      };
    }

    /**
     * A canvas edit: one stage dragged along the x axis.
     *
     * @param definition - The document the canvas holds.
     * @param index - Which stage.
     * @param x - Where it is dropped.
     * @returns The edited copy.
     */
    function moved(definition: unknown, index: number, x: number): EditedDocument {
      const document = structuredClone(definition) as EditedDocument;
      document.nodes[index].position.x = x;
      return document;
    }

    /**
     * A code edit: one stage retitled in the file.
     *
     * @param text - The file the code editor holds.
     * @param from - The stage's title now.
     * @param to - Its new title.
     * @returns The edited file.
     */
    function retitled(text: string, from: string, to: string): string {
      return edit(text, `title: ${JSON.stringify(from)},`, `title: ${JSON.stringify(to)},`);
    }

    it("refuses a stale code save after a visual save with 409, and the reloaded code editor keeps both edits", async () => {
      const place = await bench();
      const created = await workflow(place);
      const opened = await converged(place, created.id);

      await canvasSave(place, created.id, opened.etag, moved(opened.definition, 1, 999)).expect(
        200,
      );
      const stale = bodyOf<ErrorEnvelope>(
        await codeSave(
          place,
          opened.etag,
          retitled(opened.text, "Issue queued", "Ticket queued"),
        ).expect(409),
      );
      expect(stale.details.editedIn).toBe("visual");

      const reloaded = await readFile(place);
      expect(reloaded.etag).toBe(stale.details.current);
      await codeSave(
        place,
        reloaded.etag,
        retitled(reloaded.text, "Issue queued", "Ticket queued"),
      ).expect(200);

      const { definition } = await converged(place, created.id);
      expect(definition.nodes[0].title).toBe("Ticket queued");
      expect(definition.nodes[1].position.x).toBe(999);
    });

    it("converges on one document after saves alternating between the editors, with every edit in it", async () => {
      const place = await bench();
      const created = await workflow(place);
      const rounds = 6;

      for (let round = 0; round < rounds; round += 1) {
        const { definition, text, etag } = await converged(place, created.id);

        if (round % 2 === 0) {
          await canvasSave(place, created.id, etag, moved(definition, round, 1000 + round)).expect(
            200,
          );
        } else {
          const title = definition.nodes[round].title;
          await codeSave(place, etag, retitled(text, title, `Round ${round}`)).expect(200);
        }
      }

      const { definition } = await converged(place, created.id);
      for (let round = 0; round < rounds; round += 1) {
        if (round % 2 === 0) expect(definition.nodes[round].position.x).toBe(1000 + round);
        else expect(definition.nodes[round].title).toBe(`Round ${round}`);
      }
    });

    it("writes exactly one of two saves racing on one etag, names the winner to the loser, and converges once the loser re-saves", async () => {
      const place = await bench();
      const created = await workflow(place);
      const opened = await converged(place, created.id);
      const originalX = opened.definition.nodes[1].position.x;

      const [visual, code] = await Promise.all([
        canvasSave(place, created.id, opened.etag, moved(opened.definition, 1, 999)),
        codeSave(place, opened.etag, retitled(opened.text, "Issue queued", "Ticket queued")),
      ]);

      expect([visual.status, code.status].sort()).toEqual([200, 409]);
      const winner = visual.status === 200 ? "visual" : "code";
      const loser = winner === "visual" ? code : visual;
      expect(bodyOf<ErrorEnvelope>(loser).details.editedIn).toBe(winner);

      // Only the winner's edit is stored…
      const stored = await converged(place, created.id);
      expect(stored.definition.nodes[0].title).toBe(
        winner === "code" ? "Ticket queued" : "Issue queued",
      );
      expect(stored.definition.nodes[1].position.x).toBe(winner === "visual" ? 999 : originalX);

      // …and the loser, having reloaded, applies its edit on top of it.
      if (winner === "visual") {
        await codeSave(
          place,
          stored.etag,
          retitled(stored.text, "Issue queued", "Ticket queued"),
        ).expect(200);
      } else {
        await canvasSave(place, created.id, stored.etag, moved(stored.definition, 1, 999)).expect(
          200,
        );
      }

      const settled = await converged(place, created.id);
      expect(settled.definition.nodes[0].title).toBe("Ticket queued");
      expect(settled.definition.nodes[1].position.x).toBe(999);
    });

    it("lets a 422 in the code editor move nothing the canvas holds, its etag included", async () => {
      const place = await bench();
      const created = await workflow(place);
      const opened = await converged(place, created.id);
      const broken = edit(opened.text, 'dsl: "1.0",', "dsl: 1.0,");
      const before = await storedDraft(created.id);

      await codeSave(place, opened.etag, broken).expect(422);
      expect(await storedDraft(created.id)).toBe(before);

      // The refusal moved no etag, so the canvas's save from the same read still lands…
      await canvasSave(place, created.id, opened.etag, moved(opened.definition, 1, 999)).expect(
        200,
      );
      const after = await storedDraft(created.id);

      // …and the same broken file on the now-stale etag is still refused before the guard is reached:
      // a 422, not a 409, and nothing written.
      await codeSave(place, opened.etag, broken).expect(422);
      expect(await storedDraft(created.id)).toBe(after);

      const { definition } = await converged(place, created.id);
      expect(definition.nodes[1].position.x).toBe(999);
    });
  });

  describe("a file that does not read", () => {
    it("is a 422 with anchored errors, and the stored draft is byte-identical", async () => {
      const place = await bench();
      const created = await workflow(place);
      const opened = await readFile(place);
      const before = await storedDraft(created.id);

      const typo = edit(opened.text, 'dsl: "1.0",', "dsl: 1.0,");
      const body = bodyOf<ErrorEnvelope>(await codeSave(place, opened.etag, typo).expect(422));

      expect(body.code).toBe("workflow_code_invalid");
      expect(body.details.errors).toEqual([
        expect.objectContaining({ code: "code_out_of_grammar", line: 4, column: 8, endColumn: 11 }),
      ]);
      // The same refusal, in the stream a read's findings travel in (W.2).
      expect(body.details.diagnostics).toEqual([
        expect.objectContaining({
          severity: "error",
          code: "code_out_of_grammar",
          range: { line: 4, column: 8, endLine: 4, endColumn: 11 },
        }),
      ]);
      expect(await storedDraft(created.id)).toBe(before);

      // …and both editors still read the last draft that did.
      expect(await readFile(place)).toEqual(opened);
      expect((await detail(place, created.id)).draft.definition).toEqual(STANDARD_FIX);
    });

    it("is a 422 anchored at the slug when the file names another workflow", async () => {
      const place = await bench();
      const created = await workflow(place);
      const opened = await readFile(place);
      const before = await storedDraft(created.id);

      const renamed = edit(opened.text, 'defineLoop("standard-fix"', 'defineLoop("standard-fix-2"');
      const body = bodyOf<ErrorEnvelope>(await codeSave(place, opened.etag, renamed).expect(422));
      const [issue] = body.details.errors as WorkflowCodeIssue[];

      expect(issue).toMatchObject({ code: "code_slug_mismatch", line: 3, column: 27 });
      expect(await storedDraft(created.id)).toBe(before);
    });

    it("is a 422 for a file truncated mid-keystroke, and the draft is untouched", async () => {
      const place = await bench();
      const created = await workflow(place);
      const opened = await readFile(place);
      const before = await storedDraft(created.id);

      await codeSave(place, opened.etag, opened.text.slice(0, opened.text.length / 2)).expect(422);

      expect(await storedDraft(created.id)).toBe(before);
    });

    it("refuses a save with no If-Match as 400, and writes nothing", async () => {
      const place = await bench();
      const created = await workflow(place);
      const before = await storedDraft(created.id);

      const body = bodyOf<ErrorEnvelope>(
        await as(place.owner, place)("put", CODE).send({ text: STANDARD_FIX_FILE }).expect(400),
      );

      expect(body.code).toBe("workflow_draft_etag_required");
      expect(await storedDraft(created.id)).toBe(before);
    });
  });

  describe("what the file is printed from", () => {
    it("refuses a blank canvas with a 409 and the validator's findings, rather than inventing text", async () => {
      const place = await bench();
      await workflow(place, "Standard Fix", null);

      const body = bodyOf<ErrorEnvelope>(await as(place.owner, place)("get", CODE).expect(409));

      expect(body.code).toBe("workflow_code_unprojectable");
      expect(body.details.findings).not.toEqual([]);
    });

    it("reads a published version read-only, carrying the draft's etag", async () => {
      const place = await bench();
      const created = await workflow(place);
      await as(place.owner, place)("post", `${WORKFLOWS}/${created.id}/publish`)
        .send({})
        .expect(200);
      const draft = await detail(place, created.id);
      await canvasSave(place, created.id, draft.draft.etag, retitledOnCanvas()).expect(200);

      const version = await readFile(place, "?version=1");

      expect(version).toMatchObject({
        text: STANDARD_FIX_FILE,
        readOnly: true,
        version: 1,
        currentVersion: 1,
      });
      expect(version.etag).toBe((await detail(place, created.id)).draft.etag);
    });

    it("answers 404 for a version the workflow does not have", async () => {
      const place = await bench();
      await workflow(place);

      const body = bodyOf<ErrorEnvelope>(
        await as(place.owner, place)("get", `${CODE}?version=9`).expect(404),
      );

      expect(body.code).toBe("workflow_version_not_found");
    });

    it("opens a workflow with no draft on the version in force, and its first save creates one", async () => {
      const place = await bench();
      const created = await workflow(place);
      await as(place.owner, place)("post", `${WORKFLOWS}/${created.id}/publish`)
        .send({})
        .expect(200);
      await api.sql.query(
        `delete from ${SCHEMA_NAME}.workflow_versions where workflow_id = $1 and version is null`,
        [created.id],
      );

      const opened = await readFile(place);
      expect(opened).toMatchObject({ text: STANDARD_FIX_FILE, version: 1, readOnly: false });

      await codeSave(place, opened.etag, RETITLED_FILE).expect(200);

      const { rows } = await api.sql.query<{ edited_in: string }>(
        `select edited_in from ${SCHEMA_NAME}.workflow_versions
          where workflow_id = $1 and version is null`,
        [created.id],
      );
      expect(rows).toEqual([{ edited_in: "code" }]);
    });
  });

  describe("diagnostics and Loop Checks (W.2)", () => {
    /** The two stages mockup 04's canvas routes by task rather than by a pinned model. */
    const ROUTED_TASKS = ["split", "implement"] as const;

    /** What the validator says about a stage no edge reaches. */
    const UNREACHABLE = "No path of edges reaches this stage from the trigger.";

    /**
     * Give a workspace a routing matrix, as an operator editing task kinds would.
     *
     * @param place - The workspace.
     * @param names - The task kinds, in matrix order.
     */
    async function routes(place: Bench, names: readonly string[]): Promise<void> {
      for (const [index, name] of names.entries()) {
        await api.sql.query(
          `insert into ${SCHEMA_NAME}.task_kinds (organization_id, name, description, sort_order)
           values ($1, $2, $3, $4)`,
          [place.id, name, `The ${name} kind of work.`, index + 1],
        );
      }
    }

    /**
     * Read a workflow's Loop Checks.
     *
     * @param place - Where.
     * @param path - The checks route, `standard-fix`'s by default.
     * @param person - Who reads them; the owner by default.
     * @returns The panel.
     */
    async function readChecks(place: Bench, path = `${CODE}/checks`, person = place.owner) {
      return bodyOf<WorkflowCodeChecks>(await as(person, place)("get", path).expect(200));
    }

    /** The canvas's document with the effort re-check's branch to `split` removed. */
    function withoutSplitBranch(): Record<string, unknown> {
      const document = structuredClone(STANDARD_FIX) as { edges: { from: string; to: string }[] };
      document.edges = document.edges.filter(
        (edge) => !(edge.from === "effort-recheck" && edge.to === "split"),
      );
      return document;
    }

    it("serves each stage's lines, and no diagnostics for a clean canvas in a routed workspace", async () => {
      const place = await bench();
      await routes(place, ROUTED_TASKS);
      await workflow(place);

      const opened = await readFile(place);

      expect(opened.spans).toHaveLength(12);
      expect(opened.spans[6]).toEqual({ node: "implement", startLine: 71, endLine: 85 });
      expect(opened.diagnostics).toEqual([]);
      expect(opened.checksRef).toBe(`${CODE}/checks`);
      expect(opened.outlineRef).toBeNull();
    });

    it("answers mockup 05's first two rows for that canvas, and no infra row (C7)", async () => {
      const place = await bench();
      await routes(place, ROUTED_TASKS);
      await workflow(place);
      const opened = await readFile(place);

      expect(await readChecks(place, opened.checksRef)).toEqual({
        path: "workflows/standard-fix.loop.ts",
        slug: "standard-fix",
        etag: opened.etag,
        readOnly: false,
        version: null,
        rows: [
          { id: "graph", status: "ok", title: "Graph acyclic except declared gate loop" },
          {
            id: "references",
            status: "ok",
            title: "All task routes resolve",
            note: "models configured for analyze · plan · split · implement · review",
          },
        ],
      });
    });

    it("puts an unrouted task on the lines of the stage that routes to it, as a warning", async () => {
      const place = await bench();
      await routes(place, ["implement"]);
      await workflow(place);

      expect((await readFile(place)).diagnostics).toEqual([
        {
          severity: "warning",
          range: { line: 54, column: 5, endLine: 66, endColumn: 8 },
          code: "reference.unknown_task",
          message: "No route is configured for the task `split`.",
          node: "split",
        },
      ]);
      expect((await readChecks(place)).rows[1]).toEqual({
        id: "references",
        status: "warn",
        title: "1 reference does not resolve",
        note: "unresolved in split",
      });
    });

    it("leaves out the references row for a workspace with no routing matrix", async () => {
      const place = await bench();
      await workflow(place);

      expect((await readChecks(place)).rows).toEqual([
        { id: "graph", status: "ok", title: "Graph acyclic except declared gate loop" },
      ]);
    });

    it("carries a canvas draft's errors on its stages' lines, in the file and after a code save", async () => {
      const place = await bench();
      await routes(place, ROUTED_TASKS);
      await workflow(place, "Standard Fix", withoutSplitBranch());
      const unreachable = [
        {
          severity: "error",
          range: { line: 53, column: 5, endLine: 65, endColumn: 8 },
          code: "node.unreachable",
          message: UNREACHABLE,
          node: "split",
        },
        {
          severity: "error",
          range: { line: 66, column: 5, endLine: 69, endColumn: 8 },
          code: "node.unreachable",
          message: UNREACHABLE,
          node: "back-to-queue",
        },
      ];

      const opened = await readFile(place);
      const saved = bodyOf<WorkflowCode>(
        await codeSave(place, opened.etag, opened.text).expect(200),
      );

      expect(opened.diagnostics).toEqual(unreachable);
      expect(saved.diagnostics).toEqual(unreachable);
      expect((await readChecks(place)).rows).toEqual([
        { id: "graph", status: "err", title: "2 validation errors", note: UNREACHABLE },
      ]);
    });

    it("checks a published version where its file's checksRef points", async () => {
      const place = await bench();
      const created = await workflow(place);
      await as(place.owner, place)("post", `${WORKFLOWS}/${created.id}/publish`)
        .send({})
        .expect(200);

      const version = await readFile(place, "?version=1");

      expect(version.checksRef).toBe(`${CODE}/checks?version=1`);
      expect(await readChecks(place, version.checksRef)).toMatchObject({
        readOnly: true,
        version: 1,
        rows: [{ id: "graph", status: "ok" }],
      });

      const missing = bodyOf<ErrorEnvelope>(
        await as(place.owner, place)("get", `${CODE}/checks?version=9`).expect(404),
      );
      expect(missing.code).toBe("workflow_version_not_found");
    });

    it("lets a viewer read the checks, and refuses a blank canvas's checks as the file is refused", async () => {
      const place = await bench();
      await workflow(place);
      await workflow(place, "Blank Loop", null);
      const viewer = await api.signIn({ email: "viewer@ouroboros.invalid" });
      await api.join(place.id, viewer, "viewer");

      expect((await readChecks(place, `${CODE}/checks`, viewer)).rows).not.toEqual([]);

      const blank = bodyOf<ErrorEnvelope>(
        await as(place.owner, place)("get", `${WORKFLOWS}/blank-loop/code/checks`).expect(409),
      );
      expect(blank.code).toBe("workflow_code_unprojectable");
    });

    describe("Validate (V.6, #174)", () => {
      /**
       * Validate `standard-fix` as somebody.
       *
       * @param place - Where.
       * @param person - Who presses Validate; the owner by default.
       * @returns The validation.
       */
      async function validate(place: Bench, person = place.owner) {
        return bodyOf<WorkflowCodeValidation>(
          await as(person, place)("post", `${CODE}/validate`).expect(200),
        );
      }

      it("runs the gate over the draft and answers the file, its checks and no findings, publishing nothing", async () => {
        const place = await bench();
        await routes(place, ROUTED_TASKS);
        const created = await workflow(place);
        const opened = await readFile(place);

        const validated = await validate(place);

        // The engine leg ran against a real socket, on exactly the stored draft.
        expect(engine.validations).toEqual([{ definition: STANDARD_FIX }]);
        expect(validated.findings).toEqual([]);
        expect(validated.engineConsulted).toBe(true);
        expect(validated.file).toEqual(opened);
        expect(validated.checks).toEqual(await readChecks(place));
        expect((await detail(place, created.id)).currentVersion).toBeNull();
      });

      it("puts the engine's finding on the lines of the stage it names, and counts it in the graph row", async () => {
        const place = await bench();
        await routes(place, ROUTED_TASKS);
        await workflow(place);
        engine.respondToValidation(() =>
          validationFindings({
            code: "loop.unbounded",
            message: "The engine will not run this stage as written.",
            path: "/nodes/6",
            node_id: "implement",
          }),
        );

        const validated = await validate(place);

        expect(validated.findings).toEqual([
          {
            source: "engine",
            code: "loop.unbounded",
            message: "The engine will not run this stage as written.",
            path: "/nodes/6",
            node: "implement",
          },
        ]);
        expect(validated.file.diagnostics).toEqual([
          {
            severity: "error",
            range: { line: 71, column: 5, endLine: 85, endColumn: 8 },
            code: "loop.unbounded",
            message: "The engine will not run this stage as written.",
            node: "implement",
          },
        ]);
        expect(validated.checks.rows).toEqual([
          {
            id: "graph",
            status: "err",
            title: "1 validation error",
            note: "The engine will not run this stage as written.",
          },
        ]);
      });

      it("asks the engine nothing about a draft zod refuses, and draws zod's findings once", async () => {
        const place = await bench();
        await routes(place, ROUTED_TASKS);
        await workflow(place, "Standard Fix", withoutSplitBranch());
        const opened = await readFile(place);

        const validated = await validate(place);

        expect(engine.validations).toEqual([]);
        expect(validated.engineConsulted).toBe(false);
        expect(validated.findings.length).toBeGreaterThan(0);
        expect(validated.findings.every((finding) => finding.source === "dsl")).toBe(true);
        expect(validated.file.diagnostics).toEqual(opened.diagnostics);
      });

      it("is a 502 when the engine cannot answer, rather than a pass", async () => {
        const place = await bench();
        await workflow(place);
        engine.respondToValidation(() => engineFailure());

        const refused = bodyOf<ErrorEnvelope>(
          await as(place.owner, place)("post", `${CODE}/validate`).expect(502),
        );
        expect(refused.code).toBe("engine_unavailable");
      });

      it("lets a viewer validate, and refuses a blank canvas as its file is refused", async () => {
        const place = await bench();
        await workflow(place);
        await workflow(place, "Blank Loop", null);
        const viewer = await api.signIn({ email: "viewer@ouroboros.invalid" });
        await api.join(place.id, viewer, "viewer");

        expect((await validate(place, viewer)).engineConsulted).toBe(true);

        const blank = bodyOf<ErrorEnvelope>(
          await as(place.owner, place)("post", `${WORKFLOWS}/blank-loop/code/validate`).expect(409),
        );
        expect(blank.code).toBe("workflow_code_unprojectable");
      });
    });
  });

  describe("ouroboros.config.ts", () => {
    it("carries its read-only flag, and lists the registry", async () => {
      const place = await bench();
      await workflow(place);
      const hotfix = await workflow(place, "Hotfix P0");
      await as(place.owner, place)("patch", `${WORKFLOWS}/${hotfix.id}`)
        .send({ status: "paused" })
        .expect(200);

      const config = bodyOf<WorkflowCodeConfig>(
        await as(place.owner, place)("get", `${WORKFLOWS}/code-config`).expect(200),
      );

      expect(config.path).toBe("ouroboros.config.ts");
      expect(config.readOnly).toBe(true);
      expect(config.text).toContain(`workspace: "${place.slug}"`);
      expect(config.text).toContain(
        '{ slug: "standard-fix", name: "Standard Fix", status: "active", version: null },\n' +
          '    { slug: "hotfix-p0", name: "Hotfix P0", status: "paused", version: null },',
      );
    });

    it("refuses a PUT with 405 and Allow: GET, whoever sends it", async () => {
      const place = await bench();
      const viewer = await api.signIn({ email: "viewer@ouroboros.invalid" });
      await api.join(place.id, viewer, "viewer");

      for (const person of [place.owner, viewer]) {
        const response = await as(person, place)("put", `${WORKFLOWS}/code-config`)
          .send({ text: "export default {};\n" })
          .expect(405)
          .expect("Allow", "GET");

        expect(bodyOf<ErrorEnvelope>(response)).toMatchObject({
          code: "workflow_code_read_only",
          details: { path: "ouroboros.config.ts" },
        });
      }
    });
  });

  describe("the explorer", () => {
    it("lists the rail's workflows and the config file, and nothing that does not exist (C6)", async () => {
      const place = await bench();
      await workflow(place);
      const hotfix = await workflow(place, "Hotfix P0");
      const retired = await workflow(place, "Old Loop");
      await as(place.owner, place)("patch", `${WORKFLOWS}/${hotfix.id}`)
        .send({ status: "paused" })
        .expect(200);
      await as(place.owner, place)("patch", `${WORKFLOWS}/${retired.id}`)
        .send({ status: "archived" })
        .expect(200);

      const tree = bodyOf<WorkflowCodeTree>(
        await as(place.owner, place)("get", `${WORKFLOWS}/code-tree`).expect(200),
      );

      expect(tree.files).toEqual([
        {
          path: "workflows/standard-fix.loop.ts",
          kind: "workflow",
          readOnly: false,
          slug: "standard-fix",
          status: "active",
        },
        {
          path: "workflows/hotfix-p0.loop.ts",
          kind: "workflow",
          readOnly: false,
          slug: "hotfix-p0",
          status: "paused",
        },
        { path: "ouroboros.config.ts", kind: "config", readOnly: true, slug: null, status: null },
      ]);
      expect(tree.files.filter((file) => /^(skills|lib)\//.test(file.path))).toEqual([]);
    });

    it("is only the config file for a workspace with no workflows", async () => {
      const place = await bench();

      const tree = bodyOf<WorkflowCodeTree>(
        await as(place.owner, place)("get", `${WORKFLOWS}/code-tree`).expect(200),
      );

      expect(tree.files.map((file) => file.path)).toEqual(["ouroboros.config.ts"]);
    });
  });

  describe("the role gate", () => {
    /** A workspace with `standard-fix`, a member and a viewer. */
    async function staffed() {
      const place = await bench();
      const created = await workflow(place);
      const member = await api.signIn({ email: "member@ouroboros.invalid" });
      const viewer = await api.signIn({ email: "viewer@ouroboros.invalid" });
      await api.join(place.id, member, "member");
      await api.join(place.id, viewer, "viewer");

      return { place, created, member, viewer };
    }

    it("lets a member and a viewer read the file, the explorer and the configuration", async () => {
      const { place, member, viewer } = await staffed();

      for (const person of [member, viewer]) {
        expect((await readFile(place, "", person)).text).toBe(STANDARD_FIX_FILE);
        await as(person, place)("get", `${WORKFLOWS}/code-tree`).expect(200);
        await as(person, place)("get", `${WORKFLOWS}/code-config`).expect(200);
      }
    });

    it("refuses a member's save with 403, and writes nothing", async () => {
      const { place, created, member } = await staffed();
      const opened = await readFile(place);
      const before = await storedDraft(created.id);

      await codeSave(place, opened.etag, RETITLED_FILE, member).expect(403);

      expect(await storedDraft(created.id)).toBe(before);
    });
  });

  describe("another workspace's slug", () => {
    it("is 404 to read and to save, and their draft is untouched", async () => {
      const theirs = await bench("them@ouroboros.invalid");
      const ours = await bench("us@ouroboros.invalid");
      const created = await workflow(theirs);
      const theirFile = await readFile(theirs);
      const before = await storedDraft(created.id);

      for (const response of [
        await as(ours.owner, ours)("get", CODE).expect(404),
        await codeSave(ours, theirFile.etag, RETITLED_FILE).expect(404),
      ]) {
        expect(bodyOf<ErrorEnvelope>(response).code).toBe("workflow_not_found");
      }

      expect(await storedDraft(created.id)).toBe(before);
    });
  });
});
