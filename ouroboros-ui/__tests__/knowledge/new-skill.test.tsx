import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CREATE_CANCEL,
  CREATE_SLUG_TAKEN,
  CREATE_SUBMIT,
  CREATE_TITLE,
  DESCRIPTION_LABEL,
  NAME_LABEL,
  NEEDS_DESCRIPTION,
  NEEDS_NAME,
  NEEDS_SLUG,
  REPO_LABEL,
  REPO_NONE_HINT,
  SCOPE_LABEL,
  SLUG_LABEL,
  SLUG_TAKEN,
  createdToast,
  skillDocument,
} from "@/app/knowledge/create";
import type { CreateSkillOutcome } from "@/app/knowledge/create-actions";
import type { KnowledgeToast } from "@/app/knowledge/toast";
import { NEW_SKILL_LABEL } from "@/app/knowledge/view";

import { knowledgeReadings, seededRepos } from "../helpers/knowledge";

/**
 * **+ New skill** and its dialog as they are drawn (#417): the head action opens the dialog, the
 * slug follows the name, a collision is refused under the box before anything is sent, one `POST`
 * creates the draft, and the toast handed up names it.
 *
 * The Server Action is mocked, not the API: `create-actions.test.ts` is that module's suite and
 * `create.test.ts` proves the judgements; this proves what reaches the DOM and what leaves it.
 */

/** What the action answers, per case. */
const createSkill = vi.fn<(body: unknown) => Promise<CreateSkillOutcome>>();

/** What re-reads the page after a create. */
const refresh = vi.fn();

/** What the screen is handed. */
const onCreated = vi.fn<(toast: KnowledgeToast) => void>();

vi.mock("@/app/knowledge/create-actions", () => ({
  createSkill: (body: unknown) => createSkill(body),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

const { NewSkill } = await import("@/app/knowledge/new-skill");

beforeEach(() => {
  createSkill.mockReset().mockResolvedValue({ ok: true, slug: "thermal-budget-checks", name: "Thermal budget checks" });
  refresh.mockReset();
  onCreated.mockReset();
});

/**
 * Render the action and open its dialog.
 *
 * @param readings What the page read. Defaults to the seed.
 */
function open(readings = knowledgeReadings()): void {
  render(<NewSkill onCreated={onCreated} repos={readings.repos} skills={readings.skills} />);

  fireEvent.click(screen.getByRole("button", { name: NEW_SKILL_LABEL }));
}

/**
 * Type into one box.
 *
 * @param label The box's label.
 * @param value What to type.
 */
function type(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

/** The dialog's primary control. */
function submit(): HTMLElement {
  return screen.getByRole("button", { name: CREATE_SUBMIT });
}

describe("the head action", () => {
  it("is the page's primary action and opens the dialog", () => {
    open();

    expect(screen.getByRole("button", { name: NEW_SKILL_LABEL })).toHaveClass("ou-btn--primary");
    expect(screen.getByRole("dialog")).toHaveAccessibleName(CREATE_TITLE);
  });

  it("opens on a clean form every time", () => {
    open();
    type(NAME_LABEL, "Half typed");
    fireEvent.click(screen.getByRole("button", { name: CREATE_CANCEL }));
    fireEvent.click(screen.getByRole("button", { name: NEW_SKILL_LABEL }));

    expect(screen.getByLabelText(NAME_LABEL)).toHaveValue("");
  });
});

describe("the form", () => {
  it("asks for the name, the slug, the description and the scope", () => {
    open();

    for (const label of [NAME_LABEL, SLUG_LABEL, DESCRIPTION_LABEL, SCOPE_LABEL]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.queryByLabelText(REPO_LABEL)).toBeNull();
  });

  it("fills the slug from the name until the reader edits it", () => {
    open();
    type(NAME_LABEL, "Power budget checks");

    expect(screen.getByLabelText(SLUG_LABEL)).toHaveValue("power-budget-checks");

    type(SLUG_LABEL, "power-checks");
    type(NAME_LABEL, "Power budget checks, revised");

    expect(screen.getByLabelText(SLUG_LABEL)).toHaveValue("power-checks");
  });

  it("refuses a slug the workspace already has, under the box, before anything is sent", () => {
    open();
    type(NAME_LABEL, "Zephyr conventions");
    type(DESCRIPTION_LABEL, "Again");

    expect(screen.getByText(SLUG_TAKEN)).toBeInTheDocument();
    expect(submit()).toHaveAttribute("title", NEEDS_SLUG);

    fireEvent.click(submit());

    expect(createSkill).not.toHaveBeenCalled();
  });

  it("holds the submit until the name, the slug and the description are given", () => {
    open();

    expect(submit()).toHaveAttribute("title", NEEDS_NAME);

    type(NAME_LABEL, "Thermal budget checks");
    expect(submit()).toHaveAttribute("title", NEEDS_DESCRIPTION);

    type(DESCRIPTION_LABEL, "Flag changes that raise idle current");
    expect(submit()).not.toHaveAttribute("aria-disabled");
  });

  it("offers the repo scope, with a repository select, when there is a repository to name", () => {
    open();
    type(SCOPE_LABEL, "repo");

    const repo = screen.getByLabelText(REPO_LABEL);

    expect(repo).toHaveValue("acme-robotics/helios-firmware");
    expect(repo.querySelectorAll("option")).toHaveLength(seededRepos().length);
  });

  it("offers only the org scope, and says why, when no repository is enabled", () => {
    open(knowledgeReadings({ repos: { ok: true, value: [] } }));

    expect(screen.getByLabelText(SCOPE_LABEL).querySelectorAll("option")).toHaveLength(1);
    expect(screen.getByText(REPO_NONE_HINT)).toBeInTheDocument();
  });
});

describe("creating", () => {
  it("makes one request with the document, the slug and the scope, hands up the toast, and re-reads", async () => {
    open();
    type(NAME_LABEL, "Thermal budget checks");
    type(DESCRIPTION_LABEL, "Flag changes that raise idle current above 120 µA");

    fireEvent.click(submit());

    await waitFor(() => { expect(screen.queryByRole("dialog")).toBeNull(); });

    expect(createSkill).toHaveBeenCalledExactlyOnceWith({
      text: skillDocument({
        name: "Thermal budget checks",
        slug: "thermal-budget-checks",
        slugEdited: false,
        description: "Flag changes that raise idle current above 120 µA",
        scope: "org",
        repoRef: "acme-robotics/helios-firmware",
      }),
      slug: "thermal-budget-checks",
      scope: "org",
    });
    expect(onCreated).toHaveBeenCalledExactlyOnceWith(createdToast("thermal-budget-checks"));
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("sends the repository for a repo scope", async () => {
    open();
    type(NAME_LABEL, "Thermal budget checks");
    type(DESCRIPTION_LABEL, "Flag changes");
    type(SCOPE_LABEL, "repo");
    type(REPO_LABEL, "acme-robotics/helios-tools");

    fireEvent.click(submit());

    await waitFor(() => { expect(createSkill).toHaveBeenCalledOnce(); });

    expect(createSkill.mock.calls[0]![0]).toMatchObject({ scope: "repo", repoRef: "acme-robotics/helios-tools" });
  });

  it("lands the service's slug collision on the slug box, keeps the dialog open, and creates nothing", async () => {
    createSkill.mockResolvedValue({
      ok: false,
      refusal: { code: "skill_slug_taken", message: "Taken.", details: {} },
    });

    open();
    type(NAME_LABEL, "Brand new");
    type(DESCRIPTION_LABEL, "Fresh");

    fireEvent.click(submit());

    // Two alerts: the form's sentence, and the slug box's own error — both say the same thing.
    await waitFor(() => { expect(screen.getByText(CREATE_SLUG_TAKEN)).toBeInTheDocument(); });

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText(SLUG_LABEL)).toHaveAccessibleDescription(expect.stringContaining(SLUG_TAKEN));
    expect(onCreated).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});
