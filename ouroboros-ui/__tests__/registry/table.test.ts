import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { AliasHealthState } from "@/app/api/registry";
import {
  CANCEL_LABEL,
  EM_DASH,
  FIX_IN_PROVIDERS,
  HEALTH_CELLS,
  INSPECTOR_EMPTY_NOTE,
  INSPECTOR_EMPTY_TITLE,
  INSPECTOR_TITLE,
  MANAGE_PROVIDERS,
  NO_PROVIDER,
  ORG_OVERRIDE,
  SWITCH_OFF_CONFIRM,
  SWITCH_UNBOUND,
  TABLE_NOTE,
  TABLE_TITLE,
  aliasCount,
  healthCell,
  inspectorTitle,
  needsConfirmation,
  priceCell,
  priceProvenance,
  providerCell,
  selectedAlias,
  selectionAnnouncement,
  switchLabel,
  switchOffNote,
  switchOffTitle,
  tableRows,
  usedByCell,
} from "@/app/registry/table";

import { SEEDED_ANTHROPIC_ID } from "../helpers/providers";
import {
  CATALOG_VERSION,
  NO_KEY_NOTE,
  registryAlias,
  seededRegistry,
  tokenPrice,
  unpricedPrice,
} from "../helpers/registry";

/**
 * Every decision the allowed-models table makes (#592), as functions over the dev seed's own
 * rows.
 *
 * The payload arrives with the chips derived, the health state named, the price rendered and
 * the referrers counted, so what is asserted here is narrow and worth stating: that none of it
 * is re-derived on the way to a cell, that the six health states each get a treatment and
 * `unknown` is never the healthy one, that the three price answers stay three, and that the
 * copy the mockup writes down is the mockup's.
 */

/** The mockup this table is drawn from, read once. */
const MOCKUP = readFileSync(
  join(import.meta.dirname, "..", "..", "..", "docs", "mockups", "21-model-registry.html"),
  "utf8",
);

/** The seeded table, decided. */
const ROWS = tableRows(seededRegistry());

/** One decided row, by alias. */
function row(alias: string) {
  const found = ROWS.find((candidate) => candidate.alias === alias);

  if (found === undefined) throw new Error(`no row for ${alias}`);
  return found;
}

describe("the rows", () => {
  it("keeps the server's order — by alias name — rather than sorting again", () => {
    expect(ROWS.map((candidate) => candidate.alias)).toEqual([
      "coder-fallback",
      "coder-max",
      "coder-std",
      "gpt5-experiments",
      "local-docs",
      "local-free",
      "second-opinion",
      "sizer",
    ]);
  });

  it("decides the mockup's `coder-max` row whole, and derives none of it", () => {
    const max = row("coder-max");

    expect(max.provider).toEqual({
      id: SEEDED_ANTHROPIC_ID,
      monogram: { letters: "AN", tint: "model" },
      name: "Anthropic Claude",
      mask: "••••Xq4A",
    });
    expect(max.modelId).toBe("claude-fable-5");
    expect(max.chips).toEqual(["max thinking", "400k budget"]);
    // The structured documents beside the chips — the inspector's prefill (#593), copied and
    // not composed: the row carries what the service stored, and the chips stay the server's.
    expect(max.params).toEqual({ thinking: "max", token_budget: 400_000 });
    expect(max.restrictions).toEqual({});
    expect(max.health).toMatchObject({ state: "ok", tone: "ok", dot: "filled", label: "ok", detail: null, fix: false });
    expect(max.price).toEqual({ display: "$10 · $50", provenance: `bundled@${CATALOG_VERSION}` });
    expect(max.usedBy).toBe("4 routes");
    expect(max.enabled).toBe(true);
    expect(max.dim).toBe(false);
  });

  it("decides the orphan row: no provider, dimmed, its switch off, and the fix in its health cell", () => {
    const orphan = row("gpt5-experiments");

    expect(orphan.provider).toBeNull();
    expect(orphan.dim).toBe(true);
    expect(orphan.enabled).toBe(false);
    expect(orphan.chips).toEqual([]);
    expect(orphan.health).toEqual({
      state: "no_key",
      tone: "err",
      dot: "filled",
      label: NO_KEY_NOTE,
      detail: null,
      fix: true,
    });
    expect(orphan.price).toEqual({ display: EM_DASH, provenance: null });
    expect(orphan.usedBy).toBe("0 routes");
  });

  it("dims exactly the unbound row", () => {
    expect(ROWS.filter((candidate) => candidate.dim).map((candidate) => candidate.alias)).toEqual([
      "gpt5-experiments",
    ]);
  });

  it("carries the referrers across for the switch to name", () => {
    expect(row("coder-std").references.map((reference) => reference.label)).toEqual([
      "plan-primary",
      "review-primary",
    ]);
  });

  it("prints the chips the server derived and never composes one", () => {
    // A params document that would derive a chip, served with none: the cell is the server's
    // answer, not this module's reading of `params`.
    const [decided] = tableRows([registryAlias({ params: { thinking: "max" }, chips: [] })]);

    expect(decided?.chips).toEqual([]);
  });
});

describe("the provider cell", () => {
  it("takes the letters from the server and the tint from AE.2's map", () => {
    // Two surfaces, one vocabulary: the payload computes `AN` so this page and mockup 07's
    // cards cannot pick different letters, and the cards' tint map is the only tint map.
    const cell = providerCell({
      id: "x",
      kind: "copilot",
      displayName: "GitHub Copilot",
      monogram: "GH",
      mask: null,
    });

    expect(cell).toEqual({
      id: "x",
      monogram: { letters: "GH", tint: "warn" },
      name: "GitHub Copilot",
      mask: null,
    });
  });

  it("gives a kind the mockup does not draw the neutral tint, with the server's letters", () => {
    const cell = providerCell({
      id: "x",
      kind: "bedrock",
      displayName: "AWS Bedrock",
      monogram: "AW",
      mask: null,
    });

    expect(cell.monogram).toEqual({ letters: "AW", tint: "neutral" });
  });
});

describe("the health cell", () => {
  it("maps every state the contract publishes, so a seventh is a build error here", () => {
    const states: readonly AliasHealthState[] = [
      "ok",
      "degraded",
      "model_missing",
      "unknown",
      "provider_disabled",
      "no_key",
    ];

    for (const state of states) expect(HEALTH_CELLS[state], state).toBeDefined();
  });

  it("never draws `unknown` as healthy — warn, and a ring rather than a disc (M8)", () => {
    const cell = healthCell({ state: "unknown", note: "nothing has checked Cursor yet", fix: null, checkedAt: null });

    expect(cell.tone).toBe("warn");
    expect(cell.dot).toBe("ring");
    expect(cell.label).toBe("unknown");
    expect(cell.detail).toBe("nothing has checked Cursor yet");
  });

  it("draws the mockup's `⚠ degraded` with the check's own note beside it", () => {
    const cell = healthCell({ state: "degraded", note: "elevated latency", fix: null, checkedAt: null });

    expect(cell).toMatchObject({ tone: "warn", dot: "filled", label: "degraded", detail: "elevated latency", fix: false });
  });

  it("warns for a model discovery no longer lists, naming which", () => {
    const cell = healthCell({
      state: "model_missing",
      note: "claude-fable-5 is no longer listed on Anthropic Claude",
      fix: null,
      checkedAt: null,
    });

    expect(cell.tone).toBe("warn");
    expect(cell.label).toBe("model missing");
    expect(cell.detail).toMatch(/no longer listed/);
  });

  it("errs for a connection switched off, and offers the fix", () => {
    const cell = healthCell({ state: "provider_disabled", note: "Cursor is paused", fix: "/models/providers", checkedAt: null });

    expect(cell).toMatchObject({ tone: "err", label: "provider off", detail: "Cursor is paused", fix: true });
  });

  it("prints the orphan's note as the whole label rather than the state word before it", () => {
    // *no key · no key — connect a provider* would say it twice.
    const cell = healthCell({ state: "no_key", note: NO_KEY_NOTE, fix: "/models/providers", checkedAt: null });

    expect(cell.label).toBe(NO_KEY_NOTE);
    expect(cell.detail).toBeNull();
    expect(cell.fix).toBe(true);
  });

  it("draws the fix button exactly where the server said there is somewhere to go", () => {
    expect(healthCell({ state: "ok", note: null, fix: null, checkedAt: null }).fix).toBe(false);
    expect(healthCell({ state: "degraded", note: "x", fix: null, checkedAt: null }).fix).toBe(false);
  });
});

describe("the price cell", () => {
  it("prints the server's display and never re-derives it", () => {
    expect(priceCell(tokenPrice("anthropic", "m", 1000, 5000, "$10 · $50")).display).toBe("$10 · $50");
    expect(priceCell(unpricedPrice("m")).display).toBe(EM_DASH);
  });

  it("names the bundled snapshot on hover", () => {
    expect(priceProvenance(tokenPrice("anthropic", "m", 1000, 5000, "$10 · $50"))).toBe(
      `bundled@${CATALOG_VERSION}`,
    );
  });

  it("names an override as the workspace's own", () => {
    const price = tokenPrice("anthropic", "m", 1000, 5000, "$10 · $50");
    const override = {
      ...price,
      price: {
        ...price.price!,
        provenance: { source: "override" as const, catalogVersion: null, effectiveAt: "2026-08-20T00:00:00.000Z" },
      },
    };

    expect(priceProvenance(override)).toBe(ORG_OVERRIDE);
  });

  it("has no provenance for a model the catalog does not cover — there is no number to audit", () => {
    expect(priceProvenance(unpricedPrice("m"))).toBeNull();
  });

  it("keeps `$0` and `—` apart: a free row is priced, an uncovered one is not", () => {
    const free = tableRows([registryAlias({ price: { ...tokenPrice("ollama", "m", 0, 0, "$0"), price: { ...tokenPrice("ollama", "m", 0, 0, "$0").price!, billingMode: "free" } } })]);
    const none = tableRows([registryAlias({ price: unpricedPrice("m", "ollama") })]);

    expect(free[0]?.price.display).toBe("$0");
    expect(free[0]?.price.provenance).not.toBeNull();
    expect(none[0]?.price.display).toBe(EM_DASH);
    expect(none[0]?.price.provenance).toBeNull();
  });
});

describe("the used-by cell", () => {
  it("counts in routes, singular at one", () => {
    expect(usedByCell(0)).toBe("0 routes");
    expect(usedByCell(1)).toBe("1 route");
    expect(usedByCell(4)).toBe("4 routes");
  });
});

describe("the selection", () => {
  it("accepts an alias the table has", () => {
    expect(selectedAlias(ROWS, "coder-max")).toBe("coder-max");
  });

  it("refuses one it does not, and nothing, and a repeated parameter", () => {
    expect(selectedAlias(ROWS, "nope")).toBeNull();
    expect(selectedAlias(ROWS, null)).toBeNull();
    expect(selectedAlias(ROWS, undefined)).toBeNull();
    expect(selectedAlias(ROWS, ["coder-max", "sizer"])).toBeNull();
  });

  it("announces the selection as a sentence", () => {
    expect(selectionAnnouncement("coder-max")).toBe("coder-max alias selected.");
  });
});

describe("the card frame's copy", () => {
  it("takes the title from the mockup", () => {
    expect(MOCKUP).toContain(TABLE_TITLE.toUpperCase());
  });

  it("counts aliases, singular at one", () => {
    expect(aliasCount(8)).toBe("8 aliases");
    expect(aliasCount(1)).toBe("1 alias");
    expect(aliasCount(0)).toBe("0 aliases");
  });

  it("takes the caption line from the mockup, verbatim", () => {
    expect(MOCKUP).toContain(`<p class="tbl-caption">${TABLE_NOTE}</p>`);
  });

  it("takes the two links' labels from the mockup", () => {
    expect(MOCKUP).toContain(`>${MANAGE_PROVIDERS}<`);
    expect(MOCKUP).toContain(`>${FIX_IN_PROVIDERS}<`);
  });

  it("re-exports the routing page's words for an absence rather than spelling new ones", () => {
    expect(MOCKUP).toContain(`<span class="faint">${NO_PROVIDER}</span>`);
    expect(MOCKUP).toContain(`<span class="faint">${EM_DASH}</span>`);
  });
});

describe("the inspector's seat", () => {
  it("titles itself for the selected alias, as the mockup's `EDIT — CODER-MAX`", () => {
    expect(inspectorTitle("coder-max")).toBe("Edit — coder-max");
    expect(MOCKUP).toContain(inspectorTitle("coder-max").toUpperCase());
  });

  it("drops the dash when there is nothing to name", () => {
    expect(inspectorTitle(null)).toBe(INSPECTOR_TITLE);
  });

  it("names no issue at all now that the card is filled", () => {
    // The placeholder that named #593–#596 is deleted rather than reworded: CI.3 filled this
    // card, and a note still telling a reader to wait for it would be telling them to wait for
    // what they are looking at. What is left says the one thing an unselected card owes.
    for (const issue of ["#592", "#593", "#594", "#595", "#596"]) {
      expect(INSPECTOR_EMPTY_NOTE, issue).not.toContain(issue);
    }
  });

  it("says how to select an alias, since that is the only thing missing", () => {
    expect(INSPECTOR_EMPTY_TITLE).toBe("No alias selected");
    expect(INSPECTOR_EMPTY_NOTE).toMatch(/allowed-models table/);
  });
});

describe("the switch", () => {
  it("is named for what it governs", () => {
    expect(switchLabel("coder-max")).toBe("Allow coder-max");
  });

  it("asks before switching off exactly when something references the alias", () => {
    expect(needsConfirmation(row("coder-max").references)).toBe(true);
    expect(needsConfirmation(row("gpt5-experiments").references)).toBe(false);
  });

  it("titles the confirmation for the alias and names the consequence in the count's words", () => {
    expect(switchOffTitle("coder-std")).toBe("Switch off coder-std?");
    expect(switchOffNote(3)).toMatch(/^3 routes reference this alias/);
    expect(switchOffNote(3)).toMatch(/dropped/);
    expect(switchOffNote(1)).toMatch(/^1 route reference/);
  });

  it("explains the unbound row's switch by pointing at the page that fixes it", () => {
    expect(SWITCH_UNBOUND).toMatch(/Providers & keys/);
  });

  it("labels the confirmation's two controls", () => {
    expect(SWITCH_OFF_CONFIRM).toBe("Switch off");
    expect(CANCEL_LABEL).toBe("Cancel");
  });
});
