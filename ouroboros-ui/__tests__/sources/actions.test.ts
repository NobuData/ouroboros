import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { CATALOG_UNAVAILABLE, CREDENTIALS_UNSUPPORTED } from "@/app/sources/catalog";
import {
  CONFIGURE_READ_ONLY,
  PAUSE_FAILED,
  PAUSE_READ_ONLY,
  SOURCE_GONE,
  SYNC_FAILED,
  SYNC_READ_ONLY,
  SYNC_REFUSED_PAUSED,
  SYNC_RUNNING,
  TEST_FAILED,
  TEST_READ_ONLY,
  syncTooSoon,
} from "@/app/sources/view";

import {
  SEEDED_GITHUB_ID,
  catalogPayload,
  refusedTest,
  seededCatalog,
  source,
  statusReport,
  testResult,
} from "../helpers/sources";

const api = vi.hoisted(() => ({
  catalog: vi.fn(),
  add: vi.fn(),
  update: vi.fn(),
  setCredentials: vi.fn(),
  test: vi.fn(),
  sync: vi.fn(),
  status: vi.fn(),
}));

vi.mock("@/app/api/sources", () => ({
  sources: {
    catalog: () => api.catalog(),
    add: (body: unknown) => api.add(body),
    update: (id: string, patch: unknown) => api.update(id, patch),
    setCredentials: (id: string, secret: string) => api.setCredentials(id, secret),
    test: (id: string) => api.test(id),
    sync: (id: string) => api.sync(id),
    status: (id: string) => api.status(id),
  },
}));

const actions = await import("@/app/sources/actions");

/**
 * The Server Actions ([#141](https://github.com/NobuData/ouroboros/issues/141)): every
 * refusal is a value, every code the page branches on becomes its sentence, and anything
 * that is not an `ApiError` travels.
 */

const ID = SEEDED_GITHUB_ID;

function refusal(status: number, code: string, details: Record<string, unknown> = {}): ApiError {
  return new ApiError(status, code, `${code} message`, details);
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.catalog.mockResolvedValue(catalogPayload());
  api.add.mockResolvedValue(source());
  api.update.mockResolvedValue(source({ status: "paused" }));
  api.setCredentials.mockResolvedValue(source({ credentialMask: "••••3210" }));
  api.test.mockResolvedValue(testResult());
  api.sync.mockResolvedValue(statusReport({ running: true }));
  api.status.mockResolvedValue(statusReport());
});

describe("readSourceCatalog", () => {
  it("hands back the entries", async () => {
    expect(await actions.readSourceCatalog()).toEqual({ ok: true, entries: seededCatalog() });
  });

  it("hands back the sentence when the catalog could not be read", async () => {
    api.catalog.mockRejectedValue(refusal(500, "internal_error"));

    expect(await actions.readSourceCatalog()).toEqual({ ok: false, reason: CATALOG_UNAVAILABLE });
  });
});

describe("addSource", () => {
  it("forwards the body and hands back the stored source's id and heading", async () => {
    const body = { kind: "github" as const, displayName: "x", config: { login: "a", repos: ["b"], token: "t" } };

    expect(await actions.addSource(body)).toEqual({
      ok: true,
      source: { id: ID, displayName: "GitHub · acme-robotics" },
    });
    expect(api.add).toHaveBeenCalledWith(body);
  });

  it("hands back the envelope on a refusal", async () => {
    api.add.mockRejectedValue(refusal(422, "ticket_source_config_invalid", { fields: { repos: ["x"] } }));

    expect(await actions.addSource({ kind: "github", displayName: "x", config: {} })).toEqual({
      ok: false,
      refusal: {
        code: "ticket_source_config_invalid",
        message: "ticket_source_config_invalid message",
        details: { fields: { repos: ["x"] } },
      },
    });
  });

  it("lets a redirect signal through", async () => {
    api.add.mockRejectedValue(new Error("NEXT_REDIRECT"));

    await expect(actions.addSource({ kind: "github", displayName: "x", config: {} })).rejects.toThrow(
      "NEXT_REDIRECT",
    );
  });
});

describe("updateSourceConfig and setSourceCredentials", () => {
  it("patch the settings whole", async () => {
    await actions.updateSourceConfig(ID, { login: "a", repos: ["b"] });

    expect(api.update).toHaveBeenCalledWith(ID, { config: { login: "a", repos: ["b"] } });
  });

  it("send the secret exactly as typed and hand back the masked echo", async () => {
    const outcome = await actions.setSourceCredentials(ID, " ghp_x ");

    expect(api.setCredentials).toHaveBeenCalledWith(ID, " ghp_x ");
    expect(outcome.ok && outcome.source.credentialMask).toBe("••••3210");
  });

  it("word the two credential refusals the page has sentences for", async () => {
    api.setCredentials.mockRejectedValue(refusal(409, "ticket_source_credentials_unsupported"));
    expect((await actions.setSourceCredentials(ID, "x")) as unknown).toMatchObject({
      ok: false,
      refusal: { message: CREDENTIALS_UNSUPPORTED },
    });

    api.setCredentials.mockRejectedValue(refusal(403, "forbidden"));
    expect((await actions.setSourceCredentials(ID, "x")) as unknown).toMatchObject({
      ok: false,
      refusal: { message: CONFIGURE_READ_ONLY },
    });
  });
});

describe("testSource", () => {
  it("hands back what the provider found — a refused token included", async () => {
    api.test.mockResolvedValue(refusedTest());

    expect(await actions.testSource(ID)).toEqual({ ok: true, result: refusedTest() });
  });

  it("words a refusal of the request itself", async () => {
    api.test.mockRejectedValue(refusal(403, "forbidden"));
    expect(await actions.testSource(ID)).toEqual({ ok: false, reason: TEST_READ_ONLY });

    api.test.mockRejectedValue(refusal(404, "ticket_source_not_found"));
    expect(await actions.testSource(ID)).toEqual({ ok: false, reason: SOURCE_GONE });

    api.test.mockRejectedValue(refusal(501, "ticket_source_kind_unsupported"));
    expect(await actions.testSource(ID)).toEqual({ ok: false, reason: TEST_FAILED });
  });
});

describe("syncSource", () => {
  it("hands back the status at acceptance", async () => {
    expect(await actions.syncSource(ID)).toEqual({ ok: true, status: statusReport({ running: true }) });
  });

  it("gives each of the three 409s its own sentence, because the reader's next move differs", async () => {
    api.sync.mockRejectedValue(refusal(409, "ticket_source_paused"));
    expect(await actions.syncSource(ID)).toEqual({ ok: false, reason: SYNC_REFUSED_PAUSED });

    api.sync.mockRejectedValue(refusal(409, "ticket_source_sync_running"));
    expect(await actions.syncSource(ID)).toEqual({ ok: false, reason: SYNC_RUNNING });

    api.sync.mockRejectedValue(refusal(409, "ticket_source_sync_too_soon", { retryAfterSeconds: 22 }));
    expect(await actions.syncSource(ID)).toEqual({ ok: false, reason: syncTooSoon(22) });
  });

  it("words the other refusals", async () => {
    api.sync.mockRejectedValue(refusal(403, "forbidden"));
    expect(await actions.syncSource(ID)).toEqual({ ok: false, reason: SYNC_READ_ONLY });

    api.sync.mockRejectedValue(refusal(500, "internal_error"));
    expect(await actions.syncSource(ID)).toEqual({ ok: false, reason: SYNC_FAILED });
  });
});

describe("readSourceStatus", () => {
  it("hands back the report, or the sentence", async () => {
    expect(await actions.readSourceStatus(ID)).toEqual({ ok: true, status: statusReport() });

    api.status.mockRejectedValue(refusal(404, "ticket_source_not_found"));
    expect(await actions.readSourceStatus(ID)).toEqual({ ok: false, reason: SOURCE_GONE });
  });
});

describe("setSourceStatus", () => {
  it("patches the position to be in, and hands back the one the service holds", async () => {
    expect(await actions.setSourceStatus(ID, "paused")).toEqual({ ok: true, status: "paused" });
    expect(api.update).toHaveBeenCalledWith(ID, { status: "paused" });
  });

  it("words a refusal", async () => {
    api.update.mockRejectedValue(refusal(403, "forbidden"));
    expect(await actions.setSourceStatus(ID, "active")).toEqual({ ok: false, reason: PAUSE_READ_ONLY });

    api.update.mockRejectedValue(refusal(500, "internal_error"));
    expect(await actions.setSourceStatus(ID, "active")).toEqual({ ok: false, reason: PAUSE_FAILED });
  });
});
