import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WORKFLOWS_PATH, workflowCodePath, workflowPath } from "@/app/paths";
import {
  CODE_LOADING_LABEL,
  CODE_SKELETON_ACTIONS,
  CODE_SKELETON_CHECKS,
  CODE_SKELETON_FILES,
  CODE_SKELETON_OUTLINE_ROWS,
  CodeSkeleton,
} from "@/app/workflows/code/code-skeleton";
import { CODE_NEEDS_WORKFLOW_NOTE, STUDIO_EYEBROW } from "@/app/workflows/view";

import { renderInBothPalettes } from "../../helpers/palettes";

/**
 * The code view's skeleton (V.1, #169): the studio's frame in the code view's shape while the
 * reads are in flight — Code current, two actions, no rail — and, since V.7 (#175), the workbench's
 * loaded geometry on the workbench's own layout classes. `code-view-styles.test.ts` holds the bars'
 * sheet to the editor's bounded height.
 */

/** The segments the route's params carry this case. */
const params = vi.hoisted(() => ({ value: {} as Record<string, string | string[] | undefined> }));

vi.mock("next/navigation", () => ({ useParams: () => params.value }));

const Loading = (await import("@/app/(app)/workflows/[slug]/code/loading")).default;

beforeEach(() => {
  params.value = { slug: "standard-fix" };
});

describe("the route's loading file", () => {
  it("draws the skeleton, open on the workflow the URL names", () => {
    render(<Loading />);

    const segments = screen.getByRole("navigation", { name: STUDIO_EYEBROW });

    expect(screen.getByRole("main", { name: CODE_LOADING_LABEL })).toHaveAttribute("aria-busy", "true");
    expect(within(segments).getByRole("link", { name: "Code" })).toHaveAttribute(
      "href",
      workflowCodePath("standard-fix"),
    );
    expect(within(segments).getByRole("link", { name: "Code" })).toHaveAttribute("aria-current", "page");
    expect(within(segments).getByRole("link", { name: "Visual" })).toHaveAttribute(
      "href",
      workflowPath("standard-fix"),
    );
  });

  it("falls back to no workflow when the params carry no single slug", () => {
    params.value = { slug: ["a", "b"] };
    render(<Loading />);

    const segments = screen.getByRole("navigation", { name: STUDIO_EYEBROW });

    expect(within(segments).getByRole("link", { name: "Visual" })).toHaveAttribute("href", WORKFLOWS_PATH);
    expect(within(segments).getByTitle(`Code — ${CODE_NEEDS_WORKFLOW_NOTE}`).tagName).toBe("SPAN");
  });
});

describe("the head", () => {
  it("draws the title and subline as bars, and reserves mockup 05's two actions", () => {
    const { container } = render(<CodeSkeleton slug="standard-fix" />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("");
    expect(container.querySelector(".studio__title > .studio-skeleton__title")).not.toBeNull();
    expect(container.querySelector(".studio__sub > .studio-skeleton__sub")).not.toBeNull();
    expect(container.querySelectorAll(".studio-skeleton__action")).toHaveLength(CODE_SKELETON_ACTIONS);
    expect(CODE_SKELETON_ACTIONS).toBe(2);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("below the control (V.7, #175)", () => {
  /**
   * The skeleton's card.
   *
   * @param container What was rendered.
   * @returns The workbench card inside the hidden skeleton.
   */
  function card(container: HTMLElement): HTMLElement {
    const found = container.querySelector<HTMLElement>(".code-skeleton > .code-workbench.ou-card");
    expect(found, "the workbench card").not.toBeNull();
    return found as HTMLElement;
  }

  it("is hidden from the accessibility tree, prints nothing, and draws no rail", () => {
    const { container } = render(<CodeSkeleton slug="standard-fix" />);

    expect(container.querySelector(".code-skeleton")).toHaveAttribute("aria-hidden", "true");
    expect(card(container).textContent?.replace(/​/g, "")).toBe("");
    expect(container.querySelector(".studio-skeleton__rail")).toBeNull();
  });

  it("lays the workbench out on its own classes: toggles, then explorer · editor · panel, then the status bar", () => {
    const { container } = render(<CodeSkeleton slug="standard-fix" />);
    const workbench = card(container);

    expect([...workbench.children].map((child) => child.className)).toEqual([
      "code-workbench__toggles",
      "code-workbench__body",
      "code-status",
    ]);
    expect([...(workbench.querySelector(".code-workbench__body")?.children ?? [])].map((child) => child.className)).toEqual([
      "code-tree",
      "code-workbench__editor",
      "code-panel",
    ]);
  });

  it("reserves both narrow-viewport toggles at a small button's box", () => {
    const { container } = render(<CodeSkeleton slug="standard-fix" />);
    const toggles = container.querySelectorAll(".code-workbench__toggles > .code-skeleton__toggle");

    expect(toggles).toHaveLength(2);
    for (const toggle of toggles) expect(toggle).toHaveClass("ou-btn", "ou-btn--sm");
  });

  it("reserves the explorer's rows: the directory, the seeded workflows, and the configuration", () => {
    const { container } = render(<CodeSkeleton slug="standard-fix" />);
    const tree = container.querySelector(".code-tree");

    expect(tree?.querySelector(".code-tree__head .code-skeleton__bar")).not.toBeNull();
    expect(tree?.querySelectorAll(".code-tree__group > .code-tree__row")).toHaveLength(CODE_SKELETON_FILES);
    expect(tree?.querySelectorAll(".code-tree__row")).toHaveLength(CODE_SKELETON_FILES + 2);
    expect(CODE_SKELETON_FILES).toBe(5);
  });

  it("reserves one open tab, the source line, and the editor's well in the pane", () => {
    const { container } = render(<CodeSkeleton slug="standard-fix" />);
    const editor = container.querySelector(".code-workbench__editor");

    expect(editor?.querySelectorAll(".code-tabs > .code-tab.code-tab--active > .code-tab__select")).toHaveLength(1);
    expect(editor?.querySelector(".code-workbench__pane > .code-workbench__meta")).not.toBeNull();
    expect(editor?.querySelector(".code-workbench__pane > .code-skeleton__editor")).not.toBeNull();
  });

  it("reserves the right panel's three heads, the Loop Checks rows and the seeded outline", () => {
    const { container } = render(<CodeSkeleton slug="standard-fix" />);
    const panel = container.querySelector(".code-panel");

    expect(panel?.querySelectorAll(".code-panel__head")).toHaveLength(3);
    expect(panel?.querySelectorAll(".code-panel__check")).toHaveLength(CODE_SKELETON_CHECKS);
    expect(panel?.querySelectorAll(".code-panel__row")).toHaveLength(CODE_SKELETON_OUTLINE_ROWS);
    expect([CODE_SKELETON_CHECKS, CODE_SKELETON_OUTLINE_ROWS]).toEqual([2, 12]);
  });
});

describe("both palettes", () => {
  it("draws the same markup in both", () => {
    const [light, dark] = renderInBothPalettes(<CodeSkeleton slug="standard-fix" />);

    expect(light).toBe(dark);
  });
});
