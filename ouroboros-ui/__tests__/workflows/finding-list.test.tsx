import { fireEvent, render, screen, within } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { describe, expect, it, vi } from "vitest";

import type { WorkflowFinding } from "@/app/api/workflows";
import { FINDINGS_LABEL } from "@/app/workflows/publish";

import { securityPatchDefinition } from "../helpers/workflow-copilot";

// `next/link` wants the App Router; an anchor carries everything asserted here.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a {...rest} href={href}>
      {children}
    </a>
  ),
}));

const { FindingList } = await import("@/app/workflows/finding-list");

/**
 * The validation findings list's two ways of being anchored (S.6, #152; CE.1, #565).
 *
 * On the canvas and in the code view an anchored finding is a **button** that selects its stage —
 * unchanged. On the copilot it is a **link** to the stage's row, which is the ticket's *validation
 * findings anchor to the corresponding stage rows*. A finding about the document as a whole is
 * text either way.
 */

const FINDINGS: readonly WorkflowFinding[] = [
  { source: "dsl", code: "node.missing_task", message: "The stage names no task.", node: "patch" },
  { source: "engine", code: "graph.no_terminal", message: "The graph has no terminal stage." },
  { source: "registry", code: "node.unknown", message: "No such stage.", node: "gone" },
];

describe("on the canvas and in the code view", () => {
  it("draws an anchored finding as a button that selects its stage — as before", () => {
    const onSelect = vi.fn();
    render(<FindingList definition={securityPatchDefinition()} findings={FINDINGS} onSelect={onSelect} />);

    const list = screen.getByRole("list", { name: FINDINGS_LABEL });
    const button = within(list).getByRole("button");

    expect(button).toHaveTextContent("Select Patch the dependency");
    expect(within(list).queryByRole("link")).toBeNull();

    fireEvent.click(button);

    expect(onSelect).toHaveBeenCalledExactlyOnceWith("patch");
  });
});

describe("on the copilot", () => {
  /** Render with the copilot's anchoring. */
  function renderLinked(onSelect = vi.fn()) {
    render(
      <FindingList
        definition={securityPatchDefinition()}
        findings={FINDINGS}
        onSelect={onSelect}
        stageHref={(id) => `#stage-${id}`}
        target={(title) => `Go to stage ${title}`}
      />,
    );

    return onSelect;
  }

  it("draws an anchored finding as a link to its stage's row, saying which validator raised it", () => {
    renderLinked();

    const link = within(screen.getByRole("list", { name: FINDINGS_LABEL })).getByRole("link");

    expect(link).toHaveAttribute("href", "#stage-patch");
    expect(link).toHaveTextContent("DSL");
    expect(link).toHaveTextContent("The stage names no task.");
    expect(link).toHaveTextContent("Go to stage Patch the dependency");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("still tells the page which stage was followed, so a dialog can close behind the press", () => {
    const onSelect = renderLinked();

    fireEvent.click(screen.getByRole("link"));

    expect(onSelect).toHaveBeenCalledExactlyOnceWith("patch");
  });

  it("lists a finding with no stage the draft holds as text — there is no row to lead to", () => {
    renderLinked();

    const list = screen.getByRole("list", { name: FINDINGS_LABEL });

    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(within(list).getAllByRole("link")).toHaveLength(1);
    expect(list).toHaveTextContent("The graph has no terminal stage.");
    expect(list).toHaveTextContent("No such stage.");
  });
});
