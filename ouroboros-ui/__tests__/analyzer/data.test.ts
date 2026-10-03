import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Workspace } from "@/app/api/access";
import { ApiError } from "@/app/api/errors";
import type { Role } from "@/app/api/membership";

import { membership, sessionUser } from "../helpers/login";

/**
 * What the analyzer route reads on the server (#516, #518): the workspace's enabled repositories
 * and, from the reader's roles, the two things the page may offer them — running an analysis and
 * applying (an owner's or admin's), and dismissing a suggestion (a member's too).
 */

vi.mock("server-only", () => ({}));

const readEnablement = vi.fn();

vi.mock("@/app/api/enablement", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/api/enablement")>()),
  readEnablement: (tenantId: string) => readEnablement(tenantId),
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

    expect(readings).toMatchObject({ mayAdminister, mayDismiss, readAt: 42 });
  });

  it("reads the workspace's enablement, and keeps a refusal as a reason rather than a blank page", async () => {
    const workspace = access(["owner"]);

    expect((await readAnalyzer(workspace)).repos).toEqual({ ok: true, value: [] });
    expect(readEnablement).toHaveBeenCalledExactlyOnceWith(workspace.membership.id);

    readEnablement.mockRejectedValue(new ApiError(403, "forbidden", "Not yours."));

    expect((await readAnalyzer(workspace)).repos).toEqual({ ok: false, reason: "Not yours." });
  });
});
