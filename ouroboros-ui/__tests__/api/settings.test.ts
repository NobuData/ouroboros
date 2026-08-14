import { describe, expect, it, vi } from "vitest";

// Types only, so this import is erased and nothing loads before the mocks below.
import type { AutoMergeSetting } from "@/app/api/settings";

import { clientAnswering } from "../helpers/api";

// The facade sits on the server-side client, so importing it pulls in the same three
// server-only modules `server.test.ts` answers. Nothing here calls the wired client —
// every case passes its own — but the mocks have to exist for the import to succeed.
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { FORBIDDEN_ROLE_CODE, autoMerge } = await import("@/app/api/settings");

/**
 * The auto-merge setting ([#74](https://github.com/NobuData/ouroboros/issues/74)) — the
 * dashboard's one mutation, as a resource file.
 *
 * The `preferences.ts` pattern, and held to the same two kinds of truth: the behaviour (the
 * right path, the right verb, the body returned rather than the envelope around it) and the
 * compile — the `@ts-expect-error` below fails `yarn typecheck` if the contract's body shape
 * ever stops being a boolean.
 */

/** The setting as an administrator who has switched it on reads it back. */
const ON: AutoMergeSetting = {
  enabled: true,
  updatedAt: "2026-08-13T09:00:00.000Z",
  updatedBy: "aBcD1234eFgH5678iJkL9012mNoP3456",
};

/** The setting a workspace that has never chosen reads: `false`, with both stamps null. */
const NEVER_CHOSEN: AutoMergeSetting = {
  enabled: false,
  updatedAt: null,
  updatedBy: null,
};

describe("autoMerge.read", () => {
  it("calls the read operation and returns the setting itself", async () => {
    const { client, requests } = clientAnswering(ON);

    const setting = await autoMerge.read(client);

    expect(requests[0]?.url).toBe("http://rest.test:4000/api/v1/settings/auto-merge");
    expect(requests[0]?.method).toBe("GET");
    expect(setting).toEqual(ON);
  });

  it("reads a workspace that has never chosen as off, stamps and all", async () => {
    // The stamps are how a client tells a chosen `false` from a default one, so the facade
    // must hand them through rather than reducing the answer to its boolean.
    const { client } = clientAnswering(NEVER_CHOSEN);

    expect(await autoMerge.read(client)).toEqual(NEVER_CHOSEN);
  });
});

describe("autoMerge.set", () => {
  it("PATCHes the position to move to and returns the setting as it now stands", async () => {
    const { client, requests } = clientAnswering(ON);

    const setting = await autoMerge.set(true, client);

    expect(requests[0]?.url).toBe("http://rest.test:4000/api/v1/settings/auto-merge");
    expect(requests[0]?.method).toBe("PATCH");
    expect(await requests[0]?.json()).toEqual({ enabled: true });
    expect(setting).toEqual(ON);
  });

  it("sends a switch being turned off as exactly that", async () => {
    // `false` is a position, not an absence: a facade that dropped it would send `{}`, which
    // the contract reads as "change nothing".
    const { client, requests } = clientAnswering(NEVER_CHOSEN);

    await autoMerge.set(false, client);

    expect(await requests[0]?.json()).toEqual({ enabled: false });
  });

  it("throws the contract's refusal when a role may look but not change", async () => {
    // The gate that decides is the service's; this is the shape it arrives in.
    const { client } = clientAnswering(
      { code: FORBIDDEN_ROLE_CODE, message: "Only an owner or an admin may do that.", details: {} },
      403,
    );

    await expect(autoMerge.set(true, client)).rejects.toMatchObject({
      status: 403,
      code: FORBIDDEN_ROLE_CODE,
    });
  });

  it("refuses a position the contract does not name, at compile time", async () => {
    const { client } = clientAnswering(ON);

    // @ts-expect-error — the switch takes a boolean; if a string compiles, the schema drifted.
    const attempt: Promise<AutoMergeSetting> = autoMerge.set("true", client);

    await expect(attempt).resolves.toEqual(ON);
  });
});
