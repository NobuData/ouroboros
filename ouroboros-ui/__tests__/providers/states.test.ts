import { describe, expect, it } from "vitest";

import {
  ALIASES_READ,
  CATALOG_READ,
  DEGRADED_HEADLINE,
  EMPTY_MEMBER_NOTE,
  EMPTY_NOTE,
  EMPTY_TITLE,
  GRID_FAILED_NOTE,
  GRID_FAILED_TITLE,
  HEALTH_READ,
  PROVIDERS_FAILED_HEADLINE,
  READ_ONLY_BODY,
  SPEND_READ,
  degradedReads,
  degradedReason,
  providersState,
  readOnlyNote,
} from "@/app/providers/states";

import { readings } from "../helpers/providers";

/**
 * The providers page's states (#232): which the listing puts it in, which grid-wide reads
 * degraded it, and what a read-only reader is told. The screen draws them;
 * `providers-screen.test.tsx` proves what reaches the DOM.
 */

describe("providersState", () => {
  it("is failed when the listing was refused, carrying the service's own sentence", () => {
    expect(providersState(readings({ connections: { ok: false, reason: "Down." } }))).toEqual({
      kind: "failed",
      reason: "Down.",
    });
  });

  it("is empty when the listing answered no connections — the personal workspace's seed", () => {
    expect(providersState(readings({ connections: { ok: true, value: [] } }))).toEqual({
      kind: "empty",
    });
  });

  it("is populated for one connection or five, whatever the other reads did", () => {
    expect(providersState(readings())).toEqual({ kind: "populated" });
    expect(
      providersState(readings({ spend: { ok: false, reason: "x" }, catalog: { ok: false, reason: "y" } })),
    ).toEqual({ kind: "populated" });
  });
});

describe("degradedReads", () => {
  it("names nothing when every grid-wide read answered", () => {
    expect(degradedReads(readings())).toEqual([]);
  });

  it("names each grid-wide read that failed, in the reader's order, with its reason", () => {
    expect(
      degradedReads(
        readings({
          catalog: { ok: false, reason: "registry away" },
          health: { ok: false, reason: "sweep away" },
          spend: { ok: false, reason: "ledger away" },
          aliases: { ok: false, reason: "aliases away" },
        }),
      ),
    ).toEqual([
      { what: CATALOG_READ, reason: "registry away" },
      { what: HEALTH_READ, reason: "sweep away" },
      { what: SPEND_READ, reason: "ledger away" },
      { what: ALIASES_READ, reason: "aliases away" },
    ]);
  });

  it("does not count a card's own models read — that region says its reason on the card", () => {
    expect(
      degradedReads(readings({ models: new Map([["x", { ok: false, reason: "no" }]]) })),
    ).toEqual([]);
  });

  it("does not count the listing — that is the failed state, not a degraded one", () => {
    expect(degradedReads(readings({ connections: { ok: false, reason: "away" } }))).toEqual([]);
  });
});

describe("degradedReason", () => {
  it("names each read with what the service said, as one line", () => {
    expect(
      degradedReason([
        { what: CATALOG_READ, reason: "registry away" },
        { what: SPEND_READ, reason: "ledger away" },
      ]),
    ).toBe(`${CATALOG_READ}: registry away · ${SPEND_READ}: ledger away`);
  });

  it("answers an empty string for nothing, rather than throwing in a banner", () => {
    expect(degradedReason([])).toBe("");
  });
});

describe("the copy", () => {
  it("keeps the failed read and the empty workspace distinct, in words", () => {
    expect(PROVIDERS_FAILED_HEADLINE).not.toBe(EMPTY_TITLE);
    expect(GRID_FAILED_TITLE).not.toBe(EMPTY_TITLE);
    expect(GRID_FAILED_NOTE).toMatch(/banner above/);
    expect(EMPTY_TITLE).toBe("Connect your first provider");
    expect(EMPTY_NOTE).toMatch(/first card/);
  });

  it("tells a member who can act, instead of drawing them an inert button", () => {
    expect(EMPTY_MEMBER_NOTE).toMatch(/owners and admins/);
  });

  it("headlines a degraded page as a part of every card, not as the page", () => {
    expect(DEGRADED_HEADLINE).toMatch(/every card/);
    expect(DEGRADED_HEADLINE).not.toBe(PROVIDERS_FAILED_HEADLINE);
  });
});

describe("readOnlyNote", () => {
  it("names the role, with the article it takes", () => {
    expect(readOnlyNote("member").head).toBe("Viewing providers as a member.");
    expect(readOnlyNote("viewer").head).toBe("Viewing providers as a viewer.");
    expect(readOnlyNote("owner").head).toBe("Viewing providers as an owner.");
    expect(readOnlyNote("admin").head).toBe("Viewing providers as an admin.");
  });

  it("says what read-only means on this page, the same for every role", () => {
    expect(readOnlyNote("member").body).toBe(READ_ONLY_BODY);
    expect(readOnlyNote("viewer").body).toBe(READ_ONLY_BODY);
    expect(READ_ONLY_BODY).toMatch(/switched off with its reason/);
  });
});
