import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { workflowCodePath } from "@/app/paths";
import { STUDIO_EYEBROW } from "@/app/workflows/view";

import { membership, sessionUser } from "../../helpers/login";
import { codeReadings } from "../../helpers/workflow-code";

/**
 * The code route (V.1, #169) and the layout it shares with the visual editor.
 *
 * The route is three lines, and this suite is about all three — the gate first, the slug the URL
 * carried handed to the reader, what the reader returned drawn — and about the two criteria that
 * live in those lines: **a deep link straight to the code route works, including on first load**
 * (nothing here depends on having arrived from Visual), and **role gates match the visual
 * editor** (the same `mayAdminister`, from the same membership).
 */

/** What the gate answers this case with, or the signal it throws instead. */
const requireWorkspace = vi.fn();

/** What the reader answers with. */
const readStudioCode = vi.fn();

vi.mock("@/app/api/access", () => ({ requireWorkspace: () => requireWorkspace() }));
vi.mock("@/app/workflows/code/code-data", () => ({
  readStudioCode: (access: unknown, slug: string) => readStudioCode(access, slug),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
// The file's save is a Server Action on the server-only client (V.4, #172). Nothing here types.
vi.mock("@/app/workflows/code/code-actions", () => ({ saveCode: vi.fn(() => new Promise(() => undefined)) }));
// Publish is S.6's shared Server Action on the server-only client (V.6, #174); nothing here publishes.
vi.mock("@/app/workflows/draft-actions", () => ({ publishWorkflow: vi.fn() }));

const CodePage = (await import("@/app/(app)/workflows/[slug]/code/page")).default;
const WorkflowLayout = (await import("@/app/(app)/workflows/[slug]/layout")).default;

/**
 * The route, with its segment — `params` is a promise in this Next.
 *
 * @param slug What the URL carried.
 * @returns What the page rendered.
 */
function open(slug: string) {
  return CodePage({ params: Promise.resolve({ slug }) });
}

/**
 * What the gate hands back.
 *
 * @param roles The reader's roles.
 * @returns The workspace.
 */
function access(roles: readonly ("owner" | "admin" | "member" | "viewer")[] = ["owner"]) {
  const held = membership({ roles: [...roles] });

  return {
    session: { user: sessionUser(), memberships: [held], tenantSuggestion: null },
    membership: held,
  };
}

beforeEach(() => {
  requireWorkspace.mockReset().mockResolvedValue(access());
  readStudioCode.mockReset().mockResolvedValue(codeReadings());
});

describe("the code route", () => {
  it("asks the gate first, then hands the reader what it resolved and the slug the URL carried", async () => {
    await open("standard-fix");

    expect(requireWorkspace).toHaveBeenCalledOnce();
    expect(readStudioCode).toHaveBeenCalledExactlyOnceWith(access(), "standard-fix");
  });

  it("draws the code view on a deep link, first load and all — nothing depends on Visual having been open", async () => {
    render(await open("standard-fix"));

    const segments = screen.getByRole("navigation", { name: STUDIO_EYEBROW });

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("standard-fix.loop.ts");
    expect(within(segments).getByRole("link", { name: "Code" })).toHaveAttribute(
      "href",
      workflowCodePath("standard-fix"),
    );
    expect(within(segments).getByRole("link", { name: "Code" })).toHaveAttribute("aria-current", "page");
  });

  it("reads nothing at all when the gate redirects instead of returning", async () => {
    requireWorkspace.mockRejectedValue(new Error("NEXT_REDIRECT /login"));

    await expect(open("standard-fix")).rejects.toThrow("NEXT_REDIRECT /login");
    expect(readStudioCode).not.toHaveBeenCalled();
  });

  it("lets a redirect raised during the read through, rather than drawing around it", async () => {
    readStudioCode.mockRejectedValue(new Error("NEXT_REDIRECT /login"));

    await expect(open("standard-fix")).rejects.toThrow("NEXT_REDIRECT /login");
  });
});

describe("the role, decided at the gate as the visual editor decides it", () => {
  it("offers an owner Publish and no read-only note", async () => {
    render(await open("standard-fix"));

    expect(screen.getByRole("button", { name: "Publish v15" })).toBeInTheDocument();
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("lets a member reach the route read-only: the file, no Publish, the role named", async () => {
    requireWorkspace.mockResolvedValue(access(["member"]));

    render(await open("standard-fix"));

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("standard-fix.loop.ts");
    expect(screen.queryByRole("button", { name: /^Publish v/ })).toBeNull();
    expect(screen.getByRole("note")).toHaveTextContent("Viewing the studio as a member.");
  });
});

describe("the layout both editors share", () => {
  it("draws its page, inside the guard — and nothing else", () => {
    const { container } = render(
      <WorkflowLayout>
        <p>the editor</p>
      </WorkflowLayout>,
    );

    expect(screen.getByText("the editor")).toBeInTheDocument();
    expect(container.children).toHaveLength(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
