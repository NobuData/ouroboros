import { EditorView } from "@codemirror/view";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { workflowCodePath, workflowPath } from "@/app/paths";
import {
  CODE_FAILED_HEADLINE,
  CODE_SEAT_EMPTY_TITLE,
  CODE_SEAT_MISSING_TITLE,
  CODE_SEAT_NOTHING_TITLE,
  CODE_SEAT_UNREAD_NOTE,
  CODE_SUBLINE,
  FILE_LABEL,
  FILE_READ_ONLY_NOTE,
  FILE_UNSAVED_NOTE,
  UNPROJECTABLE_ACTION,
  UNPROJECTABLE_TITLE,
  VALIDATE_LABEL,
  VALIDATE_SOON,
} from "@/app/workflows/code/code-view";
import {
  EMPTY_TITLE,
  FAILED_TITLE,
  MISSING_TITLE,
  RAIL_FAILED_HEADLINE,
  SEAT_FAILED_NOTE,
} from "@/app/workflows/states";
import { COPILOT_SOON_NOTE, PUBLISH_SOON, STUDIO_EYEBROW } from "@/app/workflows/view";

import { PALETTES, renderInBothPalettes, renderInPalette } from "../../helpers/palettes";
import {
  STANDARD_FIX_TEXT,
  codeReadings,
  unprojectableReadings,
  workflowCode,
} from "../../helpers/workflow-code";
import { railEntry } from "../../helpers/workflows";

/**
 * The code view as it is drawn (V.1, #169) — `docs/mockups/05-workflow-code.html`'s head and
 * segmented control over the workflow's file.
 *
 * The acceptance criteria this suite exists for, in the ticket's words: the **head per the
 * mockup** (h1 `<slug>.loop.ts`, the subline verbatim, Visual and Code both live); **role gates
 * match the visual editor — a member reaches the route read-only**; **Copilot is visibly
 * disabled and labelled "soon"**; **both themes**; and **shell: mounts in the content pane**.
 * The decisions behind every sentence are `code-view.test.ts`'s; the guard on a switch is
 * `mode-guard.test.tsx`'s.
 */

// The failed banner's retry wants the App Router.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const { CodeScreen } = await import("@/app/workflows/code/code-screen");

/** The head's `<h1>`. */
function title(): HTMLElement {
  return screen.getByRole("heading", { level: 1 });
}

/** The segmented control. */
function segments(): HTMLElement {
  return screen.getByRole("navigation", { name: STUDIO_EYEBROW });
}

describe("the page head, on the seeded standard-fix", () => {
  it("is mockup 05's: the eyebrow, the file name, and the subline verbatim", () => {
    render(<CodeScreen mayAdminister readings={codeReadings()} role="owner" />);

    expect(screen.getByText(STUDIO_EYEBROW, { selector: ".ou-eyebrow" })).toBeInTheDocument();
    expect(title()).toHaveTextContent(/^standard-fix\.loop\.ts$/);
    expect(screen.getByText(CODE_SUBLINE, { selector: ".studio__sub" })).toBeInTheDocument();
  });

  it("draws the mockup's two actions — Validate and Publish v15 — each inert with the issue it waits for", () => {
    const { container } = render(
      <CodeScreen mayAdminister readings={codeReadings()} role="owner" />,
    );

    const validate = screen.getByRole("button", { name: VALIDATE_LABEL });
    const publish = screen.getByRole("button", { name: "Publish v15" });

    for (const [control, reason] of [
      [validate, VALIDATE_SOON],
      [publish, PUBLISH_SOON],
    ] as const) {
      expect(control).toHaveAttribute("aria-disabled", "true");
      expect(control).toHaveAttribute("title", reason);
      expect(control).not.toBeDisabled();
    }
    expect(validate).toHaveClass("ou-btn--ghost");
    expect(publish).toHaveClass("ou-btn--primary");
    expect(container.querySelectorAll(".studio__actions button")).toHaveLength(2);
  });

  it("counts the publish label from the version in force", () => {
    render(<CodeScreen mayAdminister readings={unprojectableReadings()} role="owner" />);

    expect(screen.getByRole("button", { name: "Publish v1" })).toBeInTheDocument();
  });
});

describe("the segmented control", () => {
  it("marks Code current on this workflow's file, and links Visual to its canvas", () => {
    render(<CodeScreen mayAdminister readings={codeReadings()} role="owner" />);

    const visual = within(segments()).getByRole("link", { name: "Visual" });
    const code = within(segments()).getByRole("link", { name: "Code" });

    expect(code).toHaveAttribute("aria-current", "page");
    expect(code).toHaveAttribute("href", workflowCodePath("standard-fix"));
    expect(visual).not.toHaveAttribute("aria-current");
    expect(visual).toHaveAttribute("href", workflowPath("standard-fix"));
  });

  it("draws Copilot visibly disabled and labelled soon", () => {
    render(<CodeScreen mayAdminister readings={codeReadings()} role="owner" />);

    const copilot = within(segments()).getByTitle(`Copilot — ${COPILOT_SOON_NOTE}`);

    expect(copilot.tagName).toBe("SPAN");
    expect(copilot).toHaveTextContent(/soon/);
    expect(within(segments()).queryByRole("link", { name: /Copilot/ })).toBeNull();
  });
});

/**
 * The editor's editable region inside the file card.
 *
 * @param file The file card.
 * @returns CodeMirror's content element.
 */
function editorContent(file: HTMLElement): HTMLElement {
  const content = file.querySelector<HTMLElement>(".cm-content");
  expect(content, "the editor is mounted").not.toBeNull();
  return content as HTMLElement;
}

describe("the file", () => {
  it("opens the draft's file in the editor, editable for a role that may publish, and says it is not saved", () => {
    render(<CodeScreen mayAdminister readings={codeReadings()} role="owner" />);

    const file = screen.getByRole("region", { name: FILE_LABEL });

    expect(within(file).getByRole("heading")).toHaveTextContent("workflows/standard-fix.loop.ts");
    expect(file).toHaveTextContent("Printed from the draft");
    expect(file).toHaveTextContent(FILE_UNSAVED_NOTE);
    expect(file).not.toHaveTextContent(FILE_READ_ONLY_NOTE);

    const content = editorContent(file);

    // The editor holds the text the service printed, byte for byte, named by the file's path.
    expect(EditorView.findFromDOM(content)?.state.doc.toString()).toBe(STANDARD_FIX_TEXT);
    expect(content).toHaveAttribute("aria-label", "workflows/standard-fix.loop.ts");
    expect(content).toHaveAttribute("contenteditable", "true");
  });

  it("gives a member the read-only variant, and says so", () => {
    render(<CodeScreen readings={codeReadings()} role="member" />);

    const file = screen.getByRole("region", { name: FILE_LABEL });
    const content = editorContent(file);

    expect(file).toHaveTextContent(FILE_READ_ONLY_NOTE);
    expect(file).not.toHaveTextContent(FILE_UNSAVED_NOTE);
    expect(content).toHaveAttribute("contenteditable", "false");
    expect(content).toHaveAttribute("aria-readonly", "true");
    expect(file.querySelector(".code-editor")).toHaveClass("code-editor--read-only");
  });

  it("gives even an owner the read-only variant of a file the service marks read-only", () => {
    render(
      <CodeScreen
        mayAdminister
        readings={codeReadings({
          selected: {
            entry: railEntry(),
            file: { kind: "file", file: workflowCode({ readOnly: true, version: 14 }) },
          },
        })}
        role="owner"
      />,
    );

    const file = screen.getByRole("region", { name: FILE_LABEL });

    expect(file).toHaveTextContent(FILE_READ_ONLY_NOTE);
    expect(editorContent(file)).toHaveAttribute("contenteditable", "false");
  });

  it("says when it was printed from the version in force because no draft is open", () => {
    render(
      <CodeScreen
        mayAdminister
        readings={codeReadings({
          selected: { entry: railEntry(), file: { kind: "file", file: workflowCode({ version: 14 }) } },
        })}
        role="owner"
      />,
    );

    expect(screen.getByRole("region", { name: FILE_LABEL })).toHaveTextContent(
      "Printed from v14 · no draft open",
    );
  });
});

describe("the role", () => {
  it("lets a member reach the file read-only: no Publish, and the role explained once", () => {
    render(<CodeScreen mayAdminister={false} readings={codeReadings()} role="member" />);

    expect(screen.queryByRole("button", { name: /^Publish v/ })).toBeNull();
    expect(screen.getByRole("note")).toHaveTextContent("Viewing the studio as a member.");
    expect(screen.getByRole("region", { name: FILE_LABEL })).toBeInTheDocument();
    // Validate publishes nothing, so it is drawn for every reader, as Dry run is on Visual.
    expect(screen.getByRole("button", { name: VALIDATE_LABEL })).toBeInTheDocument();
  });

  it("defaults to the viewer's page when told nothing", () => {
    render(<CodeScreen readings={codeReadings()} />);

    expect(screen.queryByRole("button", { name: /^Publish v/ })).toBeNull();
    expect(screen.getByRole("note")).toHaveTextContent("Viewing the studio as a viewer.");
  });

  it("draws the note for nobody who may publish", () => {
    render(<CodeScreen mayAdminister readings={codeReadings()} role="admin" />);

    expect(screen.queryByRole("note")).toBeNull();
  });
});

describe("a refused rail", () => {
  const failed = codeReadings({ rail: { ok: false, reason: "Down." }, selected: null });

  it("wears the banner with the service's reason and the retry, and points the seat at it", () => {
    render(<CodeScreen mayAdminister readings={failed} role="owner" />);

    const banner = screen.getByRole("status");

    expect(banner).toHaveTextContent(RAIL_FAILED_HEADLINE);
    expect(banner).toHaveTextContent("Down.");
    expect(within(banner).getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(title()).toHaveTextContent(FAILED_TITLE);
    expect(screen.getByText(CODE_SEAT_NOTHING_TITLE)).toBeInTheDocument();
    expect(screen.getByText(SEAT_FAILED_NOTE)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: FILE_LABEL })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Publish v/ })).toBeNull();
  });
});

describe("a workspace with no workflows", () => {
  it("says so, points at the Visual tab's rail, and draws no Publish", () => {
    render(
      <CodeScreen
        mayAdminister
        readings={codeReadings({ rail: { ok: true, value: [] }, selected: null })}
        role="owner"
      />,
    );

    expect(title()).toHaveTextContent(EMPTY_TITLE);
    expect(screen.getByText(CODE_SEAT_EMPTY_TITLE)).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Publish v/ })).toBeNull();
  });
});

describe("a URL naming a workflow the rail does not hold", () => {
  const missing = codeReadings({ requested: "gone", selected: null });

  it("names the slug, and keeps both segments on the URL's own workflow", () => {
    // Visual leads to the visual editor's own *No such workflow*, which has the rail beside it.
    render(<CodeScreen mayAdminister readings={missing} role="owner" />);

    expect(title()).toHaveTextContent(MISSING_TITLE);
    expect(screen.getByText(/no workflow called "gone"/)).toBeInTheDocument();
    expect(screen.getByText(CODE_SEAT_MISSING_TITLE)).toBeInTheDocument();
    expect(within(segments()).getByRole("link", { name: "Visual" })).toHaveAttribute(
      "href",
      workflowPath("gone"),
    );
    expect(within(segments()).getByRole("link", { name: "Code" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.queryByRole("button", { name: /^Publish v/ })).toBeNull();
  });
});

describe("a file whose read was refused", () => {
  it("keeps the file name in the head, says which read failed, and still counts Publish", () => {
    render(
      <CodeScreen
        mayAdminister
        readings={codeReadings({
          selected: { entry: railEntry(), file: { kind: "failed", reason: "Refused." } },
        })}
        role="owner"
      />,
    );

    expect(title()).toHaveTextContent("standard-fix.loop.ts");

    const banner = screen.getByRole("status");

    expect(banner).toHaveTextContent(CODE_FAILED_HEADLINE);
    expect(banner).toHaveTextContent("Refused.");
    expect(screen.getByText(CODE_SEAT_UNREAD_NOTE)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish v15" })).toBeInTheDocument();
  });
});

describe("a draft with no faithful spelling as code yet", () => {
  it("says so without a banner, lists what the validator found, and leads to the canvas", () => {
    render(<CodeScreen mayAdminister readings={unprojectableReadings()} role="owner" />);

    expect(title()).toHaveTextContent("hotfix-p1.loop.ts");
    expect(screen.getByText(UNPROJECTABLE_TITLE)).toBeInTheDocument();
    expect(
      screen.getByText("This draft cannot be shown as code yet. Finish it in the visual editor first."),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "This property is required.",
      "implement: A model stage needs a route.",
    ]);
    expect(screen.getByRole("link", { name: UNPROJECTABLE_ACTION })).toHaveAttribute(
      "href",
      workflowPath("hotfix-p1"),
    );
    // Nothing failed, so there is nothing to retry.
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("region", { name: FILE_LABEL })).toBeNull();
  });
});

describe("the shell", () => {
  it("mounts in the content pane and draws no chrome of its own", () => {
    const { container } = render(
      <CodeScreen mayAdminister readings={codeReadings()} role="owner" />,
    );

    expect(screen.getByRole("main")).toHaveClass("studio");
    expect(container.querySelector(".topbar, .sidebar, .appshell")).toBeNull();
    expect(container.firstElementChild?.tagName).toBe("MAIN");
  });

  it("has one navigation region of its own — the tab row — named apart from the sidebar", () => {
    render(<CodeScreen mayAdminister readings={codeReadings()} role="owner" />);

    expect(screen.getAllByRole("navigation").map((nav) => nav.getAttribute("aria-label"))).toEqual([
      STUDIO_EYEBROW,
    ]);
  });
});

describe("both palettes", () => {
  it.each(PALETTES)("renders in the %s palette", (palette) => {
    renderInPalette(palette, <CodeScreen mayAdminister readings={codeReadings()} role="owner" />);

    expect(document.documentElement).toHaveAttribute("data-theme", palette);
    expect(title()).toHaveTextContent("standard-fix.loop.ts");
  });

  it("draws the same markup in both, because the palette is CSS's business", () => {
    const [light, dark] = renderInBothPalettes(
      <CodeScreen mayAdminister readings={codeReadings()} role="owner" />,
    );

    expect(light).toBe(dark);
  });
});
