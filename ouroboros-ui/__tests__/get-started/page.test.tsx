import { readFileSync } from "node:fs";
import { join } from "node:path";

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { membership, sessionUser } from "../helpers/login";
import { REPO, wizard } from "../helpers/onboarding";

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
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));

const Page = (await import("@/app/(wizard)/get-started/page")).default;
const WizardLayout = (await import("@/app/(wizard)/layout")).default;

const ACCESS = { session: { user: sessionUser() }, membership: membership() };

beforeEach(() => {
  requireWorkspace.mockReset().mockResolvedValue(ACCESS);
  readGetStarted.mockReset().mockResolvedValue({
    repo: REPO,
    wizard: { ok: true, value: wizard() },
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

  it("sits in a route group with no shell — the layout adds nothing around the page", () => {
    render(
      <WizardLayout>
        <p>the wizard</p>
      </WizardLayout>,
    );

    expect(document.body.innerHTML).toBe("<div><p>the wizard</p></div>");
    const layout = readFileSync(join(import.meta.dirname, "..", "..", "app", "(wizard)", "layout.tsx"), "utf8");

    expect(layout).not.toMatch(/AppShell|from "@\/app\/shell/);
  });
});
