import { describe, expect, it } from "vitest";

import {
  FULL_REPORT_REASON,
  METER_FLOOR,
  UNPRICED,
  kindName,
  localShareNote,
  localSharePercent,
  meterWidth,
  noSpendNote,
  providerName,
  spendRow,
  spendRows,
  spendTitle,
  unpricedNote,
} from "@/app/models/spend";
import { MODELS_TABS } from "@/app/models/view";

import { emptySpend, seededSpend, spendRow as row } from "../helpers/models";

/**
 * The spend card's decisions (#204), as functions over Z.5's own oracle.
 *
 * The card renders money, so most of this suite is about the two ways a spend card lies —
 * printing `$0.00` for money nobody counted, and drawing a row of zeros for a workspace that
 * has spent nothing — and the one figure the footnote claims.
 */

describe("what a row is called", () => {
  it("names the six kinds the contract admits as the mockups print them", () => {
    expect(kindName("anthropic")).toBe("Anthropic");
    expect(kindName("copilot")).toBe("GitHub Copilot");
    expect(kindName("cursor")).toBe("Cursor");
    expect(kindName("ollama")).toBe("Ollama");
    expect(kindName("openai_compatible")).toBe("OpenAI-compatible");
    expect(kindName("custom")).toBe("Custom");
  });

  it("prints a kind the vocabulary no longer admits as it was recorded, not as Unknown", () => {
    // Decision F8: the ledger's `provider` is free text so retiring a connection cannot
    // rewrite history. A row named `vertex` says where the money went.
    expect(kindName("vertex")).toBe("vertex");
  });

  it("does not let an inherited property pass for a kind", () => {
    expect(kindName("toString")).toBe("toString");
  });

  it("names the local row from every kind it sums, in the service's order", () => {
    // Not the mockup's `Local (vLLM + Ollama)`: the ledger records a kind, not the product
    // behind it, and the row is a sum over every OpenAI-compatible endpoint.
    expect(providerName(seededSpend().providers[3])).toBe("Local (Ollama + OpenAI-compatible)");
  });

  it("names a cloud row by its one kind", () => {
    expect(providerName(seededSpend().providers[0])).toBe("Anthropic");
  });
});

describe("what a row says", () => {
  it("prints a priced total as money, to the cent", () => {
    const decided = spendRow(seededSpend().providers[0]);

    expect(decided.amount).toBe("$412.80");
    expect(decided.unpriced).toBeNull();
    expect(decided.tone).toBe("accent");
  });

  it("prints a zero-priced total as $0.00, because that is what was measured", () => {
    // The mockup's local row: priced, at nothing.
    const decided = spendRow(seededSpend().providers[3]);

    expect(decided.amount).toBe("$0.00");
    expect(decided.tone).toBe("ok");
  });

  it("carries the unpriced count beside a priced figure, so $0.00 says both facts", () => {
    // The seeded local row holds 260 calls priced at nothing and five nobody priced.
    expect(spendRow(seededSpend().providers[3]).unpriced).toBe("5 unpriced calls");
  });

  it("prints no amount at all for a row nobody priced — never $0.00", () => {
    const decided = spendRow(row({ spendCents: null, meterFraction: null, unpricedCalls: 12 }));

    expect(decided.amount).toBeNull();
    expect(decided.meter).toBeNull();
    expect(decided.unpriced).toBe("12 unpriced calls");
  });

  it("keeps the unpriced word and the em-dash apart, because they are different facts", () => {
    expect(UNPRICED).toBe("unpriced");
  });

  it("pluralises the unpriced note", () => {
    expect(unpricedNote(1)).toBe("1 unpriced call");
    expect(unpricedNote(5)).toBe("5 unpriced calls");
  });
});

describe("the meter", () => {
  it("draws the largest row at the full width the service gave it", () => {
    expect(meterWidth(1)).toBe(1);
  });

  it("passes a fraction through untouched above the floor", () => {
    expect(meterWidth(0.18410852713178294)).toBe(0.18410852713178294);
  });

  it("floors a priced row at a visible sliver, so the ok-meter treatment can be seen", () => {
    // The contract serves 0 as the honest width of a row that cost nothing and says the
    // visible minimum is the card's. The figure beside the meter carries the value.
    expect(meterWidth(0)).toBe(METER_FLOOR);
    expect(meterWidth(0.001)).toBe(METER_FLOOR);
    expect(METER_FLOOR).toBe(0.02);
  });

  it("draws no meter for a row with nothing priced, rather than an empty one", () => {
    expect(meterWidth(null)).toBeNull();
  });
});

describe("the rows", () => {
  it("decides the seeded card row for row, in the service's order", () => {
    const rows = spendRows(seededSpend());

    expect(rows.map((decided) => [decided.name, decided.amount, decided.meter, decided.tone])).toEqual([
      ["Anthropic", "$412.80", 1, "accent"],
      ["GitHub Copilot", "$76.00", 0.18410852713178294, "accent"],
      ["Cursor", "$64.10", 0.15528100775193798, "accent"],
      ["Local (Ollama + OpenAI-compatible)", "$0.00", METER_FLOOR, "ok"],
    ]);
  });

  it("uses the contract's key as the row's identity", () => {
    expect(spendRows(seededSpend()).map((decided) => decided.key)).toEqual([
      "anthropic",
      "copilot",
      "cursor",
      "ollama+openai_compatible",
    ]);
  });

  it("passes an empty workspace through as no rows, not a row of zeros", () => {
    expect(spendRows(emptySpend())).toEqual([]);
  });
});

describe("the footnote", () => {
  it("prints the seeded share as the mockup does, with no rounding", () => {
    expect(localShareNote(seededSpend())).toBe("Local models served 31% of all tokens.");
  });

  it("rounds a share to a whole percent", () => {
    expect(localSharePercent(0.314)).toBe("31%");
    expect(localSharePercent(0.315)).toBe("32%");
  });

  it("says 0% for a workspace that ran nothing locally, which is a true sentence", () => {
    expect(localSharePercent(0)).toBe("0%");
    expect(localShareNote({ ...seededSpend(), localTokenShare: 0 })).toBe(
      "Local models served 0% of all tokens.",
    );
  });

  it("says <1% rather than 0% for a share too small to round to a percent", () => {
    // `0%` would say nothing ran locally when something did.
    expect(localSharePercent(0.004)).toBe("<1%");
  });

  it("says nothing for a window holding no tokens, because there is no share to claim", () => {
    expect(localSharePercent(null)).toBeNull();
    expect(localShareNote(emptySpend())).toBeNull();
  });

  it("prints a full share as 100%", () => {
    expect(localSharePercent(1)).toBe("100%");
  });
});

describe("the copy", () => {
  it("titles the card from the window it was measured over", () => {
    expect(spendTitle(30)).toBe("Spend by provider · 30d");
    expect(spendTitle(7)).toBe("Spend by provider · 7d");
  });

  it("names the report's owner in the same words the Spend tab uses", () => {
    // Two ways of reaching the report, one sentence about when it arrives.
    const tab = MODELS_TABS.find((candidate) => candidate.id === "spend");

    expect(FULL_REPORT_REASON).toMatch(/#210/);
    expect(tab !== undefined && "note" in tab ? tab.note : null).toBe(FULL_REPORT_REASON);
  });

  it("writes the zero-state note from the window", () => {
    expect(noSpendNote(30)).toMatch(/last 30 days/);
    expect(noSpendNote(30)).not.toMatch(/\$/);
  });
});
