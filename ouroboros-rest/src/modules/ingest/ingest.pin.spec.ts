import { readFixture } from "../workflows/dsl.golden.fixture";
import { readPinnedWorkflow } from "./ingest.pin";

/**
 * The pinned document, read as the facts a stage row needs.
 *
 * Asserted against `schemas/workflow-dsl/fixtures/valid/standard-fix.json` — the same
 * document the studio's own suites publish and the one the console's mockup is drawn from —
 * rather than against a hand-written object, because what this file has to be right about is
 * *the DSL as it is actually stored*. A fixture written beside the reader would agree with
 * the reader by construction.
 *
 * Three things are worth catching here and nowhere else:
 *
 *   * **the `+ 1`** — `limits.max_retries` is retries and `run_stages.max_attempts` is
 *     attempts, and an off-by-one would render `attempt 2/2` on a stage that may be tried
 *     three times;
 *   * **`flow` becoming two words** — a gate-return note prints *"loop returned from gate"*,
 *     and a `decision` that read as `gate` would put the wrong noun in a stored sentence;
 *   * **an unreadable document yielding an empty pin rather than a throw** — the caller then
 *     refuses with a machine-readable code instead of a `500` naming zod.
 */

/** The document mockup 10's run is pinned to. */
function standardFix(): unknown {
  return readFixture("valid/standard-fix.json");
}

describe("reading a published document", () => {
  it("keys every stage by its node id, in document order", () => {
    const pin = readPinnedWorkflow(standardFix());

    expect([...pin.stages.keys()]).toEqual([
      "issue-queued",
      "analyze",
      "effort-recheck",
      "plan",
      "split",
      "back-to-queue",
      "implement",
      "build",
      "test",
      "review",
      "checks-green",
      "open-pr",
    ]);
    expect(pin.stageTotal).toBe(12);
    expect(pin.firstStage?.stageKey).toBe("issue-queued");
  });

  it("numbers positions from 1, in the document's own order", () => {
    const pin = readPinnedWorkflow(standardFix());

    expect(pin.stages.get("issue-queued")?.position).toBe(1);
    expect(pin.stages.get("implement")?.position).toBe(7);
    expect(pin.stages.get("open-pr")?.position).toBe(12);
  });

  it("snapshots the title the version had, not a slug", () => {
    // `stage_label` is what the stepper prints, and V045 stores it so a run performed in
    // March still reads the way it read in March.
    const pin = readPinnedWorkflow(standardFix());

    expect(pin.stages.get("implement")?.label).toBe("Code the change");
    expect(pin.stages.get("checks-green")?.label).toBe("Checks green?");
  });

  it("turns max_retries into max_attempts by adding one", () => {
    // The `/3` of *attempt 2/3*. `implement` allows two retries, which is three attempts —
    // V045: "total attempts rather than retries because the total is the number rendered".
    const pin = readPinnedWorkflow(standardFix());

    expect(pin.stages.get("implement")?.maxAttempts).toBe(3);
    expect(pin.stages.get("implement")?.tokenBudget).toBe(400_000);
    expect(pin.stages.get("split")?.maxAttempts).toBe(2);
  });

  it("leaves a stage with no limits object without either number", () => {
    // Every node that is not an `llm`. V045 stores null there, and *"this stage has no
    // limit"* is a transition the attempt check cannot refuse rather than one it refuses at 1.
    const pin = readPinnedWorkflow(standardFix());

    expect(pin.stages.get("build")?.maxAttempts).toBeUndefined();
    expect(pin.stages.get("build")?.tokenBudget).toBeUndefined();
    expect(pin.stages.get("issue-queued")?.maxAttempts).toBeUndefined();
  });

  it("resolves the five DSL types into the six words a stage row uses", () => {
    // `flow` is the one that becomes two, and the difference is the noun a return note
    // prints. Everything else is the same word.
    const pin = readPinnedWorkflow(standardFix());

    expect(pin.stages.get("issue-queued")?.kind).toBe("trigger");
    expect(pin.stages.get("implement")?.kind).toBe("llm");
    expect(pin.stages.get("build")?.kind).toBe("infra");
    expect(pin.stages.get("open-pr")?.kind).toBe("term");
    expect(pin.stages.get("checks-green")?.kind).toBe("gate");
    expect(pin.stages.get("effort-recheck")?.kind).toBe("decision");
  });
});

describe("reading something that is not a document", () => {
  it.each([
    ["null", null],
    ["a string", "standard-fix"],
    ["an empty object", {}],
    ["a document with no version", { trigger: {}, nodes: [], edges: [] }],
  ])("yields an empty pin for %s rather than throwing", (_name, definition) => {
    // A published version cannot reach this state through the studio — the publish gate
    // validates the document — so it means the row was written by something else. The caller
    // turns an empty pin into `workflow_pin_unreadable`, which is an answer an executor can
    // act on; a parse error would be a `500` naming zod.
    const pin = readPinnedWorkflow(definition);

    expect(pin.stages.size).toBe(0);
    expect(pin.stageTotal).toBe(0);
    expect(pin.firstStage).toBeUndefined();
  });

  it("keeps the document's node count when one node is unreadable", () => {
    // A node this reader could not parse is still a stage of the workflow. A total that
    // shrank because of one would make the meter read `1/1` on a two-stage document, and the
    // positions after it would all move.
    const document = readFixture("valid/standard-fix.json") as { nodes: unknown[] };
    const damaged = { ...document, nodes: [{ id: "broken" }, ...document.nodes] };

    const pin = readPinnedWorkflow(damaged);

    expect(pin.stageTotal).toBe(document.nodes.length + 1);
    expect(pin.stages.size).toBe(document.nodes.length);
    expect(pin.stages.get("analyze")?.position).toBe(3);
  });
});
