import { fireEvent, render, screen, within } from "@testing-library/react";
import { type ReactElement, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type { GlobPreview } from "@/app/globs/glob";
import { POLICIES_READ_ONLY, TERMS_NOT_EDITABLE, switchLabel } from "@/app/policies/card-view";
import {
  CORE_RULES,
  type CoreRuleId,
  type PolicyDocument,
  type PolicyDrafts,
  RULE_NAMES,
  RULE_REASONS,
  draftsOf,
} from "@/app/policies/document";

import { maskIds, renderInBothPalettes } from "../helpers/palettes";

/**
 * A rule's row on the Autonomy policies card (BS.4,
 * [#494](https://github.com/NobuData/ouroboros/issues/494)) — mockup 17's `.policy-row`: the
 * seeded v7 draws the mockup's chips exactly, from the document; a chip is the way into the
 * rule's editor for a reader who may edit and a static term for one who may not; and a rule the
 * editor cannot represent keeps its conditions and its switch.
 */

// The shared glob editor is fork-independent here; the row only has to reach it.
vi.mock("@/app/globs/glob-editor", () => ({
  GlobEditor: (props: { id: string; label: string; globs: readonly string[] }) => (
    <div data-testid="glob-editor">
      <label htmlFor={props.id}>{props.label}</label>
      <input id={props.id} readOnly value={props.globs.join(",")} />
    </div>
  ),
}));

const { PROTECTED_GLOBS_LABEL, AUTO_MERGE_EFFORT_LABEL, EXCLUDE_A_LABEL, MONTHLY_LABEL, PER_RUN_LABEL, LOOPS_LABEL, REVIEW_EFFORT_LABEL, ONE_MORE } =
  await import("@/app/policies/rule-editors");
const { ADD_CONDITION, DONE, EDITED_MARK, RuleRow, SAVING_REASON, chipButtonLabel, controlOfChip, editorLabel } =
  await import("@/app/policies/rule-row");

/** Mockup 17's seeded policy — `schemas/org-policy/fixtures/valid/policy-v7.json`. */
const V7: PolicyDocument = {
  auto_merge: { enabled: true, conditions: { all: [{ effort_lte: "m" }, { not: { label: "refactor" } }] } },
  human_review: { enabled: true, conditions: { any: [{ label: "refactor" }, { effort_gte: "l" }] } },
  protected_paths: { enabled: true, conditions: { path_globs: ["boot/**", "keys/**", ".github/**"] } },
  spend_guard: { enabled: true, conditions: { per_run_cap_cents: 250, monthly_cap_cents: 60000 } },
  dry_run_new_repos: { enabled: true, conditions: { first_n_loops: 10 } },
};

/** The mockup's chips, rule by rule. */
const MOCKUP_CHIPS: Readonly<Record<CoreRuleId, readonly string[]>> = {
  auto_merge: ["effort ≤ M", "non-refactor"],
  human_review: ["label:refactor", "OR effort ≥ L"],
  protected_paths: ["boot/", "keys/", ".github/"],
  spend_guard: ["pause loop at $2.50/run", "monthly cap $600/provider"],
  dry_run_new_repos: ["first 10 loops open draft PRs"],
};

const preview = (): Promise<GlobPreview> => Promise.resolve({ ok: true, repositories: [] });

/** What a drawn row can be asked afterwards. */
interface Drawn {
  /** Every draft the row emitted, in order. */
  readonly calls: unknown[];
}

/**
 * One row over state it owns, as the card holds it.
 *
 * @param id The rule.
 * @param options The document, the reader, and what the save model says of the rule.
 * @returns The element and the record of emissions.
 */
function row<Id extends CoreRuleId>(
  id: Id,
  options: {
    document?: PolicyDocument;
    mayEdit?: boolean;
    editable?: boolean;
    dirty?: boolean;
    error?: string;
  } = {},
): { element: ReactElement; drawn: Drawn } {
  const { document = V7, mayEdit = true, editable = mayEdit, dirty = false, error } = options;
  const calls: unknown[] = [];

  function Harness() {
    const [draft, setDraft] = useState<PolicyDrafts[Id]>(draftsOf(document)[id]);

    return (
      <RuleRow
        dirty={dirty}
        draft={draft}
        editable={editable}
        error={error}
        id={id}
        mayEdit={mayEdit}
        onChange={(next) => {
          calls.push(next);
          setDraft(next);
        }}
        previewPaths={preview}
        saved={document[id]}
        switchId={`switch-${id}`}
      />
    );
  }

  return { element: <Harness />, drawn: { calls } };
}

/**
 * Draw a row.
 *
 * @param id The rule.
 * @param options See {@link row}.
 * @returns The record of emissions.
 */
function draw<Id extends CoreRuleId>(id: Id, options: Parameters<typeof row>[1] = {}): Drawn {
  const { element, drawn } = row(id, options);
  render(element);

  return drawn;
}

/** The row's terms, as text, in order. */
function terms(): string[] {
  return [...document.querySelectorAll(".policy-rule__terms > *")].map((term) => term.textContent);
}

describe("the seeded card", () => {
  it.each(CORE_RULES)("draws %s as mockup 17 does: name, why, chips exact, switch on", (id) => {
    draw(id, { mayEdit: false });

    const group = screen.getByRole("group", { name: RULE_NAMES[id] });

    expect(within(group).getByText(RULE_NAMES[id])).toBeTruthy();
    expect(within(group).getByText(RULE_REASONS[id])).toBeTruthy();
    expect(terms()).toEqual(MOCKUP_CHIPS[id]);
    expect(within(group).getByRole("switch").getAttribute("aria-checked")).toBe("true");
  });

  it.each(CORE_RULES)("draws the same chips for a reader who may edit %s", (id) => {
    draw(id);

    expect(terms()).toEqual(MOCKUP_CHIPS[id]);
  });

  it("draws the chips from the document, whatever it holds", () => {
    draw("auto_merge", {
      document: {
        ...V7,
        auto_merge: { enabled: false, conditions: { all: [{ not: { label: "infra" } }, { effort_lte: "xs" }] } },
      },
    });

    expect(terms()).toEqual(["non-infra", "effort ≤ XS"]);
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
  });

  it.each(CORE_RULES)("renders %s identically under both palettes, for both readers", (id) => {
    for (const mayEdit of [false, true]) {
      const [light, dark] = renderInBothPalettes(row(id, { mayEdit, dirty: mayEdit }).element);

      expect(maskIds(light)).toBe(maskIds(dark));
    }
  });
});

describe("a reader who may not edit", () => {
  it("sees the switch in its real state with the reason, static terms, and no editor", () => {
    const drawn = draw("spend_guard", { mayEdit: false });
    const toggle = screen.getByRole("switch", { name: switchLabel("spend_guard", true) });

    expect(toggle.getAttribute("aria-disabled")).toBe("true");
    expect(toggle.getAttribute("title")).toBe(POLICIES_READ_ONLY);

    fireEvent.click(toggle);

    expect(drawn.calls).toEqual([]);
    expect(document.querySelectorAll(".policy-rule__terms button")).toHaveLength(0);
    expect(document.querySelectorAll(".policy-rule__terms .ou-tag")).toHaveLength(2);
    expect(screen.queryByText(TERMS_NOT_EDITABLE)).toBeNull();
  });
});

describe("a reader who may edit", () => {
  it("flips the rule with the switch, keeping its terms", () => {
    const drawn = draw("dry_run_new_repos");

    fireEvent.click(screen.getByRole("switch", { name: switchLabel("dry_run_new_repos", true) }));

    expect(drawn.calls).toEqual([{ enabled: false, terms: { firstLoops: 10 } }]);
    expect(screen.getByRole("switch", { name: switchLabel("dry_run_new_repos", false) })).toBeTruthy();
  });

  it("opens the rule's editor from a chip, on the control that chip stands for", () => {
    draw("auto_merge");
    const name = RULE_NAMES.auto_merge;
    const effort = screen.getByRole("button", { name: chipButtonLabel("effort ≤ M", name) });

    expect(effort.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("group", { name: editorLabel(name) })).toBeNull();

    fireEvent.click(effort);

    const editor = screen.getByRole("group", { name: editorLabel(name) });

    expect(effort.getAttribute("aria-expanded")).toBe("true");
    expect(effort.getAttribute("aria-controls")).toBe(editor.id);
    expect(document.activeElement).toBe(screen.getByLabelText(AUTO_MERGE_EFFORT_LABEL));

    // A second chip moves focus to its own control; the editor stays open.
    fireEvent.click(screen.getByRole("button", { name: chipButtonLabel("non-refactor", name) }));
    expect(document.activeElement).toBe(screen.getByLabelText(EXCLUDE_A_LABEL));

    // The chip that opened it closes it; so does Done.
    fireEvent.click(screen.getByRole("button", { name: chipButtonLabel("non-refactor", name) }));
    expect(screen.queryByRole("group", { name: editorLabel(name) })).toBeNull();

    fireEvent.click(effort);
    fireEvent.click(screen.getByRole("button", { name: DONE }));
    expect(screen.queryByRole("group", { name: editorLabel(name) })).toBeNull();
  });

  it.each<[CoreRuleId, string, string]>([
    ["human_review", "OR effort ≥ L", "REVIEW_EFFORT"],
    ["protected_paths", "keys/", "GLOBS"],
    ["spend_guard", "monthly cap $600/provider", "MONTHLY"],
    ["spend_guard", "pause loop at $2.50/run", "PER_RUN"],
    ["dry_run_new_repos", "first 10 loops open draft PRs", "LOOPS"],
  ])("leads from %s's chip %s to its control", (id, chip, control) => {
    const labels: Record<string, string> = {
      REVIEW_EFFORT: REVIEW_EFFORT_LABEL,
      GLOBS: PROTECTED_GLOBS_LABEL,
      MONTHLY: MONTHLY_LABEL,
      PER_RUN: PER_RUN_LABEL,
      LOOPS: LOOPS_LABEL,
    };

    draw(id);
    fireEvent.click(screen.getByRole("button", { name: chipButtonLabel(chip, RULE_NAMES[id]) }));

    expect(document.activeElement).toBe(screen.getByLabelText(labels[control]));
  });

  it("names the control for every chip a rule can show", () => {
    expect(controlOfChip("auto_merge", "effort ≤ M")).toBe("effort");
    expect(controlOfChip("auto_merge", "non-refactor")).toBe("label");
    expect(controlOfChip("human_review", "label:refactor")).toBe("label");
    expect(controlOfChip("human_review", "OR effort ≥ L")).toBe("effort");
    expect(controlOfChip("human_review", "effort ≥ L")).toBe("effort");
    expect(controlOfChip("protected_paths", "boot/")).toBe("globs");
    expect(controlOfChip("spend_guard", "pause loop at $2.50/run")).toBe("per-run");
    expect(controlOfChip("spend_guard", "monthly cap $600/provider")).toBe("monthly");
    expect(controlOfChip("dry_run_new_repos", "no loops held as drafts")).toBe("loops");
  });

  it("redraws the chips from the draft the moment an editor changes it", () => {
    const drawn = draw("dry_run_new_repos");

    fireEvent.click(
      screen.getByRole("button", {
        name: chipButtonLabel("first 10 loops open draft PRs", RULE_NAMES.dry_run_new_repos),
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: ONE_MORE }));

    expect(drawn.calls).toEqual([{ enabled: true, terms: { firstLoops: 11 } }]);
    expect(terms()).toEqual(["first 11 loops open draft PRs"]);
  });

  it("gives a rule with no chip a way into its editor", () => {
    draw("protected_paths", {
      document: { ...V7, protected_paths: { enabled: false, conditions: { path_globs: [] } } },
    });

    fireEvent.click(screen.getByRole("button", { name: ADD_CONDITION }));

    expect(screen.getByTestId("glob-editor")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText(PROTECTED_GLOBS_LABEL));
  });

  it("marks an edited rule in words, and states what the last save found wrong with it", () => {
    draw("spend_guard", { dirty: true, error: "A spend guard needs at least one cap." });

    expect(screen.getByText(EDITED_MARK)).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe("A spend guard needs at least one cap.");
  });

  it("carries no mark and no alert when nothing is edited or wrong", () => {
    draw("spend_guard");

    expect(screen.queryByText(EDITED_MARK)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("sends focus aimed at the switch's id on to the switch itself", () => {
    draw("human_review");

    document.getElementById("switch-human_review")?.focus();

    expect(document.activeElement).toBe(screen.getByRole("switch"));
  });

  it("stays drawn and inert while a save is in flight", () => {
    const drawn = draw("dry_run_new_repos", { editable: false });
    const toggle = screen.getByRole("switch");

    expect(toggle.getAttribute("title")).toBe(SAVING_REASON);
    fireEvent.click(toggle);

    fireEvent.click(
      screen.getByRole("button", {
        name: chipButtonLabel("first 10 loops open draft PRs", RULE_NAMES.dry_run_new_repos),
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: ONE_MORE }));

    expect(screen.getByLabelText(LOOPS_LABEL)).toHaveProperty("readOnly", true);
    expect(drawn.calls).toEqual([]);
  });
});

describe("a rule the chip editor cannot represent", () => {
  const NESTED: PolicyDocument = {
    ...V7,
    auto_merge: {
      enabled: true,
      conditions: { all: [{ effort_lte: "m" }, { any: [{ label: "docs" }, { label: "chore" }] }] },
    },
  };

  it("draws its conditions as static chips with the note, and still switches", () => {
    const drawn = draw("auto_merge", { document: NESTED });

    expect(terms()).toEqual(["effort ≤ M", "(label:docs OR label:chore)"]);
    expect(document.querySelectorAll(".policy-rule__terms button")).toHaveLength(0);
    expect(screen.getByRole("note").textContent).toBe(TERMS_NOT_EDITABLE);

    fireEvent.click(screen.getByRole("switch", { name: switchLabel("auto_merge", true) }));

    expect(drawn.calls).toEqual([{ enabled: false, terms: null }]);
    expect(terms()).toEqual(["effort ≤ M", "(label:docs OR label:chore)"]);
  });

  it("says nothing about editing to a reader who could not edit anyway", () => {
    draw("auto_merge", { document: NESTED, mayEdit: false });

    expect(screen.queryByRole("note")).toBeNull();
  });
});
