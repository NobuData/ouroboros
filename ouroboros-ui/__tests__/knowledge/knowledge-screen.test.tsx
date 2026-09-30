import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CREATE_SUBMIT, DESCRIPTION_LABEL, NAME_LABEL, createdToast } from "@/app/knowledge/create";
import { SKILLS_TABLE_NAME } from "@/app/knowledge/skills";
import { DISMISS_TOAST } from "@/app/knowledge/toast";
import {
  FACTS_REGION_ID,
  FACTS_SEAT_NOTE,
  FACTS_TITLE,
  IMPORT_LABEL,
  KNOWLEDGE_EYEBROW,
  KNOWLEDGE_SUBLINE,
  KNOWLEDGE_TITLE,
  NEW_SKILL_LABEL,
  SKILLS_REGION_ID,
  SKILLS_TITLE,
  readOnlyNote,
} from "@/app/knowledge/view";

import { knowledgeReadings } from "../helpers/knowledge";
import { maskIds, renderInBothPalettes } from "../helpers/palettes";

/**
 * The knowledge frame as it is drawn (#417): the head copy verbatim in both palettes, the two
 * actions for an administrator and neither for anyone else, the toast a create leaves under the
 * head, and the two seats the toast's anchors name — the skills table in one (#418), the
 * labelled seat for the facts card in the other.
 */

const createSkill = vi.fn();

vi.mock("@/app/knowledge/create-actions", () => ({ createSkill: (body: unknown) => createSkill(body) }));
vi.mock("@/app/knowledge/import-actions", () => ({ previewImport: vi.fn(), applyImport: vi.fn() }));
vi.mock("@/app/knowledge/skills-actions", () => ({ setSkillEnabled: vi.fn(), regenerateRepoMap: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

const { KnowledgeScreen } = await import("@/app/knowledge/knowledge-screen");

/** The seed workspace. */
const WORKSPACE_ID = "5eed0001-0000-4000-8000-000000000001";

/**
 * Render the screen.
 *
 * @param mayAdminister Whether the reader is an owner or an admin.
 */
function draw(mayAdminister = true) {
  return render(
    <KnowledgeScreen
      mayAdminister={mayAdminister}
      readings={knowledgeReadings()}
      role={mayAdminister ? "owner" : "member"}
      workspaceId={WORKSPACE_ID}
    />,
  );
}

describe("the head", () => {
  it("is mockup 14's eyebrow, heading and subline, verbatim", () => {
    draw();

    expect(screen.getByText(KNOWLEDGE_EYEBROW)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(KNOWLEDGE_TITLE);
    expect(screen.getByText(KNOWLEDGE_SUBLINE)).toBeInTheDocument();
  });

  it("renders the same markup in both palettes — the sheet is what differs", () => {
    const [light, dark] = renderInBothPalettes(
      <KnowledgeScreen mayAdminister readings={knowledgeReadings()} role="owner" workspaceId={WORKSPACE_ID} />,
    );

    expect(maskIds(light!)).toBe(maskIds(dark!));
    expect(light).toContain(KNOWLEDGE_TITLE);
  });

  it("draws the import as the ghost action and New skill as the primary, for an administrator", () => {
    draw();

    expect(screen.getByRole("button", { name: IMPORT_LABEL })).toHaveClass("ou-btn--ghost");
    expect(screen.getByRole("button", { name: NEW_SKILL_LABEL })).toHaveClass("ou-btn--primary");
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("draws neither action for a member, and says why", () => {
    draw(false);

    expect(screen.queryByRole("button", { name: IMPORT_LABEL })).toBeNull();
    expect(screen.queryByRole("button", { name: NEW_SKILL_LABEL })).toBeNull();
    expect(screen.getByRole("note")).toHaveTextContent(readOnlyNote("member").head);
  });

  it("adds no chrome of its own — it starts at its head", () => {
    const { container } = draw();

    // A card's own `<header>` is a card head, not chrome; the shell's landmarks are what must not be here.
    expect(container.querySelector("nav, aside, [data-shell-pane]")).toBeNull();
    expect(container.firstElementChild?.tagName).toBe("MAIN");
  });
});

describe("the toast", () => {
  it("has its seat under the head before there is anything to say", () => {
    draw();

    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("names a created draft, stays until dismissed, and goes on dismissal", async () => {
    createSkill.mockResolvedValue({ ok: true, slug: "thermal-budget-checks", name: "Thermal budget checks" });

    draw();
    fireEvent.click(screen.getByRole("button", { name: NEW_SKILL_LABEL }));
    fireEvent.change(screen.getByLabelText(NAME_LABEL), { target: { value: "Thermal budget checks" } });
    fireEvent.change(screen.getByLabelText(DESCRIPTION_LABEL), { target: { value: "Idle current" } });
    fireEvent.click(screen.getByRole("button", { name: CREATE_SUBMIT }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(createdToast("thermal-budget-checks").text);
    });

    fireEvent.click(screen.getByRole("button", { name: DISMISS_TOAST }));

    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});

describe("the regions", () => {
  it("mounts the skills table under the toast's draft-skills anchor, and labels the facts seat", () => {
    const { container } = draw();

    const skills = container.querySelector(`#${SKILLS_REGION_ID}`);
    const facts = container.querySelector(`#${FACTS_REGION_ID}`);

    expect(skills).toHaveTextContent(SKILLS_TITLE);
    expect(skills).toContainElement(screen.getByRole("table", { name: SKILLS_TABLE_NAME }));
    expect(skills).toHaveTextContent("power-budget-checks");
    expect(facts).toHaveTextContent(FACTS_TITLE);
    expect(facts).toHaveTextContent(FACTS_SEAT_NOTE);
    expect(screen.getAllByRole("region")).toHaveLength(2);
  });

  it("hands the reader's role to the table, so a member's switches are read-only", () => {
    draw(false);

    for (const toggle of screen.getAllByRole("switch")) expect(toggle).toHaveAttribute("aria-disabled", "true");
  });
});
