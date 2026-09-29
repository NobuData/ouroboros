import { describe, expect, it } from "vitest";

import type { PrSpendLine } from "@/app/api/pull-requests";
import { MODELS_PATH, ROUTING_MATRIX_HASH } from "@/app/paths";
import {
  LOOP_LABEL,
  NONE_RECORDED,
  NO_CAP,
  NO_LOOP_SPEND,
  ROUTING_HREF,
  VERIFICATION_LABEL,
  capLine,
  spendCard,
  spendRow,
} from "@/app/prs/spend";

import { seededSpend } from "../helpers/pull-requests";

/**
 * The Spend card (#369): the card matches the seeds, and the unpriced case shows counts with an
 * em-dash rather than `$0`.
 */

/**
 * A spend line.
 *
 * @param tokens Its tokens.
 * @param costCents Its cost, or `null` when nothing is priced.
 * @param unpricedEvents How many rows carry no price.
 * @returns The line.
 */
function line(tokens: number, costCents: string | null, unpricedEvents = 0): PrSpendLine {
  return { tokens, tokensIn: tokens, tokensOut: 0, costCents, unpricedEvents };
}

describe("the seeded card (mockup 12)", () => {
  it("draws the mockup's two rows and its cap line", () => {
    const card = spendCard(seededSpend());

    expect(card.rows.map((row) => [row.label, row.figure])).toEqual([
      [LOOP_LABEL, "284k tokens · $1.52"],
      [VERIFICATION_LABEL, "41k · $0.19"],
    ]);
    expect(card.cap).toEqual({ text: "within $2.50 cap", tone: "ok" });
    expect(card.empty).toBeNull();
    expect(card.rows.every((row) => row.note === null)).toBe(true);
  });

  it("leads Routing to the matrix, where a route's cap is set", () => {
    expect(ROUTING_HREF).toBe(`${MODELS_PATH}#${ROUTING_MATRIX_HASH}`);
  });
});

describe("the unpriced case — counts with an em-dash, never $0", () => {
  it("draws the count and an em-dash when nothing is priced", () => {
    const row = spendRow(LOOP_LABEL, line(284_000, null, 6), true);

    expect(row.figure).toBe("284k tokens · —");
    expect(row.figure).not.toContain("$");
    expect(row.figure).not.toMatch(/0\.00/);
    expect(row.note).toBeNull();
  });

  it("says not priced to a screen reader — a dash read aloud says nothing", () => {
    expect(spendRow(LOOP_LABEL, line(284_000, null, 6), true).spoken).toBe(
      "284k tokens, not priced",
    );
    expect(spendRow(VERIFICATION_LABEL, line(41_000, null, 1), false).spoken).toBe(
      "41k tokens, not priced",
    );
  });

  it("reads a cost that is not a number as unpriced, never as zero", () => {
    expect(spendRow(LOOP_LABEL, line(284_000, "n/a"), true).figure).toBe("284k tokens · —");
  });

  it("draws the whole card without a dollar sign when the ledger is unpriced", () => {
    const card = spendCard(
      seededSpend({
        loop: line(284_000, null, 6),
        verification: line(41_000, null, 1),
        cap: null,
        withinCap: null,
      }),
    );

    expect(JSON.stringify(card)).not.toContain("$");
    expect(card.rows.map((row) => row.figure)).toEqual(["284k tokens · —", "41k · —"]);
  });

  it("draws $0.00 only for a ledger priced at zero — a real zero is free", () => {
    expect(spendRow(LOOP_LABEL, line(1_200, "0.0000"), true).figure).toBe("1.2k tokens · $0.00");
  });
});

describe("a lower bound says so", () => {
  it("notes the calls that were not priced beside the cost", () => {
    const row = spendRow(LOOP_LABEL, line(284_000, "152.0000", 3), true);

    expect(row.figure).toBe("284k tokens · $1.52");
    expect(row.note).toBe("lower bound — 3 calls unpriced");
    expect(row.spoken).toBe("284k tokens, at least $1.52");
    expect(spendRow(LOOP_LABEL, line(284_000, "152.0000", 1), true).note).toBe(
      "lower bound — 1 call unpriced",
    );
  });
});

describe("a line nothing was spent on", () => {
  it("says none recorded, rather than a count of nothing beside an em-dash", () => {
    expect(spendRow(VERIFICATION_LABEL, line(0, null), false)).toEqual({
      label: VERIFICATION_LABEL,
      figure: NONE_RECORDED,
      note: null,
      spoken: NONE_RECORDED,
    });
  });

  it("still draws usage that was counted and not priced", () => {
    expect(spendRow(VERIFICATION_LABEL, line(0, null, 2), false).figure).toBe("0 · —");
  });
});

describe("capLine — never within unless the service said so", () => {
  it("says within and over as the service states them", () => {
    expect(capLine(seededSpend())).toEqual({ text: "within $2.50 cap", tone: "ok" });
    expect(
      capLine(seededSpend({ loop: line(520_000, "310.0000"), withinCap: false })),
    ).toEqual({ text: "over $2.50 cap", tone: "err" });
  });

  it("states the cap and why it cannot be compared when nothing is priced", () => {
    const cap = capLine(seededSpend({ loop: line(284_000, null, 6), withinCap: null }));

    expect(cap.tone).toBe("neutral");
    expect(cap.text).toBe("$2.50 cap — not comparable: nothing the loop spent is priced");
    expect(cap.text).not.toMatch(/^within/);
  });

  it("states the cap and why when the cost is only a lower bound", () => {
    expect(
      capLine(seededSpend({ loop: line(284_000, "152.0000", 3), withinCap: null })),
    ).toEqual({
      text: "$2.50 cap — not comparable: some of what the loop spent is not priced",
      tone: "neutral",
    });
  });

  it("says no cap is set when the route sets none", () => {
    expect(capLine(seededSpend({ cap: null, withinCap: null }))).toEqual({
      text: NO_CAP,
      tone: "neutral",
    });
  });
});

describe("a PR no loop opened", () => {
  it("says so, with no rows and no cap", () => {
    expect(spendCard(null)).toEqual({ rows: [], cap: null, empty: NO_LOOP_SPEND });
  });
});
