import { cleanup, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Role } from "@/app/api/membership";
import { ADMIN_ONLY_START_REASON, START_LABEL } from "@/app/research/composer";
import { VIEWER_START_REASON } from "@/app/research/view";

import { membership, sessionUser } from "../helpers/login";
import { composerReadings, featuredBrief } from "../helpers/research";

/**
 * The research route (#627): the gate is asked first, the address's view is read, and the
 * reader's roles decide whether **New investigation** can act — together, since #628, with the
 * workspace's own setting, read with the composer's catalogs.
 */

const requireWorkspace = vi.fn();
const readComposer = vi.fn();
const readFeaturedBrief = vi.fn();

vi.mock("@/app/api/access", () => ({ requireWorkspace: () => requireWorkspace() }));
vi.mock("@/app/research/composer-data", () => ({ readComposer: () => readComposer() }));
vi.mock("@/app/research/brief-data", () => ({ readFeaturedBrief: () => readFeaturedBrief() }));
vi.mock("@/app/research/brief-actions", () => ({
  readBriefLedger: () => new Promise(() => {}),
  readTrackers: () => new Promise(() => {}),
  draftEpicFromGaps: () => new Promise(() => {}),
}));
vi.mock("@/app/research/composer-actions", () => ({
  estimateComposer: () => new Promise(() => {}),
  startInvestigation: () => new Promise(() => {}),
  cancelInvestigation: () => new Promise(() => {}),
  readInvestigation: () => new Promise(() => {}),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

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

function newInvestigation(): HTMLElement {
  return screen.getByRole("button", { name: "New investigation" });
}

beforeEach(() => {
  requireWorkspace.mockReset().mockResolvedValue(access());
  readComposer.mockReset().mockResolvedValue(composerReadings());
  readFeaturedBrief.mockReset().mockResolvedValue({ ok: true, value: featuredBrief() });
});

describe("the research route", () => {
  it("renders the head for the workspace the gate returned, with the composer's readings", async () => {
    render(await page());

    expect(requireWorkspace).toHaveBeenCalledOnce();
    expect(readComposer).toHaveBeenCalledOnce();
    expect(readFeaturedBrief).toHaveBeenCalledOnce();
    expect(screen.getByRole("region", { name: /RS-127/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Ask a hard question. Get an evidenced answer — and the tickets to act on it.",
    );
    expect(screen.getByRole("radio", { name: "Gap analysis" })).toHaveAttribute("aria-checked", "true");
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
    expect(readComposer).not.toHaveBeenCalled();
    expect(readFeaturedBrief).not.toHaveBeenCalled();
  });

  it("lets a member draft from the brief, and not a viewer", async () => {
    requireWorkspace.mockResolvedValue(access(["member"]));
    render(await page());
    expect(screen.getByRole("button", { name: "Draft epic from gaps →" })).not.toHaveAttribute("aria-disabled");

    cleanup();
    requireWorkspace.mockResolvedValue(access(["viewer"]));
    render(await page());
    expect(screen.getByRole("button", { name: "Draft epic from gaps →" })).toHaveAttribute("aria-disabled", "true");
  });

  it.each<[Role]>([["owner"], ["admin"], ["member"]])("lets a %s start an investigation", async (role) => {
    requireWorkspace.mockResolvedValue(access([role]));
    render(await page());

    expect(newInvestigation()).not.toHaveAttribute("aria-disabled");
  });

  it("shows a viewer the page with New investigation inert", async () => {
    requireWorkspace.mockResolvedValue(access(["viewer"]));
    render(await page());

    expect(newInvestigation()).toHaveAttribute("aria-disabled", "true");
    expect(newInvestigation()).toHaveAttribute("title", VIEWER_START_REASON);
    expect(screen.getByRole("link", { name: "Research library" })).toBeInTheDocument();
    expect(screen.getAllByRole("region")).toHaveLength(6);
  });

  it("errs low for a reader with no recognised role", async () => {
    requireWorkspace.mockResolvedValue(access([]));
    render(await page());

    expect(newInvestigation()).toHaveAttribute("aria-disabled", "true");
  });

  it("holds a member back where the workspace lets only admins start, in both places", async () => {
    requireWorkspace.mockResolvedValue(access(["member"]));
    readComposer.mockResolvedValue(composerReadings({ settings: { ok: true, value: { startRole: "admin" } } }));
    render(await page());

    expect(newInvestigation()).toHaveAttribute("title", ADMIN_ONLY_START_REASON);
    expect(screen.getByRole("button", { name: START_LABEL })).toHaveAttribute("title", ADMIN_ONLY_START_REASON);
  });

  it("lets an admin start where the workspace lets only admins start", async () => {
    requireWorkspace.mockResolvedValue(access(["admin"]));
    readComposer.mockResolvedValue(composerReadings({ settings: { ok: true, value: { startRole: "admin" } } }));
    render(await page());

    expect(newInvestigation()).not.toHaveAttribute("aria-disabled");
  });

  it("leaves the gate to the service when the setting could not be read", async () => {
    requireWorkspace.mockResolvedValue(access(["member"]));
    readComposer.mockResolvedValue(composerReadings({ settings: { ok: false, reason: "The setting is away." } }));
    render(await page());

    expect(newInvestigation()).not.toHaveAttribute("aria-disabled");
  });
});
