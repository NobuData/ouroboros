import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
// Types only, so this import is erased and nothing loads before the mocks below.
import type { ProviderConnectionCreate } from "@/app/api/providers";

import { STUB_BASE_URL, clientAnswering, stubClient } from "../helpers/api";
import {
  anthropicModels,
  catalogPayload,
  providerModels,
  pullRecord,
  connection,
  connectionPage,
  modelAlias,
  seededAliases,
  seededSpend,
} from "../helpers/providers";

// The facade sits on the server-side client — see `server.test.ts` for what each of these
// three answers.
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { LIST_PAGE_SIZE, providers } = await import("@/app/api/providers");

/**
 * The add-provider flow's three calls (#231): the catalog, the listing, and the add.
 *
 * Two `GET`s and a `POST`, so most of what is worth holding is about what this module does
 * *not* do — it names no workspace, it reshapes nothing the service composed, and it forwards
 * an add's body exactly as the dialog built it — and about the one thing the dialog's honesty
 * rests on: **a refusal reaches the caller as the service's own envelope**, code and details
 * intact, so the adapter's designed error can be drawn under the field it is about.
 */

/** What the dialog sends for the seed's vLLM endpoint. */
const VLLM: ProviderConnectionCreate = {
  kind: "openai_compatible",
  displayName: "vLLM · lab cluster",
  config: { baseUrl: "http://10.0.4.20:8000/v1" },
};

describe("providers.catalog", () => {
  it("calls the catalog endpoint and returns the body itself", async () => {
    const { client, requests } = clientAnswering(catalogPayload());

    const payload = await providers.catalog(client);

    expect(requests[0]?.url).toBe("http://rest.test:4000/api/v1/providers/catalog");
    expect(requests[0]?.method).toBe("GET");
    expect(payload).toEqual(catalogPayload());
  });

  it("names no workspace, because the workspace is the session's", async () => {
    const { client, requests } = clientAnswering(catalogPayload());

    await providers.catalog(client);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.headers.get("X-Ouro-Tenant")).toBeNull();
  });

  it("hands back an empty catalog as an empty catalog", async () => {
    // A build that registers no adapter is a state the dialog says something for, not a
    // failure this module should turn into one.
    const { client } = clientAnswering(catalogPayload([]));

    await expect(providers.catalog(client)).resolves.toEqual({ kinds: [] });
  });
});

describe("providers.list", () => {
  it("calls the listing with the contract's ceiling, so the duplicate check sees the whole workspace", async () => {
    const { client, requests } = clientAnswering(connectionPage());

    const payload = await providers.list(client);

    expect(requests[0]?.method).toBe("GET");
    expect(new URL(requests[0]?.url ?? "").pathname).toBe("/api/v1/providers");
    expect(new URL(requests[0]?.url ?? "").searchParams.get("limit")).toBe(String(LIST_PAGE_SIZE));
    expect(payload).toEqual(connectionPage());
  });

  it("asks for no more than the service allows in one page", () => {
    expect(LIST_PAGE_SIZE).toBe(100);
  });
});

describe("providers.add", () => {
  it("posts the body exactly as the dialog composed it", async () => {
    const { client, requests } = stubClient(() => ({ body: connection(), status: 201 }));

    await providers.add(VLLM, client);

    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.url).toBe("http://rest.test:4000/api/v1/providers");
    await expect(requests[0]?.json()).resolves.toEqual(VLLM);
  });

  it("returns the stored connection, masked, as the service answered it", async () => {
    const stored = connection({ kind: "openai_compatible", displayName: VLLM.displayName });
    const { client } = stubClient(() => ({ body: stored, status: 201 }));

    await expect(providers.add(VLLM, client)).resolves.toEqual(stored);
  });

  it("lets the provider's refusal through with its code and details intact", async () => {
    // The whole dialog rests on this: `details.detail` is the adapter's designed error, and
    // `details.errorClass` is how it finds the field it belongs under.
    const { client } = clientAnswering(
      {
        code: "provider_validation_failed",
        message: "The provider refused the configuration or credential.",
        details: { errorClass: "auth", detail: "key rejected (401)" },
      },
      422,
    );

    const failure = await providers.add(VLLM, client).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({
      status: 422,
      code: "provider_validation_failed",
      details: { errorClass: "auth", detail: "key rejected (401)" },
    });
  });

  it("lets a schema violation through keyed by field", async () => {
    const { client } = clientAnswering(
      {
        code: "provider_config_invalid",
        message: "The configuration does not satisfy the adapter's schema.",
        details: { fields: { baseUrl: ["must match format \"uri\""] } },
      },
      422,
    );

    await expect(providers.add(VLLM, client)).rejects.toMatchObject({
      code: "provider_config_invalid",
      details: { fields: { baseUrl: ["must match format \"uri\""] } },
    });
  });

  it("lets the role gate's refusal through as the service's 403", async () => {
    const { client } = clientAnswering(
      { code: "forbidden", message: "Your role does not permit this.", details: {} },
      403,
    );

    await expect(providers.add(VLLM, client)).rejects.toMatchObject({
      status: 403,
      code: "forbidden",
    });
  });
});

describe("providers.spend", () => {
  it("calls the month endpoint and returns the body itself", async () => {
    const { client, requests } = clientAnswering(seededSpend());

    const payload = await providers.spend(client);

    expect(requests[0]?.url).toBe("http://rest.test:4000/api/v1/providers/spend");
    expect(requests[0]?.method).toBe("GET");
    expect(requests[0]?.headers.get("X-Ouro-Tenant")).toBeNull();
    expect(payload).toEqual(seededSpend());
  });

  it("hands an unpriced row back null, never zero", async () => {
    // The card's *no metered spend* depends on the null surviving the trip.
    const { client } = clientAnswering(seededSpend());

    const payload = await providers.spend(client);

    expect(payload.providers.find((row) => row.kind === "ollama")?.spendCents).toBeNull();
  });
});

describe("providers.update", () => {
  it("PATCHes the one connection with only what changes", async () => {
    const stored = connection({ enabled: false });
    const { client, requests } = clientAnswering(stored);

    const payload = await providers.update(stored.id, { enabled: false }, client);

    expect(requests[0]?.url).toBe(`http://rest.test:4000/api/v1/providers/${stored.id}`);
    expect(requests[0]?.method).toBe("PATCH");
    expect(await requests[0]?.json()).toEqual({ enabled: false });
    expect(payload).toEqual(stored);
  });

  it("rejects with the service's own envelope for a role that may not write", async () => {
    const { client } = clientAnswering(
      { code: "forbidden", message: "Switching is for owners and admins.", details: {} },
      403,
    );

    await expect(providers.update(connection().id, { enabled: false }, client)).rejects.toMatchObject(
      { status: 403, code: "forbidden" },
    );
  });
});

describe("providers.reveal", () => {
  it("POSTs a password when given one, and returns the credential the service handed back", async () => {
    const revealed = {
      connectionId: connection().id,
      value: "sk-ant-api03-not-a-real-key-Xq4A",
      expiresAt: "2026-08-23T10:00:41.882Z",
    };
    const { client, requests } = clientAnswering(revealed);

    const payload = await providers.reveal(connection().id, { password: "hunter2" }, client);

    expect(requests[0]?.url).toBe(`http://rest.test:4000/api/v1/providers/${connection().id}/reveal`);
    expect(requests[0]?.method).toBe("POST");
    expect(await requests[0]?.json()).toEqual({ password: "hunter2" });
    expect(payload).toEqual(revealed);
  });

  it("POSTs an empty body when leaning on a recent session", async () => {
    const { client, requests } = clientAnswering({
      connectionId: connection().id,
      value: "x",
      expiresAt: "2026-08-23T10:00:41.882Z",
    });

    await providers.reveal(connection().id, {}, client);

    expect(await requests[0]?.json()).toEqual({});
  });

  it("lets the step-up challenge through with its methods and window intact", async () => {
    const { client } = clientAnswering(
      {
        code: "step_up_required",
        message: "confirm",
        details: { methods: ["session", "password"], maxAgeSeconds: 300 },
      },
      401,
    );

    await expect(providers.reveal(connection().id, {}, client)).rejects.toMatchObject({
      status: 401,
      code: "step_up_required",
      details: { methods: ["session", "password"], maxAgeSeconds: 300 },
    });
  });

  it("lets the rate limit through with its scope and retry-after", async () => {
    const { client } = clientAnswering(
      {
        code: "provider_reveal_rate_limited",
        message: "slow down",
        details: { scope: "connection", retryAfterSeconds: 240 },
      },
      429,
    );

    await expect(providers.reveal(connection().id, {}, client)).rejects.toMatchObject({
      status: 429,
      code: "provider_reveal_rate_limited",
    });
  });
});

describe("providers.rotate", () => {
  it("POSTs the new secret and returns the connection re-masked", async () => {
    const swapped = connection({ mask: "••••7Kd2" });
    const { client, requests } = clientAnswering(swapped);

    const payload = await providers.rotate(connection().id, "sk-new-7Kd2", client);

    expect(requests[0]?.url).toBe(`http://rest.test:4000/api/v1/providers/${connection().id}/rotate`);
    expect(requests[0]?.method).toBe("POST");
    expect(await requests[0]?.json()).toEqual({ secret: "sk-new-7Kd2" });
    expect(payload.mask).toBe("••••7Kd2");
  });

  it("lets the provider's rejection through with its error class and detail", async () => {
    const { client } = clientAnswering(
      {
        code: "provider_validation_failed",
        message: "refused",
        details: { errorClass: "auth", detail: "key rejected (401)" },
      },
      422,
    );

    await expect(providers.rotate(connection().id, "bad", client)).rejects.toMatchObject({
      status: 422,
      code: "provider_validation_failed",
      details: { detail: "key rejected (401)" },
    });
  });
});

describe("providers.remove", () => {
  it("DELETEs the one connection and resolves to nothing on the 204", async () => {
    const { client, requests } = stubClient(() => ({ body: undefined, status: 204 }));

    await expect(providers.remove(connection().id, client)).resolves.toBeUndefined();
    expect(requests[0]?.url).toBe(`http://rest.test:4000/api/v1/providers/${connection().id}`);
    expect(requests[0]?.method).toBe("DELETE");
  });

  it("lets the in-use refusal through with the dependent alias names", async () => {
    const { client } = clientAnswering(
      {
        code: "provider_connection_in_use",
        message: "still in use",
        details: { connectionId: connection().id, aliases: ["coder-max", "local-docs"] },
      },
      409,
    );

    await expect(providers.remove(connection().id, client)).rejects.toMatchObject({
      status: 409,
      code: "provider_connection_in_use",
      details: { aliases: ["coder-max", "local-docs"] },
    });
  });
});

describe("providers.aliases", () => {
  it("reads the registry's aliases and returns them", async () => {
    const { client, requests } = clientAnswering({ aliases: seededAliases() });

    const payload = await providers.aliases(client);

    expect(requests[0]?.url).toBe("http://rest.test:4000/api/v1/registry/aliases");
    expect(requests[0]?.method).toBe("GET");
    expect(payload).toEqual(seededAliases());
  });

  it("hands back an empty registry as an empty list", async () => {
    const { client } = clientAnswering({ aliases: [] });

    await expect(providers.aliases(client)).resolves.toEqual([]);
    // A sanity anchor on the fixture the delete guard leans on.
    expect(modelAlias().connection?.id).toBe("5eed000c-0000-4000-8000-000000000001");
  });
});

describe("providers.models (#230)", () => {
  it("reads the catalog from the providers collection, with its flags", async () => {
    const catalog = providerModels("5eed000c-0000-4000-8000-000000000004", anthropicModels(), [
      { modelId: "deepseek-v3.2", aliases: [{ id: "a", alias: "local-ds" }] },
    ]);
    const { client, requests } = clientAnswering(catalog);

    await expect(providers.models("5eed000c-0000-4000-8000-000000000004", client)).resolves.toEqual(catalog);
    expect(requests[0].method).toBe("GET");
    expect(requests[0].url).toBe(
      `${STUB_BASE_URL}/api/v1/providers/5eed000c-0000-4000-8000-000000000004/models`,
    );
  });
});

describe("providers.test (#230)", () => {
  it("POSTs with no body and hands the provider's answer back, down or not", async () => {
    const degraded = {
      connectionId: "5eed000c-0000-4000-8000-000000000003",
      checkedAt: "2026-08-25T10:00:12.004Z",
      status: "error",
      pill: { tone: "warn", label: "degraded upstream" },
      note: "503 upstream · retrying",
      latencyMs: null,
      errorClass: "upstream",
      retryable: true,
      detail: "503 upstream",
    };
    const { client, requests } = clientAnswering(degraded);

    await expect(providers.test("5eed000c-0000-4000-8000-000000000003", client)).resolves.toEqual(degraded);
    expect(requests[0].method).toBe("POST");
    expect(requests[0].url).toBe(
      `${STUB_BASE_URL}/api/v1/providers/5eed000c-0000-4000-8000-000000000003/test`,
    );
  });

  it("lets the service's refusal of the request through", async () => {
    const { client } = clientAnswering({ code: "provider_kind_unsupported", message: "no", details: {} }, 501);

    await expect(providers.test("5eed000c-0000-4000-8000-000000000003", client)).rejects.toMatchObject({
      status: 501,
      code: "provider_kind_unsupported",
    });
  });
});

describe("providers.discover (#230)", () => {
  it("POSTs and hands the catalog back with what changed", async () => {
    const discovery = {
      ...providerModels("5eed000c-0000-4000-8000-000000000004", anthropicModels()),
      added: ["claude-fable-5"],
      removed: [],
    };
    const { client, requests } = clientAnswering(discovery);

    await expect(providers.discover("5eed000c-0000-4000-8000-000000000004", client)).resolves.toEqual(
      discovery,
    );
    expect(requests[0].method).toBe("POST");
    expect(requests[0].url).toBe(
      `${STUB_BASE_URL}/api/v1/providers/5eed000c-0000-4000-8000-000000000004/discover`,
    );
  });

  it("lets a provider that did not answer through with its class and phrase", async () => {
    const { client } = clientAnswering(
        {
          code: "provider_discovery_failed",
          message: "no",
          details: { errorClass: "network", detail: "unreachable (ECONNREFUSED)" },
        },
        502,
      );

    await expect(providers.discover("5eed000c-0000-4000-8000-000000000004", client)).rejects.toMatchObject({
      status: 502,
      code: "provider_discovery_failed",
      details: { errorClass: "network", detail: "unreachable (ECONNREFUSED)" },
    });
  });
});

describe("providers.pull and providers.pulls (#230)", () => {
  it("POSTs the model and hands the record back", async () => {
    const record = pullRecord({ state: "running", status: "starting", percent: null });
    const { client, requests } = clientAnswering(record, 202);

    await expect(providers.pull(record.connectionId, "llama4:scout", client)).resolves.toEqual(record);
    expect(requests[0].method).toBe("POST");
    expect(requests[0].url).toBe(`${STUB_BASE_URL}/api/v1/providers/${record.connectionId}/pulls`);
    expect(await requests[0].json()).toEqual({ modelId: "llama4:scout" });
  });

  it("reads every pull on a connection", async () => {
    const answer = { connectionId: pullRecord().connectionId, pulls: [pullRecord()] };
    const { client, requests } = clientAnswering(answer);

    await expect(providers.pulls(answer.connectionId, client)).resolves.toEqual(answer);
    expect(requests[0].method).toBe("GET");
    expect(requests[0].url).toBe(`${STUB_BASE_URL}/api/v1/providers/${answer.connectionId}/pulls`);
  });

  it("lets the cannot-pull refusal through", async () => {
    const { client } = clientAnswering({ code: "provider_kind_cannot_pull", message: "no", details: {} }, 422);

    await expect(providers.pull(pullRecord().connectionId, "x", client)).rejects.toMatchObject({
      code: "provider_kind_cannot_pull",
    });
  });
});
