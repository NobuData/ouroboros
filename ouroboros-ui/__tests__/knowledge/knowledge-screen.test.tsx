import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Reading } from "@/app/api/reading";
import type { SkillList } from "@/app/api/skills";

import { KNOWLEDGE_ENV_PATH } from "@/app/paths";
import { CREATE_SUBMIT, DESCRIPTION_LABEL, NAME_LABEL, createdToast } from "@/app/knowledge/create";
import { FACTS_FOOT } from "@/app/knowledge/facts";
import { PREVIEW_ACTION, PREVIEW_TITLE } from "@/app/knowledge/preview";
import { LADDER_NAME, NO_SKILLS_AT_SCOPE, NO_WORKFLOW_FACTS, SCOPE_CAPTION, SHOW_EVERY_SCOPE } from "@/app/knowledge/scope";
import { SKILLS_TABLE_NAME } from "@/app/knowledge/skills";
import { DISMISS_TOAST } from "@/app/knowledge/toast";
import { NEW_PLAYBOOK, RUN_ON_ISSUE } from "@/app/knowledge/playbooks";
import { ENV_EDIT, SNAPSHOT_HONEST } from "@/app/knowledge/profile";
import {
  FACTS_REGION_ID,
  FACTS_TITLE,
  IMPORT_LABEL,
  KNOWLEDGE_EYEBROW,
  KNOWLEDGE_SUBLINE,
  KNOWLEDGE_TITLE,
  NEW_SKILL_LABEL,
  PLAYBOOKS_REGION_ID,
  PLAYBOOKS_TITLE,
  PROFILE_REGION_ID,
  SCOPE_REGION_ID,
  SCOPE_TITLE,
  SKILLS_REGION_ID,
  SKILLS_TITLE,
  readOnlyNote,
} from "@/app/knowledge/view";
import { resetFocusRepos, setFocusRepo } from "@/app/shell/focus-repo";

import { SEEDED_REPO, enabledRepo, knowledgeReadings, manifest, seededRepos, seededSkill, seededSkills } from "../helpers/knowledge";
import { maskIds, renderInBothPalettes } from "../helpers/palettes";

/**
 * The knowledge frame as it is drawn (#417): the head copy verbatim in both palettes, the two
 * actions for an administrator and neither for anyone else, the toast a create leaves under the
 * head, the two cards under the anchors the toast names — the skills table (#418) and the
 * learned-facts card (#419) — and the right column's playbooks card and repo profile (#420) over
 * the scope card (#421), whose ladder follows the tenant chip and the page's reads and whose steps
 * narrow the two left-column cards.
 */

const createSkill = vi.fn();
const setSkillEnabled = vi.fn();
const previewContext = vi.fn();
const refresh = vi.fn();

vi.mock("@/app/knowledge/create-actions", () => ({ createSkill: (body: unknown) => createSkill(body) }));
vi.mock("@/app/knowledge/import-actions", () => ({ previewImport: vi.fn(), applyImport: vi.fn() }));
vi.mock("@/app/knowledge/skills-actions", () => ({
  setSkillEnabled: (slug: string, enabled: boolean) => setSkillEnabled(slug, enabled),
  regenerateRepoMap: vi.fn(),
}));
vi.mock("@/app/knowledge/facts-actions", () => ({ decideFact: vi.fn(), proposeFact: vi.fn() }));
vi.mock("@/app/knowledge/playbooks-actions", () => ({
  listPlaybookIssues: vi.fn(),
  launchPlaybook: vi.fn(),
  listRecentRuns: vi.fn(),
  draftPlaybook: vi.fn(),
  createPlaybookFromRun: vi.fn(),
}));
vi.mock("@/app/knowledge/profile-actions", () => ({ saveEnvRecipe: vi.fn() }));
vi.mock("@/app/knowledge/preview-actions", () => ({
  previewContext: (consumer: string, repo: string | null, workflow: string | null) => previewContext(consumer, repo, workflow),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
}));

const { KnowledgeScreen } = await import("@/app/knowledge/knowledge-screen");

/** The seed workspace. */
const WORKSPACE_ID = "5eed0001-0000-4000-8000-000000000001";
const WORKSPACE_SLUG = "acme-robotics";

/**
 * The screen, over readings.
 *
 * @param mayAdminister Whether the reader is an owner or an admin.
 * @param readings What the page read.
 * @returns The element.
 */
function screenOver(mayAdminister = true, readings = knowledgeReadings()) {
  return (
    <KnowledgeScreen
      mayAdminister={mayAdminister}
      mayDecide
      readings={readings}
      role={mayAdminister ? "owner" : "member"}
      workspaceId={WORKSPACE_ID}
      workspaceSlug={WORKSPACE_SLUG}
    />
  );
}

/**
 * Render the screen.
 *
 * @param mayAdminister Whether the reader is an owner or an admin.
 */
function draw(mayAdminister = true) {
  return render(screenOver(mayAdminister));
}

/** Put the tenant chip on the seeded repository, as a reader who chose it would have. */
function focusHelios(): void {
  setFocusRepo(WORKSPACE_ID, { id: enabledRepo().id, name: enabledRepo().name });
}

/** The ladder's three steps, in order. */
function steps(): HTMLElement[] {
  return within(screen.getByRole("list", { name: LADDER_NAME })).getAllByRole("button");
}

/** The slugs the skills table is drawing. */
function drawnSlugs(): string[] {
  return screen.getAllByRole("button", { name: /^Open .+ in the editor$/ }).map((door) => door.textContent ?? "");
}

beforeEach(() => {
  setSkillEnabled.mockReset();
  previewContext.mockReset().mockResolvedValue({ ok: true, value: manifest("seeded") });
  refresh.mockReset();
});

// The chip's choice is this browser's: each case starts and ends with none.
afterEach(() => {
  window.localStorage.clear();
  resetFocusRepos();
});

describe("the head", () => {
  it("is mockup 14's eyebrow, heading and subline, verbatim", () => {
    draw();

    expect(screen.getByText(KNOWLEDGE_EYEBROW)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(KNOWLEDGE_TITLE);
    expect(screen.getByText(KNOWLEDGE_SUBLINE)).toBeInTheDocument();
  });

  it("renders the same markup in both palettes — the sheet is what differs", () => {
    const [light, dark] = renderInBothPalettes(screenOver());

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
  it("mounts the skills table and the facts card under the anchors the toast names", () => {
    const { container } = draw();

    const skills = container.querySelector(`#${SKILLS_REGION_ID}`);
    const facts = container.querySelector(`#${FACTS_REGION_ID}`);

    expect(skills).toHaveTextContent(SKILLS_TITLE);
    expect(skills).toContainElement(screen.getByRole("table", { name: SKILLS_TABLE_NAME }));
    expect(skills).toHaveTextContent("power-budget-checks");
    expect(facts).toHaveTextContent(FACTS_TITLE);
    expect(facts).toHaveTextContent("Zephyr 4.0 needs CONFIG_LEGACY_TIMER");
    expect(facts).toHaveTextContent(FACTS_FOOT);
    expect(screen.getAllByRole("region")).toHaveLength(6);
  });

  it("mounts the playbooks card and the repo profile in the right column (#420)", () => {
    const { container } = draw();

    const playbooks = container.querySelector(`#${PLAYBOOKS_REGION_ID}`);
    const profile = container.querySelector(`#${PROFILE_REGION_ID}`);

    expect(container.querySelector(".knowledge__aside")).toContainElement(playbooks as HTMLElement);
    expect(container.querySelector(".knowledge__aside")).toContainElement(profile as HTMLElement);
    expect(playbooks).toHaveTextContent(PLAYBOOKS_TITLE);
    expect(playbooks).toHaveTextContent("3 recipes");
    expect(playbooks).toHaveTextContent("run 9×");
    expect(playbooks).toHaveTextContent(NEW_PLAYBOOK);
    expect(profile).toHaveTextContent("Repo profile — helios-firmware");
    expect(profile).toHaveTextContent("west update --narrow -o=--depth=1");
    expect(profile).toHaveTextContent(SNAPSHOT_HONEST);
    expect(profile?.textContent).not.toContain("38s");
  });

  it("hands the reader's roles to the right column — a member launches but neither creates nor edits the recipe", () => {
    draw(false);

    for (const button of screen.getAllByRole("button", { name: /^Run on issue:/ })) expect(button).not.toHaveAttribute("aria-disabled");
    expect(screen.getByRole("button", { name: NEW_PLAYBOOK })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: ENV_EDIT })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getAllByRole("button", { name: /^Run on issue:/ })).toHaveLength(3);
    expect(screen.getAllByText(RUN_ON_ISSUE)).toHaveLength(3);
  });

  it("hands the reader's role to the table, so a member's switches are read-only", () => {
    draw(false);

    for (const toggle of screen.getAllByRole("switch")) expect(toggle).toHaveAttribute("aria-disabled", "true");
  });
});

describe("a fragment in the address (#491)", () => {
  /** What a landing calls on its target — jsdom has no `scrollIntoView` of its own. */
  const scrollIntoView = vi.fn();

  beforeEach(() => {
    scrollIntoView.mockClear();
    Element.prototype.scrollIntoView = scrollIntoView;
  });

  afterEach(() => {
    // @ts-expect-error jsdom defines none; the stub is taken back off so no other case sees it.
    delete Element.prototype.scrollIntoView;
    window.history.replaceState(null, "", "/");
  });

  it("is landed on once the screen has mounted — the settings nav's Knowledge / env tab", () => {
    // The route streams behind a loading state, so on a client-side navigation the router
    // looked for `#repo-profile` in the skeleton and found nothing.
    window.history.replaceState(null, "", KNOWLEDGE_ENV_PATH);

    const { container } = draw();

    expect(KNOWLEDGE_ENV_PATH).toBe(`/knowledge#${PROFILE_REGION_ID}`);
    expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: "start" });
    expect(scrollIntoView.mock.contexts[0]).toBe(container.querySelector(`#${PROFILE_REGION_ID}`));
  });

  it("is not looked for on a visit with none", () => {
    window.history.replaceState(null, "", "/knowledge");

    draw();

    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});

describe("the scope card (#421)", () => {
  it("mounts the ladder in the right column, under its anchor, after the repo profile", () => {
    const { container } = draw();

    const scope = container.querySelector(`#${SCOPE_REGION_ID}`);
    const aside = container.querySelector(".knowledge__aside");

    expect(aside).toContainElement(scope as HTMLElement);
    expect(aside?.lastElementChild).toBe(scope);
    expect(scope).toContainElement(screen.getByRole("region", { name: SCOPE_TITLE }));
    expect(scope).toHaveTextContent(SCOPE_CAPTION);
  });

  it("names the Org step for the workspace and makes it current while the chip says All repos", () => {
    draw();

    expect(steps().map((step) => step.textContent)).toEqual([
      "Org acme-robotics 2 skills (current)",
      "Repo All repos 3 skills + 1 fact",
      "Workflow overrides 0",
    ]);
  });

  it("highlights the Repo step, named for the repository the tenant chip is on", () => {
    focusHelios();
    draw();

    expect(steps()[1]).toHaveTextContent("Repo helios-firmware 3 skills + 1 fact (current)");
    expect(steps()[1]).toHaveAttribute("aria-current", "true");
    expect(steps()[0]).not.toHaveAttribute("aria-current");
  });

  it("follows the chip when it moves, without a reload", () => {
    draw();

    act(() => {
      setFocusRepo(WORKSPACE_ID, { id: seededRepos()[1]!.id, name: "helios-tools" });
    });

    expect(steps()[1]).toHaveTextContent("Repo helios-tools 0 skills + 0 facts (current)");
  });

  it("moves a count when a skill is switched off: the write re-reads the page, and the ladder takes the new read", async () => {
    focusHelios();
    const zephyr = seededSkill("zephyr-conventions");
    setSkillEnabled.mockResolvedValue({ ok: true, value: { ...zephyr, enabled: false, active: false } });

    const { rerender } = draw();

    expect(steps()[1]).toHaveTextContent("3 skills + 1 fact");

    fireEvent.click(screen.getByRole("switch", { name: /zephyr-conventions/ }));

    await waitFor(() => {
      expect(setSkillEnabled).toHaveBeenCalledExactlyOnceWith("zephyr-conventions", false);
      expect(refresh).toHaveBeenCalledOnce();
    });

    // What the refresh brings: the same page, re-read — no remount, no reload.
    const list = seededSkills();
    const reread: Reading<SkillList> = {
      ok: true,
      value: {
        skills: list.skills.map((skill) => (skill.slug === "zephyr-conventions" ? { ...skill, enabled: false, active: false } : skill)),
        active: list.active - 1,
      },
    };
    rerender(screenOver(true, knowledgeReadings({ skills: reread })));

    expect(steps()[1]).toHaveTextContent("2 skills + 1 fact");
    expect(steps()[0]).toHaveTextContent("2 skills");
  });

  it("moves a skill between steps when its scope moves", () => {
    focusHelios();
    const { rerender } = draw();
    const list = seededSkills();
    const moved: Reading<SkillList> = {
      ok: true,
      value: { ...list, skills: list.skills.map((skill) => (skill.slug === "zephyr-conventions" ? { ...skill, scope: "org", repoRef: null } : skill)) },
    };

    rerender(screenOver(true, knowledgeReadings({ skills: moved })));

    expect(steps().map((step) => step.textContent)).toEqual([
      "Org acme-robotics 3 skills",
      "Repo helios-firmware 2 skills + 1 fact (current)",
      "Workflow overrides 0",
    ]);
  });

  it("narrows the skills table and the facts card to a pressed step, says so, and offers the way back", () => {
    draw();

    expect(drawnSlugs()).toHaveLength(6);
    expect(screen.queryByRole("button", { name: SHOW_EVERY_SCOPE })).toBeNull();

    fireEvent.click(steps()[0]!);

    expect(steps()[0]).toHaveAttribute("aria-pressed", "true");
    expect(drawnSlugs()).toEqual(["commit-style", "pr-etiquette"]);
    expect(document.querySelectorAll(".knowledge-facts__row")).toHaveLength(1);
    expect(screen.getByText("Showing only the Org scope — acme-robotics. Skills and facts at other scopes are hidden.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: SHOW_EVERY_SCOPE }));

    expect(steps()[0]).toHaveAttribute("aria-pressed", "false");
    expect(drawnSlugs()).toHaveLength(6);
    expect(document.querySelectorAll(".knowledge-facts__row")).toHaveLength(5);
    expect(screen.queryByRole("button", { name: SHOW_EVERY_SCOPE })).toBeNull();
  });

  it("narrows to the chip's repository under the Repo step, and a second press shows every scope", () => {
    focusHelios();
    const elsewhere = { ...seededSkill("zephyr-conventions"), id: "5eed0410-0000-4000-8000-0000000000aa", slug: "tools-style", repoRef: "acme-robotics/helios-tools" };
    const list = seededSkills();
    render(screenOver(true, knowledgeReadings({ skills: { ok: true, value: { ...list, skills: [...list.skills, elsewhere] } } })));

    fireEvent.click(steps()[1]!);

    expect(drawnSlugs()).toEqual(["hil-safety", "power-budget-checks", "repo-map", "zephyr-conventions"]);

    fireEvent.click(steps()[1]!);

    expect(drawnSlugs()).toHaveLength(7);
  });

  it("says the Workflow step holds no skill and that a fact has no workflow scope", () => {
    draw();

    fireEvent.click(steps()[2]!);

    expect(screen.getByText(NO_SKILLS_AT_SCOPE)).toBeInTheDocument();
    expect(screen.getByText(NO_WORKFLOW_FACTS)).toBeInTheDocument();
  });

  it("opens the preview on the chip's repository, for a member as for an owner", async () => {
    focusHelios();
    draw(false);

    fireEvent.click(screen.getByRole("button", { name: PREVIEW_ACTION }));

    const dialog = await screen.findByRole("dialog", { name: PREVIEW_TITLE });

    await waitFor(() => {
      expect(dialog).toHaveTextContent("hil-safety@v3");
    });
    expect(previewContext).toHaveBeenCalledExactlyOnceWith("run_stage", SEEDED_REPO, null);
  });
});
