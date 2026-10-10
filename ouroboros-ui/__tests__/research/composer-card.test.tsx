import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ADMIN_ONLY_START_REASON,
  CANCELLED_NOTE,
  CANCEL_LABEL,
  COMPOSER_UNAVAILABLE_TITLE,
  ESTIMATE_FAILED_REASON,
  ESTIMATE_NEEDS_TOOLS,
  ESTIMATE_PENDING_REASON,
  ESTIMATE_UNAVAILABLE,
  NO_KINDS_NOTE,
  NO_QUESTION_REASON,
  NO_RESEARCHER_REASON,
  NO_TOOLS_REASON,
  QUESTION_LABEL,
  QUESTION_PLACEHOLDER,
  RELOAD_LABEL,
  START_ANOTHER_LABEL,
  START_LABEL,
  VIEWER_START_REASON,
  VIEW_BRIEF_LABEL,
  runOf,
} from "@/app/research/composer";
import type { ComposerCardProps } from "@/app/research/composer-card";
import { progressUrl } from "@/app/research/progress";

import { maskIds, renderInBothPalettes } from "../helpers/palettes";
import {
  FakeProgressSource,
  SEEDED_LABEL,
  STARTED_ID,
  composerReadings,
  depthEstimates,
  investigationDetail,
  openFakeSource,
  progress,
  startedInvestigation,
} from "../helpers/research";

/**
 * Mockup 22's composer as it is drawn (#628). The acceptance criteria this suite holds, in the
 * ticket's words: **the seeded composer matches the mockup** — gap analysis selected, five tool
 * chips on, the sixth idle, `est. 40–60 sources · ~$6`; **toggling a tool or changing depth
 * re-estimates visibly**; **an unpriced alias sees a source range and no dollars anywhere**; **the
 * researcher pill shows the resolved alias**; **the disconnected chip is not toggleable and
 * explains where to enable it**; **start → progress with the source count increasing and cancel
 * working**; **cancelling shows the partial state**; and the role gate with its explanation.
 */

const estimateComposer = vi.fn();
const startInvestigation = vi.fn();
const cancelInvestigation = vi.fn();
const readInvestigation = vi.fn();
const refresh = vi.fn();
const onBriefReady = vi.fn();

vi.mock("@/app/research/composer-actions", () => ({
  estimateComposer: (request: unknown) => estimateComposer(request),
  startInvestigation: (body: unknown) => startInvestigation(body),
  cancelInvestigation: (id: unknown) => cancelInvestigation(id),
  readInvestigation: (id: unknown) => readInvestigation(id),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const { ComposerCard } = await import("@/app/research/composer-card");

const FIVE = [
  "Web search & page reader",
  "Competitor tracker",
  "Codebase & git mining",
  "Issue & PR history index",
  "Build & test telemetry",
];

function card(over: Partial<ComposerCardProps> = {}) {
  return (
    <ComposerCard
      estimateDelayMs={0}
      gate={null}
      onBriefReady={onBriefReady}
      openSource={openFakeSource}
      readings={composerReadings()}
      {...over}
    />
  );
}

/** Render, and wait for the seeded estimate to be on the line. */
async function settled(over: Partial<ComposerCardProps> = {}) {
  const rendered = render(card(over));
  await screen.findByText(SEEDED_LABEL);

  return rendered;
}

function chip(name: string): HTMLElement {
  return screen.getByRole("button", { name });
}

function startButton(): HTMLElement {
  return screen.getByRole("button", { name: START_LABEL });
}

function ask(question = "Why are we behind on docking?"): void {
  fireEvent.change(screen.getByLabelText(QUESTION_LABEL), { target: { value: question } });
}

/** Start a run and wait for its surface. */
async function started(): Promise<FakeProgressSource> {
  await settled();
  ask();
  fireEvent.click(startButton());
  await screen.findByText("RS-128");

  return FakeProgressSource.latest();
}

beforeEach(() => {
  estimateComposer.mockReset().mockResolvedValue({ ok: true, estimates: depthEstimates() });
  startInvestigation.mockReset().mockResolvedValue({ ok: true, run: runOf(startedInvestigation()) });
  cancelInvestigation.mockReset();
  readInvestigation.mockReset().mockResolvedValue({ ok: true, detail: investigationDetail() });
  refresh.mockReset();
  onBriefReady.mockReset();
  FakeProgressSource.reset();
});

describe("the seeded composer", () => {
  it("matches the mockup: gap analysis selected, five chips on, the sixth idle, the estimate line", async () => {
    await settled();

    expect(screen.getByRole("radio", { name: "Gap analysis" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getAllByRole("radio").map((radio) => radio.textContent)).toEqual([
      "Bug root cause",
      "Regression forensics",
      "Roadmap & improvements",
      "Gap analysis",
    ]);
    for (const name of FIVE) expect(chip(name)).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^Depth: Deep dive/ })).toBeInTheDocument();
    expect(screen.getByText(SEEDED_LABEL)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: START_LABEL })).toBeInTheDocument();
  });

  it("asks like a principal engineer, with the issue's example as the placeholder", async () => {
    await settled();
    const field = screen.getByLabelText(QUESTION_LABEL);

    expect(field.tagName).toBe("TEXTAREA");
    expect(field).toHaveAttribute("placeholder", QUESTION_PLACEHOLDER);
    expect(field).toHaveValue("");
  });

  it("names the deliverable per the kind's playbook and links Planning", async () => {
    await settled();

    expect(
      screen.getByText(/Deliverable: cited research brief → capability matrix → drafted epics & tickets in/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Planning" })).toHaveAttribute("href", "/planning");
  });

  it("prints the resolved alias on the researcher pill", async () => {
    await settled();

    expect(screen.getByText("researcher: researcher-long-ctx")).toBeInTheDocument();
  });

  it("estimates the seeded choices once, every depth together", async () => {
    await settled();

    expect(estimateComposer).toHaveBeenCalledExactlyOnceWith({
      kind: "gap_analysis",
      tools: ["web", "competitor", "code", "tickets", "telemetry"],
    });
  });

  it("renders the same markup under both palettes", () => {
    const [light, dark] = renderInBothPalettes(card()).map(maskIds);

    expect(light).toBe(dark);
  });
});

describe("the disconnected tool", () => {
  it("is not a toggle: a link to the tools card that says where to enable it", async () => {
    await settled();
    const papers = screen.getByRole("link", { name: "Docs, standards & papers" });

    expect(papers).toHaveAttribute("href", "#tools");
    expect(papers).toHaveAttribute(
      "title",
      "Docs, standards & papers is not connected yet — enable it in Research tools.",
    );
    expect(papers).not.toHaveAttribute("aria-pressed");
    expect(screen.queryByRole("button", { name: "Docs, standards & papers" })).toBeNull();
  });
});

describe("re-estimating", () => {
  it("re-estimates visibly when a tool is toggled", async () => {
    await settled();
    estimateComposer.mockResolvedValueOnce({
      ok: true,
      estimates: depthEstimates(true, { label: "est. 28–42 sources · ~$4" }),
    });

    fireEvent.click(chip("Web search & page reader"));

    await screen.findByText("est. 28–42 sources · ~$4");
    expect(chip("Web search & page reader")).toHaveAttribute("aria-pressed", "false");
    expect(estimateComposer).toHaveBeenLastCalledWith({
      kind: "gap_analysis",
      tools: ["competitor", "code", "tickets", "telemetry"],
    });
  });

  it("keeps the last figures on the line, marked busy, until the new ones arrive", async () => {
    await settled();
    let answer: (value: unknown) => void = () => {};
    estimateComposer.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));

    fireEvent.click(chip("Web search & page reader"));

    await waitFor(() => expect(estimateComposer).toHaveBeenCalledTimes(2));
    expect(screen.getByText(SEEDED_LABEL)).toHaveAttribute("aria-busy", "true");

    await act(async () => {
      answer({ ok: true, estimates: depthEstimates(true, { label: "est. 28–42 sources · ~$4" }) });
    });
    expect(screen.getByText("est. 28–42 sources · ~$4")).toHaveAttribute("aria-busy", "false");
  });

  it("re-estimates visibly when the depth changes, from the figures already read", async () => {
    await settled();

    fireEvent.click(screen.getByRole("button", { name: /^Depth: Deep dive/ }));
    const list = screen.getByRole("listbox", { name: "Depth" });
    expect(within(list).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Quickest. 10–15 sources · ~$2",
      "Standardest. 20–30 sources · ~$3",
      `Deep dive${SEEDED_LABEL}`,
    ]);

    fireEvent.click(within(list).getByRole("option", { name: /^Standard/ }));

    expect(screen.getByText("est. 20–30 sources · ~$3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Depth: Standard/ })).toBeInTheDocument();
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(estimateComposer).toHaveBeenCalledTimes(1);
  });

  it("selects a kind's own defaults, and re-estimates for it", async () => {
    await settled();

    fireEvent.click(screen.getByRole("radio", { name: "Bug root cause" }));

    expect(screen.getByRole("radio", { name: "Bug root cause" })).toHaveAttribute("aria-checked", "true");
    expect(chip("Web search & page reader")).toHaveAttribute("aria-pressed", "false");
    expect(chip("Codebase & git mining")).toHaveAttribute("aria-pressed", "true");
    expect(chip("Build & test telemetry")).toHaveAttribute("aria-pressed", "true");
    await waitFor(() =>
      expect(estimateComposer).toHaveBeenLastCalledWith({
        kind: "bug_root_cause",
        tools: ["code", "tickets", "telemetry"],
      }),
    );
    expect(screen.getByText(/Deliverable: cited research brief → drafted fix ticket in/)).toBeInTheDocument();
  });

  it("walks the depth options from the keyboard and closes on Escape", async () => {
    await settled();
    const button = screen.getByRole("button", { name: /^Depth: Deep dive/ });

    fireEvent.click(button);
    const list = screen.getByRole("listbox", { name: "Depth" });
    const options = within(list).getAllByRole("option");
    expect(options[2]).toHaveFocus();

    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(options[0]).toHaveFocus();
    fireEvent.keyDown(list, { key: "End" });
    expect(options[2]).toHaveFocus();

    fireEvent.keyDown(list, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(button).toHaveFocus();
  });
});

describe("an unpriced researcher", () => {
  it("sees a source range and no dollars anywhere — the line, the menu, the pill", async () => {
    estimateComposer.mockResolvedValue({ ok: true, estimates: depthEstimates(false) });
    const { container } = render(card());
    await screen.findByText("est. 40–60 sources");

    fireEvent.click(screen.getByRole("button", { name: /^Depth: Deep dive/ }));
    ask();

    expect(container.textContent).not.toMatch(/\$/);
    expect(screen.getByText("researcher: researcher-experimental")).toBeInTheDocument();
    expect(startButton()).not.toHaveAttribute("aria-disabled");
  });
});

describe("why Start is inert", () => {
  it("waits for the question, then for a tool, then for the estimate", async () => {
    await settled();
    expect(startButton()).toHaveAttribute("aria-disabled", "true");
    expect(startButton()).toHaveAttribute("title", NO_QUESTION_REASON);

    ask();
    expect(startButton()).not.toHaveAttribute("aria-disabled");

    for (const name of FIVE) fireEvent.click(chip(name));
    expect(startButton()).toHaveAttribute("title", NO_TOOLS_REASON);
    expect(screen.getByText(ESTIMATE_NEEDS_TOOLS)).toBeInTheDocument();
    expect(screen.getByText("researcher: resolving…")).toBeInTheDocument();
  });

  it("is the workspace's gate first, in the gate's own words", async () => {
    await settled({ gate: ADMIN_ONLY_START_REASON });
    ask();

    expect(startButton()).toHaveAttribute("title", ADMIN_ONLY_START_REASON);

    fireEvent.click(startButton());
    expect(startInvestigation).not.toHaveBeenCalled();
  });

  it("is a viewer's role, in the frame's own words", async () => {
    await settled({ gate: VIEWER_START_REASON });
    ask();

    expect(startButton()).toHaveAttribute("title", VIEWER_START_REASON);
  });

  it("says the estimate is still being read, and when it could not be", async () => {
    let answer: (value: unknown) => void = () => {};
    estimateComposer.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    render(card());
    ask();

    await waitFor(() => expect(estimateComposer).toHaveBeenCalled());
    expect(startButton()).toHaveAttribute("title", ESTIMATE_PENDING_REASON);

    await act(async () => {
      answer({ ok: false, refusal: { code: "research_unavailable", message: "The estimator is away." } });
    });
    expect(screen.getByText(ESTIMATE_UNAVAILABLE)).toBeInTheDocument();
    expect(startButton()).toHaveAttribute("title", ESTIMATE_FAILED_REASON);
  });

  it("says when routing has no researcher to run", async () => {
    estimateComposer.mockResolvedValue({ ok: true, estimates: depthEstimates(true, { researcher: null, costCents: null, label: "est. 40–60 sources" }) });
    render(card());
    await screen.findByText("est. 40–60 sources");
    ask();

    expect(screen.getByText("researcher: none routed")).toBeInTheDocument();
    expect(startButton()).toHaveAttribute("title", NO_RESEARCHER_REASON);
  });
});

describe("starting", () => {
  it("posts the composer's choices and becomes a progress surface in place", async () => {
    const source = await started();

    expect(startInvestigation).toHaveBeenCalledExactlyOnceWith({
      question: "Why are we behind on docking?",
      kind: "gap_analysis",
      depth: "deep_dive",
      tools: ["web", "competitor", "code", "tickets", "telemetry"],
    });
    expect(source.url).toBe(progressUrl(STARTED_ID));
    expect(screen.getByText("queued · 0 sources")).toBeInTheDocument();
    expect(screen.getByText(SEEDED_LABEL)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: CANCEL_LABEL })).toBeInTheDocument();
    expect(screen.queryByLabelText(QUESTION_LABEL)).toBeNull();
    expect(screen.getByText("Why are we behind on docking?")).toBeInTheDocument();
  });

  it("ticks the source count and the spend so far as the stream reports them", async () => {
    const source = await started();

    act(() => source.emit("progress", { kind: "progress", ...progress({ sources: 12, spendCents: 140 }) }));
    expect(screen.getByText("running · 12 sources · $1.40")).toBeInTheDocument();
    expect(screen.getByText("round 1 of 4")).toBeInTheDocument();

    act(() => source.emit("progress", { kind: "progress", ...progress({ iteration: 2, sources: 31, spendCents: 390 }) }));
    expect(screen.getByText("running · 31 sources · $3.90")).toBeInTheDocument();
    expect(screen.getByText("round 2 of 4")).toBeInTheDocument();
  });

  it("prints no spend at all while the service reports none", async () => {
    const source = await started();

    act(() => source.emit("progress", { kind: "progress", ...progress({ sources: 7, spendCents: null }) }));

    expect(screen.getByText("running · 7 sources")).toBeInTheDocument();
    expect(screen.getByText(/running · 7 sources/).closest(".research__progress")?.textContent).not.toMatch(
      /\$(?!6)/,
    );
  });

  it("shows the service's refusal and starts nothing", async () => {
    startInvestigation.mockResolvedValue({
      ok: false,
      refusal: { code: "forbidden", message: "Only owners and admins may start an investigation here." },
    });
    await settled();
    ask();

    fireEvent.click(startButton());

    expect(await screen.findByRole("alert")).toHaveTextContent("Only owners and admins may start an investigation here.");
    expect(screen.queryByText("RS-128")).toBeNull();
    expect(FakeProgressSource.opened).toHaveLength(0);
  });
});

describe("a run that ends", () => {
  it("offers the brief once it is ready, and lands there", async () => {
    const source = await started();
    readInvestigation.mockResolvedValue({
      ok: true,
      detail: investigationDetail({ status: "brief_ready", progress: progress({ status: "brief_ready", sources: 44, spendCents: 590 }), mayCancel: false }),
    });

    act(() => source.emit("done", { kind: "done", ...progress({ status: "brief_ready", sources: 44, spendCents: 590 }) }));

    expect(onBriefReady).toHaveBeenCalledExactlyOnceWith(STARTED_ID);
    expect(screen.getByText("✓ brief ready · 44 sources · $5.90")).toBeInTheDocument();
    expect(source.closed).toBe(true);
    await waitFor(() => expect(readInvestigation).toHaveBeenCalledWith(STARTED_ID));

    fireEvent.click(screen.getByRole("button", { name: VIEW_BRIEF_LABEL }));
    expect(onBriefReady).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: CANCEL_LABEL })).toBeNull();
  });

  it("cancels, and shows the partial state rather than discarding the run", async () => {
    const source = await started();
    act(() => source.emit("progress", { kind: "progress", ...progress({ sources: 12, spendCents: 140 }) }));
    cancelInvestigation.mockResolvedValue({
      ok: true,
      state: "cancelling",
      run: runOf({
        investigation: investigationDetail({
          status: "running",
          progress: progress({ sources: 12, spendCents: 140, cancelRequested: true }),
        }),
        estimate: { label: "" },
      }),
    });
    readInvestigation.mockResolvedValue({
      ok: true,
      detail: investigationDetail({
        status: "cancelled",
        progress: progress({ status: "cancelled", sources: 12, spendCents: 140 }),
        mayCancel: false,
      }),
    });

    fireEvent.click(screen.getByRole("button", { name: CANCEL_LABEL }));

    await screen.findByText("cancelling · 12 sources · $1.40");
    expect(cancelInvestigation).toHaveBeenCalledExactlyOnceWith(STARTED_ID);

    act(() => source.emit("done", { kind: "done", ...progress({ status: "cancelled", sources: 12, spendCents: 140 }) }));

    expect(screen.getByText("cancelled · 12 sources · $1.40")).toBeInTheDocument();
    expect(screen.getByText(CANCELLED_NOTE)).toBeInTheDocument();
    expect(screen.getByText(SEEDED_LABEL)).toBeInTheDocument();
    expect(onBriefReady).not.toHaveBeenCalled();
    expect(source.closed).toBe(true);
    expect(screen.queryByRole("button", { name: VIEW_BRIEF_LABEL })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: START_ANOTHER_LABEL }));
    expect(screen.getByLabelText(QUESTION_LABEL)).toHaveValue("");
    expect(screen.queryByText("RS-128")).toBeNull();
  });

  it("says why a run failed, from the detail the stream does not carry", async () => {
    const source = await started();
    readInvestigation.mockResolvedValue({
      ok: true,
      detail: investigationDetail({
        status: "failed",
        progress: progress({ status: "failed", sources: 3 }),
        mayCancel: false,
        failure: { reason: "synthesis_failure", detail: "The invocation gateway is not available." },
      }),
    });

    act(() => source.emit("done", { kind: "done", ...progress({ status: "failed", sources: 3 }) }));

    expect(screen.getByText("failed · 3 sources")).toBeInTheDocument();
    expect(await screen.findByText(/The invocation gateway is not available\./)).toBeInTheDocument();
    expect(onBriefReady).not.toHaveBeenCalled();
  });

  it("reports a stream the service could not keep open", async () => {
    const source = await started();

    act(() => source.emit("error", { kind: "error", code: "investigation_not_found", message: "Gone." }));

    expect(screen.getByRole("alert")).toHaveTextContent("Gone.");
  });

  it("is inert to cancel for a reader who may not, and says who may", async () => {
    startInvestigation.mockResolvedValue({ ok: true, run: runOf(startedInvestigation({ mayCancel: false })) });
    await started();

    expect(screen.getByRole("button", { name: CANCEL_LABEL })).toHaveAttribute("aria-disabled", "true");
  });
});

describe("a composer that could not be read", () => {
  it("says so, with the service's reason, and offers a reload", () => {
    render(card({ readings: composerReadings({ kinds: { ok: false, reason: "The research service is away." } }) }));

    expect(screen.getByText(COMPOSER_UNAVAILABLE_TITLE)).toBeInTheDocument();
    expect(screen.getByText("The research service is away.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: START_LABEL })).toBeNull();
    expect(estimateComposer).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: RELOAD_LABEL }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("says a workspace with no kinds has nothing to start", () => {
    render(card({ readings: composerReadings({ kinds: { ok: true, value: { kinds: [] } } }) }));

    expect(screen.getByText(NO_KINDS_NOTE)).toBeInTheDocument();
    expect(estimateComposer).not.toHaveBeenCalled();
  });
});
