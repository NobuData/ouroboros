import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Role } from "@/app/api/membership";
import { DEFAULT_FILTER, REPO_LABEL, type SearchParams, parseFilter } from "@/app/issues/filter";
import {
  QUEUE_NOTHING_SELECTED,
  QUEUE_ROLE_REASON,
  REESTIMATE_LABEL,
  queueLabel,
} from "@/app/issues/view";

import { HELIOS, issuesReadings } from "../helpers/issues";
import { membership, sessionUser } from "../helpers/login";

/**
 * The intake route (#115, #116).
 *
 * Four lines, and this suite is about all four: the gate is asked first, the address's query is
 * read into the filter the reader is given, what the gate returns is what the reader is given with
 * it, and the roles it resolved decide the head's two controls — **Re-estimate all** drawn for an
 * owner or an admin and nobody else, **Queue N selected ⟳** inert for a viewer. The copy, the presses
 * and what the bar writes are covered where they are decided.
 */

/** What the gate answers this case with, or the signal it throws instead. */
const requireWorkspace = vi.fn();

/** What the reader answers with. */
const readIssues = vi.fn();

vi.mock("@/app/api/access", () => ({ requireWorkspace: () => requireWorkspace() }));
vi.mock("@/app/issues/data", () => ({
  readIssues: (access: unknown, filter: unknown) => readIssues(access, filter),
}));
vi.mock("@/app/issues/head-actions", () => ({ queueSelected: vi.fn(), reestimateAll: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }) }));

const Page = (await import("@/app/(app)/issues/page")).default;
const { resetFocusRepos } = await import("@/app/shell/focus-repo");

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

/**
 * The page, for an address.
 *
 * @param query The address's query, as the route receives it. Defaults to none.
 * @returns What the route renders.
 */
function page(query: SearchParams = {}) {
  return Page({ searchParams: Promise.resolve(query) });
}

beforeEach(() => {
  requireWorkspace.mockReset().mockResolvedValue(access());
  readIssues.mockReset().mockResolvedValue(issuesReadings());
  window.localStorage.clear();
  resetFocusRepos();
});

afterEach(() => {
  window.localStorage.clear();
  resetFocusRepos();
});

describe("the intake route", () => {
  it("asks the gate before it reads anything", async () => {
    render(await page());

    expect(requireWorkspace).toHaveBeenCalledOnce();
  });

  it("hands the reader exactly what the gate resolved, and the default filter for a bare address", async () => {
    const resolved = access();
    requireWorkspace.mockResolvedValue(resolved);

    await page();

    expect(readIssues).toHaveBeenCalledExactlyOnceWith(resolved, DEFAULT_FILTER);
  });

  it("reads the filter out of the address, so the first paint is the filtered view", async () => {
    const query = { repo: HELIOS.id, labels: "bug,tech-debt", state: "closed", sort: "number" };

    render(await page(query));

    expect(readIssues).toHaveBeenCalledExactlyOnceWith(expect.anything(), parseFilter(query));
    expect(screen.getByRole("combobox", { name: REPO_LABEL })).toHaveValue(HELIOS.id);
    expect(screen.getByRole("combobox", { name: "State" })).toHaveValue("closed");
    expect(screen.getByRole("combobox", { name: "Sort" })).toHaveValue("number");
    expect(screen.getByRole("button", { name: "tech-debt", pressed: true })).toBeInTheDocument();
  });

  it("draws the counts the reader returned", async () => {
    render(await page());

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "9 open issues. 7 already sized.",
    );
  });

  it("reads nothing at all when the gate redirects instead of returning", async () => {
    requireWorkspace.mockRejectedValue(new Error("NEXT_REDIRECT /login"));

    await expect(page()).rejects.toThrow("NEXT_REDIRECT /login");
    expect(readIssues).not.toHaveBeenCalled();
  });

  it("lets a redirect raised during the read through, rather than drawing around it", async () => {
    readIssues.mockRejectedValue(new Error("NEXT_REDIRECT /login"));

    await expect(page()).rejects.toThrow("NEXT_REDIRECT /login");
  });
});

describe("the roles the route decides", () => {
  it.each([["owner"], ["admin"]] as const)("offers an %s Re-estimate all", async (role) => {
    requireWorkspace.mockResolvedValue(access([role]));

    render(await page());

    expect(screen.getByRole("button", { name: REESTIMATE_LABEL })).toBeInTheDocument();
  });

  it("offers a member no Re-estimate all, and a queue button waiting only on a selection", async () => {
    requireWorkspace.mockResolvedValue(access(["member"]));

    render(await page());

    expect(screen.queryByRole("button", { name: REESTIMATE_LABEL })).toBeNull();
    expect(screen.getByRole("button", { name: queueLabel(0) })).toHaveAttribute(
      "title",
      QUEUE_NOTHING_SELECTED,
    );
  });

  it("offers a viewer neither, with the queue button's reason the role", async () => {
    requireWorkspace.mockResolvedValue(access(["viewer"]));

    render(await page());

    expect(screen.queryByRole("button", { name: REESTIMATE_LABEL })).toBeNull();
    expect(screen.getByRole("button", { name: queueLabel(0) })).toHaveAttribute(
      "title",
      QUEUE_ROLE_REASON,
    );
  });

  it("treats a membership carrying no recognised role as the least it could be", async () => {
    // The direction `app/api/membership.ts` errs in: a screen that guessed high would draw a
    // control the service then refuses.
    requireWorkspace.mockResolvedValue(access([]));

    render(await page());

    expect(screen.queryByRole("button", { name: REESTIMATE_LABEL })).toBeNull();
    expect(screen.getByRole("button", { name: queueLabel(0) })).toHaveAttribute(
      "title",
      QUEUE_ROLE_REASON,
    );
  });
});
