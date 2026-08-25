import { describe, expect, it } from "vitest";

import {
  CAP_FAILED,
  CAP_INVALID,
  CAP_MAX_CENTS,
  CAP_READ_ONLY,
  CAP_TOO_LARGE,
  CAP_WARNING_ONLY,
  NO_CAP,
  capRefusal,
  capText,
  parseCap,
} from "@/app/providers/caps";
import { PROVIDER_GONE } from "@/app/providers/keys";

/**
 * The cap field's decisions (#232): what a typed value means in cents, and what a refusal
 * reads as.
 *
 * The criterion this suite is organised around is the contract's own: *an empty cap stores
 * null, distinct from a cap of zero.* Everything else is the parser being generous about
 * spelling and strict about meaning, and the ceiling the service would refuse past.
 */

describe("parseCap", () => {
  it("reads a dollar figure in every spelling a person types", () => {
    expect(parseCap("$95")).toEqual({ ok: true, cents: 9_500 });
    expect(parseCap("95")).toEqual({ ok: true, cents: 9_500 });
    expect(parseCap("$1,250.50")).toEqual({ ok: true, cents: 125_050 });
    expect(parseCap("1250.5")).toEqual({ ok: true, cents: 125_050 });
    expect(parseCap(" 600 ")).toEqual({ ok: true, cents: 60_000 });
    expect(parseCap("$ 0.05")).toEqual({ ok: true, cents: 5 });
  });

  it("stores an empty field and the em-dash as null — no cap, which is not zero", () => {
    expect(parseCap("")).toEqual({ ok: true, cents: null });
    expect(parseCap("   ")).toEqual({ ok: true, cents: null });
    expect(parseCap(NO_CAP)).toEqual({ ok: true, cents: null });
    expect(parseCap("-")).toEqual({ ok: true, cents: null });
  });

  it("stores $0 as zero — a real cap meaning *spend nothing*", () => {
    expect(parseCap("$0")).toEqual({ ok: true, cents: 0 });
    expect(parseCap("0.00")).toEqual({ ok: true, cents: 0 });
  });

  it("keeps cents exact, in integers rather than through a float", () => {
    // `1250.5 * 100` is not `125050` on every runtime; `19.99 * 100` is `1998.9999…`.
    expect(parseCap("19.99")).toEqual({ ok: true, cents: 1_999 });
    expect(parseCap("0.1")).toEqual({ ok: true, cents: 10 });
    expect(parseCap("4.7")).toEqual({ ok: true, cents: 470 });
  });

  it("refuses a word, a negative amount and a third decimal, with the sentence", () => {
    for (const text of ["abc", "-5", "$-5", "1.005", "1,2,3.4.5", "95 dollars", "$"]) {
      expect(parseCap(text), text).toEqual({ ok: false, reason: CAP_INVALID });
    }
  });

  it("refuses a cap past the service's ceiling, naming it, and accepts the ceiling itself", () => {
    expect(parseCap("21474836.47")).toEqual({ ok: true, cents: CAP_MAX_CENTS });
    expect(parseCap("21474836.48")).toEqual({ ok: false, reason: CAP_TOO_LARGE });
    expect(parseCap("99999999999999999999")).toEqual({ ok: false, reason: CAP_TOO_LARGE });
    expect(CAP_TOO_LARGE).toContain("$21,474,836.47");
  });
});

describe("capText", () => {
  it("is empty for no cap, so the em-dash can be a placeholder rather than a glyph to delete", () => {
    expect(capText(null)).toBe("");
  });

  it("prints a cap the way the meter's note and the read-only field print it", () => {
    expect(capText(60_000)).toBe("$600");
    expect(capText(125_050)).toBe("$1,250.50");
    expect(capText(0)).toBe("$0");
  });
});

describe("capRefusal", () => {
  it("turns a 403 into the read-only sentence and a 404 into the gone one", () => {
    expect(capRefusal({ code: "forbidden" })).toEqual({ ok: false, reason: CAP_READ_ONLY });
    expect(capRefusal({ code: "provider_connection_not_found" })).toEqual({
      ok: false,
      reason: PROVIDER_GONE,
    });
  });

  it("says the cap could not be saved for anything else", () => {
    expect(capRefusal({ code: "internal_error" })).toEqual({ ok: false, reason: CAP_FAILED });
    expect(capRefusal({ code: "validation_failed" })).toEqual({ ok: false, reason: CAP_FAILED });
  });
});

describe("the copy — decision P7", () => {
  it("is the ticket's sentence, word for word, and names what removes it", () => {
    // AF.4 (#237) deletes the constant; until then the sentence is the difference between a
    // feature that warns and a feature that pretends to enforce.
    expect(CAP_WARNING_ONLY).toBe("Warning only — enforcement arrives with invocation.");
  });

  it("explains the read-only field the way every other control on the card does", () => {
    expect(CAP_READ_ONLY).toMatch(/owners and admins/);
  });
});
