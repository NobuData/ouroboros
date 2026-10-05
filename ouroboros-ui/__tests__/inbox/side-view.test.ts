import { describe, expect, it } from "vitest";

import {
  CONNECTED_MARK,
  DIGEST_TIME_UNCHANGED,
  NOT_CONNECTED,
  NOT_YET,
  carriesDigest,
  channelStanding,
  digestSummary,
  digestTimeBlock,
} from "@/app/inbox/side-view";

import { digestOn, preferences, seededChannels } from "../helpers/inbox";

/**
 * The side column's pure rules (BO.4, #469): a ✓ for exactly one state, the digest's controls on
 * exactly one row, and what the email row says about the digest.
 */

describe("how a channel stands", () => {
  it("gives the ✓ to a connected channel, and nothing to explain", () => {
    expect(channelStanding({ state: "connected", reason: null })).toEqual({
      connected: true,
      mark: CONNECTED_MARK,
      reason: null,
    });
    expect(CONNECTED_MARK).toContain("✓");
  });

  it("says an available channel is not connected, with the service's reason", () => {
    expect(
      channelStanding({ state: "available", reason: "This deployment has no mail server: set OURO_SMTP_URL." }),
    ).toEqual({
      connected: false,
      mark: NOT_CONNECTED,
      reason: "This deployment has no mail server: set OURO_SMTP_URL.",
    });
  });

  it("says a channel that does not exist yet is not yet, with what it arrives with", () => {
    expect(channelStanding({ state: "unavailable-until", reason: "Arrives with Chat Ops." })).toEqual({
      connected: false,
      mark: NOT_YET,
      reason: "Arrives with Chat Ops.",
    });
  });

  it("never draws a ✓ for a state it has not heard of", () => {
    const standing = channelStanding({ state: "degraded" as never, reason: null });

    expect(standing.connected).toBe(false);
    expect(standing.mark).not.toContain("✓");
  });

  it("draws the seeded payload as two ✓ and two that are not", () => {
    expect(seededChannels().channels.map((channel) => [channel.id, channelStanding(channel).connected])).toEqual([
      ["slack", false],
      ["email", true],
      ["push", false],
      ["github", true],
    ]);
  });
});

describe("which row carries the digest", () => {
  it("is the email row, while email is connected", () => {
    expect(carriesDigest({ id: "email", state: "connected" })).toBe(true);
  });

  it("is no row while email cannot deliver — a switch there would do nothing", () => {
    expect(carriesDigest({ id: "email", state: "available" })).toBe(false);
    expect(carriesDigest({ id: "email", state: "unavailable-until" })).toBe(false);
  });

  it.each(["slack", "push", "github"] as const)("is never the %s row, connected or not", (id) => {
    expect(carriesDigest({ id, state: "connected" })).toBe(false);
  });
});

describe("the digest in a few words", () => {
  it("is the mockup's daily · 09:00, with the clock it is on", () => {
    expect(digestSummary(digestOn("09:00"))).toBe("daily · 09:00 UTC");
    expect(digestSummary(digestOn("17:45"))).toBe("daily · 17:45 UTC");
  });

  it("is off when it is off — whatever time is stored", () => {
    expect(digestSummary(preferences())).toBe("off");
  });
});

describe("why a typed time cannot be saved", () => {
  it.each(["9:00", "24:00", "09:60", "", "nine", "09:00:00"])("refuses %j as not a time of day", (typed) => {
    expect(digestTimeBlock(typed, "09:00")).toBe("Use a time like 09:00 (UTC).");
  });

  it("refuses the time already saved — there is nothing to change", () => {
    expect(digestTimeBlock("09:00", "09:00")).toBe(DIGEST_TIME_UNCHANGED);
  });

  it("lets a different, real time through", () => {
    expect(digestTimeBlock("10:30", "09:00")).toBeUndefined();
    expect(digestTimeBlock("00:00", "09:00")).toBeUndefined();
    expect(digestTimeBlock("23:59", "09:00")).toBeUndefined();
  });
});
