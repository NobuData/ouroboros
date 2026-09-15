import { undo } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CodeEditor } from "@/app/workflows/code/code-editor";
import { CARET_BLINK_MS, editorExtensions } from "@/app/workflows/code/code-editor-extensions";

import { STANDARD_FIX as GOLDEN } from "../../helpers/code-symbols";
import { PALETTES, renderInBothPalettes, renderInPalette } from "../../helpers/palettes";
import { STANDARD_FIX_TEXT } from "../../helpers/workflow-code";

/**
 * The workflow code editor (V.2, #170): CodeMirror mounted over a file's text, in its editable
 * and read-only variants, with the DSL highlighted.
 *
 * jsdom lays nothing out and paints nothing, so what is proven here is the editor's structure —
 * which of CodeMirror's parts are mounted in each variant, what the editable region says about
 * itself, that the markup is the same in both palettes — and what the sheet then does with it is
 * `code-editor-styles.test.ts`'s.
 */

const PATH = "workflows/standard-fix.loop.ts";

/**
 * The view mounted inside a container.
 *
 * @param container The rendered container.
 * @returns The editor view.
 */
function viewIn(container: HTMLElement): EditorView {
  const content = container.querySelector<HTMLElement>(".cm-content");
  expect(content, "the editor is mounted").not.toBeNull();

  const view = EditorView.findFromDOM(content as HTMLElement);
  expect(view).not.toBeNull();
  return view as EditorView;
}

describe("before the editor mounts", () => {
  it("serves the file's text as plain text in an empty host's place, so the first paint is the file", () => {
    const html = renderToString(<CodeEditor label={PATH} text={STANDARD_FIX_TEXT} />);
    const host = document.createElement("div");
    host.innerHTML = html;

    expect(host.querySelector(".code-editor__host")?.childNodes).toHaveLength(0);
    expect(host.querySelector("pre.code-editor__static")?.textContent).toBe(STANDARD_FIX_TEXT);
    expect(host.querySelector(".cm-editor")).toBeNull();
  });
});

describe("the editable editor", () => {
  it("mounts CodeMirror in its host, over the text, with the region named by the path", () => {
    const { container } = render(<CodeEditor label={PATH} text={GOLDEN} />);
    const view = viewIn(container);

    expect(container.querySelector(".code-editor__host > .cm-editor")).not.toBeNull();
    expect(view.state.doc.toString()).toBe(GOLDEN);
    expect(view.contentDOM).toHaveAttribute("aria-label", PATH);
    expect(view.contentDOM).toHaveAttribute("contenteditable", "true");
    expect(container.querySelector(".code-editor")).not.toHaveClass("code-editor--read-only");
  });

  it("numbers the lines, marks the current line and its gutter, and draws its own caret and selection", () => {
    const { container } = render(<CodeEditor label={PATH} text={GOLDEN} />);

    expect(container.querySelector(".cm-gutters .cm-lineNumbers")).not.toBeNull();
    expect(container.querySelector(".cm-lineNumbers")).toHaveTextContent(/1/);
    expect(container.querySelector(".cm-activeLine")).not.toBeNull();
    expect(container.querySelector(".cm-activeLineGutter")).not.toBeNull();
    expect(container.querySelector(".cm-cursorLayer")).not.toBeNull();
    expect(container.querySelector(".cm-selectionLayer")).not.toBeNull();
  });

  it("highlights the DSL with the sheet's classes and no inline colour", () => {
    const { container } = render(<CodeEditor label={PATH} text={GOLDEN} />);

    const texts = (name: string) =>
      [...container.querySelectorAll(`.cm-content .${name}`)].map((span) => span.textContent);

    expect(texts("code-editor__keyword")).toEqual(expect.arrayContaining(["import", "from", "export", "default"]));
    expect(texts("code-editor__callee")).toContain("defineLoop");
    expect(texts("code-editor__string")).toContain('"@ouroboros/sdk"');
    expect(container.querySelector(".cm-content [style*='color']")).toBeNull();
  });

  it("accepts an edit and undoes it", () => {
    const { container } = render(<CodeEditor label={PATH} text={STANDARD_FIX_TEXT} />);
    const view = viewIn(container);

    view.dispatch({ changes: { from: 0, insert: "// note\n" }, userEvent: "input.type" });
    expect(view.state.doc.toString()).toBe(`// note\n${STANDARD_FIX_TEXT}`);

    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(STANDARD_FIX_TEXT);
  });

  it("blinks the caret at the mockup's rate", () => {
    expect(CARET_BLINK_MS).toBe(1100);
  });
});

describe("the read-only variant", () => {
  it("renders without edit affordances: no caret, no current line, nothing typeable", () => {
    const { container } = render(<CodeEditor label={PATH} readOnly text={GOLDEN} />);
    const view = viewIn(container);

    expect(view.state.readOnly).toBe(true);
    expect(view.contentDOM).toHaveAttribute("contenteditable", "false");
    expect(view.contentDOM).toHaveAttribute("aria-readonly", "true");
    expect(container.querySelector(".cm-cursorLayer")).toBeNull();
    expect(container.querySelector(".cm-activeLine")).toBeNull();
    expect(container.querySelector(".cm-activeLineGutter")).toBeNull();
    expect(container.querySelector(".code-editor")).toHaveClass("code-editor--read-only");
  });

  it("keeps the numbers, the highlighting and keyboard focus, so it can be read and scrolled", () => {
    const { container } = render(<CodeEditor label={PATH} readOnly text={GOLDEN} />);
    const view = viewIn(container);

    expect(container.querySelector(".cm-lineNumbers")).not.toBeNull();
    expect(container.querySelector(".code-editor__callee")).not.toBeNull();
    expect(view.contentDOM).toHaveAttribute("tabindex", "0");
    expect(view.contentDOM).toHaveAttribute("aria-label", PATH);
  });

  it("builds a state that is read-only and a view that is not editable", () => {
    const state = EditorState.create({ doc: GOLDEN, extensions: editorExtensions({ readOnly: true, label: PATH }) });

    expect(state.readOnly).toBe(true);
    expect(state.facet(EditorView.editable)).toBe(false);
  });
});

describe("its lifetime", () => {
  it("takes a new text in place, outside the undo history, and rebuilds over a change of variant", () => {
    const { container, rerender } = render(<CodeEditor label={PATH} text={STANDARD_FIX_TEXT} />);
    const before = viewIn(container);

    rerender(<CodeEditor label={PATH} text={GOLDEN} />);
    expect(viewIn(container)).toBe(before);
    expect(viewIn(container).state.doc.toString()).toBe(GOLDEN);
    expect(undo(viewIn(container))).toBe(false);
    expect(container.querySelectorAll(".cm-editor")).toHaveLength(1);

    rerender(<CodeEditor label={PATH} readOnly text={GOLDEN} />);
    expect(viewIn(container).state.readOnly).toBe(true);
    expect(container.querySelectorAll(".cm-editor")).toHaveLength(1);
  });

  it("destroys the editor when it unmounts", () => {
    const { container, unmount } = render(<CodeEditor label={PATH} text={GOLDEN} />);
    const view = viewIn(container);
    const dom = view.dom;

    unmount();

    expect(dom.isConnected).toBe(false);
    expect(document.querySelector(".cm-editor")).toBeNull();
  });
});

describe("reporting edits (V.3, #171)", () => {
  it("hears every edit made in the editor, with the whole document", () => {
    const onChange = vi.fn();
    const { container } = render(<CodeEditor label={PATH} onChange={onChange} text={STANDARD_FIX_TEXT} />);

    viewIn(container).dispatch({ changes: { from: 0, insert: "// a\n" }, userEvent: "input.type" });

    expect(onChange).toHaveBeenCalledExactlyOnceWith(`// a\n${STANDARD_FIX_TEXT}`);
  });

  it("does not echo a text the parent put in, and does not rebuild when fed its own edit back", () => {
    const onChange = vi.fn();
    const { container, rerender } = render(<CodeEditor label={PATH} onChange={onChange} text={STANDARD_FIX_TEXT} />);
    const view = viewIn(container);

    rerender(<CodeEditor label={PATH} onChange={onChange} text={GOLDEN} />);
    expect(onChange).not.toHaveBeenCalled();

    view.dispatch({ changes: { from: 0, insert: "x" }, userEvent: "input.type" });
    const edited = view.state.doc.toString();
    rerender(<CodeEditor label={PATH} onChange={onChange} text={edited} />);

    expect(viewIn(container)).toBe(view);
    expect(view.state.doc.toString()).toBe(edited);
    expect(onChange).toHaveBeenCalledOnce();
    // The edit is still the person's to undo.
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(GOLDEN);
  });

  it("reports to the latest listener without rebuilding", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { container, rerender } = render(<CodeEditor label={PATH} onChange={first} text={GOLDEN} />);
    const view = viewIn(container);

    rerender(<CodeEditor label={PATH} onChange={second} text={GOLDEN} />);
    view.dispatch({ changes: { from: 0, insert: "x" } });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
    expect(viewIn(container)).toBe(view);
  });

  it("builds a new variant over the latest text", () => {
    const { container, rerender } = render(<CodeEditor label={PATH} text={STANDARD_FIX_TEXT} />);

    rerender(<CodeEditor label={PATH} text={GOLDEN} />);
    rerender(<CodeEditor label={PATH} readOnly text={GOLDEN} />);

    expect(viewIn(container).state.doc.toString()).toBe(GOLDEN);
  });

  it("reports nothing, and fails nothing, with no listener", () => {
    const { container } = render(<CodeEditor label={PATH} text={GOLDEN} />);

    expect(() => viewIn(container).dispatch({ changes: { from: 0, insert: "x" } })).not.toThrow();
  });
});

describe("both palettes", () => {
  it.each(PALETTES)("mounts in the %s palette", (palette) => {
    const { container } = renderInPalette(palette, <CodeEditor label={PATH} text={GOLDEN} />);

    expect(document.documentElement).toHaveAttribute("data-theme", palette);
    expect(viewIn(container).state.doc.toString()).toBe(GOLDEN);
  });

  it.each([false, true])("draws the same markup in both (read-only: %s), because the palette is CSS's business", (readOnly) => {
    const [light, dark] = renderInBothPalettes(<CodeEditor label={PATH} readOnly={readOnly} text={GOLDEN} />);

    expect(light).toBe(dark);
  });
});

describe("typing on the seeded file", () => {
  it("costs a small fraction of a frame per keystroke", () => {
    const { container } = render(<CodeEditor label={PATH} text={GOLDEN} />);
    const view = viewIn(container);
    const line = view.state.doc.line(24);
    const samples: number[] = [];

    // Two hundred keystrokes typed mid-file — inside the analyze stage's prompt, where a change
    // re-tokenises from the edited line on — each timed from dispatch to the DOM being updated.
    view.dispatch({ selection: { anchor: line.to } });
    for (let index = 0; index < 200; index += 1) {
      const start = performance.now();
      view.dispatch(view.state.replaceSelection("x"));
      samples.push(performance.now() - start);
    }

    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)];

    expect(view.state.doc.line(24).text.endsWith("x".repeat(200))).toBe(true);
    // A frame at 60fps is 16.7 ms, and jsdom's DOM is slower than a browser's. The median rather
    // than a tail, because a shared CI runner stalls the odd keystroke for reasons that are not
    // the editor's; a tokenizer that re-read the whole file on every keystroke would still blow
    // it. The browser measurement is in the README, and e2e leg 13 checks it on the stack.
    expect(median).toBeLessThan(16.7);
  });
});
