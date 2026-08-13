import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";

import { stubClient } from "../helpers/api";

// The composition sits on two resources, both of which sit on the server-side client — see
// `server.test.ts` for what each of these three answers.
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { ENABLEMENT_LIMIT, readEnablement } = await import("@/app/api/enablement");

/**
 * The one read behind the enablement step: organisations, then their repositories.
 *
 * What is under test is the composition rather than either resource — the fan-out, the
 * grouping, the totals travelling with the data, and the fact that a failure anywhere in it
 * is a failure of the whole read rather than a quietly empty list.
 */

const TENANT = "5eed0001-0000-4000-8000-000000000001";

/**
 * One organisation row.
 *
 * @param login Its GitHub login, which is also its id here.
 * @param enabled Whether it is switched on.
 * @returns The row.
 */
function org(login: string, enabled = true) {
  return {
    id: `org-${login}`,
    orgId: TENANT,
    login,
    enabled,
    installedAt: null,
    createdAt: "2026-08-11T10:20:23.114Z",
    updatedAt: "2026-08-11T10:20:23.114Z",
  };
}

/**
 * One repository row.
 *
 * @param name Its name, which is also its id here.
 * @param enabled Whether it is switched on.
 * @returns The row.
 */
function repo(name: string, enabled = true) {
  return {
    id: `repo-${name}`,
    githubOrgId: "org-acme-robotics",
    name,
    enabled,
    defaultBranch: "main",
    createdAt: "2026-08-11T10:20:23.114Z",
    updatedAt: "2026-08-11T10:20:23.114Z",
  };
}

/**
 * A page around some rows.
 *
 * @param items The rows.
 * @param total How many exist in total. Defaults to the number given.
 * @returns The page.
 */
function page(items: unknown[], total = items.length) {
  return { items, total, limit: ENABLEMENT_LIMIT, offset: 0 };
}

/**
 * A client answering the organisation listing and each repository listing separately.
 *
 * @param orgPage What the organisation listing answers.
 * @param repoPages What each organisation's repository listing answers, by login.
 * @returns The stub client and the requests made through it.
 */
function serviceWith(orgPage: unknown, repoPages: Record<string, unknown> = {}) {
  return stubClient((request) => {
    const path = new URL(request.url).pathname;
    const match = /\/github-orgs\/([^/]+)\/repos$/.exec(path);

    if (match) {
      return { body: repoPages[decodeURIComponent(match[1])] ?? page([]) };
    }
    return { body: orgPage };
  });
}

describe("readEnablement", () => {
  it("groups each organisation with the repositories recorded under it", async () => {
    const { client } = serviceWith(page([org("acme-robotics"), org("acme-labs", false)]), {
      "acme-robotics": page([repo("helios-firmware")]),
      "acme-labs": page([]),
    });

    const read = await readEnablement(TENANT, client);

    expect(read.orgs.map((entry) => entry.org.login)).toEqual([
      "acme-robotics",
      "acme-labs",
    ]);
    expect(read.orgs[0]?.repos.map((one) => one.name)).toEqual(["helios-firmware"]);
    expect(read.orgs[1]?.repos).toEqual([]);
  });

  it("makes one request for the organisations and one per organisation", async () => {
    const { client, requests } = serviceWith(page([org("one"), org("two")]));

    await readEnablement(TENANT, client);

    expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
      `/api/v1/orgs/${TENANT}/github-orgs`,
      `/api/v1/orgs/${TENANT}/github-orgs/one/repos`,
      `/api/v1/orgs/${TENANT}/github-orgs/two/repos`,
    ]);
  });

  it("asks for the contract's maximum page rather than its default of 25", async () => {
    // A first-run screen with thirty organisations should show thirty rows, not a page
    // control — and the ceiling is the service's, not this module's to raise.
    const { client, requests } = serviceWith(page([org("one")]));

    await readEnablement(TENANT, client);

    expect(ENABLEMENT_LIMIT).toBe(100);
    for (const request of requests) {
      expect(new URL(request.url).searchParams.get("limit")).toBe("100");
    }
  });

  it("carries both totals, so nothing is silently truncated", async () => {
    const { client } = serviceWith(page([org("acme-robotics")], 340), {
      "acme-robotics": page([repo("one"), repo("two")], 900),
    });

    const read = await readEnablement(TENANT, client);

    expect(read.orgTotal).toBe(340);
    expect(read.orgs[0]?.repoTotal).toBe(900);
    expect(read.orgs[0]?.repos).toHaveLength(2);
  });

  it("returns an empty list for an empty workspace, and makes no second call", async () => {
    const { client, requests } = serviceWith(page([]));

    expect(await readEnablement(TENANT, client)).toEqual({ orgs: [], orgTotal: 0 });
    expect(requests).toHaveLength(1);
  });

  it("fails the whole read when one repository listing fails", async () => {
    // A list with one organisation silently missing its repositories would show every
    // switch under it as off, which is a lie about what Ouroboros may work in.
    const { client } = stubClient((request) =>
      new URL(request.url).pathname.endsWith("/repos")
        ? { body: { code: "internal_error", message: "no", details: {} }, status: 500 }
        : { body: page([org("acme-robotics")]) },
    );

    const caught: unknown = await readEnablement(TENANT, client).catch((e: unknown) => e);

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).status).toBe(500);
  });

  it("fails the whole read when the workspace is not visible", async () => {
    const { client } = stubClient(() => ({
      body: { code: "tenant_not_found", message: "No such tenant.", details: {} },
      status: 404,
    }));

    await expect(readEnablement(TENANT, client)).rejects.toBeInstanceOf(ApiError);
  });
});
