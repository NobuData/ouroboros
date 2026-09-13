import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Workspace } from "@/app/api/access";
import { ApiError } from "@/app/api/errors";

import { TENANT_ID, membership, sessionUser } from "../helpers/login";
import { READ_AT, seededRail, workflowDetail } from "../helpers/workflows";

/**
 * The studio's reader (#147).
 *
 * Two calls, the second depending on the first, and the suite is about the four properties
 * that hold across them: **a refused read is a value rather than a throw**, **anything that is
 * not a refusal keeps travelling** — which is what keeps a session that expired mid-render from
 * being drawn as an empty page instead of reaching the login screen — **one failed read is one
 * degraded region**, and **the slug is resolved against the rail**, so a workflow the workspace
 * does not have costs no request.
 */

vi.mock("server-only", () => ({}));

/** What the rail endpoint answers this case with, or the signal it throws instead. */
const list = vi.fn();

/** What the workflow endpoint answers this case with, keyed by the id it was asked for. */
const read = vi.fn();

vi.mock("@/app/api/workflows", () => ({
  workflows: { list: () => list(), read: (id: string) => read(id) },
}));

const { readStudio } = await import("@/app/workflows/data");

/**
 * The workspace the gate hands over.
 *
 * Typed as the gate's own return, deliberately: nothing off it is read, so the only thing
 * keeping this argument honest is that it has to satisfy `Workspace` — which is the whole
 * reason the reader takes one.
 */
const ACCESS: Workspace = {
  session: {
    user: sessionUser(),
    memberships: [membership()],
    membershipTotal: 1,
    activeOrganizationId: TENANT_ID,
    tenantSuggestion: null,
  },
  membership: membership(),
};

/** The instant every case reads at. */
const NOW = new Date(READ_AT);

beforeEach(() => {
  list.mockReset().mockResolvedValue(seededRail());
  read.mockReset().mockResolvedValue(workflowDetail());
});

describe("the landing, which names no workflow", () => {
  it("opens on the rail's first entry, and reads it by its id", async () => {
    // The way the mockup opens on `standard-fix`: the sidebar's entry leads here, and a landing
    // with nothing selected would make every visit two presses.
    const readings = await readStudio(ACCESS, null, NOW);

    expect(read).toHaveBeenCalledExactlyOnceWith(seededRail()[0]!.id);
    expect(readings.requested).toBeNull();
    expect(readings.selected).toEqual({
      entry: seededRail()[0],
      detail: { ok: true, value: workflowDetail() },
    });
  });

  it("stamps the instant it was read, so every *ago* on the page measures from one clock", async () => {
    const readings = await readStudio(ACCESS, null, NOW);

    expect(readings.now).toBe(READ_AT);
  });

  it("hands the rail across as served", async () => {
    const readings = await readStudio(ACCESS, null, NOW);

    expect(readings.rail).toEqual({ ok: true, value: seededRail() });
  });
});

describe("a named workflow", () => {
  it("resolves the slug against the rail and reads that workflow's id", async () => {
    // The endpoint takes an id and the URL carries a slug; the rail is the bridge, and it is the
    // only listing the contract offers.
    const readings = await readStudio(ACCESS, "docs-loop", NOW);

    expect(read).toHaveBeenCalledExactlyOnceWith(seededRail()[3]!.id);
    expect(readings.requested).toBe("docs-loop");
    expect(readings.selected?.entry.slug).toBe("docs-loop");
  });

  it("answers a slug the rail does not hold from the rail, without a request", async () => {
    // A URL is input. A slug the workspace does not have never reaches the service — and never
    // reaches a URL of its own.
    const readings = await readStudio(ACCESS, "gone", NOW);

    expect(read).not.toHaveBeenCalled();
    expect(readings.requested).toBe("gone");
    expect(readings.selected).toBeNull();
    expect(readings.rail.ok).toBe(true);
  });
});

describe("a workspace with no workflows", () => {
  it("reads an empty rail as an answer, selects nothing, and asks for nothing more", async () => {
    list.mockResolvedValue([]);

    const readings = await readStudio(ACCESS, null, NOW);

    expect(readings.rail).toEqual({ ok: true, value: [] });
    expect(readings.selected).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });
});

describe("a refused read", () => {
  it("keeps a refused rail as a value, and reads no workflow behind it", async () => {
    // There is nothing to select from, so the second read is not attempted — and the reason
    // travels as a value the banner can print.
    list.mockRejectedValue(new ApiError(500, "internal_error", "The service failed.", {}));

    const readings = await readStudio(ACCESS, "standard-fix", NOW);

    expect(readings.rail).toEqual({ ok: false, reason: "The service failed." });
    expect(readings.selected).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it("keeps a refused workflow as a value, with the rail standing beside it", async () => {
    // One failed read is one degraded region: the rail, and the entry's own facts, survive.
    read.mockRejectedValue(new ApiError(404, "workflow_not_found", "No such workflow.", {}));

    const readings = await readStudio(ACCESS, "standard-fix", NOW);

    expect(readings.rail.ok).toBe(true);
    expect(readings.selected).toEqual({
      entry: seededRail()[0],
      detail: { ok: false, reason: "No such workflow." },
    });
  });

  it("lets anything that is not a refusal keep travelling, from either read", async () => {
    // Next.js's redirect signal above all.
    list.mockRejectedValue(new Error("NEXT_REDIRECT /login"));
    await expect(readStudio(ACCESS, null, NOW)).rejects.toThrow("NEXT_REDIRECT /login");

    list.mockResolvedValue(seededRail());
    read.mockRejectedValue(new Error("NEXT_REDIRECT /login"));
    await expect(readStudio(ACCESS, null, NOW)).rejects.toThrow("NEXT_REDIRECT /login");
  });
});
