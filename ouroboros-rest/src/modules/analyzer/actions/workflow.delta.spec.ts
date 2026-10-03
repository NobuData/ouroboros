import type { WorkflowDocument } from "../../workflows/dsl.schema";
import { readFixture } from "../../workflows/dsl.golden.fixture";
import { validateWorkflowDocument } from "../../workflows/dsl.validator";
import {
  addPathStage,
  DeltaRefusal,
  moveStageBefore,
  resolveStage,
  summarizeDelta,
} from "./workflow.delta";

/**
 * The workflow deltas (BV.5, #514) over mockup 04's committed canvas — `standard-fix` v14, the
 * workflow the seeded review-first and flake-retry suggestions name. Each result must still be a
 * document P.2 accepts, because it becomes a real draft.
 */

/** `standard-fix` v14: implement → build → test → review → checks-green. */
function standardFix(): WorkflowDocument {
  return readFixture("valid/standard-fix.json") as WorkflowDocument;
}

/**
 * The chain of default edges from a node.
 *
 * @param document - The document.
 * @param from - The first node.
 * @param stop - Where to stop.
 * @returns The node ids in order.
 */
function chain(document: WorkflowDocument, from: string, stop: string): string[] {
  const order = [from];
  let at = from;
  while (at !== stop) {
    const next = document.edges.find((edge) => edge.from === at && edge.kind === "default");
    if (next === undefined) break;
    order.push(next.to);
    at = next.to;
  }
  return order;
}

describe("resolving a stage label", () => {
  it("finds a node by id, or by the one title that slugs to the label", () => {
    expect(resolveStage(standardFix(), "build").id).toBe("build");
    expect(resolveStage(standardFix(), "self-review").id).toBe("review");
  });

  it("refuses a label nothing answers to", () => {
    expect(() => resolveStage(standardFix(), "lint")).toThrow(DeltaRefusal);
  });
});

describe("moving a stage before another (review-first)", () => {
  it("runs self-review before the build, and the document is still valid", () => {
    const base = standardFix();
    const { document, change } = moveStageBefore(base, "self-review", "build");

    expect(chain(document, "implement", "checks-green")).toEqual([
      "implement",
      "review",
      "build",
      "test",
      "checks-green",
    ]);
    expect(change).toBe(
      "moves `review` (Self-review diff) to run before `build` (Build farm · pool A)",
    );
    expect(validateWorkflowDocument(document).valid).toBe(true);
    // The loop back to implement is untouched, and the base was not edited.
    expect(document.edges).toContainEqual(
      expect.objectContaining({ from: "checks-green", to: "implement", kind: "loop" }),
    );
    expect(chain(base, "implement", "checks-green")).toEqual([
      "implement",
      "build",
      "test",
      "review",
      "checks-green",
    ]);
  });

  it("refuses a stage that already runs right before, and one that is not a simple link", () => {
    expect(() => moveStageBefore(standardFix(), "test", "review")).toThrow("already runs");
    expect(() => moveStageBefore(standardFix(), "effort-recheck", "build")).toThrow(
      "not one link of a chain",
    );
  });
});

describe("adding a path-conditioned stage (flake-retry)", () => {
  it("branches after the test stage on the paths predicate, and the document is still valid", () => {
    const { document, change } = addPathStage(
      standardFix(),
      ["drivers/can/**"],
      "flake-retry under load profile",
    );

    const decision = document.nodes.find((node) => node.id === "touches-drivers-can");
    expect(decision).toMatchObject({
      type: "flow",
      config: { kind: "decision", predicate: { kind: "paths", op: "any" } },
    });
    expect(document.edges).toContainEqual({
      from: "test",
      to: "touches-drivers-can",
      kind: "default",
    });
    expect(document.edges).toContainEqual(
      expect.objectContaining({
        from: "touches-drivers-can",
        to: "flake-retry-under-load-profile",
      }),
    );
    expect(document.edges).toContainEqual(
      expect.objectContaining({
        from: "touches-drivers-can",
        to: "review",
        condition: { kind: "paths", op: "none", globs: ["drivers/can/**"] },
      }),
    );
    expect(change).toContain("run only when a change touches drivers/can/**");
    expect(validateWorkflowDocument(document).valid).toBe(true);
  });

  it("keeps new ids unique when the slug is already taken", () => {
    const once = addPathStage(standardFix(), ["drivers/can/**"], "test").document;

    expect(once.nodes.filter((node) => node.id.startsWith("test")).map((node) => node.id)).toEqual([
      "test",
      "test-2",
    ]);
  });
});

describe("the delta summary (the preview's stage and connection delta)", () => {
  it("is a re-wiring for review-first: no stage added or removed, three connections each way", () => {
    const base = standardFix();
    const summary = summarizeDelta(base, moveStageBefore(base, "self-review", "build").document);

    expect(summary.nodesAdded).toEqual([]);
    expect(summary.nodesRemoved).toEqual([]);
    expect([...summary.edgesAdded].sort()).toEqual([
      "implement → review",
      "review → build",
      "test → checks-green",
    ]);
    expect([...summary.edgesRemoved].sort()).toEqual([
      "implement → build",
      "review → checks-green",
      "test → review",
    ]);
  });

  it("names the two stages and four connections flake-retry adds, branches with their labels", () => {
    const base = standardFix();
    const summary = summarizeDelta(
      base,
      addPathStage(base, ["drivers/can/**"], "flake-retry under load profile").document,
    );

    expect(summary.nodesAdded).toEqual([
      "`touches-drivers-can` (Touches drivers/can/**?)",
      "`flake-retry-under-load-profile` (flake-retry under load profile)",
    ]);
    expect(summary.nodesRemoved).toEqual([]);
    expect(summary.edgesRemoved).toEqual(["test → review"]);
    expect([...summary.edgesAdded].sort()).toEqual([
      "flake-retry-under-load-profile → review",
      "test → touches-drivers-can",
      "touches-drivers-can → flake-retry-under-load-profile (branch: touches paths)",
      "touches-drivers-can → review (branch: elsewhere)",
    ]);
  });

  it("is empty for a document that did not change, and names a stage that was removed", () => {
    const base = standardFix();
    const without = { ...base, nodes: base.nodes.filter((node) => node.id !== "review") };

    expect(summarizeDelta(base, standardFix())).toEqual({
      nodesAdded: [],
      nodesRemoved: [],
      edgesAdded: [],
      edgesRemoved: [],
    });
    expect(summarizeDelta(base, without).nodesRemoved).toEqual(["`review` (Self-review diff)"]);
  });
});
