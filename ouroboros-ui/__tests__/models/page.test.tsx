import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { membership, sessionUser } from "../helpers/login";
import { readings } from "../helpers/models";

/**
 * The routing page's route (#200).
 *
 * It is three lines, and this suite is about all three: the gate is asked first, what it
 * returns is what the reader is given, and what the reader returns is what the screen draws.
 * Everything else the page could be judged on — the chips, the tab set, the two inert
 * actions — is covered where it is decided, which is why this file is short rather than a
 * second copy of `models-screen.test.tsx`.
 *
 * Both collaborators are replaced: `requireWorkspace()` has its own suite
 * (`__tests__/api/access.test.ts`) and so does the reader, and driving either through this
 * route would test them a second time while testing the wiring not at all.
 */

/** What the gate answers this case with, or the signal it throws instead. */
const requireWorkspace = vi.fn();

/** What the reader answers with. */
const readModels = vi.fn();

vi.mock("@/app/api/access", () => ({ requireWorkspace: () => requireWorkspace() }));
vi.mock("@/app/models/data", () => ({ readModels: (access: unknown) => readModels(access) }));
// The rules card's actions sit on the server-only client and its rows want the App Router;
// both are other suites' subjects.
vi.mock("@/app/models/rule-actions", () => ({
  setRuleEnabled: vi.fn(),
  addRule: vi.fn(),
  removeRule: vi.fn(),
  readRuleTargets: vi.fn(),
}));
vi.mock("@/app/models/route-actions", () => ({ saveRoutes: vi.fn() }));
vi.mock("@/app/models/simulate-actions", () => ({ simulateRoute: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const Page = (await import("@/app/(app)/models/page")).default;

/**
 * The route, with a query.
 *
 * `searchParams` is a promise in this Next, and every case but the selection ones passes an
 * empty one — which is what a `/models` with no query resolves to.
 *
 * @param query What the URL carried.
 * @returns What the page rendered.
 */
function open(query: Record<string, string | string[] | undefined> = {}) {
  return Page({ searchParams: Promise.resolve(query) });
}

/** What the gate hands back, in the seeded world. */
const ACCESS = {
  session: { user: sessionUser(), memberships: [membership()], tenantSuggestion: null },
  membership: membership(),
};

beforeEach(() => {
  requireWorkspace.mockReset().mockResolvedValue(ACCESS);
  readModels.mockReset().mockResolvedValue(readings());
});

describe("the routing route", () => {
  it("asks the gate before it reads anything", async () => {
    // "Unauthenticated `(app)` routes redirect to the login screen" is true because of this
    // call, not because of a check in the layout — see `app/(app)/layout.tsx` for why.
    render(await open());

    expect(requireWorkspace).toHaveBeenCalledOnce();
  });

  it("hands the reader exactly what the gate resolved, rather than resolving it again", async () => {
    // The page's authorization and the page's data are one decision. The reader dereferences
    // nothing off it, which is the point: taking it is what makes the gate unskippable.
    await open();

    expect(readModels).toHaveBeenCalledExactlyOnceWith(ACCESS);
  });

  it("draws what the reader returned", async () => {
    render(await open());

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Route every kind of work",
    );
    expect(screen.getByRole("list", { name: "Provider health" })).toBeInTheDocument();
  });

  it("reads nothing at all when the gate redirects instead of returning", async () => {
    // `redirect()` signals by throwing, so a request with no session or no chosen workspace
    // never reaches the read — which is what keeps a signed-out visitor from costing a call
    // to a service that would refuse it.
    requireWorkspace.mockRejectedValue(new Error("NEXT_REDIRECT /login"));

    await expect(open()).rejects.toThrow("NEXT_REDIRECT /login");
    expect(readModels).not.toHaveBeenCalled();
  });

  it("lets a redirect raised during the read through, rather than drawing around it", async () => {
    // A session that expired between the gate and the call still reaches the login screen.
    readModels.mockRejectedValue(new Error("NEXT_REDIRECT /login"));

    await expect(open()).rejects.toThrow("NEXT_REDIRECT /login");
  });

  it("renders the frame even when a read it makes failed", async () => {
    // The route has no freshness boundary and needs none: the strip degrades in place, and
    // the page around it is not built from that read.
    readModels.mockResolvedValue(readings({ providers: { ok: false, reason: "Down." } }));

    render(await open());

    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(screen.getByText("Down.")).toBeInTheDocument();
    // …and the matrix, which is a different read, is still drawn.
    expect(screen.getByRole("grid")).toBeInTheDocument();
  });
});

describe("the selected route, which the URL carries", () => {
  it("selects the row `?route=` names", async () => {
    // The server half of *a selected route survives a reload*: the parameter is read here, so
    // the very first paint already has the right row selected. A client component reading it
    // would render an unselected matrix first.
    render(await open({ route: "implement" }));

    expect(screen.getByRole("row", { selected: true })).toHaveTextContent("implement");
  });

  it("selects nothing when the URL names nothing", async () => {
    render(await open());

    expect(screen.queryByRole("row", { selected: true })).not.toBeInTheDocument();
  });

  it("selects nothing when the URL names a kind this workspace does not have", async () => {
    // A URL is input. A `?route=` naming a kind nobody configured must not put a name nobody
    // can act on into the inspector's title.
    render(await open({ route: "deploy" }));

    expect(screen.queryByRole("row", { selected: true })).not.toBeInTheDocument();
  });

  it("selects nothing when the parameter is repeated, because two answers are not an answer", async () => {
    render(await open({ route: ["implement", "review"] }));

    expect(screen.queryByRole("row", { selected: true })).not.toBeInTheDocument();
  });
});

describe("the role the route decides (#204)", () => {
  it("hands the screen the controls when the gate resolved an owner", async () => {
    // Not a constant that happens to match the seed: change the roles the gate resolves and
    // the page changes with them.
    render(await open());

    expect(screen.getAllByRole("switch")).toHaveLength(3);
  });

  it("hands a member the page with nothing to press", async () => {
    requireWorkspace.mockResolvedValue({
      ...ACCESS,
      membership: membership({ roles: ["member"] }),
    });

    render(await open());

    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ Add rule" })).not.toBeInTheDocument();
    // …and still the rules themselves, which any member may read.
    expect(screen.getByText("3 active")).toBeInTheDocument();
  });

  it("treats a viewer as a member for this purpose", async () => {
    requireWorkspace.mockResolvedValue({
      ...ACCESS,
      membership: membership({ roles: ["viewer"] }),
    });

    render(await open());

    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });
});
