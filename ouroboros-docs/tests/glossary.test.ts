import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** The glossary page's directory (`ouroboros-docs/docs/user-guide/`). */
const PAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "user-guide");

/** One glossary entry: its term and the page links in its definition. */
interface Term {
  /** The bold term that opens the entry. */
  term: string;
  /** Every relative `.mdx` link in the entry, without any `#anchor`. */
  links: string[];
}

/**
 * Reads the glossary's entries — paragraphs that open with a bold term and an em dash.
 *
 * @returns the entries, in page order.
 */
function readTerms(): Term[] {
  const text = readFileSync(join(PAGE_DIR, "glossary.mdx"), "utf8");
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .flatMap((paragraph) => {
      const head = /^\*\*(.+?)\*\* —/.exec(paragraph);
      if (!head) return [];
      const links = [...paragraph.matchAll(/\]\((\.{1,2}\/[^)#]+\.mdx)(?:#[^)]*)?\)/g)].map(
        (match) => match[1],
      );
      return [{ term: head[1], links }];
    });
}

describe("the glossary (#1173)", () => {
  const terms = readTerms();

  it("defines the vocabulary new users meet first", () => {
    const names = terms.map((entry) => entry.term);
    for (const word of ["Loop", "Run", "Workflow", "Gate", "Decision", "Pool", "Workspace"]) {
      expect(names, word).toContain(word);
    }
  });

  it("is alphabetical", () => {
    const names = terms.map((entry) => entry.term.toLowerCase());
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it.each(terms.map((entry) => [entry.term, entry.links] as const))(
    "%s links to a page that exists",
    (_, links) => {
      expect(links.length).toBeGreaterThan(0);
      for (const link of links) expect(existsSync(join(PAGE_DIR, link)), link).toBe(true);
    },
  );
});
