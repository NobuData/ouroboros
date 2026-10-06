import { readFileSync } from "node:fs";
import { join } from "node:path";

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { membership, sessionUser } from "../helpers/login";
import { REPO, mirrored, sourcesReadings, wizard } from "../helpers/onboarding";

/**
 * The `/get-started` route (#390): gated to a signed-in person with a workspace, read once on the
 * server for the query's repository, and rendered in a route group of its own — outside the shell.
 */

const requireWorkspace = vi.fn();
const readGetStarted = vi.fn();

vi.mock("@/app/api/access", () => ({ requireWorkspace: () => requireWorkspace() }));
vi.mock("@/app/get-started/data", () => ({
  readGetStarted: (access: unknown, repo: unknown) => readGetStarted(access, repo),
}));
vi.mock("@/app/get-started/actions", () => ({
  continueStep: vi.fn(),
  enableRepository: vi.fn(),
  launchFirstLoop: vi.fn(),
  skipWizard: vi.fn(),
  dismissWizard: vi.fn(),
  setRepositoryEnabled: vi.fn(),
}));
// Step 1's embedded flow is `app/sources`' own dialog and rows (#395); their actions are server-only.
vi.mock("@/app/sources/actions", () => ({
  readSourceCatalog: vi.fn(),
  addSource: vi.fn(),
  testSource: vi.fn(),
  syncSource: vi.fn(),
  readSourceStatus: vi.fn(),
  setSourceStatus: vi.fn(),
  setSourceCredentials: vi.fn(),
  updateSourceConfig: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
// The one shell piece the standalone group mounts (#395): it renders nothing and reads the
// person's font-scale preference — `__tests__/shell/font-scale-sync.test.tsx` covers what it does.
vi.mock("@/app/shell/font-scale-sync", () => ({ FontScaleSync: () => null }));
vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));

const Page = (await import("@/app/(wizard)/get-started/page")).default;
const WizardLayout = (await import("@/app/(wizard)/layout")).default;

const ACCESS = { session: { user: sessionUser() }, membership: membership() };

beforeEach(() => {
  requireWorkspace.mockReset().mockResolvedValue(ACCESS);
  readGetStarted.mockReset().mockResolvedValue({
    repo: REPO,
    wizard: { ok: true, value: wizard() },
    sources: { ok: true, value: sourcesReadings() },
    enablement: { ok: true, value: mirrored() },
    reposFailure: null,
    abilities: { contribute: true, administer: true },
  });
});

describe("the get-started route", () => {
  it("gates, reads the query's repository once, and renders the frame", async () => {
    render(await Page({ searchParams: Promise.resolve({ repo: REPO }) }));

    expect(requireWorkspace).toHaveBeenCalledOnce();
    expect(readGetStarted).toHaveBeenCalledExactlyOnceWith(ACCESS, REPO);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Your first loop in about 4 minutes.");
  });

  it("does not read when the gate refuses", async () => {
    requireWorkspace.mockRejectedValue(new Error("NEXT_REDIRECT"));

    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_REDIRECT");
    expect(readGetStarted).not.toHaveBeenCalled();
  });

  it("sits in a route group with no shell — the layout adds nothing around the page but the font-scale sync (#395)", () => {
    render(
      <WizardLayout>
        <p>the wizard</p>
      </WizardLayout>,
    );

    expect(document.body.innerHTML).toBe("<div><p>the wizard</p></div>");
    const layout = readFileSync(join(import.meta.dirname, "..", "..", "app", "(wizard)", "layout.tsx"), "utf8");

    // Nothing of the shell's frame — the one import from it is the preference sync, which draws
    // nothing and is what lets the standalone screen honour the reader's font-size step.
    expect(layout).not.toMatch(/AppShell|from "@\/app\/shell\/(?!font-scale-sync")/);
    expect(layout).toMatch(/<FontScaleSync \/>/);
  });
});
