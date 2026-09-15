import { EditorView } from "@codemirror/view";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { workflowCodePath, workflowPath } from "@/app/paths";
import { PANEL_LABEL, PANEL_TOGGLE_LABEL } from "@/app/workflows/code/code-panel";
import { CODE_IDLE_NOTE } from "@/app/workflows/code/code-save";
import {
  CODE_FAILED_HEADLINE,
  CODE_SEAT_EMPTY_LINE,
  CODE_SEAT_EMPTY_MEMBER_NOTE,
  CODE_SEAT_EMPTY_NOTE,
  CODE_SEAT_EMPTY_TITLE,
  CODE_SEAT_MISSING_TITLE,
  CODE_SEAT_NOTHING_TITLE,
  CODE_SEAT_UNREAD_NOTE,
  CODE_SUBLINE,
  EXPLORER_LABEL,
  EXPLORER_TOGGLE_LABEL,
  FILE_LABEL,
  FILE_READ_ONLY_NOTE,
  UNPROJECTABLE_ACTION,
  UNPROJECTABLE_TITLE,
  VALIDATE_LABEL,
} from "@/app/workflows/code/code-view";
import { PUBLISH_NEEDS_FILE, VALIDATE_NEEDS_FILE } from "@/app/workflows/code/code-flows";
import { STATUS_BAR_LABEL } from "@/app/workflows/code/code-status";
import {
  DEV_SEED_NOTE,
  EMPTY_TITLE,
  FAILED_TITLE,
  MISSING_TITLE,
  RAIL_FAILED_HEADLINE,
  READ_ONLY_BODY,
  SEAT_FAILED_NOTE,
  START_BLANK_LABEL,
} from "@/app/workflows/states";
import {
  BROWSE_TEMPLATES_LABEL,
  BROWSE_TEMPLATES_SOON,
  COPILOT_SOON_NOTE,
  STUDIO_EYEBROW,
} from "@/app/workflows/view";

import { PALETTES, maskIds, renderInBothPalettes, renderInPalette } from "../../helpers/palettes";
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
// The file's save and Validate are Server Actions (V.4, #172; V.6, #174), and Publish is S.6's shared one.
// Nothing here types, validates or publishes — the flows are `code-flows-flow.test.tsx`'s.
vi.mock("@/app/workflows/code/code-actions", () => ({
  saveCode: vi.fn(() => new Promise(() => undefined)),
  validateCode: vi.fn(() => new Promise(() => undefined)),
}));
vi.mock("@/app/workflows/draft-actions", () => ({ publishWorkflow: vi.fn(() => new Promise(() => undefined)) }));
// The empty seat's Start blank opens S.1's create dialog, on a Server Action (V.7, #175); nothing here creates.
vi.mock("@/app/workflows/create-actions", () => ({ createWorkflow: vi.fn() }));

const { CodeScreen } = await import("@/app/workflows/code/code-screen");
const { saveCode } = await import("@/app/workflows/code/code-actions");

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

  it("draws the mockup's two actions — Validate (ghost) and Publish v15 (primary) — live over a file (V.6)", () => {
    const { container } = render(
      <CodeScreen mayAdminister readings={codeReadings()} role="owner" />,
    );

    const validate = screen.getByRole("button", { name: VALIDATE_LABEL });
    const publish = screen.getByRole("button", { name: "Publish v15" });

    for (const control of [validate, publish]) {
      expect(control).not.toHaveAttribute("aria-disabled");
      expect(control).not.toHaveAttribute("title");
    }
    expect(validate).toHaveClass("ou-btn--ghost");
    expect(publish).toHaveClass("ou-btn--primary");
    expect(container.querySelectorAll(".studio__actions button")).toHaveLength(2);
  });

  it("closes the workbench with mockup 05's status bar", () => {
    render(<CodeScreen mayAdminister readings={codeReadings()} role="owner" />);

    const bar = within(screen.getByRole("region", { name: FILE_LABEL })).getByRole("group", {
      name: STATUS_BAR_LABEL,
    });

    expect(bar).toHaveTextContent("⟲ synced with visual editor");
    expect(bar).toHaveTextContent("v15 draft");
    expect(bar).toHaveTextContent("DSL analyzer · Ln 1, Col 1 · UTF-8");
    expect(bar).not.toHaveTextContent(/LSP ready|TypeScript/);
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
  it("opens the draft's file in the editor, editable for a role that may publish, and says it saves as it is typed", () => {
    render(<CodeScreen mayAdminister readings={codeReadings()} role="owner" />);

    const file = screen.getByRole("region", { name: FILE_LABEL });
    const open = within(file).getByRole("tab", { selected: true });

    // The open tab names the file, and the pane is labelled by it.
    expect(open).toHaveTextContent(/^standard-fix\.loop\.ts$/);
    expect(open).toHaveAttribute("title", "workflows/standard-fix.loop.ts");
    expect(within(file).getByRole("tabpanel")).toHaveAttribute("aria-labelledby", open.id);
    expect(file).toHaveTextContent("Printed from the draft");
    expect(file).toHaveTextContent(CODE_IDLE_NOTE);
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
    expect(file).not.toHaveTextContent(CODE_IDLE_NOTE);
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

describe("a workspace with no workflows — the personal-org seed (V.7, #175, mirroring #153)", () => {
  const empty = codeReadings({ rail: { ok: true, value: [] }, selected: null });

  /**
   * The empty seat's card.
   *
   * @param container What was rendered.
   * @returns The seat.
   */
  function seat(container: HTMLElement): HTMLElement {
    const found = container.querySelector<HTMLElement>(".code-view__seat");
    expect(found, "the seat").not.toBeNull();
    return found as HTMLElement;
  }

  it("says so, with the visual editor's title, a code-flavoured line and the development seed, and draws no Publish", () => {
    const { container } = render(<CodeScreen mayAdminister readings={empty} role="owner" />);

    expect(title()).toHaveTextContent(EMPTY_TITLE);
    expect(within(seat(container)).getByText(CODE_SEAT_EMPTY_TITLE)).toBeInTheDocument();
    expect(within(seat(container)).getByText(CODE_SEAT_EMPTY_LINE)).toHaveClass("code-view__empty-line");
    expect(within(seat(container)).getByText(DEV_SEED_NOTE)).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Publish v/ })).toBeNull();
  });

  it("gives an owner the two ways to begin: Start blank opens the create dialog, templates say what they wait for", () => {
    const { container } = render(<CodeScreen mayAdminister readings={empty} role="owner" />);

    expect(within(seat(container)).getByText(CODE_SEAT_EMPTY_NOTE)).toBeInTheDocument();
    expect(within(seat(container)).getByRole("button", { name: BROWSE_TEMPLATES_LABEL })).toHaveAttribute(
      "title",
      BROWSE_TEMPLATES_SOON,
    );

    const start = within(seat(container)).getByRole("button", { name: START_BLANK_LABEL });

    expect(start).not.toHaveAttribute("aria-disabled");
    expect(start).toHaveClass("ou-btn--primary");

    fireEvent.click(start);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("gives a member no buttons in the seat, and says who can create one", () => {
    const { container } = render(<CodeScreen readings={empty} role="member" />);

    expect(within(seat(container)).getByText(CODE_SEAT_EMPTY_MEMBER_NOTE)).toBeInTheDocument();
    expect(within(seat(container)).getByText(CODE_SEAT_EMPTY_LINE)).toBeInTheDocument();
    expect(within(seat(container)).queryAllByRole("button")).toEqual([]);
    expect(screen.getByRole("note")).toHaveTextContent(READ_ONLY_BODY);
  });

  it.each([
    ["an owner", true],
    ["a member", false],
  ] as const)("draws the same empty state for %s in both palettes", (_, mayAdminister) => {
    const [light, dark] = renderInBothPalettes(
      <CodeScreen mayAdminister={mayAdminister} readings={empty} role={mayAdminister ? "owner" : "member"} />,
    );

    expect(light).toBe(dark);
  });
});

describe("a member session (V.7, #175)", () => {
  it("is read-only with the reason stated: the note names the role and why, and the file says Read-only", () => {
    render(<CodeScreen readings={codeReadings()} role="member" />);

    const note = screen.getByRole("note");

    expect(note).toHaveTextContent("Viewing the studio as a member.");
    expect(note).toHaveTextContent(READ_ONLY_BODY);
    expect(screen.getByRole("region", { name: FILE_LABEL })).toHaveTextContent(FILE_READ_ONLY_NOTE);
  });

  it("has no save and no publish: ⌘S writes nothing, and no Publish is drawn", () => {
    vi.mocked(saveCode).mockClear();
    render(<CodeScreen readings={codeReadings()} role="member" />);

    const file = screen.getByRole("region", { name: FILE_LABEL });

    fireEvent.keyDown(editorContent(file), { key: "s", code: "KeyS", ctrlKey: true });
    fireEvent.keyDown(editorContent(file), { key: "s", code: "KeyS", metaKey: true });

    expect(saveCode).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /^Publish/ })).toBeNull();
    expect(editorContent(file)).toHaveAttribute("contenteditable", "false");
  });

  it("keeps the explorer, the tabs and the right panel navigable", () => {
    render(<CodeScreen readings={codeReadings()} role="member" />);

    const file = screen.getByRole("region", { name: FILE_LABEL });

    expect(within(file).getByRole("tree")).toBeInTheDocument();
    expect(within(file).getByRole("tab", { selected: true })).toHaveTextContent("standard-fix.loop.ts");
    expect(within(file).getByRole("complementary", { name: PANEL_LABEL })).toBeInTheDocument();
  });

  it("draws the same read-only page in both palettes", () => {
    const [light, dark] = renderInBothPalettes(<CodeScreen readings={codeReadings()} role="member" />);

    expect(maskIds(light ?? "")).toBe(maskIds(dark ?? ""));
  });
});

describe("below 1000px (V.7, #175)", () => {
  /**
   * The workbench's row of toggles.
   *
   * @returns The row.
   */
  function toggles(): HTMLElement {
    const row = screen.getByRole("region", { name: FILE_LABEL }).querySelector<HTMLElement>(".code-workbench__toggles");
    expect(row, "the row of toggles").not.toBeNull();
    return row as HTMLElement;
  }

  it("opens the card with a toggle for each hidden region, the explorer first", () => {
    render(<CodeScreen mayAdminister readings={codeReadings()} role="owner" />);

    expect(within(toggles()).getAllByRole("button").map((button) => button.textContent)).toEqual([
      EXPLORER_TOGGLE_LABEL,
      PANEL_TOGGLE_LABEL,
    ]);
  });

  it("shows the explorer again from its toggle, and the editor stays usable beside it", () => {
    render(<CodeScreen mayAdminister readings={codeReadings()} role="owner" />);

    const toggle = within(toggles()).getByRole("button", { name: EXPLORER_TOGGLE_LABEL });
    const explorer = screen.getByRole("complementary", { name: EXPLORER_LABEL });

    expect(toggle).toHaveAttribute("aria-controls", explorer.id);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(explorer).not.toHaveClass("code-tree--open");

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(explorer).toHaveClass("code-tree--open");
    expect(within(explorer).getByRole("tree")).toBeInTheDocument();
    // The editor is untouched by the explorer's row: still mounted, still editable.
    expect(editorContent(screen.getByRole("region", { name: FILE_LABEL }))).toHaveAttribute("contenteditable", "true");

    fireEvent.click(toggle);

    expect(explorer).not.toHaveClass("code-tree--open");
  });

  it("keeps the explorer's toggle where there is no file, and draws the panel's only when there is a panel", () => {
    render(<CodeScreen mayAdminister readings={codeReadings({ requested: "gone", selected: null })} role="owner" />);

    expect(within(toggles()).getByRole("button", { name: EXPLORER_TOGGLE_LABEL })).toBeInTheDocument();
    expect(within(toggles()).queryByRole("button", { name: PANEL_TOGGLE_LABEL })).toBeNull();
  });

  it("draws the toggles for a member too, since reading needs the files as much as editing does", () => {
    render(<CodeScreen readings={codeReadings()} role="member" />);

    expect(within(toggles()).getAllByRole("button")).toHaveLength(2);
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

    // Both act on the file, and there is none: inert, saying so (design system § 3.5).
    for (const [name, reason] of [
      [VALIDATE_LABEL, VALIDATE_NEEDS_FILE],
      ["Publish v15", PUBLISH_NEEDS_FILE],
    ] as const) {
      const control = screen.getByRole("button", { name });
      expect(control).toHaveAttribute("aria-disabled", "true");
      expect(control).toHaveAttribute("title", reason);
    }
    expect(screen.queryByRole("group", { name: STATUS_BAR_LABEL })).toBeNull();
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
    // The workbench stays, so the explorer is there to leave by; there is no file to edit.
    const workbench = screen.getByRole("region", { name: FILE_LABEL });
    expect(within(workbench).getByRole("complementary", { name: EXPLORER_LABEL })).toBeInTheDocument();
    expect(workbench.querySelector(".cm-editor")).toBeNull();
  });
});

describe("the workbench", () => {
  it("draws the explorer, headed by the workspace, and the tabs under the control (V.3, #171)", () => {
    render(
      <CodeScreen
        mayAdminister
        readings={codeReadings()}
        role="owner"
        workspace={{ id: "code-screen-workbench", name: "Acme Robotics" }}
      />,
    );

    const workbench = screen.getByRole("region", { name: FILE_LABEL });

    expect(within(workbench).getByRole("complementary", { name: EXPLORER_LABEL })).toHaveTextContent(
      /^Explorer · Acme Robotics/,
    );
    expect(within(workbench).getByRole("tree")).toBeInTheDocument();
    expect(within(workbench).getByRole("tablist")).toBeInTheDocument();
  });

  it("heads the explorer without a separator when the screen is not told the workspace", () => {
    render(<CodeScreen mayAdminister readings={codeReadings()} role="owner" />);

    expect(screen.getByText("Explorer", { selector: ".code-tree__head" })).toBeInTheDocument();
  });

  it("is drawn for a URL naming a workflow the rail does not hold, so the explorer leads on", () => {
    render(<CodeScreen mayAdminister readings={codeReadings({ requested: "gone", selected: null })} role="owner" />);

    expect(screen.getByRole("complementary", { name: EXPLORER_LABEL })).toBeInTheDocument();
  });

  it("is not drawn for a refused rail or an empty workspace — there are no files to list", () => {
    const { unmount } = render(
      <CodeScreen
        mayAdminister
        readings={codeReadings({ rail: { ok: false, reason: "Down." }, selected: null, explorer: null })}
        role="owner"
      />,
    );
    expect(screen.queryByRole("complementary", { name: EXPLORER_LABEL })).toBeNull();
    unmount();

    render(
      <CodeScreen
        mayAdminister
        readings={codeReadings({ rail: { ok: true, value: [] }, selected: null, explorer: null })}
        role="owner"
      />,
    );
    expect(screen.queryByRole("complementary", { name: EXPLORER_LABEL })).toBeNull();
  });

  it("says why the file list is missing when a state that draws it was handed no explorer", () => {
    render(<CodeScreen mayAdminister readings={codeReadings({ explorer: null })} role="owner" />);

    expect(screen.getByRole("complementary", { name: EXPLORER_LABEL })).toHaveTextContent(
      "The file list could not be read.",
    );
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

    // The tabs and their pane are tied together by generated ids, which differ per root.
    expect(maskIds(light ?? "")).toBe(maskIds(dark ?? ""));
  });
});
