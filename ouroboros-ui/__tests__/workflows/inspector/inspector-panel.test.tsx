import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { WorkflowDefinition, WorkflowStageType } from "@/app/api/workflows";
import { type CanvasSelection, readStages, stageEntry } from "@/app/workflows/canvas/graph";
import {
  APPLIED_NOTE,
  BUDGET_INVALID,
  CATALOG_UNREAD,
  CLEAN_REASON,
  DECLARED_NOTE,
  DIRTY_NOTE,
  EDGE_SELECTED_NOTE,
  INSPECTOR_LABEL,
  INVALID_REASON,
  MANY_SELECTED_NOTE,
  MEMBER_REASON,
  NOTHING_SELECTED_TITLE,
  NO_OPTIONS_NOTE,
  PALETTE_NOTE,
  ROUTES_UNREAD_NOTE,
  TRIGGER_NOTE,
  TYPE_UNKNOWN,
  VALUES_REQUIRED,
  unknownAlias,
  unknownSkill,
} from "@/app/workflows/inspector/inspector";
import { InspectorPanel, type InspectorPanelProps } from "@/app/workflows/inspector/inspector-panel";
import type { InspectorReadings } from "@/app/workflows/view";

import { maskIds, renderInBothPalettes } from "../../helpers/palettes";
import { inspectorReadings, stageCatalog, standardFixDefinition } from "../../helpers/workflows";

/**
 * The inspector as it is drawn (#150) — mockup 04's `.inspector`, bound to a selected stage of the
 * seeded `standard-fix`.
 *
 * The acceptance criteria this suite exists for, in the ticket's words: **the seeded Implement node
 * renders the mockup's panel exactly**; **every node type has a working form, generated from its
 * catalog schema**; **the permissions section states that toggles are declarations enforced at
 * execution**; **unknown skill/model references are flagged inline without blocking Apply**;
 * **token budget accepts and renders shorthand**; and **every control reachable and labelled**. The
 * round trip into the canvas's chips is `studio-editor.test.tsx`'s; the decisions are
 * `inspector.test.ts`'s; the sticky wrapper is `inspector-styles.test.ts`'s.
 */

/**
 * Open the panel on one stage.
 *
 * @param id The stage, or `null` for nothing selected.
 * @param over What this case changes.
 * @returns The render, and the two callbacks.
 */
function open(id: string | null, over: Partial<InspectorPanelProps> = {}) {
  const definition = over.definition ?? standardFixDefinition();
  const stage = id === null ? undefined : readStages(definition).find((entry) => entry.id === id);
  const selection: CanvasSelection = stage === undefined ? null : { kind: "node", id: stage.id, stage };
  const onApply = vi.fn();
  const onDelete = vi.fn();

  const view = render(
    <InspectorPanel
      definition={definition}
      entry={id === null ? null : stageEntry(definition, id)}
      mayAdminister
      onApply={onApply}
      onDelete={onDelete}
      readings={inspectorReadings()}
      selection={selection}
      {...over}
    />,
  );

  return { ...view, onApply, onDelete };
}

/** The panel. */
function panel(): HTMLElement {
  return screen.getByRole("complementary", { name: INSPECTOR_LABEL });
}

/** The Apply button. */
function applyButton(): HTMLElement {
  return screen.getByRole("button", { name: "Apply" });
}

/** The seeded Implement stage's config. */
function implementConfig(): Record<string, unknown> {
  return stageEntry(standardFixDefinition(), "implement")?.config as Record<string, unknown>;
}

describe("with no single stage selected", () => {
  it("says to select one", () => {
    open(null);

    expect(within(panel()).getByText(NOTHING_SELECTED_TITLE)).toBeInTheDocument();
  });

  it("says edge editing is #151's for an edge, and asks for one stage for several", () => {
    const { rerender } = open(null, {
      selection: { kind: "edge", id: "a→b", connection: { from: "a", to: "b", kind: "default", label: null, condition: null } },
    });
    expect(screen.getByText(EDGE_SELECTED_NOTE)).toBeInTheDocument();

    rerender(
      <InspectorPanel
        definition={standardFixDefinition()}
        entry={null}
        mayAdminister
        onApply={vi.fn()}
        onDelete={vi.fn()}
        readings={inspectorReadings()}
        selection={{ kind: "many", nodes: 2, edges: 1 }}
      />,
    );
    expect(screen.getByText(MANY_SELECTED_NOTE)).toBeInTheDocument();
  });
});

describe("the seeded Implement stage — the mockup's panel", () => {
  it("heads the panel with the type line, the title and the description", () => {
    open("implement");

    expect(panel().querySelector(".studio-inspector__type")).toHaveTextContent("◆ Implement");
    expect(screen.getByRole("heading", { level: 2, name: "Code the change" })).toBeInTheDocument();
    expect(screen.getByText("Writes the change described by the attack plan onto a fresh branch.")).toBeInTheDocument();
  });

  it("draws the mode segment on Skill, and the skill with its hint", () => {
    open("implement");

    expect(screen.getByRole("radio", { name: "Skill" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Direct prompt" })).not.toBeChecked();
    expect(screen.getByRole("combobox", { name: "Skill" })).toHaveValue("zephyr-conventions");
    expect(screen.getByText("Loaded into context before the stage prompt.")).toBeInTheDocument();
  });

  it("draws the prompt template with its two placeholders highlighted", () => {
    const { container } = open("implement");

    expect(screen.getByRole("textbox", { name: "Prompt template" })).toHaveValue(
      implementConfig().prompt_template as string,
    );
    expect([...container.querySelectorAll(".studio-inspector__variable")].map((node) => node.textContent)).toEqual([
      "{{issue.title}}",
      "{{plan}}",
    ]);
  });

  it("draws the routing radios on the inherited route, with the model it resolves to", () => {
    open("implement");

    expect(screen.getByRole("radio", { name: /Inherit route for task "implement"/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Pin model" })).not.toBeChecked();
    expect(screen.getByText("claude-fable-5")).toHaveClass("ou-chip--model");
  });

  it("draws the limits, the budget as the mockup's 400k", () => {
    open("implement");

    expect(screen.getByRole("spinbutton", { name: "Max retries" })).toHaveValue(2);
    expect(screen.getByRole("textbox", { name: "Token budget" })).toHaveValue("400k");
  });

  it("draws the permission toggles with the P9 note that they are declarations", () => {
    open("implement");

    expect(screen.getByRole("switch", { name: "May push fixup commits" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: "May touch CI config" })).toHaveAttribute("aria-checked", "false");
    const note = screen.getByText(DECLARED_NOTE).closest(".studio-inspector__declared");
    // The note describes each toggle, so a screen reader hears it with the switch.
    expect(note?.id).toMatch(/-declared$/);
    for (const name of ["May push fixup commits", "May touch CI config"]) {
      expect(screen.getByRole("switch", { name }), name).toHaveAttribute("aria-describedby", note?.id);
    }
  });

  it("closes with Delete stage and an Apply that has nothing to apply yet", () => {
    open("implement");

    expect(screen.getByRole("button", { name: "Delete stage" })).not.toHaveAttribute("aria-disabled");
    expect(applyButton()).toHaveAttribute("aria-disabled", "true");
    expect(applyButton()).toHaveAttribute("title", CLEAN_REASON);
  });
});

describe("editing and applying", () => {
  it("marks the draft dirty, applies it, and says it is applied but not saved", () => {
    const definition = standardFixDefinition();
    const { onApply, rerender } = open("implement", { definition });

    fireEvent.change(screen.getByRole("combobox", { name: "Skill" }), { target: { value: "repo-map" } });
    expect(screen.getByText(DIRTY_NOTE)).toBeInTheDocument();
    expect(applyButton()).not.toHaveAttribute("aria-disabled");

    fireEvent.click(applyButton());

    const applied = { ...implementConfig(), skill: "repo-map" };
    expect(onApply).toHaveBeenCalledExactlyOnceWith("implement", applied);

    // The page writes the draft and hands the stage back, as `studio-editor.tsx` does: the panel
    // then matches the draft, and says the change is applied and not saved.
    const entry = stageEntry(definition, "implement");
    rerender(
      <InspectorPanel
        definition={definition}
        entry={entry === null ? null : { ...entry, config: applied }}
        mayAdminister
        onApply={onApply}
        onDelete={vi.fn()}
        readings={inspectorReadings()}
        selection={null}
      />,
    );

    expect(screen.getByText(APPLIED_NOTE)).toBeInTheDocument();
    expect(screen.queryByText(DIRTY_NOTE)).not.toBeInTheDocument();
    expect(applyButton()).toHaveAttribute("title", CLEAN_REASON);
  });

  it("flags an unknown skill inline and still applies it (P7)", () => {
    const { onApply } = open("implement");

    fireEvent.change(screen.getByRole("combobox", { name: "Skill" }), { target: { value: "nope" } });

    const warning = screen.getByText(unknownSkill("nope"));
    expect(warning).toHaveClass("studio-inspector__warning");
    expect(screen.getByRole("combobox", { name: "Skill" }).getAttribute("aria-describedby")).toContain(warning.id);
    expect(applyButton()).not.toHaveAttribute("aria-disabled");

    fireEvent.click(applyButton());
    expect(onApply).toHaveBeenCalledOnce();
  });

  it("accepts a shorthand budget, and refuses one that is not a number of tokens", () => {
    const { onApply } = open("implement");
    const budget = screen.getByRole("textbox", { name: "Token budget" });

    fireEvent.change(budget, { target: { value: "250k" } });
    fireEvent.click(applyButton());
    expect(onApply).toHaveBeenLastCalledWith("implement", {
      ...implementConfig(),
      limits: { max_retries: 2, token_budget: 250_000 },
    });

    fireEvent.change(budget, { target: { value: "lots" } });
    expect(screen.getByText(BUDGET_INVALID)).toBeInTheDocument();
    expect(applyButton()).toHaveAttribute("title", INVALID_REASON);
  });

  it("drops the skill on switching to Direct prompt", () => {
    const { onApply } = open("implement");

    fireEvent.click(screen.getByRole("radio", { name: "Direct prompt" }));
    expect(screen.queryByRole("combobox", { name: "Skill" })).not.toBeInTheDocument();

    fireEvent.click(applyButton());
    const applied = onApply.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(applied.mode).toBe("prompt");
    expect(applied).not.toHaveProperty("skill");
  });

  it("pins a registry alias", () => {
    const { onApply } = open("implement");

    fireEvent.click(screen.getByRole("radio", { name: "Pin model" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Model alias" }), { target: { value: "coder-std" } });
    fireEvent.click(applyButton());

    expect(onApply).toHaveBeenCalledWith("implement", {
      ...implementConfig(),
      routing: { pinned_model: { alias: "coder-std" } },
    });
  });

  it("flags a pinned alias the registry does not hold, keeping it selectable", () => {
    const definition = standardFixDefinition();
    (definition.nodes as { id: string; config: Record<string, unknown> }[])[1]!.config.routing = {
      pinned_model: { alias: "ghost" },
    };
    open("analyze", { definition });

    expect(screen.getByRole("combobox", { name: "Model alias" })).toHaveValue("ghost");
    expect(screen.getByText(unknownAlias("ghost"))).toBeInTheDocument();
  });

  it("toggles a permission declaration", () => {
    const { onApply } = open("implement");

    fireEvent.click(screen.getByRole("switch", { name: "May touch CI config" }));
    fireEvent.click(applyButton());

    expect(onApply).toHaveBeenCalledWith("implement", {
      ...implementConfig(),
      permissions: { push_fixup: true, touch_ci: true },
    });
  });

  it("inserts a palette variable at the caret, from the run context or an earlier stage", () => {
    open("implement");
    const template = screen.getByRole("textbox", { name: "Prompt template" }) as HTMLTextAreaElement;

    expect(screen.getByRole("button", { name: "Insert {{analyze}}" })).toBeInTheDocument();
    expect(screen.getByText(PALETTE_NOTE)).toBeInTheDocument();

    template.setSelectionRange(0, 0);
    fireEvent.click(screen.getByRole("button", { name: "Insert {{diff}}" }));

    expect(template.value.startsWith("{{diff}}Implement the approved plan.")).toBe(true);
    expect(template.selectionStart).toBe("{{diff}}".length);
  });

  it("asks the page to delete the stage", () => {
    const { onDelete } = open("implement");

    fireEvent.click(screen.getByRole("button", { name: "Delete stage" }));

    expect(onDelete).toHaveBeenCalledExactlyOnceWith("implement");
  });
});

describe("every node type has a working form", () => {
  it("builds a decision's predicate from the schema, and asks for values a list predicate needs", () => {
    const { onApply } = open("effort-recheck");

    expect(screen.getByRole("combobox", { name: "Kind" })).toHaveValue("decision");
    expect(screen.getByRole("combobox", { name: "Tests" })).toHaveValue("effort");
    expect(screen.getByRole("combobox", { name: "Operator" })).toHaveValue("lte");
    expect(screen.getByRole("combobox", { name: "Value" })).toHaveValue("m");

    fireEvent.change(screen.getByRole("combobox", { name: "Value" }), { target: { value: "l" } });
    fireEvent.click(applyButton());
    expect(onApply).toHaveBeenCalledWith("effort-recheck", {
      kind: "decision",
      predicate: { kind: "effort", op: "lte", value: "l" },
    });

    fireEvent.change(screen.getByRole("combobox", { name: "Tests" }), { target: { value: "labels" } });
    expect(screen.getByText(VALUES_REQUIRED)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Values" }), { target: { value: "docs, chore" } });
    fireEvent.click(applyButton());
    expect(onApply).toHaveBeenLastCalledWith("effort-recheck", {
      kind: "decision",
      predicate: { kind: "labels", op: "any", values: ["docs", "chore"] },
    });
  });

  it("offers a source predicate's values as the schema's four trackers", () => {
    open("effort-recheck");

    fireEvent.change(screen.getByRole("combobox", { name: "Tests" }), { target: { value: "source" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "jira" }));

    expect(screen.getAllByRole("checkbox").map((box) => box.getAttribute("type") && box.parentElement?.textContent)).toEqual([
      "github",
      "gitlab",
      "jira",
      "linear",
    ]);
    expect(screen.getByRole("checkbox", { name: "jira" })).toBeChecked();
  });

  it("edits a gate's check names", () => {
    const { onApply } = open("checks-green");

    const names = screen.getByRole("textbox", { name: "Checks" });
    expect(names).toHaveValue("build, test, review");

    fireEvent.change(names, { target: { value: "" } });
    fireEvent.click(applyButton());
    expect(onApply).toHaveBeenCalledWith("checks-green", { kind: "gate", predicate: { kind: "checks", op: "all_passed" } });
  });

  it("generates a terminal's options per action", () => {
    const { onApply } = open("open-pr");

    expect(screen.getByRole("combobox", { name: "Action" })).toHaveValue("open_pr_automerge");
    expect(screen.getByRole("combobox", { name: "Merge method" })).toHaveValue("squash");
    expect(screen.getByRole("switch", { name: "Delete branch" })).toHaveAttribute("aria-checked", "true");

    fireEvent.change(screen.getByRole("combobox", { name: "Action" }), { target: { value: "back_to_queue" } });
    expect(screen.getByText(NO_OPTIONS_NOTE)).toBeInTheDocument();
    fireEvent.click(applyButton());
    expect(onApply).toHaveBeenCalledWith("open-pr", { action: "back_to_queue", options: {} });
  });

  it("generates an infra stage's form, and removes an optional field left empty", () => {
    const { onApply } = open("test");

    expect(screen.getByRole("textbox", { name: "Runner pool" })).toHaveValue("pool-a");
    fireEvent.change(screen.getByRole("textbox", { name: "Command" }), { target: { value: "" } });
    fireEvent.click(applyButton());

    expect(onApply).toHaveBeenCalledWith("test", { runner_pool: "pool-a" });
  });

  it("explains that a trigger has no stage settings", () => {
    open("issue-queued");

    expect(screen.getByText(TRIGGER_NOTE)).toBeInTheDocument();
  });

  it("generates a form for a node type this build has never heard of", () => {
    const definition: WorkflowDefinition = {
      nodes: [{ id: "probe", type: "sandbox", title: "Probe", position: { x: 0, y: 0 }, config: { depth: 2 } }],
      edges: [],
    };
    const sandbox: WorkflowStageType = {
      type: "sandbox",
      label: "sandbox",
      glyph: "□",
      class: "sandbox",
      configSchemaRef: "https://ouroboros.build/schemas/workflow-dsl/v1.json#/$defs/sandbox_config",
      configSchema: {
        type: "object",
        properties: { depth: { type: "integer", minimum: 1 }, flavour: { enum: ["a", "b"] }, dry: { type: "boolean" } },
      } as unknown as WorkflowStageType["configSchema"],
      defaults: { title: "sandbox", config: {} } as WorkflowStageType["defaults"],
    };
    const catalog = stageCatalog();
    const readings: InspectorReadings = inspectorReadings({
      catalog: { ok: true, value: { ...catalog, nodeTypes: [...catalog.nodeTypes, sandbox] } },
    });

    const { onApply } = open("probe", { definition, readings });

    expect(panel().querySelector(".studio-inspector__type")).toHaveTextContent("□ sandbox");
    expect(screen.getByRole("spinbutton", { name: "Depth" })).toHaveValue(2);
    fireEvent.change(screen.getByRole("combobox", { name: "Flavour" }), { target: { value: "b" } });
    fireEvent.click(screen.getByRole("switch", { name: "Dry" }));
    fireEvent.click(applyButton());

    expect(onApply).toHaveBeenCalledWith("probe", { depth: 2, flavour: "b", dry: true });
  });
});

describe("a degraded read", () => {
  it("explains a catalog that could not be read, with the service's reason", () => {
    open("implement", { readings: inspectorReadings({ catalog: { ok: false, reason: "Catalog away." } }) });

    expect(screen.getByText(`${CATALOG_UNREAD} Catalog away.`)).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Prompt template" })).not.toBeInTheDocument();
  });

  it("explains a type the catalog does not describe", () => {
    const catalog = stageCatalog();
    open("implement", {
      readings: inspectorReadings({
        catalog: { ok: true, value: { ...catalog, nodeTypes: catalog.nodeTypes.filter((type) => type.type !== "llm") } },
      }),
    });

    expect(screen.getByText(TYPE_UNKNOWN)).toBeInTheDocument();
  });

  it("loses only the model pill when routing could not be read", () => {
    open("implement", { readings: inspectorReadings({ routes: { ok: false, reason: "away" } }) });

    expect(screen.getByText(ROUTES_UNREAD_NOTE)).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Skill" })).toBeInTheDocument();
  });

  it("takes a pinned alias as text when the registry could not be read", () => {
    open("analyze", { readings: inspectorReadings({ aliases: { ok: false, reason: "away" } }) });

    expect(screen.getByRole("textbox", { name: "Model alias" })).toHaveValue("coder-std");
  });
});

describe("a reader who may not edit", () => {
  it("draws the panel inert, with the reason on both actions", () => {
    open("implement", { mayAdminister: false });

    for (const name of ["Apply", "Delete stage"]) {
      expect(screen.getByRole("button", { name }), name).toHaveAttribute("title", MEMBER_REASON);
    }
    expect(screen.getByRole("textbox", { name: "Prompt template" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "May push fixup commits" })).toHaveAttribute("aria-disabled", "true");
  });
});

describe("keyboard and accessibility", () => {
  it("labels every control in the panel", () => {
    open("implement");

    for (const role of ["textbox", "combobox", "spinbutton", "radio", "switch", "button"] as const) {
      for (const control of within(panel()).getAllByRole(role)) {
        expect(control, `${role} ${control.outerHTML.slice(0, 60)}`).toHaveAccessibleName();
        expect(control).not.toHaveAttribute("tabindex", "-1");
      }
    }
  });

  it("hides the decorative glyph and highlight layer from the accessibility tree", () => {
    const { container } = open("implement");

    expect(container.querySelector(".studio-inspector__highlight")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector(".studio-inspector__type span")).toHaveAttribute("aria-hidden", "true");
  });
});

describe("both themes", () => {
  it("renders identical markup in both palettes, the P9 note included", () => {
    const definition = standardFixDefinition();
    const [light, dark] = renderInBothPalettes(
      <InspectorPanel
        definition={definition}
        entry={stageEntry(definition, "implement")}
        mayAdminister
        onApply={vi.fn()}
        onDelete={vi.fn()}
        readings={inspectorReadings()}
        selection={null}
      />,
    );

    expect(maskIds(light)).toBe(maskIds(dark));
    expect(light).toContain(DECLARED_NOTE);
  });
});
