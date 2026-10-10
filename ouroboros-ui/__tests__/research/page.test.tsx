import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Role } from "@/app/api/membership";

import { membership, sessionUser } from "../helpers/login";

/**
 * The research route (#627): the gate is asked first, the address's view is read, and the
 * reader's roles decide whether **New investigation** can act.
 */

const requireWorkspace = vi.fn();

vi.mock("@/app/api/access", () => ({ requireWorkspace: () => requireWorkspace() }));

const Page = (await import("@/app/(app)/research/page")).default;

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
 * The page, for an address's query.
 *
 * @param query The query, as Next.js hands it.
 * @returns The rendered element.
 */
async function page(query: Record<string, string | string[] | undefined> = {}) {
  return Page({ searchParams: Promise.resolve(query) });
}

beforeEach(() => {
  requireWorkspace.mockReset().mockResolvedValue(access());
});

describe("the research route", () => {
  it("renders the head for the workspace the gate returned", async () => {
    render(await page());

    expect(requireWorkspace).toHaveBeenCalledOnce();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Ask a hard question. Get an evidenced answer — and the tickets to act on it.",
    );
    expect(document.querySelector(".research__seat--highlight")).toBeNull();
  });

  it("renders with no query at all", async () => {
    render(await Page());

    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });

  it("opens the library on the address that names it", async () => {
    render(await page({ view: "library" }));

    expect(document.getElementById("investigations")).toHaveClass("research__seat--highlight");
  });

  it("opens the page from its top for a view nobody wrote", async () => {
    render(await page({ view: "everything" }));

    expect(document.querySelector(".research__seat--highlight")).toBeNull();
  });

  it("renders nothing when the gate refuses — its redirect is the answer", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    requireWorkspace.mockRejectedValue(redirect);

    await expect(page()).rejects.toBe(redirect);
  });

  it.each<[Role]>([["owner"], ["admin"], ["member"]])("lets a %s start an investigation", async (role) => {
    requireWorkspace.mockResolvedValue(access([role]));
    render(await page());

    expect(screen.getByRole("button", { name: "New investigation" })).not.toHaveAttribute("aria-disabled");
  });

  it("shows a viewer the page with New investigation inert", async () => {
    requireWorkspace.mockResolvedValue(access(["viewer"]));
    render(await page());

    expect(screen.getByRole("button", { name: "New investigation" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("link", { name: "Research library" })).toBeInTheDocument();
    expect(screen.getAllByRole("region")).toHaveLength(6);
  });

  it("errs low for a reader with no recognised role", async () => {
    requireWorkspace.mockResolvedValue(access([]));
    render(await page());

    expect(screen.getByRole("button", { name: "New investigation" })).toHaveAttribute("aria-disabled", "true");
  });
});
