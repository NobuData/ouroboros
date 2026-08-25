import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { savedRoutes } from "@/app/models/chain";
import {
  CLOSE,
  LABELS_LABEL,
  NO_RULES_MATCHED,
  RUN_SIMULATION,
  SIMULATE_NOTE,
  SIMULATE_TITLE,
  SIMULATING,
  outcomeLabel,
  unsavedNote,
} from "@/app/models/simulation";
import { NO_KINDS_TO_SIMULATE } from "@/app/models/view";

import { FLOOR_BREACHED, failRunExample, resolvedExample, seededTaskKinds } from "../helpers/models";
import { PALETTES, renderInBothPalettes } from "../helpers/palettes";

/**
 * The simulate sheet as it is drawn (#203) — the head's action, the inspector's, and the panel
 * both open.
 *
 * The acceptance criteria this suite exists for: **explanations render verbatim from the API
 * — no client-side story assembly**, and **a dead-primary scenario under a floor shows
 * fail-with-reason as a designed outcome**. What a draft composes to is `simulation.test.ts`'s;
 * what is here is that the dialog drives that composer from its inputs, that what reaches the
 * action is the request and nothing invented, that every sentence in the answer is the
 * fixture's own string, and that a `fail_run` is drawn as the answer it is.
 */

/** What the action answers, per case. */
const simulateRoute = vi.fn();

vi.mock("@/app/models/simulate-actions", () => ({
  simulateRoute: (request: unknown) => simulateRoute(request),
}));
vi.mock("@/app/models/route-actions", () => ({ saveRoutes: vi.fn() }));
vi.mock("@/app/models/rule-actions", () => ({
  readRuleTargets: vi.fn().mockResolvedValue({ ok: true, aliases: [] }),
  setRuleEnabled: vi.fn(),
  addRule: vi.fn(),
  removeRule: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { RouteEditorProvider, useRouteEditor } = await import("@/app/models/route-editor");
const { SimulateButton } = await import("@/app/models/simulate-sheet");

/** The seeded kinds, in the matrix's order. */
const KINDS = seededTaskKinds().map((kind) => kind.name);

/** The seeded routes, for an editor with something to be dirty about. */
const ROUTES = savedRoutes(seededTaskKinds());

/** The editor as the page sees it, so a test can stage an edit. */
let editor: ReturnType<typeof useRouteEditor>;

/**
 * A surface reading the same editor, handing it to the test through a prop — a component may
 * not write a variable outside itself.
 *
 * @param props.report Where the editor goes, each render.
 * @returns Nothing.
 */
function Probe({ report }: Readonly<{ report: (current: ReturnType<typeof useRouteEditor>) => void }>) {
  report(useRouteEditor());
  return null;
}

/**
 * The button and its sheet, under an editor.
 *
 * @param props.kind The route the button opens on, or none for the head's.
 * @param props.kinds The workspace's kinds.
 * @param props.label The button's label.
 * @returns The Testing Library render result.
 */
function button({
  kind,
  kinds = KINDS,
  label,
}: { kind?: string; kinds?: readonly string[]; label?: string } = {}) {
  return render(
    <RouteEditorProvider editable routes={ROUTES}>
      <SimulateButton kind={kind} label={label} taskKinds={kinds} />
      <Probe
        report={(current) => {
          editor = current;
        }}
      />
    </RouteEditorProvider>,
  );
}

/**
 * Open the sheet.
 *
 * @param props See {@link button}.
 * @returns The dialog.
 */
function open(props: Parameters<typeof button>[0] = {}): HTMLElement {
  button(props);
  fireEvent.click(screen.getByRole("button", { name: props.label ?? SIMULATE_TITLE }));
  return screen.getByRole("dialog", { name: SIMULATE_TITLE });
}

/**
 * Ask, and wait for the answer — the resolution's section, or the refusal's alert.
 *
 * @param dialog The dialog.
 */
async function run(dialog: HTMLElement): Promise<void> {
  fireEvent.click(within(dialog).getByRole("button", { name: RUN_SIMULATION }));
  await waitFor(() => {
    expect(
      within(dialog).queryByRole("alert") ?? dialog.querySelector(".models-simulate__answer"),
    ).not.toBeNull();
  });
}

/** Every explanation the fixture carries — the sentences that must appear verbatim. */
function sentences(resolution: ReturnType<typeof resolvedExample>): string[] {
  return [
    ...resolution.chain.map((hop) => hop.explanation),
    ...resolution.rules.map((rule) => rule.explanation),
    resolution.floor.explanation,
    ...(resolution.failure === null ? [] : [resolution.failure.explanation]),
  ];
}

beforeEach(() => {
  simulateRoute.mockReset().mockResolvedValue({ ok: true, resolution: resolvedExample() });
});

describe("opening", () => {
  it("opens from the head on the matrix's first kind, knowing nothing about the work", () => {
    const dialog = open();

    expect(within(dialog).getByText(SIMULATE_NOTE)).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Task kind")).toHaveValue("analyze");
    expect(within(dialog).getByLabelText("Effort")).toHaveValue("");
    expect(within(dialog).getByLabelText(LABELS_LABEL)).toHaveValue("");
    expect(within(dialog).getByLabelText("Diff")).toHaveValue("");
    expect(simulateRoute).not.toHaveBeenCalled();
  });

  it("opens from the inspector on the route it is showing", () => {
    const dialog = open({ kind: "implement", label: "Simulate this route" });

    expect(within(dialog).getByLabelText("Task kind")).toHaveValue("implement");
  });

  it("offers every kind the matrix has, in its order, and every effort and diff the rules grammar admits", () => {
    const dialog = open();

    const kinds = [...within(dialog).getByLabelText("Task kind").querySelectorAll("option")];
    const efforts = [...within(dialog).getByLabelText("Effort").querySelectorAll("option")];
    const diffs = [...within(dialog).getByLabelText("Diff").querySelectorAll("option")];

    expect(kinds.map((option) => option.value)).toEqual(KINDS);
    expect(efforts.map((option) => option.value)).toEqual(["", "xs", "s", "m", "l", "xl"]);
    expect(efforts[0]).toHaveTextContent("Not sized");
    expect(diffs.map((option) => option.value)).toEqual(["", "docs_only"]);
    expect(diffs[0]).toHaveTextContent("Not classified");
  });

  it("is inert with its reason for a workspace with nothing to simulate", () => {
    button({ kinds: [] });

    const trigger = screen.getByRole("button", { name: SIMULATE_TITLE });

    expect(trigger).toHaveAttribute("aria-disabled", "true");
    expect(trigger).toHaveAttribute("title", NO_KINDS_TO_SIMULATE);

    fireEvent.click(trigger);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes on the close button and on Escape", () => {
    const dialog = open();

    fireEvent.click(within(dialog).getByRole("button", { name: CLOSE }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: SIMULATE_TITLE }));
    fireEvent.keyDown(screen.getByRole("dialog", { name: SIMULATE_TITLE }), { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("the question", () => {
  it("sends the task kind and exactly the facts the reader set — no nulls, no defaults", async () => {
    const dialog = open();

    fireEvent.change(within(dialog).getByLabelText("Task kind"), { target: { value: "review" } });
    fireEvent.change(within(dialog).getByLabelText(LABELS_LABEL), { target: { value: "security, bug" } });
    await run(dialog);

    expect(simulateRoute).toHaveBeenCalledExactlyOnceWith({
      taskKind: "review",
      ctx: { labels: ["security", "bug"] },
    });
  });

  it("sends the kind alone when nothing is known", async () => {
    const dialog = open({ kind: "docs" });

    await run(dialog);

    expect(simulateRoute).toHaveBeenCalledExactlyOnceWith({ taskKind: "docs" });
  });

  it("carries an effort and a diff kind as the contract spells them", async () => {
    const dialog = open({ kind: "implement" });

    fireEvent.change(within(dialog).getByLabelText("Effort"), { target: { value: "l" } });
    fireEvent.change(within(dialog).getByLabelText("Diff"), { target: { value: "docs_only" } });
    await run(dialog);

    expect(simulateRoute).toHaveBeenCalledExactlyOnceWith({
      taskKind: "implement",
      ctx: { effort: "l", diffKind: "docs_only" },
    });
  });

  it("says so while the question is on its way, and holds the control inert", () => {
    simulateRoute.mockReturnValue(new Promise(() => {}));
    const dialog = open();

    fireEvent.click(within(dialog).getByRole("button", { name: RUN_SIMULATION }));

    const running = within(dialog).getByRole("button", { name: SIMULATING });

    expect(running).toHaveAttribute("aria-disabled", "true");
  });

  it("gives the control back once the answer has arrived", async () => {
    const dialog = open();

    await run(dialog);

    expect(await within(dialog).findByRole("button", { name: RUN_SIMULATION }, { timeout: 3000 })).not.toHaveAttribute(
      "aria-disabled",
    );
  });
});

describe("the answer — the Z.1 story, verbatim", () => {
  it("prints every explanation the resolution carries, character for character", async () => {
    const dialog = open({ kind: "review" });

    await run(dialog);

    for (const sentence of sentences(resolvedExample())) {
      expect(within(dialog).getByText(sentence), sentence).toBeInTheDocument();
    }
  });

  it("draws the kept chain with each hop's alias, resolution and decision", async () => {
    const dialog = open({ kind: "review" });

    await run(dialog);

    const hops = within(within(dialog).getByRole("list", { name: "Chain" })).getAllByRole("listitem");

    expect(hops).toHaveLength(2);
    expect(hops[0]).toHaveTextContent("coder-max");
    expect(hops[0]).toHaveTextContent("→ claude-fable-5 · Anthropic Claude");
    expect(hops[0]).toHaveTextContent("kept");
    expect(hops[0]).toHaveTextContent("Primary · healthy · 42ms");
    expect(hops[0]).not.toHaveClass("models-simulate__hop--dropped");
  });

  it("draws the rule that matched, the database's sentence, its word and its explanation", async () => {
    const dialog = open({ kind: "review" });

    await run(dialog);

    const [rule] = within(within(dialog).getByRole("list", { name: "Rules that matched" })).getAllByRole("listitem");

    expect(rule).toHaveTextContent("security label → review adds second-opinion vote");
    expect(rule).toHaveTextContent("applied");
    expect(rule).toHaveClass("models-simulate__rule--applied");
  });

  it("draws the second opinion the rule attached, as a requirement rather than a hop", async () => {
    const dialog = open({ kind: "review" });

    await run(dialog);

    const votes = within(dialog).getByRole("list", { name: "Second opinions" });

    expect(votes).toHaveTextContent("second-opinion");
    expect(votes).toHaveTextContent("→ claude-opus-5 · Anthropic Claude");
    expect(within(within(dialog).getByRole("list", { name: "Chain" })).queryByText("second-opinion")).not.toBeInTheDocument();
  });

  it("prints the policy the resolution ran under — the floor's sentence, the cap, the local switch", async () => {
    const dialog = open({ kind: "review" });

    await run(dialog);

    expect(within(dialog).getByText(resolvedExample().floor.explanation)).toBeInTheDocument();
    expect(within(dialog).getByText("no cap")).toBeInTheDocument();
    expect(within(dialog).getByText("allowed")).toBeInTheDocument();
    expect(within(dialog).getByText(outcomeLabel("resolved"))).toBeInTheDocument();
  });

  it("says when no rule matched, rather than leaving a blank section", async () => {
    simulateRoute.mockResolvedValue({ ok: true, resolution: { ...resolvedExample(), rules: [], votes: [] } });
    const dialog = open({ kind: "review" });

    await run(dialog);

    expect(within(dialog).getByText(NO_RULES_MATCHED)).toBeInTheDocument();
    expect(within(dialog).queryByRole("list", { name: "Second opinions" })).not.toBeInTheDocument();
  });

  it("composes nothing: every sentence on the panel is the fixture's, or the panel's own copy", async () => {
    // The whole acceptance criterion, from the other side. A resolution whose explanations are
    // nonsense strings is rendered exactly as nonsense, because nothing here narrates.
    const resolution = resolvedExample();
    const marked = {
      ...resolution,
      chain: resolution.chain.map((hop) => ({ ...hop, explanation: `«hop ${hop.index.toString()}»` })),
      rules: resolution.rules.map((rule) => ({ ...rule, explanation: "«rule»" })),
      floor: { ...resolution.floor, explanation: "«floor»" },
    };
    simulateRoute.mockResolvedValue({ ok: true, resolution: marked });
    const dialog = open({ kind: "review" });

    await run(dialog);

    for (const sentence of ["«hop 1»", "«hop 2»", "«rule»", "«floor»"]) {
      expect(within(dialog).getByText(sentence)).toBeInTheDocument();
    }
    expect(within(dialog).queryByText("Primary · healthy · 42ms")).not.toBeInTheDocument();
  });
});

describe("a fail_run — the dead primary under a floor, as a designed outcome", () => {
  it("draws the outcome in the answer's own place, with the failure's reason first and verbatim", async () => {
    simulateRoute.mockResolvedValue({ ok: true, resolution: failRunExample() });
    const dialog = open({ kind: "implement" });

    await run(dialog);

    expect(within(dialog).getByText(outcomeLabel("fail_run"))).toBeInTheDocument();
    expect(within(dialog).getByRole("status")).toHaveTextContent(FLOOR_BREACHED);
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
    expect(within(dialog).getByText("implement-primary")).toBeInTheDocument();
  });

  it("keeps every dropped hop in the chain, struck through, with the sentence that dropped it", async () => {
    simulateRoute.mockResolvedValue({ ok: true, resolution: failRunExample() });
    const dialog = open({ kind: "implement" });

    await run(dialog);

    const hops = within(within(dialog).getByRole("list", { name: "Chain" })).getAllByRole("listitem");

    expect(hops).toHaveLength(3);
    for (const hop of hops) {
      expect(hop).toHaveClass("models-simulate__hop--dropped");
      expect(hop).toHaveTextContent("dropped");
    }
    expect(hops[0]).toHaveTextContent("Primary dropped — Anthropic Claude is unreachable (503 upstream).");
    expect(hops[1]).toHaveTextContent("Fallback 1 dropped — this route may not degrade below hop 1.");
    expect(hops[2]).toHaveTextContent("Fallback 2 dropped — this route may not degrade below hop 1.");
  });

  it("prints the cap that travels with a refused run — a property of the route, not the outcome", async () => {
    simulateRoute.mockResolvedValue({ ok: true, resolution: failRunExample() });
    const dialog = open({ kind: "implement" });

    await run(dialog);

    expect(within(dialog).getByText("$2.50")).toBeInTheDocument();
  });
});

describe("a refused question", () => {
  it("prints the service's reason as an alert, where the answer would have been, and keeps the inputs", async () => {
    simulateRoute.mockResolvedValue({ ok: false, reason: "This workspace has no route for deploy." });
    const dialog = open();

    await run(dialog);

    expect(within(dialog).getByRole("alert")).toHaveTextContent("This workspace has no route for deploy.");
    expect(within(dialog).queryByRole("list", { name: "Chain" })).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText("Task kind")).toBeInTheDocument();
  });
});

describe("the routes as saved", () => {
  it("says nothing about unsaved edits while there are none", () => {
    const dialog = open();

    expect(within(dialog).queryByText(/routes as saved/)).not.toBeInTheDocument();
  });

  it("tells the reader an unsaved edit is not part of the answer", () => {
    button({ kind: "implement" });

    act(() => {
      editor.move("implement", 0, 1);
    });
    fireEvent.click(screen.getByRole("button", { name: SIMULATE_TITLE }));

    const dialog = screen.getByRole("dialog", { name: SIMULATE_TITLE });

    expect(within(dialog).getByRole("status")).toHaveTextContent(unsavedNote(1));
  });
});

describe("both palettes", () => {
  it("draws the same markup in both", () => {
    const [light, dark] = renderInBothPalettes(
      <RouteEditorProvider editable routes={ROUTES}>
        <SimulateButton taskKinds={KINDS} />
      </RouteEditorProvider>,
    );

    expect(PALETTES).toHaveLength(2);
    expect(light).toBe(dark);
  });
});
