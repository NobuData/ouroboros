import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ADD_CLAIM_LABEL, CRITERIA_TITLE, WAIVE_LABEL } from "@/app/prs/criteria";
import { FILES_TITLE } from "@/app/prs/files";
import {
  DISARM_LABEL,
  EPICS_UNREAD,
  EPIC_LABEL,
  MERGE_PLAN_TITLE,
  NO_EPIC,
} from "@/app/prs/merge-plan";
import { PR_LOADING_LABEL } from "@/app/prs/pr-loading";
import { PR_MISSING_TITLE } from "@/app/prs/pr-missing";
import { APPROVE_LABEL, AWAITS_APPROVER, DECLINE_LABEL, GATES_TITLE } from "@/app/prs/gates";
import { ACTIONS_LABEL, MERGE_LABEL, RETURN_LABEL, REVIEW_LABEL } from "@/app/prs/view";
import { navRegistry } from "@/app/shell/nav-registry";

import { membership, sessionUser } from "../helpers/login";
import {
  BLE_EPIC,
  OTA_EPIC,
  PR_514_ID,
  TELEMETRY_PATH,
  armedPlan,
  blockedPage,
  criterion,
  matrix,
  matrixPage,
  prPage,
  review,
  stripPage,
} from "../helpers/pull-requests";

/**
 * The PR verification route (#363): the gate first, then one read — a PR this workspace cannot
 * see is the not-found page, a failed read is the screen under a banner, `?from=` decides which
 * module stays lit, and the reader's role decides which actions are drawn. The roadmap's epics
 * are read beside the page for the Merge plan card (#369).
 */

const requireWorkspace = vi.fn();
const readPr = vi.fn();
const readEpics = vi.fn();

/** What `notFound()` throws, so the case can see it was called. */
class NotFound extends Error {}

vi.mock("@/app/api/access", () => ({ requireWorkspace: () => requireWorkspace() }));
vi.mock("@/app/prs/data", () => ({
  readEpics: () => readEpics(),
  readPr: (id: string) => readPr(id),
}));
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
vi.mock("@/app/prs/merge-actions", () => ({
  armPlan: vi.fn(),
  disarmPlan: vi.fn(),
  editPlan: vi.fn(),
  mergeNow: vi.fn(),
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
  readEpics.mockReset().mockResolvedValue([OTA_EPIC, BLE_EPIC]);
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

  it("draws the skeleton while the first read is in flight (#370)", () => {
    render(<Loading />);

    expect(screen.getByRole("main", { name: PR_LOADING_LABEL })).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });

  it("hands the read's own instant on as the sync-lag banner's first clock (#370)", async () => {
    // Never synced, so the banner is drawn whatever the clock says — and it is drawn once.
    readPr.mockResolvedValue({
      state: "found",
      value: prPage({ pullRequest: { syncedAt: null } }),
      readAt: Date.parse("2026-09-27T14:46:00.000Z"),
    });
    await open();

    expect(screen.getByText("PR #514 has never been synced with its host.")).toBeInTheDocument();
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

describe("a waiting approval, by role (#370)", () => {
  beforeEach(() => {
    readPr.mockResolvedValue({ state: "found", value: stripPage({ review: review() }) });
  });

  /** The gates card. */
  function gates() {
    return within(screen.getByRole("region", { name: GATES_TITLE }));
  }

  it("is answered by an owner and an admin", async () => {
    for (const role of ["owner", "admin"] as const) {
      holding([role]);
      const page = await open();

      expect(gates().getByRole("button", { name: APPROVE_LABEL })).toBeInTheDocument();
      expect(gates().getByRole("button", { name: DECLINE_LABEL })).toBeInTheDocument();
      expect(gates().queryByText(AWAITS_APPROVER)).toBeNull();
      page.unmount();
    }
  });

  it("is not a member's to answer — no Approve, no Decline, and told who it waits for", async () => {
    holding(["member"]);
    await open();

    expect(gates().queryByRole("button", { name: APPROVE_LABEL })).toBeNull();
    expect(gates().queryByRole("button", { name: DECLINE_LABEL })).toBeNull();
    expect(gates().getByText(AWAITS_APPROVER)).toBeInTheDocument();
  });

  it("draws a viewer neither the buttons nor the note", async () => {
    holding(["viewer"]);
    await open();

    expect(gates().queryAllByRole("button")).toHaveLength(0);
    expect(gates().queryByText(AWAITS_APPROVER)).toBeNull();
  });
});

describe("the merge plan, by role (#369)", () => {
  /** The Merge plan card. */
  function plan() {
    return within(screen.getByRole("region", { name: MERGE_PLAN_TITLE }));
  }

  it("offers the roadmap's epics to an owner, read once beside the page", async () => {
    await open();

    expect(readEpics).toHaveBeenCalledOnce();
    expect(
      within(plan().getByRole("combobox", { name: EPIC_LABEL }))
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual([NO_EPIC, OTA_EPIC.name, BLE_EPIC.name]);
    expect(plan().getByRole("combobox", { name: EPIC_LABEL })).toBeEnabled();
  });

  it("draws the page when the roadmap cannot be read, and says so on the picker", async () => {
    readEpics.mockResolvedValue(null);
    await open();

    expect(screen.getByText("PR Verification · PR #514 · Revision 2")).toBeInTheDocument();
    expect(plan().getByText(EPICS_UNREAD)).toBeInTheDocument();
    expect(plan().getByRole("combobox", { name: EPIC_LABEL })).toBeDisabled();
  });

  it("draws arm for an owner and an admin, and hides it from a member and a viewer", async () => {
    for (const role of ["owner", "admin"] as const) {
      holding([role]);
      const page = await open();

      expect(plan().getByRole("button", { name: MERGE_LABEL })).toBeInTheDocument();
      expect(plan().getByRole("textbox")).toBeInTheDocument();
      page.unmount();
    }

    for (const role of ["member", "viewer"] as const) {
      holding([role]);
      const page = await open();

      expect(plan().queryByRole("button", { name: MERGE_LABEL })).toBeNull();
      expect(plan().queryAllByRole("button")).toHaveLength(0);
      expect(plan().queryByRole("textbox")).toBeNull();
      page.unmount();
    }
  });

  it("draws disarm for a member — the safe direction — and hides it from a viewer", async () => {
    readPr.mockResolvedValue({
      state: "found",
      value: prPage({ pullRequest: { state: "armed" }, plan: armedPlan() }),
    });

    for (const role of ["owner", "member"] as const) {
      holding([role]);
      const page = await open();

      expect(plan().getByRole("button", { name: DISARM_LABEL })).toBeInTheDocument();
      page.unmount();
    }

    holding(["viewer"]);
    await open();

    expect(plan().queryByRole("button", { name: DISARM_LABEL })).toBeNull();
    expect(plan().queryAllByRole("button")).toHaveLength(0);
  });
});
