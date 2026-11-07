import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Role } from "@/app/api/membership";

import { analyzerReadings } from "../helpers/analyzer";
import { membership, sessionUser } from "../helpers/login";

/**
 * The analyzer route (#516): the gate is asked first, the reader is handed the workspace, and
 * every member — a viewer included — is given the page.
 */

const requireWorkspace = vi.fn();
const readAnalyzer = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/app/api/access", () => ({ requireWorkspace: () => requireWorkspace() }));
vi.mock("@/app/analyzer/data", () => ({
  readAnalyzer: (access: unknown, origin: unknown) => readAnalyzer(access, origin),
}));
// The reader's remembered origin (DJ.3) — none unless a case sets one.
let rememberedOrigin: string | undefined;
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({ get: () => (rememberedOrigin === undefined ? undefined : { value: rememberedOrigin }) }),
}));
vi.mock("@/app/analyzer/analyzer-actions", () => ({ startAnalysis: vi.fn(), saveAnalyzerSchedule: vi.fn() }));

// The route passes the screen no test seam, so the poll it starts is the real one; what it asks
// is this origin, which answers nothing here.
vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));

const Page = (await import("@/app/(app)/analyzer/page")).default;

/**
 * What the gate hands back, for a reader holding these roles.
 *
 * @param roles The roles.
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
  readAnalyzer.mockReset().mockResolvedValue(analyzerReadings());
  rememberedOrigin = undefined;
});

describe("the analyzer route", () => {
  it("reads the workspace the gate returned and draws the analyzer", async () => {
    render(await Page());

    expect(readAnalyzer).toHaveBeenCalledExactlyOnceWith(access(), "live");
    expect(screen.getByRole("main")).toHaveClass("analyzer");
    expect(screen.getByRole("button", { name: "Run analysis now" })).toBeInTheDocument();
  });

  it("reads the origin the address asks for (#2022)", async () => {
    render(await Page({ searchParams: Promise.resolve({ origin: "seeded" }) }));

    expect(readAnalyzer).toHaveBeenCalledExactlyOnceWith(access(), "seeded");
  });

  it("reads the remembered origin when the address names none, and all as live", async () => {
    rememberedOrigin = "simulated";
    render(await Page());
    expect(readAnalyzer).toHaveBeenLastCalledWith(access(), "simulated");

    render(await Page({ searchParams: Promise.resolve({ origin: "all" }) }));
    expect(readAnalyzer).toHaveBeenLastCalledWith(access(), "live");
  });

  it("gives a viewer the page too, with the run inert", async () => {
    requireWorkspace.mockResolvedValue(access(["viewer"]));
    readAnalyzer.mockResolvedValue(analyzerReadings({ mayAdminister: false }));

    render(await Page());

    expect(screen.getByRole("button", { name: "Run analysis now" })).toHaveAttribute("aria-disabled", "true");
  });
});
