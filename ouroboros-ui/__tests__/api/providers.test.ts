import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
// Types only, so this import is erased and nothing loads before the mocks below.
import type { ProviderConnectionCreate } from "@/app/api/providers";

import { clientAnswering, stubClient } from "../helpers/api";
import { catalogPayload, connection, connectionPage } from "../helpers/providers";

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
