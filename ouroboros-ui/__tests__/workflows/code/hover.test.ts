import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";

import type { CodeSymbol, CodeSymbolTable } from "@/app/api/workflows";
import { hoverTarget } from "@/app/workflows/code/context";
import { dslHover, hoverAt, hoverCardElement } from "@/app/workflows/code/hover";
import { dslIntelligence } from "@/app/workflows/code/intelligence";
import { indexSymbols, signatureDetail } from "@/app/workflows/code/symbols";

import { CODE_SYMBOLS, STANDARD_FIX, stage, wordIn } from "../../helpers/code-symbols";

/**
 * Hover docs (W.1, [#177](https://github.com/NobuData/ouroboros/issues/177)): mockup 05's
 * `route.task` card over the golden file, and the ticket's honesty criterion — **hovering a
 * symbol the table does not describe shows nothing** — verified both for named cases and by
 * sweeping every offset of a file.
 */

const INDEX = indexSymbols(CODE_SYMBOLS);

/** Mockup 05's Types card, as the tooltip's DOM. */
const ROUTE_TASK_CARD =
  '<div class="code-hover-doc"><div class="code-hover-doc__signature">' +
  '<span class="code-hover-doc__name">route.task</span><span>(name: </span>' +
  '<span class="code-hover-doc__type">TaskKind</span><span>): </span>' +
  '<span class="code-hover-doc__type">ModelRoute</span></div>' +
  '<p class="code-hover-doc__doc">Resolves the model assigned to a task kind in Model Routing.</p>' +
  "</div>";

describe("the route.task card — mockup 05", () => {
  const pos = wordIn(STANDARD_FIX, 'route.task("implement")', "task");

  it("describes route.task over the golden file, spanning `route.task`", () => {
    const hit = hoverAt(INDEX, STANDARD_FIX, pos);
    const from = wordIn(STANDARD_FIX, 'route.task("implement")', "route");

    expect(hit).toMatchObject({ from, to: from + "route.task".length });
    expect(hit?.symbol.signature.map((part) => part.text).join("")).toBe(
      "route.task(name: TaskKind): ModelRoute",
    );
    expect(hit?.symbol.doc).toBe("Resolves the model assigned to a task kind in Model Routing.");
  });

  it("builds exactly the mockup's card", () => {
    const hit = hoverAt(INDEX, STANDARD_FIX, pos)!;

    expect(hoverCardElement(hit.symbol, document).outerHTML).toBe(ROUTE_TASK_CARD);
  });

  it("says nothing about a fallback chain routing does not have", () => {
    const hit = hoverAt(INDEX, STANDARD_FIX, pos)!;

    expect(hoverCardElement(hit.symbol, document).textContent).not.toMatch(/fall|chain/i);
  });
});

describe("unknown symbols show nothing", () => {
  it.each([
    ["an unknown route method", 'llm("a", {\n      model: route.pool("x"),', "route.pool", "pool"],
    ["an unknown stage call", 'review("r", {\n      title: "R",', 'review("r"', "review"],
    ["an unknown option", 'llm("a", {\n      cache: "ccache",', "cache:", "cache"],
    ["an unknown predicate method", 'decision("d", {\n      when: (i) => i.effort.between(effort.M),', "between", "between"],
    ["an unknown effort constant", 'decision("d", {\n      when: (i) => i.effort.lte(effort.XXL),', "XXL", "XXL"],
  ])("shows nothing over %s", (_case, call, needle, word) => {
    const text = stage(call);
    const pos = wordIn(text, needle, word);

    // The context names a symbol; the table does not describe it; so there is no card.
    expect(hoverTarget(text, pos)).not.toBeNull();
    expect(hoverAt(INDEX, text, pos)).toBeNull();
  });

  it("only ever answers with a card the table holds, anywhere in the golden file", () => {
    const described = new Set(CODE_SYMBOLS.symbols);
    const hits = [...STANDARD_FIX].flatMap((_char, offset) => {
      const hit = hoverAt(INDEX, STANDARD_FIX, offset);
      return hit === null ? [] : [hit];
    });

    expect(hits.length).toBeGreaterThan(0);
    expect(hits.filter((hit) => !described.has(hit.symbol))).toEqual([]);
  });

  it("answers nothing anywhere in the golden file when the table describes nothing", () => {
    const empty = indexSymbols({ ...CODE_SYMBOLS, symbols: [] });

    const hits = [...STANDARD_FIX].filter((_char, offset) => hoverAt(empty, STANDARD_FIX, offset) !== null);

    expect(hits).toEqual([]);
  });
});

describe("the card's DOM", () => {
  it("draws no doc line for a symbol the schema does not describe", () => {
    const retries = INDEX.symbols.get("stage.llm.retries")!;
    const card = hoverCardElement(retries, document);

    expect(retries.doc).toBeUndefined();
    expect(card.querySelector("p")).toBeNull();
    expect(card.textContent).toBe("retries: integer");
  });

  it("writes a description as text, never as markup", () => {
    const symbol: CodeSymbol = {
      symbol: "stage.llm.prompt",
      signature: [{ text: "prompt", role: "name" }],
      doc: "<img src=x onerror=alert(1)>",
    };

    const card = hoverCardElement(symbol, document);

    expect(card.querySelector("img")).toBeNull();
    expect(card.querySelector("p")?.textContent).toBe("<img src=x onerror=alert(1)>");
  });
});

describe("the symbol index", () => {
  it("keeps a symbol's first entry when a table lists it twice", () => {
    const first = CODE_SYMBOLS.symbols[0];
    const table: CodeSymbolTable = {
      ...CODE_SYMBOLS,
      symbols: [...CODE_SYMBOLS.symbols, { ...first, doc: "A later, different sentence." }],
    };

    expect(indexSymbols(table).symbols.get(first.symbol)).toBe(first);
  });

  it("prints a signature without its name for a completion's detail", () => {
    expect(signatureDetail(INDEX.symbols.get("route.task")!)).toBe("(name: TaskKind): ModelRoute");
    expect(signatureDetail(INDEX.symbols.get("stage.llm.permissions")!)).toBe("");
  });
});

describe("the extensions", () => {
  it("mount on an editor over the golden file", () => {
    const parent = document.createElement("div");
    document.body.append(parent);

    const view = new EditorView({
      parent,
      state: EditorState.create({ doc: STANDARD_FIX, extensions: [dslIntelligence(CODE_SYMBOLS)] }),
    });

    expect(parent.querySelector(".cm-editor")).not.toBeNull();
    expect(view.state.doc.toString()).toBe(STANDARD_FIX);

    view.destroy();
    parent.remove();
  });

  it("build the hover extension on its own", () => {
    expect(() => EditorState.create({ extensions: [dslHover(CODE_SYMBOLS)] })).not.toThrow();
  });
});
