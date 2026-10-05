import { describe, expect, it, vi } from "vitest";

import { clientAnswering } from "../helpers/api";
import { POLICY_V7, VERSION_6, VERSION_7, orgPolicyV7, policyPreview } from "../helpers/org-policy";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { orgPolicy } = await import("@/app/api/org-policy");

/**
 * The org policy's operations (BS.4 #494 over BQ.2 #481): each calls its own route under
 * `/api/v1/policies`, sending exactly what it was given.
 */

/**
 * The method, path and query of the one request a call made.
 *
 * @param requests The requests the stub saw.
 * @returns `METHOD /path?query`.
 */
function sent(requests: Request[]): string {
  expect(requests).toHaveLength(1);
  const url = new URL(requests[0].url);

  return `${requests[0].method} ${url.pathname}${url.search}`;
}

describe("orgPolicy", () => {
  it("reads the version in force", async () => {
    const { client, requests } = clientAnswering(orgPolicyV7());

    expect(await orgPolicy.read(client)).toEqual(orgPolicyV7());
    expect(sent(requests)).toBe("GET /api/v1/policies");
  });

  it("reads the newest page of versions with no cursor", async () => {
    const page = { items: [VERSION_7, VERSION_6], nextBefore: 6 };
    const { client, requests } = clientAnswering(page);

    expect(await orgPolicy.versions(undefined, client)).toEqual(page);
    expect(sent(requests)).toBe("GET /api/v1/policies/versions");
  });

  it("reads an older page from the previous page's cursor", async () => {
    const { client, requests } = clientAnswering({ items: [], nextBefore: null });

    await orgPolicy.versions(6, client);

    expect(sent(requests)).toBe("GET /api/v1/policies/versions?before=6");
  });

  it("previews a draft, sending the document and nothing else", async () => {
    const { client, requests } = clientAnswering(policyPreview());

    expect(await orgPolicy.preview(POLICY_V7, client)).toEqual(policyPreview());
    expect(sent(requests)).toBe("POST /api/v1/policies/preview");
    expect(await requests[0].json()).toEqual({ document: POLICY_V7 });
  });

  it("publishes against the version the edit began from, with its note", async () => {
    const { client, requests } = clientAnswering({ version: 8, summary: "changed spend guard (policy v8)" });

    await orgPolicy.publish({ document: POLICY_V7, baseVersion: 7, changeNote: "Lower the cap" }, client);

    expect(sent(requests)).toBe("POST /api/v1/policies");
    expect(await requests[0].json()).toEqual({
      document: POLICY_V7,
      baseVersion: 7,
      changeNote: "Lower the cap",
    });
  });

  it("asks what a list of globs matches", async () => {
    const { client, requests } = clientAnswering({ repositories: [] });

    expect(await orgPolicy.pathPreview(["boot/**", "keys/**"], client)).toEqual({ repositories: [] });
    expect(sent(requests)).toBe("POST /api/v1/policies/path-preview");
    expect(await requests[0].json()).toEqual({ globs: ["boot/**", "keys/**"] });
  });
});
