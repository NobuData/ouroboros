import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { POLL_AFTER_HEADER } from "@/app/poll";

import { clientAnswering, stubClient } from "../helpers/api";
import {
  FARM_AGENT_VERSION,
  FARM_ORIGIN,
  LIVE_JOB_ID,
  buildLog,
  emptyFarm,
  enrollmentToken,
  farmRunner,
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

describe("farm.log", () => {
  it("reads one page of a job's log from an offset, and hands it back as served", async () => {
    const page = buildLog("[6/7] Linking zephyr.elf …", { offset: 18_122 });
    const { client, requests } = clientAnswering(page);

    const read = await farm.log(LIVE_JOB_ID, 18_122, client);

    expect(requests[0]?.method).toBe("GET");
    expect(requests[0]?.url).toBe(`http://rest.test:4000/api/v1/farm/jobs/${LIVE_JOB_ID}/log?after=18122`);
    expect(read).toEqual(page);
  });

  it("asks from zero explicitly, which is how a log is read from its start", async () => {
    const { client, requests } = clientAnswering(buildLog());

    await farm.log(LIVE_JOB_ID, 0, client);

    expect(new URL(requests[0]!.url).searchParams.get("after")).toBe("0");
  });

  it("keeps the live flag, the holes and the tail exactly as the service sent them", async () => {
    const page = buildLog("a\nb\n", {
      live: false,
      elisions: [{ offset: 2, bytes: 2_481_392, missingChunks: 1 }],
      tail: { bytes: 900, missingChunks: 0, capped: true },
      pollAfter: 15,
    });
    const { client } = clientAnswering(page);

    expect(await farm.log(LIVE_JOB_ID, 0, client)).toEqual(page);
  });

  it("hands the wire the caller's deadline", async () => {
    const { client, requests } = clientAnswering(buildLog());
    const deadline = new AbortController();

    await farm.log(LIVE_JOB_ID, 0, client, deadline.signal);
    deadline.abort();

    expect(requests[0]?.signal.aborted).toBe(true);
  });

  it("rejects another workspace's job as not found, and an offset past the end as the 422 it is", async () => {
    const missing = clientAnswering({ code: "farm_job_not_found", message: "No such job.", details: {} }, 404);
    const beyond = clientAnswering(
      { code: "farm_log_offset_out_of_range", message: "Nothing after that.", details: { end: 10 } },
      422,
    );

    await expect(farm.log(LIVE_JOB_ID, 0, missing.client)).rejects.toMatchObject({ code: "farm_job_not_found" });
    await expect(farm.log(LIVE_JOB_ID, 99, beyond.client)).rejects.toMatchObject({
      code: "farm_log_offset_out_of_range",
    });
  });
});

/** The runner every lifecycle case acts on — `forge-02`, the factory's. */
const RUNNER_ID = farmRunner().id;

describe.each([
  ["drainRunner", "drain"],
  ["undrainRunner", "undrain"],
] as const)("farm.%s (#260)", (operation, verb) => {
  it("POSTs to the runner's own sub-resource, with no body, and hands back what it did", async () => {
    const answer = { runner: farmRunner({ desiredState: "draining" }), pushed: true };
    const { client, requests } = clientAnswering(answer);

    const result = await farm[operation](RUNNER_ID, client);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.url).toBe(`http://rest.test:4000/api/v1/farm/runners/${RUNNER_ID}/${verb}`);
    expect(await requests[0]?.text()).toBe("");
    expect(result).toEqual(answer);
  });

  it("keeps `pushed: false` as the answer it is — asked, not failed", async () => {
    const { client } = clientAnswering({ runner: farmRunner(), pushed: false });

    expect((await farm[operation](RUNNER_ID, client)).pushed).toBe(false);
  });

  it("names no workspace, so a runner can only be acted on in the session's own", async () => {
    const { client, requests } = clientAnswering({ runner: farmRunner(), pushed: true });

    await farm[operation](RUNNER_ID, client);

    expect(requests[0]?.headers.get("X-Ouro-Tenant")).toBeNull();
  });

  it("rejects a member's 403, and a retired machine's 409, with the service's codes", async () => {
    const forbidden = clientAnswering({ code: "forbidden", message: "No.", details: {} }, 403);
    const retired = clientAnswering({ code: "farm_runner_removed", message: "Gone.", details: {} }, 409);

    await expect(farm[operation](RUNNER_ID, forbidden.client)).rejects.toMatchObject({ code: "forbidden" });
    await expect(farm[operation](RUNNER_ID, retired.client)).rejects.toMatchObject({
      code: "farm_runner_removed",
    });
  });
});

describe("farm.removeRunner (#260)", () => {
  it("DELETEs the runner by id and hands back the retired machine", async () => {
    const removed = farmRunner({ status: "removed", desiredState: "removed", certificate: null });
    const { client, requests } = clientAnswering(removed);

    const result = await farm.removeRunner(RUNNER_ID, client);

    expect(requests[0]?.method).toBe("DELETE");
    expect(requests[0]?.url).toBe(`http://rest.test:4000/api/v1/farm/runners/${RUNNER_ID}`);
    expect(result).toEqual(removed);
  });

  it("rejects with the state the machine is in when the service's guard refuses", async () => {
    const { client } = clientAnswering(
      { code: "farm_runner_not_removable", message: "Drain it first.", details: { status: "building" } },
      409,
    );

    const refusal = await farm.removeRunner(RUNNER_ID, client).catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(ApiError);
    expect(refusal).toMatchObject({ code: "farm_runner_not_removable", details: { status: "building" } });
  });
});

describe("farm.submitJob (#260)", () => {
  const submission = {
    pool: "pool-a",
    repository: "acme-robotics/helios-firmware",
    ref: "refs/heads/main",
    commit: "9e7bd4034c1f1b2a6d8e0f5c7a9b3d1e2f4a6c80",
  };

  it("POSTs the submission as given and hands back the queued job", async () => {
    const job = { id: "5eed0028-0000-4000-8000-000000000483", number: 483, status: "queued", pool: "pool-a" };
    const { client, requests } = clientAnswering(job, 201);

    const result = await farm.submitJob(submission, client);

    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.url).toBe("http://rest.test:4000/api/v1/farm/jobs");
    expect(await requests[0]?.json()).toEqual(submission);
    expect(result).toEqual(job);
  });

  it("sends a command as argv when there is one, and no `command` key when there is not", async () => {
    const withCommand = clientAnswering({}, 201);
    const without = clientAnswering({}, 201);

    await farm.submitJob({ ...submission, command: ["sh", "-c", "make all"] }, withCommand.client);
    await farm.submitJob(submission, without.client);

    expect(await withCommand.requests[0]?.json()).toMatchObject({ command: ["sh", "-c", "make all"] });
    expect(await without.requests[0]?.json()).not.toHaveProperty("command");
  });

  it("names no workspace, so a build can only land in the session's own", async () => {
    const { client, requests } = clientAnswering({}, 201);

    await farm.submitJob(submission, client);

    expect(requests[0]?.headers.get("X-Ouro-Tenant")).toBeNull();
  });

  it("rejects with the service's code — a disabled pool, a repository it does not mirror", async () => {
    const disabled = clientAnswering({ code: "farm_pool_disabled", message: "Off.", details: {} }, 409);
    const unknown = clientAnswering({ code: "farm_repository_not_found", message: "No.", details: {} }, 404);

    await expect(farm.submitJob(submission, disabled.client)).rejects.toMatchObject({
      code: "farm_pool_disabled",
    });
    await expect(farm.submitJob(submission, unknown.client)).rejects.toMatchObject({
      code: "farm_repository_not_found",
    });
  });
});
