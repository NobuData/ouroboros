import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { InsightsPage, InterventionList } from "@/app/api/insights";
import { RECATEGORIZE_FORBIDDEN } from "@/app/insights/bars-view";
import type { InsightsPollOptions } from "@/app/insights/insights-poll";
import { MODELS_PATH } from "@/app/paths";
import type { PollAnswer } from "@/app/poll";

import {
  barCard,
  insightsReadings,
  seededInsights,
  seededInterventions,
  seededScoreboard,
  seededStages,
} from "../helpers/insights";
import { maskIds, renderInBothPalettes } from "../helpers/palettes";

/**
 * The model scoreboard and the interventions and stage-medians cards (#445) on the insights
 * screen, under its store: the seeded cards, both computed lines passed through and moving with
 * the data, the suggestion band present and absent, the deep link, the low-sample, unpriced, local
 * and fallback rows, the column popovers, re-categorization hidden from a viewer, and the round
 * trip that re-renders the bars and the line.
 */

const replace = vi.fn();
const listCauseEvents = vi.fn();
const recategorizeEvent = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh: vi.fn() }) }));
vi.mock("@/app/insights/intervention-actions", () => ({
  listCauseEvents: (...args: unknown[]) => listCauseEvents(...args),
  recategorizeEvent: (...args: unknown[]) => recategorizeEvent(...args),
}));

const { InsightsScreen } = await import("@/app/insights/insights-screen");

/** What the poll answers; `null` never answers. */
let answer: PollAnswer<InsightsPage> | null = null;

/** A reader answering {@link answer} as it is when asked. */
const POLL: InsightsPollOptions = {
  read: () => (answer === null ? new Promise(() => {}) : Promise.resolve(answer)),
  visible: () => true,
};

const INTERVENTIONS = "Where loops still need humans";
const STAGES = "Cycle time by stage · median";
const SCOREBOARD = "Model scoreboard";

/**
 * Render the screen.
 *
 * @param page The page.
 * @param mayRecategorize Whether the reader is a member or above.
 * @returns The render.
 */
function show(page: InsightsPage = seededInsights(), mayRecategorize = true) {
  return render(<InsightsScreen poll={POLL} readings={insightsReadings(page, page.range, mayRecategorize)} />);
}

/**
 * A card, by its heading.
 *
 * @param name The heading.
 * @returns Its region.
 */
function card(name: string): HTMLElement {
  return screen.getByRole("region", { name });
}

/** The seeded page with the interventions card's bars and line changed. */
function withInterventions(interventions: InsightsPage["hbars"]["interventions"]): InsightsPage {
  const page = seededInsights();

  return { ...page, hbars: { ...page.hbars, interventions } };
}

/** The `infra_rig` bar's one listed event. */
const RIG_EVENTS: InterventionList = {
  range: "30d",
  window: { from: "2026-07-10", to: "2026-08-08" },
  cause: "infra_rig",
  total: 8,
  interventions: [
    {
      id: "5eed005c-0000-4000-8000-000000000482",
      runId: "5eed0009-0000-4000-8000-000000000482",
      source: "waiver",
      sourceRef: "5eed0039-0000-4000-8000-000000000482",
      detectedAt: "2026-08-04T17:49:30.897Z",
      signals: ["class:infra_rig"],
      cause: "infra_rig",
      causeOrigin: "rule",
      ruleId: "infra-rig-classification",
      ruleVersion: 1,
      override: null,
    },
  ],
};

beforeEach(() => {
  replace.mockReset();
  listCauseEvents.mockReset().mockResolvedValue({ ok: true, value: RIG_EVENTS });
  recategorizeEvent.mockReset();
  answer = null;
});

describe("the interventions card", () => {
  it("draws the seeded card: tag, ranked bars and the service's computed line", () => {
    show();
    const region = card(INTERVENTIONS);

    expect(within(region).getByText("30d · 20 total")).toHaveClass("ou-tag");
    expect(
      within(region).getByRole("img", {
        name: "Interventions by cause, 20 total: Flaky env / rig 8, Ambiguous ticket 5, Policy gate 4, Model disagreement 2, Other 1",
      }),
    ).toBeInTheDocument();
    expect(region.querySelector(".chart-hbar--top")).toHaveTextContent("Flaky env / rig");
    expect(region.querySelectorAll(".chart-hbar--dim")).toHaveLength(2);
    expect(region.querySelector(".insights-series__foot")).toHaveTextContent(
      "Fix the top row and interventions drop ~40%.",
    );
  });

  it("changes its sentence when the data changes — the line is computed, not copy", () => {
    show(
      withInterventions(
        barCard(
          [
            ["ambiguous_ticket", "Ambiguous ticket", 3],
            ["infra_rig", "Flaky env / rig", 1],
          ],
          { line: "Fix the top row and interventions drop ~75%." },
        ),
      ),
    );
    const region = card(INTERVENTIONS);

    expect(within(region).getByText("30d · 4 total")).toBeInTheDocument();
    expect(region.querySelector(".insights-series__foot")).toHaveTextContent("~75%");
    expect(region).not.toHaveTextContent("~40%");
  });

  it("is a designed empty state over a quiet range, with no line", () => {
    show(withInterventions(barCard([])));
    const region = card(INTERVENTIONS);

    expect(within(region).getByText("No loop needed a human in this range")).toBeInTheDocument();
    expect(region.querySelector(".insights-series__foot")).toBeNull();
    expect(within(region).queryByRole("button", { name: "Re-categorize…" })).toBeNull();
  });

  it("offers no re-categorization to a viewer", () => {
    show(seededInsights(), false);

    expect(within(card(INTERVENTIONS)).queryByRole("button", { name: "Re-categorize…" })).toBeNull();
    expect(listCauseEvents).not.toHaveBeenCalled();
  });

  it("round-trips a re-categorization: the bars and the computed line re-render", async () => {
    show();
    const region = card(INTERVENTIONS);
    const toggle = within(region).getByRole("button", { name: "Re-categorize…" });

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await waitFor(() => expect(listCauseEvents).toHaveBeenCalledWith("30d", "infra_rig"));

    const event = await within(region).findByLabelText("Intervention");
    expect(event).toHaveDisplayValue("Waiver · Aug 4");

    fireEvent.change(within(region).getByLabelText("Move it to"), { target: { value: "ambiguous_ticket" } });
    fireEvent.change(within(region).getByLabelText(/^Why/), { target: { value: "The ticket never named the board." } });

    // What the service counts once the correction is in: one fewer rig, one more ambiguous ticket.
    const moved = withInterventions(
      barCard(
        [
          ["infra_rig", "Flaky env / rig", 7],
          ["ambiguous_ticket", "Ambiguous ticket", 6],
          ["policy_gate", "Policy gate", 4],
          ["model_disagreement", "Model disagreement", 2],
          ["other", "Other", 1],
        ],
        { line: "Fix the top row and interventions drop ~35%." },
      ),
    );
    recategorizeEvent.mockImplementation(() => {
      answer = { state: "fresh", payload: moved, etag: null, pollAfterSeconds: null };
      return Promise.resolve({ ok: true, value: { ...RIG_EVENTS.interventions[0], cause: "ambiguous_ticket" } });
    });

    fireEvent.click(within(region).getByRole("button", { name: "Re-categorize" }));

    await waitFor(() =>
      expect(region.querySelector(".insights-series__foot")).toHaveTextContent(
        "Fix the top row and interventions drop ~35%.",
      ),
    );
    expect(recategorizeEvent).toHaveBeenCalledWith(
      RIG_EVENTS.interventions[0]!.id,
      "ambiguous_ticket",
      "The ticket never named the board.",
    );
    expect(within(region).getByRole("img")).toHaveAccessibleName(/Flaky env \/ rig 7, Ambiguous ticket 6/);
    expect(within(region).getByRole("status")).toHaveTextContent("Moved to Ambiguous ticket.");
  });

  it("says why when the service refuses the write, and changes nothing", async () => {
    recategorizeEvent.mockResolvedValue({ ok: false, reason: RECATEGORIZE_FORBIDDEN });
    show();
    const region = card(INTERVENTIONS);

    fireEvent.click(within(region).getByRole("button", { name: "Re-categorize…" }));
    await within(region).findByLabelText("Intervention");
    fireEvent.change(within(region).getByLabelText("Move it to"), { target: { value: "other" } });
    fireEvent.change(within(region).getByLabelText(/^Why/), { target: { value: "Because." } });
    fireEvent.click(within(region).getByRole("button", { name: "Re-categorize" }));

    await waitFor(() => expect(within(region).getByRole("status")).toHaveTextContent(RECATEGORIZE_FORBIDDEN));
    expect(region.querySelector(".insights-series__foot")).toHaveTextContent("~40%");
  });

  it("holds the submit inert, saying what is missing, until a cause and a reason are given", async () => {
    show();
    const region = card(INTERVENTIONS);

    fireEvent.click(within(region).getByRole("button", { name: "Re-categorize…" }));
    await within(region).findByLabelText("Intervention");
    const submit = within(region).getByRole("button", { name: "Re-categorize" });

    expect(submit).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(submit);
    expect(recategorizeEvent).not.toHaveBeenCalled();
  });
});

describe("the stage-medians card", () => {
  it("draws the seeded card with Implement dominant and the service's sum line", () => {
    show();
    const region = card(STAGES);

    expect(within(region).getByText("30d")).toHaveClass("ou-tag");
    expect(region.querySelector(".chart-hbar--top")).toHaveTextContent("Implement6m 04s");
    expect(region.querySelectorAll(".chart-hbar--dim")).toHaveLength(5);
    expect(region.querySelector(".insights-series__foot")).toHaveTextContent(
      "Implement dominates the loop — the other five stages sum to 8m 20s.",
    );
  });

  it("changes its sentence when the data changes", () => {
    const page = seededInsights();
    show({
      ...page,
      hbars: {
        ...page.hbars,
        stages: { ...seededStages(), line: "Test dominates the loop — the other five stages sum to 9m 10s." },
      },
    });

    expect(card(STAGES).querySelector(".insights-series__foot")).toHaveTextContent("9m 10s");
  });
});

describe("the model scoreboard", () => {
  it("draws the seeded rows inside the table's own scroll wrapper, with the routing link", () => {
    show();
    const region = card(SCOREBOARD);
    const rows = within(region).getAllByRole("row").slice(1);

    expect(region.querySelector(".ou-table-scroll table")).not.toBeNull();
    expect(within(region).getByRole("link", { name: "Routing rules →" })).toHaveAttribute("href", MODELS_PATH);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent("implement");
    expect(rows[0]).toHaveTextContent("claude-fable-5");
    expect(rows[0]).toHaveTextContent("84%");
    expect(rows[0]).toHaveTextContent("$0.87");
  });

  it("annotates the fallback with its hop role", () => {
    show();
    const [, fallback] = within(card(SCOREBOARD)).getAllByRole("row").slice(1);

    expect(fallback).toHaveTextContent("implement(fallback · hop 2)");
  });

  it("shows $0.00 for the local model, tokens for the unpriced row, and badges the thin one", () => {
    show();
    const [, , local, thin] = within(card(SCOREBOARD)).getAllByRole("row").slice(1);

    expect(local).toHaveTextContent("$0.00");
    expect(thin).toHaveTextContent("41.2k tok");
    expect(thin).not.toHaveTextContent("$");
    expect(within(thin!).getByText("low sample")).toHaveClass("ou-chip--warn");
    expect(local).not.toHaveTextContent("low sample");
  });

  it("colours the trend by goodness, and names it in words", () => {
    show();
    const [primary, fallback, local] = within(card(SCOREBOARD)).getAllByRole("row").slice(1);

    expect(primary!.querySelector(".insights-board__trend")).toHaveClass("insights-board__trend--good");
    expect(fallback!.querySelector(".insights-board__trend")).toHaveClass("insights-board__trend--bad");
    expect(local!.querySelector(".insights-board__trend")).toHaveClass("insights-board__trend--none");
    expect(fallback).toHaveTextContent("Down 5pts on the prior range");
  });

  it("states the untouched definition and the $ / success denominator in the column popovers", () => {
    show();
    const region = card(SCOREBOARD);

    expect(within(region).getByRole("button", { name: "Merge-untouched %" })).toHaveAccessibleDescription(
      /no human-authored pushes/,
    );
    expect(within(region).getByRole("button", { name: "$ / success" })).toHaveAccessibleDescription(
      /divided by its merged PRs/,
    );
  });

  it("has no suggestion band without AB.3's payload", () => {
    show();
    const region = card(SCOREBOARD);

    expect(region.querySelector("[data-suggestion]")).toBeNull();
    expect(within(region).queryByRole("link", { name: "Apply in Models →" })).toBeNull();
  });

  it("renders AB.3's suggestion with its saving and a deep link to the task's route", () => {
    show(
      seededInsights({
        scoreboard: seededScoreboard({
          suggestion: {
            claim: "fable stays primary; consider dropping fallback to ollama/qwen3-coder for XS issues",
            monthlySavingCents: 1400,
            taskKind: "implement",
          },
        }),
      }),
    );
    const region = card(SCOREBOARD);

    expect(region.querySelector("[data-suggestion]")).toHaveTextContent(
      "fable stays primary; consider dropping fallback to ollama/qwen3-coder for XS issues (would save ~$14/mo)",
    );
    expect(within(region).getByRole("link", { name: "Apply in Models →" })).toHaveAttribute(
      "href",
      `${MODELS_PATH}?route=implement`,
    );
  });

  it("is a designed empty state over a range with nothing merged", () => {
    show(seededInsights({ scoreboard: seededScoreboard({ rows: [] }) }));

    expect(within(card(SCOREBOARD)).getByText("No loop merged in this range")).toBeInTheDocument();
  });
});

describe("all three cards", () => {
  it("hold their places with skeletons before anything is read", () => {
    render(<InsightsScreen poll={POLL} readings={insightsReadings(null)} />);

    for (const name of [INTERVENTIONS, STAGES, SCOREBOARD]) {
      expect(card(name)).toHaveAttribute("aria-busy", "true");
    }
  });

  it("render the same markup in both palettes — colour is the tokens' alone", () => {
    const [light, dark] = renderInBothPalettes(<InsightsScreen poll={POLL} readings={insightsReadings()} />);

    expect(maskIds(light!)).toBe(maskIds(dark!));
  });

  it("re-render for a new range", async () => {
    show();
    const week = seededInsights({
      range: "7d",
      hbars: { ...seededInsights().hbars, interventions: { ...seededInterventions(), total: 5 } },
      scoreboard: seededScoreboard({ range: "7d" }),
    });

    answer = { state: "fresh", payload: week, etag: null, pollAfterSeconds: null };
    fireEvent.click(screen.getByRole("button", { name: "7d" }));

    await waitFor(() => expect(within(card(INTERVENTIONS)).getByText("7d · 5 total")).toBeInTheDocument());
    expect(within(card(STAGES)).getByText("7d")).toBeInTheDocument();
  });
});
