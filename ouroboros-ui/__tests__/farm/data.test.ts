import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";

import { FARM_READ_AT, seededFarm } from "../helpers/farm";
import { membership, sessionUser } from "../helpers/login";

vi.mock("server-only", () => ({}));

/** What the page read answers, per case. */
const page = vi.fn();

vi.mock("@/app/api/farm", () => ({ farm: { page: () => page() } }));

const { readFarm } = await import("@/app/farm/data");

/** The farm page's first-paint reader (#256): a refusal is a degraded page, not a thrown one. */

/** The gate's answer. */
const ACCESS = {
  session: { user: sessionUser(), memberships: [membership()], tenantSuggestion: null },
  membership: membership(),
} as unknown as Parameters<typeof readFarm>[0];

beforeEach(() => {
  page.mockReset().mockResolvedValue(seededFarm());
});

describe("readFarm", () => {
  it("reads the page once, and stamps when", async () => {
    const readings = await readFarm(ACCESS, () => FARM_READ_AT);

    expect(page).toHaveBeenCalledTimes(1);
    expect(readings).toEqual({ page: { ok: true, value: seededFarm() }, readAt: FARM_READ_AT });
  });

  it("keeps a refusal as the service's sentence rather than throwing", async () => {
    page.mockRejectedValue(new ApiError(400, "organization_required", "Choose a workspace."));

    const readings = await readFarm(ACCESS, () => FARM_READ_AT);

    expect(readings.page).toEqual({ ok: false, reason: "Choose a workspace." });
  });

  it("lets through what is not a refusal — Next.js's redirect signal above all", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    page.mockRejectedValue(redirect);

    await expect(readFarm(ACCESS)).rejects.toBe(redirect);
  });
});
