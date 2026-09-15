import { diagnosticCount, forEachDiagnostic } from "@codemirror/lint";
import { EditorView } from "@codemirror/view";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { CodeDiagnostic, WorkflowCode, WorkflowFinding } from "@/app/api/workflows";
import type { ActionOutcome } from "@/app/workflows/action-outcome";
import { lineStarts } from "@/app/workflows/code/code-diagnostics";
import {
  PUBLISH_NEEDS_FILE,
  PUBLISH_UNPARSED_MESSAGE,
  VALIDATED_MESSAGE,
  VALIDATE_ENGINE_UNAVAILABLE_MESSAGE,
  VALIDATE_NEEDS_FILE,
  VALIDATE_UNPARSED_MESSAGE,
} from "@/app/workflows/code/code-flows";
import { CHECKS_STALE_NOTE, PANEL_LABEL } from "@/app/workflows/code/code-panel";
import { CODE_SAVE_DELAY_MS, WORKFLOW_CODE_INVALID } from "@/app/workflows/code/code-save";
import type { CodeWorkspace } from "@/app/workflows/code/code-screen";
import { STATUS_BAR_LABEL } from "@/app/workflows/code/code-status";
import { FILE_LABEL, VALIDATE_LABEL } from "@/app/workflows/code/code-view";
import { CHANGE_NOTE_LABEL, DISMISS_TOAST_LABEL, FINDINGS_LABEL, FINDINGS_MESSAGE } from "@/app/workflows/publish";

import { maskIds, renderInBothPalettes } from "../../helpers/palettes";
import { stubRangeLayout } from "../../helpers/range-layout";
import {
  STANDARD_FIX_TEXT,
  codeChecks,
  codeReadings,
  codeValidation,
  fileRead,
  workflowCode,
} from "../../helpers/workflow-code";
import { railEntry } from "../../helpers/workflows";

/**
 * The code view's status bar, Validate and Publish, end to end through the screen the route renders (V.6,
 * #174) — the ticket's acceptance criteria in its own words:
 *
 * - **status transitions are truthful across every V.4 state: synced, saving, parse error, conflict**;
 * - **the right cluster reads `DSL analyzer` — not `LSP ready` (C5)**;
 * - **the cursor position updates live and matches the editor**;
 * - **Validate populates checks and diagnostics without creating a version**;
 * - **publishing from the code view bumps the version the head shows** — the rail's, which the visual
 *   editor's head reads too, so the refresh this asserts is what carries it there;
 * - **publish failures anchor their findings into the code view**;
 * - **both themes**.
 *
 * Three Server Actions are the seams: the save and Validate (`code-actions.ts`) and S.6's shared
 * `publishWorkflow` (`draft-actions.ts`). Every case answers them as the contracts do.
 */

const { refresh, saveCall, validateCall, publishCall } = vi.hoisted(() => ({
  refresh: vi.fn(),
  saveCall: vi.fn(),
  validateCall: vi.fn(),
  publishCall: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));
vi.mock("@/app/workflows/code/code-actions", () => ({
  saveCode: (...args: unknown[]) => saveCall(...args),
  validateCode: (...args: unknown[]) => validateCall(...args),
}));
vi.mock("@/app/workflows/draft-actions", () => ({
  publishWorkflow: (...args: unknown[]) => publishCall(...args),
}));
// The empty seat's Start blank is S.1's create dialog on a Server Action (V.7, #175); nothing here creates.
vi.mock("@/app/workflows/create-actions", () => ({ createWorkflow: vi.fn() }));

const { CodeScreen } = await import("@/app/workflows/code/code-screen");

const SLUG = "standard-fix";
const DELAY = CODE_SAVE_DELAY_MS;

/** `STANDARD_FIX_TEXT`'s one stage call, on line 6. */
const SPANS = [{ node: "issue-queued", startLine: 6, endLine: 6 }];

/** The file as the route read it. */
const FILE = workflowCode({ spans: SPANS });

/** The etag the page read the file under. */
const READ_ETAG = FILE.etag;

/** The file with a comment typed at the top, which moves the stage call to line 7. */
const EDITED = `// tighten the retry\n${STANDARD_FIX_TEXT}`;

/** The file with `dsl` written as a number on line 4 — a typo mid-keystroke. */
const TYPO = STANDARD_FIX_TEXT.replace('  dsl: "1.0",', "  dsl: 1.0,");

/** What the engine says about the stage. */
const ENGINE_FINDING: WorkflowFinding = {
  source: "engine",
  code: "loop.unbounded",
  message: "The engine will not run this stage as written.",
  path: "/nodes/0",
  node: "issue-queued",
};

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

/** A write the service failed. */
const FAILED: ActionOutcome<WorkflowCode> = {
  ok: false,
  refusal: { code: "internal_error", message: "The service failed.", details: {} },
};

/**
 * The line a stage call is on, as a diagnostic's range over it.
 *
 * @param text The file.
 * @param line The call's line.
 * @returns From its first non-blank character to its end.
 */
function callRange(text: string, line: number): CodeDiagnostic["range"] {
  const content = text.split("\n")[line - 1] ?? "";
  return { line, column: content.search(/\S/) + 1, endLine: line, endColumn: content.length + 1 };
}

/**
 * What a write that took answers.
 *
 * @param text The file as the draft now reads.
 * @param etag The new etag.
 * @returns The outcome, with the span map the text has.
 */
function saved(text: string, etag = "etag-2"): ActionOutcome<WorkflowCode> {
  const spans = text === EDITED ? [{ node: "issue-queued", startLine: 7, endLine: 7 }] : SPANS;
  return { ok: true, value: workflowCode({ text, etag, spans }) };
}

/** Answer every write as taken, echoing the text sent. */
function acceptEverything(): void {
  saveCall.mockImplementation((_slug: string, _etag: string, text: string) => Promise.resolve(saved(text)));
}

let workspaces = 0;

/**
 * A workspace no other case has used, so its session starts empty.
 *
 * @returns The workspace.
 */
function freshWorkspace(): CodeWorkspace {
  workspaces += 1;
  return { id: `code-flows-${workspaces}`, name: "Acme Robotics" };
}

/**
 * The code view as the route draws it.
 *
 * @param file The file as the route read it.
 * @param mayAdminister Whether the reader may type and publish.
 * @param workspace The workspace — whose session the page keeps.
 * @returns The element.
 */
function page(file: WorkflowCode = FILE, mayAdminister = true, workspace = freshWorkspace()) {
  return (
    <CodeScreen
      mayAdminister={mayAdminister}
      readings={codeReadings({ selected: { entry: railEntry(), file: fileRead(file) } })}
      role={mayAdminister ? "owner" : "member"}
      workspace={workspace}
    />
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

/** The status bar. */
function bar(): HTMLElement {
  return within(fileRegion()).getByRole("group", { name: STATUS_BAR_LABEL });
}

/** The head's actions. */
function head(): HTMLElement {
  return document.querySelector<HTMLElement>(".studio__actions") as HTMLElement;
}

/** Assert the strip's `Ln`/`Col` is exactly where the editor says its cursor is. */
function expectEditorsPlace(): void {
  const view = editor();
  const at = view.state.selection.main.head;
  const line = view.state.doc.lineAt(at);

  expect(bar()).toHaveTextContent(`Ln ${line.number}, Col ${at - line.from + 1}`);
}

/** The status bar's sync word. */
function sync(): HTMLElement {
  return bar().querySelector<HTMLElement>(".code-status__sync") as HTMLElement;
}

/** The right panel. */
function panel(): HTMLElement {
  return screen.getByRole("complementary", { name: PANEL_LABEL });
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
 * Put the editor's cursor somewhere, as a click or an arrow key does.
 *
 * @param offset Where.
 */
function moveCursor(offset: number): void {
  const view = editor();
  act(() => {
    view.dispatch({ selection: { anchor: offset }, userEvent: "select" });
  });
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

/**
 * Every diagnostic the editor holds, as the text each covers.
 *
 * @returns The covered texts.
 */
function underlined(): string[] {
  const view = editor();
  const found: string[] = [];
  forEachDiagnostic(view.state, (_diagnostic, from, to) => found.push(view.state.sliceDoc(from, to)));
  return found;
}

/** Press Validate. */
async function pressValidate(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: VALIDATE_LABEL }));
  await elapse(0);
}

/**
 * Open the publish dialog, write a note, and submit it.
 *
 * @param label The action's label.
 * @param note The change note.
 * @returns The dialog.
 */
async function publishWith(label: string, note = "Tightened the retry."): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole("button", { name: label }));
  const dialog = screen.getByRole("dialog", { name: label });
  fireEvent.change(within(dialog).getByRole("textbox", { name: CHANGE_NOTE_LABEL }), { target: { value: note } });
  fireEvent.click(within(dialog).getByRole("button", { name: label }));
  await elapse(0);
  return dialog;
}

beforeAll(() => {
  stubRangeLayout();
});

beforeEach(() => {
  vi.useFakeTimers();
  refresh.mockReset();
  saveCall.mockReset();
  validateCall.mockReset();
  publishCall.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the status bar", () => {
  it("reads mockup 05's strip, with DSL analyzer where the mockup claims a language server (C5)", () => {
    render(page());

    expect(sync()).toHaveTextContent(/^⟲ synced with visual editor$/);
    expect(sync()).toHaveClass("code-status__sync--synced");
    expect(bar()).toHaveTextContent("v15 draft");
    expect(bar()).toHaveTextContent("DSL analyzer · Ln 1, Col 1 · UTF-8");
    expect(bar()).not.toHaveTextContent(/LSP|TypeScript/);
  });

  it("follows the cursor live, reading the place the editor itself reports", () => {
    render(page());

    for (const offset of [STANDARD_FIX_TEXT.indexOf("dsl"), STANDARD_FIX_TEXT.indexOf("next:"), STANDARD_FIX_TEXT.length]) {
      moveCursor(offset);
      expectEditorsPlace();
    }
    moveCursor(STANDARD_FIX_TEXT.indexOf("dsl"));
    expect(bar()).toHaveTextContent("DSL analyzer · Ln 4, Col 3 · UTF-8");
  });

  it("follows typing too, which moves the cursor with the text", () => {
    acceptEverything();
    render(page());

    moveCursor(STANDARD_FIX_TEXT.indexOf("dsl"));
    const view = editor();
    act(() => {
      view.dispatch({ changes: { from: 0, insert: "// tighten the retry\n" }, userEvent: "input.type" });
    });

    // A line typed above the cursor moves it down one line, and the strip follows.
    expect(bar()).toHaveTextContent("Ln 5, Col 3");
    expectEditorsPlace();
  });

  it("degrades honestly as the save loop moves — saving… while pending and in flight, parse error, then synced once the fix saves", async () => {
    const inFlight = deferred<ActionOutcome<WorkflowCode>>();
    saveCall.mockReturnValueOnce(inFlight.promise).mockResolvedValueOnce(saved(EDITED));
    render(page());

    typeInto(TYPO);
    expect(sync()).toHaveTextContent(/^saving…$/);

    await elapse(DELAY);
    expect(saveCall).toHaveBeenCalledOnce();
    expect(sync()).toHaveTextContent(/^saving…$/);

    inFlight.release(INVALID);
    await elapse(0);
    expect(sync()).toHaveTextContent(/^parse error$/);
    expect(sync()).toHaveClass("code-status__sync--err");

    typeInto(EDITED);
    expect(sync()).toHaveTextContent(/^saving…$/);
    await elapse(DELAY);
    expect(sync()).toHaveTextContent(/^⟲ synced with visual editor$/);
  });

  it("says conflict once another editor's change stops the loop", async () => {
    saveCall.mockResolvedValue(CONFLICT);
    render(page());

    typeInto(EDITED);
    await elapse(DELAY);

    expect(sync()).toHaveTextContent(/^conflict$/);
    expect(sync()).toHaveClass("code-status__sync--warn");
  });

  it("says not saved — never synced — while a failed write waits to be tried again", async () => {
    saveCall.mockResolvedValue(FAILED);
    render(page());

    typeInto(EDITED);
    await elapse(DELAY);

    expect(sync()).toHaveTextContent(/^not saved$/);
  });

  it("names the version in force for a file with no draft open, and a draft once something is written", async () => {
    acceptEverything();
    render(page(workflowCode({ version: 14, spans: SPANS })));

    expect(bar()).toHaveTextContent("v14 in force");

    typeInto(EDITED);
    await elapse(DELAY);

    expect(bar()).toHaveTextContent("v15 draft");
  });

  it("stays synced for a member, whose page writes nothing", () => {
    render(page(FILE, false));

    expect(sync()).toHaveTextContent(/^⟲ synced with visual editor$/);
  });
});

describe("Validate", () => {
  it("writes what is waiting, then validates — filling Loop Checks and the editor, and publishing nothing", async () => {
    acceptEverything();
    const findings = [
      {
        severity: "error" as const,
        range: callRange(EDITED, 7),
        code: ENGINE_FINDING.code,
        message: ENGINE_FINDING.message,
        node: "issue-queued",
      },
    ];
    validateCall.mockResolvedValue({
      ok: true,
      value: codeValidation({
        file: workflowCode({ text: EDITED, etag: "etag-2", spans: [{ node: "issue-queued", startLine: 7, endLine: 7 }], diagnostics: findings }),
        checks: codeChecks({
          etag: "etag-2",
          rows: [{ id: "graph", status: "err", title: "1 validation error", note: ENGINE_FINDING.message }],
        }),
        findings: [ENGINE_FINDING],
      }),
    });
    render(page());

    typeInto(EDITED);
    await pressValidate();

    // The edit was written first, so what was validated is the text on the screen.
    expect(saveCall).toHaveBeenCalledExactlyOnceWith(SLUG, READ_ETAG, EDITED);
    expect(validateCall).toHaveBeenCalledExactlyOnceWith(SLUG);
    expect(saveCall.mock.invocationCallOrder[0]).toBeLessThan(validateCall.mock.invocationCallOrder[0] ?? 0);
    expect(publishCall).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Validation found 1 finding — marked in the file and counted in Loop Checks. Nothing was published.",
    );
    expect(within(panel()).getByText("1 validation error")).toBeInTheDocument();
    expect(panel()).not.toHaveTextContent(CHECKS_STALE_NOTE);
    expect(underlined()).toEqual([EDITED.split("\n")[6]?.trim()]);
    // Nothing moved the version.
    expect(screen.getByRole("button", { name: "Publish v15" })).toBeInTheDocument();
  });

  it("says green in words when every check passes, and draws nothing", async () => {
    validateCall.mockResolvedValue({ ok: true, value: codeValidation({ file: FILE }) });
    render(page());

    await pressValidate();

    expect(saveCall).not.toHaveBeenCalled();
    expect(screen.getByRole("status", { name: "" })).toBeInTheDocument();
    expect(screen.getByText(VALIDATED_MESSAGE)).toBeInTheDocument();
    expect(diagnosticCount(editor().state)).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: DISMISS_TOAST_LABEL }));
    expect(screen.queryByText(VALIDATED_MESSAGE)).toBeNull();
  });

  it("validates nothing while the file does not parse, and says so", async () => {
    saveCall.mockResolvedValue(INVALID);
    render(page());

    typeInto(TYPO);
    await pressValidate();

    expect(validateCall).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(VALIDATE_UNPARSED_MESSAGE);
  });

  it("says the engine could not check it — never green — and leaves Loop Checks as they were", async () => {
    validateCall.mockResolvedValue({
      ok: false,
      refusal: { code: "engine_unavailable", message: "The engine could not validate the definition.", details: {} },
    });
    render(page());

    await pressValidate();

    expect(screen.getByRole("alert")).toHaveTextContent(VALIDATE_ENGINE_UNAVAILABLE_MESSAGE);
    expect(screen.queryByText(VALIDATED_MESSAGE)).toBeNull();
    expect(within(panel()).getByText("Graph acyclic except declared gate loop")).toBeInTheDocument();
  });

  it("stops drawing its findings once a save moves past the draft they were found in, and marks the checks stale", async () => {
    validateCall.mockResolvedValue({
      ok: true,
      value: codeValidation({
        file: workflowCode({
          spans: SPANS,
          diagnostics: [{ severity: "error", range: callRange(STANDARD_FIX_TEXT, 6), code: "loop.unbounded", message: "No." }],
        }),
        checks: codeChecks({ rows: [{ id: "graph", status: "err", title: "1 validation error", note: "No." }] }),
        findings: [ENGINE_FINDING],
      }),
    });
    render(page());

    await pressValidate();
    expect(diagnosticCount(editor().state)).toBe(1);

    acceptEverything();
    typeInto(EDITED);
    await elapse(DELAY);

    expect(diagnosticCount(editor().state)).toBe(0);
    expect(panel()).toHaveTextContent(CHECKS_STALE_NOTE);
  });

  it("is every member's: a member validates, and is offered no Publish", async () => {
    validateCall.mockResolvedValue({ ok: true, value: codeValidation({ file: FILE }) });
    render(page(FILE, false));

    await pressValidate();

    expect(validateCall).toHaveBeenCalledExactlyOnceWith(SLUG);
    expect(screen.queryByRole("button", { name: /^Publish v/ })).toBeNull();
  });
});

describe("Publish", () => {
  it("opens the shared dialog, writes what is waiting, and bumps the version the head and the strip show", async () => {
    acceptEverything();
    publishCall.mockResolvedValue({
      ok: true,
      value: {
        version: 15,
        definition: {},
        changeNote: "Tightened the retry.",
        publishedAt: "2026-09-15T12:00:00.000Z",
        publishedBy: "9f1c0a5e0f6d4a1b9d5e2b8f3c7a4e10",
      },
    });
    render(page());

    typeInto(EDITED);
    await publishWith("Publish v15");

    expect(saveCall).toHaveBeenCalledExactlyOnceWith(SLUG, READ_ETAG, EDITED);
    expect(publishCall).toHaveBeenCalledExactlyOnceWith(railEntry().id, "Tightened the retry.");
    expect(saveCall.mock.invocationCallOrder[0]).toBeLessThan(publishCall.mock.invocationCallOrder[0] ?? 0);
    expect(validateCall).not.toHaveBeenCalled();

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText(/^Published v15\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish v16" })).toBeInTheDocument();
    expect(bar()).toHaveTextContent("v16 draft");
    // The rail's version moved, and the visual editor's head reads the same rail.
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("anchors a refusal's findings in the code view: listed in the dialog, drawn in the editor, each selecting its stage", async () => {
    publishCall.mockResolvedValue({
      ok: false,
      refusal: {
        code: "workflow_definition_invalid",
        message: "This definition cannot be published.",
        details: { findings: [ENGINE_FINDING] },
      },
    });
    render(page());

    const dialog = await publishWith("Publish v15");

    expect(within(dialog).getByText(FINDINGS_MESSAGE)).toBeInTheDocument();
    const list = within(dialog).getByRole("list", { name: FINDINGS_LABEL });
    const anchored = within(list).getByRole("button", { name: /Select issue-queued/ });
    expect(anchored).toHaveTextContent(ENGINE_FINDING.message);

    // Drawn on the stage's lines, even before one is selected.
    expect(underlined()).toEqual([STANDARD_FIX_TEXT.split("\n")[5]?.trim()]);
    expect(refresh).not.toHaveBeenCalled();
    expect(within(head()).getByRole("button", { name: "Publish v15" })).toBeInTheDocument();

    fireEvent.click(anchored);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(editor().state.selection.main.head).toBe(lineStarts(STANDARD_FIX_TEXT)[5]);
    expect(bar()).toHaveTextContent("Ln 6, Col 1");
  });

  it("publishes nothing while the file does not parse, and says so in the dialog", async () => {
    saveCall.mockResolvedValue(INVALID);
    render(page());

    typeInto(TYPO);
    await elapse(DELAY);
    const dialog = await publishWith("Publish v15");

    expect(publishCall).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("alert")).toHaveTextContent(PUBLISH_UNPARSED_MESSAGE);
  });
});

describe("a page with no file", () => {
  it("draws both actions inert, saying they act on the file, and no status bar", () => {
    render(
      <CodeScreen
        mayAdminister
        readings={codeReadings({ selected: { entry: railEntry(), file: { kind: "failed", reason: "Refused." } } })}
        role="owner"
        workspace={freshWorkspace()}
      />,
    );

    expect(screen.getByRole("button", { name: VALIDATE_LABEL })).toHaveAttribute("title", VALIDATE_NEEDS_FILE);
    expect(screen.getByRole("button", { name: "Publish v15" })).toHaveAttribute("title", PUBLISH_NEEDS_FILE);
    expect(screen.queryByRole("group", { name: STATUS_BAR_LABEL })).toBeNull();
  });
});

describe("both palettes", () => {
  it("draws the same strip and actions in both, because the palette is CSS's business", () => {
    const workspace = freshWorkspace();
    // One visit first, so both palettes render over the same session rather than the first opening it.
    render(page(FILE, true, workspace)).unmount();
    const [light, dark] = renderInBothPalettes(page(FILE, true, workspace));

    expect(light).toContain("DSL analyzer");
    expect(maskIds(light ?? "")).toBe(maskIds(dark ?? ""));
  });
});
