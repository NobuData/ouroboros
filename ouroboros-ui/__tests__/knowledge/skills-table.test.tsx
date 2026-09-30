import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Reading } from "@/app/api/reading";
import type { SkillList, SkillStats } from "@/app/api/skills";
import { WORKFLOWS_PATH } from "@/app/paths";
import {
  DRAFT_NEVER_INJECTS,
  DRAFT_PILL,
  GENERATED_OVERWRITE,
  GENERATED_TAG,
  MEMBER_REGENERATE_REASON,
  MEMBER_SWITCH_REASON,
  NOT_COUNTED_LABEL,
  NO_SKILLS_TITLE,
  OPEN_IN_EDITOR,
  REGENERATING,
  REQUIRED_NOTE,
  REQUIRED_TAG,
  SKILLS_TABLE_NAME,
  SKILLS_UNREAD_TITLE,
  editorReason,
  generatedNote,
  regenerateName,
  regenerateToast,
} from "@/app/knowledge/skills";

import {
  READ_AT,
  SEEDED_REPO,
  repoMapReport,
  seededSkill,
  seededSkills,
  seededStats,
} from "../helpers/knowledge";
import { maskIds, renderInBothPalettes } from "../helpers/palettes";

/**
 * Mockup 14's skills table as it is drawn (#418): the six seeded rows in both palettes, the
 * locked switch whose lock is the API's refusal, the Used-by footnotes, the generated row's tag
 * and regenerate, the tinted draft row, the ordinary switch that records, a member's read-only
 * switches, the closed editor door, and the sortable headings — all of it from the keyboard.
 */

const setSkillEnabled = vi.fn();
const regenerateRepoMap = vi.fn();
const refresh = vi.fn();

vi.mock("@/app/knowledge/skills-actions", () => ({
  setSkillEnabled: (slug: string, enabled: boolean) => setSkillEnabled(slug, enabled),
  regenerateRepoMap: (body: unknown) => regenerateRepoMap(body),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
}));

const { SkillsTable } = await import("@/app/knowledge/skills-table");

/** The required lock, as the service refuses it. */
const LOCKED = {
  ok: false,
  refusal: {
    code: "skill_required_locked",
    message: "required by policy — cannot disable",
    details: { slug: "hil-safety", reason: "required_by_policy" },
  },
};

/**
 * Draw the card.
 *
 * @param over Props to replace.
 * @returns The render result, and the toast spy.
 */
function draw(
  over: Partial<{
    skills: Reading<SkillList>;
    stats: Reading<SkillStats>;
    mayAdminister: boolean;
  }> = {},
) {
  const onToast = vi.fn();
  const result = render(
    <SkillsTable
      mayAdminister
      onToast={onToast}
      readAt={READ_AT}
      skills={{ ok: true, value: seededSkills() }}
      stats={{ ok: true, value: seededStats() }}
      {...over}
    />,
  );

  return { ...result, onToast };
}

/**
 * The row carrying a skill's name.
 *
 * @param slug The skill.
 * @returns The `<tr>`.
 */
function row(slug: string): HTMLElement {
  const door = screen.getByRole("button", { name: `Open ${slug} in the editor` });
  const tr = door.closest("tr");
  if (tr === null) throw new Error(`no row for ${slug}`);

  return tr;
}

/**
 * The elements a control is described by.
 *
 * @param control The control.
 * @returns Their text, joined.
 */
function descriptionOf(control: HTMLElement): string {
  return (control.getAttribute("aria-describedby") ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");
}

beforeEach(() => {
  setSkillEnabled.mockReset();
  regenerateRepoMap.mockReset().mockResolvedValue({ ok: true, value: repoMapReport() });
  refresh.mockReset();
});

describe("the six rows", () => {
  it("are the mockup's, cell for cell", () => {
    draw();

    expect(screen.getByText("5 active")).toBeInTheDocument();
    expect(screen.getByRole("table", { name: SKILLS_TABLE_NAME })).toBeInTheDocument();

    const expected: [string, string, string, string, string][] = [
      ["zephyr-conventions", "Kconfig, devicetree & ISR-safety house rules", "repo", "61% of runs", "v12 · 2d ago"],
      ["repo-map", "Module & ownership map of the source tree", "repo", "every run", GENERATED_TAG],
      ["pr-etiquette", "PR title format, changelog entry, reviewer ping rules", "org-wide", "every PR", "v4 · 3w ago"],
      ["hil-safety", "Hardware-in-loop interlocks before any motor spins", "repo", "physical tests", REQUIRED_TAG],
      ["commit-style", "Conventional commits, 72-char body wrap, sign-off", "org-wide", "every run", "v2 · 2mo ago"],
      ["power-budget-checks", "Flag changes that raise idle current above 120 µA", "repo", "—", "v1 · 20m ago"],
    ];

    for (const [slug, description, scope, used, updated] of expected) {
      const cells = within(row(slug)).getAllByRole("cell");

      expect(cells[0]).toHaveTextContent(slug);
      expect(cells[0]).toHaveTextContent(description);
      expect(cells[1]).toHaveTextContent(scope);
      expect(cells[2]).toHaveTextContent(used);
      expect(cells[3]).toHaveTextContent(updated);
    }

    expect(screen.getAllByRole("switch")).toHaveLength(6);
  });

  it("render the same markup in both palettes — the sheet is what differs", () => {
    const [light, dark] = renderInBothPalettes(
      <SkillsTable
        mayAdminister
        onToast={vi.fn()}
        readAt={READ_AT}
        skills={{ ok: true, value: seededSkills() }}
        stats={{ ok: true, value: seededStats() }}
      />,
    );

    expect(maskIds(light!)).toBe(maskIds(dark!));
    expect(light).toContain(REQUIRED_TAG);
    expect(light).toContain(GENERATED_TAG);
  });

  it("keep the head's editor link and the caption's on the Workflow Studio, which exists", () => {
    draw();

    expect(screen.getByRole("link", { name: OPEN_IN_EDITOR })).toHaveAttribute("href", WORKFLOWS_PATH);
    expect(screen.getByRole("link", { name: "Workflow Studio editor" })).toHaveAttribute("href", WORKFLOWS_PATH);
  });
});

describe("the required row", () => {
  it("draws its switch locked and on — readonly to assistive technology, not disabled", () => {
    draw();

    const toggle = screen.getByRole("switch", { name: "Disable hil-safety" });

    expect(toggle).toBeChecked();
    expect(toggle).toHaveAttribute("aria-readonly", "true");
    expect(toggle).not.toHaveAttribute("aria-disabled");
    expect(toggle).not.toBeDisabled();
    expect(toggle).toHaveClass("ou-switch--locked");
    expect(descriptionOf(toggle)).toContain(REQUIRED_NOTE);
  });

  it("is inert because the API refuses: the press makes the call, and the refusal is what the row shows", async () => {
    setSkillEnabled.mockResolvedValue(LOCKED);
    draw();

    const toggle = screen.getByRole("switch", { name: "Disable hil-safety" });
    fireEvent.click(toggle);

    expect(setSkillEnabled).toHaveBeenCalledExactlyOnceWith("hil-safety", false);

    const alert = await within(row("hil-safety")).findByRole("alert");

    expect(alert).toHaveTextContent("Not changed: required by policy — cannot disable.");
    expect(descriptionOf(toggle)).toContain("Not changed: required by policy — cannot disable.");
    // The switch stays on: the service did not move it.
    expect(toggle).toBeChecked();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("the Used-by column", () => {
  it("footnotes each figure with the window and the denominator, in the tooltip and the tree", () => {
    draw();

    const note =
      "11 of 18 runs in its scope carried it over the last 30 days (2026-08-31 to 2026-09-30); " +
      "11 injections across every consumer.";
    const cell = within(row("zephyr-conventions")).getAllByRole("cell")[2]!;

    expect(cell.querySelector("[title]")).toHaveAttribute("title", note);
    expect(cell).toHaveTextContent(note);
  });

  it("draws the draft's — as inert, explaining that drafts never inject", () => {
    draw();

    const cell = within(row("power-budget-checks")).getAllByRole("cell")[2]!;

    expect(cell.querySelector(".knowledge-skills__used-label--inert")).toHaveTextContent("—");
    expect(cell).toHaveTextContent(DRAFT_NEVER_INJECTS);
  });

  it("draws an enabled skill's zero as a real zero", () => {
    const stats = seededStats();
    stats.skills[0] = { slug: "commit-style", active: true, usedBy: { label: "—", carried: 0, inScope: 21 }, injections: 0 };
    draw({ stats: { ok: true, value: stats } });

    const cell = within(row("commit-style")).getAllByRole("cell")[2]!;

    expect(cell.querySelector(".knowledge-skills__used-label--zero")).toHaveTextContent("—");
    expect(cell.querySelector(".knowledge-skills__used-label--inert")).toBeNull();
    expect(cell).toHaveTextContent("It is enabled, and nothing has used it yet.");
  });

  it("never claims a zero it did not count", () => {
    draw({ stats: { ok: false, reason: "The service failed." } });

    const cell = within(row("zephyr-conventions")).getAllByRole("cell")[2]!;

    expect(cell).toHaveTextContent(NOT_COUNTED_LABEL);
    expect(cell).toHaveTextContent("Use could not be counted: The service failed.");
  });
});

describe("the generated row", () => {
  it("tags it with the real last generation time", () => {
    draw();

    const cell = within(row("repo-map")).getAllByRole("cell")[3]!;
    const note = generatedNote(seededSkill("repo-map"), new Date(READ_AT));

    expect(note).toMatch(/^Last generated 7h ago/);
    expect(within(cell).getByText(GENERATED_TAG, { exact: false })).toHaveAttribute("title", note);
    expect(cell).toHaveTextContent(note);
  });

  it("regenerates, round-tripping the report into the page's toast and a re-read", async () => {
    const { onToast } = draw();

    fireEvent.click(screen.getByRole("button", { name: regenerateName("repo-map") }));

    expect(regenerateRepoMap).toHaveBeenCalledExactlyOnceWith({ repo: SEEDED_REPO });

    await waitFor(() => {
      expect(onToast).toHaveBeenCalledOnce();
    });
    const toast = onToast.mock.calls[0]?.[0] as { text: string; links: unknown[] };

    // The age is measured from the clock at the moment the report lands, so only its shape is held.
    expect(toast.text).toMatch(/^repo-map regenerated for acme-robotics\/helios-firmware: v61 published .+ ago, 4 modules\.$/);
    expect(toast.links).toEqual([]);
    expect(regenerateToast(repoMapReport(), new Date(repoMapReport().generatedAt)).text).toMatch(/v61 published 0s ago/);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("says so while the generator runs, and shows the service's refusal", async () => {
    let settle: (value: unknown) => void = () => {};
    regenerateRepoMap.mockReturnValue(new Promise((resolve) => { settle = resolve; }));
    draw();

    const button = screen.getByRole("button", { name: regenerateName("repo-map") });
    fireEvent.click(button);

    await waitFor(() => {
      expect(button).toHaveAttribute("title", REGENERATING);
    });

    settle({
      ok: false,
      refusal: { code: "repo_map_regenerate_too_soon", message: "Too soon.", details: { retryAfterSeconds: 41 } },
    });

    const alert = await within(row("repo-map")).findByRole("alert");

    expect(alert).toHaveTextContent("Regenerated under a minute ago — try again in 41s.");
    expect(button).not.toHaveAttribute("aria-disabled");
  });

  it("warns, at the editor door, that the next generation overwrites manual edits", () => {
    draw();

    const door = screen.getByRole("button", { name: "Open repo-map in the editor" });

    expect(door).toHaveAttribute("aria-disabled", "true");
    expect(descriptionOf(door)).toContain(GENERATED_OVERWRITE);
    expect(descriptionOf(door)).toContain(editorReason("skills/repo-map.skill.md"));
    expect(door).toHaveAttribute("title", expect.stringContaining(GENERATED_OVERWRITE));

    // A press reveals both sentences in the row.
    fireEvent.click(door);
    expect(within(row("repo-map")).getByRole("status")).toHaveTextContent(editorReason("skills/repo-map.skill.md"));
    expect(within(row("repo-map")).getByText(GENERATED_OVERWRITE)).not.toHaveClass("sr-only");
  });

  it("warns of no overwrite on an authored skill's door", () => {
    draw();

    const door = screen.getByRole("button", { name: "Open zephyr-conventions in the editor" });

    expect(descriptionOf(door)).toBe(editorReason("skills/zephyr-conventions.skill.md"));
    expect(door).toHaveAttribute("title", editorReason("skills/zephyr-conventions.skill.md"));
  });
});

describe("the draft row", () => {
  it("is tinted, carries the pill, and its switch is off", () => {
    draw();

    const tr = row("power-budget-checks");

    expect(tr).toHaveClass("knowledge-skills__row--draft");
    expect(within(tr).getByText(DRAFT_PILL)).toHaveClass("ou-chip--warn");
    expect(screen.getByRole("switch", { name: "Enable power-budget-checks" })).not.toBeChecked();
    expect(screen.getAllByRole("row").filter((one) => one.classList.contains("knowledge-skills__row--draft"))).toHaveLength(1);
  });
});

describe("an ordinary switch", () => {
  it("records the change and updates the row from what the service answered", async () => {
    const after = { ...seededSkill("zephyr-conventions"), enabled: false, active: false };
    setSkillEnabled.mockResolvedValue({ ok: true, value: after });
    draw();

    fireEvent.click(screen.getByRole("switch", { name: "Disable zephyr-conventions" }));

    expect(setSkillEnabled).toHaveBeenCalledExactlyOnceWith("zephyr-conventions", false);

    const toggle = await screen.findByRole("switch", { name: "Enable zephyr-conventions" });

    expect(toggle).not.toBeChecked();
    expect(refresh).toHaveBeenCalledOnce();
    expect(within(row("zephyr-conventions")).queryByRole("alert")).toBeNull();
  });

  it("takes one press at a time", async () => {
    setSkillEnabled.mockReturnValue(new Promise(() => {}));
    draw();

    fireEvent.click(screen.getByRole("switch", { name: "Disable zephyr-conventions" }));
    fireEvent.click(screen.getByRole("switch", { name: "Disable commit-style" }));

    await waitFor(() => {
      expect(setSkillEnabled).toHaveBeenCalledOnce();
    });
  });
});

describe("a member", () => {
  it("sees every switch in its real state, read-only with the reason, and no press reaches the service", () => {
    draw({ mayAdminister: false });

    for (const toggle of screen.getAllByRole("switch")) {
      expect(toggle).toHaveAttribute("aria-disabled", "true");
      expect(toggle).toHaveAttribute("title", MEMBER_SWITCH_REASON);
      fireEvent.click(toggle);
    }

    expect(screen.getByRole("switch", { name: "Disable hil-safety" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Enable power-budget-checks" })).not.toBeChecked();
    expect(setSkillEnabled).not.toHaveBeenCalled();
  });

  it("sees the regenerate inert with the reason", () => {
    draw({ mayAdminister: false });

    const button = screen.getByRole("button", { name: regenerateName("repo-map") });

    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAttribute("title", MEMBER_REGENERATE_REASON);
    fireEvent.click(button);
    expect(regenerateRepoMap).not.toHaveBeenCalled();
  });
});

describe("sorting", () => {
  /** The slugs in the order the rows are drawn. */
  const order = () => screen.getAllByRole("row").slice(1).map((tr) => tr.querySelector(".knowledge-skills__name")?.textContent);

  it("starts in the service's order, and sorts by a heading's press, then reverses, then returns", () => {
    draw();

    const heading = screen.getByRole("button", { name: "Updated" });
    const th = heading.closest("th");

    expect(order()).toEqual(seededSkills().skills.map((skill) => skill.slug));
    expect(th).not.toHaveAttribute("aria-sort");

    fireEvent.click(heading);
    expect(th).toHaveAttribute("aria-sort", "ascending");
    expect(order()).toEqual(["commit-style", "hil-safety", "pr-etiquette", "zephyr-conventions", "repo-map", "power-budget-checks"]);

    fireEvent.click(heading);
    expect(th).toHaveAttribute("aria-sort", "descending");
    expect(order()[0]).toBe("power-budget-checks");

    fireEvent.click(heading);
    expect(th).not.toHaveAttribute("aria-sort");
    expect(order()).toEqual(seededSkills().skills.map((skill) => skill.slug));
  });

  it("offers every column but the switches", () => {
    draw();

    for (const name of ["Skill", "Scope", "Used by", "Updated"]) {
      expect(screen.getByRole("button", { name })).toHaveAttribute("type", "button");
    }
    expect(screen.queryByRole("button", { name: "On" })).toBeNull();
  });
});

describe("the keyboard", () => {
  it("reaches every control in the tab order — no control is taken out of it", () => {
    draw();

    const controls = screen.getAllByRole("button").concat(screen.getAllByRole("switch"), screen.getAllByRole("link"));

    expect(controls.length).toBeGreaterThan(12);
    for (const control of controls) expect(control).not.toHaveAttribute("tabindex", "-1");
  });
});

describe("what could not be read", () => {
  it("says the skills could not be read, with the service's reason", () => {
    draw({ skills: { ok: false, reason: "The service failed." } });

    expect(screen.getByText(SKILLS_UNREAD_TITLE)).toBeInTheDocument();
    expect(screen.getByText("The service failed.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("says a workspace with no skills has none yet, and how one arrives", () => {
    draw({ skills: { ok: true, value: { skills: [], active: 0 } } });

    expect(screen.getByText(NO_SKILLS_TITLE)).toBeInTheDocument();
    expect(screen.getByText("0 active")).toBeInTheDocument();
  });
});
