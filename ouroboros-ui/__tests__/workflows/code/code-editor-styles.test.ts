import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { DSL_TOKEN_CLASSES } from "@/app/workflows/code/dsl-language";

/**
 * The code editor's sheet (V.2, [#170](https://github.com/NobuData/ouroboros/issues/170)) and
 * its agreements with CodeMirror.
 *
 * The first is the ticket's *no CodeMirror default styling is visible — every color resolves from
 * a token*, as an assertion: CodeMirror's base theme is read out of the installed library, every
 * rule in it that writes a colour is listed, and each must be either re-coloured by this sheet on
 * a token, or belong to an extension the editor never mounts. The list is read, not copied, so a
 * library upgrade that adds a colour goes red here rather than grey in the editor.
 *
 * The rest is mockup 05's `.ed` skin, rule by rule, on the tokens its values map to — which is
 * what makes a dark-only mockup a two-palette editor. jsdom computes no style, so the picture is
 * the browser's.
 */

const UI = join(import.meta.dirname, "..", "..", "..");
const CODE_DIR = join(UI, "app", "workflows", "code");

/** The sheet without its prose. */
const CODE = readFileSync(join(CODE_DIR, "code-editor.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");

/** The modules that mount the editor and name its classes. */
const EXTENSIONS = readFileSync(join(CODE_DIR, "code-editor-extensions.ts"), "utf8");
const MODULES = ["code-editor.tsx", "code-editor-extensions.ts", "dsl-language.ts"]
  .map((name) => readFileSync(join(CODE_DIR, name), "utf8"))
  .join("\n");

/** The token sheet without its prose. */
const TOKENS = readFileSync(join(UI, "app", "tokens.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");

/** CodeMirror's view module, as installed. */
const LIBRARY = readFileSync(createRequire(import.meta.url).resolve("@codemirror/view"), "utf8");

/** One rule of the sheet: its selectors and its declarations. */
interface Rule {
  readonly selectors: readonly string[];
  readonly body: string;
}

/** Every rule in the sheet, `@media` blocks' included. */
const RULES: readonly Rule[] = [...CODE.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
  selectors: match[1].split(",").map((selector) => selector.replace(/\s+/g, " ").trim()),
  body: match[2],
}));

/**
 * The declarations of every rule that lists a selector.
 *
 * @param selector The selector, exactly as the sheet spells it (whitespace collapsed).
 * @returns The rules' bodies, joined — `""` when no rule lists it.
 */
function declarations(selector: string): string {
  return RULES.filter((rule) => rule.selectors.includes(selector))
    .map((rule) => rule.body)
    .join("\n");
}

/**
 * The custom properties one block of the token sheet defines.
 *
 * @param selector The block's selector, as a regular expression fragment.
 * @returns The names it defines.
 */
function definedIn(selector: string): Set<string> {
  const block = new RegExp(`${selector}\\s*\\{([^}]*)\\}`).exec(TOKENS)?.[1] ?? "";
  return new Set([...block.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1]));
}

/**
 * The top-level rules of CodeMirror's base theme that write a colour, by their spec key.
 *
 * @returns The keys — `"&light .cm-gutters"`, `".cm-cursor, .cm-dropCursor"` — in source order.
 */
function libraryColourRules(): string[] {
  const block = /baseTheme\$1 = [^{]*\{([\s\S]*?)\n\}, lightDarkIDs\);/.exec(LIBRARY)?.[1] ?? "";
  const keys: string[] = [];
  let key: string | null = null;
  let body = "";

  // A trailing `// Issue #456` is prose, and its issue number would read as a hex colour.
  for (const line of block.split("\n").map((text) => text.replace(/(?<=[,{])\s*\/\/.*$/, ""))) {
    const open = /^ {4}"([^"]+)": \{(.*)$/.exec(line);
    if (open) {
      key = open[1];
      body = open[2];
      // A rule written on one line closes on it.
      if (/\},?\s*$/.test(open[2])) {
        if (COLOUR.test(body)) keys.push(key);
        key = null;
      }
      continue;
    }
    if (key === null) continue;
    if (/^ {4}\},?$/.test(line)) {
      if (COLOUR.test(body)) keys.push(key);
      key = null;
    } else {
      body += `\n${line}`;
    }
  }

  return keys;
}

/**
 * A colour as CodeMirror's base theme writes one: a hex — plain, or URL-encoded inside an SVG data
 * URL (`%23888`) — a colour function, or a named colour.
 */
const COLOUR = /#[0-9a-fA-F]{3,8}\b|%23[0-9a-fA-F]{3,6}\b|rgba?\(|\b(?:black|white|red|silver|gr[ae]y)\b/;

/**
 * Every base-theme colour rule this sheet re-colours: the library's key, the rule here that
 * overrides it, and the property that rule sets on a token.
 */
const OVERRIDDEN: Record<string, { readonly selector: string; readonly property: string }> = {
  "&": { selector: ".code-editor .cm-editor.cm-focused", property: "outline" },
  "&light .cm-content": { selector: ".code-editor .cm-editor .cm-content", property: "caret-color" },
  "&dark .cm-content": { selector: ".code-editor .cm-editor .cm-content", property: "caret-color" },
  "&light .cm-selectionBackground": {
    selector: ".code-editor .cm-editor .cm-selectionBackground",
    property: "background",
  },
  "&dark .cm-selectionBackground": {
    selector: ".code-editor .cm-editor .cm-selectionBackground",
    property: "background",
  },
  "&light.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
    selector: ".code-editor .cm-editor.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground",
    property: "background",
  },
  "&dark.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
    selector: ".code-editor .cm-editor.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground",
    property: "background",
  },
  ".cm-cursor, .cm-dropCursor": { selector: ".code-editor .cm-editor .cm-cursor", property: "border-inline-start" },
  "&dark .cm-cursor": { selector: ".code-editor .cm-editor .cm-cursor", property: "border-inline-start" },
  "&light .cm-activeLine": { selector: ".code-editor .cm-editor .cm-activeLine", property: "background" },
  "&dark .cm-activeLine": { selector: ".code-editor .cm-editor .cm-activeLine", property: "background" },
  "&light .cm-specialChar": { selector: ".code-editor .cm-editor .cm-specialChar", property: "color" },
  "&dark .cm-specialChar": { selector: ".code-editor .cm-editor .cm-specialChar", property: "color" },
  "&light .cm-gutters": { selector: ".code-editor .cm-editor .cm-gutters.cm-gutters-before", property: "background" },
  "&dark .cm-gutters": { selector: ".code-editor .cm-editor .cm-gutters", property: "background" },
  "&light .cm-activeLineGutter": { selector: ".code-editor .cm-editor .cm-activeLineGutter", property: "background" },
  "&dark .cm-activeLineGutter": { selector: ".code-editor .cm-editor .cm-activeLineGutter", property: "background" },
};

/**
 * Every base-theme colour rule this sheet leaves alone, and the extension that would draw it — an
 * extension the editor must therefore not mount.
 */
const NOT_MOUNTED: Record<string, string> = {
  "&light .cm-panels": "showPanel",
  "&light .cm-panels-top": "showPanel",
  "&light .cm-panels-bottom": "showPanel",
  "&dark .cm-panels": "showPanel",
  ".cm-placeholder": "placeholder",
  ".cm-highlightSpace": "highlightWhitespace",
  ".cm-highlightTab": "highlightWhitespace",
  ".cm-trailingSpace": "highlightTrailingWhitespace",
  "&light .cm-button": "@codemirror/search",
  "&dark .cm-button": "@codemirror/search",
  ".cm-textfield": "@codemirror/search",
  "&light .cm-textfield": "@codemirror/search",
  "&dark .cm-textfield": "@codemirror/search",
};

describe("CodeMirror's default colours", () => {
  const found = libraryColourRules();

  it("are found in the installed library, so the rules below have something to hold the sheet to", () => {
    expect(found.length).toBeGreaterThan(20);
    expect(found).toContain("&light .cm-gutters");
    expect(found).toContain(".cm-cursor, .cm-dropCursor");
  });

  it("are each either re-coloured here or drawn by an extension the editor does not mount", () => {
    const accounted = new Set([...Object.keys(OVERRIDDEN), ...Object.keys(NOT_MOUNTED)]);

    expect(found.filter((key) => !accounted.has(key))).toEqual([]);
    // And the lists name nothing the library no longer has, so they cannot go stale silently.
    expect([...accounted].filter((key) => !found.includes(key))).toEqual([]);
  });

  it.each(Object.entries(OVERRIDDEN))("%s is re-coloured on a token", (_key, { selector, property }) => {
    const value = new RegExp(`(?:^|[;\\s])${property}:\\s*([^;]+);`).exec(declarations(selector))?.[1];

    expect(value, `${selector} sets no ${property}`).toBeDefined();
    expect(value).toMatch(/var\(--[a-z0-9-]+\)|^none$/);
  });

  it.each(Object.entries(NOT_MOUNTED))("%s is never drawn: %s is not mounted", (_key, extension) => {
    expect(EXTENSIONS).not.toContain(extension);
  });

  it("is out-counted by every rule here: each one is scoped under the wrapper and the editor", () => {
    for (const { selectors } of RULES) {
      for (const selector of selectors) {
        expect(selector).toMatch(/^\.code-editor(?:--read-only)?(?:__[a-z]+)?(?:\s|:|$)/);
      }
    }
  });
});

describe("the sheet and the modules", () => {
  const declared = new Set([...CODE.matchAll(/\.(code-editor[a-z0-9_-]*)/g)].map((match) => match[1]));
  // A class inside a string literal, alone or among others: `"code-editor code-editor--read-only"`.
  // Module names (`./code-editor-extensions`) are not classes and do not match.
  const rendered = new Set(
    [...MODULES.matchAll(/(?<=["\s])(code-editor(?:(?:__|--)[a-z]+(?:-[a-z]+)*)?)(?=["\s])/g)].map(
      (match) => match[1],
    ),
  );

  it("declares every class the modules render", () => {
    expect([...rendered].filter((name) => !declared.has(name))).toEqual([]);
  });

  it("renders every class it declares", () => {
    expect([...declared].filter((name) => !rendered.has(name))).toEqual([]);
  });

  it("colours each of the DSL's five token classes", () => {
    for (const name of Object.values(DSL_TOKEN_CLASSES)) {
      expect(declarations(`.code-editor .${name}`), name).toMatch(/color:\s*var\(--/);
    }
  });
});

describe("mockup 05's .ed skin", () => {
  it("is the syntax palette: c-kw accent, c-str ok, c-num warn, c-fn model, c-cm faint and italic", () => {
    expect(declarations(".code-editor .code-editor__keyword")).toContain("color: var(--accent)");
    expect(declarations(".code-editor .code-editor__string")).toContain("color: var(--ok)");
    expect(declarations(".code-editor .code-editor__number")).toContain("color: var(--warn)");
    expect(declarations(".code-editor .code-editor__callee")).toContain("color: var(--model)");
    expect(declarations(".code-editor .code-editor__comment")).toContain("color: var(--ink-faint)");
    expect(declarations(".code-editor .code-editor__comment")).toContain("font-style: italic");
  });

  it("is mono on the inset well, in the code block's type", () => {
    expect(declarations(".code-editor .cm-editor")).toContain("background: var(--inset)");
    expect(declarations(".code-editor .cm-editor")).toContain("font-size: var(--t-xs)");
    expect(declarations(".code-editor .cm-editor .cm-scroller")).toContain("font-family: var(--f-mono)");
    expect(declarations(".code-editor .cm-editor .cm-scroller")).toContain("line-height: var(--lh-loose)");
  });

  it("scrolls inside its own wrapper, bounded, so the pane never scrolls sideways because of it", () => {
    expect(declarations(".code-editor .cm-editor")).toMatch(/max-height:\s*[\d.]+vh/);
    expect(declarations(".code-editor .cm-editor")).toContain("overflow: hidden");
    expect(declarations(".code-editor .cm-editor .cm-scroller")).toContain("overflow: auto");
    expect(declarations(".code-editor")).toContain("min-width: 0");
  });

  it("numbers lines in the .ln .no treatment: faint, with no rule beside them", () => {
    const gutters = declarations(".code-editor .cm-editor .cm-gutters");

    expect(gutters).toContain("color: var(--ink-faint)");
    expect(gutters).toContain("background: var(--inset)");
    expect(gutters).toMatch(/border: 0 solid/);
  });

  it("marks the current line per .ln.cur: tinted, its number in the accent, the accent-deep inset", () => {
    expect(declarations(".code-editor .cm-editor .cm-activeLine")).toContain("background: var(--accent-tint)");

    const gutter = declarations(".code-editor .cm-editor .cm-activeLineGutter");
    expect(gutter).toContain("background: var(--accent-tint)");
    expect(gutter).toContain("color: var(--accent)");
    expect(gutter).toContain("box-shadow: inset 2px 0 0 var(--accent-deep)");
  });

  it("draws .caret-i: two pixels of accent under the accent's glow", () => {
    const caret = declarations(".code-editor .cm-editor .cm-cursor");

    expect(caret).toContain("border-inline-start: 2px solid var(--accent)");
    expect(caret).toMatch(/box-shadow:[^;]*var\(--accent-glow\)/);
  });

  it("holds the caret still for a reader who asked for less motion", () => {
    const guard = CODE.indexOf("@media (prefers-reduced-motion: reduce)");

    expect(guard).toBeGreaterThanOrEqual(0);
    expect(CODE.slice(guard)).toMatch(/\.cm-cursorLayer\s*\{\s*animation: none;/);
  });

  it("tints the selection with the accent's selection token, drawn or native", () => {
    expect(declarations(".code-editor .cm-editor .cm-content ::selection")).toContain(
      "background: var(--accent-select)",
    );
  });

  it("outlines the read-only variant when the keyboard is in it, and not the editable one", () => {
    expect(declarations(".code-editor .cm-editor.cm-focused")).toContain("outline: none");
    expect(declarations(".code-editor--read-only .cm-editor.cm-focused")).toMatch(
      /outline:\s*2px solid var\(--accent\)/,
    );
  });

  it("hides the pre-mount text once CodeMirror is in its host", () => {
    expect(declarations(".code-editor__host:not(:empty) + .code-editor__static")).toContain("display: none");
    expect(declarations(".code-editor__static")).toContain("font-size: var(--t-xs)");
    expect(declarations(".code-editor__static")).toContain("line-height: var(--lh-loose)");
  });
});

describe("both themes", () => {
  const light = definedIn(":root");
  const dark = definedIn(':root\\[data-theme="dark"\\]');
  const read = new Set([...CODE.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((match) => match[1]));
  const colours = [
    "--inset",
    "--ink-dim",
    "--ink-faint",
    "--accent",
    "--accent-deep",
    "--accent-tint",
    "--accent-glow",
    "--accent-select",
    "--ok",
    "--warn",
    "--model",
    "--err",
  ];

  it("names no colour literal — every hue is a token", () => {
    expect(CODE).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  });

  it("reads only tokens the light palette defines", () => {
    expect(read.size).toBeGreaterThan(0);
    expect([...read].filter((name) => !light.has(name))).toEqual([]);
  });

  it("reads exactly the colours listed, and the dark palette redefines each", () => {
    const readColours = [...read].filter((name) => !/^--(?:sp|t|lh|r|f)-/.test(name));

    expect(readColours.sort()).toEqual([...colours].sort());
    expect(colours.filter((name) => !dark.has(name))).toEqual([]);
  });

  it("takes every font size from the scale", () => {
    for (const [, value] of CODE.matchAll(/font-size:\s*([^;]+);/g)) {
      expect(value.trim()).toMatch(/^var\(--t-/);
    }
  });

  it("writes pixels only for hairlines, rings, the caret and its glow", () => {
    for (const [declaration] of CODE.matchAll(/[\w-]+:[^;{}]*?-?\b[\d.]+px/g)) {
      expect(declaration).toMatch(/^(?:border-inline-start|outline|box-shadow|margin-inline-start)/);
    }
  });
});
