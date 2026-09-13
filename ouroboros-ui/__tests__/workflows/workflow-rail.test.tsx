import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { workflowPath } from "@/app/paths";
import { NEW_WORKFLOW_LABEL, RAIL_LABEL } from "@/app/workflows/view";

import { PALETTES, renderInBothPalettes, renderInPalette } from "../helpers/palettes";
import { seededRail } from "../helpers/workflows";

/**
 * The rail as it is drawn (#147) — mockup 04's `.wf-list`, from the seeded rail.
 *
 * The acceptance criterion this suite exists for, in the ticket's words: **the seeded rail
 * matches the mockup's five entries and their states, including the paused err-dot.** The
 * entries are the seed's read through P.4's captions (`__tests__/helpers/workflows.ts` says
 * which two strings differ from the mockup and why); what is asserted here is that the rail
 * draws them as served, lights the selected one, and marks the paused one.
 */

// The tile at the rail's foot owns a dialog whose action sits on the server-only client and
// whose router wants the App Router; both are `new-workflow.test.tsx`'s subject.
vi.mock("@/app/workflows/create-actions", () => ({ createWorkflow: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const { WorkflowRail } = await import("@/app/workflows/workflow-rail");

/** The rail, as the rendered navigation region. */
function rail(): HTMLElement {
  return screen.getByRole("navigation", { name: RAIL_LABEL });
}

describe("the seeded rail", () => {
  it("lists the mockup's five workflows, in the mockup's order", () => {
    render(<WorkflowRail activeSlug="standard-fix" entries={seededRail()} mayAdminister />);

    expect(
      within(rail())
        .getAllByRole("link")
        .map((link) => link.querySelector(".studio-rail__name")?.textContent),
    ).toEqual(["standard-fix", "feature-loop", "deps-refresh", "docs-loop", "hotfix-p0"]);
  });

  it("prints each caption exactly as the service composed it", () => {
    render(<WorkflowRail activeSlug="standard-fix" entries={seededRail()} mayAdminister />);

    expect(
      within(rail())
        .getAllByRole("link")
        .map((link) => link.querySelector(".studio-rail__caption")?.textContent),
    ).toEqual([
      "12 stages · auto-merge",
      "7 stages · auto-merge",
      "5 stages · needs review",
      "4 stages · auto-merge",
      "5 stages · paused",
    ]);
  });

  it("links each workflow to its own studio URL, so a workflow is linkable", () => {
    render(<WorkflowRail activeSlug="standard-fix" entries={seededRail()} mayAdminister />);

    expect(within(rail()).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(
      seededRail().map((entry) => workflowPath(entry.slug)),
    );
  });

  it("lights the selected workflow with the accent treatment and says so to a screen reader", () => {
    render(<WorkflowRail activeSlug="deps-refresh" entries={seededRail()} mayAdminister />);

    const current = within(rail()).getByRole("link", { current: "page" });

    expect(current).toHaveTextContent("deps-refresh");
    expect(current).toHaveClass("studio-rail__item--active");
    expect(rail().querySelectorAll(".studio-rail__item--active")).toHaveLength(1);
  });

  it("lights nothing when nothing is selected", () => {
    render(<WorkflowRail activeSlug={null} entries={seededRail()} mayAdminister />);

    expect(within(rail()).queryByRole("link", { current: "page" })).toBeNull();
    expect(rail().querySelectorAll(".studio-rail__item--active")).toHaveLength(0);
  });

  it("draws the err-dot beside hotfix-p0 and beside nothing else", () => {
    // The mockup's one paused entry. The dot is decoration — its caption says *paused* in words —
    // and is hidden from the accessibility tree, so hue is never the only signal.
    render(<WorkflowRail activeSlug="standard-fix" entries={seededRail()} mayAdminister />);

    const dots = rail().querySelectorAll(".studio-rail__dot");

    expect(dots).toHaveLength(1);
    expect(dots[0]).toHaveAttribute("aria-hidden", "true");
    expect(dots[0]?.closest("a")).toHaveTextContent("hotfix-p0");
    expect(dots[0]?.closest("a")).toHaveTextContent("paused");
  });

  it("ends with the dashed + New workflow tile", () => {
    render(<WorkflowRail activeSlug="standard-fix" entries={seededRail()} mayAdminister />);

    const tile = within(rail()).getByRole("button", { name: NEW_WORKFLOW_LABEL });

    expect(tile).toHaveClass("studio-rail__new");
    expect(tile).not.toHaveAttribute("aria-disabled");
  });

  it("draws the tile inert for a member, with the reason", () => {
    render(
      <WorkflowRail activeSlug="standard-fix" entries={seededRail()} mayAdminister={false} />,
    );

    expect(within(rail()).getByRole("button", { name: NEW_WORKFLOW_LABEL })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });
});

describe("an empty rail", () => {
  it("draws no list at all, and still the tile, which is the way out", () => {
    render(<WorkflowRail activeSlug={null} entries={[]} mayAdminister />);

    expect(within(rail()).queryByRole("list")).toBeNull();
    expect(within(rail()).queryByRole("link")).toBeNull();
    expect(within(rail()).getByRole("button", { name: NEW_WORKFLOW_LABEL })).toBeInTheDocument();
  });
});

describe("both palettes", () => {
  it.each(PALETTES)("renders in the %s palette", (palette) => {
    renderInPalette(
      palette,
      <WorkflowRail activeSlug="standard-fix" entries={seededRail()} mayAdminister />,
    );

    expect(document.documentElement).toHaveAttribute("data-theme", palette);
    expect(within(rail()).getAllByRole("link")).toHaveLength(5);
  });

  it("draws the same markup in both, because the palette is CSS's business", () => {
    const [light, dark] = renderInBothPalettes(
      <WorkflowRail activeSlug="standard-fix" entries={seededRail()} mayAdminister />,
    );

    expect(light).toBe(dark);
  });
});
