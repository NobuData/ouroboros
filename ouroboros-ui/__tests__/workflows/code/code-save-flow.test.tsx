import { diagnosticCount, forEachDiagnostic } from "@codemirror/lint";
import { EditorView } from "@codemirror/view";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactElement } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkflowCode } from "@/app/api/workflows";
import { workflowPath } from "@/app/paths";
import { RETRY_LABEL } from "@/app/ui/retry-banner";
import type { ActionOutcome } from "@/app/workflows/action-outcome";
import { SAVED_NOTE } from "@/app/workflows/autosave";
import { DIAGNOSTICS_LABEL } from "@/app/workflows/code/code-diagnostics";
import {
  CODE_CONFLICT_TITLE,
  CODE_DIVERGED_NOTE,
  CODE_FAILED_NOTE,
  CODE_INVALID_NOTE,
  CODE_SAVE_DELAY_MS,
  DIVERGED_TITLE,
  KEEP_MINE_LABEL,
  OFFLINE_REASON,
  RELOAD_THEIRS_LABEL,
  RETRY_BASE_MS,
  SAVE_FAILED_HEADLINE,
  SAVE_MINE_LABEL,
  WORKFLOW_CODE_INVALID,
} from "@/app/workflows/code/code-save";
import type { CodeWorkspace } from "@/app/workflows/code/code-screen";
import { codeSessionStore } from "@/app/workflows/code/code-session";
import { bufferOf, editBuffer, openTab } from "@/app/workflows/code/code-tabs";
import { FILE_LABEL } from "@/app/workflows/code/code-view";
import { SWITCH_PROMPT_TITLE } from "@/app/workflows/mode-switch";
import { STUDIO_EYEBROW } from "@/app/workflows/view";

import { stubRangeLayout } from "../../helpers/range-layout";
import { STANDARD_FIX_TEXT, codeReadings, fileRead, workflowCode } from "../../helpers/workflow-code";
import { railEntry } from "../../helpers/workflows";

/**
 * The code editor's save loop, end to end through the screen the route renders (V.4, #172) — the ticket's
 * acceptance criteria in its own words:
 *
 * - **a typo produces an anchored diagnostic while the visual editor still shows the last good draft**;
 * - **fixing the typo and saving clears the diagnostics and the modified-dot**;
 * - **a concurrent visual edit produces the 409 conflict flow, with the local buffer recoverable**;
 * - **no lost keystrokes across the debounce-and-save cycle — verified with scripted typing during an
 *   in-flight request**;
 * - **clicking a diagnostic jumps to its position**;
 * - **the stale/offline banner states the real reason**.
 *
 * The Server Action is the one seam: every case answers it as U.3's contract does. The draft itself is
 * the service's, so *the visual editor still shows the last good draft* is held here as its precondition —
 * the only write was refused, nothing was marked saved, and nothing re-read the page.
 */

const { push, refresh, navigate, saveCall } = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  navigate: vi.fn(),
  saveCall: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock("@/app/workflows/code/code-actions", () => ({ saveCode: (...args: unknown[]) => saveCall(...args) }));
// Publish is S.6's shared Server Action on the server-only client (V.6, #174); nothing here publishes.
vi.mock("@/app/workflows/draft-actions", () => ({ publishWorkflow: vi.fn() }));
// `next/link` wants the App Router; the stand-in keeps the one behaviour the mode guard relies on.
vi.mock("next/link", () => ({
  default: ({ href, onClick, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a
      {...rest}
      href={href}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        event.preventDefault();
        navigate(href);
      }}
    >
      {children}
    </a>
  ),
}));

const { CodeScreen } = await import("@/app/workflows/code/code-screen");
const { StudioModeGuard } = await import("@/app/workflows/mode-guard");

const PATH = "workflows/standard-fix.loop.ts";
const SLUG = "standard-fix";
const DELAY = CODE_SAVE_DELAY_MS;

/** The etag the page read the file under. */
const READ_ETAG = workflowCode().etag;

/** The file with `dsl` written as a number on line 4 — a typo mid-keystroke. */
const TYPO = STANDARD_FIX_TEXT.replace('  dsl: "1.0",', "  dsl: 1.0,");

/** Where the typo's `1.0` starts. */
const TYPO_AT = TYPO.indexOf("1.0,");

/** The file, fixed and edited: a comment typed at the top. */
const FIXED = `// tighten the retry\n${STANDARD_FIX_TEXT}`;

/** The draft as the canvas left it, after a concurrent visual edit. */
const THEIRS = `${STANDARD_FIX_TEXT}// moved on the canvas\n`;

/** U.3's `422 workflow_code_invalid` for {@link TYPO}. */
const INVALID: ActionOutcome<WorkflowCode> = {
  ok: false,
  refusal: {
    code: WORKFLOW_CODE_INVALID,
    message: "This file does not read as a workflow, so it was not saved. The draft is unchanged.",
    details: {
      diagnostics: [
        {
          severity: "error",
          range: { line: 4, column: 8, endLine: 4, endColumn: 11 },
          code: "code_out_of_grammar",
          message: "`dsl` is written as a string literal.",
          note: "Supported in the full SDK (v2)",
        },
      ],
    },
  },
};

/** U.3's `409 workflow_draft_conflict` after a concurrent visual edit. */
const CONFLICT: ActionOutcome<WorkflowCode> = {
  ok: false,
  refusal: {
    code: "workflow_draft_conflict",
    message: "This draft was changed in the visual editor. Reload it before saving again.",
    details: { expected: READ_ETAG, current: "etag-theirs", editedIn: "visual", updatedAt: "2026-09-15T11:59:00.000Z" },
  },
};

/**
 * What a write that took answers.
 *
 * @param text The file as the draft now reads.
 * @param etag The new etag.
 * @returns The outcome.
 */
function saved(text: string, etag = "etag-2"): ActionOutcome<WorkflowCode> {
  return { ok: true, value: workflowCode({ text, etag }) };
}

/** Answer every write as taken, echoing the text sent. */
function acceptEverything(): void {
  saveCall.mockImplementation((_slug: string, _etag: string, text: string) => Promise.resolve(saved(text)));
}

let workspaces = 0;
let online = true;

/**
 * A workspace no other case has used, so its session starts empty.
 *
 * @returns The workspace.
 */
function freshWorkspace(): CodeWorkspace {
  workspaces += 1;
  return { id: `code-save-flow-${workspaces}`, name: "Acme Robotics" };
}

/**
 * The code view as the route draws it, inside the workflow layout's mode guard.
 *
 * @param workspace The workspace — whose session the page keeps.
 * @param file The file as the route read it.
 * @param mayAdminister Whether the reader may type into it.
 * @returns The element.
 */
function page(workspace: CodeWorkspace, file: WorkflowCode = workflowCode(), mayAdminister = true): ReactElement {
  return (
    <StudioModeGuard>
      <CodeScreen
        mayAdminister={mayAdminister}
        readings={codeReadings({ selected: { entry: railEntry(), file: fileRead(file) } })}
        role={mayAdminister ? "owner" : "member"}
        workspace={workspace}
      />
    </StudioModeGuard>
  );
}

/** The workbench. */
function fileRegion(): HTMLElement {
  return screen.getByRole("region", { name: FILE_LABEL });
}

/** The editor in the pane. */
function editor(): EditorView {
  const content = fileRegion().querySelector<HTMLElement>(".code-workbench__pane .cm-content");
  expect(content, "the pane holds an editor").not.toBeNull();
  return EditorView.findFromDOM(content as HTMLElement) as EditorView;
}

/**
 * Type over the editor's whole text.
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
 * Type at the end of the file, as a person types: a few characters, not the whole text.
 *
 * @param text What is typed.
 */
function typeAtEnd(text: string): void {
  const view = editor();
  act(() => {
    view.dispatch({ changes: { from: view.state.doc.length, insert: text }, userEvent: "input.type" });
  });
}

/** Whether the file's tab carries the modified-dot. */
function dotted(): boolean {
  const tab = within(fileRegion()).getByRole("tab", { name: (_, element) => element.getAttribute("title") === PATH });
  return tab.querySelector(".code-tab__modified") !== null;
}

/** The diagnostics strip, or `null`. */
function strip(): HTMLElement | null {
  return screen.queryByRole("status", { name: DIAGNOSTICS_LABEL });
}

/** The failure banner, or `null`. */
function banner(): HTMLElement | null {
  return screen.queryByText(SAVE_FAILED_HEADLINE)?.closest<HTMLElement>('[role="status"]') ?? null;
}

/**
 * Every diagnostic the editor holds, as offsets.
 *
 * @returns Each one's range.
 */
function drawn(): { from: number; to: number }[] {
  const found: { from: number; to: number }[] = [];
  forEachDiagnostic(editor().state, (_diagnostic, from, to) => found.push({ from, to }));
  return found;
}

/** Let the clock run, and every promise it released settle. */
async function elapse(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/**
 * A promise released by hand, for a write still in flight.
 *
 * @returns The promise and its release.
 */
function deferred<T>(): { promise: Promise<T>; release: (value: T) => void } {
  let release: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

beforeAll(() => {
  stubRangeLayout();
});

beforeEach(() => {
  vi.useFakeTimers();
  online = true;
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => online });
  push.mockReset();
  refresh.mockReset();
  navigate.mockReset();
  saveCall.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a typo mid-keystroke", () => {
  it("is drawn where it is — squiggle, gutter marker and strip — while the text and its dot stay, and nothing more is written", async () => {
    saveCall.mockResolvedValue(INVALID);
    render(page(freshWorkspace()));

    typeInto(TYPO);
    await elapse(DELAY);

    expect(saveCall).toHaveBeenCalledExactlyOnceWith(SLUG, READ_ETAG, TYPO);
    expect(drawn()).toEqual([{ from: TYPO_AT, to: TYPO_AT + 3 }]);
    expect(fileRegion().querySelector(".cm-lintRange-error")?.textContent).toBe("1.0");

    const found = strip();
    expect(found).not.toBeNull();
    expect(found).toHaveTextContent("1 error");
    expect(found).toHaveTextContent("Line 4, column 8: `dsl` is written as a string literal.");
    expect(fileRegion()).toHaveTextContent(CODE_INVALID_NOTE);

    // The draft is the service's and it refused the write: the text stays in the tab, unsaved.
    expect(editor().state.doc.toString()).toBe(TYPO);
    expect(dotted()).toBe(true);
    await elapse(DELAY * 5);
    expect(saveCall).toHaveBeenCalledOnce();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("clears — diagnostics, strip and dot — once the fix saves", async () => {
    acceptEverything();
    saveCall.mockResolvedValueOnce(INVALID);
    render(page(freshWorkspace()));

    typeInto(TYPO);
    await elapse(DELAY);
    expect(strip()).not.toBeNull();

    typeInto(FIXED);
    await elapse(DELAY);

    expect(saveCall).toHaveBeenLastCalledWith(SLUG, READ_ETAG, FIXED);
    expect(strip()).toBeNull();
    expect(diagnosticCount(editor().state)).toBe(0);
    expect(dotted()).toBe(false);
    expect(fileRegion()).toHaveTextContent(SAVED_NOTE);
    expect(editor().state.doc.toString()).toBe(FIXED);
  });

  it("clears when the text is typed back to the draft, with nothing written", async () => {
    saveCall.mockResolvedValue(INVALID);
    render(page(freshWorkspace()));

    typeInto(TYPO);
    await elapse(DELAY);
    typeInto(STANDARD_FIX_TEXT);
    await elapse(DELAY);

    expect(saveCall).toHaveBeenCalledOnce();
    expect(strip()).toBeNull();
    expect(dotted()).toBe(false);
  });

  it("jumps to its place when its message is clicked — following what was typed since", async () => {
    saveCall.mockResolvedValue(INVALID);
    render(page(freshWorkspace()));

    typeInto(TYPO);
    await elapse(DELAY);

    const view = editor();
    act(() => {
      view.dispatch({ changes: { from: 0, insert: "// above\n" }, userEvent: "input.type" });
    });
    // The squiggle rides along with the edit.
    expect(drawn()).toEqual([{ from: TYPO_AT + 9, to: TYPO_AT + 12 }]);

    fireEvent.click(within(strip() as HTMLElement).getByRole("button"));

    expect(view.state.selection.main.from).toBe(TYPO_AT + 9);
    expect(view.state.selection.main.to).toBe(TYPO_AT + 12);
    expect(document.activeElement).toBe(view.contentDOM);
  });
});

describe("an explicit save", () => {
  it("writes at once on ⌘S, without waiting for typing to rest, and keeps the browser's save dialog shut", async () => {
    acceptEverything();
    render(page(freshWorkspace()));

    typeInto(FIXED);
    let unhandled = true;
    await act(async () => {
      unhandled = fireEvent.keyDown(editor().contentDOM, { key: "s", code: "KeyS", metaKey: true });
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(unhandled).toBe(false);
    expect(saveCall).toHaveBeenCalledExactlyOnceWith(SLUG, READ_ETAG, FIXED);
    expect(dotted()).toBe(false);
  });

  it("writes on Ctrl+S too, and writes nothing when nothing is unsaved", async () => {
    acceptEverything();
    render(page(freshWorkspace()));

    await act(async () => {
      fireEvent.keyDown(editor().contentDOM, { key: "s", code: "KeyS", ctrlKey: true });
      await vi.advanceTimersByTimeAsync(DELAY);
    });
    expect(saveCall).not.toHaveBeenCalled();

    typeInto(FIXED);
    await act(async () => {
      fireEvent.keyDown(editor().contentDOM, { key: "s", code: "KeyS", ctrlKey: true });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(saveCall).toHaveBeenCalledOnce();
  });
});

describe("no lost keystrokes", () => {
  // Every keystroke is an editor transaction and a render, so a loaded runner needs more than the default.
  it("keeps every character typed while a write is in flight, and writes them all next — scripted typing", { timeout: 20_000 }, async () => {
    const first = deferred<ActionOutcome<WorkflowCode>>();
    saveCall.mockImplementationOnce(() => first.promise);
    saveCall.mockImplementation((_slug: string, _etag: string, text: string) => Promise.resolve(saved(text, "etag-3")));
    const workspace = freshWorkspace();
    render(page(workspace));

    typeAtEnd("// a");
    await elapse(DELAY);
    expect(saveCall).toHaveBeenCalledOnce();

    // A character every 40ms — longer, in all, than the debounce — while the first write is out.
    for (const character of "nother, typed mid-save") {
      typeAtEnd(character);
      await elapse(40);
    }
    await elapse(DELAY * 2);

    const everything = `${STANDARD_FIX_TEXT}// another, typed mid-save`;
    expect(saveCall).toHaveBeenCalledOnce();
    expect(editor().state.doc.toString()).toBe(everything);

    // The first write lands, answering its canonical text: the text on screen is not replaced by it.
    await act(async () => {
      first.release(saved("the draft, printed canonically\n", "etag-2"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(editor().state.doc.toString()).toBe(everything);

    await elapse(DELAY);

    expect(saveCall).toHaveBeenCalledTimes(2);
    expect(saveCall).toHaveBeenLastCalledWith(SLUG, "etag-2", everything);
    expect(editor().state.doc.toString()).toBe(everything);
    expect(bufferOf(codeSessionStore(workspace.id).get(), PATH)?.text).toBe(everything);
    expect(dotted()).toBe(false);
  });
});

describe("a concurrent visual edit", () => {
  it("asks, naming the visual editor; Keep mine holds the text beside the draft as it now is, and Save mine writes it", async () => {
    saveCall.mockResolvedValueOnce(CONFLICT);
    saveCall.mockImplementation((_slug: string, _etag: string, text: string) => Promise.resolve(saved(text, "etag-mine")));
    const workspace = freshWorkspace();
    const { rerender } = render(page(workspace));

    typeInto(FIXED);
    await elapse(DELAY);

    const dialog = screen.getByRole("dialog", { name: CODE_CONFLICT_TITLE });
    expect(dialog).toHaveTextContent("in the visual editor");
    expect(dialog).toHaveTextContent("nothing was overwritten");

    // The loop has stopped: typing on is kept, and written nowhere.
    const mine = `${FIXED}// more\n`;
    typeInto(mine);
    await elapse(DELAY * 3);
    expect(saveCall).toHaveBeenCalledOnce();

    fireEvent.click(within(dialog).getByRole("button", { name: KEEP_MINE_LABEL }));

    expect(screen.queryByRole("dialog", { name: CODE_CONFLICT_TITLE })).toBeNull();
    expect(refresh).toHaveBeenCalledOnce();
    expect(editor().state.doc.toString()).toBe(mine);
    expect(dotted()).toBe(true);

    // The re-read lands: the draft as the canvas left it, under its new etag.
    rerender(page(workspace, workflowCode({ text: THEIRS, etag: "etag-theirs" })));

    const panel = screen.getByRole("region", { name: DIVERGED_TITLE });
    expect(panel).toHaveTextContent("3 lines differ");
    expect(panel).toHaveTextContent("+ // tighten the retry");
    expect(panel).toHaveTextContent("- // moved on the canvas");
    expect(panel).toHaveTextContent("+ // more");
    expect(editor().state.doc.toString()).toBe(mine);
    expect(fileRegion()).toHaveTextContent(CODE_DIVERGED_NOTE);

    await elapse(DELAY * 3);
    expect(saveCall).toHaveBeenCalledOnce();

    fireEvent.click(within(panel).getByRole("button", { name: SAVE_MINE_LABEL }));
    await elapse(DELAY);

    expect(saveCall).toHaveBeenLastCalledWith(SLUG, "etag-theirs", mine);
    expect(screen.queryByRole("region", { name: DIVERGED_TITLE })).toBeNull();
    expect(dotted()).toBe(false);
  });

  it("drops the text and reads the draft again on Reload theirs", async () => {
    saveCall.mockResolvedValue(CONFLICT);
    const workspace = freshWorkspace();
    const { rerender } = render(page(workspace));

    typeInto(FIXED);
    await elapse(DELAY);
    fireEvent.click(
      within(screen.getByRole("dialog", { name: CODE_CONFLICT_TITLE })).getByRole("button", { name: RELOAD_THEIRS_LABEL }),
    );

    expect(refresh).toHaveBeenCalledOnce();
    expect(bufferOf(codeSessionStore(workspace.id).get(), PATH)).toBeUndefined();
    expect(dotted()).toBe(false);

    rerender(page(workspace, workflowCode({ text: THEIRS, etag: "etag-theirs" })));

    expect(editor().state.doc.toString()).toBe(THEIRS);
    expect(screen.queryByRole("region", { name: DIVERGED_TITLE })).toBeNull();
  });

  it("keeps mine when the dialog is dismissed — dismissing a question never drops text", async () => {
    saveCall.mockResolvedValue(CONFLICT);
    const workspace = freshWorkspace();
    render(page(workspace));

    typeInto(FIXED);
    await elapse(DELAY);
    fireEvent.keyDown(screen.getByRole("dialog", { name: CODE_CONFLICT_TITLE }), { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: CODE_CONFLICT_TITLE })).toBeNull();
    expect(bufferOf(codeSessionStore(workspace.id).get(), PATH)?.text).toBe(FIXED);
  });
});

describe("a buffer an earlier page left", () => {
  it("is written on arrival when it was typed over the draft the page reads", async () => {
    acceptEverything();
    const workspace = freshWorkspace();
    codeSessionStore(workspace.id).update((session) =>
      editBuffer(openTab(session, PATH), PATH, STANDARD_FIX_TEXT, FIXED, READ_ETAG),
    );

    render(page(workspace));
    await elapse(DELAY);

    expect(saveCall).toHaveBeenCalledExactlyOnceWith(SLUG, READ_ETAG, FIXED);
    expect(dotted()).toBe(false);
  });

  it("waits for a choice when the draft moved under it, and Reload theirs drops it without a second read", async () => {
    acceptEverything();
    const workspace = freshWorkspace();
    codeSessionStore(workspace.id).update((session) =>
      editBuffer(openTab(session, PATH), PATH, "an older draft\n", FIXED, "etag-old"),
    );

    render(page(workspace));
    await elapse(DELAY * 3);

    const panel = screen.getByRole("region", { name: DIVERGED_TITLE });
    expect(saveCall).not.toHaveBeenCalled();
    expect(editor().state.doc.toString()).toBe(FIXED);

    fireEvent.click(within(panel).getByRole("button", { name: RELOAD_THEIRS_LABEL }));

    expect(screen.queryByRole("region", { name: DIVERGED_TITLE })).toBeNull();
    expect(editor().state.doc.toString()).toBe(STANDARD_FIX_TEXT);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("a write that did not arrive", () => {
  it("says the browser is offline, keeps the text, and writes it on Retry", async () => {
    online = false;
    acceptEverything();
    saveCall.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(page(freshWorkspace()));

    typeInto(FIXED);
    await elapse(DELAY);

    expect(banner()).toHaveTextContent(OFFLINE_REASON);
    expect(fileRegion()).toHaveTextContent(CODE_FAILED_NOTE);
    expect(dotted()).toBe(true);

    online = true;
    await act(async () => {
      fireEvent.click(within(banner() as HTMLElement).getByRole("button", { name: RETRY_LABEL }));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(saveCall).toHaveBeenCalledTimes(2);
    expect(banner()).toBeNull();
    expect(dotted()).toBe(false);
  });

  it("says the service's own sentence for a service error, and retries on its own", async () => {
    acceptEverything();
    saveCall.mockResolvedValueOnce({
      ok: false,
      refusal: { code: "internal_error", message: "The service failed. Nothing was written.", details: {} },
    });
    render(page(freshWorkspace()));

    typeInto(FIXED);
    await elapse(DELAY);
    expect(banner()).toHaveTextContent("The service failed. Nothing was written.");

    await elapse(RETRY_BASE_MS);

    expect(saveCall).toHaveBeenCalledTimes(2);
    expect(banner()).toBeNull();
    expect(dotted()).toBe(false);
  });
});

describe("the mode switch", () => {
  /** A segment of the tab row. */
  function segment(name: string): HTMLElement {
    return within(screen.getByRole("navigation", { name: STUDIO_EYEBROW })).getByRole("link", { name });
  }

  it("asks before leaving code that has not parsed, and discarding drops it", async () => {
    saveCall.mockResolvedValue(INVALID);
    const workspace = freshWorkspace();
    render(page(workspace));

    typeInto(TYPO);
    await elapse(DELAY);
    fireEvent.click(segment("Visual"));

    const prompt = screen.getByRole("dialog", { name: SWITCH_PROMPT_TITLE });
    fireEvent.click(within(prompt).getByRole("button", { name: "Discard and open Visual" }));

    expect(push).toHaveBeenCalledExactlyOnceWith(workflowPath(SLUG));
    expect(bufferOf(codeSessionStore(workspace.id).get(), PATH)).toBeUndefined();
  });

  it("asks nothing once the file has saved", async () => {
    acceptEverything();
    render(page(freshWorkspace()));

    typeInto(FIXED);
    await elapse(DELAY);
    fireEvent.click(segment("Visual"));

    expect(screen.queryByRole("dialog", { name: SWITCH_PROMPT_TITLE })).toBeNull();
    expect(navigate).toHaveBeenCalledExactlyOnceWith(workflowPath(SLUG));
  });
});

describe("a reader who may not edit", () => {
  it("writes nothing, and draws no save surface", async () => {
    acceptEverything();
    render(page(freshWorkspace(), workflowCode(), false));

    act(() => {
      editor().dispatch({ changes: { from: 0, insert: "x" } });
    });
    await elapse(DELAY * 3);

    expect(saveCall).not.toHaveBeenCalled();
    expect(strip()).toBeNull();
    expect(banner()).toBeNull();
  });
});
