import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Workspace } from "@/app/api/access";
import { ApiError } from "@/app/api/errors";

import { seededRepos, seededSkills } from "../helpers/knowledge";
import { TENANT_ID, enablement, membership, org, repo, sessionUser } from "../helpers/login";

/**
 * The knowledge frame's reader (#417): two reads in parallel, each kept as a value, so a refused
 * one degrades its own concern and the redirect signal still travels.
 */

// The module is server-only; the marker refuses to load under jsdom, and the test is the server.
vi.mock("server-only", () => ({}));

const list = vi.fn();
const readEnablement = vi.fn();

vi.mock("@/app/api/skills", () => ({ skills: { list: () => list() } }));
vi.mock("@/app/api/enablement", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/api/enablement")>()),
  readEnablement: (tenantId: string) => readEnablement(tenantId),
}));

const { readKnowledge } = await import("@/app/knowledge/data");

/** The workspace the gate hands over. */
const ACCESS: Workspace = {
  session: {
    user: sessionUser(),
    memberships: [membership()],
    membershipTotal: 1,
    activeOrganizationId: TENANT_ID,
    tenantSuggestion: null,
  },
  membership: membership(),
};

/** The seeded workspace's enablement list: one organisation, its two repositories enabled. */
const ENABLEMENT = enablement([
  [
    org({ login: "acme-robotics", enabled: true }),
    seededRepos().map((one) => repo({ id: one.id, name: one.name, enabled: true })),
  ],
]);

beforeEach(() => {
  list.mockReset().mockResolvedValue(seededSkills());
  readEnablement.mockReset().mockResolvedValue(ENABLEMENT);
});

describe("readKnowledge", () => {
  it("reads the skills and the enabled repositories of the gate's workspace", async () => {
    const readings = await readKnowledge(ACCESS);

    expect(readEnablement).toHaveBeenCalledExactlyOnceWith(ACCESS.membership.id);
    expect(readings.skills).toEqual({ ok: true, value: seededSkills() });
    expect(readings.repos).toEqual({ ok: true, value: seededRepos() });
  });

  it("keeps one refusal as that reading's reason and leaves the other whole", async () => {
    list.mockRejectedValue(new ApiError(500, "internal_error", "The service failed.", {}));

    const readings = await readKnowledge(ACCESS);

    expect(readings.skills).toEqual({ ok: false, reason: "The service failed." });
    expect(readings.repos.ok).toBe(true);
  });

  it("lets anything that is not the service's refusal travel", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    readEnablement.mockRejectedValue(redirect);

    await expect(readKnowledge(ACCESS)).rejects.toBe(redirect);
  });
});
