import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TestRunHints, TestRunPage, TestRunTimeline } from "@/app/api/test-results";
import type { PollAnswer } from "@/app/poll";
import { DASHBOARD_ORIGIN } from "@/app/runs/origin";
import { FAILURE_TITLE, NEXT_FAILURE, PATH_LABEL } from "@/app/test-results/failure";
import {
  KEEP_DECISION_LABEL,
  MARK_ROUTE_TITLE,
  NOTE_LABEL,
  NOTE_REQUIRED,
  NOTHING_TO_CLASSIFY,
  READING_TARGET,
  RECEIPT_LABEL,
  RECLASSIFY_LABEL,
  STAGED_LABEL,
  VIEWER_NOTE,
  WAIVE_LABEL,
} from "@/app/test-results/mark-route";
import {
  WAIVE_CANCEL,
  WAIVE_CONFIRM,
  WAIVE_CONSEQUENCE,
  WAIVE_DEFERRED,
  WAIVE_NEEDS_REASON,
  WAIVE_REASON_LABEL,
  WAIVE_TITLE,
} from "@/app/test-results/mark-route-decision";
import type {
  ClassifySender,
  IntentSender,
  WaiveSender,
} from "@/app/test-results/mark-route-panel";
import type { TestsPollOptions } from "@/app/test-results/poll";
import { SUITES_TITLE } from "@/app/test-results/suites";
import { TestsScreen } from "@/app/test-results/tests-screen";
import { TIMELINE_TITLE } from "@/app/test-results/timeline";
import { ACTIONS_LABEL } from "@/app/test-results/view";

import { SEEDED_RUN_ID } from "../helpers/runs";
import {
  BUILD_3_ID,
  COLLEAGUE_ID,
  CONTROL_ID,
  CORRECTION_NOTE,
  DECIDER_ID,
  FLAKY_CASE,
  OVERSHOOT_CASE,
  PEOPLE,
  classification,
  classifyResult,
  gate,
  hints,
  intents,
  mockupAttempts,
  page,
  strip,
  timeline,
  waiver,
} from "../helpers/test-results";

/**
 * Mark & Route on the test-results screen (#340): the card decides the failure the failure-detail
 * card shows, a decision is sent once and answered with a receipt, the toggles are stored when
 * pressed, a waiver is asked its reason first, and nobody is offered what the service would
 * refuse them.
 */

// The Server Actions are never reached here: every case passes its own senders.
vi.mock("@/app/test-results/rerun-actions", () => ({ requestRerun: vi.fn() }));
vi.mock("@/app/test-results/mark-route-actions", () => ({
  classifyFailure: vi.fn(),
  waiveFailure: vi.fn(),
  setRunIntent: vi.fn(),
}));

/** The rig's suite, by name. */
const RIG_SUITE = "PHYSICAL · HIL rig";

/** A poll that never answers — the page shows the server's first read. */
function quiet<T>(): TestsPollOptions<T> {
  return { read: () => new Promise(() => {}), visible: () => true };
}

/**
 * A poll that answers one value, fresh, and counts how often it was asked.
 *
 * @param payload What it answers.
 * @returns The poll's options, and its read to be asked how often it was called.
 */
function answering<T>(payload: T) {
  const answer: PollAnswer<T> = { state: "fresh", payload, etag: null, pollAfterSeconds: null };
  const read = vi.fn(() => Promise.resolve(answer));

  return { options: { read, visible: () => true } satisfies TestsPollOptions<T>, read };
}

/** What a case may pass the screen. */
interface Drawn {
  readonly initial?: TestRunTimeline;
  readonly initialPage?: TestRunPage | null;
  readonly initialSuite?: string | null;
  readonly hints?: TestRunHints;
  readonly mayContribute?: boolean;
  readonly mayWaive?: boolean;
  readonly nextAttempt?: number | null;
  readonly classify?: ClassifySender;
  readonly waive?: WaiveSender;
  readonly setIntent?: IntentSender;
  readonly pagePoll?: TestsPollOptions<TestRunPage>;
  readonly timelinePoll?: TestsPollOptions<TestRunTimeline>;
}

/**
 * Draw the screen with the rig's suite selected, so the failure on both cards is the overshoot.
 *
 * @param options What to change.
 * @returns The Testing Library render result.
 */
function draw(options: Drawn = {}) {
  window.history.replaceState(null, "", `/runs/${SEEDED_RUN_ID}/tests`);

  return render(
    <TestsScreen
      classify={options.classify}
      failurePoll={quiet()}
      farmPoll={quiet()}
      gatePoll={quiet()}
      hintsPoll={answering(options.hints ?? hints()).options}
      initial={options.initial ?? timeline()}
      initialAttempt={null}
      initialError={null}
      initialGate={gate()}
      initialPage={options.initialPage === undefined ? page() : options.initialPage}
      initialSuite={options.initialSuite === undefined ? RIG_SUITE : options.initialSuite}
      mayContribute={options.mayContribute ?? true}
      mayWaive={options.mayWaive ?? false}
      nextAttempt={options.nextAttempt === undefined ? 4 : options.nextAttempt}
      origin={DASHBOARD_ORIGIN}
      pagePoll={options.pagePoll ?? quiet()}
      people={PEOPLE}
      readerId={DECIDER_ID}
      runId={SEEDED_RUN_ID}
      setIntent={options.setIntent}
      timelinePoll={options.timelinePoll ?? quiet()}
      trackerUrl={null}
      waive={options.waive}
    />,
  );
}

/** The Mark & Route card. */
function card() {
  return within(screen.getByRole("region", { name: MARK_ROUTE_TITLE }));
}

/** The failure-detail card. */
function failure() {
  return within(screen.getByRole("region", { name: FAILURE_TITLE }));
}

/** The note. */
function note(): HTMLTextAreaElement {
  return card().getByRole("textbox", { name: NOTE_LABEL });
}

/** The primary action. */
function primary(name: RegExp | string = /^Queue correction round/): HTMLElement {
  return card().getByRole("button", { name });
}

/** The radio that is checked, by its value — or `null`. */
function checked(): string | null {
  const on = card()
    .queryAllByRole("radio")
    .find((radio) => (radio as HTMLInputElement).checked);

  return on === undefined ? null : (on as HTMLInputElement).value;
}

/** Let the polls' answers and a press's answer land. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("which failure the card decides", () => {
  it("is the one on the failure-detail card, named in its head", async () => {
    draw();
    await settle();

    expect(card().getByText(OVERSHOOT_CASE.name)).toBeInTheDocument();
    expect(failure().getByRole("img", { name: "Failure 1 of 1" })).toBeInTheDocument();
  });

  it("follows the failure card's pager", async () => {
    draw({ initialSuite: null });
    await settle();

    // Nothing selected: both of the build's failures are in scope, the flaky one first.
    expect(card().getByText(FLAKY_CASE.name)).toBeInTheDocument();

    fireEvent.click(failure().getByRole("button", { name: NEXT_FAILURE }));

    expect(card().getByText(OVERSHOOT_CASE.name)).toBeInTheDocument();
    expect(card().queryByText(FLAKY_CASE.name)).toBeNull();
  });

  it("pre-selects the hint's class for the failure it is bound to, and nothing for one without a hint", async () => {
    draw({ initialSuite: null });
    await settle();

    // The flaky case has no hint in the seed.
    expect(checked()).toBeNull();

    fireEvent.click(failure().getByRole("button", { name: NEXT_FAILURE }));

    expect(checked()).toBe("product_bug");
    expect(card().getByText("heuristic · new failure ∩ diff-path overlap")).toBeInTheDocument();
  });

  it("says it is reading until the attempt's page has been read", () => {
    draw({ initialPage: null });

    expect(card().getByText(READING_TARGET)).toBeInTheDocument();
    expect(card().queryByRole("radio")).toBeNull();
  });

  it("says there is nothing to classify in a build where nothing failed", () => {
    const green = page({
      suites: page().suites.map((suite) => ({
        ...suite,
        cases: suite.cases.map((each) => ({
          ...each,
          status: "passed" as const,
          hasFailure: false,
        })),
      })),
    });
    draw({ initialPage: green, initialSuite: null });

    expect(card().getByText(NOTHING_TO_CLASSIFY)).toBeInTheDocument();
    expect(card().queryByRole("radio")).toBeNull();
  });

  it("keeps what was typed for a failure while another is on the card", async () => {
    draw({ initialSuite: null });
    await settle();

    fireEvent.change(note(), { target: { value: "ring buffer drains late under load" } });
    fireEvent.click(failure().getByRole("button", { name: NEXT_FAILURE }));

    expect(note()).toHaveValue("");

    fireEvent.change(note(), { target: { value: CORRECTION_NOTE } });
    fireEvent.click(failure().getByRole("button", { name: "Previous failure" }));

    expect(note()).toHaveValue("ring buffer drains late under load");
  });
});

describe("a suggestion the page serves — the seed's heuristic precursor", () => {
  /** Build 3's page as the seed has it: the overshoot carries a rule's classification. */
  function suggested(): TestRunPage {
    return page({
      classifications: [
        classification({
          actor: "heuristic",
          ruleId: "hil.limit_exceeded",
          note: null,
          routed: null,
          createdBy: null,
        }),
      ],
    });
  }

  it("is a pre-selected radio with its affix — never a recorded decision", async () => {
    draw({ initialPage: suggested(), hints: hints([]) });
    await settle();

    expect(checked()).toBe("product_bug");
    expect(card().getByText("heuristic · hil.limit_exceeded")).toBeInTheDocument();
    expect(card().queryByRole("button", { name: RECLASSIFY_LABEL })).toBeNull();
    expect(card().queryByRole("group", { name: RECEIPT_LABEL })).toBeNull();
    expect(screen.getByRole("region", { name: MARK_ROUTE_TITLE }).textContent).not.toMatch(
      /\d\s*%/,
    );
  });

  it("is replaced by the person's decision, which supersedes nothing a person made", async () => {
    const classify = vi.fn<ClassifySender>().mockResolvedValue({
      ok: true,
      result: classifyResult(),
    });
    draw({ initialPage: suggested(), hints: hints([]), classify });
    await settle();

    fireEvent.change(note(), { target: { value: CORRECTION_NOTE } });
    fireEvent.click(primary());
    await settle();

    expect(card().getByText(/by you/)).toBeInTheDocument();
    expect(card().queryByText(/^Replaced:/)).toBeNull();
  });
});

describe("classify → route", () => {
  it("cannot queue a correction round without a note", async () => {
    const classify = vi.fn<ClassifySender>();
    draw({ classify });
    await settle();

    expect(primary()).toHaveAttribute("aria-disabled", "true");
    expect(primary()).toHaveAttribute("title", NOTE_REQUIRED);

    fireEvent.click(primary());
    fireEvent.change(note(), { target: { value: "   " } });
    fireEvent.click(primary());

    expect(classify).not.toHaveBeenCalled();
  });

  it("sends the class and the note for the bound case, then shows the routed receipt", async () => {
    const classify = vi.fn<ClassifySender>().mockResolvedValue({
      ok: true,
      result: classifyResult(),
    });
    draw({ classify });
    await settle();

    expect(primary()).toHaveTextContent("Queue correction round → attempt 4");
    expect(note()).toHaveAccessibleDescription("Injected into attempt 4's planning context.");

    fireEvent.change(note(), { target: { value: `  ${CORRECTION_NOTE}  ` } });
    fireEvent.click(primary());
    await settle();

    expect(classify).toHaveBeenCalledExactlyOnceWith(BUILD_3_ID, OVERSHOOT_CASE.caseId, {
      class: "product_bug",
      note: CORRECTION_NOTE,
    });

    const receipt = within(card().getByRole("group", { name: RECEIPT_LABEL }));

    expect(receipt.getByText(CONTROL_ID)).toBeInTheDocument();
    expect(receipt.getByRole("link", { name: "attempt 4 ↗" })).toHaveAttribute(
      "href",
      `/runs/${SEEDED_RUN_ID}?from=dashboard`,
    );
    expect(card().getByText(CORRECTION_NOTE)).toBeInTheDocument();
    expect(card().getByText(/by you/)).toBeInTheDocument();
    // The form has given way to the decision.
    expect(card().queryByRole("radio")).toBeNull();
  });

  it("reads the attempt's page and the timeline again once a decision is recorded", async () => {
    const pages = answering(page());
    const timelines = answering(timeline());
    draw({
      classify: vi.fn<ClassifySender>().mockResolvedValue({ ok: true, result: classifyResult() }),
      pagePoll: pages.options,
      timelinePoll: timelines.options,
    });
    await settle();

    const before = { pages: pages.read.mock.calls.length, timelines: timelines.read.mock.calls.length };

    fireEvent.change(note(), { target: { value: CORRECTION_NOTE } });
    fireEvent.click(primary());
    await settle();

    expect(pages.read.mock.calls.length).toBeGreaterThan(before.pages);
    expect(timelines.read.mock.calls.length).toBeGreaterThan(before.timelines);
  });

  it("sends the class the reader chose over the hint's, and no note it was not given", async () => {
    const classify = vi.fn<ClassifySender>().mockResolvedValue({
      ok: true,
      result: classifyResult(
        {
          class: "flake_retry",
          note: null,
          routed: {
            controlId: null,
            rerunJobId: "7f000002-0000-4000-8000-000000000480",
            targetAttempt: null,
            route: "flake_retry",
          },
        },
        { route: "flake_retry", targetAttempt: null, historyMarked: true },
      ),
    });
    draw({ classify });
    await settle();

    fireEvent.click(card().getByRole("radio", { name: /^Flake — retry$/ }));

    expect(note()).toHaveAttribute("aria-required", "false");
    fireEvent.click(primary("Mark as flake & re-run the case"));
    await settle();

    expect(classify).toHaveBeenCalledExactlyOnceWith(BUILD_3_ID, OVERSHOOT_CASE.caseId, {
      class: "flake_retry",
      note: null,
    });
    expect(card().getByText("Flake marked, case re-run queued")).toBeInTheDocument();
    expect(card().getByText("7f000002-0000-4000-8000-000000000480")).toBeInTheDocument();
  });

  it("draws a refusal in the service's words, and keeps the form and what was typed", async () => {
    const classify = vi.fn<ClassifySender>().mockResolvedValue({
      ok: false,
      status: 403,
      code: "forbidden",
      reason: "A viewer may not classify.",
    });
    draw({ classify });
    await settle();

    fireEvent.change(note(), { target: { value: CORRECTION_NOTE } });
    fireEvent.click(primary());
    await settle();

    expect(card().getByRole("alert")).toHaveTextContent("A viewer may not classify.");
    expect(note()).toHaveValue(CORRECTION_NOTE);
    expect(card().queryByRole("group", { name: RECEIPT_LABEL })).toBeNull();
  });

  it("sends one decision for two presses in a row", async () => {
    let answer: (outcome: Awaited<ReturnType<ClassifySender>>) => void = () => {};
    const classify = vi.fn<ClassifySender>(
      () => new Promise((resolve) => (answer = resolve)),
    );
    draw({ classify });
    await settle();

    fireEvent.change(note(), { target: { value: CORRECTION_NOTE } });
    fireEvent.click(primary());
    fireEvent.click(card().getByRole("button", { name: /^Queue correction round/ }));

    expect(classify).toHaveBeenCalledTimes(1);

    await act(async () => {
      answer({ ok: true, result: classifyResult() });
      await Promise.resolve();
    });
  });

  it("names no attempt in the action when the run's stages were not read", async () => {
    draw({ nextAttempt: null });
    await settle();

    expect(primary()).toHaveTextContent(/^Queue correction round$/);
  });
});

describe("after routing", () => {
  /** A page that serves a recorded decision for the overshoot. */
  function decided(): TestRunPage {
    return page({ classifications: [classification({ createdBy: COLLEAGUE_ID })] });
  }

  it("shows the recorded decision on arrival — after a reload, not a blank form", async () => {
    draw({ initialPage: decided() });
    await settle();

    expect(card().getByText("Product bug")).toBeInTheDocument();
    expect(card().getByText(/by Mel Member/)).toBeInTheDocument();
    expect(card().getByText(CORRECTION_NOTE)).toBeInTheDocument();
    expect(within(card().getByRole("group", { name: RECEIPT_LABEL })).getByText(CONTROL_ID)).toBeInTheDocument();
    expect(card().queryByRole("radio")).toBeNull();
  });

  it("re-classifies: the prior decision is preserved, and the new one is shown", async () => {
    const classify = vi.fn<ClassifySender>().mockResolvedValue({
      ok: true,
      result: classifyResult({
        id: "5eed0037-0000-4000-8000-000000000002",
        class: "test_update",
        note: "The test assumes FIFO ordering.",
        createdAt: "2026-09-19T14:40:00.000Z",
        routed: {
          controlId: "c0000000-0000-4000-8000-000000000089",
          rerunJobId: null,
          targetAttempt: 5,
          route: "correction_round",
        },
      }),
    });
    draw({ initialPage: decided(), classify });
    await settle();

    fireEvent.click(card().getByRole("button", { name: RECLASSIFY_LABEL }));

    // The decision it would replace stays on the card while the form is open over it.
    expect(card().getByText(CORRECTION_NOTE)).toBeInTheDocument();

    fireEvent.click(card().getByRole("radio", { name: /^Test needs update$/ }));
    fireEvent.change(note(), { target: { value: "The test assumes FIFO ordering." } });
    fireEvent.click(primary());
    await settle();

    expect(classify).toHaveBeenCalledExactlyOnceWith(BUILD_3_ID, OVERSHOOT_CASE.caseId, {
      class: "test_update",
      note: "The test assumes FIFO ordering.",
    });
    expect(card().getByText("Test needs update")).toBeInTheDocument();
    expect(card().getByText("The test assumes FIFO ordering.")).toBeInTheDocument();
    expect(card().getByRole("link", { name: "attempt 5 ↗" })).toBeInTheDocument();
    expect(
      card().getByText(
        "Replaced: Product bug, by Mel Member at 14:22 — kept in the record as superseded.",
      ),
    ).toBeInTheDocument();
  });

  it("leaves the recorded decision as it was when the reader keeps it", async () => {
    const classify = vi.fn<ClassifySender>();
    draw({ initialPage: decided(), classify });
    await settle();

    fireEvent.click(card().getByRole("button", { name: RECLASSIFY_LABEL }));
    fireEvent.click(card().getByRole("button", { name: KEEP_DECISION_LABEL }));

    expect(card().queryByRole("radio")).toBeNull();
    expect(card().getByRole("button", { name: RECLASSIFY_LABEL })).toBeInTheDocument();
    expect(classify).not.toHaveBeenCalled();
  });
});

describe("the toggles", () => {
  it("are drawn as the timeline stores them — which is what a reload reads", async () => {
    const stored = timeline();
    stored.next = { ...stored.next, intents: { blockUntilGreen: false, autoRerunPhysical: true } };
    draw({ initial: stored });
    await settle();

    expect(card().getByRole("switch", { name: /Block PR #514/ })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(card().getByRole("switch", { name: /Auto re-run/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("store the one that was pressed, at once, and read the timeline again", async () => {
    const setIntent = vi.fn<IntentSender>().mockResolvedValue({
      ok: true,
      intents: intents({ autoRerunPhysical: true }),
    });
    const timelines = answering(timeline());
    draw({ setIntent, timelinePoll: timelines.options });
    await settle();

    const before = timelines.read.mock.calls.length;

    fireEvent.click(card().getByRole("switch", { name: /Auto re-run/ }));
    await settle();

    expect(setIntent).toHaveBeenCalledExactlyOnceWith(SEEDED_RUN_ID, {
      field: "autoRerunPhysical",
      value: true,
    });
    // The timeline still says off; the switch shows what the service stored.
    expect(card().getByRole("switch", { name: /Auto re-run/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(timelines.read.mock.calls.length).toBeGreaterThan(before);
  });

  it("switch one off as well as on, without a classification", async () => {
    const classify = vi.fn<ClassifySender>();
    const setIntent = vi.fn<IntentSender>().mockResolvedValue({
      ok: true,
      intents: intents({ blockUntilGreen: false }),
    });
    draw({ classify, setIntent });
    await settle();

    fireEvent.click(card().getByRole("switch", { name: "Switch off: Block PR #514 until green" }));
    await settle();

    expect(setIntent).toHaveBeenCalledExactlyOnceWith(SEEDED_RUN_ID, {
      field: "blockUntilGreen",
      value: false,
    });
    expect(
      card().getByRole("switch", { name: "Switch on: Block PR #514 until green" }),
    ).toHaveAttribute("aria-checked", "false");
    expect(classify).not.toHaveBeenCalled();
  });

  it("stay as they were, and say why, when the service refuses", async () => {
    const setIntent = vi.fn<IntentSender>().mockResolvedValue({
      ok: false,
      status: 404,
      code: "run_not_found",
      reason: "No such run.",
    });
    draw({ setIntent });
    await settle();

    fireEvent.click(card().getByRole("switch", { name: /Auto re-run/ }));
    await settle();

    expect(card().getByRole("switch", { name: /Auto re-run/ })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(card().getByRole("alert")).toHaveTextContent("No such run.");
  });

  it("state the Block-PR toggle's activation point while nothing holds the PR", async () => {
    const stored = timeline();
    stored.next = { ...stored.next, activation: "intent_stored", gate: null };
    draw({ initial: stored });
    await settle();

    expect(
      card().getByRole("switch", { name: /Block PR #514/ }),
    ).toHaveAccessibleDescription(/^Stored as an intent\. Enforcement activates with the PR plane/);
  });
});

describe("Waive & annotate PR", () => {
  it("is not drawn for a member", async () => {
    draw({ mayWaive: false });
    await settle();

    expect(screen.queryByRole("button", { name: /waive/i })).toBeNull();
  });

  it("opens a labelled dialog that names the failure and the half that is deferred", async () => {
    draw({ mayWaive: true });
    await settle();

    fireEvent.click(card().getByRole("button", { name: WAIVE_LABEL }));

    const dialog = within(screen.getByRole("dialog", { name: WAIVE_TITLE }));

    expect(dialog.getByText(`${RIG_SUITE} › ${OVERSHOOT_CASE.name}`)).toBeInTheDocument();
    expect(dialog.getByText(WAIVE_CONSEQUENCE)).toBeInTheDocument();
    expect(dialog.getByText(WAIVE_DEFERRED)).toBeInTheDocument();
    expect(dialog.getByRole("textbox", { name: WAIVE_REASON_LABEL })).toBeRequired();
  });

  it("requires a reason: the button is inert, and says why, until one is written", async () => {
    const waive = vi.fn<WaiveSender>();
    draw({ mayWaive: true, waive });
    await settle();

    fireEvent.click(card().getByRole("button", { name: WAIVE_LABEL }));

    const dialog = within(screen.getByRole("dialog", { name: WAIVE_TITLE }));
    const confirm = dialog.getByRole("button", { name: WAIVE_CONFIRM });

    expect(confirm).toHaveAttribute("aria-disabled", "true");
    expect(confirm).toHaveAttribute("title", WAIVE_NEEDS_REASON);

    fireEvent.click(confirm);
    fireEvent.change(dialog.getByRole("textbox", { name: WAIVE_REASON_LABEL }), {
      target: { value: "   " },
    });
    fireEvent.click(confirm);

    expect(waive).not.toHaveBeenCalled();
  });

  it("records the waiver with its reason for the bound case, and shows its author", async () => {
    const waive = vi.fn<WaiveSender>().mockResolvedValue({ ok: true, waiver: waiver() });
    draw({ mayWaive: true, waive });
    await settle();

    fireEvent.click(card().getByRole("button", { name: WAIVE_LABEL }));

    const dialog = within(screen.getByRole("dialog", { name: WAIVE_TITLE }));

    fireEvent.change(dialog.getByRole("textbox", { name: WAIVE_REASON_LABEL }), {
      target: { value: "  Known rig drift on helios-rig-02; tracked in #512.  " },
    });
    fireEvent.click(dialog.getByRole("button", { name: WAIVE_CONFIRM }));
    await settle();

    expect(waive).toHaveBeenCalledExactlyOnceWith(
      BUILD_3_ID,
      OVERSHOOT_CASE.caseId,
      "Known rig drift on helios-rig-02; tracked in #512.",
    );
    expect(screen.queryByRole("dialog")).toBeNull();

    const said = card().getByRole("status");

    expect(said).toHaveTextContent("Waived by you at 14:25");
    expect(said).toHaveTextContent("Known rig drift on helios-rig-02; tracked in #512.");
    expect(said).toHaveTextContent(WAIVE_DEFERRED);
  });

  it("draws a refusal in the dialog, which stays open with what was typed", async () => {
    const waive = vi.fn<WaiveSender>().mockResolvedValue({
      ok: false,
      status: 403,
      code: "forbidden",
      reason: "Only an owner or admin may waive.",
    });
    draw({ mayWaive: true, waive });
    await settle();

    fireEvent.click(card().getByRole("button", { name: WAIVE_LABEL }));

    const dialog = within(screen.getByRole("dialog", { name: WAIVE_TITLE }));

    fireEvent.change(dialog.getByRole("textbox", { name: WAIVE_REASON_LABEL }), {
      target: { value: "not mine to waive" },
    });
    fireEvent.click(dialog.getByRole("button", { name: WAIVE_CONFIRM }));
    await settle();

    expect(dialog.getByRole("alert")).toHaveTextContent("Only an owner or admin may waive.");
    expect(dialog.getByRole("textbox", { name: WAIVE_REASON_LABEL })).toHaveValue(
      "not mine to waive",
    );
    expect(card().queryByRole("status")).toBeNull();
  });

  it("closes on Escape and on its cancel, sending nothing", async () => {
    const waive = vi.fn<WaiveSender>();
    draw({ mayWaive: true, waive });
    await settle();

    fireEvent.click(card().getByRole("button", { name: WAIVE_LABEL }));
    fireEvent.keyDown(screen.getByRole("dialog", { name: WAIVE_TITLE }), { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(card().getByRole("button", { name: WAIVE_LABEL }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: WAIVE_TITLE })).getByRole("button", {
        name: WAIVE_CANCEL,
      }),
    );

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(waive).not.toHaveBeenCalled();
  });

  it("traps focus: Tab from the last control returns to the first, and Shift+Tab the other way", async () => {
    draw({ mayWaive: true });
    await settle();

    fireEvent.click(card().getByRole("button", { name: WAIVE_LABEL }));

    const panel = screen.getByRole("dialog", { name: WAIVE_TITLE });
    const dialog = within(panel);
    const first = dialog.getByRole("textbox", { name: WAIVE_REASON_LABEL });
    const last = dialog.getByRole("button", { name: WAIVE_CANCEL });

    expect(panel.contains(document.activeElement)).toBe(true);

    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(panel.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(last);

    first.focus();
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(panel.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(first);
  });
});

describe("who is reading", () => {
  it("a member classifies and sets the toggles, and is offered no waive", async () => {
    draw({ mayContribute: true, mayWaive: false });
    await settle();

    expect(card().getAllByRole("radio")).toHaveLength(4);
    expect(note()).toBeInTheDocument();
    for (const toggle of card().getAllByRole("switch")) {
      expect(toggle).not.toHaveAttribute("aria-disabled");
    }
    expect(card().queryByRole("button", { name: /waive/i })).toBeNull();
  });

  it("a viewer reads, and is offered neither a form nor a press", async () => {
    const setIntent = vi.fn<IntentSender>();
    draw({
      mayContribute: false,
      mayWaive: false,
      setIntent,
      initialPage: page({ classifications: [classification()] }),
    });
    await settle();

    expect(card().getByText(VIEWER_NOTE)).toBeInTheDocument();
    expect(card().getByText(CORRECTION_NOTE)).toBeInTheDocument();
    expect(card().queryByRole("radio")).toBeNull();
    expect(card().queryByRole("button", { name: RECLASSIFY_LABEL })).toBeNull();
    expect(card().queryByRole("button", { name: /waive/i })).toBeNull();

    fireEvent.click(card().getAllByRole("switch")[0]!);
    await settle();

    expect(setIntent).not.toHaveBeenCalled();
  });
});

describe("a staged failed set", () => {
  /** A timeline whose latest build failed both of the page's failures. */
  function both(): TestRunTimeline {
    const attempts = mockupAttempts();
    attempts[2] = {
      ...attempts[2]!,
      strip: strip({
        failed: 2,
        failedCases: [OVERSHOOT_CASE, { ...FLAKY_CASE, suite: "telemetry integration" }],
      }),
    };

    return timeline({ attempts });
  }

  /** A head action, by its label. */
  function action(name: RegExp): HTMLElement {
    return within(screen.getByRole("group", { name: ACTIONS_LABEL })).getByRole("button", { name });
  }

  it("is a worklist: each failure is its own button, and the one on the card is marked", async () => {
    draw({ initial: both() });
    await settle();

    fireEvent.click(action(/^Send failures back/));

    const staged = within(card().getByRole("list", { name: STAGED_LABEL }));

    expect(staged.getAllByRole("listitem")).toHaveLength(2);
    expect(
      staged.getByRole("button", { name: `${RIG_SUITE} › ${OVERSHOOT_CASE.name}` }),
    ).toHaveAttribute("aria-current", "true");
  });

  it("puts the chosen failure on both cards, clearing a selection that leaves it out", async () => {
    draw({ initial: both() });
    await settle();

    fireEvent.click(action(/^Send failures back/));
    fireEvent.click(
      card().getByRole("button", { name: `telemetry integration › ${FLAKY_CASE.name}` }),
    );
    await settle();

    // The rig's suite no longer scopes the page: both failures are in reach, the flaky one bound.
    expect(card().getAllByText(FLAKY_CASE.name).length).toBeGreaterThan(0);
    expect(failure().getByRole("img", { name: "Failure 1 of 2" })).toBeInTheDocument();
    expect(window.location.search).not.toContain("suite=");
    expect(
      within(screen.getByRole("region", { name: SUITES_TITLE })).queryByRole("button", {
        pressed: true,
      }),
    ).toBeNull();
    expect(
      card().getByRole("button", { name: `telemetry integration › ${FLAKY_CASE.name}` }),
    ).toHaveAttribute("aria-current", "true");
  });

  it("classifies only the failure on the card — never the set", async () => {
    const classify = vi.fn<ClassifySender>().mockResolvedValue({
      ok: true,
      result: classifyResult(),
    });
    draw({ initial: both(), classify });
    await settle();

    fireEvent.click(action(/^Send failures back/));
    fireEvent.change(note(), { target: { value: CORRECTION_NOTE } });
    fireEvent.click(primary());
    await settle();

    expect(classify).toHaveBeenCalledTimes(1);
    expect(classify.mock.calls[0]![1]).toBe(OVERSHOOT_CASE.caseId);

    const rows = within(card().getByRole("list", { name: STAGED_LABEL })).getAllByRole("listitem");

    expect(rows[0]).toHaveTextContent("Product bug");
    expect(rows[1]).not.toHaveTextContent("Product bug");
  });
});

describe("another build", () => {
  it("starts from nothing typed and nothing held", async () => {
    draw();
    await settle();

    fireEvent.change(note(), { target: { value: CORRECTION_NOTE } });
    fireEvent.click(
      within(screen.getByRole("region", { name: TIMELINE_TITLE })).getByRole("button", {
        name: /^Build 2\b/,
      }),
    );
    await settle();

    // Build 2's page has not been read in this case, so the card says it is reading.
    expect(card().getByText(READING_TARGET)).toBeInTheDocument();
    expect(card().queryByDisplayValue(CORRECTION_NOTE)).toBeNull();
  });
});

describe("the path the failure card shows", () => {
  it("is never decided by this card's state alone: the two read one binding", async () => {
    draw({ initialSuite: null });
    await settle();

    fireEvent.click(failure().getByRole("button", { name: NEXT_FAILURE }));

    expect(failure().getByRole("img", { name: "Failure 2 of 2" })).toBeInTheDocument();
    expect(card().getByText(OVERSHOOT_CASE.name)).toBeInTheDocument();
    expect(failure().queryByRole("group", { name: PATH_LABEL })).toBeNull();
  });
});
