import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { SWITCH_FAILED, SWITCH_GONE, SWITCH_READ_ONLY } from "@/app/providers/cards";

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

const { setProviderEnabled } = await import("@/app/providers/card-actions");

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
