import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { POLL_AFTER_HEADER } from "@/app/poll";

import { clientAnswering, stubClient } from "../helpers/api";
import {
  FARM_AGENT_VERSION,
  FARM_ORIGIN,
  emptyFarm,
  enrollmentToken,
  mintedCommand,
  runnerPool,
  seededFarm,
} from "../helpers/farm";

// The facade sits on the server-side client — see `server.test.ts`.
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { farm } = await import("@/app/api/farm");

/**
 * The build farm page's share of AH.6's contract (#254, consumed by #256): one read, the page in
 * one observation, and the cadence hint it comes with.
 */

describe("farm.page", () => {
  it("reads the farm endpoint and hands back the payload as served", async () => {
    const { client, requests } = clientAnswering(seededFarm());

    const page = await farm.page(client);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe("GET");
    expect(requests[0]?.url).toBe("http://rest.test:4000/api/v1/farm");
    expect(page).toEqual(seededFarm());
  });

  it("names no workspace, because the workspace is the session's", async () => {
    const { client, requests } = clientAnswering(seededFarm());

    await farm.page(client);

    expect(requests[0]?.headers.get("X-Ouro-Tenant")).toBeNull();
  });

  it("keeps an empty organization's nulls as nulls, and its zeros as zeros", async () => {
    // The distinction is the contract's and load-bearing: a zero invented on the way through
    // would reach the glass as `0m 00s` or `0%`.
    const { client } = clientAnswering(emptyFarm());

    const { stats } = await farm.page(client);

    expect(stats.runnersOnline).toMatchObject({ online: 0, total: 0, note: null });
    expect(stats.buildsToday.total).toBe(0);
    expect(stats.avgBuildTime.seconds).toBeNull();
    expect(stats.avgBuildTime.deltaVsLastWeek).toBeNull();
    expect(stats.cacheHitRate.pct).toBeNull();
  });

  it("rejects with the service's envelope when it refuses", async () => {
    const { client } = clientAnswering(
      { code: "organization_required", message: "Choose a workspace.", details: {} },
      400,
    );

    const failure: unknown = await farm.page(client).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).code).toBe("organization_required");
  });
});

describe("farm.observe", () => {
  it("reads the cadence the service asked for beside the page", async () => {
    const { client } = stubClient(() => ({ body: seededFarm(), headers: { [POLL_AFTER_HEADER]: "10" } }));

    await expect(farm.observe(client)).resolves.toEqual({ page: seededFarm(), pollAfterSeconds: 10 });
  });

  it("answers no cadence when the service sent none, rather than inventing one", async () => {
    const { client } = clientAnswering(seededFarm());

    await expect(farm.observe(client)).resolves.toMatchObject({ pollAfterSeconds: null });
  });

  it("treats a hint it cannot use as no hint", async () => {
    const { client } = stubClient(() => ({ body: seededFarm(), headers: { [POLL_AFTER_HEADER]: "soon" } }));

    await expect(farm.observe(client)).resolves.toMatchObject({ pollAfterSeconds: null });
  });

  it("hands the wire the caller's deadline", async () => {
    const { client, requests } = clientAnswering(seededFarm());
    const controller = new AbortController();

    await farm.observe(client, controller.signal);
    controller.abort();

    expect(requests[0]?.signal.aborted).toBe(true);
  });
});

/**
 * The enroll flow's share (#250 and #254, consumed by #258): the minting read of the install
 * command, the masked token list, the revoke, and the pools on their own.
 */

describe("farm.enrollCommand", () => {
  const answer = {
    command: mintedCommand(),
    origin: FARM_ORIGIN,
    version: FARM_AGENT_VERSION,
    tenant: "acme-robotics",
    pool: "pool-a",
    token: enrollmentToken(),
  };

  it("asks for a command for one pool, and hands back what was minted as served", async () => {
    const { client, requests } = clientAnswering(answer);

    const minted = await farm.enrollCommand("pool-a", client);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe("GET");
    expect(requests[0]?.url).toBe("http://rest.test:4000/api/v1/farm/enroll-command?pool=pool-a");
    expect(minted).toEqual(answer);
  });

  it("names no workspace, so a token can only be minted into the session's own", async () => {
    const { client, requests } = clientAnswering(answer);

    await farm.enrollCommand("pool-a", client);

    expect(requests[0]?.headers.get("X-Ouro-Tenant")).toBeNull();
  });

  it.each([
    [403, "forbidden"],
    [404, "farm_pool_not_found"],
    [404, "farm_enroll_command_unavailable"],
  ])("rejects a %i %s with the service's envelope — nothing was minted", async (status, code) => {
    const { client } = clientAnswering({ code, message: "No.", details: {} }, status);

    const failure: unknown = await farm.enrollCommand("pool-a", client).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).code).toBe(code);
  });
});

describe("farm.tokens", () => {
  it("lists the workspace's tokens as served — masked, every one", async () => {
    const tokens = [enrollmentToken(), enrollmentToken({ id: "other", revoked: true })];
    const { client, requests } = clientAnswering(tokens);

    await expect(farm.tokens(client)).resolves.toEqual(tokens);
    expect(requests[0]?.method).toBe("GET");
    expect(requests[0]?.url).toBe("http://rest.test:4000/api/v1/farm/enrollment-tokens");
  });

  it("rejects a member's 403 rather than answering an empty list", async () => {
    const { client } = clientAnswering({ code: "forbidden", message: "No.", details: {} }, 403);

    await expect(farm.tokens(client)).rejects.toBeInstanceOf(ApiError);
  });
});

describe("farm.revokeToken", () => {
  it("deletes the token by id and hands back the token as it now stands", async () => {
    const revoked = enrollmentToken({ revoked: true, revokedAt: "2026-09-19T14:05:00.000Z" });
    const { client, requests } = clientAnswering(revoked);

    await expect(farm.revokeToken(revoked.id, client)).resolves.toEqual(revoked);
    expect(requests[0]?.method).toBe("DELETE");
    expect(requests[0]?.url).toBe(`http://rest.test:4000/api/v1/farm/enrollment-tokens/${revoked.id}`);
  });

  it("rejects with the service's code for a token this workspace does not have", async () => {
    const { client } = clientAnswering(
      { code: "farm_enrollment_token_not_found", message: "No such token.", details: {} },
      404,
    );

    const failure: unknown = await farm.revokeToken("missing", client).catch((error: unknown) => error);

    expect((failure as ApiError).code).toBe("farm_enrollment_token_not_found");
  });
});

describe("farm.pools", () => {
  it("reads the pools on their own, without the fleet beside them", async () => {
    const { client, requests } = clientAnswering(seededFarm().pools);

    await expect(farm.pools(client)).resolves.toEqual(seededFarm().pools);
    expect(requests[0]?.url).toBe("http://rest.test:4000/api/v1/farm/pools");
  });
});

describe("farm.createPool", () => {
  it("POSTs the pool as given and hands back the pool as stored", async () => {
    const stored = runnerPool({ name: "pool-c", runners: 0 });
    const { client, requests } = clientAnswering(stored, 201);
    const body = { name: "pool-c", executor: "container" as const, image: "img:1" };

    await expect(farm.createPool(body, client)).resolves.toEqual(stored);
    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.url).toBe("http://rest.test:4000/api/v1/farm/pools");
    await expect(requests[0]?.json()).resolves.toEqual(body);
  });

  it("rejects with the service's code when the name is taken", async () => {
    const { client } = clientAnswering({ code: "farm_pool_name_taken", message: "Taken.", details: {} }, 409);

    const failure: unknown = await farm
      .createPool({ name: "pool-a", executor: "shell" }, client)
      .catch((error: unknown) => error);

    expect((failure as ApiError).code).toBe("farm_pool_name_taken");
  });
});

describe("farm.updatePool", () => {
  it("PATCHes only what it was handed — a null image included, because null is a value", async () => {
    const changed = runnerPool({ executor: "shell", image: null });
    const { client, requests } = clientAnswering(changed);

    await expect(farm.updatePool(changed.id, { executor: "shell", image: null }, client)).resolves.toEqual(changed);
    expect(requests[0]?.method).toBe("PATCH");
    expect(requests[0]?.url).toBe(`http://rest.test:4000/api/v1/farm/pools/${changed.id}`);
    await expect(requests[0]?.json()).resolves.toEqual({ executor: "shell", image: null });
  });

  it("names no workspace, so a pool can only be changed in the session's own", async () => {
    const { client, requests } = clientAnswering(runnerPool());

    await farm.updatePool(runnerPool().id, { enabled: false }, client);

    expect(requests[0]?.headers.has("X-Ouro-Tenant")).toBe(false);
  });

  it("rejects a member's 403 rather than answering the pool unchanged", async () => {
    const { client } = clientAnswering({ code: "forbidden", message: "No.", details: {} }, 403);

    await expect(farm.updatePool(runnerPool().id, { enabled: false }, client)).rejects.toBeInstanceOf(ApiError);
  });
});

describe("farm.deletePool", () => {
  it("DELETEs the pool by id and resolves to nothing on the 204", async () => {
    const { client, requests } = stubClient(() => ({ body: undefined, status: 204 }));

    await expect(farm.deletePool(runnerPool().id, client)).resolves.toBeUndefined();
    expect(requests[0]?.method).toBe("DELETE");
    expect(requests[0]?.url).toBe(`http://rest.test:4000/api/v1/farm/pools/${runnerPool().id}`);
  });

  it("rejects with the counts the service took when runners or builds still name the pool", async () => {
    const { client } = clientAnswering(
      { code: "farm_pool_in_use", message: "In use.", details: { pool: "pool-a", runners: 4, jobs: 31 } },
      409,
    );

    const failure: unknown = await farm.deletePool(runnerPool().id, client).catch((error: unknown) => error);

    expect((failure as ApiError).code).toBe("farm_pool_in_use");
    expect((failure as ApiError).details).toMatchObject({ runners: 4, jobs: 31 });
  });
});
