import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WORKFLOWS_PATH, workflowCodePath, workflowCopilotPath, workflowPath } from "@/app/paths";
import {
  COPILOT_LOADING_LABEL,
  COPILOT_SKELETON_ACTIONS,
  COPILOT_SKELETON_CLAIMS,
  CopilotSkeleton,
  SKELETON_ROW_CARDS,
} from "@/app/workflows/copilot/copilot-skeleton";
import {
  COPILOT_EYEBROW,
  COPILOT_MISSING_TITLE,
  COPILOT_SUBLINE,
  COPILOT_TITLE,
  DISCARD_LABEL,
  DISCARD_MEMBER_REASON,
  PROMOTE_MEMBER_REASON,
} from "@/app/workflows/copilot/copilot-view";
import { CONTROL_ROLE_REASON, RERUN_LABEL } from "@/app/workflows/copilot/dry-run";
import { SKELETON_WORKFLOWS } from "@/app/workflows/studio-skeleton";
import { COPILOT_NEEDS_WORKFLOW_NOTE, STUDIO_EYEBROW } from "@/app/workflows/view";

import { membership, sessionUser } from "../../helpers/login";
import { renderInBothPalettes } from "../../helpers/palettes";
import { copilotReadings, copilotReadingsWith, seededBoard, seededStageDraft } from "../../helpers/workflow-copilot";

/**
 * The copilot route (CE.1, #565), its loading file and the skeleton behind it.
 *
 * The route is three lines, and this suite is about all three — the gate first, the slug the URL
 * carried handed to the reader, what the reader returned drawn — and about the criteria that live
 * in those lines: **a deep link straight to the copilot works, including on first load** (nothing
 * depends on having arrived from Visual or Code), **a slug the workspace does not have is the
 * page's own state, not the framework's not-found**, and **the role gates match the other two
 * surfaces** (the same `mayAdminister`, from the same membership).
 */

/** What the gate answers this case with, or the signal it throws instead. */
const requireWorkspace = vi.fn();

/** What the reader answers with. */
const readStudioCopilot = vi.fn();

/** What the loading file's `useParams` answers. */
const params = vi.hoisted(() => ({ value: {} as Record<string, string | string[] | undefined> }));

vi.mock("@/app/api/access", () => ({ requireWorkspace: () => requireWorkspace() }));
vi.mock("@/app/workflows/copilot/copilot-data", () => ({
  readStudioCopilot: (access: unknown, slug: string) => readStudioCopilot(access, slug),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useParams: () => params.value,
}));
// Promote is S.6's shared publish action and Discard is this surface's own; nothing here presses either.
vi.mock("@/app/workflows/draft-actions", () => ({ publishWorkflow: vi.fn() }));
vi.mock("@/app/workflows/copilot/copilot-actions", () => ({ discardCopilotDraft: vi.fn() }));
// The rail's tile opens S.1's create dialog, on a Server Action; nothing here creates.
vi.mock("@/app/workflows/create-actions", () => ({ createWorkflow: vi.fn() }));
// The stage list's poll is its own suite's (`stages-card.test.tsx`); here it never asks.
vi.mock("@/app/workflows/copilot/stages-poll", async () => {
  const { inertStagesPoll } = await import("../../helpers/workflow-copilot");

  return { createStagesPoll: inertStagesPoll };
});

const CopilotPage = (await import("@/app/(app)/workflows/[slug]/copilot/page")).default;
const Loading = (await import("@/app/(app)/workflows/[slug]/copilot/loading")).default;

/**
 * The route, with its segment — `params` is a promise in this Next.
 *
 * @param slug What the URL carried.
 * @returns What the page rendered.
 */
function open(slug: string) {
  return CopilotPage({ params: Promise.resolve({ slug }) });
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

/** The segmented control. */
function segments(): HTMLElement {
  return screen.getByRole("navigation", { name: STUDIO_EYEBROW });
}

beforeEach(() => {
  requireWorkspace.mockReset().mockResolvedValue(access());
  readStudioCopilot.mockReset().mockResolvedValue(copilotReadings());
  params.value = { slug: "security-patch" };
});

describe("the copilot route", () => {
  it("asks the gate first, then hands the reader what it resolved and the slug the URL carried", async () => {
    await open("security-patch");

    expect(requireWorkspace).toHaveBeenCalledOnce();
    expect(readStudioCopilot).toHaveBeenCalledExactlyOnceWith(access(), "security-patch");
  });

  it("draws the copilot on a deep link, first load and all — nothing depends on another surface having been open", async () => {
    render(await open("security-patch"));

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(COPILOT_TITLE);
    expect(within(segments()).getByRole("link", { name: "Copilot" })).toHaveAttribute(
      "href",
      workflowCopilotPath("security-patch"),
    );
    expect(within(segments()).getByRole("link", { name: "Copilot" })).toHaveAttribute("aria-current", "page");
  });

  it("draws a slug the workspace does not have as its own state, not the framework's not-found", async () => {
    readStudioCopilot.mockResolvedValue(copilotReadings({ requested: "retired-loop", selected: null }));

    render(await open("retired-loop"));

    // The studio's head and tab row are still there to leave by.
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(COPILOT_TITLE);
    expect(screen.getByText(COPILOT_MISSING_TITLE)).toBeInTheDocument();
    expect(within(segments()).getByRole("link", { name: "Visual" })).toHaveAttribute(
      "href",
      workflowPath("retired-loop"),
    );
  });

  it("reads nothing at all when the gate redirects instead of returning", async () => {
    requireWorkspace.mockRejectedValue(new Error("NEXT_REDIRECT /login"));

    await expect(open("security-patch")).rejects.toThrow("NEXT_REDIRECT /login");
    expect(readStudioCopilot).not.toHaveBeenCalled();
  });

  it("lets a redirect raised during the read through, rather than drawing around it", async () => {
    readStudioCopilot.mockRejectedValue(new Error("NEXT_REDIRECT /login"));

    await expect(open("security-patch")).rejects.toThrow("NEXT_REDIRECT /login");
  });
});

describe("the role, decided at the gate as the other two surfaces decide it", () => {
  it.each(["owner", "admin"] as const)("offers an %s both actions live, and no read-only note", async (role) => {
    requireWorkspace.mockResolvedValue(access([role]));

    render(await open("security-patch"));

    expect(screen.getByRole("button", { name: "Promote draft → security-patch v1" })).not.toHaveAttribute(
      "aria-disabled",
    );
    expect(screen.getByRole("button", { name: DISCARD_LABEL })).not.toHaveAttribute("aria-disabled");
    expect(screen.queryByText(/Viewing the studio as/)).toBeNull();
  });

  it.each(["member", "viewer"] as const)(
    "lets a %s reach the route read-only: both actions inert with the reason, the role named",
    async (role) => {
      requireWorkspace.mockResolvedValue(access([role]));

      render(await open("security-patch"));

      expect(screen.getByRole("button", { name: "Promote draft → security-patch v1" })).toHaveAttribute(
        "title",
        PROMOTE_MEMBER_REASON,
      );
      expect(screen.getByRole("button", { name: DISCARD_LABEL })).toHaveAttribute("title", DISCARD_MEMBER_REASON);
      expect(screen.getByText(`Viewing the studio as a ${role}.`)).toBeInTheDocument();
    },
  );
});

describe("who may dry-run, decided at the same gate (#568)", () => {
  /** The readings with the seeded dry run and a draft that has stages. */
  function withDryRun() {
    return copilotReadingsWith({
      draft: { ok: true, value: seededStageDraft() },
      dryRun: { ok: true, value: seededBoard() },
    });
  }

  it.each(["owner", "admin", "member"] as const)("lets an %s re-run the dry run — contributors, not only admins", async (role) => {
    requireWorkspace.mockResolvedValue(access([role]));
    readStudioCopilot.mockResolvedValue(withDryRun());

    render(await open("security-patch"));

    expect(screen.getByRole("button", { name: RERUN_LABEL })).not.toHaveAttribute("aria-disabled");
  });

  it("shows a viewer the same card with its controls inert, and the reason", async () => {
    requireWorkspace.mockResolvedValue(access(["viewer"]));
    readStudioCopilot.mockResolvedValue(withDryRun());

    render(await open("security-patch"));

    expect(screen.getByRole("button", { name: RERUN_LABEL })).toHaveAttribute("title", CONTROL_ROLE_REASON);
    expect(screen.getAllByRole("listitem").length).toBeGreaterThan(0);
  });
});

describe("the route's loading file", () => {
  it("draws the skeleton, open on the workflow the URL names", () => {
    render(<Loading />);

    expect(screen.getByRole("main", { name: COPILOT_LOADING_LABEL })).toHaveAttribute("aria-busy", "true");
    expect(within(segments()).getByRole("link", { name: "Copilot" })).toHaveAttribute(
      "href",
      workflowCopilotPath("security-patch"),
    );
    expect(within(segments()).getByRole("link", { name: "Copilot" })).toHaveAttribute("aria-current", "page");
    expect(within(segments()).getByRole("link", { name: "Visual" })).toHaveAttribute(
      "href",
      workflowPath("security-patch"),
    );
    expect(within(segments()).getByRole("link", { name: "Code" })).toHaveAttribute(
      "href",
      workflowCodePath("security-patch"),
    );
  });

  it("falls back to no workflow when the params carry no single slug", () => {
    params.value = { slug: ["a", "b"] };
    render(<Loading />);

    expect(within(segments()).getByRole("link", { name: "Visual" })).toHaveAttribute("href", WORKFLOWS_PATH);
    expect(within(segments()).getByTitle(`Copilot — ${COPILOT_NEEDS_WORKFLOW_NOTE}`).tagName).toBe("SPAN");
    expect(within(segments()).queryByRole("link", { name: "Copilot" })).toBeNull();
    expect(segments()).not.toHaveTextContent(/soon/);
  });
});

describe("the skeleton", () => {
  it("draws the head as itself — it is copy, so nothing moves when the reads land", () => {
    render(<CopilotSkeleton slug="security-patch" />);

    expect(screen.getByText(COPILOT_EYEBROW, { selector: ".ou-eyebrow" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(COPILOT_TITLE);
    expect(screen.getByText(COPILOT_SUBLINE, { selector: ".studio__sub" })).toBeInTheDocument();
  });

  it("reserves the two actions, the rail and a skeleton for each of the four cards, in the page's own layout classes", () => {
    const { container } = render(<CopilotSkeleton slug="security-patch" />);

    expect(container.querySelectorAll(".studio-skeleton__action")).toHaveLength(COPILOT_SKELETON_ACTIONS);
    expect(COPILOT_SKELETON_ACTIONS).toBe(2);
    expect(container.querySelectorAll(".studio-skeleton__item")).toHaveLength(SKELETON_WORKFLOWS);
    expect(container.querySelectorAll(".copilot-view__body > .copilot-view__skeleton-seat")).toHaveLength(1);
    expect(container.querySelectorAll(".copilot-view__side > .copilot-view__skeleton-seat")).toHaveLength(3);
  });

  it("draws each card's skeleton in the card's own shape (#569)", () => {
    const { container } = render(<CopilotSkeleton slug="security-patch" />);
    const [stages, dryRun, safety] = container.querySelectorAll(".copilot-view__side > .copilot-view__skeleton-seat");

    // The conversation: a heading, two bubbles — one from each side — and the composer.
    const conversation = container.querySelector(".copilot-view__skeleton-seat--conversation");
    expect(conversation?.querySelectorAll(".copilot-view__skeleton-bubble")).toHaveLength(2);
    expect(conversation?.querySelectorAll(".copilot-view__skeleton-bubble--user")).toHaveLength(1);
    expect(conversation?.querySelectorAll(".copilot-view__skeleton-composer")).toHaveLength(1);

    // The stage list and the dry run: a heading over rows.
    expect(stages?.querySelectorAll(".copilot-view__skeleton-row")).toHaveLength(SKELETON_ROW_CARDS[0]!.rows);
    expect(dryRun?.querySelectorAll(".copilot-view__skeleton-row")).toHaveLength(SKELETON_ROW_CARDS[1]!.rows);

    // The safety strip: a heading over mockup 20's three columns.
    expect(safety?.querySelectorAll(".copilot-view__skeleton-column")).toHaveLength(COPILOT_SKELETON_CLAIMS);
    expect(COPILOT_SKELETON_CLAIMS).toBe(3);

    // Every card has its heading's bar.
    expect(container.querySelectorAll(".copilot-view__skeleton-title")).toHaveLength(4);
  });

  it("says one thing to a screen reader: the bars are hidden and no button is drawn", () => {
    const { container } = render(<CopilotSkeleton slug="security-patch" />);

    expect(container.querySelector(".studio__grid")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector(".studio-skeleton__actions")).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("draws the same markup in both palettes", () => {
    const [light, dark] = renderInBothPalettes(<CopilotSkeleton slug="security-patch" />);

    expect(light).toBe(dark);
  });
});
