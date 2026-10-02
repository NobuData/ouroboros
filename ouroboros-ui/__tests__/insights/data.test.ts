import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";

import type { Playbook } from "@/app/api/playbooks";

import { INSIGHTS_READ_AT, SEEDED_PLAYBOOK, seededInsights } from "../helpers/insights";
import { membership, sessionUser } from "../helpers/login";

vi.mock("server-only", () => ({}));

/** What the page read answers, per case. */
const page = vi.fn();

/** What the playbooks read answers, per case. */
const list = vi.fn();

vi.mock("@/app/api/insights", () => ({ insights: { page: (range: string) => page(range) } }));
vi.mock("@/app/api/playbooks", () => ({ playbooks: { list: () => list() } }));

/**
 * A playbook as the list serves it — only what the card reads is meaningful.
 *
 * @param id Its id.
 * @param name Its name.
 * @returns The playbook.
 */
function recipe(id: string, name: string): Playbook {
  return { id, name } as Playbook;
}

const { readInsights } = await import("@/app/insights/data");

/**
 * The insights page's first-paint reader (#443): one read for the address's range — and, for the
 * flaky card's playbook link (#446), the workspace's playbooks.
 */

const ACCESS = {
  session: { user: sessionUser(), memberships: [membership()], tenantSuggestion: null },
  membership: membership(),
} as unknown as Parameters<typeof readInsights>[0];

beforeEach(() => {
  page.mockReset().mockResolvedValue(seededInsights());
  list.mockReset().mockResolvedValue({
    items: [recipe("cve", "CVE bump"), recipe(SEEDED_PLAYBOOK.id, SEEDED_PLAYBOOK.name)],
  });
});

describe("readInsights", () => {
  it.each([
    [["owner"], true],
    [["admin"], true],
    [["member"], true],
    [["viewer"], false],
    [[], false],
  ] as const)("lets %j re-categorize: %s (#445)", async (roles, may) => {
    const access = { ...ACCESS, membership: { ...membership(), roles: [...roles] } } as typeof ACCESS;

    expect((await readInsights(access, "30d")).mayRecategorize).toBe(may);
  });

  it("reads the page once for the range, and stamps when", async () => {
    const readings = await readInsights(ACCESS, "90d", () => INSIGHTS_READ_AT);

    expect(page).toHaveBeenCalledExactlyOnceWith("90d");
    expect(readings).toEqual({
      range: "90d",
      page: { ok: true, value: seededInsights() },
      readAt: INSIGHTS_READ_AT,
      mayRecategorize: true,
      flakyPlaybook: { ok: true, value: SEEDED_PLAYBOOK },
    });
  });

  it("finds the flaky-test recipe by name, case-blind and trimmed (#446)", async () => {
    list.mockResolvedValue({ items: [recipe("hunt", "  flaky TEST hunt ")] });

    expect((await readInsights(ACCESS, "30d")).flakyPlaybook).toEqual({
      ok: true,
      value: { id: "hunt", name: "  flaky TEST hunt " },
    });
  });

  it("answers null when the workspace has no flaky-test recipe (#446)", async () => {
    list.mockResolvedValue({ items: [recipe("cve", "CVE bump")] });

    expect((await readInsights(ACCESS, "30d")).flakyPlaybook).toEqual({ ok: true, value: null });
  });

  it("keeps a refused playbooks read as its reason, and still reads the page (#446)", async () => {
    list.mockRejectedValue(new ApiError(503, "unavailable", "Playbooks are unavailable."));

    const readings = await readInsights(ACCESS, "30d");

    expect(readings.flakyPlaybook).toEqual({ ok: false, reason: "Playbooks are unavailable." });
    expect(readings.page).toEqual({ ok: true, value: seededInsights() });
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
