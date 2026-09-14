import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WORKFLOWS_PATH, workflowCodePath, workflowPath } from "@/app/paths";
import {
  CODE_LOADING_LABEL,
  CODE_SKELETON_ACTIONS,
  CodeSkeleton,
} from "@/app/workflows/code/code-skeleton";
import { CODE_NEEDS_WORKFLOW_NOTE, STUDIO_EYEBROW } from "@/app/workflows/view";

import { renderInBothPalettes } from "../../helpers/palettes";

/**
 * The code view's skeleton (V.1, #169): the studio's frame in the code view's shape while the
 * reads are in flight — Code current, two actions, one file card, no rail.
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

describe("below the control", () => {
  it("stands in for the file card, hidden from the accessibility tree, with no rail", () => {
    const { container } = render(<CodeSkeleton slug="standard-fix" />);

    expect(container.querySelector(".code-skeleton__file")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector(".studio-skeleton__rail")).toBeNull();
  });
});

describe("both palettes", () => {
  it("draws the same markup in both", () => {
    const [light, dark] = renderInBothPalettes(<CodeSkeleton slug="standard-fix" />);

    expect(light).toBe(dark);
  });
});
