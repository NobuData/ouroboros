import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COMPOSER_TITLE, QUESTION_LABEL, START_LABEL, runOf } from "@/app/research/composer";
import type { ResearchScreenProps } from "@/app/research/research-screen";
import { RESEARCH_REGIONS, VIEWER_START_REASON } from "@/app/research/view";
import { paneLandingClaimed } from "@/app/shell/pane-anchor";

import {
  FakeProgressSource,
  SEEDED_LABEL,
  composerReadings,
  depthEstimates,
  openFakeSource,
  progress,
  startedInvestigation,
} from "../helpers/research";

/**
 * The Research frame (#627): the head verbatim, two actions that land on a seat, six labelled
 * seats in the mockup's order, and no navigation chrome of the page's own — and, since #628, the
 * composer's card in its seat, whose finished run lands the reader on the brief's.
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
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const { ResearchScreen } = await import("@/app/research/research-screen");

/** jsdom has no layout, so the scroll is watched rather than performed. */
const scrollIntoView = vi.fn();

beforeEach(() => {
  scrollIntoView.mockReset();
  Element.prototype.scrollIntoView = scrollIntoView;
  estimateComposer.mockReset().mockResolvedValue({ ok: true, estimates: depthEstimates() });
  startInvestigation.mockReset().mockResolvedValue({ ok: true, run: runOf(startedInvestigation()) });
  readInvestigation.mockReset().mockResolvedValue({ ok: false, refusal: { code: "x", message: "x" } });
  FakeProgressSource.reset();
});

afterEach(() => {
  // @ts-expect-error — restoring jsdom's own absence of the method.
  delete Element.prototype.scrollIntoView;
});

function Screen(over: Partial<ResearchScreenProps>) {
  return (
    <ResearchScreen
      composer={composerReadings()}
      openProgress={openFakeSource}
      startReason={null}
      view="page"
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

  it("labels every seat with its region, and the ones still empty with the issue that fills them", () => {
    render(<Screen />);

    for (const region of RESEARCH_REGIONS) {
      const card = screen.getByRole("region", { name: region.title });

      expect(seat(region.id)).toContainElement(card);
      if (region.id === "composer") expect(card).not.toHaveTextContent(region.arrives);
      else expect(card).toHaveTextContent(region.arrives);
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
  });
});
