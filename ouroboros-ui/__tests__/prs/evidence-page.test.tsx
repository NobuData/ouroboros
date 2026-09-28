import { beforeEach, describe, expect, it, vi } from "vitest";

import { PR_514_ID, evidenceId } from "../helpers/pull-requests";
import { membership, sessionUser } from "../helpers/login";

/**
 * `/prs/:id/evidence/:evidenceId` (#366): the gate first, then a redirect to the cited row — or
 * the not-found page for a citation that cannot be resolved.
 */

const requireWorkspace = vi.fn();
const evidenceTargetPath = vi.fn();

/** What `notFound()` throws, so the case can see it was called. */
class NotFound extends Error {}

/** What `redirect()` throws, carrying where to. */
class Redirect extends Error {}

vi.mock("@/app/api/access", () => ({ requireWorkspace: () => requireWorkspace() }));
vi.mock("@/app/prs/evidence-target", () => ({
  evidenceTargetPath: (prId: string, evidence: string, from: string | undefined) =>
    evidenceTargetPath(prId, evidence, from),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFound();
  },
  redirect: (to: string) => {
    throw new Redirect(to);
  },
}));

const Page = (await import("@/app/(app)/prs/[id]/evidence/[evidenceId]/page")).default;

/**
 * Follow a citation.
 *
 * @param query The search parameters.
 * @returns What the page did.
 */
function follow(query: Record<string, string | string[] | undefined> = {}) {
  return Page({
    params: Promise.resolve({ id: PR_514_ID, evidenceId: evidenceId(1) }),
    searchParams: Promise.resolve(query),
  });
}

beforeEach(() => {
  requireWorkspace.mockReset();
  evidenceTargetPath.mockReset();
  requireWorkspace.mockResolvedValue({ user: sessionUser(), membership: membership() });
});

describe("/prs/:id/evidence/:evidenceId", () => {
  it("redirects to the cited row, carrying the module the PR page was opened from", async () => {
    evidenceTargetPath.mockResolvedValue("/runs/r/tests?from=build-farm&attempt=4&suite=telemetry");

    await expect(follow({ from: "build-farm" })).rejects.toThrow(
      "/runs/r/tests?from=build-farm&attempt=4&suite=telemetry",
    );
    expect(evidenceTargetPath).toHaveBeenCalledWith(PR_514_ID, evidenceId(1), "build-farm");
  });

  it("falls back to the dashboard for an origin that links nowhere", async () => {
    evidenceTargetPath.mockResolvedValue("/runs/r/tests");

    await expect(follow({ from: "nowhere" })).rejects.toBeInstanceOf(Redirect);
    expect(evidenceTargetPath).toHaveBeenCalledWith(PR_514_ID, evidenceId(1), "dashboard");
  });

  it("answers the not-found page for a citation that cannot be resolved", async () => {
    evidenceTargetPath.mockResolvedValue(null);

    await expect(follow()).rejects.toBeInstanceOf(NotFound);
  });

  it("resolves nothing before the gate has passed", async () => {
    requireWorkspace.mockRejectedValue(new Error("NEXT_REDIRECT"));

    await expect(follow()).rejects.toThrow("NEXT_REDIRECT");
    expect(evidenceTargetPath).not.toHaveBeenCalled();
  });
});
