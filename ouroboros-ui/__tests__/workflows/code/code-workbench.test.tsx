import { EditorView } from "@codemirror/view";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { workflowCodePath } from "@/app/paths";
import type { CodeWorkspace } from "@/app/workflows/code/code-screen";
import { codeSessionStore } from "@/app/workflows/code/code-session";
import { addTab, editBuffer, markSaved, openTab } from "@/app/workflows/code/code-tabs";
import {
  CODE_SEAT_MISSING_TITLE,
  CONFIG_FAILED_TITLE,
  CONFIG_SOURCE,
  EXPLORER_LABEL,
  FILE_LABEL,
  MODIFIED_NOTE,
  NOTHING_OPEN_TITLE,
  TABS_LABEL,
  TREE_FAILED_TITLE,
  TREE_LABEL,
  UNPROJECTABLE_TITLE,
} from "@/app/workflows/code/code-view";

import { PALETTES, maskIds, renderInBothPalettes, renderInPalette } from "../../helpers/palettes";
import {
  CONFIG_TEXT,
  STANDARD_FIX_TEXT,
  codeReadings,
  explorerReadings,
  fileRead,
  unprojectableReadings,
  workflowCode,
} from "../../helpers/workflow-code";
import { seededRail } from "../../helpers/workflows";

/**
 * The code view's explorer and tab strip, drawn and driven (V.3, #171) — the ticket's acceptance
 * criteria in its own words:
 *
 * - **the tree mirrors the seeded registry, including the paused workflow's err dot**;
 * - **switching files preserves each file's buffer**;
 * - **the modified-dot is truthful: set on edit, cleared on successful save**;
 * - **`ouroboros.config.ts` shows its read-only badge and opens in the read-only editor variant**;
 * - **no `skills/` or `lib/` placeholder rows exist (C6, verified)**;
 * - **tree and tabs are fully keyboard operable**;
 * - **both themes**.
 *
 * The screen is rendered whole, as the route renders it. A navigation is what the router does with
 * the path pushed — this page unmounts and the next renders — and every case has a workspace of its
 * own, so no two share a session.
 */

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
// The file's save is a Server Action (V.4, #172) — its answers are `code-save-flow.test.tsx`'s. Here
// it is never answered, so what these cases type stays exactly as V.3 keeps it.
vi.mock("@/app/workflows/code/code-actions", () => ({ saveCode: vi.fn(() => new Promise(() => undefined)) }));
// Publish is S.6's shared Server Action on the server-only client (V.6, #174); nothing here publishes.
vi.mock("@/app/workflows/draft-actions", () => ({ publishWorkflow: vi.fn() }));
// The empty seat's Start blank is S.1's create dialog on a Server Action (V.7, #175); nothing here creates.
vi.mock("@/app/workflows/create-actions", () => ({ createWorkflow: vi.fn() }));

const { CodeScreen } = await import("@/app/workflows/code/code-screen");

const STANDARD_FIX = "workflows/standard-fix.loop.ts";
const FEATURE_LOOP = "workflows/feature-loop.loop.ts";
const HOTFIX = "workflows/hotfix-p0.loop.ts";
const CONFIG = "ouroboros.config.ts";

/** `STANDARD_FIX_TEXT` with a comment typed at the top. */
const EDITED = `// tighten the retry\n${STANDARD_FIX_TEXT}`;

let workspaces = 0;

/**
 * A workspace no other case has used, so its session starts empty.
 *
 * @returns The workspace.
 */
function freshWorkspace(): CodeWorkspace {
  workspaces += 1;
  return { id: `code-workbench-${workspaces}`, name: "Acme Robotics" };
}

beforeEach(() => {
  push.mockReset();
});

/**
 * The code view as the route draws it.
 *
 * @param workspace The workspace — whose session the page keeps.
 * @param readings What the route read. Defaults to the seeded workspace, opened on `standard-fix`.
 * @param mayAdminister Whether the reader may type into the file — an owner, or a member.
 * @returns The element.
 */
function page(workspace: CodeWorkspace, readings = codeReadings(), mayAdminister = true) {
  return (
    <CodeScreen
      mayAdminister={mayAdminister}
      readings={readings}
      role={mayAdminister ? "owner" : "member"}
      workspace={workspace}
    />
  );
}

/** The tree. */
function tree(): HTMLElement {
  return screen.getByRole("tree", { name: TREE_LABEL });
}

/**
 * One row of the tree.
 *
 * @param path The file's path, or a directory's path and slash.
 * @returns The tree item.
 */
function row(path: string): HTMLElement {
  const item = tree().querySelector<HTMLElement>(`[role="treeitem"][data-tree-id="${path}"]`);
  expect(item, `the tree has ${path}`).not.toBeNull();
  return item as HTMLElement;
}

/**
 * Press a row, as a pointer does.
 *
 * @param path The row's path.
 */
function clickRow(path: string): void {
  fireEvent.click(row(path).querySelector(".code-tree__row") as HTMLElement);
}

/** The tab strip. */
function strip(): HTMLElement {
  return screen.getByRole("tablist", { name: TABS_LABEL });
}

/**
 * The tabs' files, in order.
 *
 * @returns Each tab's `title`.
 */
function tabPaths(): (string | null)[] {
  return within(strip())
    .getAllByRole("tab")
    .map((tab) => tab.getAttribute("title"));
}

/**
 * One tab.
 *
 * @param path The tab's file.
 * @returns The tab.
 */
function tab(path: string): HTMLElement {
  return within(strip()).getByRole("tab", { name: (_, element) => element.getAttribute("title") === path });
}

/**
 * One tab's close button — hidden from assistive technology, so found by its tooltip.
 *
 * @param name The file's name.
 * @returns The button.
 */
function closeButton(name: string): HTMLElement {
  return screen.getByTitle(`Close ${name}`);
}

/** The open tab. */
function activeTab(): HTMLElement {
  return within(strip()).getByRole("tab", { selected: true });
}

/** The pane under the strip. */
function pane(): HTMLElement {
  const found = screen.getByRole("region", { name: FILE_LABEL }).querySelector<HTMLElement>(".code-workbench__pane");
  expect(found, "the workbench has a pane").not.toBeNull();
  return found as HTMLElement;
}

/**
 * The editor in the pane.
 *
 * @returns Its view.
 */
function editor(): EditorView {
  const content = pane().querySelector<HTMLElement>(".cm-content");
  expect(content, "the pane holds an editor").not.toBeNull();
  return EditorView.findFromDOM(content as HTMLElement) as EditorView;
}

/**
 * Type over the editor's whole text, leaving it as a person would.
 *
 * @param text What the editor should hold.
 */
function typeInto(text: string): void {
  const view = editor();
  act(() => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, userEvent: "input.type" });
  });
}

/**
 * Whether a tab carries the modified-dot — and, checked on the way, that it is said exactly when
 * it is drawn, so hue is never the only signal.
 *
 * @param path The tab's file.
 * @returns `true` when the dot is drawn.
 */
function dotted(path: string): boolean {
  const target = tab(path);
  const drawn = target.querySelector(".code-tab__modified") !== null;

  expect(target.textContent?.includes(MODIFIED_NOTE)).toBe(drawn);
  return drawn;
}

/**
 * Press a key on whatever has the keyboard.
 *
 * @param key `KeyboardEvent.key`.
 * @param init The rest of the event.
 * @returns `false` when the press was handled (its default prevented).
 */
function press(key: string, init: KeyboardEventInit = {}): boolean {
  return fireEvent.keyDown(document.activeElement as HTMLElement, { key, ...init });
}

describe("the explorer mirrors the seeded registry", () => {
  it("heads itself with the workspace, then workflows/ with the rail's five files in its order, then the configuration", () => {
    render(page(freshWorkspace()));

    const explorer = screen.getByRole("complementary", { name: EXPLORER_LABEL });

    expect(within(explorer).getByText("Explorer · Acme Robotics")).toBeInTheDocument();
    expect(
      within(tree())
        .getAllByRole("treeitem")
        .map((item) => [item.dataset.treeId, item.getAttribute("aria-level")]),
    ).toEqual([
      ["workflows/", "1"],
      ...seededRail().map((entry) => [`workflows/${entry.slug}.loop.ts`, "2"]),
      [CONFIG, "1"],
    ]);
    expect(row("workflows/")).toHaveAttribute("aria-expanded", "true");
  });

  it("has no skills/ or lib/ row — nothing is served under either (C6)", () => {
    render(page(freshWorkspace()));

    expect(tree()).not.toHaveTextContent(/skills\/|lib\//);
    expect(within(tree()).getAllByRole("treeitem")).toHaveLength(7);
  });

  it("gives hotfix-p0 — and only hotfix-p0 — the rail's err-dot, and says paused in words", () => {
    render(page(freshWorkspace()));

    expect(tree().querySelectorAll(".code-tree__dot")).toHaveLength(1);
    expect(row(HOTFIX).querySelector(".code-tree__dot")).toHaveAttribute("aria-hidden", "true");
    expect(row(HOTFIX)).toHaveTextContent("hotfix-p0.loop.ts, paused");
  });

  it("marks the open file's row in the accent inset treatment, and no other", () => {
    render(page(freshWorkspace()));

    expect(row(STANDARD_FIX)).toHaveAttribute("aria-selected", "true");
    expect(row(STANDARD_FIX).querySelector(".code-tree__row")).toHaveClass("code-tree__row--active");
    expect(tree().querySelectorAll(".code-tree__row--active")).toHaveLength(1);
    expect(tree().querySelectorAll('[aria-selected="true"]')).toHaveLength(1);
  });

  it("badges ouroboros.config.ts read-only, and nothing else", () => {
    render(page(freshWorkspace()));

    expect(within(row(CONFIG)).getByText("read-only")).toHaveClass("ou-chip");
    expect(tree().querySelectorAll(".code-tree__badge")).toHaveLength(1);
  });
});

describe("opening files", () => {
  it("opens the route's file in a tab on arrival", () => {
    render(page(freshWorkspace()));

    expect(tabPaths()).toEqual([STANDARD_FIX]);
    expect(activeTab()).toHaveTextContent(/^standard-fix\.loop\.ts$/);
    expect(editor().state.doc.toString()).toBe(STANDARD_FIX_TEXT);
  });

  it("opens ouroboros.config.ts in place, in the read-only editor variant", () => {
    render(page(freshWorkspace()));

    clickRow(CONFIG);

    expect(push).not.toHaveBeenCalled();
    expect(tabPaths()).toEqual([STANDARD_FIX, CONFIG]);
    expect(activeTab()).toHaveAttribute("title", CONFIG);
    expect(row(CONFIG)).toHaveAttribute("aria-selected", "true");
    expect(pane()).toHaveTextContent(CONFIG_SOURCE);

    const view = editor();

    expect(view.state.doc.toString()).toBe(CONFIG_TEXT);
    expect(view.state.readOnly).toBe(true);
    expect(view.contentDOM).toHaveAttribute("contenteditable", "false");
    expect(view.contentDOM).toHaveAttribute("aria-readonly", "true");
    expect(view.contentDOM).toHaveAttribute("aria-label", CONFIG);
    expect(pane().querySelector(".code-editor")).toHaveClass("code-editor--read-only");
  });

  it("opens another workflow by navigating to its route, its tab added ahead of the arrival", () => {
    render(page(freshWorkspace()));

    clickRow(FEATURE_LOOP);

    expect(push).toHaveBeenCalledExactlyOnceWith(workflowCodePath("feature-loop"));
    expect(tabPaths()).toEqual([STANDARD_FIX, FEATURE_LOOP]);
    // Until the route arrives, the pane is still the file it was.
    expect(activeTab()).toHaveAttribute("title", STANDARD_FIX);
  });

  it("switches in place to a tab that is the route's file or the configuration", () => {
    render(page(freshWorkspace()));
    clickRow(CONFIG);

    fireEvent.click(tab(STANDARD_FIX));

    expect(push).not.toHaveBeenCalled();
    expect(activeTab()).toHaveAttribute("title", STANDARD_FIX);
    expect(editor().state.doc.toString()).toBe(STANDARD_FIX_TEXT);
  });

  it("navigates for a tab of another workflow", () => {
    render(page(freshWorkspace()));
    clickRow("workflows/docs-loop.loop.ts");
    push.mockReset();

    fireEvent.click(tab("workflows/docs-loop.loop.ts"));

    expect(push).toHaveBeenCalledExactlyOnceWith(workflowCodePath("docs-loop"));
  });

  it("names each tab by its file and titles it with the whole path", () => {
    render(page(freshWorkspace()));

    expect(activeTab()).toHaveAccessibleName("standard-fix.loop.ts");
    expect(activeTab().tagName).toBe("BUTTON");
  });
});

describe("switching files preserves each file's buffer", () => {
  it("keeps the route file's edit across a switch to the configuration and back", () => {
    render(page(freshWorkspace()));

    typeInto(EDITED);
    fireEvent.click(tab(STANDARD_FIX));
    clickRow(CONFIG);
    expect(editor().state.doc.toString()).toBe(CONFIG_TEXT);

    fireEvent.click(tab(STANDARD_FIX));

    expect(editor().state.doc.toString()).toBe(EDITED);
  });

  it("keeps an edit across a detour to another workflow and back — a navigation each way", () => {
    const workspace = freshWorkspace();
    const first = render(page(workspace));
    typeInto(EDITED);
    first.unmount();

    const featureLoop = codeReadings({
      requested: "feature-loop",
      selected: {
        entry: seededRail()[1]!,
        file: fileRead(workflowCode({ path: FEATURE_LOOP, slug: "feature-loop", text: "feature\n" })),
      },
    });
    const second = render(page(workspace, featureLoop));

    expect(tabPaths()).toEqual([STANDARD_FIX, FEATURE_LOOP]);
    expect(activeTab()).toHaveAttribute("title", FEATURE_LOOP);
    expect(editor().state.doc.toString()).toBe("feature\n");
    expect(dotted(STANDARD_FIX)).toBe(true);
    second.unmount();

    render(page(workspace));

    expect(activeTab()).toHaveAttribute("title", STANDARD_FIX);
    expect(editor().state.doc.toString()).toBe(EDITED);
    expect(dotted(STANDARD_FIX)).toBe(true);
  });
});

describe("the modified-dot is truthful", () => {
  it("is not on a file as it was read", () => {
    render(page(freshWorkspace()));

    expect(dotted(STANDARD_FIX)).toBe(false);
  });

  it("is set by the edit, and said after the file's name", () => {
    render(page(freshWorkspace()));

    typeInto(EDITED);

    expect(dotted(STANDARD_FIX)).toBe(true);
    expect(tab(STANDARD_FIX)).toHaveTextContent(`standard-fix.loop.ts, ${MODIFIED_NOTE}`);
    expect(tab(STANDARD_FIX).querySelector(".code-tab__modified")).toHaveAttribute("aria-hidden", "true");
  });

  it("clears the moment the text is typed back to what was read", () => {
    render(page(freshWorkspace()));

    typeInto(EDITED);
    typeInto(STANDARD_FIX_TEXT);

    expect(dotted(STANDARD_FIX)).toBe(false);
  });

  it("clears on a successful save", () => {
    const workspace = freshWorkspace();
    render(page(workspace));
    typeInto(EDITED);

    // What V.4's save loop does when the service accepts the file.
    act(() => codeSessionStore(workspace.id).update((session) => markSaved(session, STANDARD_FIX, EDITED, "etag-2")));

    expect(dotted(STANDARD_FIX)).toBe(false);
    expect(editor().state.doc.toString()).toBe(EDITED);
  });

  it("stays after a save when the person typed on past what was saved", () => {
    const workspace = freshWorkspace();
    render(page(workspace));
    typeInto(EDITED);
    typeInto(`${EDITED}// more\n`);

    act(() => codeSessionStore(workspace.id).update((session) => markSaved(session, STANDARD_FIX, EDITED, "etag-2")));

    expect(dotted(STANDARD_FIX)).toBe(true);
  });

  it("clears when the file is read again as the buffer holds it — a save made elsewhere", () => {
    const workspace = freshWorkspace();
    const { rerender } = render(page(workspace));
    typeInto(EDITED);

    rerender(
      page(
        workspace,
        codeReadings({ selected: { entry: seededRail()[0]!, file: fileRead(workflowCode({ text: EDITED })) } }),
      ),
    );

    expect(dotted(STANDARD_FIX)).toBe(false);
    expect(editor().state.doc.toString()).toBe(EDITED);
  });

  it("is never set for a reader whose editor is read-only", () => {
    render(page(freshWorkspace(), codeReadings(), false));
    const view = editor();

    act(() => {
      view.dispatch({ changes: { from: 0, insert: "x" } });
    });

    expect(dotted(STANDARD_FIX)).toBe(false);
  });
});

describe("closing tabs", () => {
  it("closes a tab from its close button, keeping the open file", () => {
    render(page(freshWorkspace()));
    clickRow(CONFIG);
    fireEvent.click(tab(STANDARD_FIX));

    fireEvent.click(closeButton(CONFIG));

    expect(tabPaths()).toEqual([STANDARD_FIX]);
    expect(activeTab()).toHaveAttribute("title", STANDARD_FIX);
    expect(push).not.toHaveBeenCalled();
  });

  it("hides the close button from assistive technology, and names the shortcuts on the tab instead", () => {
    render(page(freshWorkspace()));

    expect(closeButton("standard-fix.loop.ts")).toHaveAttribute("aria-hidden", "true");
    expect(closeButton("standard-fix.loop.ts")).toHaveAttribute("tabindex", "-1");
    expect(tab(STANDARD_FIX)).toHaveAttribute("aria-keyshortcuts", "Delete Alt+W");
  });

  it("follows the tab that takes the open one's place when that is another workflow's", () => {
    render(page(freshWorkspace()));
    clickRow(FEATURE_LOOP);
    push.mockReset();

    fireEvent.click(closeButton("standard-fix.loop.ts"));

    expect(push).toHaveBeenCalledExactlyOnceWith(workflowCodePath("feature-loop"));
    expect(tabPaths()).toEqual([FEATURE_LOOP]);
  });

  it("opens the configuration in place when it takes the open tab's place", () => {
    render(page(freshWorkspace()));
    clickRow(CONFIG);
    fireEvent.click(tab(STANDARD_FIX));

    fireEvent.click(closeButton("standard-fix.loop.ts"));

    expect(push).not.toHaveBeenCalled();
    expect(activeTab()).toHaveAttribute("title", CONFIG);
    expect(pane()).toHaveTextContent(CONFIG_SOURCE);
  });

  it("leaves a designed panel when the last tab closes, and the tree opens the file again in place", () => {
    render(page(freshWorkspace()));

    fireEvent.click(closeButton("standard-fix.loop.ts"));

    expect(screen.queryByRole("tablist")).toBeNull();
    expect(pane()).toHaveTextContent(NOTHING_OPEN_TITLE);
    expect(pane()).not.toHaveAttribute("role");
    expect(row(STANDARD_FIX)).toHaveAttribute("aria-selected", "false");

    clickRow(STANDARD_FIX);

    expect(push).not.toHaveBeenCalled();
    expect(tabPaths()).toEqual([STANDARD_FIX]);
    expect(editor().state.doc.toString()).toBe(STANDARD_FIX_TEXT);
  });

  it("keeps a closed file's edit, and its dot, for when it is opened again", () => {
    render(page(freshWorkspace()));
    typeInto(EDITED);

    fireEvent.click(closeButton("standard-fix.loop.ts"));
    clickRow(STANDARD_FIX);

    expect(dotted(STANDARD_FIX)).toBe(true);
    expect(editor().state.doc.toString()).toBe(EDITED);
  });
});

describe("the tree is keyboard operable", () => {
  it("has one tab stop — the open file's row", () => {
    render(page(freshWorkspace()));

    expect(tree().querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    expect(row(STANDARD_FIX)).toHaveAttribute("tabindex", "0");
  });

  it("walks the rows, closes and opens the directory, and opens a file, with the tree pattern's keys", () => {
    render(page(freshWorkspace()));
    act(() => row(STANDARD_FIX).focus());

    press("ArrowDown");
    expect(document.activeElement).toBe(row(FEATURE_LOOP));
    expect(row(FEATURE_LOOP)).toHaveAttribute("tabindex", "0");
    expect(tree().querySelectorAll('[tabindex="0"]')).toHaveLength(1);

    press("ArrowUp");
    expect(document.activeElement).toBe(row(STANDARD_FIX));

    press("Home");
    expect(document.activeElement).toBe(row("workflows/"));

    press("ArrowLeft");
    expect(row("workflows/")).toHaveAttribute("aria-expanded", "false");
    expect(tree().querySelector(`[data-tree-id="${STANDARD_FIX}"]`)).toBeNull();

    press("ArrowRight");
    expect(row("workflows/")).toHaveAttribute("aria-expanded", "true");

    press("ArrowRight");
    expect(document.activeElement).toBe(row(STANDARD_FIX));

    press("End");
    expect(document.activeElement).toBe(row(CONFIG));

    press("Enter");
    expect(activeTab()).toHaveAttribute("title", CONFIG);
    expect(push).not.toHaveBeenCalled();
  });

  it("opens another workflow with Space — a navigation", () => {
    render(page(freshWorkspace()));
    act(() => row(HOTFIX).focus());

    press(" ");

    expect(push).toHaveBeenCalledExactlyOnceWith(workflowCodePath("hotfix-p0"));
  });

  it("leaves a chord pressed in the tree to whatever handles it", () => {
    render(page(freshWorkspace()));
    act(() => row(STANDARD_FIX).focus());

    expect(press("ArrowDown", { metaKey: true })).toBe(true);
    expect(document.activeElement).toBe(row(STANDARD_FIX));
  });

  it("closes and opens a directory from its row with the pointer too", () => {
    render(page(freshWorkspace()));

    clickRow("workflows/");
    expect(row("workflows/")).toHaveAttribute("aria-expanded", "false");

    clickRow("workflows/");
    expect(row("workflows/")).toHaveAttribute("aria-expanded", "true");
  });
});

describe("the tabs are keyboard operable", () => {
  it("have one tab stop — the open tab — moved by Left, Right, Home and End without opening anything", () => {
    render(page(freshWorkspace()));
    clickRow(CONFIG);
    clickRow("workflows/docs-loop.loop.ts");
    push.mockReset();
    const docs = "workflows/docs-loop.loop.ts";

    expect(strip().querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    expect(tab(CONFIG)).toHaveAttribute("tabindex", "0");

    act(() => tab(CONFIG).focus());

    press("ArrowRight");
    expect(document.activeElement).toBe(tab(docs));
    expect(tab(docs)).toHaveAttribute("tabindex", "0");

    press("ArrowRight");
    expect(document.activeElement).toBe(tab(STANDARD_FIX));

    press("ArrowLeft");
    expect(document.activeElement).toBe(tab(docs));

    press("Home");
    expect(document.activeElement).toBe(tab(STANDARD_FIX));

    press("End");
    expect(document.activeElement).toBe(tab(docs));

    expect(activeTab()).toHaveAttribute("title", CONFIG);
    expect(push).not.toHaveBeenCalled();
  });

  it("closes the focused tab with Delete, and moves the keyboard to the tab beside it", () => {
    render(page(freshWorkspace()));
    clickRow(CONFIG);
    act(() => tab(CONFIG).focus());

    expect(press("Delete")).toBe(false);

    expect(tabPaths()).toEqual([STANDARD_FIX]);
    expect(document.activeElement).toBe(tab(STANDARD_FIX));
    expect(activeTab()).toHaveAttribute("title", STANDARD_FIX);
    expect(push).not.toHaveBeenCalled();
  });

  it("closes the open tab with Alt+W from anywhere in the workbench, the editor included", () => {
    render(page(freshWorkspace()));
    clickRow(CONFIG);

    fireEvent.keyDown(editor().contentDOM, { key: "∑", code: "KeyW", altKey: true });

    expect(tabPaths()).toEqual([STANDARD_FIX]);
    expect(activeTab()).toHaveAttribute("title", STANDARD_FIX);
  });

  it("leaves ⌘W and Ctrl+W to the browser", () => {
    render(page(freshWorkspace()));

    fireEvent.keyDown(tab(STANDARD_FIX), { key: "w", code: "KeyW", metaKey: true });
    fireEvent.keyDown(tab(STANDARD_FIX), { key: "w", code: "KeyW", ctrlKey: true });

    expect(tabPaths()).toEqual([STANDARD_FIX]);
  });
});

describe("each read degrades its own region", () => {
  it("says why the file list is missing, and keeps the tabs and the file", () => {
    render(
      page(
        freshWorkspace(),
        codeReadings({
          explorer: explorerReadings({ tree: { ok: false, reason: "The file list is unavailable." } }),
        }),
      ),
    );

    const explorer = screen.getByRole("complementary", { name: EXPLORER_LABEL });

    expect(within(explorer).getByText(TREE_FAILED_TITLE)).toBeInTheDocument();
    expect(explorer).toHaveTextContent("The file list is unavailable.");
    expect(within(explorer).queryByRole("tree")).toBeNull();
    expect(tabPaths()).toEqual([STANDARD_FIX]);
    expect(editor().state.doc.toString()).toBe(STANDARD_FIX_TEXT);
  });

  it("forgets a tab of a workflow the project no longer has", () => {
    const workspace = freshWorkspace();
    codeSessionStore(workspace.id).update((session) => addTab(session, "workflows/retired.loop.ts"));

    render(page(workspace));

    expect(tabPaths()).toEqual([STANDARD_FIX]);
  });

  it("forgets nothing because the file list could not be read — an unread list is not an empty project", () => {
    const workspace = freshWorkspace();
    codeSessionStore(workspace.id).update((session) => addTab(session, "workflows/retired.loop.ts"));

    render(page(workspace, codeReadings({ explorer: explorerReadings({ tree: { ok: false, reason: "Down." } }) })));

    expect(tabPaths()).toEqual(["workflows/retired.loop.ts", STANDARD_FIX]);
  });

  it("says why ouroboros.config.ts is missing, in its pane, when that read was refused", () => {
    render(
      page(
        freshWorkspace(),
        codeReadings({
          explorer: explorerReadings({ config: { ok: false, reason: "The configuration is unavailable." } }),
        }),
      ),
    );

    clickRow(CONFIG);

    expect(pane()).toHaveTextContent(CONFIG_FAILED_TITLE);
    expect(pane()).toHaveTextContent("The configuration is unavailable.");
    expect(pane().querySelector(".cm-editor")).toBeNull();
  });

  it("keeps the explorer and the route's tab over a draft that cannot be shown as code yet", () => {
    render(page(freshWorkspace(), unprojectableReadings()));

    expect(tabPaths()).toEqual(["workflows/hotfix-p1.loop.ts"]);
    expect(row("workflows/hotfix-p1.loop.ts")).toHaveAttribute("aria-selected", "true");
    expect(pane()).toHaveTextContent(UNPROJECTABLE_TITLE);
    expect(pane().querySelector(".cm-editor")).toBeNull();
  });

  it("opens no tab for a workflow the rail does not hold, and says so in the pane", () => {
    render(page(freshWorkspace(), codeReadings({ requested: "gone", selected: null })));

    expect(screen.queryByRole("tablist")).toBeNull();
    expect(pane()).toHaveTextContent(CODE_SEAT_MISSING_TITLE);
    expect(tree().querySelectorAll('[aria-selected="true"]')).toHaveLength(0);
  });
});

describe("both palettes", () => {
  it.each(PALETTES)("draws the explorer and the tabs in the %s palette", (palette) => {
    renderInPalette(palette, page(freshWorkspace()));

    expect(document.documentElement).toHaveAttribute("data-theme", palette);
    expect(tree()).toBeInTheDocument();
    expect(activeTab()).toHaveAttribute("title", STANDARD_FIX);
  });

  it("draws the same markup in both, an edit's dot included, because the palette is CSS's business", () => {
    const workspace = freshWorkspace();
    codeSessionStore(workspace.id).update((session) =>
      editBuffer(openTab(session, STANDARD_FIX), STANDARD_FIX, STANDARD_FIX_TEXT, EDITED, null),
    );

    const [light, dark] = renderInBothPalettes(page(workspace));

    expect(light).toContain("code-tab__modified");
    expect(maskIds(light ?? "")).toBe(maskIds(dark ?? ""));
  });
});
