import { describe, expect, it } from "vitest";

import { COMING_SOON_LABEL, NEEDS_NOTHING, catalogTiles, monogramOf, needsOf } from "@/app/catalog-tiles";

/**
 * The tile machinery both kind pickers share
 * ([#231](https://github.com/NobuData/ouroboros/issues/231),
 * [#141](https://github.com/NobuData/ouroboros/issues/141)): live tiles from the catalog in
 * its order, announcements that retire themselves, and the two derived strings.
 */

const label = (kind: string): string => ({ a: "Alpha", b: "Beta" })[kind] ?? kind;

describe("catalogTiles", () => {
  it("draws one live tile per entry in the catalog's order, then the announcements", () => {
    const tiles = catalogTiles(
      [
        { kind: "b", fields: [{ label: "Key", required: true }] },
        { kind: "a", fields: [] },
      ],
      label,
      [{ kind: "c", label: "Gamma", source: "X.1 (#1)" }],
    );

    expect(tiles).toEqual([
      { live: true, kind: "b", label: "Beta", monogram: "BE", needs: "Key", entry: { kind: "b", fields: [{ label: "Key", required: true }] } },
      { live: true, kind: "a", label: "Alpha", monogram: "AL", needs: NEEDS_NOTHING, entry: { kind: "a", fields: [] } },
      { live: false, kind: "c", label: "Gamma", monogram: "GA", source: "X.1 (#1)" },
    ]);
  });

  it("retires an announcement the moment the catalog answers its kind", () => {
    const tiles = catalogTiles([{ kind: "c", fields: [] }], label, [
      { kind: "c", label: "Gamma", source: "X.1 (#1)" },
    ]);

    expect(tiles).toHaveLength(1);
    expect(tiles[0]?.live).toBe(true);
  });

  it("labels a kind nobody wrote copy for by its own name", () => {
    expect(catalogTiles([{ kind: "zeta", fields: [] }], label, [])[0]?.label).toBe("zeta");
  });
});

describe("the derived strings", () => {
  it("makes a monogram from the label's first two letters or digits", () => {
    expect(monogramOf("GitHub")).toBe("GI");
    expect(monogramOf("OpenAI-compatible")).toBe("OP");
    expect(monogramOf("—")).toBe("?");
  });

  it("says what a form asks for, each optional field saying so", () => {
    expect(needsOf([{ label: "Base URL", required: true }, { label: "API key", required: false }])).toBe(
      "Base URL · API key (optional)",
    );
    expect(needsOf([])).toBe(NEEDS_NOTHING);
  });

  it("badges every promised tile with one phrase", () => {
    expect(COMING_SOON_LABEL).toBe("coming soon");
  });
});
