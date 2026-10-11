import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COMPOSER_TITLE, QUESTION_LABEL, START_LABEL, TOOLS_LABEL, runOf } from "@/app/research/composer";
import type { ResearchScreenProps } from "@/app/research/research-screen";
import { CAPTURE_LABEL, CAPTURE_READ_ONLY, DISMISS_READ_ONLY, ENABLE_READ_ONLY } from "@/app/research/side";
import { SUGGESTION_READ_ONLY } from "@/app/research/pipeline";
import { DRAFT_EPIC_LABEL } from "@/app/research/brief";
import {
  COMPOSER_NO_TOOLS_LINK,
  FIRST_QUESTION_ACTION,
  FIRST_QUESTION_TITLE,
  GATEWAY_NOTICE_LINK,
  GATEWAY_NOTICE_TITLE,
  GATEWAY_START_REASON,
  NO_TOOL_CONNECTED_NOTE,
  NO_TOOL_CONNECTED_READ_ONLY,
  SIDE_STALE_HEADLINE,
} from "@/app/research/states";
import { NO_FILTERS, RESEARCH_REGIONS, VIEWER_START_REASON } from "@/app/research/view";
import { PROVIDERS_PATH } from "@/app/paths";
import { paneLandingClaimed } from "@/app/shell/pane-anchor";

import { maskIds, renderInBothPalettes } from "../helpers/palettes";
import {
  FakeProgressSource,
  SEEDED_LABEL,
  composerReadings,
  depthEstimates,
  emptyWatch,
  featuredBrief,
  featuredPipeline,
  investigationList,
  openFakeSource,
  progress,
  seededCatalog,
  seededTools,
  seededWatch,
  startedInvestigation,
  tool,
} from "../helpers/research";

/**
 * The Research frame (#627): the head verbatim, two actions that land on a seat, six labelled
 * seats in the mockup's order, and no navigation chrome of the page's own — and, since #628, the
 * composer's card in its seat, whose finished run lands the reader on the brief's; and, since
 * #629, the side column's two cards on one poll.
 */

const estimateComposer = vi.fn();
const startInvestigation = vi.fn();
const readInvestigation = vi.fn();

vi.mock("@/app/research/composer-actions", () => ({
  estimateComposer: (request: unknown) => estimateComposer(request),
  startInvestigation: (body: unknown) => startInvestigation(body),
  cancelInvestigation: () => Promise.resolve({ ok: false, refusal: { code: "x", message: "x" } }),
  readInvestigation: (id: unknown) => readInvestigation(id),
}));
vi.mock("@/app/research/investigations-actions", () => ({
  readInvestigations: () => Promise.resolve({ ok: false, refusal: { code: "x", message: "x" } }),
  openInvestigation: () => Promise.resolve({ ok: false, refusal: { code: "x", message: "x" } }),
}));
vi.mock("@/app/research/brief-actions", () => ({
  readBriefLedger: () => Promise.resolve({ ok: true, total: 0, items: [] }),
  readTrackers: () => Promise.resolve({ ok: true, trackers: [] }),
  draftEpicFromGaps: () => Promise.resolve({ ok: false, refusal: { code: "x", message: "x" } }),
}));
vi.mock("@/app/research/pipeline-actions", () => ({
  applyRoadmapSuggestion: () => Promise.resolve({ ok: false, refusal: { code: "x", message: "x" } }),
  dismissRoadmapSuggestion: () => Promise.resolve({ ok: false, refusal: { code: "x", message: "x" } }),
}));
const enableTool = vi.fn();
vi.mock("@/app/research/side-actions", () => ({
  enableTool: (slug: unknown, config: unknown) => enableTool(slug, config),
  dismissWatchItem: () => Promise.resolve({ ok: false, refusal: { code: "x", message: "x", details: {} } }),
  captureBaselines: () => Promise.resolve({ ok: false, refusal: { code: "x", message: "x", details: {} } }),
}));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => refresh(), push: () => {} }) }));

const { ResearchScreen } = await import("@/app/research/research-screen");

/** jsdom has no layout, so the scroll is watched rather than performed. */
const scrollIntoView = vi.fn();

beforeEach(() => {
  scrollIntoView.mockReset();
  Element.prototype.scrollIntoView = scrollIntoView;
  estimateComposer.mockReset().mockResolvedValue({ ok: true, estimates: depthEstimates() });
  startInvestigation.mockReset().mockResolvedValue({ ok: true, run: runOf(startedInvestigation()) });
  readInvestigation.mockReset().mockResolvedValue({ ok: false, refusal: { code: "x", message: "x" } });
  refresh.mockReset();
  FakeProgressSource.reset();
});

afterEach(() => {
  // @ts-expect-error — restoring jsdom's own absence of the method.
  delete Element.prototype.scrollIntoView;
});

function Screen(over: Partial<ResearchScreenProps>) {
  return (
    <ResearchScreen
      brief={{ ok: true, value: featuredBrief() }}
      composer={composerReadings()}
      filters={NO_FILTERS}
      investigations={{ ok: true, value: investigationList() }}
      mayAdminister
      mayDraft
      opened={null}
      openProgress={openFakeSource}
      pipeline={{ ok: true, value: featuredPipeline() }}
      sidePoll={{ read: () => new Promise(() => undefined) }}
      startReason={null}
      view="page"
      watch={{ ok: true, value: seededWatch() }}
      {...over}
    />
  );
}

/**
 * A region's seat.
 *
 * @param id The region.
 * @returns The seat's element.
 */
function seat(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`no seat #${id}`);

  return element;
}

describe("the head", () => {
  it("states the page's argument verbatim", () => {
    render(<Screen />);

    expect(screen.getByText("Research", { selector: ".ou-eyebrow" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Ask a hard question. Get an evidenced answer — and the tickets to act on it.",
    );
    expect(
      screen.getByText(
        "The same loop that handles the build runs investigations — root-cause briefs for bug fixes, forensics on regressions, product roadmaps and improvement proposals, and project & competitive gap analysis — with full research tools, every claim cited, every finding one click from a drafted ticket.",
      ),
    ).toBeInTheDocument();
  });

  it("links Research library to the library's address", () => {
    render(<Screen />);

    expect(screen.getByRole("link", { name: "Research library" })).toHaveAttribute(
      "href",
      "/research?view=library",
    );
  });

  it("draws no navigation of its own — the shell's sidebar is how a reader arrives", () => {
    const { container } = render(<Screen />);

    // A card's own `<header>` is its head, not a banner: only navigation landmarks are chrome.
    expect(container.querySelector("nav, aside, [role=navigation], [role=banner]")).toBeNull();
    expect(container.querySelector("main > header")).toBeNull();
    expect(container.querySelectorAll("main")).toHaveLength(1);
  });
});

describe("New investigation", () => {
  it("scrolls to the composer, focuses it and rings it", () => {
    render(<Screen />);
    expect(seat("composer")).not.toHaveClass("research__seat--highlight");

    fireEvent.click(screen.getByRole("button", { name: "New investigation" }));

    expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: "start" });
    expect(scrollIntoView.mock.contexts[0]).toBe(seat("composer"));
    expect(seat("composer")).toHaveFocus();
    expect(seat("composer")).toHaveClass("research__seat--highlight");
  });

  it("opens no dialog — the composer is on the page", () => {
    render(<Screen />);

    fireEvent.click(screen.getByRole("button", { name: "New investigation" }));

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("drops the ring once focus leaves the composer", () => {
    render(<Screen />);
    fireEvent.click(screen.getByRole("button", { name: "New investigation" }));

    fireEvent.blur(seat("composer"), { relatedTarget: screen.getByRole("link", { name: "Research library" }) });

    expect(seat("composer")).not.toHaveClass("research__seat--highlight");
  });

  it("keeps the ring while focus moves inside the composer", () => {
    render(<Screen />);
    fireEvent.click(screen.getByRole("button", { name: "New investigation" }));

    fireEvent.blur(seat("composer"), { relatedTarget: within(seat("composer")).getByLabelText(QUESTION_LABEL) });

    expect(seat("composer")).toHaveClass("research__seat--highlight");
  });

  it("is inert for a viewer, and says why — the same words the composer's Start gives", () => {
    render(<Screen startReason={VIEWER_START_REASON} />);
    const button = screen.getByRole("button", { name: "New investigation" });

    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAttribute("title", VIEWER_START_REASON);
    expect(screen.getByRole("button", { name: START_LABEL })).toHaveAttribute("title", VIEWER_START_REASON);

    fireEvent.click(button);

    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(seat("composer")).not.toHaveClass("research__seat--highlight");
  });

  it("leaves Research library open to a viewer", () => {
    render(<Screen startReason={VIEWER_START_REASON} />);

    expect(screen.getByRole("link", { name: "Research library" })).toHaveAttribute(
      "href",
      "/research?view=library",
    );
  });
});

describe("the library's address", () => {
  it("lands on the investigations seat, focused and ringed", () => {
    render(<Screen view="library" />);

    expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: "start" });
    expect(scrollIntoView.mock.contexts[0]).toBe(seat("investigations"));
    expect(seat("investigations")).toHaveFocus();
    expect(seat("investigations")).toHaveClass("research__seat--highlight");
  });

  it("claims its landing from the shell for as long as the address is the library's", () => {
    // The shell returns the pane to its top on a route with no fragment; the claim is what
    // stops that undoing the landing, and releasing it is what spares no later route its reset.
    const { rerender, unmount } = render(<Screen view="library" />);
    expect(paneLandingClaimed()).toBe(true);

    rerender(<Screen view="page" />);
    expect(paneLandingClaimed()).toBe(false);

    rerender(<Screen view="library" />);
    expect(paneLandingClaimed()).toBe(true);

    unmount();
    expect(paneLandingClaimed()).toBe(false);
  });

  it("claims nothing when the page opens from its top", () => {
    render(<Screen />);

    expect(paneLandingClaimed()).toBe(false);
  });

  it("opens the same way for a viewer", () => {
    render(<Screen startReason={VIEWER_START_REASON} view="library" />);

    expect(seat("investigations")).toHaveFocus();
  });

  it("moves nothing when the page opens from its top", () => {
    render(<Screen />);

    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(document.querySelector(".research__seat--highlight")).toBeNull();
    expect(document.body).toHaveFocus();
  });

  it("hands the ring to the composer when New investigation is pressed from the library", () => {
    render(<Screen view="library" />);

    fireEvent.click(screen.getByRole("button", { name: "New investigation" }));

    expect(seat("composer")).toHaveClass("research__seat--highlight");
    expect(seat("investigations")).not.toHaveClass("research__seat--highlight");
  });
});

describe("the grid frame", () => {
  it("seats the six regions in the mockup's order", () => {
    const { container } = render(<Screen />);

    expect([...container.querySelectorAll(".research__seat")].map((element) => element.id)).toEqual([
      "composer",
      "tools",
      "watch",
      "brief",
      "pipeline",
      "investigations",
    ]);
  });

  it("puts the composer beside a side column holding the tools card over the watch", () => {
    const { container } = render(<Screen />);
    const grid = container.querySelector(".research__grid")!;

    expect([...grid.children].map((child) => child.id || child.className)).toEqual([
      "composer",
      "research__side",
      "brief",
      "pipeline",
      "investigations",
    ]);
    expect(seat("composer")).toHaveClass("research__seat--main");
    expect([...container.querySelectorAll(".research__side > .research__seat--side")].map((element) => element.id)).toEqual([
      "tools",
      "watch",
    ]);
    for (const id of ["brief", "pipeline", "investigations"]) expect(seat(id)).toHaveClass("research__seat--wide");
  });

  it("labels every seat with its region — every one now holds its card, none a placeholder", () => {
    render(<Screen />);

    // The brief's card and the pipeline's are named by what they hold, not by the region.
    const named: Partial<Record<string, RegExp>> = { brief: /RS-127/, pipeline: /RS-124/ };

    for (const region of RESEARCH_REGIONS) {
      const card = screen.getByRole("region", { name: named[region.id] ?? region.title });

      expect(seat(region.id)).toContainElement(card);
      expect(card).not.toHaveTextContent(region.arrives);
    }
  });

  it("keeps every seat out of the tab order while leaving it focusable by an action", () => {
    const { container } = render(<Screen />);

    for (const element of container.querySelectorAll(".research__seat")) {
      expect(element).toHaveAttribute("tabindex", "-1");
    }
  });
});

describe("the composer in its seat (#628)", () => {
  it("fills the composer's seat with the card, under the region's own heading", async () => {
    render(<Screen />);

    const card = within(seat("composer")).getByRole("region", { name: COMPOSER_TITLE });
    expect(within(card).getByLabelText(QUESTION_LABEL)).toBeInTheDocument();
    expect(await within(card).findByText(SEEDED_LABEL)).toBeInTheDocument();
  });

  it("lands on the brief's seat when a run's brief is ready", async () => {
    render(<Screen />);
    await screen.findByText(SEEDED_LABEL);
    fireEvent.change(screen.getByLabelText(QUESTION_LABEL), { target: { value: "Why?" } });
    fireEvent.click(screen.getByRole("button", { name: START_LABEL }));
    await screen.findByText("RS-128");

    act(() => {
      FakeProgressSource.latest().emit("done", {
        kind: "done",
        ...progress({ status: "brief_ready", sources: 44, spendCents: 590 }),
      });
    });

    expect(scrollIntoView.mock.contexts.at(-1)).toBe(seat("brief"));
    expect(seat("brief")).toHaveFocus();
    expect(seat("brief")).toHaveClass("research__seat--highlight");
    expect(seat("composer")).not.toHaveClass("research__seat--highlight");
    // …and the page is re-read, so the newest brief is the one featured.
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe("the featured brief in its seat (#630)", () => {
  it("fills the brief's seat with the newest brief's card", () => {
    render(<Screen />);

    const card = within(seat("brief")).getByRole("region", { name: /RS-127/ });
    expect(within(card).getByRole("table", { name: "Autonomous docking vs. the field" })).toBeInTheDocument();
  });

  it("lands on the pipeline's seat from a roadmap document's chip", () => {
    const roadmap = featuredBrief();
    render(
      <Screen
        brief={{
          ok: true,
          value: {
            ...roadmap,
            detail: { ...roadmap.detail, deliverables: [{ kind: "roadmap_doc", id: "doc-124" }] },
          },
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "roadmap document" }));

    expect(seat("pipeline")).toHaveFocus();
    expect(seat("pipeline")).toHaveClass("research__seat--highlight");
  });

  it("says so when no investigation has finished", () => {
    render(<Screen brief={{ ok: true, value: null }} />);

    expect(screen.getByRole("region", { name: "Featured brief" })).toHaveTextContent("No brief yet");
  });
});

describe("the roadmap pipeline in its seat (#631)", () => {
  it("fills the pipeline's seat with the newest roadmap's card, both steps", () => {
    render(<Screen />);

    const card = within(seat("pipeline")).getByRole("region", { name: "RS-124 — From brief to roadmap to issues" });

    expect(card).toHaveTextContent("docs/ROADMAP.md · committed 8c1b2e4 · generated from the RS-124 brief");
    expect(card).toHaveTextContent("6 issues · 2 milestones · synced");
  });

  it("says so when the workspace has no roadmap", () => {
    render(<Screen pipeline={{ ok: true, value: null }} />);

    expect(within(seat("pipeline")).getByRole("region", { name: "Roadmap pipeline" })).toHaveTextContent("No roadmap yet");
  });

  it("hands the reader's standing to the suggestions' actions", () => {
    render(<Screen mayAdminister={false} />);

    const apply = within(seat("pipeline")).getAllByRole("button", { name: /^Apply ⟳: / })[0]!;

    expect(apply).toHaveAttribute("aria-disabled", "true");
  });
});

describe("the investigations in their seat (#632)", () => {
  it("fills the investigations seat with the card's rows", () => {
    render(<Screen />);

    const card = within(seat("investigations")).getByRole("region", { name: "Investigations" });
    expect(within(card).getByRole("list", { name: "Investigations" }).querySelectorAll("li")).toHaveLength(4);
    expect(within(card).getByText("4 active · 23 this quarter")).toBeInTheDocument();
  });

  it("lands brief ↑ on the featured brief's seat, and to roadmap → on the pipeline's", () => {
    render(<Screen />);
    const card = within(seat("investigations"));

    fireEvent.click(card.getByRole("button", { name: "brief ↑" }));
    expect(seat("brief")).toHaveFocus();
    expect(seat("brief")).toHaveClass("research__seat--highlight");

    fireEvent.click(card.getByRole("button", { name: "to roadmap →" }));
    expect(seat("pipeline")).toHaveFocus();
    expect(seat("pipeline")).toHaveClass("research__seat--highlight");
    expect(seat("brief")).not.toHaveClass("research__seat--highlight");
  });

  it("opens the library at its address, facets showing, landed on the seat", () => {
    render(<Screen filters={{ kind: "gap_analysis", status: null, quarter: null }} view="library" />);

    expect(screen.getByRole("region", { name: "Research library" })).toBeInTheDocument();
    expect(screen.getByLabelText("Kind")).toHaveValue("gap_analysis");
    expect(seat("investigations")).toHaveFocus();
  });
});

describe("the side column (#629)", () => {
  it("seats the tools card over the regression watch, each under its region's heading", () => {
    render(<Screen />);

    const tools = within(seat("tools")).getByRole("region", { name: "Research tools" });
    const watch = within(seat("watch")).getByRole("region", { name: "Regression watch" });

    expect(within(tools).getAllByRole("listitem")).toHaveLength(6);
    expect(tools).toHaveTextContent("5 connected");
    expect(within(watch).getAllByRole("listitem")).toHaveLength(3);
    expect(tools.compareDocumentPosition(watch) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("draws the tools card from the composer's reading of the catalog — one read, two surfaces", () => {
    render(<Screen composer={composerReadings({ tools: { ok: false, reason: "The service failed." } })} />);

    expect(within(seat("tools")).getByText("The service failed.")).toBeInTheDocument();
  });

  it("flips a stopped tool's dot when the health cycle's poll answers, without a reload", async () => {
    const tools = seededTools();
    tools[0] = { ...tools[0], health: { state: "down", dot: "err", detail: "unreachable: SearXNG did not answer" } };
    const read = vi.fn().mockResolvedValue({
      state: "fresh",
      payload: { tools: seededCatalog(tools), watch: seededWatch({ items: [] }) },
      etag: null,
      pollAfterSeconds: 30,
    });

    render(<Screen sidePoll={{ read, visible: () => true }} />);

    expect(await within(seat("tools")).findByRole("img", { name: /^Down — unreachable/ })).toBeInTheDocument();
    expect(within(seat("tools")).getByText("4 connected")).toBeInTheDocument();
    expect(within(seat("watch")).queryAllByRole("listitem")).toHaveLength(0);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("asks the poll again as soon as a tool is enabled", async () => {
    const idle = tool("code", "Codebase & git mining", "⌥", "no repositories", {
      health: { state: "not_configured", dot: "idle", detail: "not configured" },
      configured: false,
    });
    const side = { tools: seededCatalog([idle]), watch: seededWatch() };
    const read = vi.fn().mockResolvedValue({ state: "fresh", payload: side, etag: null, pollAfterSeconds: 30 });
    enableTool.mockResolvedValue({ ok: true, value: idle });

    render(<Screen sidePoll={{ read, visible: () => true }} />);

    fireEvent.click(await screen.findByRole("button", { name: "Enable Codebase & git mining" }));
    const asked = read.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Enable tool" }));

    await waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(asked));
    expect(enableTool).toHaveBeenCalledWith("code", {});
  });

  it("hands the reader's standing to both cards", () => {
    render(<Screen mayAdminister={false} />);

    expect(screen.getByRole("button", { name: "Dismiss Hover drift +14% since v2.0.4" })).toHaveAttribute(
      "title",
      "Dismissing a watch item is for workspace owners and admins.",
    );
  });
});

/**
 * #633 — the page's states and guards. The acceptance criteria this block holds, in the ticket's
 * words: **a gateway-off fixture shows the honest degraded page**, the watch, the tools and the
 * briefs still live; **the guidance path** of a workspace with nothing yet; **a read-only session
 * across every write affordance, each with its reason, nothing hidden**; **a single failing
 * subsystem degrades only its region**; and **an error preserves what already loaded**.
 */

/** The settings of a deployment without the invocation gateway. */
const GATEWAY_OFF = composerReadings({
  settings: { ok: true, value: { startRole: "member", gateway: { available: false } } },
});

/** Every tool as a workspace that has enabled nothing has it: adapter present, idle, unconfigured. */
function nothingEnabled() {
  const tools = seededTools().map((entry) => ({
    ...entry,
    configured: false,
    health: { state: "not_configured" as const, dot: "idle" as const, detail: "not configured" },
  }));

  return { ...seededCatalog(tools), connectedCount: 0 };
}

describe("a deployment without the invocation gateway (#633)", () => {
  it("says so once, above the grid, with the way to Providers", () => {
    render(<Screen composer={GATEWAY_OFF} startReason={GATEWAY_START_REASON} />);

    const notices = screen.getAllByText(GATEWAY_NOTICE_TITLE);
    expect(notices).toHaveLength(1);

    const notice = notices[0]!.closest(".research__notice") as HTMLElement;
    expect(notice).toHaveAttribute("role", "status");
    expect(notice).toHaveTextContent("still detects and bisects");
    expect(within(notice).getByRole("link", { name: GATEWAY_NOTICE_LINK })).toHaveAttribute("href", PROVIDERS_PATH);
    // Above the grid, not inside any region.
    expect(notice.closest(".research__grid")).toBeNull();
    expect(notice.compareDocumentPosition(seat("composer")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("switches both start controls off with the designed explanation", () => {
    render(<Screen composer={GATEWAY_OFF} startReason={GATEWAY_START_REASON} />);

    for (const name of ["New investigation", START_LABEL]) {
      const control = screen.getByRole("button", { name });

      expect(control).toHaveAttribute("aria-disabled", "true");
      expect(control).toHaveAttribute("title", GATEWAY_START_REASON);
    }

    fireEvent.change(within(seat("composer")).getByLabelText(QUESTION_LABEL), { target: { value: "Why?" } });
    fireEvent.click(screen.getByRole("button", { name: START_LABEL }));
    expect(startInvestigation).not.toHaveBeenCalled();
  });

  it("keeps the watch, the tools card, the brief and the pipeline live", () => {
    render(<Screen composer={GATEWAY_OFF} startReason={GATEWAY_START_REASON} />);

    expect(within(seat("watch")).getAllByRole("listitem")).toHaveLength(3);
    expect(seat("watch")).toHaveTextContent("bisected → a41f2c9");
    expect(within(seat("tools")).getByText("5 connected")).toBeInTheDocument();
    expect(within(seat("brief")).getByRole("region", { name: /RS-127/ })).toBeInTheDocument();
    expect(within(seat("pipeline")).getByRole("region", { name: /RS-124/ })).toBeInTheDocument();
    expect(within(seat("investigations")).getAllByRole("listitem")).toHaveLength(4);
    // The dismiss, the draft and the suggestions are not the gateway's to switch off.
    expect(screen.getByRole("button", { name: "Dismiss Hover drift +14% since v2.0.4" })).not.toHaveAttribute(
      "aria-disabled",
    );
    expect(screen.getByRole("button", { name: DRAFT_EPIC_LABEL })).not.toHaveAttribute("aria-disabled");
  });

  it("renders the degraded page with the same markup under both palettes", () => {
    const [light, dark] = renderInBothPalettes(<Screen composer={GATEWAY_OFF} startReason={GATEWAY_START_REASON} />);

    expect(light).toContain("research__notice");
    expect(maskIds(light)).toBe(maskIds(dark));
  });

  it("says nothing when the gateway is there, or when the settings could not be read", () => {
    const { unmount } = render(<Screen />);
    expect(screen.queryByText(GATEWAY_NOTICE_TITLE)).toBeNull();
    unmount();

    render(<Screen composer={composerReadings({ settings: { ok: false, reason: "The service failed." } })} />);
    expect(screen.queryByText(GATEWAY_NOTICE_TITLE)).toBeNull();
  });
});

describe("a workspace with nothing yet (#633)", () => {
  /** The page as a fresh workspace reads it. */
  function Fresh(over: Partial<ResearchScreenProps> = {}) {
    return (
      <Screen
        brief={{ ok: true, value: null }}
        composer={composerReadings({ tools: { ok: true, value: nothingEnabled() } })}
        investigations={{ ok: true, value: investigationList({ items: [], counts: { active: 0, thisQuarter: 0 } }) }}
        pipeline={{ ok: true, value: null }}
        watch={{ ok: true, value: emptyWatch() }}
        {...over}
      />
    );
  }

  it("starts at the tools: the card leads with the step and every row offers enable", () => {
    render(<Fresh />);

    expect(within(seat("tools")).getByText("0 connected")).toBeInTheDocument();
    expect(within(seat("tools")).getByText(NO_TOOL_CONNECTED_NOTE)).toBeInTheDocument();
    expect(within(seat("tools")).getAllByRole("button", { name: /^Enable / })).toHaveLength(6);
  });

  it("turns every composer chip into a pointer at the enable flow, and says so under them", () => {
    render(<Fresh />);
    const tools = within(seat("composer")).getByRole("group", { name: TOOLS_LABEL });

    expect(within(tools).queryAllByRole("button")).toHaveLength(0);
    for (const chip of within(tools).getAllByRole("link")) expect(chip).toHaveAttribute("href", "#tools");
    expect(within(tools).getAllByRole("link")).toHaveLength(6);
    expect(within(seat("composer")).getByRole("link", { name: COMPOSER_NO_TOOLS_LINK })).toHaveAttribute(
      "href",
      "#tools",
    );
    expect(screen.getByRole("button", { name: START_LABEL })).toHaveAttribute("aria-disabled", "true");
  });

  it("asks for the first question, and the action lands in the composer", () => {
    render(<Fresh />);

    expect(within(seat("investigations")).getByText(FIRST_QUESTION_TITLE)).toBeInTheDocument();
    fireEvent.click(within(seat("investigations")).getByRole("button", { name: FIRST_QUESTION_ACTION }));

    expect(document.activeElement).toBe(seat("composer"));
    expect(seat("composer")).toHaveClass("research__seat--highlight");
  });

  it("offers the first baseline's capture in the watch card", () => {
    render(<Fresh />);

    expect(within(seat("watch")).getByText("No release baseline yet")).toBeInTheDocument();
    expect(within(seat("watch")).getByRole("button", { name: CAPTURE_LABEL })).not.toHaveAttribute("aria-disabled");
  });

  it("drops the pointer and the lead once a tool is connected", () => {
    render(<Fresh composer={composerReadings()} />);

    expect(within(seat("tools")).queryByText(NO_TOOL_CONNECTED_NOTE)).toBeNull();
    expect(within(seat("composer")).queryByRole("link", { name: COMPOSER_NO_TOOLS_LINK })).toBeNull();
    expect(
      within(within(seat("composer")).getByRole("group", { name: TOOLS_LABEL })).getAllByRole("button"),
    ).toHaveLength(5);
  });

  it("shows a reader who cannot enable or capture the same steps, inert, with who can", () => {
    render(<Fresh mayAdminister={false} />);

    expect(within(seat("tools")).getByText(NO_TOOL_CONNECTED_READ_ONLY)).toBeInTheDocument();

    const capture = within(seat("watch")).getByRole("button", { name: CAPTURE_LABEL });
    expect(capture).toHaveAttribute("aria-disabled", "true");
    expect(capture).toHaveAttribute("title", CAPTURE_READ_ONLY);
    expect(within(seat("watch")).getByText(CAPTURE_READ_ONLY)).toBeInTheDocument();
  });
});

describe("a read-only session (#633)", () => {
  it("keeps every write affordance on the page, inert, each with its reason", () => {
    const tools = seededTools();
    tools[2] = { ...tools[2]!, configured: false, health: { state: "not_configured", dot: "idle", detail: "not configured" } };

    render(
      <Screen
        composer={composerReadings({ tools: { ok: true, value: seededCatalog(tools) } })}
        mayAdminister={false}
        mayDraft={false}
        startReason={VIEWER_START_REASON}
      />,
    );

    const gated: [HTMLElement, string | null][] = [
      [screen.getByRole("button", { name: "New investigation" }), VIEWER_START_REASON],
      [screen.getByRole("button", { name: START_LABEL }), VIEWER_START_REASON],
      [screen.getByRole("button", { name: "Enable Codebase & git mining" }), ENABLE_READ_ONLY],
      [screen.getByRole("button", { name: "Dismiss Hover drift +14% since v2.0.4" }), DISMISS_READ_ONLY],
      [screen.getByRole("button", { name: DRAFT_EPIC_LABEL }), null],
      [within(seat("pipeline")).getAllByRole("button", { name: /^Apply ⟳: / })[0]!, SUGGESTION_READ_ONLY],
      [within(seat("pipeline")).getAllByRole("button", { name: /^Dismiss: / })[0]!, SUGGESTION_READ_ONLY],
    ];

    for (const [control, reason] of gated) {
      expect(control).toHaveAttribute("aria-disabled", "true");
      if (reason === null) expect(control.getAttribute("title")).toMatch(/\S/);
      else expect(control).toHaveAttribute("title", reason);
    }
  });

  it("leaves the whole page readable", () => {
    render(<Screen mayAdminister={false} mayDraft={false} startReason={VIEWER_START_REASON} />);

    for (const region of RESEARCH_REGIONS) expect(within(seat(region.id)).getByRole("region")).toBeInTheDocument();
    expect(within(seat("investigations")).getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getByRole("link", { name: "Research library" })).toBeInTheDocument();
  });
});

describe("a failing subsystem (#633)", () => {
  it("degrades its own region and leaves the other five drawn", () => {
    render(<Screen pipeline={{ ok: false, reason: "The tracker did not answer." }} />);

    expect(within(seat("pipeline")).getByText("The tracker did not answer.")).toBeInTheDocument();
    expect(within(seat("pipeline")).getByRole("button", { name: "Reload" })).toBeInTheDocument();

    expect(within(seat("composer")).getByLabelText(QUESTION_LABEL)).toBeInTheDocument();
    expect(within(seat("tools")).getByText("5 connected")).toBeInTheDocument();
    expect(within(seat("watch")).getAllByRole("listitem")).toHaveLength(3);
    expect(within(seat("brief")).getByRole("region", { name: /RS-127/ })).toBeInTheDocument();
    expect(within(seat("investigations")).getAllByRole("listitem")).toHaveLength(4);
  });

  it("raises a retry banner over the side column as last read when its re-read fails", async () => {
    const read = vi.fn().mockResolvedValue({ state: "failed", reason: "The service did not answer.", pollAfterSeconds: 30 });

    render(<Screen sidePoll={{ read, visible: () => true }} />);

    const banner = (await screen.findByText(SIDE_STALE_HEADLINE)).closest("[role='status']") as HTMLElement;
    expect(banner).toHaveTextContent("The service did not answer.");
    // What the page read on the server is still drawn under it.
    expect(within(seat("tools")).getByText("5 connected")).toBeInTheDocument();
    expect(within(seat("watch")).getAllByRole("listitem")).toHaveLength(3);

    const asked = read.mock.calls.length;
    fireEvent.click(within(banner).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(asked));
  });

  it("takes the banner down once a re-read answers", async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce({ state: "failed", reason: "The service did not answer.", pollAfterSeconds: 30 })
      .mockResolvedValue({
        state: "fresh",
        payload: { tools: seededCatalog(), watch: seededWatch() },
        etag: null,
        pollAfterSeconds: 30,
      });

    render(<Screen sidePoll={{ read, visible: () => true }} />);

    fireEvent.click(within((await screen.findByText(SIDE_STALE_HEADLINE)).closest("[role='status']") as HTMLElement).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.queryByText(SIDE_STALE_HEADLINE)).toBeNull());
  });
});
