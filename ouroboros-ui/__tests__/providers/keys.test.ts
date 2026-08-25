import { describe, expect, it } from "vitest";

import { ApiError } from "@/app/api/errors";
import {
  ADDRESS_INVALID,
  ADDRESS_KEPT,
  NO_KEY_STORED,
  OLD_KEY_ACTIVE,
  PROVIDER_GONE,
  REVEAL_ABSENT,
  REVEAL_READ_ONLY,
  STEP_UP_DEFAULT_WINDOW_SECONDS,
  addressRefusal,
  expiryOf,
  masksIn,
  needsConfirmation,
  providerRefused,
  remainingSeconds,
  removeRefusal,
  revealRateLimited,
  revealRefusal,
  rotateRefusal,
  secretKept,
  secretSubmit,
  secretSwapped,
  secretTitle,
  stepUpMethods,
  stepUpNote,
  stringList,
  wholeNumber,
} from "@/app/providers/keys";

/**
 * The key-management copy and decisions (#229), as values.
 *
 * The dialogs render; this decides what they say — which sentence a refusal becomes, what a
 * countdown reads, whether a switch-off asks first. Each is a pure function over a small
 * input, so the security-critical ones — *a failed rotation says the old key is still live*,
 * *a step-up challenge is read as a challenge* — are held here rather than asserted through a
 * rendered dialog.
 */

describe("reading a detail", () => {
  it("keeps only the strings in a list, and treats a non-list as none", () => {
    expect(stringList(["a", 1, "b", null])).toEqual(["a", "b"]);
    expect(stringList("nope")).toEqual([]);
    expect(stringList(undefined)).toEqual([]);
  });

  it("takes a whole non-negative number or the fallback", () => {
    expect(wholeNumber(240, 0)).toBe(240);
    expect(wholeNumber(-1, 7)).toBe(7);
    expect(wholeNumber(1.5, 7)).toBe(7);
    expect(wholeNumber("x", 7)).toBe(7);
  });

  it("filters step-up methods to the ones this page can offer, in the service's order", () => {
    expect(stepUpMethods(["password", "session"])).toEqual(["session", "password"]);
    expect(stepUpMethods(["session", "webauthn"])).toEqual(["session"]);
    expect(stepUpMethods("nonsense")).toEqual([]);
  });
});

describe("the reveal", () => {
  it("counts a countdown down in whole seconds", () => {
    expect(remainingSeconds(100, 59)).toBe(41);
    expect(remainingSeconds(100, 100)).toBe(0);
    expect(remainingSeconds(100, 120)).toBe(0);
  });

  it("reads the expiry off the wire, and forgets an unparseable one at once", () => {
    expect(expiryOf("2026-08-23T10:00:41.000Z")).toBe(Math.floor(Date.parse("2026-08-23T10:00:41.000Z") / 1000));
    expect(expiryOf("not a date")).toBe(0);
  });

  it("spells the countdown as the row draws it", () => {
    expect(masksIn(41)).toBe("Masks in 41s");
  });

  it("turns the 401 into a step-up challenge carrying methods and window", () => {
    const outcome = revealRefusal(
      new ApiError(401, "step_up_required", "confirm", { methods: ["session", "password"], maxAgeSeconds: 300 }),
    );

    expect(outcome).toEqual({ ok: false, kind: "step-up", methods: ["session", "password"], maxAgeSeconds: 300 });
  });

  it("defaults the window when the challenge omitted it", () => {
    const outcome = revealRefusal(new ApiError(401, "step_up_required", "confirm", { methods: [] }));

    expect(outcome).toMatchObject({ kind: "step-up", maxAgeSeconds: STEP_UP_DEFAULT_WINDOW_SECONDS });
  });

  it("names the other refusals for a reader", () => {
    expect(revealRefusal(new ApiError(429, "provider_reveal_rate_limited", "x", { retryAfterSeconds: 240 }))).toEqual({
      ok: false,
      kind: "refused",
      reason: revealRateLimited(240),
    });
    expect(revealRefusal(new ApiError(409, "provider_credential_absent", "x")).ok).toBe(false);
    expect(revealRefusal(new ApiError(409, "provider_credential_absent", "x"))).toMatchObject({ reason: REVEAL_ABSENT });
    expect(revealRefusal(new ApiError(403, "forbidden", "x"))).toMatchObject({ reason: REVEAL_READ_ONLY });
    expect(revealRefusal(new ApiError(404, "provider_connection_not_found", "x"))).toMatchObject({ reason: PROVIDER_GONE });
  });
});

describe("the rotation", () => {
  it("titles and labels itself by whether it is a rotate or a first save", () => {
    expect(secretTitle("rotate", "Anthropic Claude")).toBe("Rotate Anthropic Claude's key");
    expect(secretTitle("save", "Local vLLM")).toBe("Save a key for Local vLLM");
    expect(secretSubmit("rotate")).toBe("Check and swap");
    expect(secretSubmit("save")).toBe("Check and save");
  });

  it("states the new masked suffix on success", () => {
    expect(secretSwapped("rotate", "••••7Kd2")).toBe("Swapped. The key now ends in ••••7Kd2.");
    expect(secretSwapped("save", null)).toBe("Saved.");
  });

  it("says the old key is still active on a rotate failure, and no key stored on a save failure", () => {
    // The sentence this ticket exists for.
    expect(secretKept("rotate")).toBe(OLD_KEY_ACTIVE);
    expect(OLD_KEY_ACTIVE).toMatch(/still active/);
    expect(secretKept("save")).toBe(NO_KEY_STORED);
  });

  it("carries the provider's own note into the reason when it gave one", () => {
    expect(rotateRefusal(new ApiError(422, "provider_validation_failed", "x", { detail: "key rejected (401)" }))).toEqual({
      ok: false,
      reason: providerRefused("key rejected (401)"),
    });
    expect(providerRefused(null)).toBe("The provider refused the new key.");
  });
});

describe("the address", () => {
  it("keys a schema refusal to the field, and falls back when it named none", () => {
    expect(
      addressRefusal(
        new ApiError(422, "provider_config_invalid", "x", { fields: { baseUrl: ["not usable"] } }),
        "baseUrl",
      ),
    ).toEqual({ ok: false, reason: "not usable" });

    expect(addressRefusal(new ApiError(422, "provider_config_invalid", "x", { fields: {} }), "baseUrl")).toEqual({
      ok: false,
      reason: ADDRESS_INVALID,
    });
  });

  it("has a standing line saying the working address is unchanged", () => {
    expect(ADDRESS_KEPT).toMatch(/unchanged/);
  });
});

describe("the delete", () => {
  it("returns the in-use aliases as the service named them", () => {
    expect(removeRefusal(new ApiError(409, "provider_connection_in_use", "x", { aliases: ["b", "a"] }))).toEqual({
      ok: false,
      kind: "in-use",
      aliases: ["b", "a"],
    });
  });

  it("returns a plain refusal otherwise, gone for a 404", () => {
    expect(removeRefusal(new ApiError(404, "provider_connection_not_found", "x"))).toEqual({
      ok: false,
      kind: "refused",
      reason: PROVIDER_GONE,
    });
  });
});

describe("the switch-off confirmation", () => {
  it("asks when routes depend on the connection", () => {
    expect(needsConfirmation({ ok: true, value: ["coder-max"] })).toBe(true);
  });

  it("does not ask when nothing depends on it", () => {
    expect(needsConfirmation({ ok: true, value: [] })).toBe(false);
  });

  it("asks when the dependents could not even be read — a failed read is not no routes", () => {
    expect(needsConfirmation({ ok: false, reason: "away" })).toBe(true);
  });
});

describe("the step-up note", () => {
  it("says the window in minutes, pluralised", () => {
    expect(stepUpNote("Anthropic Claude", 300)).toBe(
      "Revealing Anthropic Claude's key needs a sign-in from the last 5 minutes.",
    );
    expect(stepUpNote("X", 60)).toMatch(/last 1 minute\./);
  });
});
