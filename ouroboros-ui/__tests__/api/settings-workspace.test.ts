import { describe, expect, it, vi } from "vitest";

import { clientAnswering } from "../helpers/api";
import { retentionSettings, workspaceSettings } from "../helpers/workspace";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { settingsWorkspace } = await import("@/app/api/settings-workspace");

/**
 * The Workspace card's operations (#492 over #483 and #482): each reads or writes its own
 * resource under `/api/v1/settings`, sending exactly the body it was given.
 */

/**
 * The method and path of the one request a call made.
 *
 * @param requests The requests the stub saw.
 * @returns `METHOD /path`.
 */
function sent(requests: Request[]): string {
  expect(requests).toHaveLength(1);
  return `${requests[0].method} ${new URL(requests[0].url).pathname}`;
}

describe("settingsWorkspace", () => {
  it("reads the workspace card", async () => {
    const { client, requests } = clientAnswering(workspaceSettings());

    expect(await settingsWorkspace.read(client)).toEqual(workspaceSettings());
    expect(sent(requests)).toBe("GET /api/v1/settings/workspace");
  });

  it("patches the name and domain, sending only what it was given", async () => {
    const { client, requests } = clientAnswering(workspaceSettings());

    await settingsWorkspace.update({ domain: "acme.example.com" }, client);

    expect(sent(requests)).toBe("PATCH /api/v1/settings/workspace");
    expect(await requests[0].json()).toEqual({ domain: "acme.example.com" });
  });

  it("reads the retention tiers", async () => {
    const { client, requests } = clientAnswering(retentionSettings());

    expect(await settingsWorkspace.retention(client)).toEqual(retentionSettings());
    expect(sent(requests)).toBe("GET /api/v1/settings/retention");
  });

  it("patches the tiers", async () => {
    const { client, requests } = clientAnswering(retentionSettings());

    await settingsWorkspace.updateRetention({ classes: { audit: 730 } }, client);

    expect(sent(requests)).toBe("PATCH /api/v1/settings/retention");
    expect(await requests[0].json()).toEqual({ classes: { audit: 730 } });
  });
});
