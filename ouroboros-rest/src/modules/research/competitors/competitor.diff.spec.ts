import { MAX_CONTENT_BYTES, MAX_DIFF_BYTES, lineDiff, normaliseContent } from "./competitor.diff";

describe("normalised content", () => {
  it("trims lines, collapses whitespace and drops empty lines — re-spacing is not a change", () => {
    expect(normaliseContent("  6.2 —   Gust \n\n\t6.1  \r\n")).toBe("6.2 — Gust\n6.1");
  });

  it("is bounded by whole lines", () => {
    const line = "x".repeat(1000);
    const bounded = normaliseContent(Array.from({ length: 2000 }, () => line).join("\n"));

    expect(Buffer.byteLength(bounded)).toBeLessThanOrEqual(MAX_CONTENT_BYTES);
    expect(bounded.split("\n").every((kept) => kept === line)).toBe(true);
  });
});

describe("the line diff", () => {
  it("names the added line of a changelog that gained an entry", () => {
    const diff = lineDiff(
      "6.1 — Beacon\n6.0 — Portal",
      "6.2 — Gust-adaptive\n6.1 — Beacon\n6.0 — Portal",
    );

    expect(diff).toEqual({
      added: ["6.2 — Gust-adaptive"],
      removed: [],
      text: "+ 6.2 — Gust-adaptive",
    });
  });

  it("shows a reworded line as removed and added, in document order", () => {
    const diff = lineDiff("a\nold wording\nc", "a\nnew wording\nc");

    expect(diff.text).toBe("- old wording\n+ new wording");
  });

  it("is empty for equal text", () => {
    expect(lineDiff("a\nb", "a\nb").text).toBe("");
  });

  it("is bounded, with a count of what was left out", () => {
    const after = Array.from(
      { length: 5000 },
      (_, index) => `entry ${String(index)} ${"y".repeat(40)}`,
    ).join("\n");
    const { text } = lineDiff("", after);

    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(MAX_DIFF_BYTES);
    expect(text).toMatch(/… \d+ more changed lines$/);
  });

  it("falls back to set membership for a region too large to align", () => {
    const before = Array.from({ length: 3000 }, (_, index) => `old ${String(index)}`).join("\n");
    const after = Array.from({ length: 3000 }, (_, index) => `new ${String(index)}`).join("\n");
    const diff = lineDiff(before, after);

    expect(diff.added).toHaveLength(3000);
    expect(diff.removed).toHaveLength(3000);
  });
});
