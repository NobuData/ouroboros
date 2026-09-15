import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { OUTCOME_CLASS } from "@/app/workflows/dry-run";

/**
 * The properties of the draft, publish and dry-run flows' rules in `app/workflows/workflows.css` (#152) that
 * are agreements with something outside the sheet — the components' class names, the inspector's placement
 * the dry run's sheet takes over, and the mockup's breakpoint. Colours being tokens is `styles.test.ts`'s.
 */

const SHEET = readFileSync(join(import.meta.dirname, "..", "..", "app", "workflows", "workflows.css"), "utf8");

/** The sheet without its prose, so a rule cannot be found inside a comment. */
const CODE = SHEET.replace(/\/\*[\s\S]*?\*\//g, " ");

/**
 * One rule's declarations.
 *
 * @param selector The selector, as a regular expression fragment.
 * @returns What is between its braces, or `""` when there is no such rule.
 */
function rule(selector: string): string {
  return new RegExp(`(?:^|[}\\s])${selector}\\s*\\{([^}]*)\\}`).exec(CODE)?.[1] ?? "";
}

describe("the dry run's sheet", () => {
  it("sits in the inspector's track as the inspector does: sticky, bounded, scrolling inside itself", () => {
    const sheet = rule("\\.studio-dryrun");

    expect(sheet).toMatch(/position:\s*sticky/);
    expect(sheet).toMatch(/max-height:\s*calc\(100vh/);
    expect(sheet).toMatch(/overflow-y:\s*auto/);
    expect(sheet).toMatch(/min-width:\s*0/);
  });

  it("stacks under the canvas at the mockup's break, and scrolls with the page", () => {
    const breakpoint = /@media \(max-width: 68\.75rem\)\s*\{\s*\.studio-dryrun\s*\{([^}]*)\}/.exec(CODE)?.[1] ?? "";

    expect(breakpoint).toMatch(/position:\s*static/);
    expect(breakpoint).toMatch(/max-height:\s*none/);
  });

  it("draws every edge outcome the sheet can name", () => {
    for (const modifier of Object.values(OUTCOME_CLASS)) {
      expect(rule(`\\.studio-dryrun__edge--${modifier}`), modifier).toMatch(/border-left/);
    }
  });

  it("draws a loop's rule dashed, as the canvas draws the loop", () => {
    expect(rule("\\.studio-dryrun__edge--loop")).toMatch(/border-left-style:\s*dashed/);
  });
});

describe("the findings", () => {
  it("scroll inside the dialog, so its controls stay reachable", () => {
    const list = rule("\\.studio-findings");

    expect(list).toMatch(/max-height:\s*[\d.]+rem/);
    expect(list).toMatch(/overflow-y:\s*auto/);
  });

  it("let a long message wrap rather than widen the dialog", () => {
    expect(rule("\\.studio-findings__message")).toMatch(/overflow-wrap:\s*anywhere/);
  });
});

describe("the toast and the dialogs", () => {
  it("wrap at narrow widths", () => {
    expect(rule("\\.studio-toast")).toMatch(/flex-wrap:\s*wrap/);
    expect(rule("\\.studio-dialog__actions")).toMatch(/flex-wrap:\s*wrap/);
  });
});
