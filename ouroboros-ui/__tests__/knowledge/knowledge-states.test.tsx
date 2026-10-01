import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Role } from "@/app/api/membership";
import { NAME_LABEL } from "@/app/knowledge/create";
import { ADD_FACT_LABEL, FACTS_FOOT, FACTS_UNREAD_TITLE, NO_FACTS_NOTE, NO_FACTS_TITLE, VIEWER_REASON } from "@/app/knowledge/facts";
import {
  CREATE_ADMIN_REASON,
  LAUNCH_VIEWER_REASON,
  NEW_PLAYBOOK,
  NO_PLAYBOOKS_NOTE,
  NO_PLAYBOOKS_TITLE,
  PLAYBOOKS_UNREAD_TITLE,
} from "@/app/knowledge/playbooks";
import { PREVIEW_ACTION } from "@/app/knowledge/preview";
import {
  ENV_ADD,
  ENV_ADMIN_REASON,
  ENV_EDIT,
  NOT_SCANNED_TITLE,
  NO_RECIPE_NOTE,
  NO_RECIPE_TITLE,
  NO_REPOS_TITLE,
  PROFILE_UNREAD_TITLE,
  RECIPE_UNREAD_TITLE,
  REPOS_UNREAD_TITLE,
  SNAPSHOT_HONEST,
} from "@/app/knowledge/profile";
import { SCOPE_COLD } from "@/app/knowledge/scope";
import {
  MEMBER_REGENERATE_REASON,
  MEMBER_SWITCH_REASON,
  NOT_COUNTED_LABEL,
  NO_SKILLS_TITLE,
  SKILLS_TABLE_NAME,
  SKILLS_UNREAD_TITLE,
} from "@/app/knowledge/skills";
import {
  MAPS_UNREAD,
  MAP_FAILED,
  MAP_PENDING,
  MAP_PENDING_ADMIN_NOTE,
  MAP_PENDING_READER_NOTE,
  NO_SKILLS_ACTIONS,
  NO_SKILLS_ADMIN_NOTE,
  NO_SKILLS_READER_NOTE,
  REPO_MAPS_NAME,
  TRY_AGAIN,
  generateName,
} from "@/app/knowledge/states";
import {
  FACTS_TITLE,
  IMPORT_LABEL,
  type KnowledgeReadings,
  NEW_SKILL_LABEL,
  PLAYBOOKS_TITLE,
  SCOPE_TITLE,
  SKILLS_TITLE,
  readOnlyNote,
} from "@/app/knowledge/view";
import { resetFocusRepos } from "@/app/shell/focus-repo";

import {
  CONSOLE_REPO,
  TELEMETRY_REPO,
  coldReadings,
  failedMap,
  knowledgeReadings,
  pendingMap,
  repoMapReport,
  repoMapStatus,
  repoMapStatuses,
  seededProfile,
} from "../helpers/knowledge";
import { maskIds, renderInBothPalettes } from "../helpers/palettes";

/**
 * The states mockup 14 cannot show, as the page draws them (#422): what a new org sees in each of
 * the five cards and what it is offered there; a `repo-map` pending its first generation told
 * apart from one that failed; every card for a member and for a viewer; and one failing read
 * degrading its own card and no other.
 */

const createSkill = vi.fn();
const setSkillEnabled = vi.fn();
const regenerateRepoMap = vi.fn();
const decideFact = vi.fn();
const proposeFact = vi.fn();
const launchPlaybook = vi.fn();
const saveEnvRecipe = vi.fn();
const refresh = vi.fn();

vi.mock("@/app/knowledge/create-actions", () => ({ createSkill: (body: unknown) => createSkill(body) }));
vi.mock("@/app/knowledge/import-actions", () => ({ previewImport: vi.fn(), applyImport: vi.fn() }));
vi.mock("@/app/knowledge/skills-actions", () => ({
  setSkillEnabled: (slug: string, enabled: boolean) => setSkillEnabled(slug, enabled),
  regenerateRepoMap: (body: unknown) => regenerateRepoMap(body),
}));
vi.mock("@/app/knowledge/facts-actions", () => ({
  decideFact: (id: string, verb: string) => decideFact(id, verb),
  proposeFact: (body: unknown) => proposeFact(body),
}));
vi.mock("@/app/knowledge/playbooks-actions", () => ({
  listPlaybookIssues: vi.fn(),
  launchPlaybook: (id: string, issueId: string) => launchPlaybook(id, issueId),
  listRecentRuns: vi.fn(),
  draftPlaybook: vi.fn(),
  createPlaybookFromRun: vi.fn(),
}));
vi.mock("@/app/knowledge/profile-actions", () => ({ saveEnvRecipe: (body: unknown) => saveEnvRecipe(body) }));
vi.mock("@/app/knowledge/preview-actions", () => ({ previewContext: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
}));

const { KnowledgeScreen } = await import("@/app/knowledge/knowledge-screen");

/** The seed workspace. */
const WORKSPACE_ID = "5eed0001-0000-4000-8000-000000000001";

/** Who is reading, as the route decides it from the role. */
const READERS: Record<"owner" | "member" | "viewer", { role: Role; mayAdminister: boolean; mayDecide: boolean }> = {
  owner: { role: "owner", mayAdminister: true, mayDecide: true },
  member: { role: "member", mayAdminister: false, mayDecide: true },
  viewer: { role: "viewer", mayAdminister: false, mayDecide: false },
};

/**
 * The screen, over readings, for one reader.
 *
 * @param readings What the page read.
 * @param reader Who is reading.
 * @returns The element.
 */
function screenOver(readings: KnowledgeReadings, reader: keyof typeof READERS = "owner") {
  return (
    <KnowledgeScreen
      mayAdminister={READERS[reader].mayAdminister}
      mayDecide={READERS[reader].mayDecide}
      readings={readings}
      role={READERS[reader].role}
      workspaceId={WORKSPACE_ID}
      workspaceSlug="acme-robotics"
    />
  );
}

/**
 * A card, by its title.
 *
 * @param title The card's title, or a pattern for the profile's, which names its repository.
 * @returns The region.
 */
function card(title: string | RegExp): HTMLElement {
  return screen.getByRole("region", { name: title });
}

/** The repo profile's card — its title names the repository it draws. */
const PROFILE = /^Repo profile/;

/** The rows of the maps list, when it is drawn. */
function mapRows(): HTMLElement[] {
  return within(screen.getByRole("list", { name: REPO_MAPS_NAME })).getAllByRole("listitem");
}

beforeEach(() => {
  for (const mock of [createSkill, setSkillEnabled, regenerateRepoMap, decideFact, proposeFact, launchPlaybook, saveEnvRecipe, refresh]) {
    mock.mockReset();
  }
});

// The tenant chip's choice is this browser's: each case starts and ends with none.
afterEach(() => {
  window.localStorage.clear();
  resetFocusRepos();
});

describe("a new org's page, for an owner", () => {
  it("renders the same markup in both palettes — every state is the sheet's to theme", () => {
    const [light, dark] = renderInBothPalettes(screenOver(coldReadings()));

    expect(maskIds(light!)).toBe(maskIds(dark!));
    expect(light).toContain(NO_SKILLS_TITLE);
    expect(light).toContain(MAP_PENDING);
  });

  it("explains what a skill is and holds the head's two actions where the reader is looking", () => {
    render(screenOver(coldReadings()));

    const skills = card(SKILLS_TITLE);

    expect(within(skills).getByText(NO_SKILLS_TITLE)).toBeInTheDocument();
    expect(within(skills).getByText(NO_SKILLS_ADMIN_NOTE)).toBeInTheDocument();
    expect(within(skills).queryByRole("table", { name: SKILLS_TABLE_NAME })).toBeNull();

    const actions = within(skills).getByRole("group", { name: NO_SKILLS_ACTIONS });

    expect(within(actions).getByRole("button", { name: NEW_SKILL_LABEL })).not.toHaveAttribute("aria-disabled");
    expect(within(actions).getByRole("button", { name: IMPORT_LABEL })).not.toHaveAttribute("aria-disabled");
    // The head keeps its own pair: the state repeats them, it does not move them.
    expect(screen.getAllByRole("button", { name: NEW_SKILL_LABEL })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: IMPORT_LABEL })).toHaveLength(2);
  });

  it("opens the create dialog from the empty table's own action", () => {
    render(screenOver(coldReadings()));

    fireEvent.click(within(card(SKILLS_TITLE)).getByRole("button", { name: NEW_SKILL_LABEL }));

    expect(screen.getByLabelText(NAME_LABEL)).toBeInTheDocument();
  });

  it("says the loop proposes facts as it works, and holds the manual add in the state — once, and not as a second primary", () => {
    render(screenOver(coldReadings()));

    const facts = card(FACTS_TITLE);

    expect(within(facts).getByText(NO_FACTS_TITLE)).toBeInTheDocument();
    expect(within(facts).getByText(NO_FACTS_NOTE)).toBeInTheDocument();
    expect(NO_FACTS_NOTE).toMatch(/^The loop proposes facts as it works/);

    // One add, in the state — not a second copy in the head above it.
    const add = within(facts).getByRole("button", { name: ADD_FACT_LABEL });

    expect(add).not.toHaveClass("ou-btn--primary");
    expect(add).not.toHaveClass("ou-btn--ghost");
    expect(add.closest(".ou-empty")).not.toBeNull();
    expect(add).not.toHaveAttribute("aria-disabled");
    expect(within(facts).getByText(FACTS_FOOT)).toBeInTheDocument();
  });

  it("makes creating from a past run the playbooks card's primary action", () => {
    render(screenOver(coldReadings()));

    const playbooks = card(PLAYBOOKS_TITLE);

    expect(within(playbooks).getByText(NO_PLAYBOOKS_TITLE)).toBeInTheDocument();
    expect(within(playbooks).getByText(NO_PLAYBOOKS_NOTE)).toBeInTheDocument();
    expect(within(playbooks).getByText("0 recipes")).toBeInTheDocument();

    const create = within(playbooks).getByRole("button", { name: NEW_PLAYBOOK });

    expect(create.closest(".ou-empty")).not.toBeNull();
    expect(create).not.toHaveAttribute("aria-disabled");
  });

  it("offers to add an environment recipe where it says there is none, and claims no snapshot figure", () => {
    render(screenOver(coldReadings()));

    const profile = card(PROFILE);

    expect(within(profile).getByText(NOT_SCANNED_TITLE)).toBeInTheDocument();
    expect(within(profile).getByText(NO_RECIPE_TITLE)).toBeInTheDocument();
    expect(within(profile).getByText(NO_RECIPE_NOTE)).toBeInTheDocument();

    const add = within(profile).getByRole("button", { name: ENV_ADD });

    expect(add).not.toHaveClass("ou-btn--primary");
    expect(add.closest(".ou-empty")).not.toBeNull();
    expect(within(profile).queryByRole("button", { name: ENV_EDIT })).toBeNull();
    expect(within(profile).getByText(new RegExp(SNAPSHOT_HONEST.slice(0, 24)))).toBeInTheDocument();
    expect(profile).not.toHaveTextContent(/\d+s \(vs/);
  });

  it("opens the recipe editor from the empty state's add", () => {
    render(screenOver(coldReadings()));

    fireEvent.click(within(card(PROFILE)).getByRole("button", { name: ENV_ADD }));

    expect(within(card(PROFILE)).getByRole("textbox")).toBeInTheDocument();
    expect(within(card(PROFILE)).queryByText(NO_RECIPE_TITLE)).toBeNull();
  });

  it("opens on one accent-filled action per card at most — the head's, the table's copy of it, and the playbooks tile", () => {
    render(screenOver(coldReadings()));

    const primaries = [...document.querySelectorAll(".ou-btn--primary")].map((button) => button.textContent);

    expect(primaries).toEqual([NEW_SKILL_LABEL, NEW_SKILL_LABEL, NEW_PLAYBOOK]);
  });

  it("says the ladder counts up as skills arrive, rather than three zeroes with no explanation", () => {
    render(screenOver(coldReadings()));

    expect(within(card(SCOPE_TITLE)).getByText(SCOPE_COLD)).toBeInTheDocument();
    expect(within(card(SCOPE_TITLE)).getByRole("button", { name: PREVIEW_ACTION })).not.toHaveAttribute("aria-disabled");
  });

  it("says each repository's repo-map is pending its first generation — not broken — and offers to generate it", () => {
    render(screenOver(coldReadings()));

    const rows = mapRows();

    expect(rows).toHaveLength(2);

    for (const row of rows) {
      expect(within(row).getByText(MAP_PENDING)).toBeInTheDocument();
      expect(row).not.toHaveClass("knowledge-maps__row--failed");
    }

    // What pending means, once — not a sentence repeated in every row.
    expect(within(card(SKILLS_TITLE)).getAllByText(MAP_PENDING_ADMIN_NOTE)).toHaveLength(1);

    expect(within(rows[0]!).getByRole("button", { name: generateName("acme-robotics/helios-firmware") })).not.toHaveAttribute(
      "aria-disabled",
    );
  });
});

describe("a repo-map pending its first generation, and one that failed", () => {
  /** A page whose two other repositories have no map: one never attempted, one refused. */
  function draw(reader: keyof typeof READERS = "owner") {
    return render(
      screenOver(
        knowledgeReadings({ maps: { ok: true, value: repoMapStatuses([repoMapStatus(), pendingMap(), failedMap()]) } }),
        reader,
      ),
    );
  }

  it("draws nothing for the seeded page's one generated map — its row is in the table", () => {
    render(screenOver(knowledgeReadings()));

    expect(screen.queryByRole("list", { name: REPO_MAPS_NAME })).toBeNull();
    expect(screen.queryByText(MAP_PENDING)).toBeNull();
  });

  it("is visually distinct: a neutral ring in a dashed well against the error hue in a solid one", () => {
    draw();

    const [pending, failed] = mapRows();

    expect(pending).toHaveTextContent(CONSOLE_REPO);
    expect(within(pending!).getByText(MAP_PENDING).closest(".ou-chip")).not.toHaveClass("ou-chip--err");
    expect(within(pending!).getByText(MAP_PENDING).closest(".ou-chip")?.querySelector(".ou-chip__dot--ring")).not.toBeNull();
    expect(pending).not.toHaveClass("knowledge-maps__row--failed");

    expect(failed).toHaveTextContent(TELEMETRY_REPO);
    expect(within(failed!).getByText(MAP_FAILED).closest(".ou-chip")).toHaveClass("ou-chip--err");
    expect(within(failed!).getByText(MAP_FAILED).closest(".ou-chip")?.querySelector(".ou-chip__dot--ring")).toBeNull();
    expect(failed).toHaveClass("knowledge-maps__row--failed");
    expect(failed).toHaveTextContent("The host refused the read on the nightly run, 5h ago.");
    // The failure's sentence is the failed row's own; the pending row carries none.
    expect(pending?.querySelector(".knowledge-maps__detail")).toBeNull();
  });

  it("says nothing about pending when the only map without a row failed", () => {
    render(screenOver(knowledgeReadings({ maps: { ok: true, value: repoMapStatuses([repoMapStatus(), failedMap()]) } })));

    expect(mapRows()).toHaveLength(1);
    expect(screen.queryByText(MAP_PENDING_ADMIN_NOTE)).toBeNull();
  });

  it("sits under the table it belongs to, which still draws its six rows", () => {
    draw();

    const skills = card(SKILLS_TITLE);

    expect(within(skills).getByRole("table", { name: SKILLS_TABLE_NAME })).toBeInTheDocument();
    expect(within(skills).getByRole("list", { name: REPO_MAPS_NAME })).toBeInTheDocument();
  });

  it("generates from the row: the report becomes the page's toast, and the page re-reads", async () => {
    regenerateRepoMap.mockResolvedValue({ ok: true, value: repoMapReport({ repo: CONSOLE_REPO, version: 1 }) });
    draw();

    fireEvent.click(screen.getByRole("button", { name: generateName(CONSOLE_REPO) }));

    await waitFor(() => { expect(refresh).toHaveBeenCalledOnce(); });
    expect(regenerateRepoMap).toHaveBeenCalledExactlyOnceWith({ repo: CONSOLE_REPO });
    expect(screen.getByText(/repo-map regenerated for acme-robotics\/helios-console: v1 published/)).toBeInTheDocument();
  });

  it("shows a refusal on the row that was pressed, and on no other", async () => {
    regenerateRepoMap.mockResolvedValue({
      ok: false,
      refusal: { code: "repo_map_regenerate_too_soon", message: "Too soon.", details: { retryAfterSeconds: 41 } },
    });
    draw();

    fireEvent.click(screen.getByRole("button", { name: generateName(TELEMETRY_REPO) }));

    const alert = await screen.findByRole("alert");
    const [pending, failed] = mapRows();

    expect(alert).toHaveTextContent("Regenerated under a minute ago — try again in 41s.");
    expect(failed).toContainElement(alert);
    expect(within(pending!).queryByRole("alert")).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("is inert for a member, with the reason, and says nothing they cannot do", () => {
    draw("member");

    const [pending] = mapRows();
    const generate = within(pending!).getByRole("button", { name: generateName(CONSOLE_REPO) });

    expect(generate).toHaveAttribute("aria-disabled", "true");
    expect(generate).toHaveAttribute("title", MEMBER_REGENERATE_REASON);
    expect(within(card(SKILLS_TITLE)).getByText(MAP_PENDING_READER_NOTE)).toBeInTheDocument();

    fireEvent.click(generate);

    expect(regenerateRepoMap).not.toHaveBeenCalled();
  });

  it("claims neither state when the status could not be read, and leaves the table whole", () => {
    render(screenOver(knowledgeReadings({ maps: { ok: false, reason: "The status failed." } })));

    expect(within(card(SKILLS_TITLE)).getByRole("note")).toHaveTextContent(`${MAPS_UNREAD}: The status failed.`);
    expect(screen.queryByRole("list", { name: REPO_MAPS_NAME })).toBeNull();
    expect(within(card(SKILLS_TITLE)).getByRole("table", { name: SKILLS_TABLE_NAME })).toBeInTheDocument();
  });
});

describe("a new org's page, for a member", () => {
  it("renders the same markup in both palettes", () => {
    const [light, dark] = renderInBothPalettes(screenOver(coldReadings(), "member"));

    expect(maskIds(light!)).toBe(maskIds(dark!));
    expect(light).toContain(NO_SKILLS_TITLE);
  });

  it("explains skills and who brings them, with neither action — in the head or in the state", () => {
    render(screenOver(coldReadings(), "member"));

    const skills = card(SKILLS_TITLE);

    expect(within(skills).getByText(NO_SKILLS_READER_NOTE)).toBeInTheDocument();
    expect(within(skills).queryByRole("group", { name: NO_SKILLS_ACTIONS })).toBeNull();
    expect(screen.queryByRole("button", { name: NEW_SKILL_LABEL })).toBeNull();
    expect(screen.queryByRole("button", { name: IMPORT_LABEL })).toBeNull();
    expect(screen.getByRole("note")).toHaveTextContent(readOnlyNote("member").head);
  });

  it("may add a fact — the service admits members — and is told why the administrators' actions are not theirs", () => {
    render(screenOver(coldReadings(), "member"));

    expect(within(card(FACTS_TITLE)).getByRole("button", { name: ADD_FACT_LABEL })).not.toHaveAttribute("aria-disabled");

    const create = within(card(PLAYBOOKS_TITLE)).getByRole("button", { name: NEW_PLAYBOOK });
    const add = within(card(PROFILE)).getByRole("button", { name: ENV_ADD });

    expect(create).toHaveAttribute("aria-disabled", "true");
    expect(create).toHaveAttribute("title", CREATE_ADMIN_REASON);
    expect(add).toHaveAttribute("aria-disabled", "true");
    expect(add).toHaveAttribute("title", ENV_ADMIN_REASON);

    fireEvent.click(add);

    // The editor did not open: an inert control cannot act.
    expect(within(card(PROFILE)).queryByRole("textbox")).toBeNull();
    expect(within(card(PROFILE)).getByText(NO_RECIPE_TITLE)).toBeInTheDocument();
  });

  it("is told the maps are pending, without an offer to generate one", () => {
    render(screenOver(coldReadings(), "member"));

    for (const row of mapRows()) expect(within(row).getByRole("button")).toHaveAttribute("aria-disabled", "true");

    expect(within(card(SKILLS_TITLE)).getByText(MAP_PENDING_READER_NOTE)).toBeInTheDocument();
  });
});

describe("the seeded page, read-only", () => {
  it("draws a member every write they may not make inert with its reason, across the cards", () => {
    render(screenOver(knowledgeReadings(), "member"));

    // Skills: every switch in its real state, read-only; the regenerate inert.
    for (const toggle of within(card(SKILLS_TITLE)).getAllByRole("switch")) {
      expect(toggle).toHaveAttribute("aria-disabled", "true");
      expect(toggle).toHaveAttribute("title", MEMBER_SWITCH_REASON);
    }
    expect(within(card(SKILLS_TITLE)).getByRole("button", { name: "Regenerate repo-map now" })).toHaveAttribute(
      "title",
      MEMBER_REGENERATE_REASON,
    );

    // Playbooks: launching is a member's; creating is not.
    for (const run of within(card(PLAYBOOKS_TITLE)).getAllByRole("button", { name: /^Run on issue:/ })) {
      expect(run).not.toHaveAttribute("aria-disabled");
    }
    expect(within(card(PLAYBOOKS_TITLE)).getByRole("button", { name: NEW_PLAYBOOK })).toHaveAttribute("title", CREATE_ADMIN_REASON);

    // Profile: the recipe's edit is an administrator's.
    expect(within(card(PROFILE)).getByRole("button", { name: ENV_EDIT })).toHaveAttribute("title", ENV_ADMIN_REASON);

    // Facts: deciding is a member's. Scope: the preview writes nothing, and is everyone's.
    for (const confirm of within(card(FACTS_TITLE)).getAllByRole("button", { name: /^Confirm/ })) {
      expect(confirm).not.toHaveAttribute("aria-disabled");
    }
    expect(within(card(SCOPE_TITLE)).getByRole("button", { name: PREVIEW_ACTION })).not.toHaveAttribute("aria-disabled");
  });

  it("lets no inert press reach the service", () => {
    render(screenOver(knowledgeReadings(), "member"));

    for (const toggle of within(card(SKILLS_TITLE)).getAllByRole("switch")) fireEvent.click(toggle);
    fireEvent.click(within(card(SKILLS_TITLE)).getByRole("button", { name: "Regenerate repo-map now" }));
    fireEvent.click(within(card(PLAYBOOKS_TITLE)).getByRole("button", { name: NEW_PLAYBOOK }));
    fireEvent.click(within(card(PROFILE)).getByRole("button", { name: ENV_EDIT }));

    expect(setSkillEnabled).not.toHaveBeenCalled();
    expect(regenerateRepoMap).not.toHaveBeenCalled();
    expect(saveEnvRecipe).not.toHaveBeenCalled();
    expect(within(card(PROFILE)).queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("draws a viewer the facts' and the playbooks' actions inert as well — a viewer reads", () => {
    render(screenOver(knowledgeReadings(), "viewer"));

    const decisions = within(card(FACTS_TITLE)).getAllByRole("button", { name: /^(Confirm|Reject|Re-learn)/ });

    expect(decisions.length).toBeGreaterThan(0);
    for (const decision of decisions) expect(decision).toHaveAttribute("title", VIEWER_REASON);
    expect(within(card(FACTS_TITLE)).getByRole("button", { name: ADD_FACT_LABEL })).toHaveAttribute("title", VIEWER_REASON);

    for (const run of within(card(PLAYBOOKS_TITLE)).getAllByRole("button", { name: /^Run on issue:/ })) {
      expect(run).toHaveAttribute("title", LAUNCH_VIEWER_REASON);
    }

    for (const decision of decisions) fireEvent.click(decision);

    expect(decideFact).not.toHaveBeenCalled();
    expect(launchPlaybook).not.toHaveBeenCalled();
  });

  it("draws a viewer's empty facts card with the add in its place, inert with the reason", () => {
    render(screenOver(coldReadings(), "viewer"));

    const add = within(card(FACTS_TITLE)).getByRole("button", { name: ADD_FACT_LABEL });

    expect(add).toHaveAttribute("aria-disabled", "true");
    expect(add).toHaveAttribute("title", VIEWER_REASON);
  });
});

describe("one failing service", () => {
  const REASON = "The service failed.";
  const FAILED = { ok: false as const, reason: REASON };

  /**
   * What each card shows when it is whole — the proof that a neighbour's failure left it alone.
   *
   * @returns The five claims, by card.
   */
  function whole(): Record<"skills" | "facts" | "playbooks" | "profile" | "scope", () => void> {
    return {
      skills: () => { expect(within(card(SKILLS_TITLE)).getByRole("table", { name: SKILLS_TABLE_NAME })).toBeInTheDocument(); },
      facts: () => { expect(within(card(FACTS_TITLE)).getAllByRole("listitem")).toHaveLength(5); },
      playbooks: () => { expect(within(card(PLAYBOOKS_TITLE)).getAllByRole("button", { name: /^Run on issue:/ })).toHaveLength(3); },
      profile: () => { expect(within(card(PROFILE)).getByRole("button", { name: ENV_EDIT })).toBeInTheDocument(); },
      scope: () => { expect(within(card(SCOPE_TITLE)).getByRole("button", { name: PREVIEW_ACTION })).toBeInTheDocument(); },
    };
  }

  const CASES: readonly [string, Partial<KnowledgeReadings>, string | RegExp, string, readonly (keyof ReturnType<typeof whole>)[]][] = [
    ["the skills", { skills: FAILED }, SKILLS_TITLE, SKILLS_UNREAD_TITLE, ["facts", "playbooks", "profile", "scope"]],
    ["the facts", { facts: FAILED }, FACTS_TITLE, FACTS_UNREAD_TITLE, ["skills", "playbooks", "profile", "scope"]],
    ["the playbooks", { playbooks: FAILED }, PLAYBOOKS_TITLE, PLAYBOOKS_UNREAD_TITLE, ["skills", "facts", "profile", "scope"]],
    [
      "detection",
      { profile: seededProfile({ detection: FAILED }) },
      PROFILE,
      PROFILE_UNREAD_TITLE,
      ["skills", "facts", "playbooks", "profile", "scope"],
    ],
    [
      "the environment recipe",
      { profile: seededProfile({ recipe: FAILED }) },
      PROFILE,
      RECIPE_UNREAD_TITLE,
      ["skills", "facts", "playbooks", "scope"],
    ],
  ];

  it.each(CASES)("degrades its own card when %s cannot be read, and no other", (_what, over, title, unread, others) => {
    render(screenOver(knowledgeReadings(over)));

    const failed = card(title);

    expect(within(failed).getByText(unread)).toBeInTheDocument();
    expect(within(failed).getByText(REASON)).toBeInTheDocument();
    expect(within(failed).getByRole("button", { name: TRY_AGAIN })).toBeInTheDocument();

    const claims = whole();

    for (const other of others) claims[other]();
  });

  it("re-reads the page from a card's Try again", () => {
    render(screenOver(knowledgeReadings({ facts: FAILED })));

    fireEvent.click(within(card(FACTS_TITLE)).getByRole("button", { name: TRY_AGAIN }));

    expect(refresh).toHaveBeenCalledOnce();
  });

  it("says the repositories could not be read — not that none is enabled — and keeps the left column whole", () => {
    render(
      screenOver(
        knowledgeReadings({ repos: FAILED, profile: { repo: null, detection: FAILED, recipe: FAILED } }),
      ),
    );

    const profile = card(PROFILE);

    expect(within(profile).getByText(REPOS_UNREAD_TITLE)).toBeInTheDocument();
    expect(within(profile).getByText(REASON)).toBeInTheDocument();
    expect(within(profile).queryByText(NO_REPOS_TITLE)).toBeNull();
    expect(within(profile).getByRole("button", { name: TRY_AGAIN })).toBeInTheDocument();

    const claims = whole();

    claims.skills();
    claims.facts();
    claims.playbooks();
  });

  it("keeps the table when only its Used-by figures could not be counted, and never claims a zero", () => {
    render(screenOver(knowledgeReadings({ stats: FAILED })));

    const table = within(card(SKILLS_TITLE)).getByRole("table", { name: SKILLS_TABLE_NAME });

    expect(within(table).getAllByText(NOT_COUNTED_LABEL).length).toBeGreaterThan(0);
    expect(within(card(SKILLS_TITLE)).queryByText(SKILLS_UNREAD_TITLE)).toBeNull();
  });

  it("draws all five cards when every read failed — five designed errors, not a blank page", () => {
    render(
      screenOver(
        knowledgeReadings({
          skills: FAILED,
          stats: FAILED,
          facts: FAILED,
          playbooks: FAILED,
          repos: FAILED,
          maps: FAILED,
          profile: { repo: null, detection: FAILED, recipe: FAILED },
        }),
      ),
    );

    expect(screen.getAllByRole("region")).toHaveLength(5);
    expect(screen.getAllByRole("button", { name: TRY_AGAIN })).toHaveLength(4);
    expect(within(card(SCOPE_TITLE)).getAllByText(/not read/).length).toBeGreaterThan(0);
  });
});
