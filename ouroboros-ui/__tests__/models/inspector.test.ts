import { describe, expect, it } from "vitest";

import { savedRoute } from "@/app/models/chain";
import {
  COST_MALFORMED,
  COST_TOO_PRECISE,
  COST_ZERO,
  HEALTH_NOT_ON_STRIP,
  HEALTH_NOT_READ,
  HEALTH_UNBOUND,
  HEALTH_UNREAD,
  floorSentence,
  formatMaxCost,
  hopHealth,
  hopHealthIndex,
  hopHealthLine,
  hopHealthTitle,
  hopMetaLine,
  hopRole,
  parseMaxCost,
} from "@/app/models/inspector";
import { NO_PROVIDER } from "@/app/models/matrix";
import { providerChip, providerDetail } from "@/app/models/view";

import { seededProviders, seededTaskKinds, unknownProvider } from "../helpers/models";

/**
 * The route inspector's decisions (#203), as functions over the dev seed's own strip and
 * routes.
 *
 * Every state the ticket has to get right is a function here: which dot a hop wears and
 * what its hover says, what the line under a hop reads when the operator wrote none, what the
 * floor switch's sentence is, and what `$2.5` means in cents. None of it needs a render, so
 * none of it is tested through one.
 */

/** The seeded strip, indexed. */
const STRIP = hopHealthIndex({ ok: true, value: seededProviders() });

/** The seeded `implement` route — the one the mockup opens in its inspector. */
function implement() {
  const route = savedRoute(seededTaskKinds()[3]);
  if (route === null) throw new Error("the seed routes implement");
  return route;
}

/** The seeded connections' ids, by the name the strip prints. */
const ANTHROPIC = "5eed000c-0000-4000-8000-000000000001";
const COPILOT = "5eed000c-0000-4000-8000-000000000003";
const OLLAMA = "5eed000c-0000-4000-8000-000000000005";

describe("the health index", () => {
  it("is the strip's own treatment, keyed by connection", () => {
    // One decision for the chip above the matrix and the dot beside the hop: `providerChip`
    // decides, and this only files the answer under the connection's id.
    const [anthropic] = seededProviders();
    const chip = providerChip(anthropic);

    expect(STRIP.ok && STRIP.byProvider[ANTHROPIC]).toEqual({
      tone: chip.tone,
      dot: chip.dot,
      state: chip.state,
      meta: chip.meta,
      detail: chip.detail,
    });
  });

  it("keeps a strip that could not be read as that fact, not as an empty index", () => {
    expect(hopHealthIndex({ ok: false, reason: "Down." })).toEqual({ ok: false, reason: "Down." });
  });
});

describe("a hop's health", () => {
  it("draws the seeded implement chain's three dots from the strip — healthy, error, healthy", () => {
    // The mockup's ok-dot, warn-dot, ok-dot — with the strip's correction on hop 2: the
    // seeded Copilot row holds `error`, and it is drawn as one.
    const tones = implement().hops.map((hop) => hopHealth(hop.providerId, STRIP).tone);

    expect(tones).toEqual(["ok", "err", "ok"]);
  });

  it("carries the strip's last-checked detail into the dot's title", () => {
    const [anthropic] = seededProviders();

    expect(hopHealthTitle(hopHealth(ANTHROPIC, STRIP))).toBe(`healthy · ${providerDetail(anthropic)}`);
    expect(hopHealthTitle(hopHealth(COPILOT, STRIP))).toMatch(/^error · Last checked .* · elevated latency$/);
  });

  it("draws unknown as a ring with the word, never as healthy", () => {
    // Decision M8, on the rail as on the strip.
    const index = hopHealthIndex({ ok: true, value: [unknownProvider()] });
    const health = hopHealth("5eed000c-0000-4000-8000-0000000000ff", index);

    expect(health.tone).toBe("unknown");
    expect(health.dot).toBe("ring");
    expect(health.state).toBe("unknown");
    expect(hopHealthTitle(health)).toMatch(/^unknown · Never checked/);
  });

  it("gives an unbound alias the ring and says there is nothing to check", () => {
    const health = hopHealth(null, STRIP);

    expect(health).toEqual({ tone: "unknown", dot: "ring", state: NO_PROVIDER, meta: null, detail: HEALTH_UNBOUND });
  });

  it("gives every hop the ring, with the read's reason, when the strip could not be read", () => {
    const health = hopHealth(ANTHROPIC, { ok: false, reason: "Down." });

    expect(health.tone).toBe("unknown");
    expect(health.dot).toBe("ring");
    expect(health.detail).toBe(`${HEALTH_NOT_READ} · Down.`);
  });

  it("gives a connection the strip does not list the ring, and says so", () => {
    const health = hopHealth("5eed000c-0000-4000-8000-00000000dead", STRIP);

    expect(health.dot).toBe("ring");
    expect(health.detail).toBe(HEALTH_NOT_ON_STRIP);
  });

  it("falls back on a not-read index rather than an empty one", () => {
    expect(HEALTH_UNREAD.ok).toBe(false);
    expect(hopHealth(ANTHROPIC, HEALTH_UNREAD).detail).toMatch(new RegExp(`^${HEALTH_NOT_READ}`));
  });
});

describe("the line under a hop", () => {
  it("names hops the way the server's sentences do", () => {
    expect([1, 2, 3].map(hopRole)).toEqual(["Primary", "Fallback 1", "Fallback 2"]);
  });

  it("composes the health line the way the strip's chip is composed — role, state, meta", () => {
    // The mockup's `Primary · API key valid, 42ms to us-east`, as the product can honestly
    // say it: the position, the strip's own word for the state, and the `meta` the service
    // composed — in the shape Z.1's kept-hop explanation takes.
    expect(hopHealthLine(1, hopHealth(ANTHROPIC, STRIP))).toBe("Primary · healthy · 42ms");
    expect(hopHealthLine(3, hopHealth(OLLAMA, STRIP))).toBe(
      "Fallback 2 · healthy · ken-station.local · 3 models · workstation",
    );
  });

  it("prints no meta where nothing was measured, and never a stand-in", () => {
    expect(hopHealthLine(1, hopHealth("5eed000c-0000-4000-8000-000000000002", STRIP))).toBe("Primary · healthy");
    expect(hopHealthLine(2, hopHealth(null, STRIP))).toBe(`Fallback 1 · ${NO_PROVIDER}`);
  });

  it("reproduces the mockup's three hop-meta lines for the seeded implement route", () => {
    // The ticket's first acceptance criterion. Hops 2 and 3 are the operator's notes, stored;
    // hop 1 is the health line, because the seed stores no note that would freeze a latency.
    const lines = implement().hops.map((hop, at) => hopMetaLine(hop, at + 1, hopHealth(hop.providerId, STRIP)));

    expect(lines).toEqual([
      "Primary · healthy · 42ms",
      "Fallback on 5xx / timeouts",
      "Offline mode — keeps the loop turning without a network",
    ]);
  });

  it("lets the operator's note outrank the health line", () => {
    const [, fallback] = implement().hops;

    expect(hopMetaLine(fallback, 2, hopHealth(fallback.providerId, STRIP))).toBe("Fallback on 5xx / timeouts");
  });
});

describe("the floor's sentence", () => {
  it("is the mockup's, with the floor as the number", () => {
    expect(floorSentence(2)).toBe("Fail run instead of degrading below fallback 2");
    expect(floorSentence(1)).toBe("Fail run instead of degrading below fallback 1");
  });
});

describe("the cost cap, parsed", () => {
  it("reads the mockup's $2.50 as 250 cents, however it is spelt", () => {
    for (const text of ["$2.50", "2.50", "2.5", " $2.5 ", "$ 2.50"]) {
      expect(parseMaxCost(text), text).toEqual({ ok: true, cents: 250 });
    }
  });

  it("reads whole dollars, thousands separators and bare cents", () => {
    expect(parseMaxCost("3")).toEqual({ ok: true, cents: 300 });
    expect(parseMaxCost("3.")).toEqual({ ok: true, cents: 300 });
    expect(parseMaxCost("$1,250.00")).toEqual({ ok: true, cents: 125_000 });
    expect(parseMaxCost(".99")).toEqual({ ok: true, cents: 99 });
    expect(parseMaxCost("0.01")).toEqual({ ok: true, cents: 1 });
  });

  it("does the arithmetic in whole cents, so no amount is a float's rounding away", () => {
    // `1.15 * 100` is 114.99999999999999 in binary; the cap must be 115.
    expect(parseMaxCost("1.15")).toEqual({ ok: true, cents: 115 });
    expect(parseMaxCost("19.99")).toEqual({ ok: true, cents: 1999 });
  });

  it("reads an empty field as no cap", () => {
    expect(parseMaxCost("")).toEqual({ ok: true, cents: null });
    expect(parseMaxCost("   ")).toEqual({ ok: true, cents: null });
  });

  it("refuses what is not an amount, inline", () => {
    for (const text of ["abc", "$", "2.5.0", "-1", "2,50", "1,00.00", "$2 50", "€2.50"]) {
      expect(parseMaxCost(text), text).toEqual({ ok: false, reason: COST_MALFORMED });
    }
  });

  it("refuses a fraction of a cent rather than rounding it", () => {
    expect(parseMaxCost("2.505")).toEqual({ ok: false, reason: COST_TOO_PRECISE });
  });

  it("refuses zero, which the contract calls a route that can never run", () => {
    expect(parseMaxCost("0")).toEqual({ ok: false, reason: COST_ZERO });
    expect(parseMaxCost("$0.00")).toEqual({ ok: false, reason: COST_ZERO });
  });

  it("refuses an amount too large to be a safe integer of cents", () => {
    expect(parseMaxCost("99999999999999999")).toEqual({ ok: false, reason: COST_MALFORMED });
  });
});

describe("the cost cap, printed", () => {
  it("prints the cap the way the matrix prints money, and an empty field for no cap", () => {
    expect(formatMaxCost(250)).toBe("$2.50");
    expect(formatMaxCost(125_000)).toBe("$1,250.00");
    expect(formatMaxCost(null)).toBe("");
  });

  it("round-trips through the parser", () => {
    for (const cents of [1, 99, 250, 125_000, null]) {
      expect(parseMaxCost(formatMaxCost(cents))).toEqual({ ok: true, cents });
    }
  });
});
