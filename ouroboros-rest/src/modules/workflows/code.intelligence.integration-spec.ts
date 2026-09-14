import { startEngineStub, type EngineStub } from "../../testing/engine.stub.fixture";
import { ApiHarness, type Person } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { SCHEMA_NAME } from "../db/schema";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import type { CodeDiagnostic } from "./code.diagnostics";
import {
  contextsIn,
  disagreements,
  expectEditorOrder,
  expectHonestRows,
  formatContext,
  openGoldens,
  PARSE_REFUSAL,
  parseRefusal,
  recorded,
  sabotagedFiles,
  seedCaseName,
  seedFiles,
  shiftCases,
  shiftedDiagnostics,
  shiftedSpans,
  spanOf,
  stageCallsOf,
  suggestionsFor,
  type SeedFile,
} from "./code.intelligence.fixture";
import type { WorkflowCode, WorkflowCodeChecks } from "./code.resources";
import type { CodeSymbolTable } from "./code.symbols";
import { seedPinnedAliases } from "./pins.fixture";
import type { WorkflowDetail } from "./workflows.resources";

/**
 * The code view's intelligence, served from a migrated database — W.3
 * ([#179](https://github.com/NobuData/ouroboros/issues/179)).
 *
 * `code.intelligence.spec.ts` holds the functions to `schemas/workflow-dsl/fixtures/code-intelligence/`;
 * this suite holds what `GET` and `PUT /api/v1/workflows/{slug}/code`, its `checks` and
 * `code-symbols` actually serve to the same goldens, from a development workspace built the way the
 * seed builds one: every seeded workflow (standard-fix's predecessor as its published v1), the
 * routing seed's task kinds, and `.env.example`'s skill suggestions.
 *
 *   * **Node→span accuracy**: every seed's served span map, on the lines the compiler finds each
 *     stage call — and after a save that grows or shrinks the content above a stage, every span and
 *     every finding below it moved by exactly that many lines.
 *   * **Diagnostics merge**: each seed's stream, two sabotaged saves', and a `422`'s parse errors, in
 *     the editor's order.
 *   * **Checks summary derivation**, with no infra row (C7).
 *   * **Completion contexts**: every word a seed writes is offered by the served table where it is
 *     written, but a name the workspace does not suggest — which a reference warning then reports.
 *
 * The goldens are only compared here; the unit suite is what regenerates them. Each test that saves
 * puts the seeded text back before it moves on, so every test reads the seeds as seeded.
 *
 * ```bash
 * yarn test:integration src/modules/workflows/code.intelligence.integration-spec.ts
 * ```
 */

const WORKFLOWS = "/api/v1/workflows";

/** The goldens, compared against and never rewritten. */
const GOLDENS = openGoldens(false);

/** Every seeded document, as the code view opens it. */
const SEEDS = seedFiles();

/** What the development workspace suggests. */
const SUGGESTIONS = suggestionsFor("seeded");

/**
 * The version a seed is published as, when it is not its workflow's draft.
 *
 * `SEED_DOCUMENT_TAGS` lists a workflow's documents newest first: the first is the draft the code
 * view opens, and the rest are published oldest first, so the last is v1.
 *
 * @param seed - The seed.
 * @returns Its version number, or `undefined` for a draft.
 */
function publishedAs(seed: SeedFile): number | undefined {
  const siblings = SEEDS.filter((sibling) => sibling.slug === seed.slug);
  const position = siblings.indexOf(seed);
  return position === 0 ? undefined : siblings.length - position;
}

/** The seeds the code view opens as editable drafts. */
const DRAFTS = SEEDS.filter((seed) => publishedAs(seed) === undefined);

/** The seeded `standard-fix` v14, the draft the sabotaged files are saved over. */
const CANVAS = DRAFTS.find((seed) => seed.tag === "standard_fix_v14") as SeedFile;

/**
 * The name that creates a workflow with a slug: `hotfix-p0` is `Hotfix P0`.
 *
 * @param slug - The slug.
 * @returns Its words, capitalised.
 */
function nameOf(slug: string): string {
  return slug
    .split("-")
    .map((word) => `${word[0].toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

describe("the code view's intelligence, against a migrated database", () => {
  let api: ApiHarness;
  let engine: EngineStub;
  let owner: Person;
  let tenant: string;

  beforeAll(async () => {
    engine = await startEngineStub();
    api = await ApiHarness.start({
      OURO_ENGINE_URL: engine.url,
      OURO_WORKFLOW_SKILL_SUGGESTIONS: SUGGESTIONS.skills.join(","),
    });

    owner = await api.signIn({ email: "owner@ouroboros.invalid" });
    const workspace = await api.workspace(owner);
    tenant = workspace.slug;

    // Publishing standard-fix's predecessor resolves its pins against the registry (CH.6, #589).
    await seedPinnedAliases(api, workspace.id);

    for (const [index, name] of SUGGESTIONS.taskRoutes.entries()) {
      await api.sql.query(
        `insert into ${SCHEMA_NAME}.task_kinds (organization_id, name, description, sort_order)
         values ($1, $2, $3, $4)`,
        [workspace.id, name, `The ${name} kind of work.`, index + 1],
      );
    }

    for (const slug of new Set(SEEDS.map((seed) => seed.slug))) {
      const created = bodyOf<WorkflowDetail>(
        await as("post", WORKFLOWS)
          .send({ name: nameOf(slug) })
          .expect(201),
      );
      const [draft, ...older] = SEEDS.filter((seed) => seed.slug === slug);

      for (const version of older.reverse()) {
        await canvasSave(created.id, version.document);
        await as("post", `${WORKFLOWS}/${created.id}/publish`).send({}).expect(200);
      }
      await canvasSave(created.id, draft.document);
    }
  });

  afterAll(async () => {
    await api.truncate();
    await api.close();
    await engine.stop();
  });

  /** A request as the workspace's owner, already carrying the workspace. */
  function as(method: "get" | "post" | "put", path: string) {
    return api.as(owner)(method, path).set(TENANT_HEADER, tenant);
  }

  /**
   * A save from the visual editor, on the draft's current etag.
   *
   * @param id - The workflow.
   * @param definition - The document the canvas holds.
   */
  async function canvasSave(id: string, definition: unknown): Promise<void> {
    const detail = bodyOf<WorkflowDetail>(await as("get", `${WORKFLOWS}/${id}`).expect(200));

    await as("put", `${WORKFLOWS}/${id}/draft`)
      .set("If-Match", detail.draft.etag)
      .send({ definition })
      .expect(200);
  }

  /**
   * Open a seed as the code view does: a draft as the draft, a published seed by its version.
   *
   * @param seed - The seed.
   * @returns The file.
   */
  async function readFile(seed: SeedFile): Promise<WorkflowCode> {
    const version = publishedAs(seed);
    const query = version === undefined ? "" : `?version=${version}`;

    return bodyOf<WorkflowCode>(
      await as("get", `${WORKFLOWS}/${seed.slug}/code${query}`).expect(200),
    );
  }

  /** A save from the code editor. */
  function codeSave(seed: SeedFile, etag: string, text: string) {
    return as("put", `${WORKFLOWS}/${seed.slug}/code`).set("If-Match", etag).send({ text });
  }

  /**
   * Put a draft's seeded text back.
   *
   * @param seed - The draft's seed.
   * @param etag - The draft's current etag.
   * @returns The etag after the save, whose spans are the seed's again.
   */
  async function restore(seed: SeedFile, etag: string): Promise<string> {
    const restored = bodyOf<WorkflowCode>(await codeSave(seed, etag, seed.text).expect(200));

    expect(restored.spans).toEqual(seed.spans);
    return restored.etag;
  }

  it("serves every seed's span map as spans.json records it, on the lines the compiler finds each stage call", async () => {
    for (const seed of SEEDS) {
      const file = await readFile(seed);

      expect(file.text).toBe(seed.text);
      GOLDENS.spans.hold(seed.tag, file.spans);
      expect(stageCallsOf(file.text).map(spanOf)).toEqual(file.spans);
    }
  });

  it("serves every seed's diagnostics as diagnostics.json records them, in the editor's order", async () => {
    for (const seed of SEEDS) {
      const { diagnostics } = await readFile(seed);

      expectEditorOrder(diagnostics);
      expect(diagnostics.filter((diagnostic) => diagnostic.message === "")).toEqual([]);
      GOLDENS.diagnostics.hold(seedCaseName(seed.tag, "seeded"), recorded(diagnostics));
    }
  });

  it("serves every seed's Loop Checks rows as checks.json records them, with no infra row (C7)", async () => {
    for (const seed of SEEDS) {
      const file = await readFile(seed);
      const checks = bodyOf<WorkflowCodeChecks>(await as("get", file.checksRef).expect(200));

      expectHonestRows(checks.rows, file.diagnostics);
      GOLDENS.checks.hold(seedCaseName(seed.tag, "seeded"), checks.rows);
    }
  });

  it("keeps every span, and every finding on one, on its stage after a save grows or shrinks the content above it", async () => {
    for (const seed of DRAFTS) {
      const opened = await readFile(seed);
      let { etag } = opened;

      for (const shift of shiftCases(seed.text)) {
        const response = await codeSave(seed, etag, shift.text);

        try {
          expect({ shift: shift.name, status: response.status }).toEqual({
            shift: shift.name,
            status: 200,
          });
          const saved = bodyOf<WorkflowCode>(response);
          etag = saved.etag;

          expect(saved.text).toBe(shift.text);
          expect(saved.spans).toEqual(shiftedSpans(opened.spans, shift.index, shift.delta));
          expect(stageCallsOf(saved.text).map(spanOf)).toEqual(saved.spans);
          expect(saved.diagnostics).toEqual(
            shiftedDiagnostics(opened.diagnostics, opened.spans, shift.index, shift.delta),
          );
        } finally {
          etag = await restore(seed, etag);
        }
      }
    }
  });

  it("answers each sabotaged standard-fix save with the diagnostics and rows recorded for it", async () => {
    let { etag } = await readFile(CANVAS);

    for (const file of sabotagedFiles(CANVAS)) {
      const response = await codeSave(CANVAS, etag, file.text);

      try {
        expect({ file: file.name, status: response.status }).toEqual({
          file: file.name,
          status: 200,
        });
        const saved = bodyOf<WorkflowCode>(response);
        etag = saved.etag;

        expectEditorOrder(saved.diagnostics);
        GOLDENS.diagnostics.hold(file.name, recorded(saved.diagnostics));

        const checks = bodyOf<WorkflowCodeChecks>(await as("get", saved.checksRef).expect(200));
        expectHonestRows(checks.rows, saved.diagnostics);
        GOLDENS.checks.hold(file.name, checks.rows);
      } finally {
        etag = await restore(CANVAS, etag);
      }
    }
  });

  it("refuses a file the parser cannot read with a 422 whose diagnostics are recorded, writing nothing", async () => {
    const opened = await readFile(CANVAS);

    const body = bodyOf<ErrorEnvelope>(
      await codeSave(CANVAS, opened.etag, parseRefusal().text).expect(422),
    );
    const diagnostics = body.details.diagnostics as CodeDiagnostic[];

    expect(body.code).toBe("workflow_code_invalid");
    expectEditorOrder(diagnostics);
    GOLDENS.diagnostics.hold(PARSE_REFUSAL.name, recorded(diagnostics));
    expect(await readFile(CANVAS)).toEqual(opened);
  });

  it("offers, from the served table, every word each seed writes where it writes it — and warns of each name it cannot", async () => {
    const table = bodyOf<CodeSymbolTable>(await as("get", `${WORKFLOWS}/code-symbols`).expect(200));

    for (const seed of SEEDS) {
      const file = await readFile(seed);

      GOLDENS.contexts.hold(seed.tag, contextsIn(table, file.text).map(formatContext));
      expect({
        seed: seed.tag,
        disagreements: disagreements(table, file.text, file.diagnostics, SUGGESTIONS),
      }).toEqual({ seed: seed.tag, disagreements: [] });
    }
  });

  it("drives the engine stub only as the engine's contract allows", () => {
    expect([...new Set(engine.violations)]).toEqual([]);
  });
});
