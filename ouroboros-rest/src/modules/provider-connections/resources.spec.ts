import { connectionRow, FIXTURE_MASK } from "./connection.fixture";
import { connectionResource } from "./resources";

/**
 * Row → resource: the vocabulary change, and the three absences that are the point.
 *
 * `null` is a value everywhere it appears here and never a placeholder, so each of the three
 * has its own assertion — a client that rendered `monthlyCapCents: null` as `0`, or
 * `lastUsedAt: null` as *unknown*, would be rendering something this API did not say.
 */

describe("one connection as a client sees it", () => {
  it("renames the row's columns into the contract's vocabulary", () => {
    expect(connectionResource(connectionRow(), FIXTURE_MASK)).toEqual({
      id: "5eed000c-0000-4000-8000-000000000001",
      kind: "anthropic",
      displayName: "Anthropic Claude",
      baseUrl: null,
      capabilityNote: "api.anthropic.com · primary coding lane",
      status: "active",
      enabled: true,
      monthlyCapCents: 60_000,
      mask: "••••Xq4A",
      addedBy: "5eed0003-0000-4000-8000-000000000001",
      lastCheckedAt: "2026-08-23T09:59:41.882Z",
      lastUsedAt: "2026-08-23T09:57:12.004Z",
      createdAt: "2026-06-12T16:20:00.000Z",
      updatedAt: "2026-08-23T09:59:41.882Z",
    });
  });

  it("renders every instant as ISO 8601", () => {
    const resource = connectionResource(connectionRow(), null);

    for (const value of [resource.createdAt, resource.updatedAt, resource.lastCheckedAt]) {
      expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }
  });

  describe("the absences", () => {
    it("keeps `mask` null for a provider that needs no credential", () => {
      // A local daemon, or an unauthenticated endpoint. V015 makes it an ordinary state
      // rather than an unfinished row, and the resource says so rather than inventing bullets
      // for a credential that does not exist.
      expect(connectionResource(connectionRow({ kind: "ollama" }), null).mask).toBeNull();
    });

    it("keeps `monthlyCapCents` null for *no cap*, which is not zero", () => {
      expect(
        connectionResource(connectionRow({ monthly_cap_cents: null }), null).monthlyCapCents,
      ).toBeNull();
      expect(
        connectionResource(connectionRow({ monthly_cap_cents: 0 }), null).monthlyCapCents,
      ).toBe(0);
    });

    it("keeps `lastUsedAt` null for *never used* rather than borrowing another stamp", () => {
      expect(connectionResource(connectionRow({ last_used_at: null }), null).lastUsedAt).toBeNull();
    });

    it("keeps `lastCheckedAt` null until something has checked", () => {
      expect(
        connectionResource(connectionRow({ last_checked_at: null }), null).lastCheckedAt,
      ).toBeNull();
    });

    it("keeps `addedBy` null when nobody in this installation added it", () => {
      expect(connectionResource(connectionRow({ added_by: null }), null).addedBy).toBeNull();
    });
  });

  describe("what the shape cannot carry", () => {
    it("has exactly fourteen fields, and none of them is a credential", () => {
      // The structural half of *the full value is not in the payload*: the builder takes no
      // envelope and no plaintext, so there is no path by which one reaches a list.
      const resource = connectionResource(connectionRow(), FIXTURE_MASK);

      expect(Object.keys(resource).sort()).toEqual([
        "addedBy",
        "baseUrl",
        "capabilityNote",
        "createdAt",
        "displayName",
        "enabled",
        "id",
        "kind",
        "lastCheckedAt",
        "lastUsedAt",
        "mask",
        "monthlyCapCents",
        "status",
        "updatedAt",
      ]);
    });
  });
});
