import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { publishDryRun, readCopilotLive, resetCopilotLive } from "@/app/workflows/copilot/copilot-live";
import { findingStageTarget, stageAnchorHref } from "@/app/workflows/copilot/copilot-view";
import {
  ADVISORY_REASON,
  APPLY_CONFIRM,
  APPLY_LABEL,
  APPLY_TITLE,
  BUDGET_HEADING,
  CANCELLED_HEADING,
  CANCEL_LABEL,
  CONTROL_ROLE_REASON,
  DIFF_HEADLINE,
  DIFF_SCROLL_LABEL,
  DISMISS_LABEL,
  type DryRunStreamEvent,
  EMPTY_NOTE,
  EMPTY_PICK_LABEL,
  EMPTY_TITLE,
  EMPTY_VIEWER_NOTE,
  EVIDENCE_HEADING,
  EXPLAIN_LABEL,
  EXPLAIN_TITLE,
  FAILED_HEADING,
  GUARD_HEADING,
  IGNORE_LABEL,
  IN_FLIGHT_REASON,
  LLM_EXPLANATION,
  LLM_LABEL,
  NO_STAGES_REASON,
  OFF_TRIGGER_LABEL,
  PARTIAL_NOTE,
  PICKER_EMPTY,
  PICKER_PANEL_LABEL,
  POLLING_NOTE,
  PRECHECK_HEADING,
  QUEUED_NOTE,
  RERUN_LABEL,
  RERUN_OFFER,
  ROWS_LABEL,
  RUNNING_NOTE,
  SIMULATED_PILL,
  SUGGESTIONS_LABEL,
  SUGGESTIONS_LOADING,
  SUGGESTIONS_UNREAD,
  SUGGESTION_ROLE_REASON,
  confidenceButtonName,
  dryRunTitle,
  estimateButtonName,
  proposalMissing,
  startLabel,
  budgetAdvice,
  budgetSpentLine,
} from "@/app/workflows/copilot/dry-run";
import type { DryRunCardProps } from "@/app/workflows/copilot/dry-run-card";
import type { FollowMessage, FollowSource } from "@/app/workflows/copilot/dry-run-transport";

import { PALETTES, maskIds, renderInBothPalettes, renderInPalette } from "../../helpers/palettes";
import { settle } from "../../helpers/settle";
import {
  ADVISORY_SUGGESTION,
  BUILD_FORMULA_SUMMARY,
  BUILD_NOTE,
  CANDIDATE_490,
  DRY_RUN_ID,
  INSUFFICIENT_ESTIMATE,
  LLM_SUGGESTION,
  SECURITY_PATCH_ID,
  SESSION_ID,
  SUGGESTION_REVIEW_ID,
  SUGGESTION_SKIP_ID,
  TICKET_489_ID,
  buildEstimate,
  closedConversation,
  dryRunCandidate,
  dryRunStage,
  dryRunTransport,
  emptyBoard,
  runningDryRun,
  seededBoard,
  seededConversation,
  seededDiff,
  seededDraftDefinition,
  seededDryRun,
  seededExplanation,
  seededHistory,
  seededStages,
  seededSuggestions,
} from "../../helpers/workflow-copilot";

/**
 * The dry-run card as it is drawn (CE.4, #568) — mockup 20's `DRY RUN — #489 …`.
 *
 * One acceptance criterion a `describe`, more or less: **the seeded card is the mockup's seven
 * rows with their exact `how` labels and notes**; **a replayed row opens its provenance, and an
 * insufficient history draws no number**; **the diff says it was never written, and states
 * truncation**; **a live run streams rows, then the diff, then the suggestions**; **Apply
 * previews before it mutates, bumps the rev and links to the changed rows**; **Explain shows the
 * rule, version and evidence, and the confidence opens to its basis**; **the model's suggestions
 * are labelled**; **Re-run and the picker**; **every end is its own state**; and both palettes.
 *
 * The transport and the event source are seams the card takes as props; nothing here reaches a
 * network. The judgements are `dry-run.test.ts`'s.
 */

/** What re-reads the page after an action. */
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));
// The page's notice lives beside the head's actions, whose Server Actions this suite never calls.
vi.mock("@/app/workflows/draft-actions", () => ({ publishWorkflow: vi.fn() }));
vi.mock("@/app/workflows/copilot/copilot-actions", () => ({ discardCopilotDraft: vi.fn() }));
vi.mock("@/app/workflows/create-actions", () => ({ createWorkflow: vi.fn() }));
// `next/link` wants the App Router; an anchor carries everything asserted here.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a {...rest} href={href}>
      {children}
    </a>
  ),
}));

const { CopilotFlows, CopilotNotice } = await import("@/app/workflows/copilot/copilot-flows");
const { DryRunCard } = await import("@/app/workflows/copilot/dry-run-card");

/** A fake `EventSource` the test speaks through. */
function fakeSource() {
  const listeners = new Map<string, ((event: FollowMessage) => void)[]>();
  const source: FollowSource & { closed: boolean } = {
    closed: false,
    addEventListener(type, listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    close() {
      source.closed = true;
    },
  };

  return {
    source,
    urls: [] as string[],
    open(this: { urls: string[] }, url: string) {
      this.urls.push(url);
      return source;
    },
    /** Deliver one of the service's events, and let the card draw it. */
    async emit(event: DryRunStreamEvent) {
      await act(async () => {
        for (const listener of listeners.get(event.kind) ?? []) listener({ data: JSON.stringify(event) });
      });
    },
    /** The browser's own connection error. */
    async drop() {
      await act(async () => {
        for (const listener of listeners.get("error") ?? []) listener({});
      });
    },
  };
}

/** Render the card on the seeded board, as a contributor, inside the page's notice. */
function renderCard(overrides: Partial<DryRunCardProps> = {}) {
  const props: DryRunCardProps = {
    workflowId: SECURITY_PATCH_ID,
    board: seededBoard(),
    conversation: seededConversation(),
    definition: seededDraftDefinition(),
    hasStages: true,
    mayContribute: true,
    now: "2026-09-13T15:05:30.000Z",
    transport: dryRunTransport(),
    openSource: () => fakeSource().source,
    ...overrides,
  };

  return {
    props,
    ...render(
      <CopilotFlows>
        <CopilotNotice />
        <DryRunCard {...props} />
      </CopilotFlows>,
    ),
  };
}

/** The card. */
function card(): HTMLElement {
  return document.getElementById("copilot-dry-run")!;
}

/** The result rows. */
function rows(): HTMLElement[] {
  return within(screen.getByRole("list", { name: ROWS_LABEL })).getAllByRole("listitem");
}

/** A row's visible words, on one line. */
function line(row: HTMLElement): string {
  return (row.querySelector(".copilot-dry__line")?.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** The callouts. */
function callouts(): HTMLElement[] {
  return within(screen.getByRole("list", { name: SUGGESTIONS_LABEL })).getAllByRole("listitem");
}

/** A button, by its name. */
function button(name: string | RegExp, within_: HTMLElement = card()): HTMLElement {
  return within(within_).getByRole("button", { name });
}

/** Press a button and let what it started land. */
async function press(target: HTMLElement): Promise<void> {
  fireEvent.click(target);
  await settle();
}

/** A refusal, as the transport hands one back. */
function refused(code: string, message: string, status = 409) {
  return { ok: false as const, refusal: { status, code, message } };
}

beforeEach(() => {
  refresh.mockReset();
  resetCopilotLive();
});

describe("the seeded card", () => {
  it("is a region named for the run's ticket, on the seat's element id", () => {
    renderCard();

    const region = screen.getByRole("region", { name: dryRunTitle(seededDryRun().ticket) });

    expect(region).toBe(card());
    expect(within(region).getByRole("heading", { level: 2 })).toHaveAttribute("id", "copilot-dry-run-title");
  });

  it("carries the whole ticket title where the heading may be cut", () => {
    renderCard();

    expect(card().querySelector(".copilot-dry__title")).toHaveAttribute("title", dryRunTitle(seededDryRun().ticket));
  });

  it("wears the pill verbatim, and the totals", () => {
    renderCard();

    expect(within(card()).getByText(SIMULATED_PILL)).toBeInTheDocument();
    expect(SIMULATED_PILL).toBe("simulated — no writes · no PRs · no merges");
    expect(card().querySelector(".copilot-dry__totals")).toHaveTextContent("2m 41s · $0.31");
  });

  it("omits the cost entirely for an unpriced run — never a zero", () => {
    renderCard({ board: seededBoard({ run: seededDryRun({ totals: { durationMs: 161_000, costCents: null, tokens: null } }) }) });

    expect(card().querySelector(".copilot-dry__totals")?.textContent).toBe("2m 41s");
    expect(card()).not.toHaveTextContent("$0.00");
  });

  it("is mockup 20's seven rows: mark, stage, the `how` label in parentheses, and the service's note", () => {
    renderCard();

    expect(rows().map(line)).toEqual([
      "✓passed: analyzemapped 4 files · advisory DB skipped (no CVE on this issue)",
      "✓passed: plan3 steps · would touch drivers/can/arbitration.c",
      "✓passed: implement(simulated)diff drafted +41 −9 (below) · 84k tokens",
      `✓passed: build(replayed from history)ⓘ${BUILD_NOTE}`,
      "⏸skipped: exploit-verify(skipped)no PoC exists: stage had nothing to do",
      "✓passed: review ×2both approve · 1 style nit",
      "○not run: open PRwould open DRAFT PR · not merged (policy)",
    ]);
  });

  it("draws each `how` label in its own treatment, and a skip's label and note on the warning hue", () => {
    renderCard();

    const labels = [...card().querySelectorAll(".copilot-dry__how")];

    expect(labels.map((label) => label.textContent)).toEqual(["(simulated)", "(replayed from history)", "(skipped)"]);
    expect(labels.map((label) => label.classList.contains("copilot-dry__how--warn"))).toEqual([false, false, true]);
    expect(rows()[4].querySelector(".copilot-dry__note")).toHaveClass("copilot-dry__note--warn");
    expect(rows()[0].querySelector(".copilot-dry__note")).not.toHaveClass("copilot-dry__note--warn");
  });

  it("hides the marks from a screen reader and says the verdict in words", () => {
    renderCard();

    for (const mark of card().querySelectorAll(".copilot-dry__mark")) expect(mark).toHaveAttribute("aria-hidden", "true");
    expect(rows()[4]).toHaveTextContent("skipped: exploit-verify");
  });

  it("draws the history line, and both controls live", () => {
    renderCard();

    expect(card()).toHaveTextContent("history: 1 dry run · draft v0.3 (2 copilot edits)");
    expect(button(RERUN_LABEL)).not.toHaveAttribute("aria-disabled");
    expect(button(/^Dry-run another issue/)).not.toHaveAttribute("aria-disabled");
    expect(within(card()).queryByRole("button", { name: CANCEL_LABEL })).toBeNull();
  });

  it("draws both suggestions, 93% and 81%, each with its three actions", () => {
    renderCard();

    expect(callouts()).toHaveLength(2);
    expect(callouts()[0]).toHaveTextContent("Make exploit-verify conditional");
    expect(button(confidenceButtonName("93%"))).toHaveTextContent("93%");
    expect(callouts()[1]).toHaveTextContent("Pin the pr-etiquette skill to both reviewers");
    expect(button(confidenceButtonName("81%"))).toHaveTextContent("81%");
    for (const callout of callouts()) {
      expect(within(callout).getAllByRole("button").map((each) => each.textContent?.trim())).toEqual(
        expect.arrayContaining([APPLY_LABEL, EXPLAIN_LABEL, IGNORE_LABEL]),
      );
    }
  });

  it("draws a suggestion's title once, in bold, and its inline code as code", () => {
    renderCard();

    const body = callouts()[0].querySelector(".copilot-dry__suggest-body")!;

    expect(body.querySelector("strong")).toHaveTextContent("Make exploit-verify conditional");
    expect(body.textContent?.match(/Make exploit-verify conditional/g)).toHaveLength(1);
    expect([...body.querySelectorAll("code")].map((code) => code.textContent)).toEqual(["cve", "cve"]);
    expect(callouts()[0]).toHaveTextContent("rule · skipped-nothing-to-do v1");
  });
});

describe("a replayed row's provenance", () => {
  it("is closed until its ⓘ is pressed, then shows the estimate, sample, spread, window and formula", () => {
    renderCard();

    const info = button(estimateButtonName("build"));
    const note = document.getElementById(info.getAttribute("aria-controls")!)!;

    expect(info).toHaveAttribute("aria-expanded", "false");
    expect(note).not.toBeVisible();

    fireEvent.click(info);

    expect(info).toHaveAttribute("aria-expanded", "true");
    expect(note).toBeVisible();
    expect(note).toHaveAttribute("role", "note");
    expect(note).toHaveTextContent("3m 42s");
    expect(note).toHaveTextContent("n = 217");
    expect(note).toHaveTextContent("± 22s");
    expect(note).toHaveTextContent("30-day window");
    expect(note).toHaveTextContent(`formula build_duration_replay v1 — ${BUILD_FORMULA_SUMMARY}`);
  });

  it("closes on a second press, and on Escape with focus back on the control", () => {
    renderCard();

    const info = button(estimateButtonName("build"));
    fireEvent.click(info);
    fireEvent.click(info);
    expect(info).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(info);
    fireEvent.keyDown(document.getElementById(info.getAttribute("aria-controls")!)!, { key: "Escape" });

    expect(info).toHaveAttribute("aria-expanded", "false");
    expect(info).toHaveFocus();
  });

  it("is a real button a keyboard reaches, and rows that are not replays draw none", () => {
    renderCard();

    expect(button(estimateButtonName("build")).tagName).toBe("BUTTON");
    expect(card().querySelectorAll(".copilot-dry__info")).toHaveLength(1);
    expect(card().querySelectorAll(".copilot-dry__provenance")).toHaveLength(1);
  });

  it("says there was not enough history instead of a number — nowhere in the row or its note", () => {
    const stages = seededStages();
    stages[3] = { ...stages[3], note: "not enough history to estimate (12 similar builds)", estimate: INSUFFICIENT_ESTIMATE };
    renderCard({ board: seededBoard({ run: seededDryRun({ stages }) }) });

    const info = button(estimateButtonName("build"));
    fireEvent.click(info);
    const note = document.getElementById(info.getAttribute("aria-controls")!)!;

    expect(note).toHaveTextContent("Not enough history: 12 similar builds in the last 30 days, 20 needed.");
    expect(note.querySelector("dl")).toBeNull();
    // The formula's own sentence mentions the ±; what must be absent is a figure.
    expect(rows()[3].textContent).not.toMatch(/\d+m \d+s|± \d|n = /);
  });

  it("draws the numbers without a formula line when the service names none, and no ⓘ without an estimate", () => {
    const stages = seededStages();
    stages[3] = { ...stages[3], estimate: buildEstimate({ formula: null }) };
    const { unmount } = renderCard({ board: seededBoard({ run: seededDryRun({ stages }) }) });

    fireEvent.click(button(estimateButtonName("build")));
    expect(card().querySelector(".copilot-dry__provenance")).toHaveTextContent("n = 217");
    expect(card().querySelector(".copilot-dry__formula")).toBeNull();
    unmount();

    stages[3] = { ...stages[3], estimate: null };
    renderCard({ board: seededBoard({ run: seededDryRun({ stages }) }) });
    expect(card().querySelector(".copilot-dry__info")).toBeNull();
  });
});

describe("the simulated diff", () => {
  it("says inside the block that it was never written, with the file and its ± counts", () => {
    renderCard();

    const block = card().querySelector(".copilot-dry__diff")!;

    expect(block).toHaveTextContent(DIFF_HEADLINE);
    expect(DIFF_HEADLINE).toBe("simulated diff (never written to repo)");
    expect(block).toHaveTextContent("drivers/can/arbitration.c +41 −9");
  });

  it("scrolls inside its own named, focusable wrapper, with added and removed lines told apart", () => {
    renderCard();

    const scroller = within(card()).getByRole("group", { name: DIFF_SCROLL_LABEL });

    expect(scroller).toHaveAttribute("tabindex", "0");
    expect(scroller.querySelectorAll(".copilot-dry__diff-line--add")).toHaveLength(4);
    expect(scroller.querySelectorAll(".copilot-dry__diff-line--del")).toHaveLength(2);
    expect(scroller.querySelectorAll(".copilot-dry__diff-line--hunk")).toHaveLength(1);
    expect(scroller).toHaveTextContent("k_sleep(K_USEC(backoff_us));");
  });

  it("states truncation with both sizes when the artifact is a prefix, and nothing otherwise", () => {
    const { unmount } = renderCard();
    expect(card().querySelector(".copilot-dry__diff-truncated")).toBeNull();
    unmount();

    const artifact = seededDiff({ content: "+x\n".repeat(1024), truncated: true, originalBytes: 217_498 });
    renderCard({ board: seededBoard({ run: seededDryRun({ artifacts: [artifact] }) }) });

    expect(card().querySelector(".copilot-dry__diff-truncated")).toHaveTextContent(
      "Truncated — showing the first 3.0 KB of 212.4 KB.",
    );
  });

  it("draws no diff block for a run without one, and never an excerpt as a diff", () => {
    const excerpt = seededDiff({ kind: "plan_excerpt", pathSummary: null });
    renderCard({ board: seededBoard({ run: seededDryRun({ artifacts: [excerpt] }) }) });

    expect(card().querySelector(".copilot-dry__diff")).toBeNull();
  });
});

describe("a live dry run", () => {
  /** A card open on the run in flight, with a source the test speaks through. */
  function renderLive(overrides: Partial<DryRunCardProps> = {}) {
    const fake = fakeSource();
    const detail = vi.fn(async () => ({ ok: true as const, value: seededDryRun() }));
    const suggestions = vi.fn(async () => ({ ok: true as const, value: seededSuggestions() }));
    const rendered = renderCard({
      board: seededBoard({ run: runningDryRun(), suggestions: [] }),
      transport: dryRunTransport({ detail, suggestions }),
      openSource: (url) => fake.open(url),
      ...overrides,
    });

    return { fake, detail, suggestions, ...rendered };
  }

  it("follows this origin's event stream for the run", () => {
    const { fake } = renderLive();

    expect(fake.urls).toEqual([`/api/workflows/${SECURITY_PATCH_ID}/dry-runs/${DRY_RUN_ID}/events`]);
  });

  it("shows an elapsed indicator in the totals' place, and neither diff nor suggestions yet", () => {
    renderLive({ board: seededBoard({ run: runningDryRun({ artifacts: [seededDiff()] }), suggestions: seededSuggestions() }) });

    expect(card().querySelector(".copilot-dry__totals")).toHaveTextContent("running · 30s");
    expect(rows()).toHaveLength(3);
    expect(card().querySelector(".copilot-dry__diff")).toBeNull();
    expect(screen.queryByRole("list", { name: SUGGESTIONS_LABEL })).toBeNull();
  });

  it("fills rows as the stream speaks: started is running, finished is the whole row", async () => {
    const { fake } = renderLive();

    await fake.emit({ kind: "stage_started", seq: 4, stageKey: "build", displayName: "build" });
    expect(rows()).toHaveLength(4);
    expect(line(rows()[3])).toBe(`◌running: build${RUNNING_NOTE}`);

    await fake.emit({ kind: "stage_finished", stage: seededStages()[3] });
    expect(rows()).toHaveLength(4);
    expect(line(rows()[3])).toBe(`✓passed: build(replayed from history)ⓘ${BUILD_NOTE}`);
  });

  it("streams rows, then the diff, then the suggestions — and reads the page again at the end", async () => {
    let release: (value: { ok: true; value: ReturnType<typeof seededSuggestions> }) => void = () => {};
    const suggestions = vi.fn(() => new Promise<{ ok: true; value: ReturnType<typeof seededSuggestions> }>((resolve) => (release = resolve)));
    const { fake, detail } = renderLive({
      transport: dryRunTransport({ detail: vi.fn(async () => ({ ok: true as const, value: seededDryRun() })), suggestions }),
    });
    void detail;

    for (const stage of seededStages().slice(3)) await fake.emit({ kind: "stage_finished", stage });
    expect(rows()).toHaveLength(7);
    expect(card().querySelector(".copilot-dry__diff")).toBeNull();

    await fake.emit({ kind: "done", dryRun: seededDryRun() });

    // The rows and the diff are drawn; the suggestions are still being read.
    expect(fake.source.closed).toBe(true);
    expect(card().querySelector(".copilot-dry__diff")).toHaveTextContent(DIFF_HEADLINE);
    expect(card()).toHaveTextContent(SUGGESTIONS_LOADING);
    expect(screen.queryByRole("list", { name: SUGGESTIONS_LABEL })).toBeNull();
    expect(card().querySelector(".copilot-dry__totals")).toHaveTextContent("2m 41s · $0.31");
    expect(refresh).not.toHaveBeenCalled();

    await act(async () => release({ ok: true, value: seededSuggestions() }));

    expect(callouts()).toHaveLength(2);
    expect(card()).not.toHaveTextContent(SUGGESTIONS_LOADING);
    expect(suggestions).toHaveBeenCalledExactlyOnceWith(SECURITY_PATCH_ID, DRY_RUN_ID);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("re-reads the run when the stream says it ended", async () => {
    const { fake, detail } = renderLive();

    await fake.emit({ kind: "done", dryRun: seededDryRun() });
    await settle();

    expect(detail).toHaveBeenCalledExactlyOnceWith(SECURITY_PATCH_ID, DRY_RUN_ID);
  });

  it("announces the end once, politely — and nothing per row", async () => {
    const { fake } = renderLive();
    const region = card().querySelector("[aria-live='polite']")!;

    await fake.emit({ kind: "stage_started", seq: 4, stageKey: "build", displayName: "build" });
    await fake.emit({ kind: "stage_finished", stage: seededStages()[3] });
    expect(region).toHaveTextContent("");

    await fake.emit({ kind: "done", dryRun: seededDryRun() });
    await settle();

    expect(region).toHaveTextContent("Dry run on #489 finished.");
    expect(card().querySelectorAll("[aria-live]")).toHaveLength(1);
  });

  it("shows a blocked call the moment the stream reports it, as an alert", async () => {
    const { fake } = renderLive();

    await fake.emit({ kind: "guard_blocked", guard: "allow_list", call: "git push origin main", stageKey: "implement" });

    const alert = within(card()).getByRole("alert");
    expect(alert).toHaveTextContent(GUARD_HEADING);
    expect(alert).toHaveTextContent("git push origin main — refused by allow_list, once, in stage implement");
  });

  it("says a run is queued while its pre-check runs and no stage has started", () => {
    renderLive({ board: seededBoard({ run: runningDryRun({ status: "precheck", stages: [] }), suggestions: [] }) });

    expect(card()).toHaveTextContent(QUEUED_NOTE);
    expect(card().querySelector(".copilot-dry__totals")).toHaveTextContent("checking the draft · 30s");
    expect(screen.queryByRole("list", { name: ROWS_LABEL })).toBeNull();
  });

  it("falls back to reading the run when the stream drops, until it ends", async () => {
    const { fake, detail } = renderLive({ pollMs: 20 });

    await fake.drop();
    expect(card()).toHaveTextContent(POLLING_NOTE);
    expect(fake.source.closed).toBe(true);

    await waitFor(() => expect(callouts()).toHaveLength(2));
    expect(detail).toHaveBeenCalled();
    expect(card()).not.toHaveTextContent(POLLING_NOTE);
    expect(rows()).toHaveLength(7);
  });

  it("polls from the start where there is no EventSource", async () => {
    renderLive({ openSource: () => null, pollMs: 20 });

    await waitFor(() => expect(rows()).toHaveLength(7));
  });

  it("offers Cancel while the run is in flight, and holds the other controls with the reason", () => {
    renderLive();

    expect(button(CANCEL_LABEL)).not.toHaveAttribute("aria-disabled");
    expect(button(RERUN_LABEL)).toHaveAttribute("title", IN_FLIGHT_REASON);
    expect(button(/^Dry-run another issue/)).toHaveAttribute("title", IN_FLIGHT_REASON);
    expect(card()).toHaveTextContent(IN_FLIGHT_REASON);
  });

  it("cancels: posts, keeps the rows it reached, and draws the cancelled state", async () => {
    const cancelled = runningDryRun({ status: "cancelled", finishedAt: "2026-09-13T15:06:00.000Z" });
    const cancel = vi.fn(async () => ({ ok: true as const, value: cancelled }));
    const { fake } = renderLive({
      transport: dryRunTransport({
        cancel,
        detail: vi.fn(async () => ({ ok: true as const, value: cancelled })),
        suggestions: vi.fn(async () => ({ ok: true as const, value: [] })),
      }),
    });

    await press(button(CANCEL_LABEL));

    expect(cancel).toHaveBeenCalledExactlyOnceWith(SECURITY_PATCH_ID, DRY_RUN_ID);
    expect(within(card()).getByRole("group", { name: CANCELLED_HEADING })).toHaveTextContent(PARTIAL_NOTE);
    expect(rows()).toHaveLength(3);
    expect(within(card()).queryByRole("button", { name: CANCEL_LABEL })).toBeNull();
    expect(fake.source.closed).toBe(true);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("tells the conversation's composer a run is in the way, and that it ended", async () => {
    const { fake } = renderLive();

    expect(readCopilotLive(SECURITY_PATCH_ID).dryRun).toEqual({ id: DRY_RUN_ID, status: "running" });

    await fake.emit({ kind: "done", dryRun: seededDryRun() });
    await settle();

    expect(readCopilotLive(SECURITY_PATCH_ID).dryRun).toBe(false);
  });

  it("says nothing to the composer about a run that was never in flight here", () => {
    renderCard();

    expect(readCopilotLive(SECURITY_PATCH_ID).dryRun).toBeNull();
  });

  it("stops following when the card leaves", () => {
    const { fake, unmount } = renderLive();

    unmount();

    expect(fake.source.closed).toBe(true);
  });
});

describe("how a run ended", () => {
  it("draws a failure in the service's words, with the rows it reached", () => {
    const run = seededDryRun({
      status: "failed",
      failureReason: "Stage implement: the model returned no diff after three attempts.",
      stages: seededStages().slice(0, 2),
      artifacts: [],
    });
    renderCard({ board: seededBoard({ run, suggestions: [] }) });

    const state = within(card()).getByRole("group", { name: FAILED_HEADING });

    expect(state).toHaveTextContent("Stage implement: the model returned no diff after three attempts.");
    expect(state).toHaveTextContent(PARTIAL_NOTE);
    expect(rows()).toHaveLength(2);
    expect(within(card()).queryByRole("alert")).toBeNull();
  });

  it("marks a failed stage ✕", () => {
    const stages = [...seededStages().slice(0, 2), dryRunStage({ seq: 3, stageKey: "implement", displayName: "implement", verdict: "failed", note: "no diff" })];
    renderCard({ board: seededBoard({ run: seededDryRun({ status: "failed", failureReason: "x", stages }), suggestions: [] }) });

    expect(line(rows()[2])).toBe("✕failed: implementno diff");
    expect(rows()[2].querySelector(".copilot-dry__mark")).toHaveClass("copilot-dry__mark--err");
  });

  it("says what stopped a budget-stopped run, the cap and whose it was, with partial rows", () => {
    const run = seededDryRun({
      status: "budget_stopped",
      failureReason: "The run reached its $5.00 cap during review.",
      stages: seededStages().slice(0, 5),
    });
    renderCard({ board: seededBoard({ run, suggestions: [] }) });

    const state = within(card()).getByRole("group", { name: BUDGET_HEADING });

    expect(state).toHaveTextContent("The run reached its $5.00 cap during review.");
    expect(state).toHaveTextContent("Its cap was $5.00 — the draft's own spend guard.");
    // What was spent, and what to change (#569).
    expect(state).toHaveTextContent(budgetSpentLine(run.totals)!);
    expect(state).toHaveTextContent(budgetAdvice(run.budget));
    expect(rows()).toHaveLength(5);
  });

  it("lists a failed pre-check's findings, each a link to its stage's row — not an opaque error", () => {
    const run = seededDryRun({
      status: "failed",
      failureReason: "The draft did not pass the pre-check.",
      stages: [],
      artifacts: [],
      precheckFindings: [
        { source: "dsl", code: "unreachable_node", message: "Nothing leads to this stage.", node: "plan" },
        { source: "registry", code: "unknown_alias", message: "No alias coder-xl.", node: "implement" },
        { source: "engine", code: "no_terminal", message: "The graph has no end." },
      ],
    });
    renderCard({ board: seededBoard({ run, suggestions: [] }) });

    const state = within(card()).getByRole("group", { name: PRECHECK_HEADING });
    const links = within(state).getAllByRole("link");

    expect(links.map((link) => link.getAttribute("href"))).toEqual([stageAnchorHref("plan"), stageAnchorHref("implement")]);
    expect(links[0]).toHaveTextContent("Nothing leads to this stage.");
    expect(links[0]).toHaveTextContent(findingStageTarget("plan"));
    expect(state).toHaveTextContent("The graph has no end.");
    expect(within(card()).queryByRole("group", { name: FAILED_HEADING })).toBeNull();
    expect(screen.queryByRole("list", { name: ROWS_LABEL })).toBeNull();
  });

  it("draws a guard-audit violation as an alert naming each blocked call — never as an ordinary failure", () => {
    const run = seededDryRun({
      status: "failed",
      failureReason: "A guard refused a call, so this run is not trusted.",
      guardsClean: false,
      guardAudit: [
        { guard: "allow_list", call: "git push origin main", count: 2, stage_key: "implement" },
        { guard: "workspace_boundary", call: "write /etc/hosts", count: 1, stage_key: "build" },
      ],
    });
    renderCard({ board: seededBoard({ run, suggestions: [] }) });

    const alert = within(card()).getByRole("alert");

    expect(alert).toHaveClass("copilot-dry__guard");
    expect(alert).toHaveAccessibleName(GUARD_HEADING);
    expect(within(alert).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "git push origin main — refused by allow_list, 2 times, in stage implement",
      "write /etc/hosts — refused by workspace_boundary, once, in stage build",
    ]);
    expect(alert).toHaveTextContent("A guard refused a call, so this run is not trusted.");
    expect(within(card()).queryByRole("group", { name: FAILED_HEADING })).toBeNull();
    expect(rows()).toHaveLength(7);
  });

  it("draws no state box at all for a clean, complete run", () => {
    renderCard();

    expect(card().querySelector(".copilot-dry__state, .copilot-dry__guard, .copilot-dry__refusal")).toBeNull();
  });
});

describe("Apply to draft", () => {
  /** What a successful apply answers. */
  function applied() {
    return {
      ok: true as const,
      value: { suggestion: { ...seededSuggestions()[0], status: "applied" as const }, draftRev: 4, draftLabel: "v0.4", etag: "etag-4" },
    };
  }

  it("previews the typed operations and the revision before anything is posted", async () => {
    const apply = vi.fn(async () => applied());
    renderCard({ transport: dryRunTransport({ apply }) });

    await press(button(APPLY_LABEL, callouts()[0]));

    const dialog = screen.getByRole("dialog", { name: APPLY_TITLE });

    expect(apply).not.toHaveBeenCalled();
    expect(within(dialog).getAllByRole("listitem").map((item) => item.querySelector(".copilot-dry__op-phrase")?.textContent)).toEqual([
      "adding stage has-cve",
      "disconnecting test → exploit-verify",
      "connecting test → has-cve",
      "connecting has-cve → exploit-verify",
      "connecting has-cve → review-primary",
      "connecting has-cve → review-second",
    ]);
    expect(dialog).toHaveTextContent("This makes draft v0.4.");
    // The raw kind and params are there on expand.
    expect(dialog.querySelectorAll("details")).toHaveLength(6);
    expect(dialog.querySelector("details")).toHaveTextContent("add_stage");
    expect(dialog.querySelector("details pre")?.textContent).toContain('"id": "has-cve"');
  });

  it("changes nothing when the preview is cancelled", async () => {
    const apply = vi.fn(async () => applied());
    renderCard({ transport: dryRunTransport({ apply }) });

    await press(button(APPLY_LABEL, callouts()[0]));
    await press(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(apply).not.toHaveBeenCalled();
    expect(callouts()).toHaveLength(2);
  });

  it("posts on confirm, leaves a toast naming the new revision with links to the changed rows, and re-reads", async () => {
    const apply = vi.fn(async () => applied());
    renderCard({ transport: dryRunTransport({ apply }) });

    await press(button(APPLY_LABEL, callouts()[0]));
    await press(within(screen.getByRole("dialog")).getByRole("button", { name: APPLY_CONFIRM }));

    expect(apply).toHaveBeenCalledExactlyOnceWith(SECURITY_PATCH_ID, DRY_RUN_ID, SUGGESTION_SKIP_ID);
    expect(screen.queryByRole("dialog")).toBeNull();

    const toast = screen.getByRole("status");
    expect(toast).toHaveTextContent("Applied — the draft is now v0.4.");
    expect(within(toast).getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["has-cve", "#stage-has-cve"],
      ["test", "#stage-test"],
      ["exploit-verify", "#stage-exploit-verify"],
      ["review-primary", "#stage-review-primary"],
      ["review-second", "#stage-review-second"],
    ]);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("tells the stage list to read the draft again at once, and shows the suggestion as applied", async () => {
    renderCard({ transport: dryRunTransport({ apply: vi.fn(async () => applied()) }) });
    expect(readCopilotLive(SECURITY_PATCH_ID).revision).toBe(0);

    await press(button(APPLY_LABEL, callouts()[0]));
    await press(within(screen.getByRole("dialog")).getByRole("button", { name: APPLY_CONFIRM }));

    expect(readCopilotLive(SECURITY_PATCH_ID).revision).toBe(1);
    expect(callouts()).toHaveLength(1);
    expect(card().querySelector(".copilot-dry__resolved")).toHaveTextContent("Applied — Make exploit-verify conditional");
  });

  it("is inert on an advisory suggestion, with the reason in the callout", async () => {
    const apply = vi.fn(async () => applied());
    renderCard({ board: seededBoard({ suggestions: [ADVISORY_SUGGESTION] }), transport: dryRunTransport({ apply }) });

    const control = button(APPLY_LABEL, callouts()[0]);

    expect(control).toHaveAttribute("aria-disabled", "true");
    expect(control).toHaveAttribute("title", ADVISORY_REASON);
    expect(callouts()[0]).toHaveTextContent(ADVISORY_REASON);

    await press(control);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(apply).not.toHaveBeenCalled();
  });

  it("says the draft changed since the run on a conflict, and offers Re-run dry run", async () => {
    const message =
      "The draft has changed since this suggestion was made, and it no longer fits: stage test is gone. Run the dry run again to get suggestions for the draft as it is now.";
    const rerun = vi.fn(async () => ({ ok: true as const, value: runningDryRun({ id: "5eed008b-0000-4000-8000-000000000002" }) }));
    renderCard({
      transport: dryRunTransport({ apply: vi.fn(async () => refused("dry_run_suggestion_conflict", message)), rerun }),
    });

    await press(button(APPLY_LABEL, callouts()[0]));
    await press(within(screen.getByRole("dialog")).getByRole("button", { name: APPLY_CONFIRM }));

    const dialog = screen.getByRole("dialog", { name: APPLY_TITLE });
    expect(within(dialog).getByRole("alert")).toHaveTextContent(message);
    expect(within(dialog).getByRole("alert")).toHaveTextContent(RERUN_OFFER);
    expect(within(dialog).queryByRole("button", { name: APPLY_CONFIRM })).toBeNull();
    expect(readCopilotLive(SECURITY_PATCH_ID).revision).toBe(0);

    await press(within(dialog).getByRole("button", { name: RERUN_LABEL }));

    expect(rerun).toHaveBeenCalledExactlyOnceWith(SECURITY_PATCH_ID, DRY_RUN_ID);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("refreshes the card when somebody settled the suggestion first", async () => {
    const settled = [{ ...seededSuggestions()[0], status: "applied" as const }, seededSuggestions()[1]];
    const suggestions = vi.fn(async () => ({ ok: true as const, value: settled }));
    renderCard({
      transport: dryRunTransport({
        apply: vi.fn(async () => refused("dry_run_suggestion_resolved", "This suggestion was already applied.")),
        detail: vi.fn(async () => ({ ok: true as const, value: seededDryRun() })),
        suggestions,
      }),
    });

    await press(button(APPLY_LABEL, callouts()[0]));
    await press(within(screen.getByRole("dialog")).getByRole("button", { name: APPLY_CONFIRM }));
    await settle();

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(suggestions).toHaveBeenCalledOnce();
    expect(callouts()).toHaveLength(1);
    expect(refresh).toHaveBeenCalled();
  });

  it("keeps any other refusal in the dialog, in the service's words", async () => {
    renderCard({ transport: dryRunTransport({ apply: vi.fn(async () => refused("forbidden", "Your role cannot apply suggestions.", 403)) }) });

    await press(button(APPLY_LABEL, callouts()[0]));
    await press(within(screen.getByRole("dialog")).getByRole("button", { name: APPLY_CONFIRM }));

    expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent("Your role cannot apply suggestions.");
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: APPLY_CONFIRM })).toBeInTheDocument();
  });
});

describe("Explain, and the confidence", () => {
  it("opens the confidence to its scoring basis — the service's method and inputs, as data", () => {
    renderCard();

    const control = button(confidenceButtonName("93%"));
    const basis = document.getElementById(control.getAttribute("aria-controls")!)!;

    expect(control).toHaveAttribute("aria-expanded", "false");
    expect(basis).not.toBeVisible();

    fireEvent.click(control);

    expect(control).toHaveAttribute("aria-expanded", "true");
    expect([...basis.querySelectorAll("dt")].map((term) => term.textContent)).toEqual([
      "method",
      "rule",
      "rule_version",
      "rule_strength",
      "sample_adequacy",
      "outcome",
      "deterministic",
      "observations",
    ]);
    expect(basis).toHaveTextContent("rule_strength_x_sample_adequacy");
    expect(basis).toHaveTextContent("0.95");

    fireEvent.keyDown(basis, { key: "Escape" });
    expect(control).toHaveAttribute("aria-expanded", "false");
    expect(control).toHaveFocus();
  });

  it("shows the rule, its version and pack, when it fires, what it computed and how it scored", async () => {
    const explanation = vi.fn(async () => ({ ok: true as const, value: seededExplanation() }));
    renderCard({ transport: dryRunTransport({ explanation }) });

    await press(button(EXPLAIN_LABEL, callouts()[0]));

    const dialog = screen.getByRole("dialog", { name: EXPLAIN_TITLE });

    expect(explanation).toHaveBeenCalledExactlyOnceWith(SECURITY_PATCH_ID, DRY_RUN_ID, SUGGESTION_SKIP_ID);
    expect(dialog).toHaveTextContent("skipped-nothing-to-do v1 · rule pack v1");
    expect(dialog).toHaveTextContent("A stage skipped because the ticket carried nothing for it to do.");
    expect(dialog).toHaveTextContent("A decision ahead of the stage that routes such tickets around it.");
    expect(dialog).toHaveTextContent("0.95 for a deterministic outcome.");

    const evidence = within(dialog).getAllByLabelText(EVIDENCE_HEADING)[0];
    expect([...evidence.querySelectorAll("dt")].map((term) => term.textContent)).toEqual([
      "stage_key",
      "verdict",
      "skip_kind",
      "skip_input",
      "ticket",
      "ticket_labels",
      "trigger_labels",
    ]);
    expect(evidence).toHaveTextContent("bug, can-bus");
    expect(dialog).toHaveTextContent("adding stage has-cve");
  });

  it("says plainly that a model's suggestion came from the model and is unscored, with its basis", async () => {
    const explanation = vi.fn(async () => ({
      ok: true as const,
      value: seededExplanation({
        suggestionId: LLM_SUGGESTION.id,
        source: "llm",
        rule: null,
        evidence: { stage_key: "plan" },
        confidence: null,
        confidenceBasis: LLM_SUGGESTION.confidenceBasis,
        proposedOps: LLM_SUGGESTION.proposedOps,
      }),
    }));
    renderCard({ board: seededBoard({ suggestions: [LLM_SUGGESTION] }), transport: dryRunTransport({ explanation }) });

    await press(button(EXPLAIN_LABEL, callouts()[0]));

    const dialog = screen.getByRole("dialog", { name: EXPLAIN_TITLE });
    expect(dialog).toHaveTextContent(LLM_EXPLANATION);
    expect(dialog).toHaveTextContent("llm_unscored");
    expect(dialog).toHaveTextContent("coder-max");
    expect(dialog).not.toHaveTextContent(/\d+%/);
  });

  it("says why when the explanation cannot be read, and closes", async () => {
    renderCard({ transport: dryRunTransport({ explanation: vi.fn(async () => refused("dry_run_suggestion_not_found", "This dry run has no such suggestion.", 404)) }) });

    await press(button(EXPLAIN_LABEL, callouts()[0]));
    expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent("This dry run has no such suggestion.");

    await press(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("a suggestion the model made", () => {
  it("is labelled, carries no percentage and no confidence control, and can still be applied", () => {
    renderCard({ board: seededBoard({ suggestions: [...seededSuggestions(), LLM_SUGGESTION] }) });

    const model = callouts()[2];

    expect(within(model).getByText(LLM_LABEL)).toBeInTheDocument();
    expect(model).not.toHaveTextContent(/\d+%/);
    expect(within(model).queryByRole("button", { name: /Confidence/ })).toBeNull();
    expect(model).not.toHaveTextContent("rule ·");
    expect(button(APPLY_LABEL, model)).not.toHaveAttribute("aria-disabled");
    // The rule's ones beside it are told apart.
    expect(callouts()[0]).not.toHaveTextContent(LLM_LABEL);
  });
});

describe("Ignore", () => {
  it("posts, takes the callout away, and leaves a quiet line saying it will not be raised again", async () => {
    const ignore = vi.fn(async () => ({ ok: true as const, value: { ...seededSuggestions()[1], status: "ignored" as const } }));
    renderCard({ transport: dryRunTransport({ ignore }) });

    await press(button(IGNORE_LABEL, callouts()[1]));

    expect(ignore).toHaveBeenCalledExactlyOnceWith(SECURITY_PATCH_ID, DRY_RUN_ID, SUGGESTION_REVIEW_ID);
    expect(callouts()).toHaveLength(1);
    expect(card().querySelector(".copilot-dry__resolved")).toHaveTextContent(
      "Ignored — Pin the pr-etiquette skill to both reviewers (it will not be raised again for this draft revision)",
    );
  });

  it("keeps the callout and says why when the service refuses", async () => {
    renderCard({ transport: dryRunTransport({ ignore: vi.fn(async () => refused("forbidden", "Your role cannot ignore suggestions.", 403)) }) });

    await press(button(IGNORE_LABEL, callouts()[0]));

    expect(callouts()).toHaveLength(2);
    expect(within(callouts()[0]).getByRole("alert")).toHaveTextContent("Your role cannot ignore suggestions.");
  });

  it("draws suggestions the read says are settled as quiet lines, never as callouts", () => {
    const [skip, review] = seededSuggestions();
    renderCard({ board: seededBoard({ suggestions: [{ ...skip, status: "applied" }, { ...review, status: "ignored" }] }) });

    expect(screen.queryByRole("list", { name: SUGGESTIONS_LABEL })).toBeNull();
    expect(card().querySelectorAll(".copilot-dry__resolved-line")).toHaveLength(2);
    expect(card().querySelector(".copilot-dry__suggest")).toBeNull();
  });

  it("says so when the suggestions could not be read, rather than drawing none", () => {
    renderCard({ board: seededBoard({ suggestions: null }) });

    expect(card()).toHaveTextContent(SUGGESTIONS_UNREAD);
  });
});

describe("Re-run dry run", () => {
  it("posts the re-run for the shown run and follows the run it answers with", async () => {
    const next = runningDryRun({ id: "5eed008b-0000-4000-8000-000000000002", status: "precheck", stages: [], startedAt: "2026-09-14T10:00:00.000Z" });
    const rerun = vi.fn(async () => ({ ok: true as const, value: next }));
    const fake = fakeSource();
    renderCard({ transport: dryRunTransport({ rerun }), openSource: (url) => fake.open(url) });

    await press(button(RERUN_LABEL));

    expect(rerun).toHaveBeenCalledExactlyOnceWith(SECURITY_PATCH_ID, DRY_RUN_ID);
    expect(fake.urls).toEqual([`/api/workflows/${SECURITY_PATCH_ID}/dry-runs/${next.id}/events`]);
    expect(card()).toHaveTextContent(QUEUED_NOTE);
    expect(card().querySelector("[aria-live='polite']")).toHaveTextContent("Dry run on #489 started.");
    expect(button(CANCEL_LABEL)).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("says which draft it runs on when the draft has moved since the run", () => {
    const history = seededHistory({ draft: { label: "v0.4", rev: 4, baseVersion: null, copilotEdits: 2 } });
    const { unmount } = renderCard({ board: seededBoard({ history }) });
    expect(card()).toHaveTextContent("re-runs on draft v0.4");
    unmount();

    renderCard();
    expect(card()).not.toHaveTextContent("re-runs on draft");
  });
});

describe("Dry-run another issue", () => {
  /** A transport that ranks two candidates. */
  function ranking(overrides = {}) {
    return dryRunTransport({
      candidates: vi.fn(async () => ({ ok: true as const, value: [dryRunCandidate(), CANDIDATE_490] })),
      ...overrides,
    });
  }

  it("reads the candidates when it opens, and lists each with its rank, key, title and the service's reason", async () => {
    const transport = ranking();
    renderCard({ transport });

    const toggle = button(/^Dry-run another issue/);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(transport.candidates).not.toHaveBeenCalled();

    await press(toggle);

    const panel = within(card()).getByRole("group", { name: PICKER_PANEL_LABEL });
    const items = within(panel).getAllByRole("listitem");

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAttribute("aria-controls", panel.id);
    expect(transport.candidates).toHaveBeenCalledExactlyOnceWith(SECURITY_PATCH_ID);
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("1#489 CAN arbitration-lost storm under full telemetry load");
    expect(items[0]).toHaveTextContent("Carries no cve label — exercises the path that skips exploit-verify.");
    expect(items[1]).toHaveTextContent("2#490 Bootloader accepts unsigned image over DFU");
    expect(items[1]).toHaveTextContent("Has CVE-like labels — exercises the PoC path.");
  });

  it("still lists a candidate that would not trigger the workflow, marked", async () => {
    renderCard({ transport: ranking() });

    await press(button(/^Dry-run another issue/));
    const items = within(within(card()).getByRole("group", { name: PICKER_PANEL_LABEL })).getAllByRole("listitem");

    expect(items[0]).toHaveTextContent(OFF_TRIGGER_LABEL);
    expect(items[1]).not.toHaveTextContent(OFF_TRIGGER_LABEL);
  });

  it("starts a run on the chosen ticket, with the draft's revision and the active conversation's session", async () => {
    const next = runningDryRun({ id: "5eed008b-0000-4000-8000-000000000002", status: "precheck", stages: [], startedAt: "2026-09-14T10:00:00.000Z" });
    const start = vi.fn(async () => ({ ok: true as const, value: next }));
    renderCard({ transport: ranking({ start }) });

    await press(button(/^Dry-run another issue/));
    await press(button(startLabel("#490")));

    expect(start).toHaveBeenCalledExactlyOnceWith(SECURITY_PATCH_ID, {
      ticketId: CANDIDATE_490.ticket.id,
      draftRev: 3,
      sessionId: SESSION_ID,
    });
    expect(within(card()).queryByRole("group", { name: PICKER_PANEL_LABEL })).toBeNull();
    expect(card()).toHaveTextContent(QUEUED_NOTE);
  });

  it("names no session when the conversation is closed, or there is none", async () => {
    const start = vi.fn(async () => refused("x", "x"));
    const { unmount } = renderCard({ conversation: closedConversation("promoted"), transport: ranking({ start }) });
    await press(button(/^Dry-run another issue/));
    await press(button(startLabel("#490")));
    unmount();

    renderCard({ conversation: null, transport: ranking({ start }) });
    await press(button(/^Dry-run another issue/));
    await press(button(startLabel("#490")));

    for (const [, body] of start.mock.calls as unknown as [string, object][]) expect(body).toEqual({ ticketId: CANDIDATE_490.ticket.id, draftRev: 3 });
  });

  it("closes on Escape with focus back on its control, and reads again the next time it opens", async () => {
    const transport = ranking();
    renderCard({ transport });
    const toggle = button(/^Dry-run another issue/);

    await press(toggle);
    fireEvent.keyDown(within(card()).getByRole("group", { name: PICKER_PANEL_LABEL }), { key: "Escape" });

    expect(within(card()).queryByRole("group", { name: PICKER_PANEL_LABEL })).toBeNull();
    expect(toggle).toHaveFocus();

    await press(toggle);
    expect(transport.candidates).toHaveBeenCalledTimes(2);
  });

  it("says so when nothing ranks, and why when the candidates cannot be read", async () => {
    const { unmount } = renderCard({ transport: dryRunTransport({ candidates: vi.fn(async () => ({ ok: true as const, value: [] })) }) });
    await press(button(/^Dry-run another issue/));
    expect(card()).toHaveTextContent(PICKER_EMPTY);
    unmount();

    renderCard({ transport: dryRunTransport({ candidates: vi.fn(async () => refused("x", "The candidates could not be ranked.", 502)) }) });
    await press(button(/^Dry-run another issue/));
    expect(within(within(card()).getByRole("group", { name: PICKER_PANEL_LABEL })).getByRole("alert")).toHaveTextContent(
      "The candidates could not be ranked.",
    );
  });
});

describe("a start the service refuses", () => {
  /** Open the picker and start on #490, with a start that answers as told. */
  async function startRefused(code: string, message: string, status = 409) {
    const start = vi.fn(async () => refused(code, message, status));
    renderCard({
      transport: dryRunTransport({
        candidates: vi.fn(async () => ({ ok: true as const, value: [CANDIDATE_490] })),
        start,
      }),
    });

    await press(button(/^Dry-run another issue/));
    await press(button(startLabel("#490")));

    return within(card()).getByRole("alert");
  }

  it("shows the service's sentence in an alert inside the card, and keeps the previous run's results", async () => {
    const sentence = "GitHub could not pin a commit for acme-robotics/helios-firmware: the workspace has no GitHub token.";

    const alert = await startRefused("github_unavailable", sentence, 502);

    expect(alert).toHaveTextContent(sentence);
    expect(alert).toHaveTextContent("The previous run's results are still shown below.");
    expect(rows()).toHaveLength(7);
    expect(card().querySelector(".copilot-dry__diff")).not.toBeNull();
    expect(callouts()).toHaveLength(2);
    expect(card().querySelector(".copilot-dry__totals")).toHaveTextContent("2m 41s · $0.31");
    expect(screen.queryByRole("status")).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });

  it.each([
    ["dry_run_repository_unresolved", "#490 names no repository this workspace mirrors, so a dry run has nothing to read.", 422, /no repository/],
    ["dry_run_source_unsupported", "#490 comes from a custom source, which a workflow trigger cannot name.", 422, /tracker/],
    ["engine_unavailable", "The engine could not be reached.", 502, /engine is not available/],
  ])("heads %s as its own kind of refusal, over the service's words", async (code, message, status, heading) => {
    const alert = await startRefused(code, message, status);

    expect(alert).toHaveTextContent(heading);
    expect(alert).toHaveTextContent(message);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("reads the page again for a draft that moved, and says so", async () => {
    const alert = await startRefused("dry_run_draft_stale", "The draft changed since you opened it. Reload it and start the dry run again.");

    expect(alert).toHaveTextContent("The draft changed since you opened it.");
    expect(alert).toHaveTextContent("This page has read the draft again — start the dry run once more.");
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("reads the page again for a run that is already open, so the card follows it", async () => {
    const alert = await startRefused("dry_run_in_progress", "This workflow already has a dry run in progress. Follow it, or cancel it first.");

    expect(alert).toHaveTextContent(/already running/);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("can be dismissed", async () => {
    const alert = await startRefused("github_unavailable", "GitHub could not be reached.", 502);

    await press(within(alert).getByRole("button", { name: DISMISS_LABEL }));

    expect(within(card()).queryByRole("alert")).toBeNull();
  });

  it("shows a pre-check that failed at the start as its findings — the service answers that with a run", async () => {
    const failed = seededDryRun({
      id: "5eed008b-0000-4000-8000-000000000002",
      status: "failed",
      failureReason: "The draft did not pass the pre-check.",
      startedAt: "2026-09-14T10:00:00.000Z",
      stages: [],
      artifacts: [],
      precheckFindings: [{ source: "dsl", code: "unreachable_node", message: "Nothing leads to this stage.", node: "plan" }],
    });
    renderCard({
      transport: dryRunTransport({
        candidates: vi.fn(async () => ({ ok: true as const, value: [CANDIDATE_490] })),
        start: vi.fn(async () => ({ ok: true as const, value: failed })),
        detail: vi.fn(async () => ({ ok: true as const, value: failed })),
        suggestions: vi.fn(async () => ({ ok: true as const, value: [] })),
      }),
    });

    await press(button(/^Dry-run another issue/));
    await press(button(startLabel("#490")));

    const state = within(card()).getByRole("group", { name: PRECHECK_HEADING });
    expect(within(state).getByRole("link")).toHaveAttribute("href", "#stage-plan");
    expect(within(card()).queryByRole("alert")).toBeNull();
  });
});

describe("a viewer", () => {
  it("reads the same card with every control inert, and the reason", () => {
    renderCard({ mayContribute: false });

    expect(rows()).toHaveLength(7);
    expect(card().querySelector(".copilot-dry__diff")).not.toBeNull();
    expect(button(RERUN_LABEL)).toHaveAttribute("title", CONTROL_ROLE_REASON);
    expect(button(/^Dry-run another issue/)).toHaveAttribute("aria-disabled", "true");
    expect(card()).toHaveTextContent(CONTROL_ROLE_REASON);
    for (const callout of callouts()) {
      expect(button(APPLY_LABEL, callout)).toHaveAttribute("title", SUGGESTION_ROLE_REASON);
      expect(button(IGNORE_LABEL, callout)).toHaveAttribute("title", SUGGESTION_ROLE_REASON);
      // Reading how a suggestion was derived changes nothing, so it stays live.
      expect(button(EXPLAIN_LABEL, callout)).not.toHaveAttribute("aria-disabled");
    }
  });

  it("cannot open the picker or the Apply preview by pressing an inert control", async () => {
    const transport = dryRunTransport({ candidates: vi.fn(async () => ({ ok: true as const, value: [] })) });
    renderCard({ mayContribute: false, transport });

    await press(button(/^Dry-run another issue/));
    await press(button(APPLY_LABEL, callouts()[0]));

    expect(transport.candidates).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("cannot cancel a run in flight", () => {
    renderCard({ mayContribute: false, board: seededBoard({ run: runningDryRun(), suggestions: [] }) });

    expect(button(CANCEL_LABEL)).toHaveAttribute("title", CONTROL_ROLE_REASON);
  });
});

describe("a draft with no stages", () => {
  it("holds Re-run and the picker with the reason", () => {
    renderCard({ hasStages: false });

    expect(button(RERUN_LABEL)).toHaveAttribute("title", NO_STAGES_REASON);
    expect(button(/^Dry-run another issue/)).toHaveAttribute("title", NO_STAGES_REASON);
  });
});

describe("no dry run yet", () => {
  it("is an invitation: the plain title, the pill, and the way to choose an issue", () => {
    renderCard({ board: emptyBoard(), conversation: null });

    expect(screen.getByRole("region", { name: "Dry run" })).toBe(card());
    expect(card()).toHaveTextContent(EMPTY_TITLE);
    expect(card()).toHaveTextContent(EMPTY_NOTE);
    expect(card()).toHaveTextContent(SIMULATED_PILL);
    expect(button(new RegExp(`^${EMPTY_PICK_LABEL}`))).not.toHaveAttribute("aria-disabled");
    expect(screen.queryByRole("list", { name: ROWS_LABEL })).toBeNull();
    expect(card().querySelector(".copilot-dry__totals")).toBeNull();
    expect(card()).not.toHaveTextContent("The copilot suggested");
  });

  it("names the copilot's proposal with its reason, and starts it when its ticket is among the candidates", async () => {
    const start = vi.fn(async () => ({ ok: true as const, value: runningDryRun({ status: "precheck", stages: [] }) }));
    renderCard({
      board: emptyBoard(),
      transport: dryRunTransport({ candidates: vi.fn(async () => ({ ok: true as const, value: [CANDIDATE_490, dryRunCandidate({ rank: 2 })] })), start }),
    });

    expect(card()).toHaveTextContent(
      "The copilot suggested dry-running #489 — security workflow × no-CVE issue — exercises the skip path",
    );

    await press(button(startLabel("#489")));
    await settle();

    expect(start).toHaveBeenCalledExactlyOnceWith(SECURITY_PATCH_ID, { ticketId: TICKET_489_ID, draftRev: 3, sessionId: SESSION_ID });
    expect(card()).toHaveTextContent(QUEUED_NOTE);
  });

  it("opens the picker instead, and says why, when the proposed ticket is not among the candidates", async () => {
    const start = vi.fn();
    renderCard({
      board: emptyBoard(),
      transport: dryRunTransport({ candidates: vi.fn(async () => ({ ok: true as const, value: [CANDIDATE_490] })), start }),
    });

    await press(button(startLabel("#489")));
    await settle();

    const panel = within(card()).getByRole("group", { name: PICKER_PANEL_LABEL });
    expect(start).not.toHaveBeenCalled();
    expect(panel).toHaveTextContent(proposalMissing("#489"));
    expect(within(panel).getByRole("button", { name: startLabel("#490") })).toBeInTheDocument();
  });

  it("tells a viewer nobody has run one, with the controls inert", () => {
    renderCard({ board: emptyBoard(), mayContribute: false });

    expect(card()).toHaveTextContent(EMPTY_VIEWER_NOTE);
    expect(button(startLabel("#489"))).toHaveAttribute("title", CONTROL_ROLE_REASON);
    expect(button(new RegExp(`^${EMPTY_PICK_LABEL}`))).toHaveAttribute("aria-disabled", "true");
  });

  it("shows a refused first start in the card, where there is no previous run to keep", async () => {
    renderCard({
      board: emptyBoard(),
      conversation: null,
      transport: dryRunTransport({
        candidates: vi.fn(async () => ({ ok: true as const, value: [CANDIDATE_490] })),
        start: vi.fn(async () => refused("github_unavailable", "GitHub could not be reached.", 502)),
      }),
    });

    await press(button(new RegExp(`^${EMPTY_PICK_LABEL}`)));
    await press(button(startLabel("#490")));

    expect(within(card()).getByRole("alert")).toHaveTextContent("GitHub could not be reached.");
    expect(within(card()).getByRole("alert")).not.toHaveTextContent("previous run");
    expect(card()).toHaveTextContent(EMPTY_TITLE);
  });
});

describe("a new read of the page", () => {
  it("follows a run the next read brings, and keeps the suggestions it brings once it has ended", () => {
    const first = renderCard();
    const element = (board = seededBoard()) => (
      <CopilotFlows>
        <CopilotNotice />
        <DryRunCard {...first.props} board={board} />
      </CopilotFlows>
    );

    const history = seededHistory({ draft: { label: "v0.4", rev: 4, baseVersion: null, copilotEdits: 2 } });
    first.rerender(element(seededBoard({ history, suggestions: [seededSuggestions()[1]] })));

    expect(card()).toHaveTextContent("history: 1 dry run · draft v0.4 (2 copilot edits)");
    expect(callouts()).toHaveLength(1);
    expect(card()).toHaveTextContent("re-runs on draft v0.4");
  });
});

describe("accessibility", () => {
  it("is one named region with one heading, and adds no second region inside itself", () => {
    renderCard();

    expect(screen.getAllByRole("region")).toHaveLength(1);
    expect(within(card()).getAllByRole("heading")).toHaveLength(1);
  });

  it("names the rows, the suggestions and the diff's scroller", () => {
    renderCard();

    expect(screen.getByRole("list", { name: ROWS_LABEL })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: SUGGESTIONS_LABEL })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: DIFF_SCROLL_LABEL })).toBeInTheDocument();
    expect(callouts()[0]).toHaveAccessibleName("Make exploit-verify conditional");
  });

  it("has one polite live region, silent until a run starts or ends", () => {
    renderCard();

    const regions = card().querySelectorAll("[aria-live]");

    expect(regions).toHaveLength(1);
    expect(regions[0]).toHaveAttribute("aria-live", "polite");
    expect(regions[0]).toHaveTextContent("");
    expect(regions[0]).toHaveClass("sr-only");
  });

  it("opens Apply and Explain as modal dialogs, and gives focus back when they close", async () => {
    renderCard({ transport: dryRunTransport({ explanation: vi.fn(async () => ({ ok: true as const, value: seededExplanation() })) }) });

    const opener = button(EXPLAIN_LABEL, callouts()[0]);
    opener.focus();
    await press(opener);

    const dialog = screen.getByRole("dialog", { name: EXPLAIN_TITLE });
    expect(dialog).toHaveAttribute("aria-modal", "true");

    fireEvent.keyDown(dialog, { key: "Escape" });
    await settle();

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener).toHaveFocus();
  });

  it("marks every inert control as disabled to assistive technology, with its reason as the title", () => {
    renderCard({ mayContribute: false });

    for (const control of within(card()).getAllByRole("button").filter((each) => each.getAttribute("aria-disabled") === "true")) {
      expect(control.getAttribute("title")).toBeTruthy();
    }
  });

  it("draws nothing with an inline style", () => {
    renderCard();

    expect(card().querySelector("[style]")).toBeNull();
  });
});

describe("both palettes", () => {
  it.each(PALETTES)("draws the seeded card under the %s palette", (palette) => {
    renderInPalette(
      palette,
      <DryRunCard
        board={seededBoard()}
        definition={seededDraftDefinition()}
        mayContribute
        transport={dryRunTransport()}
        workflowId={SECURITY_PATCH_ID}
      />,
    );

    expect(rows()).toHaveLength(7);
    expect(callouts()).toHaveLength(2);
  });

  it("draws the same markup in both, because the palette is CSS's business", () => {
    const [light, dark] = renderInBothPalettes(
      <DryRunCard board={seededBoard()} mayContribute transport={dryRunTransport()} workflowId={SECURITY_PATCH_ID} />,
    );

    expect(maskIds(light)).toBe(maskIds(dark));
  });

  it("draws every end state the same in both", () => {
    for (const run of [
      runningDryRun(),
      seededDryRun({ status: "cancelled" }),
      seededDryRun({ status: "budget_stopped", failureReason: "cap" }),
      seededDryRun({ status: "failed", guardsClean: false, guardAudit: [{ guard: "g", call: "c", count: 1 }] }),
    ]) {
      const [light, dark] = renderInBothPalettes(
        <DryRunCard
          board={seededBoard({ run, suggestions: [] })}
          openSource={() => fakeSource().source}
          transport={dryRunTransport()}
          workflowId={SECURITY_PATCH_ID}
        />,
      );

      expect(maskIds(light)).toBe(maskIds(dark));
    }
  });
});

describe("the store, left as it was found", () => {
  it("does not overwrite another page session's account of a run it knows nothing newer about", () => {
    publishDryRun(SECURITY_PATCH_ID, { id: DRY_RUN_ID, status: "running" });

    renderCard();

    // The shown run has ended, and the store said one was in flight: the card corrects it.
    expect(readCopilotLive(SECURITY_PATCH_ID).dryRun).toBe(false);
  });
});
