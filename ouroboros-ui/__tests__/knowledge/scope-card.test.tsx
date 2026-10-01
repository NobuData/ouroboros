import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SkillScope } from "@/app/api/skills";
import { PREVIEW_ACTION } from "@/app/knowledge/preview";
import { LADDER_NAME, type LadderInput, NOT_READ, SCOPE_CAPTION, SCOPE_COLD, ladder } from "@/app/knowledge/scope";
import { SCOPE_TITLE } from "@/app/knowledge/view";

import { enabledRepo, seededFacts, seededRepos, seededSkills } from "../helpers/knowledge";
import { maskIds, renderInBothPalettes } from "../helpers/palettes";

/**
 * Mockup 14's scope card as it is drawn (#421): the three steps with their counts in both
 * palettes, the caption verbatim, the tenant chip's scope highlighted, each step a toggle that
 * narrows the page, the cold and unread states, and the preview's door in the head.
 */

vi.mock("@/app/knowledge/preview-actions", () => ({ previewContext: vi.fn() }));

const { ScopeCard } = await import("@/app/knowledge/scope-card");

/** The chip, looking at the seeded repository. */
const HELIOS = { id: enabledRepo().id, name: enabledRepo().name };

/**
 * A ladder's input over the seed.
 *
 * @param over What differs.
 * @returns The input.
 */
function input(over: Partial<LadderInput> = {}): LadderInput {
  return {
    skills: { ok: true, value: seededSkills() },
    facts: { ok: true, value: seededFacts() },
    repos: { ok: true, value: seededRepos() },
    focus: HELIOS,
    workspace: "acme-robotics",
    ...over,
  };
}

const onNarrow = vi.fn();

/**
 * The card, over an input.
 *
 * @param over What differs in the input.
 * @param narrowed The step narrowing the page.
 * @returns The element.
 */
function card(over: Partial<LadderInput> = {}, narrowed: SkillScope | null = null) {
  const from = input(over);

  return (
    <ScopeCard facts={from.facts} narrowed={narrowed} onNarrow={onNarrow} repos={from.repos} skills={from.skills} steps={ladder(from)} />
  );
}

/** The three steps' buttons, in order. */
function steps(): HTMLElement[] {
  return within(screen.getByRole("list", { name: LADDER_NAME })).getAllByRole("button");
}

beforeEach(() => {
  onNarrow.mockReset();
});

describe("the ladder", () => {
  it("is the mockup's three steps with their counts, under the Scope title, over the caption verbatim", () => {
    render(card());

    const region = screen.getByRole("region", { name: SCOPE_TITLE });

    expect(steps().map((step) => step.textContent)).toEqual([
      "Org acme-robotics 2 skills",
      "Repo helios-firmware 3 skills + 1 fact (current)",
      "Workflow overrides 0",
    ]);
    expect(region).toHaveTextContent(SCOPE_CAPTION);
    expect(region.querySelectorAll(".knowledge-scope__arrow")).toHaveLength(2);
    for (const arrow of region.querySelectorAll(".knowledge-scope__arrow")) expect(arrow).toHaveAttribute("aria-hidden", "true");
  });

  it("renders the same markup in both palettes — the sheet is what differs", () => {
    const [light, dark] = renderInBothPalettes(card());

    expect(maskIds(light!)).toBe(maskIds(dark!));
    expect(light).toContain(SCOPE_CAPTION);
  });

  it("highlights the scope the tenant chip is looking at — the repository's", () => {
    render(card());

    const [org, repo, workflow] = steps();

    expect(repo).toHaveAttribute("aria-current", "true");
    expect(repo).toHaveClass("knowledge-scope__step--current");
    expect(org).not.toHaveAttribute("aria-current");
    expect(org).not.toHaveClass("knowledge-scope__step--current");
    expect(workflow).not.toHaveAttribute("aria-current");
  });

  it("highlights the Org step when the chip says All repos", () => {
    render(card({ focus: null }));

    const [org, repo] = steps();

    expect(org).toHaveAttribute("aria-current", "true");
    expect(org).toHaveTextContent("Org acme-robotics 2 skills (current)");
    expect(repo).toHaveTextContent("Repo All repos 3 skills + 1 fact");
    expect(repo).not.toHaveAttribute("aria-current");
  });

  it("describes each step by what its count is of", () => {
    render(card());

    expect(steps()[1]).toHaveAccessibleDescription(/3 of 4 skills of helios-firmware in force.*1 of 4 repository facts confirmed/);
  });
});

describe("each step filters the page", () => {
  it("is a real button that asks to narrow to its scope", () => {
    render(card());

    for (const step of steps()) {
      expect(step.tagName).toBe("BUTTON");
      expect(step).toHaveAttribute("type", "button");
      expect(step).toHaveAttribute("aria-pressed", "false");
    }

    fireEvent.click(steps()[0]!);
    fireEvent.click(steps()[2]!);

    expect(onNarrow.mock.calls).toEqual([["org"], ["workflow"]]);
  });

  it("shows the narrowing step as pressed, and a second press asks for every scope again", () => {
    render(card({}, "repo"));

    expect(steps().map((step) => step.getAttribute("aria-pressed"))).toEqual(["false", "true", "false"]);

    fireEvent.click(steps()[1]!);

    expect(onNarrow).toHaveBeenCalledExactlyOnceWith(null);
  });
});

describe("empty, cold and unread", () => {
  it("counts zero at every step and says what the ladder will count, for a workspace with no skills", () => {
    render(card({ skills: { ok: true, value: { skills: [], active: 0 } }, facts: { ok: true, value: seededFacts([]) } }));

    expect(steps().map((step) => step.textContent)).toEqual([
      "Org acme-robotics 0 skills",
      "Repo helios-firmware 0 skills + 0 facts (current)",
      "Workflow overrides 0",
    ]);
    expect(screen.getByText(SCOPE_COLD)).toBeInTheDocument();
  });

  it("does not call a populated ladder cold", () => {
    render(card());

    expect(screen.queryByText(SCOPE_COLD)).toBeNull();
  });

  it("says not read, with the service's reason, when the skills could not be read", () => {
    render(card({ skills: { ok: false, reason: "The registry is unreachable." } }));

    for (const step of steps()) {
      expect(step).toHaveTextContent(NOT_READ);
      expect(step).toHaveAccessibleDescription("The skills could not be read: The registry is unreachable.");
    }
    expect(screen.queryByText(SCOPE_COLD)).toBeNull();
  });
});

describe("the preview's door", () => {
  it("is in the card's head, beside the ladder, for every reader", () => {
    render(card());

    expect(within(screen.getByRole("region", { name: SCOPE_TITLE })).getByRole("button", { name: PREVIEW_ACTION })).not.toHaveAttribute("aria-disabled");
  });
});
