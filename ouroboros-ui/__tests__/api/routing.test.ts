import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
// Types only, so this import is erased and nothing loads before the mocks below.
import type { ProviderHealthStrip } from "@/app/api/routing";

import { clientAnswering } from "../helpers/api";
import { seededProviders, stripPayload } from "../helpers/models";

// The facade sits on the server-side client — see `server.test.ts` for what each of these
// three answers.
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { routing } = await import("@/app/api/routing");

/**
 * The provider health strip's read (#196, consumed by #200).
 *
 * One `GET` with no parameters, so most of what is worth holding is about what this module
 * does *not* do — it names no workspace, it triggers no check, and it hands back what the
 * service composed rather than recomposing it — and about the one property the whole page's
 * honesty rests on: **an absent measurement survives the crossing as `null`.**
 */

/** The refusal a screen behind the gate can still meet: a session acting in no workspace. */
const NO_ORGANIZATION = {
  code: "organization_required",
  message: "Choose a workspace before opening model routing.",
  details: {},
};

describe("routing.providers", () => {
  it("calls the strip endpoint and returns the body itself", async () => {
    const { client, requests } = clientAnswering(stripPayload());

    const payload = await routing.providers(client);

    expect(requests[0]?.url).toBe("http://rest.test:4000/api/v1/routing/providers");
    expect(requests[0]?.method).toBe("GET");
    expect(payload).toEqual(stripPayload());
  });

  it("reads the strip in one request and asks for nothing else", async () => {
    const { client, requests } = clientAnswering(stripPayload());

    await routing.providers(client);

    expect(requests).toHaveLength(1);
  });

  it("triggers no check — the only verb it uses is GET", async () => {
    // A *check now* button would let anybody holding a session make `ouroboros-rest` issue
    // outbound requests at whatever rate they can click, against a vendor's rate limit and
    // signed with the workspace's own credential. The cadence is the service's scheduler's.
    const { client, requests } = clientAnswering(stripPayload());

    await routing.providers(client);

    expect(requests.map((request) => request.method)).toEqual(["GET"]);
    expect(Object.keys(routing)).toEqual(["providers"]);
  });

  it("names no workspace, because the session's active organization is the scope", async () => {
    // There is no workspace in this path and this application sends no `X-Ouro-Tenant`
    // override (`app/api/server.ts`). A header here would be a second opinion about tenancy.
    const { client, requests } = clientAnswering(stripPayload());

    await routing.providers(client);

    expect(requests[0]?.headers.get("X-Ouro-Tenant")).toBeNull();
    expect(new URL(requests[0]!.url).search).toBe("");
  });

  it("reads a workspace with no providers as an empty strip rather than a failure", async () => {
    // The page's empty state. A workspace part-way through setting itself up has connected
    // nothing, and that is a state the product guides out of rather than an error.
    const { client } = clientAnswering(stripPayload([]));

    const payload = await routing.providers(client);

    expect(payload.providers).toEqual([]);
  });

  it("carries an absent measurement across as null rather than as a number", async () => {
    // The property the whole strip's honesty rests on, asserted at the boundary it could be
    // lost at. `0ms` is an excellent latency for a provider nothing has ever called, so a
    // client that supplied one here would be inventing the product's one claim about the
    // outside world.
    const { client } = clientAnswering(stripPayload(seededProviders()));

    const payload = await routing.providers(client);
    const cursor = payload.providers.find((row) => row.displayName === "Cursor");

    expect(cursor?.latencyMs).toBeNull();
    expect(cursor?.models).toBeNull();
    expect(cursor?.meta).toBeNull();
    expect(cursor?.checkedAt).not.toBeNull();
  });

  it("rejects with the service's envelope rather than swallowing it", async () => {
    const { client } = clientAnswering(NO_ORGANIZATION, 400);

    const caught: unknown = await routing.providers(client).catch((e: unknown) => e);

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).code).toBe("organization_required");
    expect((caught as ApiError).status).toBe(400);
  });

  it("carries a message written for a person, naming nothing about the service", async () => {
    // It reaches the strip's place on the page as the reason it is empty, so it is read by
    // whoever opened the page.
    const { client } = clientAnswering(NO_ORGANIZATION, 400);

    const caught = (await routing.providers(client).catch((e: unknown) => e)) as ApiError;

    expect(caught.message).toBe(NO_ORGANIZATION.message);
    expect(caught.message).not.toMatch(/http|:\d{2,5}|ECONN|select /i);
  });
});

describe("the typing, which is the reason the client is generated", () => {
  it("types the strip end to end", async () => {
    const { client } = clientAnswering(stripPayload());

    const payload: ProviderHealthStrip = await routing.providers(client);

    expect(payload.providers).toHaveLength(5);
    expect(payload.providers[0]?.latencyMs).toBe(42);
  });

  it("holds a chip to the eleven fields the strip draws from", () => {
    // A twelfth would be a fact nobody rendered; a missing one is a compile error in
    // `app/models/view.ts` rather than an `undefined` printed on a chip.
    expect(Object.keys(seededProviders()[0]!).sort()).toEqual([
      "check",
      "checkedAt",
      "detail",
      "displayName",
      "host",
      "id",
      "kind",
      "latencyMs",
      "meta",
      "models",
      "status",
    ]);
  });
});
