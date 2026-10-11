import { cleanup, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Role } from "@/app/api/membership";
import { ADMIN_ONLY_START_REASON, START_LABEL } from "@/app/research/composer";
import { GATEWAY_NOTICE_TITLE, GATEWAY_START_REASON } from "@/app/research/states";
import { VIEWER_START_REASON } from "@/app/research/view";

import { membership, sessionUser } from "../helpers/login";
import {
  composerReadings,
  emptyWatch,
  featuredBrief,
  featuredPipeline,
  investigationDetail,
  investigationList,
  seededBrief,
  seededWatch,
} from "../helpers/research";

/**
 * The research route (#627): the gate is asked first, the address's view is read, and the
 * reader's roles decide whether **New investigation** can act — together, since #628, with the
 * workspace's own setting, read with the composer's catalogs.
 */

const requireWorkspace = vi.fn();
const readComposer = vi.fn();
const readFeaturedBrief = vi.fn();
const readFeaturedPipeline = vi.fn();
const readInvestigationPage = vi.fn();
const readOpenedInvestigation = vi.fn();
const readWatch = vi.fn();

vi.mock("@/app/api/access", () => ({ requireWorkspace: () => requireWorkspace() }));
vi.mock("@/app/research/composer-data", () => ({ readComposer: () => readComposer() }));
vi.mock("@/app/research/brief-data", () => ({ readFeaturedBrief: () => readFeaturedBrief() }));
vi.mock("@/app/research/pipeline-data", () => ({ readFeaturedPipeline: () => readFeaturedPipeline() }));
vi.mock("@/app/research/pipeline-actions", () => ({
  applyRoadmapSuggestion: () => Promise.resolve({ ok: false, refusal: { code: "x", message: "x" } }),
  dismissRoadmapSuggestion: () => Promise.resolve({ ok: false, refusal: { code: "x", message: "x" } }),
}));
vi.mock("@/app/research/investigations-data", () => ({
  readInvestigationPage: (filters: unknown) => readInvestigationPage(filters),
  readOpenedInvestigation: (id: unknown) => readOpenedInvestigation(id),
}));
vi.mock("@/app/research/side-data", () => ({ readWatch: () => readWatch() }));
vi.mock("@/app/research/side-actions", () => ({
  enableTool: () => new Promise(() => {}),
  dismissWatchItem: () => new Promise(() => {}),
  captureBaselines: () => new Promise(() => {}),
}));
vi.mock("@/app/research/investigations-actions", () => ({
  readInvestigations: () => new Promise(() => {}),
  openInvestigation: () => new Promise(() => {}),
}));
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
  readFeaturedPipeline.mockReset().mockResolvedValue({ ok: true, value: featuredPipeline() });
  readWatch.mockReset().mockResolvedValue({ ok: true, value: seededWatch() });
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  readInvestigationPage.mockReset().mockResolvedValue({ ok: true, value: investigationList() });
  readOpenedInvestigation
    .mockReset()
    .mockResolvedValue({ ok: true, value: { detail: investigationDetail({ displayId: "RS-127" }), brief: seededBrief() } });
});

describe("the research route", () => {
  it("renders the head for the workspace the gate returned, with the composer's readings", async () => {
    render(await page());

    expect(requireWorkspace).toHaveBeenCalledOnce();
    expect(readComposer).toHaveBeenCalledOnce();
    expect(readFeaturedBrief).toHaveBeenCalledOnce();
    expect(readInvestigationPage).toHaveBeenCalledExactlyOnceWith({ kind: null, status: "active", quarter: null });
    expect(readOpenedInvestigation).not.toHaveBeenCalled();
    expect(screen.getByRole("region", { name: /RS-127/ })).toBeInTheDocument();
    expect(readFeaturedPipeline).toHaveBeenCalledOnce();
    expect(screen.getByRole("region", { name: /RS-124/ })).toHaveTextContent("6 issues · 2 milestones · synced");
    expect(screen.getByRole("list", { name: "Investigations" }).querySelectorAll("li")).toHaveLength(4);
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

  it("reads the library's facets off the address, and opens the investigation it names", async () => {
    render(await page({ view: "library", kind: "gap_analysis", status: "brief_ready", quarter: "current", open: "5eed0084-0000-4000-8000-000000000127" }));

    expect(readInvestigationPage).toHaveBeenCalledExactlyOnceWith({ kind: "gap_analysis", status: "brief_ready", quarter: "current" });
    expect(readOpenedInvestigation).toHaveBeenCalledExactlyOnceWith("5eed0084-0000-4000-8000-000000000127");
    expect(screen.getByRole("region", { name: "Research library" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "← All investigations" })).toBeInTheDocument();
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
    readComposer.mockResolvedValue(composerReadings({ settings: { ok: true, value: { startRole: "admin", gateway: { available: true } } } }));
    render(await page());

    expect(newInvestigation()).toHaveAttribute("title", ADMIN_ONLY_START_REASON);
    expect(screen.getByRole("button", { name: START_LABEL })).toHaveAttribute("title", ADMIN_ONLY_START_REASON);
  });

  it("lets an admin start where the workspace lets only admins start", async () => {
    requireWorkspace.mockResolvedValue(access(["admin"]));
    readComposer.mockResolvedValue(composerReadings({ settings: { ok: true, value: { startRole: "admin", gateway: { available: true } } } }));
    render(await page());

    expect(newInvestigation()).not.toHaveAttribute("aria-disabled");
  });

  it.each<Role>(["owner", "member", "viewer"])(
    "tells a %s the deployment has no invocation gateway, once, and switches both starts off (#633)",
    async (role) => {
      requireWorkspace.mockResolvedValue(access([role]));
      readComposer.mockResolvedValue(
        composerReadings({ settings: { ok: true, value: { startRole: "member", gateway: { available: false } } } }),
      );
      render(await page());

      expect(screen.getAllByText(GATEWAY_NOTICE_TITLE)).toHaveLength(1);
      expect(newInvestigation()).toHaveAttribute("title", GATEWAY_START_REASON);
      expect(screen.getByRole("button", { name: START_LABEL })).toHaveAttribute("title", GATEWAY_START_REASON);
    },
  );

  it("leaves the gate to the service when the setting could not be read", async () => {
    requireWorkspace.mockResolvedValue(access(["member"]));
    readComposer.mockResolvedValue(composerReadings({ settings: { ok: false, reason: "The setting is away." } }));
    render(await page());

    expect(newInvestigation()).not.toHaveAttribute("aria-disabled");
  });
});

describe("the side column's standing (#629)", () => {
  it("reads the watch once and seats both cards", async () => {
    render(await page());

    expect(readWatch).toHaveBeenCalledOnce();
    expect(screen.getByRole("region", { name: "Research tools" })).toHaveTextContent("5 connected");
    expect(screen.getByRole("region", { name: "Regression watch" })).toHaveTextContent("Hover drift +14% since v2.0.4");
  });

  it.each<[Role, boolean]>([
    ["owner", true],
    ["admin", true],
    ["member", false],
    ["viewer", false],
  ])("lets a %s capture a baseline and dismiss an item: %s", async (role, may) => {
    requireWorkspace.mockResolvedValue(access([role]));
    readWatch.mockResolvedValue({ ok: true, value: emptyWatch() });

    render(await page());

    // #633: the step is on the page for everyone, inert with its reason for who may not take it.
    expect(screen.getByRole("button", { name: "Capture a baseline" }).hasAttribute("aria-disabled")).toBe(!may);
    cleanup();

    readWatch.mockResolvedValue({ ok: true, value: seededWatch() });
    render(await page());

    expect(screen.getByRole("button", { name: "Dismiss Hover drift +14% since v2.0.4" }).hasAttribute("title")).toBe(!may);
  });
});
