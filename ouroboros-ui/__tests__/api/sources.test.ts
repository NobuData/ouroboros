import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
// Types only, so this import is erased and nothing loads before the mocks below.
import type { TicketSourceCreate } from "@/app/api/sources";

import { STUB_BASE_URL, clientAnswering, stubClient } from "../helpers/api";
import {
  SEEDED_GITHUB_ID,
  catalogPayload,
  source,
  sourcePage,
  statusReport,
  testResult,
} from "../helpers/sources";

// The facade sits on the server-side client — see `server.test.ts` for what each of these
// three answers.
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { LIST_PAGE_SIZE, sources } = await import("@/app/api/sources");

/**
 * The ticket-source facade ([#141](https://github.com/NobuData/ouroboros/issues/141)): each
 * call reaches the operation the contract describes, names no workspace, and hands the body
 * back untouched.
 */

const CREATE: TicketSourceCreate = {
  kind: "github",
  displayName: "GitHub · acme-robotics",
  config: { login: "acme-robotics", repos: ["helios-firmware"], token: "ghp_x" },
};

describe("sources.catalog", () => {
  it("calls the catalog endpoint and returns the body itself", async () => {
    const { client, requests } = clientAnswering(catalogPayload());

    expect(await sources.catalog(client)).toEqual(catalogPayload());
    expect(requests[0]?.url).toBe(`${STUB_BASE_URL}/api/v1/sources/catalog`);
    expect(requests[0]?.method).toBe("GET");
  });
});

describe("sources.list", () => {
  it("asks for the ceiling's worth in one page, because a duplicate-free list needs all of them", async () => {
    const { client, requests } = clientAnswering(sourcePage());

    expect(await sources.list(client)).toEqual(sourcePage());
    expect(requests[0]?.url).toBe(`${STUB_BASE_URL}/api/v1/sources?limit=${String(LIST_PAGE_SIZE)}`);
  });

  it("names no workspace, because the workspace is the session's", async () => {
    const { client, requests } = clientAnswering(sourcePage());

    await sources.list(client);

    expect(requests[0]?.headers.get("x-ouro-tenant")).toBeNull();
  });
});

describe("sources.read", () => {
  it("reads one source by id", async () => {
    const { client, requests } = clientAnswering(source());

    expect(await sources.read(SEEDED_GITHUB_ID, client)).toEqual(source());
    expect(requests[0]?.url).toBe(`${STUB_BASE_URL}/api/v1/sources/${SEEDED_GITHUB_ID}`);
  });
});

describe("sources.add", () => {
  it("posts the body as it was composed, and returns the stored source", async () => {
    const { client, requests } = clientAnswering(source(), 201);

    expect(await sources.add(CREATE, client)).toEqual(source());
    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.url).toBe(`${STUB_BASE_URL}/api/v1/sources`);
    expect(await requests[0]?.json()).toEqual(CREATE);
  });

  it("rejects with the service's envelope when the schema refused it", async () => {
    const { client } = clientAnswering(
      {
        code: "ticket_source_config_invalid",
        message: "The configuration does not satisfy this provider's schema.",
        details: { fields: { repos: ["Repositories needs at least 1 entry"] } },
      },
      422,
    );

    await expect(sources.add(CREATE, client)).rejects.toMatchObject({
      status: 422,
      code: "ticket_source_config_invalid",
      details: { fields: { repos: ["Repositories needs at least 1 entry"] } },
    });
  });
});

describe("sources.update", () => {
  it("patches only what changed", async () => {
    const { client, requests } = clientAnswering(source({ status: "paused" }));

    expect(await sources.update(SEEDED_GITHUB_ID, { status: "paused" }, client)).toMatchObject({
      status: "paused",
    });
    expect(requests[0]?.method).toBe("PATCH");
    expect(requests[0]?.url).toBe(`${STUB_BASE_URL}/api/v1/sources/${SEEDED_GITHUB_ID}`);
    expect(await requests[0]?.json()).toEqual({ status: "paused" });
  });
});

describe("sources.setCredentials", () => {
  it("posts the secret in a body and returns the source with its masked echo", async () => {
    const { client, requests } = clientAnswering(source({ credentialMask: "••••3210" }));

    const stored = await sources.setCredentials(SEEDED_GITHUB_ID, "ghp_secret3210", client);

    expect(stored.credentialMask).toBe("••••3210");
    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.url).toBe(`${STUB_BASE_URL}/api/v1/sources/${SEEDED_GITHUB_ID}/credentials`);
    expect(await requests[0]?.json()).toEqual({ secret: "ghp_secret3210" });
  });
});

describe("sources.test", () => {
  it("posts with no body and hands back what the provider found — a refusal included", async () => {
    const { client, requests } = clientAnswering(testResult({ status: "failed", errorClass: "auth" }));

    const result = await sources.test(SEEDED_GITHUB_ID, client);

    expect(result.status).toBe("failed");
    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.url).toBe(`${STUB_BASE_URL}/api/v1/sources/${SEEDED_GITHUB_ID}/test`);
  });
});

describe("sources.sync", () => {
  it("posts and hands back the status at acceptance", async () => {
    const { client, requests } = clientAnswering(statusReport({ running: true }), 202);

    expect((await sources.sync(SEEDED_GITHUB_ID, client)).running).toBe(true);
    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.url).toBe(`${STUB_BASE_URL}/api/v1/sources/${SEEDED_GITHUB_ID}/sync`);
  });

  it("rejects with the service's 409 and its wait, as an ApiError", async () => {
    const { client } = stubClient(() => ({
      status: 409,
      body: {
        code: "ticket_source_sync_too_soon",
        message: "This source was synced less than 30 seconds ago. Try again shortly.",
        details: { retryAfterSeconds: 22 },
      },
    }));

    const refusal = await sources.sync(SEEDED_GITHUB_ID, client).catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(ApiError);
    expect((refusal as ApiError).code).toBe("ticket_source_sync_too_soon");
    expect((refusal as ApiError).details.retryAfterSeconds).toBe(22);
  });
});

describe("sources.status", () => {
  it("reads the report", async () => {
    const { client, requests } = clientAnswering(statusReport());

    expect(await sources.status(SEEDED_GITHUB_ID, client)).toEqual(statusReport());
    expect(requests[0]?.url).toBe(`${STUB_BASE_URL}/api/v1/sources/${SEEDED_GITHUB_ID}/status`);
  });
});
