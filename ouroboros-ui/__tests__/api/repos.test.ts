import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
// Types only, so this import is erased and nothing loads before the mocks below.
import type { Repo, RepoPage } from "@/app/api/repos";

import { STUB_BASE_URL, clientAnswering } from "../helpers/api";

// The resource sits on the server-side client — see `server.test.ts` for what each of these
// three answers. Every case passes its own client; the mocks only make the import succeed.
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { repos } = await import("@/app/api/repos");

/**
 * The repositories resource — the second half of the enablement list.
 */

/** The seeded workspace and organisation every path below carries. */
const TENANT = "5eed0001-0000-4000-8000-000000000001";
const ORG_LOGIN = "acme-robotics";

/** One repository, as the contract describes it. */
const REPO = {
  id: "5eed0006-0000-4000-8000-000000000001",
  githubOrgId: "5eed0005-0000-4000-8000-000000000001",
  name: "helios-firmware",
  enabled: true,
  defaultBranch: "main",
  createdAt: "2026-08-11T10:20:23.114Z",
  updatedAt: "2026-08-11T10:20:23.114Z",
};

/** A page carrying it. */
const PAGE = { items: [REPO], total: 1, limit: 25, offset: 0 };

describe("repos.list", () => {
  it("puts the workspace and the organisation in the path", async () => {
    const { client, requests } = clientAnswering(PAGE);

    const page = await repos.list(TENANT, ORG_LOGIN, {}, client);

    expect(requests[0]?.url).toBe(
      `${STUB_BASE_URL}/api/v1/orgs/${TENANT}/github-orgs/${ORG_LOGIN}/repos`,
    );
    expect(page).toEqual(PAGE);
  });

  it("passes the window through as the contract's query parameters", async () => {
    const { client, requests } = clientAnswering(PAGE);

    await repos.list(TENANT, ORG_LOGIN, { limit: 100 }, client);

    expect(new URL(requests[0]?.url ?? "").search).toBe("?limit=100");
  });

  it("keeps a null default branch null rather than inventing one", async () => {
    // "or `null` until it has been discovered from GitHub" — the screen renders nothing for
    // it, and a default here would assert a branch nobody has looked up.
    const { client } = clientAnswering({
      ...PAGE,
      items: [{ ...REPO, defaultBranch: null }],
    });

    expect((await repos.list(TENANT, ORG_LOGIN, {}, client)).items[0]?.defaultBranch).toBeNull();
  });

  it("returns an empty page for an organisation with nothing recorded under it", async () => {
    const { client } = clientAnswering({ items: [], total: 0, limit: 25, offset: 0 });

    expect((await repos.list(TENANT, ORG_LOGIN, {}, client)).total).toBe(0);
  });
});

describe("repos.setEnabled", () => {
  it("patches the repository, sending only the flag", async () => {
    const { client, requests } = clientAnswering({ ...REPO, enabled: false });

    const repo = await repos.setEnabled(TENANT, ORG_LOGIN, "helios-firmware", false, client);

    expect(requests[0]?.method).toBe("PATCH");
    expect(requests[0]?.url).toBe(
      `${STUB_BASE_URL}/api/v1/orgs/${TENANT}/github-orgs/${ORG_LOGIN}/repos/helios-firmware`,
    );
    expect(repo.enabled).toBe(false);
  });

  it("omits defaultBranch, so an enable does not forget what GitHub said", async () => {
    // The contract: "left alone when the request omits it rather than cleared". Sending it
    // would mean a toggle could quietly re-point where work is cut from.
    const { client, requests } = clientAnswering(REPO);

    await repos.setEnabled(TENANT, ORG_LOGIN, "helios-firmware", true, client);

    expect(await requests[0]?.json()).toEqual({ enabled: true });
  });

  it("returns the row it created when this is the first the service has heard of it", async () => {
    // There is no POST for a repository; this operation is the upsert, which is why the
    // screen can switch on something no installation flow has discovered yet.
    const fresh = { ...REPO, id: "new", defaultBranch: null, enabled: true };
    const { client } = clientAnswering(fresh, 200);

    expect(await repos.setEnabled(TENANT, ORG_LOGIN, "new-repo", true, client)).toEqual(fresh);
  });

  it("rejects with the 403 the contract answers a role that may only read", async () => {
    const { client } = clientAnswering(
      { code: "insufficient_role", message: "owner or admin.", details: {} },
      403,
    );

    const caught: unknown = await repos
      .setEnabled(TENANT, ORG_LOGIN, "helios-firmware", true, client)
      .catch((e: unknown) => e);

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).status).toBe(403);
  });
});

describe("the typing, which is the reason the client is generated", () => {
  it("types the page and its rows end to end", async () => {
    const { client } = clientAnswering(PAGE);

    const page: RepoPage = await repos.list(TENANT, ORG_LOGIN, {}, client);
    const first: Repo | undefined = page.items[0];

    expect(first?.name).toBe("helios-firmware");
    expect(first?.githubOrgId).toBe(REPO.githubOrgId);
  });

  it("rejects a field the contract does not describe", () => {
    const repo = REPO as unknown as Repo;

    // @ts-expect-error — a repository hangs from `orgId`; the tenant is reachable through
    // that, and a second copy of the fact here could disagree with it.
    expect(repo.tenantId).toBeUndefined();
  });
});
