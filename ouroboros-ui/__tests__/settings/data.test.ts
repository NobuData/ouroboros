import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import type { DryRunPolicy } from "@/app/api/policies";


/**
 * What the settings hub reads (BS.1,
 * [#491](https://github.com/NobuData/ouroboros/issues/491)): the dry-run policy, kept as a
 * reading so that a refusal costs the Policies section its row and nothing else its place.
 */

vi.mock("server-only", () => ({}));

const read = vi.fn();

vi.mock("@/app/api/policies", () => ({ dryRunPolicy: { read: () => read() } }));

const { readSettings } = await import("@/app/settings/data");

/** The gate's answer. The reader takes it only so it cannot be called before the gate. */
const ACCESS = {} as Parameters<typeof readSettings>[0];

const POLICY: DryRunPolicy = {
  dryRun: true,
  explicit: true,
  reason: "dry-run policy active",
  updatedAt: "2026-09-30T12:00:00.000Z",
  updatedBy: null,
};

beforeEach(() => {
  read.mockReset();
});

describe("the hub's reader", () => {
  it("reads the dry-run policy through the one read every surface uses", async () => {
    read.mockResolvedValue(POLICY);

    expect(await readSettings(ACCESS)).toEqual({ dryRun: { ok: true, value: POLICY } });
    expect(read).toHaveBeenCalledOnce();
  });

  it("keeps a refusal as a reason to render, never a blank page", async () => {
    read.mockRejectedValue(new ApiError(503, "unavailable", "The service is restarting."));

    expect(await readSettings(ACCESS)).toEqual({
      dryRun: { ok: false, reason: "The service is restarting." },
    });
  });

  it("lets anything that is not the service's answer keep travelling — a redirect to sign in above all", async () => {
    read.mockRejectedValue(new Error("NEXT_REDIRECT:/login"));

    await expect(readSettings(ACCESS)).rejects.toThrow("NEXT_REDIRECT:/login");
  });
});
