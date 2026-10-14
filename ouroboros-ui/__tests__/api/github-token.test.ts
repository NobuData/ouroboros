import { describe, expect, it, vi } from "vitest";

import { STUB_BASE_URL, clientAnswering } from "../helpers/api";
import { NO_BACKLOG_TOKEN, backlogToken } from "../helpers/sources";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { githubToken } = await import("@/app/api/github-token");

/**
 * The workspace's backlog token ([#1250](https://github.com/NobuData/ouroboros/issues/1250)):
 * three operations on one address, each answering the masked state.
 */

const ADDRESS = `${STUB_BASE_URL}/api/v1/settings/github-token`;

describe("githubToken", () => {
  it("reads the token's state", async () => {
    const { client, requests } = clientAnswering(backlogToken());

    expect(await githubToken.read(client)).toEqual(backlogToken());
    expect(requests[0]?.url).toBe(ADDRESS);
    expect(requests[0]?.method).toBe("GET");
  });

  it("stores a token in the body, and nowhere in the address", async () => {
    const { client, requests } = clientAnswering(backlogToken());

    expect(await githubToken.set("ghp_typed", client)).toEqual(backlogToken());
    expect(requests[0]?.url).toBe(ADDRESS);
    expect(requests[0]?.method).toBe("PUT");
    expect(await requests[0]?.json()).toEqual({ token: "ghp_typed" });
  });

  it("removes the token", async () => {
    const { client, requests } = clientAnswering(NO_BACKLOG_TOKEN);

    expect(await githubToken.clear(client)).toEqual(NO_BACKLOG_TOKEN);
    expect(requests[0]?.url).toBe(ADDRESS);
    expect(requests[0]?.method).toBe("DELETE");
  });
});
