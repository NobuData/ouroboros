import { describe, expect, it, vi } from "vitest";

// Types only, so this import is erased and nothing loads before the mocks below.
import type { Preferences } from "@/app/api/preferences";

import { clientAnswering } from "../helpers/api";

// The facade sits on the server-side client, so importing it pulls in the same three
// server-only modules `server.test.ts` answers. Nothing here calls the wired client —
// every case passes its own — but the mocks have to exist for the import to succeed.
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { preferences } = await import("@/app/api/preferences");

/**
 * The preferences resource (#649) — the `tenants.ts` pattern at its smallest, held to the
 * same two kinds of truth: the behaviour (the right path, the body returned rather than
 * the envelope around it) and the compile (`@ts-expect-error` below fails `yarn typecheck`
 * if a step outside the five ever starts compiling).
 */

/** The surface, as the contract describes it — a reader at 125%. */
const AT_125: Preferences = { fontScale: "125" };

describe("preferences.read", () => {
  it("calls the read operation and returns the surface itself", async () => {
    const { client, requests } = clientAnswering(AT_125);

    const surface = await preferences.read(client);

    expect(requests[0]?.url).toBe("http://rest.test:4000/api/v1/me/preferences");
    expect(requests[0]?.method).toBe("GET");
    expect(surface).toEqual(AT_125);
  });
});

describe("preferences.update", () => {
  it("PATCHes what changed and returns the surface as it now stands", async () => {
    const { client, requests } = clientAnswering(AT_125);

    const surface = await preferences.update({ fontScale: "125" }, client);

    expect(requests[0]?.url).toBe("http://rest.test:4000/api/v1/me/preferences");
    expect(requests[0]?.method).toBe("PATCH");
    expect(await requests[0]?.json()).toEqual({ fontScale: "125" });
    expect(surface).toEqual(AT_125);
  });

  it("sends an empty patch as exactly that", async () => {
    // `{}` is the contract's "change nothing, read it back" — the facade must not invent
    // a field for it.
    const { client, requests } = clientAnswering(AT_125);

    await preferences.update({}, client);

    expect(await requests[0]?.json()).toEqual({});
  });

  it("refuses a step the contract does not name, at compile time", async () => {
    const { client } = clientAnswering(AT_125);

    // @ts-expect-error — "90" is not a FontScale; if this compiles, the schema drifted.
    const attempt: Promise<Preferences> = preferences.update({ fontScale: "90" }, client);

    await expect(attempt).resolves.toEqual(AT_125);
  });
});
