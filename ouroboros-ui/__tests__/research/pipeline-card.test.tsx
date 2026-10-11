import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  APPLIED_TITLE,
  APPLY_CONFIRM,
  APPLY_LABEL,
  APPLY_NOTE,
  APPLY_TITLE,
  CANCEL,
  DISMISS_LABEL,
  NO_ISSUES,
  NO_PIPELINE_TITLE,
  NO_SUGGESTIONS,
  OPEN_LABEL,
  OPEN_PENDING,
  PIPELINE_CAPTION,
  PIPELINE_TITLE,
  PIPELINE_UNREADABLE,
  RAW_LABEL,
  RELOAD,
  STEP_DOCUMENT,
  STEP_TRACKER,
  SUGGESTION_BUSY,
  SUGGESTION_READ_ONLY,
  VIEW_LABEL,
} from "@/app/research/pipeline";
import type { FeaturedPipelineSeatProps } from "@/app/research/pipeline-card";

import { maskIds, renderInBothPalettes } from "../helpers/palettes";
import {
  AI_SUGGESTION_ID,
  HUMAN_SUGGESTION_ID,
  ROADMAP_HREF,
  RS124_ID,
  appliedRoadmap,
  driftedRoadmap,
  featuredPipeline,
  roadmapItem,
  seededRoadmap,
} from "../helpers/research";

/**
 * The roadmap pipeline card (#631) against the seeded RS-124: both steps element by element, the
 * Rendered/Raw toggle, apply as a visible re-run, dismiss, the drift state, the pills, the skill
 * chips, and the seat's states without a card.
 */

const applyRoadmapSuggestion = vi.fn();
const dismissRoadmapSuggestion = vi.fn();
const refresh = vi.fn();

vi.mock("@/app/research/pipeline-actions", () => ({
  applyRoadmapSuggestion: (investigationId: unknown, suggestionId: unknown) =>
    applyRoadmapSuggestion(investigationId, suggestionId),
  dismissRoadmapSuggestion: (investigationId: unknown, suggestionId: unknown) =>
    dismissRoadmapSuggestion(investigationId, suggestionId),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh }) }));

const { FeaturedPipelineSeat } = await import("@/app/research/pipeline-card");

function seat(over: Partial<FeaturedPipelineSeatProps> = {}) {
  return <FeaturedPipelineSeat mayAdminister reading={{ ok: true, value: featuredPipeline() }} {...over} />;
}

/** The seat for a roadmap other than the seeded one. */
function seatOf(roadmap = seededRoadmap(), over: Partial<FeaturedPipelineSeatProps> = {}) {
  return seat({ reading: { ok: true, value: featuredPipeline({ roadmap }) }, ...over });
}

function card(): HTMLElement {
  return screen.getByRole("region", { name: /RS-124/ });
}

function documentStep(): HTMLElement {
  return screen.getByRole("group", { name: STEP_DOCUMENT });
}

function trackerStep(): HTMLElement {
  return screen.getByRole("group", { name: STEP_TRACKER });
}

/** The row of the issue with this number, in the tracker. */
function issueRow(key: string): HTMLElement {
  const row = within(trackerStep())
    .getAllByRole("listitem")
    .find((item) => item.textContent?.startsWith(key) === true);

  if (row === undefined) throw new Error(`no issue row ${key}`);

  return row;
}

/** A promise a test settles when it chooses, so the re-run can be seen in flight. */
function deferred<T>() {
  let settle!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });

  return { promise, settle };
}

beforeEach(() => {
  applyRoadmapSuggestion.mockReset().mockResolvedValue({ ok: true, roadmap: appliedRoadmap() });
  dismissRoadmapSuggestion.mockReset();
  refresh.mockReset();
});

describe("the head", () => {
  it("names the kind, the investigation and the card's argument", () => {
    render(seat());

    expect(card()).toBe(screen.getByRole("region", { name: "RS-124 — From brief to roadmap to issues" }));
    expect(within(card()).getByText("Roadmap & improvements")).toHaveClass("research__kind-chip", "research__kind--road");
  });

  it("links both skill chips to their Knowledge registry entries, in the order they run", () => {
    render(seat());

    const chips = within(card()).getAllByRole("link", { name: /^skill · / });

    expect(chips.map((chip) => chip.textContent)).toEqual(["skill · create-roadmap", "skill · create-issues"]);
    for (const chip of chips) expect(chip).toHaveAttribute("href", "/knowledge#skills-drafts");
    expect(chips[0]).toHaveAttribute("title", "create-roadmap · published v1 — open in the Knowledge registry");
  });

  it("opens ROADMAP.md at the address the service gives, in a new tab", () => {
    render(seat());

    const open = within(card()).getByRole("link", { name: OPEN_LABEL });

    expect(open).toHaveAttribute("href", ROADMAP_HREF);
    expect(open).toHaveAttribute("target", "_blank");
    expect(open).toHaveAttribute("rel", "noreferrer");
  });

  it("keeps the button, inert with its reason, while the document is not in the repository", () => {
    const seeded = seededRoadmap();

    render(seatOf(seededRoadmap({ projection: { ...seeded.projection, state: "pending", href: null } })));

    const open = within(card()).getByRole("button", { name: OPEN_LABEL });

    expect(open).toHaveAttribute("aria-disabled", "true");
    expect(open).toHaveAttribute("title", OPEN_PENDING);
    expect(within(card()).queryByRole("link", { name: OPEN_LABEL })).not.toBeInTheDocument();
  });
});

describe("step 1 — the document", () => {
  it("renders the seeded document: meta line, title, milestones and every item", () => {
    render(seat());

    const rendered = within(documentStep()).getByRole("group", { name: "ROADMAP.md, rendered" });

    expect(rendered).toHaveTextContent("docs/ROADMAP.md · committed 8c1b2e4 · generated from the RS-124 brief");
    expect(within(rendered).getByRole("heading", { name: "Helios — Q4 Improvement Roadmap" })).toBeInTheDocument();
    expect(within(rendered).getByRole("heading", { name: "M1 · Docking parity — target Oct 15" })).toBeInTheDocument();
    expect(within(rendered).getByRole("heading", { name: "M2 · Fleet reliability — target Nov 20" })).toBeInTheDocument();

    const items = within(rendered).getAllByRole("listitem");

    expect(items.map((item) => item.textContent)).toEqual([
      "[x]#742 Wind-feedforward MPC in final approachMVPL",
      "[ ]#743 Re-planned abort & retry vectorsMVPM",
      "[ ]#744 Gust estimator from IMU residualsM",
      "[ ]#745 Battery health model v2M",
      "[ ]#746 Telemetry gap alertsS",
      "[ ]#747 Operator recovery playbook docsXS",
    ]);
    expect(within(items[0]!).getByRole("img", { name: "Done" })).toHaveClass("research__md-box--done");
    expect(within(items[1]!).getByRole("img", { name: "Not done" })).not.toHaveClass("research__md-box--done");
  });

  it("shows an unfiled item without an issue number", () => {
    const seeded = seededRoadmap();
    const [m1, m2] = seeded.milestones;
    const unfiled = roadmapItem(0, { key: "new", title: "Dock telemetry export", ticket: null, estimate: null, status: null });

    render(seatOf(seededRoadmap({ milestones: [{ ...m1!, items: [unfiled] }, m2!] })));

    expect(within(documentStep()).getAllByRole("listitem")[0]).toHaveTextContent("[ ]Dock telemetry exportM");
    expect(issueRow("—")).toHaveTextContent("not filed");
  });

  it("toggles between the structured view and the projected Markdown", () => {
    render(seat());

    const views = within(documentStep()).getByRole("radiogroup", { name: VIEW_LABEL });
    const rendered = within(views).getByRole("radio", { name: "Rendered" });
    const raw = within(views).getByRole("radio", { name: "Raw .md" });

    expect(rendered).toBeChecked();
    expect(raw).not.toBeChecked();

    fireEvent.click(raw);

    expect(raw).toBeChecked();
    expect(within(documentStep()).queryByRole("group", { name: "ROADMAP.md, rendered" })).not.toBeInTheDocument();

    const markdown = within(documentStep()).getByLabelText(RAW_LABEL);

    expect(markdown.tagName).toBe("PRE");
    expect(markdown.textContent).toBe(seededRoadmap().markdown);
    expect(markdown).toHaveTextContent("- [x] #742 Wind-feedforward MPC in final approach `MVP` `L`");

    fireEvent.click(rendered);

    expect(within(documentStep()).getByRole("group", { name: "ROADMAP.md, rendered" })).toBeInTheDocument();
  });

  it("says why the projection could not be moved, when the service says so", () => {
    const seeded = seededRoadmap();
    const problem = "The repository refused the commit (permission).";

    render(seatOf(seededRoadmap({ projection: { ...seeded.projection, problem } })));

    expect(documentStep()).toHaveTextContent(problem);
  });

  it("scrolls the document and the issue list in their own wrappers, each reachable by keyboard", () => {
    render(seat());

    const rendered = within(documentStep()).getByRole("group", { name: "ROADMAP.md, rendered" });
    const issues = within(trackerStep()).getByRole("group", { name: "Issues by milestone" });

    for (const wrapper of [rendered, issues]) {
      expect(wrapper).toHaveClass("research__pipe-scroll");
      expect(wrapper).toHaveAttribute("tabindex", "0");
    }

    fireEvent.click(screen.getByRole("radio", { name: "Raw .md" }));

    expect(screen.getByLabelText(RAW_LABEL)).toHaveClass("research__pipe-scroll");
    expect(screen.getByLabelText(RAW_LABEL)).toHaveAttribute("tabindex", "0");
  });
});

describe("suggested changes", () => {
  it("lists the two open suggestions with who raised each, under the verbatim note", () => {
    render(seat());

    expect(within(documentStep()).getByRole("heading", { name: "Suggested changes — 2 open" })).toBeInTheDocument();
    expect(documentStep()).toHaveTextContent(APPLY_NOTE);
    expect(APPLY_NOTE).toBe("applying re-runs create-roadmap");

    const ks = within(documentStep()).getByText("KS");
    const ai = within(documentStep()).getByText("AI");

    expect(ks).toHaveAttribute("title", "Ken Suenobu");
    expect(ks).not.toHaveClass("research__sugg-who--ai");
    expect(ai).toHaveAttribute("title", "create-roadmap");
    expect(ai).toHaveClass("research__sugg-who--ai");
    expect(within(documentStep()).getByText("#744", { selector: ".research__sugg-ref" })).toBeInTheDocument();
    expect(within(documentStep()).getByText("#745", { selector: ".research__sugg-ref" })).toBeInTheDocument();
    expect(within(documentStep()).getAllByRole("button", { name: new RegExp(`^${APPLY_LABEL}: `) })).toHaveLength(2);
    expect(within(documentStep()).getAllByRole("button", { name: new RegExp(`^${DISMISS_LABEL}: `) })).toHaveLength(2);
  });

  it("asks before applying, and applies nothing when the reader cancels", () => {
    render(seat());

    fireEvent.click(screen.getByRole("button", { name: /^Apply ⟳: Pull #744/ }));

    const dialog = screen.getByRole("dialog", { name: APPLY_TITLE });

    expect(dialog).toHaveTextContent("Pull #744 into the M1 MVP set");
    expect(dialog).toHaveTextContent("re-runs create-roadmap");

    fireEvent.click(within(dialog).getByRole("button", { name: CANCEL }));

    expect(screen.queryByRole("dialog", { name: APPLY_TITLE })).not.toBeInTheDocument();
    expect(applyRoadmapSuggestion).not.toHaveBeenCalled();
  });

  it("applies as a re-run: the skill is seen running, then the next version re-renders and the suggestion is applied", async () => {
    const run = deferred<unknown>();

    applyRoadmapSuggestion.mockReturnValueOnce(run.promise);
    render(seat());

    expect(within(documentStep()).getByText("v1")).toBeInTheDocument();
    expect(within(documentStep()).getAllByRole("listitem")[2]).toHaveTextContent("[ ]#744 Gust estimator from IMU residualsM");

    fireEvent.click(screen.getByRole("button", { name: /^Apply ⟳: Pull #744/ }));
    fireEvent.click(screen.getByRole("button", { name: APPLY_CONFIRM }));

    // In flight: the skill named, the version it runs against, and the actions waiting on it.
    const status = within(documentStep()).getByRole("status");

    await waitFor(() => expect(status).toHaveTextContent("create-roadmapRe-running create-roadmap on v1…"));
    expect(applyRoadmapSuggestion).toHaveBeenCalledWith(RS124_ID, HUMAN_SUGGESTION_ID);
    expect(screen.queryByRole("dialog", { name: APPLY_TITLE })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Dismiss: Split #745/ })).toHaveAttribute("title", SUGGESTION_BUSY);
    expect(within(documentStep()).getByText("v1")).toBeInTheDocument();

    await act(async () => {
      run.settle({ ok: true, roadmap: appliedRoadmap() });
      await run.promise;
    });

    // Answered: the version advanced, the document re-rendered from it, the suggestion applied.
    await waitFor(() => expect(status).toHaveTextContent("✓ v2create-roadmap finished — v1 → v2"));
    expect(within(documentStep()).getByText("v2")).toBeInTheDocument();
    expect(within(documentStep()).queryByText("v1")).not.toBeInTheDocument();
    expect(within(documentStep()).getByRole("group", { name: "ROADMAP.md, rendered" })).toHaveTextContent(
      "[ ]#744 Gust estimator from IMU residualsMVPM",
    );
    expect(documentStep()).toHaveTextContent("docs/ROADMAP.md · pull request #88 open · generated from the RS-124 brief");
    expect(within(documentStep()).getByRole("heading", { name: "Suggested changes — 1 open" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Apply ⟳: Pull #744/ })).not.toBeInTheDocument();

    const applied = within(documentStep()).getByRole("list", { name: APPLIED_TITLE });

    expect(applied).toHaveTextContent("Pull #744 into the M1 MVP set");
    expect(applied).toHaveTextContent("applied · v2");
    // The tracker redraws from the same answer: a writeback that is not committed is not "synced".
    expect(trackerStep()).toHaveTextContent("6 issues · 2 milestones · writeback not committed yet");
    expect(within(card()).getByRole("link", { name: OPEN_LABEL })).toHaveAttribute(
      "href",
      "https://github.com/acme-robotics/helios-firmware/pull/88",
    );
  });

  it("prints the service's refusal and leaves the document on its version when a re-run fails", async () => {
    applyRoadmapSuggestion.mockResolvedValueOnce({
      ok: false,
      refusal: { code: "roadmap_skill_failed", message: "create-roadmap could not run: gateway_unavailable." },
    });
    render(seat());

    fireEvent.click(screen.getByRole("button", { name: /^Apply ⟳: Pull #744/ }));
    fireEvent.click(screen.getByRole("button", { name: APPLY_CONFIRM }));

    expect(await screen.findByRole("alert")).toHaveTextContent("create-roadmap could not run: gateway_unavailable.");
    expect(within(documentStep()).getByRole("status")).toBeEmptyDOMElement();
    expect(within(documentStep()).getByText("v1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Apply ⟳: Pull #744/ })).toBeInTheDocument();
  });

  it("dismisses a suggestion through the service, which records it, and removes its row", async () => {
    const seeded = seededRoadmap();
    const items = seeded.suggestions.items.map((suggestion) =>
      suggestion.id === AI_SUGGESTION_ID ? { ...suggestion, status: "dismissed" as const } : suggestion,
    );

    dismissRoadmapSuggestion.mockResolvedValueOnce({
      ok: true,
      roadmap: seededRoadmap({ suggestions: { open: 1, items } }),
    });
    render(seat());

    fireEvent.click(screen.getByRole("button", { name: /^Dismiss: Split #745/ }));

    await waitFor(() => expect(screen.queryByRole("button", { name: /^Dismiss: Split #745/ })).not.toBeInTheDocument());
    expect(dismissRoadmapSuggestion).toHaveBeenCalledWith(RS124_ID, AI_SUGGESTION_ID);
    expect(documentStep()).not.toHaveTextContent("Split #745");
    expect(within(documentStep()).getByRole("heading", { name: "Suggested changes — 1 open" })).toBeInTheDocument();
    expect(within(documentStep()).queryByRole("list", { name: APPLIED_TITLE })).not.toBeInTheDocument();
    expect(within(documentStep()).getByText("v1")).toBeInTheDocument();
  });

  it("prints the refusal when a dismissal is refused, and keeps the row", async () => {
    dismissRoadmapSuggestion.mockResolvedValueOnce({
      ok: false,
      refusal: { code: "roadmap_suggestion_settled", message: "That suggestion was already settled." },
    });
    render(seat());

    fireEvent.click(screen.getByRole("button", { name: /^Dismiss: Split #745/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That suggestion was already settled.");
    expect(screen.getByRole("button", { name: /^Dismiss: Split #745/ })).toBeInTheDocument();
  });

  it("shows a contributor the suggestions with both actions inert, and says why", () => {
    render(seat({ mayAdminister: false }));

    for (const button of within(documentStep()).getAllByRole("button", { name: /^(Apply ⟳|Dismiss): / })) {
      expect(button).toHaveAttribute("aria-disabled", "true");
      expect(button).toHaveAttribute("title", SUGGESTION_READ_ONLY);
    }

    fireEvent.click(screen.getByRole("button", { name: /^Apply ⟳: Pull #744/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Dismiss: Split #745/ }));

    expect(screen.queryByRole("dialog", { name: APPLY_TITLE })).not.toBeInTheDocument();
    expect(dismissRoadmapSuggestion).not.toHaveBeenCalled();
  });

  it("says so when no suggestion is open", () => {
    render(seatOf(seededRoadmap({ suggestions: { open: 0, items: [] } })));

    expect(within(documentStep()).getByRole("heading", { name: "Suggested changes — 0 open" })).toBeInTheDocument();
    expect(documentStep()).toHaveTextContent(NO_SUGGESTIONS);
  });
});

describe("step 2 — the tracker", () => {
  it("tags the seeded tracker as synced, and heads each milestone with its due date and progress", () => {
    render(seat());

    expect(trackerStep()).toHaveTextContent("6 issues · 2 milestones · synced");
    expect(within(trackerStep()).getByRole("heading", { name: "◆ M1 · Docking parity" })).toBeInTheDocument();
    expect(within(trackerStep()).getByRole("heading", { name: "◆ M2 · Fleet reliability" })).toBeInTheDocument();
    expect(trackerStep()).toHaveTextContent("due Oct 15");
    expect(trackerStep()).toHaveTextContent("1/3 done");
    expect(trackerStep()).toHaveTextContent("due Nov 20");
    expect(trackerStep()).toHaveTextContent("0/3 done");
  });

  it("draws each seeded issue: number, title, the estimator's loop-days, effort, complexity and pill", () => {
    render(seat());

    expect(within(trackerStep()).getAllByRole("listitem").map((row) => row.textContent)).toEqual([
      "#742Wind-feedforward MPC in final approachest 3.0 loop-daysLcx:high✓ closed",
      "#743Re-planned abort & retry vectorsest 1.5 loop-daysMcx:medqueued",
      "#744Gust estimator from IMU residualsest 1.0 loop-dayMcx:medqueued",
      "#745Battery health model v2est 2.0 loop-daysMcx:highqueued",
      "#746Telemetry gap alertsest 0.5 loop-dayScx:lowqueued",
      "#747Operator recovery playbook docsest 0.3 loop-dayXScx:lowqueued",
    ]);
  });

  it("links an issue's number to the tracker, in a new tab", () => {
    render(seat());

    const number = within(issueRow("#742")).getByRole("link", { name: "#742" });

    expect(number).toHaveAttribute("href", "https://github.com/acme-robotics/helios-firmware/issues/742");
    expect(number).toHaveAttribute("target", "_blank");
  });

  it("draws each pill from the ticket and run state the service read", () => {
    const seeded = seededRoadmap();
    const [m1, m2] = seeded.milestones;
    const states = [
      { state: "merged", label: "✓ merged", tone: "ok", live: false },
      { state: "live", label: "loop live", tone: "run", live: true },
      { state: "needs_human", label: "needs human", tone: "warn", live: false },
    ] as const;
    const items = m1!.items.map((item, index) => ({ ...item, status: states[index]! }));

    render(seatOf(seededRoadmap({ milestones: [{ ...m1!, items }, m2!] })));

    expect(issueRow("#742")).toHaveTextContent("✓ merged");
    expect(issueRow("#743")).toHaveTextContent("loop live");
    expect(issueRow("#744")).toHaveTextContent("needs human");
    // Only the running loop pulses.
    expect(issueRow("#743").querySelector(".ou-chip__dot--pulse")).not.toBeNull();
    expect(issueRow("#742").querySelector(".ou-chip__dot--pulse")).toBeNull();
    expect(issueRow("#744").querySelector(".ou-chip__dot--pulse")).toBeNull();
  });

  it("renders the drift state with the suggestion the detector raised — not synced", () => {
    render(seatOf(driftedRoadmap()));

    expect(trackerStep()).toHaveTextContent("6 issues · 2 milestones · drift detected");
    expect(trackerStep()).not.toHaveTextContent("synced");

    const raised = within(trackerStep()).getByRole("status");

    expect(raised).toHaveTextContent("Drift detected — suggestion raised:");
    expect(raised).toHaveTextContent("Reconcile ROADMAP.md with the tracker: #743 is titled differently there.");
    // The same suggestion is in the queue, where it can be applied or dismissed.
    expect(within(documentStep()).getByRole("heading", { name: "Suggested changes — 3 open" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Apply ⟳: Reconcile ROADMAP.md/ })).toBeInTheDocument();
    expect(documentStep()).toHaveTextContent("docs/ROADMAP.md · drift detected since 8c1b2e4");
  });

  it("says so before create-issues has run", () => {
    const seeded = seededRoadmap();
    const unfiled = seeded.milestones.map((milestone) => ({
      ...milestone,
      items: milestone.items.map((item) => ({ ...item, draftId: null, ticket: null, estimate: null, status: null })),
    }));

    render(
      seatOf(
        seededRoadmap({
          milestones: unfiled,
          issues: { batchId: null, filed: 0, total: 6, label: "0 issues · 2 milestones" },
        }),
      ),
    );

    expect(trackerStep()).toHaveTextContent("0 issues · 2 milestones · not filed yet");
    expect(trackerStep()).toHaveTextContent(NO_ISSUES);
    expect(within(trackerStep()).getAllByText("not filed")).toHaveLength(6);
  });

  it("closes on the caption, verbatim", () => {
    render(seat());

    expect(trackerStep()).toHaveTextContent(PIPELINE_CAPTION);
  });
});

describe("the seat without a card", () => {
  it("says there is no roadmap yet", () => {
    render(seat({ reading: { ok: true, value: null } }));

    expect(screen.getByRole("region", { name: PIPELINE_TITLE })).toHaveTextContent(NO_PIPELINE_TITLE);
  });

  it("prints why the roadmap could not be read, and offers to try again", () => {
    render(seat({ reading: { ok: false, reason: "The service is restarting." } }));

    const region = screen.getByRole("region", { name: PIPELINE_TITLE });

    expect(region).toHaveTextContent(PIPELINE_UNREADABLE);
    expect(region).toHaveTextContent("The service is restarting.");

    fireEvent.click(within(region).getByRole("button", { name: RELOAD }));

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("takes a newer reading from the page, replacing what a write here returned", () => {
    const { rerender } = render(seat());

    rerender(seatOf(appliedRoadmap()));

    expect(within(documentStep()).getByText("v2")).toBeInTheDocument();
  });
});

describe("both palettes", () => {
  it("draws the seeded card from one markup in light and in dark", () => {
    const [light, dark] = renderInBothPalettes(seat()).map(maskIds);

    expect(light).toBe(dark);
    expect(light).toContain("research__pipe");
  });
});
