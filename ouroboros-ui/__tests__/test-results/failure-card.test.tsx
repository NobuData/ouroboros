import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { CaseHint, TestCaseFailureDetail } from "@/app/api/test-results";
import {
  AI_SLOT_BODY,
  AI_SLOT_TITLE,
  AI_TRIAGE_EYEBROW,
  FAILURE_STALE_HEADLINE,
  FAILURE_TITLE,
  FAILURE_UNREAD_HEADLINE,
  type FailureScope,
  HEURISTIC_CHIP,
  LOG_LABEL,
  NEXT_FAILURE,
  NO_FAILURES,
  NO_HINT,
  NO_LOG,
  PAGER_LABEL,
  PATH_LABEL,
  PREVIOUS_FAILURE,
  READING_FAILURE,
  READING_FAILURES,
  READING_HINT,
  TRIAGE_EYEBROW,
  type TriageView,
  caseTriage,
  failureScope,
} from "@/app/test-results/failure";
import { FailureCard } from "@/app/test-results/failure-card";

import {
  FLAKY_CASE,
  MODEL_NAME,
  MODEL_NARRATIVE,
  OVERSHOOT_CASE,
  OVERSHOOT_LOG,
  OVERSHOOT_MESSAGE,
  OVERSHOOT_PATH,
  OVERSHOOT_REASON,
  caseFailure,
  caseHint,
  modelHint,
  seededSuites,
} from "../helpers/test-results";

/**
 * The failure-detail card, drawn (#339): mockup 11's head, path and log, the pager, and the
 * triage section — where no confidence and no model pill can be drawn for a heuristic actor.
 */

/** The attempt's two failures. */
const BOTH = failureScope(seededSuites(), null, null, 3);

/** The overshoot failure alone — the mockup's `1 of 1`. */
const ONE: FailureScope = { entries: [BOTH.entries[1]!], note: null };

/**
 * Draw the card.
 *
 * @param options The scope, the bound index, the failure, its error and the triage section.
 * @returns What `onPage` and `onRetry` were called with.
 */
function draw(
  options: {
    scope?: FailureScope | null;
    index?: number;
    failure?: TestCaseFailureDetail | null;
    error?: string | null;
    triage?: TriageView;
  } = {},
) {
  const onPage = vi.fn();
  const onRetry = vi.fn();
  const scope = options.scope === undefined ? ONE : options.scope;

  render(
    <FailureCard
      build="build 3"
      error={options.error ?? null}
      failure={options.failure === undefined ? caseFailure() : options.failure}
      index={options.index ?? (scope === null || scope.entries.length === 0 ? -1 : 0)}
      onPage={onPage}
      onRetry={onRetry}
      scope={scope}
      triage={options.triage ?? caseTriage(caseHint())}
    />,
  );

  return { onPage, onRetry };
}

/** The card. */
function card() {
  return within(screen.getByRole("region", { name: FAILURE_TITLE }));
}

/** The card's element. */
function region(): HTMLElement {
  return screen.getByRole("region", { name: FAILURE_TITLE });
}

/** The triage section. */
function triage(name: string = TRIAGE_EYEBROW): HTMLElement {
  return card().getByRole("region", { name });
}

describe("the seeded card", () => {
  it("draws the mockup's head: the title, 1 of 1 and the build's tag", () => {
    draw();

    expect(card().getByRole("heading", { name: FAILURE_TITLE })).toBeInTheDocument();
    expect(card().getByRole("img", { name: "Failure 1 of 1" })).toHaveTextContent("1 of 1");
    expect(card().getByText("build 3")).toBeInTheDocument();
    expect(card().queryByRole("group", { name: PAGER_LABEL })).toBeNull();
  });

  it("draws the test's path on one line", () => {
    draw();

    expect(card().getByRole("group", { name: PATH_LABEL })).toHaveTextContent(
      `${OVERSHOOT_PATH}::overshoot_under_load`,
    );
  });

  it("draws the log as it came, whitespace kept, the assertion alone in the err tone", () => {
    draw();

    const log = card().getByRole("group", { name: LOG_LABEL });

    expect(log.tagName).toBe("PRE");
    expect(log.textContent).toBe(`${OVERSHOOT_LOG}\n`);
    expect([...log.querySelectorAll('[data-tone="err"]')].map((line) => line.textContent)).toEqual([
      `E   ${OVERSHOOT_MESSAGE}\n`,
    ]);
    expect([...log.querySelectorAll(".tests-failure__figure")].map((figure) => figure.textContent)).toEqual([
      "2.1%",
      "2.4%",
      "2.3%",
    ]);
  });

  it("draws markup in a log as characters, never as elements", () => {
    draw({ failure: caseFailure({ logExcerpt: '<img src=x onerror="alert(1)"> <b>bold</b>', message: null }) });

    const log = card().getByRole("group", { name: LOG_LABEL });

    expect(log.textContent).toContain('<img src=x onerror="alert(1)"> <b>bold</b>');
    expect(log.querySelector("img, b")).toBeNull();
  });

  it("lets the keyboard reach the path and the log, to scroll them", () => {
    draw();

    expect(card().getByRole("group", { name: PATH_LABEL })).toHaveAttribute("tabindex", "0");
    expect(card().getByRole("group", { name: LOG_LABEL })).toHaveAttribute("tabindex", "0");
  });

  it("draws a very long path whole, in the wrapper that scrolls it", () => {
    const long = `tests/${"deeply/nested/".repeat(40)}test_estop_release.py`;

    draw({ failure: caseFailure({ path: long }) });

    const path = card().getByRole("group", { name: PATH_LABEL });

    expect(path).toHaveTextContent(`${long}::overshoot_under_load`);
    expect(path).toHaveClass("tests-failure__path");
  });

  it("says a failure carried no log", () => {
    draw({ failure: caseFailure({ logExcerpt: null, message: null }) });

    expect(card().getByText(NO_LOG)).toBeInTheDocument();
    expect(card().queryByRole("group", { name: LOG_LABEL })).toBeNull();
  });
});

describe("the triage section, while the actor is heuristic", () => {
  it("draws the hint's rule, its heuristic chip and why it fired", () => {
    draw();

    const section = within(triage());

    expect(triage()).toHaveAttribute("data-actor", "heuristic");
    expect(section.getByText(HEURISTIC_CHIP)).toBeInTheDocument();
    expect(section.getByText("rule: new failure ∩ diff-path overlap → product bug")).toBeInTheDocument();
    expect(section.getByText(OVERSHOOT_REASON)).toBeInTheDocument();
  });

  it("draws the designed slot beside it — a statement, not a spinner", () => {
    draw();

    const section = within(triage());

    expect(section.getByText(AI_SLOT_TITLE)).toBeInTheDocument();
    expect(section.getByText(AI_SLOT_BODY)).toBeInTheDocument();
    expect(section.queryByRole("progressbar")).toBeNull();
    expect(section.queryByRole("status")).toBeNull();
  });

  it.each<[string, CaseHint]>([
    ["the seeded hint", caseHint()],
    [
      "a hint carrying a confidence it must not",
      { ...caseHint(), hint: { ...caseHint().hint!, confidence: 84 } } as unknown as CaseHint,
    ],
    [
      "a heuristic answer carrying a model's fields",
      {
        ...caseHint(),
        triage: {
          ...modelHint().triage!,
          provenance: { contract: "triage/v0", actor: "heuristic", rule_id: "product.new_failure_in_diff", model: MODEL_NAME },
        },
      },
    ],
    ["an answer that names no actor", { ...caseHint(), triage: { ...modelHint().triage!, provenance: {} } } as unknown as CaseHint],
    ["no hint at all", caseHint({ hint: null, triage: null })],
  ])("draws no confidence percentage and no model pill for %s", (_name, entry) => {
    draw({ triage: caseTriage(entry) });

    expect(region().querySelector('[data-actor="model"]')).toBeNull();
    expect(region().querySelector(".ou-chip--model")).toBeNull();
    expect(region().querySelector(".tests-failure__confidence")).toBeNull();
    expect(region().querySelector(".tests-failure__narrative")).toBeNull();
    expect(triage().textContent).not.toMatch(/\d\s*%/);
    expect(triage().textContent).not.toMatch(/confidence \d/i);
    expect(triage().textContent).not.toContain(MODEL_NAME);
    expect(triage().textContent).not.toContain(MODEL_NARRATIVE);
    expect(card().queryByRole("region", { name: AI_TRIAGE_EYEBROW })).toBeNull();
    expect(within(triage()).getByText(AI_SLOT_TITLE)).toBeInTheDocument();
  });

  it("says no rule fired, above the slot", () => {
    draw({ triage: { kind: "none" } });

    expect(within(triage()).getByText(NO_HINT)).toBeInTheDocument();
    expect(within(triage()).queryByText(HEURISTIC_CHIP)).toBeNull();
    expect(within(triage()).getByText(AI_SLOT_TITLE)).toBeInTheDocument();
  });

  it("says it is reading the hint, or why it could not", () => {
    draw({ triage: { kind: "reading" } });
    expect(within(triage()).getByText(READING_HINT)).toBeInTheDocument();
  });

  it("says why the hint could not be read", () => {
    draw({ triage: { kind: "unread", reason: "The triage hint could not be reached." } });

    expect(within(triage()).getByText("The triage hint could not be reached.")).toBeInTheDocument();
    expect(within(triage()).getByText(AI_SLOT_TITLE)).toBeInTheDocument();
  });
});

describe("the triage section, once the actor is a model (#343)", () => {
  it("draws the narrative, the model pill and the confidence, and no empty slot", () => {
    draw({ triage: caseTriage(modelHint()) });

    const section = within(triage(AI_TRIAGE_EYEBROW));

    expect(triage(AI_TRIAGE_EYEBROW)).toHaveAttribute("data-actor", "model");
    expect(section.getByText(MODEL_NARRATIVE)).toBeInTheDocument();
    expect(section.getByText(MODEL_NAME)).toHaveClass("ou-chip--model");
    expect(section.getByText("confidence 84%")).toBeInTheDocument();
    expect(section.queryByText(AI_SLOT_TITLE)).toBeNull();
    expect(section.queryByText(HEURISTIC_CHIP)).toBeNull();
  });

  it("omits a pill or a confidence the answer did not carry", () => {
    draw({
      triage: caseTriage(
        modelHint({ confidence: null, provenance: { contract: "triage/v0", actor: "model", rule_id: null, model: null } }),
      ),
    });

    expect(within(triage(AI_TRIAGE_EYEBROW)).getByText(MODEL_NARRATIVE)).toBeInTheDocument();
    expect(region().querySelector(".ou-chip--model")).toBeNull();
    expect(region().querySelector(".tests-failure__confidence")).toBeNull();
  });
});

describe("the pager", () => {
  it("counts the failures in scope and offers its two buttons", () => {
    draw({ scope: BOTH, index: 0, failure: caseFailure({ caseId: FLAKY_CASE.caseId }) });

    const pager = within(card().getByRole("group", { name: PAGER_LABEL }));

    expect(pager.getByRole("img", { name: "Failure 1 of 2" })).toBeInTheDocument();
    expect(pager.getByRole("button", { name: PREVIOUS_FAILURE })).toHaveAttribute("aria-disabled", "true");
    expect(pager.getByRole("button", { name: NEXT_FAILURE })).toHaveAttribute("aria-disabled", "false");
  });

  it("pages to the next failure on a press, and does nothing at an end", () => {
    const { onPage } = draw({ scope: BOTH, index: 0 });

    fireEvent.click(card().getByRole("button", { name: PREVIOUS_FAILURE }));
    expect(onPage).not.toHaveBeenCalled();

    fireEvent.click(card().getByRole("button", { name: NEXT_FAILURE }));
    expect(onPage).toHaveBeenCalledWith(OVERSHOOT_CASE.caseId);
  });

  it("moves with the arrow keys, Home and End, from either button", () => {
    const { onPage } = draw({ scope: BOTH, index: 1 });
    const next = card().getByRole("button", { name: NEXT_FAILURE });

    fireEvent.keyDown(next, { key: "ArrowRight" });
    expect(onPage).not.toHaveBeenCalled();

    fireEvent.keyDown(next, { key: "ArrowLeft" });
    expect(onPage).toHaveBeenLastCalledWith(FLAKY_CASE.caseId);

    fireEvent.keyDown(card().getByRole("button", { name: PREVIOUS_FAILURE }), { key: "Home" });
    expect(onPage).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(next, { key: "a" });
    expect(onPage).toHaveBeenCalledTimes(2);
  });

  it("keeps its buttons in the tab order at an end, so the pager keeps its focus", () => {
    draw({ scope: BOTH, index: 1 });

    const next = card().getByRole("button", { name: NEXT_FAILURE });

    expect(next).not.toBeDisabled();
    next.focus();
    expect(next).toHaveFocus();
  });
});

describe("before there is a failure to draw", () => {
  it("says it is reading while the attempt's page has not been read", () => {
    draw({ scope: null, failure: null });

    expect(card().getByText(READING_FAILURES)).toBeInTheDocument();
    expect(card().queryByRole("region")).toBeNull();
    expect(card().getByText("build 3")).toBeInTheDocument();
  });

  it("says the scope's note, and draws no pager, path, log or triage", () => {
    draw({ scope: { entries: [], note: NO_FAILURES }, failure: null });

    expect(card().getByText(NO_FAILURES)).toBeInTheDocument();
    expect(card().queryByRole("img")).toBeNull();
    expect(card().queryByRole("group")).toBeNull();
    expect(card().queryByText(AI_SLOT_TITLE)).toBeNull();
  });

  it("says it is reading the failure, with the triage already drawn", () => {
    draw({ failure: null });

    expect(card().getByRole("status")).toHaveTextContent(READING_FAILURE);
    expect(within(triage()).getByText(HEURISTIC_CHIP)).toBeInTheDocument();
  });

  it("says why a failure could not be read, and offers a retry", () => {
    const { onRetry } = draw({ failure: null, error: "No such case." });

    expect(card().getByText(FAILURE_UNREAD_HEADLINE)).toBeInTheDocument();
    expect(card().getByText("No such case.")).toBeInTheDocument();

    fireEvent.click(card().getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("keeps the last failure on the card under a banner when a refresh failed", () => {
    draw({ error: "The failure could not be reached." });

    expect(card().getByText(FAILURE_STALE_HEADLINE)).toBeInTheDocument();
    expect(card().getByRole("group", { name: LOG_LABEL })).toBeInTheDocument();
  });
});
