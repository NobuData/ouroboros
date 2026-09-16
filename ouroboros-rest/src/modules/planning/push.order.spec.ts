import { DependencyCycleError, pushOrder, type DraftEdge, type OrderedDraft } from "./push.order";

/**
 * AL.3's ordering criterion — *issues are created in dependency order; a blocker always exists
 * before its dependent references it* — as a pure function
 * ([#279](https://github.com/NobuData/ouroboros/issues/279)).
 */

/** Drafts keyed `OTA-1 … OTA-n`, with ids `d1 … dn`. */
function drafts(count: number): OrderedDraft[] {
  return Array.from({ length: count }, (_unused, index) => ({
    id: `d${String(index + 1)}`,
    localKey: `OTA-${String(index + 1)}`,
  }));
}

/** `a blocks b`, by draft number. */
function blocks(blocker: number, blocked: number): DraftEdge {
  return { blockerId: `d${String(blocker)}`, blockedId: `d${String(blocked)}` };
}

/** The local keys, in order. */
function keys(ordered: readonly OrderedDraft[]): string[] {
  return ordered.map((draft) => draft.localKey);
}

describe("pushOrder", () => {
  it("orders a batch with no dependencies by local key, numerically", () => {
    const shuffled = [...drafts(11)].reverse();

    expect(keys(pushOrder(shuffled, []))).toStrictEqual(
      Array.from({ length: 11 }, (_unused, index) => `OTA-${String(index + 1)}`),
    );
  });

  it("puts every blocker before what it blocks, however the edges run against key order", () => {
    // OTA-6 blocks everything; OTA-5 blocks OTA-1..4 — the mockup's six-draft batch, reversed.
    const edges = [blocks(6, 5), blocks(5, 4), blocks(4, 3), blocks(3, 2), blocks(2, 1)];
    const ordered = keys(pushOrder(drafts(6), edges));

    expect(ordered).toStrictEqual(["OTA-6", "OTA-5", "OTA-4", "OTA-3", "OTA-2", "OTA-1"]);

    for (const edge of edges) {
      expect(ordered.indexOf(`OTA-${edge.blockerId.slice(1)}`)).toBeLessThan(
        ordered.indexOf(`OTA-${edge.blockedId.slice(1)}`),
      );
    }
  });

  it("releases a draft only once every one of its blockers is placed", () => {
    // OTA-3 waits on OTA-1 and OTA-4; OTA-2 is free.
    expect(keys(pushOrder(drafts(4), [blocks(1, 3), blocks(4, 3)]))).toStrictEqual([
      "OTA-1",
      "OTA-2",
      "OTA-4",
      "OTA-3",
    ]);
  });

  it("ignores edges to drafts that are not being pushed, and self-edges", () => {
    const edges = [blocks(9, 1), { blockerId: "d2", blockedId: "unselected" }, blocks(2, 2)];

    expect(keys(pushOrder(drafts(2), edges))).toStrictEqual(["OTA-1", "OTA-2"]);
  });

  it("refuses a cycle and names it by local key, from its smallest key", () => {
    const attempt = () => pushOrder(drafts(4), [blocks(4, 1), blocks(1, 3), blocks(3, 1)]);

    expect(attempt).toThrow(DependencyCycleError);

    try {
      attempt();
    } catch (error) {
      expect((error as DependencyCycleError).cycle).toStrictEqual(["OTA-1", "OTA-3", "OTA-1"]);
      expect((error as Error).message).toBe(
        "the batch's dependencies form a cycle: OTA-1 → OTA-3 → OTA-1",
      );
    }
  });

  it("names a longer cycle in the direction its edges run", () => {
    try {
      pushOrder(drafts(3), [blocks(1, 2), blocks(2, 3), blocks(3, 1)]);
      throw new Error("expected a cycle");
    } catch (error) {
      expect((error as DependencyCycleError).cycle).toStrictEqual([
        "OTA-1",
        "OTA-2",
        "OTA-3",
        "OTA-1",
      ]);
    }
  });

  it("answers nothing for nothing", () => {
    expect(pushOrder([], [])).toStrictEqual([]);
  });
});
