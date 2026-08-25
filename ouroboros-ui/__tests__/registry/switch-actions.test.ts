import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { SWITCH_FAILED, SWITCH_GONE, SWITCH_READ_ONLY, SWITCH_UNBOUND } from "@/app/registry/table";

import { modelAlias } from "../helpers/providers";
import { registryAlias } from "../helpers/registry";

/**
 * The table's one server hop (#592): the switch's `PATCH` through #584.
 *
 * A Server Action is a POST endpoint anybody can reach, so the security case comes first:
 * the action takes an alias id and a position and **nothing else** — no workspace, no person
 * — so there is nothing to forge. The rest is the posture: a refusal is a value the switch
 * draws rather than a rejection that would replace the page, and the gate's redirect is the
 * one throw that must travel.
 */

const update = vi.fn();

vi.mock("@/app/api/registry", () => ({
  registry: { update: (id: string, change: unknown) => update(id, change) },
}));

const { setAliasEnabled } = await import("@/app/registry/switch-actions");

/** The seed's `coder-max`. */
const ID = registryAlias().id;

/** What a write answers with, for a position and a set of dropped hops. */
function change(enabled: boolean, droppedHops: readonly string[] = []) {
  return {
    alias: modelAlias({ enabled }),
    revisionId: "a1000000-0000-4000-8000-000000000009",
    warnings: [],
    nextResolution: null,
    droppedHops: droppedHops.map((label, index) => ({
      kind: "route",
      refId: `5eed0012-0000-4000-8000-${String(index).padStart(12, "0")}`,
      label,
      blocking: true,
    })),
  };
}

beforeEach(() => {
  update.mockReset().mockResolvedValue(change(false));
});

describe("switching an alias", () => {
  it("PATCHes only the position asked for, for the one alias", async () => {
    await setAliasEnabled(ID, false);

    expect(update).toHaveBeenCalledWith(ID, { enabled: false });
  });

  it("hands back the position the service now holds — which is what the switch draws", async () => {
    await expect(setAliasEnabled(ID, false)).resolves.toEqual({ ok: true, enabled: false, droppedHops: [] });

    update.mockResolvedValue(change(true));

    await expect(setAliasEnabled(ID, true)).resolves.toEqual({ ok: true, enabled: true, droppedHops: [] });
  });

  it("hands back the hops a switch-off dropped, by their chips", async () => {
    update.mockResolvedValue(change(false, ["plan-primary", "review-primary"]));

    await expect(setAliasEnabled(ID, false)).resolves.toEqual({
      ok: true,
      enabled: false,
      droppedHops: ["plan-primary", "review-primary"],
    });
  });

  it("turns the service's 403 into the read-only sentence, and writes nothing", async () => {
    // The gate that decides is the service's; a member who reaches this anyway meets it here.
    update.mockRejectedValue(new ApiError(403, "forbidden", "no"));

    await expect(setAliasEnabled(ID, false)).resolves.toEqual({ ok: false, reason: SWITCH_READ_ONLY });
  });

  it("says the alias is gone for a 404", async () => {
    update.mockRejectedValue(new ApiError(404, "model_alias_not_found", "no such alias"));

    await expect(setAliasEnabled(ID, false)).resolves.toEqual({ ok: false, reason: SWITCH_GONE });
  });

  it("says why a switch-on was refused for an alias with no binding", async () => {
    // The binding gate is the service's too: a stale render can still ask.
    update.mockRejectedValue(new ApiError(422, "model_alias_unbound", "no connection"));

    await expect(setAliasEnabled(ID, true)).resolves.toEqual({ ok: false, reason: SWITCH_UNBOUND });
  });

  it("says the switch could not be saved for any other refusal", async () => {
    update.mockRejectedValue(new ApiError(503, "upstream_unavailable", "later"));

    await expect(setAliasEnabled(ID, false)).resolves.toEqual({ ok: false, reason: SWITCH_FAILED });
  });

  it("lets anything that is not an ApiError keep travelling", async () => {
    // Next.js's redirect signal above all: a session that expired since the page rendered.
    update.mockRejectedValue(new Error("NEXT_REDIRECT /login"));

    await expect(setAliasEnabled(ID, false)).rejects.toThrow("NEXT_REDIRECT /login");
  });
});
