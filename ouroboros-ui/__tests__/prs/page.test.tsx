import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ADD_CLAIM_LABEL, CRITERIA_TITLE, WAIVE_LABEL } from "@/app/prs/criteria";
import { FILES_TITLE } from "@/app/prs/files";
import { PR_MISSING_TITLE } from "@/app/prs/pr-missing";
import { GATES_TITLE } from "@/app/prs/gates";
import { ACTIONS_LABEL, MERGE_LABEL, RETURN_LABEL, REVIEW_LABEL } from "@/app/prs/view";
import { navRegistry } from "@/app/shell/nav-registry";

import { membership, sessionUser } from "../helpers/login";
import {
  PR_514_ID,
  TELEMETRY_PATH,
  blockedPage,
  criterion,
  matrix,
  matrixPage,
  prPage,
  stripPage,
} from "../helpers/pull-requests";

/**
 * The PR verification route (#363): the gate first, then one read — a PR this workspace cannot
 * see is the not-found page, a failed read is the screen under a banner, `?from=` decides which
 * module stays lit, and the reader's role decides which actions are drawn.
 */

const requireWorkspace = vi.fn();
const readPr = vi.fn();

/** What `notFound()` throws, so the case can see it was called. */
class NotFound extends Error {}

vi.mock("@/app/api/access", () => ({ requireWorkspace: () => requireWorkspace() }));
vi.mock("@/app/prs/data", () => ({ readPr: (id: string) => readPr(id) }));
vi.mock("@/app/prs/head-actions", () => ({
  decideApproval: vi.fn(),
  requestHumanReview: vi.fn(),
  returnToLoop: vi.fn(),
}));
vi.mock("@/app/prs/criteria-actions", () => ({
  addClaim: vi.fn(),
  attachEvidence: vi.fn(),
  importFromPlan: vi.fn(),
  readEvidenceOptions: vi.fn(),
  verifyClaim: vi.fn(),
  waiveClaim: vi.fn(),
}));
vi.mock("@/app/prs/thread-actions", () => ({
  resolveEntry: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFound();
  },
}));

// The route passes no poll seam, so the poll it starts is the real one; nothing answers here.
vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));

const Page = (await import("@/app/(app)/prs/[id]/page")).default;
const NotFoundPage = (await import("@/app/(app)/prs/[id]/not-found")).default;
const Loading = (await import("@/app/(app)/prs/[id]/loading")).default;

/**
 * Render `/prs/:id`.
 *
 * @param query The search parameters.
 * @returns The rendered page.
 */
async function open(query: Record<string, string | string[] | undefined> = {}) {
  return render(
    await Page({ params: Promise.resolve({ id: PR_514_ID }), searchParams: Promise.resolve(query) }),
  );
}

/**
 * Sign in holding these roles.
 *
 * @param roles The active membership's roles.
 */
function holding(roles: ReturnType<typeof membership>["roles"]): void {
  const held = membership({ roles });
  requireWorkspace.mockResolvedValue({
    session: { user: sessionUser(), memberships: [held], tenantSuggestion: null },
    membership: held,
  });
}

/** The labels of the actions drawn, in order. */
function drawn(): (string | null)[] {
  const group = screen.queryByRole("group", { name: ACTIONS_LABEL });

  return group === null
    ? []
    : within(group)
        .getAllByRole("button")
        .map((button) => button.textContent);
}

beforeEach(() => {
  holding(["owner"]);
  readPr.mockReset().mockResolvedValue({ state: "found", value: prPage() });
});

describe("the PR verification route", () => {
  it("reads the PR the path names and renders its head", async () => {
    await open();

    expect(readPr).toHaveBeenCalledExactlyOnceWith(PR_514_ID);
    expect(screen.getByText("PR Verification · PR #514 · Revision 2")).toBeInTheDocument();
  });

  it("reads nothing when the gate refuses — its redirect is the answer", async () => {
    requireWorkspace.mockRejectedValue(new Error("NEXT_REDIRECT"));

    await expect(open()).rejects.toThrow("NEXT_REDIRECT");
    expect(readPr).not.toHaveBeenCalled();
  });

  it("answers a PR this workspace cannot see with the not-found page", async () => {
    readPr.mockResolvedValue({ state: "missing" });

    await expect(open()).rejects.toBeInstanceOf(NotFound);

    render(<NotFoundPage />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(PR_MISSING_TITLE);
  });

  it("draws a failed read as a banner rather than an error page", async () => {
    readPr.mockResolvedValue({ state: "failed", reason: "The database is down." });
    await open();

    expect(screen.getByText("The database is down.")).toBeInTheDocument();
  });

  it("keeps the module named by ?from= lit, and falls back to the dashboard", async () => {
    const farm = await open({ from: "build-farm" });
    expect(navRegistry().origin).toBe("build-farm");
    farm.unmount();

    await open({ from: "nowhere" });
    expect(navRegistry().origin).toBe("dashboard");
  });

  it("cites the hunk ?hunk= names, and ignores what is not a path and a range (#366)", async () => {
    readPr.mockResolvedValue({ state: "found", value: matrixPage() });

    const cited = await open({ hunk: `${TELEMETRY_PATH}:41-66` });
    expect(screen.getByRole("region", { name: FILES_TITLE })).toHaveTextContent(
      `Cited: ${TELEMETRY_PATH} · lines 41–66`,
    );
    cited.unmount();

    await open({ hunk: "not-a-hunk" });
    expect(screen.getByRole("region", { name: FILES_TITLE })).not.toHaveTextContent("Cited:");
  });

  it("draws the matrix's controls by role: waive for an owner or admin only (#366)", async () => {
    readPr.mockResolvedValue({
      state: "found",
      value: matrixPage({ criteria: matrix([criterion()]) }),
    });

    /** The labels of the matrix's controls, in order. */
    const controls = (): (string | null)[] =>
      within(screen.getByRole("region", { name: CRITERIA_TITLE }))
        .getAllByRole("button")
        .map((button) => button.textContent);

    holding(["admin"]);
    const admin = await open();
    expect(controls()).toContain(WAIVE_LABEL);
    expect(controls()).toContain(ADD_CLAIM_LABEL);
    admin.unmount();

    holding(["member"]);
    const member = await open();
    expect(controls()).not.toContain(WAIVE_LABEL);
    expect(controls()).toContain(ADD_CLAIM_LABEL);
    member.unmount();

    holding(["viewer"]);
    await open();
    expect(
      within(screen.getByRole("region", { name: CRITERIA_TITLE })).queryAllByRole("button"),
    ).toEqual([]);
  });

  it("scopes the gates to the revision ?rev= names, and ignores what is not an ordinal (#364)", async () => {
    readPr.mockResolvedValue({ state: "found", value: stripPage() });

    const scoped = await open({ rev: "1" });
    expect(screen.getByRole("region", { name: GATES_TITLE })).toHaveTextContent(
      "Revision 1 · 3f9c2ae · 2 gates red",
    );
    scoped.unmount();

    await open({ rev: "latest" });
    expect(screen.getByRole("region", { name: GATES_TITLE })).toHaveTextContent(
      "Revision 2 · b7e41d0 · 5/7 gates green",
    );
  });

  it("says it is reading while the first read is in flight", () => {
    render(<Loading />);

    expect(screen.getByRole("status")).toHaveTextContent(/Reading the pull request/);
  });
});

describe("the actions, by role", () => {
  beforeEach(() => {
    readPr.mockResolvedValue({
      state: "found",
      value: blockedPage({ pullRequest: { state: "verifying" } }),
    });
  });

  it("draws all three for an owner and for an admin", async () => {
    for (const role of ["owner", "admin"] as const) {
      holding([role]);
      const page = await open();

      expect(drawn()).toEqual([REVIEW_LABEL, RETURN_LABEL, MERGE_LABEL]);
      page.unmount();
    }
  });

  it("draws a member the two head actions and no arm affordance", async () => {
    holding(["member"]);
    await open();

    expect(drawn()).toEqual([REVIEW_LABEL, RETURN_LABEL]);
  });

  it("draws a viewer none", async () => {
    holding(["viewer"]);
    await open();

    expect(drawn()).toEqual([]);
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });
});
