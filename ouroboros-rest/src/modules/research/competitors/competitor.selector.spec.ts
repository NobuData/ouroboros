import {
  MAX_SELECTOR_LENGTH,
  SelectorError,
  matchesSelector,
  parseSelector,
  type SelectorNode,
} from "./competitor.selector";

/** An element chain, innermost last: `node("main", {}), node("section", {class: "entries"})`. */
function chain(...elements: [string, Record<string, string>][]): SelectorNode {
  let parent: SelectorNode | null = null;
  for (const [tag, attributes] of elements) {
    const current: SelectorNode = { tag, parent, attribute: (name) => attributes[name] ?? null };
    parent = current;
  }
  if (parent === null) throw new Error("empty chain");
  return parent;
}

describe("the watch selector subset", () => {
  it("matches type, class, id and attribute tests, as descendants and children", () => {
    const entries = chain(
      ["body", {}],
      ["main", {}],
      ["section", { class: "entries wide", id: "log" }],
    );

    expect(matchesSelector(parseSelector("main .entries"), entries)).toBe(true);
    expect(matchesSelector(parseSelector("main > section.entries.wide"), entries)).toBe(true);
    expect(matchesSelector(parseSelector("body > section"), entries)).toBe(false);
    expect(matchesSelector(parseSelector("#log"), entries)).toBe(true);
    expect(matchesSelector(parseSelector("section[id=log]"), entries)).toBe(true);
    expect(matchesSelector(parseSelector('section[class~="wide"]'), entries)).toBe(true);
    expect(matchesSelector(parseSelector("[id^=lo]"), entries)).toBe(true);
    expect(matchesSelector(parseSelector("[id$=og]"), entries)).toBe(true);
    expect(matchesSelector(parseSelector("[id*=o]"), entries)).toBe(true);
    expect(matchesSelector(parseSelector("[data-x]"), entries)).toBe(false);
    expect(matchesSelector(parseSelector("aside, main *"), entries)).toBe(true);
  });

  it.each([
    ["//main/section", "XPath is not supported"],
    ["li:nth-child(2)", "pseudo-classes"],
    ["h2 + p", "sibling combinators"],
    ["main >", "ends with `>`"],
    ["main, ", "empty entry"],
    ["[data=", "attribute test"],
    ["   ", "blank"],
    ["x".repeat(MAX_SELECTOR_LENGTH + 1), "longer than"],
  ])("refuses %j, saying why", (selector, reason) => {
    expect(() => parseSelector(selector)).toThrow(SelectorError);
    expect(() => parseSelector(selector)).toThrow(reason);
  });
});
