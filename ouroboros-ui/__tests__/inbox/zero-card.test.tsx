import { render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ZeroCard } from "@/app/inbox/zero-card";

import { maskIds, renderInBothPalettes } from "../helpers/palettes";

/**
 * **Inbox zero** (BO.3, #468): the mockup's two lines verbatim, and the #14 glyph with real
 * transparency — one drawing per palette, dimmed by opacity, never by a blend mode.
 */

const SHEET = readFileSync(join(import.meta.dirname, "..", "..", "app", "inbox", "inbox.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  " ",
);

describe("the zero card", () => {
  it("says the mockup's two lines, verbatim", () => {
    render(<ZeroCard />);

    const card = screen.getByRole("region", { name: "Inbox zero" });

    expect(within(card).getByText("Inbox zero. The loop is turning on its own.")).toHaveClass("inbox-zero__line");
    expect(within(card).getByText("You'll be pinged only when policy says so.")).toHaveClass("inbox-zero__note");
  });

  it("draws the brand glyph once per palette, decoratively", () => {
    render(<ZeroCard />);

    const marks = [...screen.getByRole("region", { name: "Inbox zero" }).querySelectorAll("img")];

    expect(marks.map((mark) => mark.className)).toEqual([
      "inbox-zero__mark inbox-zero__mark--light",
      "inbox-zero__mark inbox-zero__mark--dark",
    ]);
    expect(marks.map((mark) => mark.getAttribute("alt"))).toEqual(["", ""]);
    expect(marks[0]!.getAttribute("src")).toContain("glyph-light.png");
    expect(marks[1]!.getAttribute("src")).toContain("glyph-dark.png");
  });

  it("renders the same markup in both palettes", () => {
    const [light, dark] = renderInBothPalettes(<ZeroCard />);

    expect(maskIds(light!)).toBe(maskIds(dark!));
  });
});

describe("the glyph's transparency", () => {
  it("is the asset's own alpha, dimmed by opacity — no blend mode anywhere on the page", () => {
    expect(SHEET).not.toMatch(/mix-blend-mode|background-blend-mode/);
    expect(SHEET).toMatch(/\.inbox-zero__mark\s*\{[^}]*opacity:\s*0\.35/);
  });

  it("shows the light drawing by default and swaps to the dark one in the dark palette", () => {
    expect(SHEET).toMatch(/\.inbox-zero__mark--dark\s*\{\s*display:\s*none/);
    expect(SHEET).toMatch(/:root\[data-theme="dark"\] \.inbox-zero__mark--light\s*\{\s*display:\s*none/);
    expect(SHEET).toMatch(/:root\[data-theme="dark"\] \.inbox-zero__mark--dark\s*\{\s*display:\s*block/);
    // A reader with no stored choice follows the system.
    expect(SHEET).toMatch(/prefers-color-scheme: dark[\s\S]*:root:not\(\[data-theme="light"\]\) \.inbox-zero__mark--dark/);
  });

  it("is a dashed, transparent card — a place where something would be", () => {
    expect(SHEET).toMatch(/\.inbox-zero\s*\{[^}]*border:\s*1px dashed var\(--line-strong\)/);
    expect(SHEET).toMatch(/\.inbox-zero\s*\{[^}]*background:\s*transparent/);
  });
});
