import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";

import { INSIGHTS_READ_AT, seededInsights } from "../helpers/insights";
import { membership, sessionUser } from "../helpers/login";

vi.mock("server-only", () => ({}));

/** What the page read answers, per case. */
const page = vi.fn();

vi.mock("@/app/api/insights", () => ({ insights: { page: (range: string) => page(range) } }));

const { readInsights } = await import("@/app/insights/data");

/** The insights page's first-paint reader (#443): one read for the address's range. */

const ACCESS = {
  session: { user: sessionUser(), memberships: [membership()], tenantSuggestion: null },
  membership: membership(),
} as unknown as Parameters<typeof readInsights>[0];

beforeEach(() => {
  page.mockReset().mockResolvedValue(seededInsights());
});

describe("readInsights", () => {
  it("reads the page once for the range, and stamps when", async () => {
    const readings = await readInsights(ACCESS, "90d", () => INSIGHTS_READ_AT);

    expect(page).toHaveBeenCalledExactlyOnceWith("90d");
    expect(readings).toEqual({ range: "90d", page: { ok: true, value: seededInsights() }, readAt: INSIGHTS_READ_AT });
  });

  it("keeps a refusal as the service's sentence rather than throwing", async () => {
    page.mockRejectedValue(new ApiError(400, "organization_required", "Choose a workspace."));

    expect((await readInsights(ACCESS, "30d")).page).toEqual({ ok: false, reason: "Choose a workspace." });
  });

  it("lets through what is not a refusal — Next.js's redirect signal above all", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    page.mockRejectedValue(redirect);

    await expect(readInsights(ACCESS, "30d")).rejects.toBe(redirect);
  });
});
