import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SecurityStrip } from "@/app/providers/security-strip";
import {
  SECURITY_MODEL_LINK,
  SECURITY_MODEL_URL,
  SECURITY_SHIELD,
  SECURITY_STRIP_COPY,
  SECURITY_STRIP_EMPHASIS,
  SECURITY_STRIP_LABEL,
  SECURITY_STRIP_TAGS,
} from "@/app/providers/view";

import { PALETTES, renderInBothPalettes, renderInPalette } from "../helpers/palettes";

/**
 * The security strip (#232): what reaches the DOM is the approved copy and nothing else.
 *
 * That the copy *is* `docs/SECURITY_MODEL.md` § 7.1 is `view.test.ts`'s, which reads the
 * document; this suite is the review the roadmap asks for at the surface — the sentence,
 * one emphasis, one tag, the link, and **no stowaway badge**.
 */

/** The strip. */
function strip(): HTMLElement {
  render(<SecurityStrip />);

  return screen.getByRole("complementary", { name: SECURITY_STRIP_LABEL });
}

describe("the strip", () => {
  it("is an aside named for what it is, with the shield hidden from the tree", () => {
    const aside = strip();

    expect(aside).toHaveClass("ou-card", "providers-security");
    const shield = aside.querySelector(".providers-security__shield") as HTMLElement;
    expect(shield).toHaveTextContent(SECURITY_SHIELD);
    expect(shield).toHaveAttribute("aria-hidden", "true");
  });

  it("renders the approved sentence, with its one emphasis and nothing else emphasised", () => {
    const copy = strip().querySelector(".providers-security__copy") as HTMLElement;

    expect(copy).toHaveTextContent(SECURITY_STRIP_COPY);
    expect(copy.textContent).toBe(SECURITY_STRIP_COPY);
    const strong = copy.querySelectorAll("strong");
    expect(strong).toHaveLength(1);
    expect(strong[0]).toHaveTextContent(SECURITY_STRIP_EMPHASIS);
  });

  it("carries exactly the tags the document lists — one — as the design system's tag", () => {
    const tags = [...strip().querySelectorAll(".ou-tag")].map((tag) => tag.textContent);

    expect(tags).toEqual([...SECURITY_STRIP_TAGS]);
    expect(tags).toEqual(["self-hosted"]);
  });

  it("links to the security model, leaving the application", () => {
    const link = within(strip()).getByRole("link", { name: SECURITY_MODEL_LINK });

    expect(link).toHaveAttribute("href", SECURITY_MODEL_URL);
    expect(link.getAttribute("href")).toMatch(/\/docs\/SECURITY_MODEL\.md$/);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
    expect(link).toHaveClass("ou-btn--ghost");
  });

  it("carries no unearned compliance badge, and none of the mockup's withdrawn claims", () => {
    // The reviewer's check, as a test: § 7.3 withdrew `SOC 2 Type II` and `ISO 27001`, § 7.1
    // removed `KMS-backed` and the 15-minute-token line. None survives here.
    const text = strip().textContent ?? "";

    expect(text).not.toMatch(/SOC/);
    expect(text).not.toMatch(/ISO/);
    expect(text).not.toMatch(/KMS/);
    expect(text).not.toMatch(/15-minute|token/i);
    expect(text).not.toMatch(/certif/i);
  });
});

describe("both palettes", () => {
  it.each(PALETTES)("renders in the %s palette", (palette) => {
    renderInPalette(palette, <SecurityStrip />);

    expect(document.documentElement).toHaveAttribute("data-theme", palette);
    expect(screen.getByRole("complementary", { name: SECURITY_STRIP_LABEL })).toBeInTheDocument();
  });

  it("draws the same markup in both, and carries no inline style", () => {
    const [light, dark] = renderInBothPalettes(<SecurityStrip />);

    expect(light).toBe(dark);
    expect(light).not.toMatch(/ style=/);
  });
});
