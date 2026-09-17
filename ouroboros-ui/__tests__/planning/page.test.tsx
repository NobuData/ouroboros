import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Role } from "@/app/api/membership";
import { DRAFT_LABEL, DRAFT_ROLE_REASON } from "@/app/planning/generator";
import { NEW_ROADMAP_LABEL, NEW_ROADMAP_ROLE_REASON, PLANNING_TITLE } from "@/app/planning/view";

import { membership, sessionUser } from "../helpers/login";
import { SEEDED_BATCH_ID, planningReadings } from "../helpers/planning";

/**
 * The planning route (#283): the gate is asked first, what it returns is what the reader is given,
 * and the role it resolved decides whether **New roadmap** acts.
 */

/** What the gate answers this case with, or the signal it throws instead. */
const requireWorkspace = vi.fn();

/** What the reader answers with. */
const readPlanning = vi.fn();

vi.mock("@/app/api/access", () => ({ requireWorkspace: () => requireWorkspace() }));
vi.mock("@/app/planning/data", () => ({
  readPlanning: (access: unknown, batchId: unknown) => readPlanning(access, batchId),
}));
vi.mock("@/app/planning/create-actions", () => ({ createRoadmap: vi.fn() }));
vi.mock("@/app/planning/generator-actions", () => ({
  generateBatch: vi.fn(),
  patchDraft: vi.fn(),
  pushBatch: vi.fn(),
  readMilestones: vi.fn(() => new Promise(() => {})),
  regenerateBatch: vi.fn(),
}));
vi.mock("@/app/planning/gantt-actions", () => ({
  addEpic: vi.fn(),
  readEpicLinks: vi.fn(() => new Promise(() => {})),
  searchTickets: vi.fn(() => new Promise(() => {})),
  setTicketLinked: vi.fn(),
  updateEpic: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

const Page = (await import("@/app/(app)/planning/page")).default;

/**
 * The route's props, for an address with this query.
 *
 * @param query The query's parameters.
 * @returns The props.
 */
function props(query: Record<string, string | string[] | undefined> = {}) {
  return { searchParams: Promise.resolve(query) };
}

/**
 * What the gate hands back, for a reader holding these roles.
 *
 * @param roles The roles. Defaults to the seed's owner.
 * @returns The workspace.
 */
function access(roles: Role[] = ["owner"]) {
  return {
    session: { user: sessionUser(), memberships: [membership({ roles })], tenantSuggestion: null },
    membership: membership({ roles }),
  };
}

beforeEach(() => {
  requireWorkspace.mockReset().mockResolvedValue(access());
  readPlanning.mockReset().mockResolvedValue(planningReadings());
});

describe("the planning route", () => {
  it("renders the frame for the workspace the gate returned", async () => {
    render(await Page(props()));

    expect(readPlanning).toHaveBeenCalledExactlyOnceWith(access(), null);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(PLANNING_TITLE);
  });

  it("reads nothing when the gate refuses — its redirect is the answer", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    requireWorkspace.mockRejectedValue(redirect);

    await expect(Page(props())).rejects.toBe(redirect);
    expect(readPlanning).not.toHaveBeenCalled();
  });

  it("reads the batch a `?batch=` address names, and ignores one that is not a batch id", async () => {
    render(await Page(props({ batch: SEEDED_BATCH_ID })));
    expect(readPlanning).toHaveBeenLastCalledWith(access(), SEEDED_BATCH_ID);

    render(await Page(props({ batch: "not-a-uuid" })));
    expect(readPlanning).toHaveBeenLastCalledWith(access(), null);
  });

  it.each<[Role, boolean]>([
    ["owner", true],
    ["admin", true],
    ["member", true],
    ["viewer", false],
  ])("lets a %s draft tickets: %s", async (role, drafts) => {
    requireWorkspace.mockResolvedValue(access([role]));

    render(await Page(props()));

    const draft = screen.getByRole("button", { name: DRAFT_LABEL });

    if (drafts) expect(draft).not.toHaveAttribute("title", DRAFT_ROLE_REASON);
    else expect(draft).toHaveAttribute("title", DRAFT_ROLE_REASON);
  });

  it.each<[Role, boolean]>([
    ["owner", true],
    ["admin", true],
    ["member", false],
    ["viewer", false],
  ])("lets a %s act on New roadmap: %s", async (role, acts) => {
    requireWorkspace.mockResolvedValue(access([role]));

    render(await Page(props()));

    const action = screen.getByRole("button", { name: NEW_ROADMAP_LABEL });

    if (acts) expect(action).not.toHaveAttribute("aria-disabled");
    else expect(action).toHaveAttribute("title", NEW_ROADMAP_ROLE_REASON);
  });
});
