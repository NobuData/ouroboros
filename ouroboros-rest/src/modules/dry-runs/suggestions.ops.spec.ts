import { foldOperations } from "./suggestions.ops";
import { SEEDED_CATALOGUE, SEEDED_CONDITIONAL_OPS, SEEDED_DRAFT } from "./suggestions.seed.fixture";

describe("folding a suggestion's operations over a draft", () => {
  it("applies them in order and answers the validated operations and the document", () => {
    const fold = foldOperations(SEEDED_DRAFT, SEEDED_CONDITIONAL_OPS, SEEDED_CATALOGUE);

    expect(fold.ok).toBe(true);
    if (!fold.ok) return;
    expect(fold.operations).toHaveLength(SEEDED_CONDITIONAL_OPS.length);
    expect((fold.document as { nodes: unknown[] }).nodes).toHaveLength(
      SEEDED_DRAFT.nodes.length + 1,
    );
    // The draft it started from is not mutated.
    expect(SEEDED_DRAFT.nodes).toHaveLength(10);
  });

  it("stops at the first operation that no longer fits, and says which and why", () => {
    // The draft moved on: somebody removed the edge the suggestion rewires.
    const moved = {
      ...SEEDED_DRAFT,
      edges: SEEDED_DRAFT.edges.filter(
        (edge) => !(edge.from === "test" && edge.to === "exploit-verify"),
      ),
    };

    const fold = foldOperations(moved, SEEDED_CONDITIONAL_OPS, SEEDED_CATALOGUE);

    expect(fold).toMatchObject({ ok: false, operation: 1, kind: "remove_edge" });
    if (fold.ok) return;
    expect(fold.reason).toContain("exploit-verify");
  });

  it("refuses an operation that is not one, and an empty batch is simply nothing", () => {
    expect(foldOperations(SEEDED_DRAFT, [{ kind: "explode", params: {} }])).toMatchObject({
      ok: false,
      operation: 0,
      kind: "explode",
    });
    expect(foldOperations(SEEDED_DRAFT, [])).toEqual({
      ok: true,
      operations: [],
      document: SEEDED_DRAFT,
    });
  });
});
