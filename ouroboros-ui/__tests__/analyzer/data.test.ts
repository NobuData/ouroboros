import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Workspace } from "@/app/api/access";
import { ApiError } from "@/app/api/errors";
import type { Role } from "@/app/api/membership";

import { membership, sessionUser } from "../helpers/login";
import { writableCatalog } from "../helpers/planning";
import { SEEDED_GITHUB_ID, SEEDED_JIRA_ID, seededSources } from "../helpers/sources";

/**
 * What the analyzer route reads on the server (#516, #518, #519): the workspace's enabled
 * repositories; from the reader's roles, what the page may offer them — running an analysis,
 * applying, drafting and pushing (an owner's or admin's), and dismissing a suggestion or ticking a
 * drafted ticket (a member's too); and the workspace's trackers, as the planning page's segment
 * draws them.
 */

vi.mock("server-only", () => ({}));

const readEnablement = vi.fn();
const listSources = vi.fn();
const readCatalog = vi.fn();

vi.mock("@/app/api/enablement", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/api/enablement")>()),
  readEnablement: (tenantId: string) => readEnablement(tenantId),
}));

vi.mock("@/app/api/sources", () => ({
  sources: { list: () => listSources(), catalog: () => readCatalog() },
}));

const { readAnalyzer } = await import("@/app/analyzer/data");

/**
 * What the gate hands back, for a reader holding these roles.
 *
 * @param roles The roles.
 * @returns The workspace.
 */
function access(roles: Role[]): Workspace {
  return {
    session: { user: sessionUser(), memberships: [membership({ roles })], tenantSuggestion: null },
    membership: membership({ roles }),
  } as unknown as Workspace;
}

beforeEach(() => {
  readEnablement.mockReset().mockResolvedValue({ orgs: [] });
  listSources.mockReset().mockResolvedValue({ items: seededSources(), pollIntervalSeconds: 30 });
  readCatalog.mockReset().mockResolvedValue(writableCatalog());
});

describe("readAnalyzer", () => {
  it.each([
    [["owner"], true, true],
    [["admin"], true, true],
    [["member"], false, true],
    [["viewer"], false, false],
    [[], false, false],
    [["viewer", "member"], false, true],
  ] as const)("for %j: may administer %s, may dismiss %s", async (roles, mayAdminister, mayDismiss) => {
    const readings = await readAnalyzer(access([...roles]), () => 42);

    // Ticking a drafted ticket is the planning page's rule for the same checkbox: a member's too.
    expect(readings).toMatchObject({ mayAdminister, mayDismiss, mayContribute: mayDismiss, readAt: 42 });
  });

  it("reads the workspace's enablement, and keeps a refusal as a reason rather than a blank page", async () => {
    const workspace = access(["owner"]);

    expect((await readAnalyzer(workspace)).repos).toEqual({ ok: true, value: [] });
    expect(readEnablement).toHaveBeenCalledExactlyOnceWith(workspace.membership.id);

    readEnablement.mockRejectedValue(new ApiError(403, "forbidden", "Not yours."));

    expect((await readAnalyzer(workspace)).repos).toEqual({ ok: false, reason: "Not yours." });
  });

  it("reads the workspace's trackers as the planning page's segment draws them (#519)", async () => {
    const { trackers } = await readAnalyzer(access(["owner"]));

    expect(trackers.ok).toBe(true);
    if (!trackers.ok) return;

    const github = trackers.value.find((option) => option.sourceId === SEEDED_GITHUB_ID);
    const jira = trackers.value.find((option) => option.sourceId === SEEDED_JIRA_ID);

    // The writable one may be chosen; the other is there, disabled, with why.
    expect(github).toMatchObject({ kind: "github", label: "GitHub Issues", pushName: "GitHub" });
    expect(github?.reason).toBeUndefined();
    expect(jira?.reason).toEqual(expect.any(String));
  });

  it("disables every tracker with the reason when the catalog cannot be read, and none is offered", async () => {
    readCatalog.mockRejectedValue(new ApiError(502, "upstream", "The catalog could not be read."));

    const { trackers } = await readAnalyzer(access(["owner"]));

    expect(trackers.ok && trackers.value.every((option) => option.reason !== undefined)).toBe(true);
  });

  it("keeps a refused sources read as a reason — the page is drawn, and says the trackers were not read", async () => {
    listSources.mockRejectedValue(new ApiError(403, "forbidden", "Not yours."));

    const readings = await readAnalyzer(access(["owner"]));

    expect(readings.trackers).toEqual({ ok: false, reason: "Not yours." });
    expect(readings.repos).toEqual({ ok: true, value: [] });
  });
});
