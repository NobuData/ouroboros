import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { CAP_FAILED, CAP_READ_ONLY } from "@/app/providers/caps";
import { SWITCH_FAILED, SWITCH_GONE, SWITCH_READ_ONLY } from "@/app/providers/cards";
import { PROVIDER_GONE } from "@/app/providers/keys";

import { connection } from "../helpers/providers";

/**
 * The card's one server hop (#228): the switch's `PATCH`.
 *
 * A Server Action is a POST endpoint anybody can reach, so the security case comes first:
 * the action takes a connection id and a position and **nothing else** — no workspace, no
 * person — so there is nothing to forge. The rest is the posture: a refusal is a value the
 * switch draws rather than a rejection that would replace the page, and the gate's redirect
 * is the one throw that must travel.
 */

const update = vi.fn();

vi.mock("@/app/api/providers", () => ({
  providers: { update: (id: string, patch: unknown) => update(id, patch) },
}));

const { setProviderCap, setProviderEnabled } = await import("@/app/providers/card-actions");

/** The seed's Anthropic card. */
const ID = "5eed000c-0000-4000-8000-000000000001";

beforeEach(() => {
  update.mockReset().mockResolvedValue(connection({ enabled: false }));
});

describe("switching a provider", () => {
  it("PATCHes only the position asked for, for the one connection", async () => {
    await setProviderEnabled(ID, false);

    expect(update).toHaveBeenCalledWith(ID, { enabled: false });
  });

  it("hands back the position the service now holds — which is what the switch draws", async () => {
    await expect(setProviderEnabled(ID, false)).resolves.toEqual({ ok: true, enabled: false });

    update.mockResolvedValue(connection({ enabled: true }));

    await expect(setProviderEnabled(ID, true)).resolves.toEqual({ ok: true, enabled: true });
  });

  it("turns the service's 403 into the read-only sentence, and writes nothing", async () => {
    // The gate that decides is the service's; a member who reaches this anyway meets it here.
    update.mockRejectedValue(new ApiError(403, "forbidden", "no"));

    await expect(setProviderEnabled(ID, false)).resolves.toEqual({
      ok: false,
      reason: SWITCH_READ_ONLY,
    });
  });

  it("says the provider is gone for a 404", async () => {
    update.mockRejectedValue(
      new ApiError(404, "provider_connection_not_found", "no"),
    );

    await expect(setProviderEnabled(ID, false)).resolves.toEqual({ ok: false, reason: SWITCH_GONE });
  });

  it("says the switch could not be saved for anything else the service refused", async () => {
    update.mockRejectedValue(new ApiError(500, "internal_error", "x"));

    await expect(setProviderEnabled(ID, false)).resolves.toEqual({ ok: false, reason: SWITCH_FAILED });
  });

  it("lets anything that is not the service's refusal travel — the redirect above all", async () => {
    update.mockRejectedValue(new Error("NEXT_REDIRECT /login"));

    await expect(setProviderEnabled(ID, false)).rejects.toThrow("NEXT_REDIRECT /login");
  });
});

describe("setting a cap (#232)", () => {
  it("PATCHes only the cap asked for, for the one connection", async () => {
    update.mockResolvedValue(connection({ monthlyCapCents: 12_000 }));

    await setProviderCap(ID, 12_000);

    expect(update).toHaveBeenCalledWith(ID, { monthlyCapCents: 12_000 });
  });

  it("sends null to clear the cap — no cap, which the contract keeps distinct from zero", async () => {
    update.mockResolvedValue(connection({ monthlyCapCents: null }));

    await expect(setProviderCap(ID, null)).resolves.toEqual({ ok: true, cents: null });
    expect(update).toHaveBeenCalledWith(ID, { monthlyCapCents: null });

    update.mockResolvedValue(connection({ monthlyCapCents: 0 }));

    await expect(setProviderCap(ID, 0)).resolves.toEqual({ ok: true, cents: 0 });
    expect(update).toHaveBeenCalledWith(ID, { monthlyCapCents: 0 });
  });

  it("hands back the cap the service now holds — which is what the meter draws", async () => {
    update.mockResolvedValue(connection({ monthlyCapCents: 9_500 }));

    await expect(setProviderCap(ID, 9_500)).resolves.toEqual({ ok: true, cents: 9_500 });
  });

  it("turns the service's 403 into the read-only sentence, and its 404 into the gone one", async () => {
    update.mockRejectedValue(new ApiError(403, "forbidden", "no"));
    await expect(setProviderCap(ID, 1)).resolves.toEqual({ ok: false, reason: CAP_READ_ONLY });

    update.mockRejectedValue(new ApiError(404, "provider_connection_not_found", "no"));
    await expect(setProviderCap(ID, 1)).resolves.toEqual({ ok: false, reason: PROVIDER_GONE });
  });

  it("says the cap could not be saved for anything else the service refused", async () => {
    update.mockRejectedValue(new ApiError(500, "internal_error", "x"));

    await expect(setProviderCap(ID, 1)).resolves.toEqual({ ok: false, reason: CAP_FAILED });
  });

  it("lets anything that is not the service's refusal travel — the redirect above all", async () => {
    update.mockRejectedValue(new Error("NEXT_REDIRECT /login"));

    await expect(setProviderCap(ID, 1)).rejects.toThrow("NEXT_REDIRECT /login");
  });
});
