import { render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { membership, sessionUser } from "../helpers/login";
import { shimReactFlow } from "../helpers/react-flow";
import { readings } from "../helpers/workflows";

/**
 * The studio's two routes (#147): the landing, and a workflow by slug.
 *
 * Each is three lines, and this suite is about all three: the gate is asked first, what it
 * returns is what the reader is given — with the slug the URL carried, or none — and what the
 * reader returns is what the screen draws. Everything else the page could be judged on — the
 * subline, the control, the rail, the actions — is covered where it is decided, which is why
 * this file is short rather than a second copy of `studio-screen.test.tsx`.
 *
 * Both collaborators are replaced: `requireWorkspace()` has its own suite
 * (`__tests__/api/access.test.ts`) and so does the reader, and driving either through this
 * route would test them a second time while testing the wiring not at all.
 */

/** What the gate answers this case with, or the signal it throws instead. */
const requireWorkspace = vi.fn();

/** What the reader answers with. */
const readStudio = vi.fn();

vi.mock("@/app/api/access", () => ({ requireWorkspace: () => requireWorkspace() }));
vi.mock("@/app/workflows/data", () => ({
  readStudio: (access: unknown, slug: string | null) => readStudio(access, slug),
}));
// The tile's dialog sits on the server-only client and wants the App Router; the failed
// banner wants the router too. Both are other suites' subjects.
vi.mock("@/app/workflows/create-actions", () => ({ createWorkflow: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

// The populated page mounts the React Flow canvas (#148), which measures — see the helper.
beforeAll(() => {
  shimReactFlow();
});

const Landing = (await import("@/app/(app)/workflows/page")).default;
const BySlug = (await import("@/app/(app)/workflows/[slug]/page")).default;

/**
 * The slug route, with its segment.
 *
 * `params` is a promise in this Next, as `searchParams` is on the routing page.
 *
 * @param slug What the URL carried.
 * @returns What the page rendered.
 */
function openSlug(slug: string) {
  return BySlug({ params: Promise.resolve({ slug }) });
}

/** What the gate hands back, in the seeded world. */
const ACCESS = {
  session: { user: sessionUser(), memberships: [membership()], tenantSuggestion: null },
  membership: membership(),
};

beforeEach(() => {
  requireWorkspace.mockReset().mockResolvedValue(ACCESS);
  readStudio.mockReset().mockResolvedValue(readings());
});

describe("the landing", () => {
  it("asks the gate before it reads anything", async () => {
    // "Unauthenticated `(app)` routes redirect to the login screen" is true because of this
    // call, not because of a check in the layout — see `app/(app)/layout.tsx` for why.
    render(await Landing());

    expect(requireWorkspace).toHaveBeenCalledOnce();
  });

  it("hands the reader what the gate resolved, and no slug — the rail's first entry is the one", async () => {
    await Landing();

    expect(readStudio).toHaveBeenCalledExactlyOnceWith(ACCESS, null);
  });

  it("draws what the reader returned", async () => {
    render(await Landing());

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("standard-fix");
    expect(screen.getByRole("navigation", { name: "Workflows" })).toBeInTheDocument();
  });

  it("reads nothing at all when the gate redirects instead of returning", async () => {
    // `redirect()` signals by throwing, so a request with no session or no chosen workspace
    // never reaches the read.
    requireWorkspace.mockRejectedValue(new Error("NEXT_REDIRECT /login"));

    await expect(Landing()).rejects.toThrow("NEXT_REDIRECT /login");
    expect(readStudio).not.toHaveBeenCalled();
  });

  it("lets a redirect raised during the read through, rather than drawing around it", async () => {
    readStudio.mockRejectedValue(new Error("NEXT_REDIRECT /login"));

    await expect(Landing()).rejects.toThrow("NEXT_REDIRECT /login");
  });

  it("renders the frame even when the reads it makes failed", async () => {
    readStudio.mockResolvedValue(readings({ rail: { ok: false, reason: "Down." }, selected: null }));

    render(await Landing());

    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(screen.getByText("Down.")).toBeInTheDocument();
  });
});

describe("a workflow by slug", () => {
  it("hands the reader the slug the URL carried", async () => {
    await openSlug("docs-loop");

    expect(readStudio).toHaveBeenCalledExactlyOnceWith(ACCESS, "docs-loop");
  });

  it("asks the gate first, and reads nothing when it redirects", async () => {
    requireWorkspace.mockRejectedValue(new Error("NEXT_REDIRECT /login"));

    await expect(openSlug("docs-loop")).rejects.toThrow("NEXT_REDIRECT /login");
    expect(readStudio).not.toHaveBeenCalled();
  });

  it("draws what the reader returned", async () => {
    render(await openSlug("standard-fix"));

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("standard-fix");
  });

  it("draws the studio's own missing state, inside the shell, for a slug the rail does not hold", async () => {
    // Not `notFound()`: the framework's boundary would replace the pane with a page that has
    // no rail on it, and the rail is what a reader who followed a stale link needs next.
    readStudio.mockResolvedValue(readings({ requested: "gone", selected: null }));

    render(await openSlug("gone"));

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("No such workflow");
    expect(screen.getByRole("navigation", { name: "Workflows" })).toBeInTheDocument();
  });
});

describe("the role the routes decide", () => {
  it("hands the screen the controls when the gate resolved an owner", async () => {
    render(await Landing());

    expect(screen.getByRole("button", { name: "Publish v15" })).toBeInTheDocument();
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("hands a member the page with no Publish, and names the role", async () => {
    requireWorkspace.mockResolvedValue({ ...ACCESS, membership: membership({ roles: ["member"] }) });

    render(await openSlug("standard-fix"));

    expect(screen.queryByRole("button", { name: /^Publish v/ })).toBeNull();
    expect(screen.getByRole("note")).toHaveTextContent("Viewing the studio as a member.");
  });

  it("treats a viewer as a member for this purpose", async () => {
    requireWorkspace.mockResolvedValue({ ...ACCESS, membership: membership({ roles: ["viewer"] }) });

    render(await Landing());

    expect(screen.queryByRole("button", { name: /^Publish v/ })).toBeNull();
    expect(screen.getByRole("note")).toHaveTextContent("Viewing the studio as a viewer.");
  });
});
