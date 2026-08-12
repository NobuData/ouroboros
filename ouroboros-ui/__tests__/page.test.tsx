import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { membership } from "./helpers/login";

/**
 * The placeholder home page — the first screen in `(app)`, and so the first one behind the
 * gate (#44).
 *
 * `requireWorkspace()` is the data-access layer, and the reason it is mocked here rather
 * than driven is that its own decisions have a suite of their own
 * (`__tests__/api/access.test.ts`). What this file holds is the page's half of the
 * arrangement: it asks the gate for the workspace, and it renders what the gate returned
 * rather than anything it made up.
 */

/** What the gate answers this case with, or the signal it throws instead. */
const requireWorkspace = vi.fn();

vi.mock("@/app/api/access", () => ({
  requireWorkspace: () => requireWorkspace(),
}));

const Page = (await import("@/app/(app)/page")).default;

/** The session the gate hands back beside the workspace. */
const SESSION = {
  user: {
    id: "5eed0003-0000-4000-8000-000000000001",
    email: "ken@acme-robotics.dev",
    displayName: "Ken Suenobu",
    avatarUrl: null,
    createdAt: "2026-08-11T10:20:23.114Z",
    updatedAt: "2026-08-11T10:20:23.114Z",
  },
  memberships: [membership()],
  tenantSuggestion: null,
};

/**
 * Render the page as the gate would let it render.
 *
 * @param over The membership to render for, if this case is about one in particular.
 * @returns Testing Library's result.
 */
async function renderPage(over: Parameters<typeof membership>[0] = {}) {
  requireWorkspace.mockResolvedValue({
    session: SESSION,
    membership: membership(over),
  });

  return render(await Page());
}

beforeEach(() => {
  requireWorkspace.mockReset();
});

describe("the placeholder home page", () => {
  it("renders one top-level heading", async () => {
    await renderPage();

    expect(
      screen.getByRole("heading", { level: 1, name: "Infinity in autonomy" }),
    ).toBeInTheDocument();
  });

  it("is a main landmark, so the shell (#41) has something to wrap", async () => {
    // The shell contributes header, navigation and the content pane; `main` is the
    // page's own landmark inside that pane.
    await renderPage();

    expect(screen.getByRole("main")).toBeInTheDocument();
  });

  it("styles itself through classes only — no inline style survives review", async () => {
    const { container } = await renderPage();
    const main = container.querySelector("main");

    expect(main).toHaveClass("placeholder");
    expect(main?.getAttribute("style")).toBeNull();
  });

  it("names what lands next, so the placeholder explains itself", async () => {
    await renderPage();

    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toHaveLength(1);
    expect(items.join(" ")).toContain("#45");
    // The shell (#41) and the theme switcher (#42) have landed, so the list no longer
    // promises either — this page is one issue away from being replaced outright.
    expect(items.join(" ")).not.toMatch(/#41|#42/);
  });
});

describe("the gate every screen in (app) goes through", () => {
  it("is what the page asks before it renders anything", async () => {
    // "Unauthenticated `(app)` routes redirect to the login screen" is true because of this
    // call, not because of a check in the layout — see app/(app)/layout.tsx for why.
    await renderPage();

    expect(requireWorkspace).toHaveBeenCalledOnce();
  });

  it("supplies the workspace the page reports, rather than the page assuming one", async () => {
    await renderPage({ slug: "acme-labs", displayName: "Acme Labs", role: "admin" });

    expect(screen.getByText(/ouroboros-ui · acme-labs/)).toBeInTheDocument();
    expect(screen.getByText(/in Acme Labs as admin/)).toBeInTheDocument();
  });

  it("names who is signed in, from the session the gate returned", async () => {
    await renderPage();

    expect(screen.getByText(/Signed in as Ken Suenobu/)).toBeInTheDocument();
  });

  it("renders nothing at all when the gate redirects instead of returning", async () => {
    // `redirect()` signals by throwing, so a request with no session or no chosen workspace
    // never reaches the markup below it.
    requireWorkspace.mockRejectedValue(new Error("NEXT_REDIRECT /login"));

    await expect(Page()).rejects.toThrow("NEXT_REDIRECT /login");
  });
});
