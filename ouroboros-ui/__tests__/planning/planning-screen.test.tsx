import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  IMPORT_JIRA_LABEL,
  IMPORT_JIRA_SOON_NOTE,
  NEW_ROADMAP_LABEL,
  NEW_ROADMAP_ROLE_REASON,
  PLANNING_EYEBROW,
  PLANNING_SUBLINE,
  PLANNING_TITLE,
  ROADMAP_EMPTY_NOTE,
  ROADMAP_EMPTY_TITLE,
  ROADMAP_NO_EPICS_TITLE,
  ROADMAP_UNREAD,
  SOON_MARK,
} from "@/app/planning/view";
import { HEALTH_TITLE, HEALTH_TITLE_ID } from "@/app/planning/health";
import { SYNC_TITLE, SYNC_TITLE_ID } from "@/app/planning/sync";
import { GENERATOR_TITLE, PROMPT_LABEL, PUSH_ROLE_REASON } from "@/app/planning/generator";
import {
  CARD_UNREAD_NOTE,
  PLANNING_DEGRADED_HEADLINE,
  PLANNING_FAILED_HEADLINE,
  SOURCES_READ,
} from "@/app/planning/states";

import { ADD_EPIC_LABEL, READ_ONLY_STEP_REASON, SHARE_LABEL, SHARE_SOON_NOTE } from "@/app/planning/gantt";

import { maskIds, renderInBothPalettes } from "../helpers/palettes";
import { EMPTY_ROADMAP, SEEDED_READ_MONTH, planningBatch, planningReadings } from "../helpers/planning";

/**
 * The planning frame as it is drawn (#283): the head copy verbatim, **Import from Jira** an honest
 * *soon* that opens nothing, **New roadmap** live for an owner or an admin, and the three regions
 * in the mockup's 7 / 5 + 12 grid.
 */

vi.mock("@/app/planning/create-actions", () => ({ createRoadmap: vi.fn() }));
vi.mock("@/app/planning/generator-actions", () => ({
  generateBatch: vi.fn(),
  patchDraft: vi.fn(),
  pushBatch: vi.fn(),
  readMilestones: vi.fn(() => new Promise(() => {})),
  regenerateBatch: vi.fn(),
}));
vi.mock("@/app/planning/gantt-actions", () => ({
  addEpic: vi.fn(),
  readEpicLinks: vi.fn(() => new Promise(() => {})),
  searchTickets: vi.fn(() => new Promise(() => {})),
  setTicketLinked: vi.fn(),
  updateEpic: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

const { PlanningScreen } = await import("@/app/planning/planning-screen");

describe("the head", () => {
  it("is mockup 09's eyebrow, heading and subline, verbatim", () => {
    render(<PlanningScreen readMonth={SEEDED_READ_MONTH} mayAdminister mayContribute readings={planningReadings()} />);

    expect(screen.getByText(PLANNING_EYEBROW)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(PLANNING_TITLE);
    expect(screen.getByText(PLANNING_SUBLINE)).toBeInTheDocument();
  });

  it("draws Import from Jira as an inert ghost marked soon, naming #291, that opens nothing", () => {
    render(<PlanningScreen readMonth={SEEDED_READ_MONTH} mayAdminister mayContribute readings={planningReadings()} />);

    const importJira = screen.getByRole("button", { name: `${IMPORT_JIRA_LABEL} ${SOON_MARK}` });

    expect(importJira).toHaveClass("ou-btn--ghost");
    expect(importJira).toHaveAttribute("aria-disabled", "true");
    expect(importJira).toHaveAttribute("title", IMPORT_JIRA_SOON_NOTE);

    fireEvent.click(importJira);

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("draws New roadmap live for an owner or an admin, and inert with the reason for anyone else", () => {
    const { unmount } = render(<PlanningScreen readMonth={SEEDED_READ_MONTH} mayAdminister mayContribute readings={planningReadings()} />);

    expect(screen.getByRole("button", { name: NEW_ROADMAP_LABEL })).not.toHaveAttribute("aria-disabled");
    unmount();

    render(<PlanningScreen readMonth={SEEDED_READ_MONTH} mayAdminister={false} mayContribute={false} readings={planningReadings()} />);

    expect(screen.getByRole("button", { name: NEW_ROADMAP_LABEL })).toHaveAttribute(
      "title",
      NEW_ROADMAP_ROLE_REASON,
    );
  });

  it("puts Import from Jira before New roadmap, as the mockup does", () => {
    render(<PlanningScreen readMonth={SEEDED_READ_MONTH} mayAdminister mayContribute readings={planningReadings()} />);

    const labels = screen.getAllByRole("button").map((button) => button.textContent);

    expect(labels.indexOf(`${IMPORT_JIRA_LABEL} ${SOON_MARK}`)).toBeLessThan(labels.indexOf(NEW_ROADMAP_LABEL));
  });
});

describe("the frame", () => {
  it("is mounted as the page's main landmark, with no chrome of its own", () => {
    const { container } = render(<PlanningScreen readMonth={SEEDED_READ_MONTH} mayAdminister mayContribute readings={planningReadings()} />);

    expect(container.firstElementChild?.tagName).toBe("MAIN");
    expect(container.firstElementChild).toHaveClass("planning");
  });

  it("seats the generator in the 7, the two side cards in the 5 and the roadmap in the 12", () => {
    const { container } = render(<PlanningScreen readMonth={SEEDED_READ_MONTH} mayAdminister mayContribute readings={planningReadings()} />);

    const generator = container.querySelector(".planning__generator")!;
    const side = container.querySelector(".planning__side")!;
    const roadmap = container.querySelector(".planning__roadmap")!;

    expect(within(generator as HTMLElement).getByRole("region", { name: GENERATOR_TITLE })).toBeInTheDocument();
    expect(
      within(side as HTMLElement).getAllByRole("region").map((region) => region.getAttribute("aria-labelledby")),
    ).toEqual([SYNC_TITLE_ID, HEALTH_TITLE_ID]);
    expect(within(roadmap as HTMLElement).getByRole("region", { name: "Roadmap — Helios 2.1" })).toBeInTheDocument();

    // Grid order is document order: 7, then 5, then 12.
    expect([...container.querySelector(".planning__grid")!.children]).toEqual([generator, side, roadmap]);
  });

  it("fills the side column with the two built cards (#285)", () => {
    render(<PlanningScreen readMonth={SEEDED_READ_MONTH} mayAdminister mayContribute readings={planningReadings()} />);

    expect(screen.getByRole("region", { name: SYNC_TITLE })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: HEALTH_TITLE })).toBeInTheDocument();
    // The placeholders they replaced said so in words; nothing on the page may still.
    expect(screen.queryByText(/arrives with #285/)).not.toBeInTheDocument();
  });

  it("renders identically in both palettes", () => {
    // The TODAY marker reads the clock; held still, so the two renders draw it at the same place.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 7, 8, 12));

    const [light, dark] = renderInBothPalettes(<PlanningScreen readMonth={SEEDED_READ_MONTH} mayAdminister mayContribute readings={planningReadings()} />);

    vi.useRealTimers();
    expect(maskIds(light!)).toBe(maskIds(dark!));
    expect(light).toContain("planning-gantt__today");
  });
});

describe("the generator region (#284)", () => {
  it("builds the tracker segment from the workspace's sources and the catalog", () => {
    render(<PlanningScreen readMonth={SEEDED_READ_MONTH} mayAdminister mayContribute readings={planningReadings()} />);

    const trackers = screen.getByRole("group", { name: "Target tracker" });

    expect(within(trackers).getByRole("button", { name: "GitHub Issues" })).toHaveAttribute("aria-pressed", "true");
    // The seed's Jira source exists, but this build's catalog cannot write to Jira.
    expect(within(trackers).getByRole("button", { name: /^Jira/ })).toHaveAttribute("aria-disabled", "true");
    expect(within(trackers).getByRole("button", { name: /^Linear/ })).toHaveAttribute("aria-disabled", "true");
  });

  // Since AM.5 (#287) the reason lives in the banner, said once — not in the card.
  it("leaves the rest of the page standing when the trackers could not be read", () => {
    render(
      <PlanningScreen
        readMonth={SEEDED_READ_MONTH}
        mayAdminister
        mayContribute
        readings={planningReadings(undefined, { sources: { ok: false, reason: "The service failed." } })}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      `${SOURCES_READ}: The service failed.`,
    );
    expect(screen.getByRole("region", { name: "Roadmap — Helios 2.1" })).toBeInTheDocument();
  });
});

describe("the roadmap region", () => {
  it("is headed by the roadmap's name and window, and draws its gantt", () => {
    render(<PlanningScreen readMonth={SEEDED_READ_MONTH} mayAdminister mayContribute readings={planningReadings()} />);

    const region = screen.getByRole("region", { name: "Roadmap — Helios 2.1" });

    expect(within(region).getByText("Q3–Q4 2026")).toBeInTheDocument();
    expect(within(region).getByRole("group", { name: "Roadmap timeline" })).toBeInTheDocument();
    expect(within(region).getByText("Jul 2026")).toBeInTheDocument();
  });

  it("draws Share ↗ as an inert ghost marked soon, naming #292, that goes nowhere", () => {
    render(<PlanningScreen readMonth={SEEDED_READ_MONTH} mayAdminister mayContribute readings={planningReadings()} />);

    const region = screen.getByRole("region", { name: "Roadmap — Helios 2.1" });
    const share = within(region).getByRole("button", { name: `${SHARE_LABEL} soon` });

    expect(share).toHaveAttribute("aria-disabled", "true");
    expect(share).toHaveAttribute("title", SHARE_SOON_NOTE);
    expect(share).not.toHaveAttribute("href");
    expect(within(region).queryByRole("link", { name: /share/i })).toBeNull();
  });

  it("says how to start one when the workspace has planned nothing", () => {
    render(<PlanningScreen readMonth={SEEDED_READ_MONTH} mayAdminister mayContribute readings={planningReadings({ ok: true, value: EMPTY_ROADMAP })} />);

    const region = screen.getByRole("region", { name: "Roadmap" });

    expect(within(region).getByText(ROADMAP_EMPTY_TITLE)).toBeInTheDocument();
    expect(within(region).getByText(ROADMAP_EMPTY_NOTE)).toBeInTheDocument();
  });

  it("says the roadmap could not be read, and leaves the rest standing", () => {
    render(<PlanningScreen readMonth={SEEDED_READ_MONTH} mayAdminister mayContribute readings={planningReadings({ ok: false, reason: "The service failed." })} />);

    const region = screen.getByRole("region", { name: "Roadmap" });

    // The card names what is missing; the banner carries why (#287).
    expect(within(region).getByText(ROADMAP_UNREAD)).toBeInTheDocument();
    expect(within(region).getByText(CARD_UNREAD_NOTE)).toBeInTheDocument();
    expect(within(region).queryByText("The service failed.")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(PLANNING_TITLE);
    expect(screen.getAllByRole("button", { name: NEW_ROADMAP_LABEL }).length).toBeGreaterThan(0);
  });
});

describe("the page's states (#287)", () => {
  /** The screen, with whatever readings a case wants. */
  function show(
    over: Parameters<typeof planningReadings>[1] = {},
    roadmap?: Parameters<typeof planningReadings>[0],
  ) {
    return render(
      <PlanningScreen
        readMonth={SEEDED_READ_MONTH}
        mayAdminister
        mayContribute
        readings={planningReadings(roadmap, over)}
      />,
    );
  }

  it("draws no banner at all when everything was read", () => {
    show();

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  // The whole point of the banner: one reason on screen, not one per card.
  it("says a reason once, however many reads failed", () => {
    show({
      sources: { ok: false, reason: "Sources failed." },
      health: { ok: false, reason: "Health failed." },
    });

    const banner = screen.getByRole("status");

    expect(banner).toHaveTextContent(PLANNING_DEGRADED_HEADLINE);
    expect(banner).toHaveTextContent("Sources failed.");
    expect(banner).toHaveTextContent("Health failed.");
    // Exactly once each, and only inside the banner — never repeated by a card.
    expect(within(banner).getByText(/Sources failed\./)).toBeInTheDocument();
    expect(screen.getAllByText(/Sources failed\./)).toHaveLength(1);
    expect(screen.getAllByText(/Health failed\./)).toHaveLength(1);
  });

  it("says the whole page failed when every read did", () => {
    show(
      {
        sources: { ok: false, reason: "b" },
        catalog: { ok: false, reason: "c" },
        health: { ok: false, reason: "d" },
        batch: null,
      },
      { ok: false, reason: "a" },
    );

    expect(screen.getByRole("status")).toHaveTextContent(PLANNING_FAILED_HEADLINE);
  });

  // The distinction the ticket asks for: a failed read and an empty workspace must not look alike.
  it("keeps a failed read visually distinct from an empty one", () => {
    const { unmount } = show({}, { ok: false, reason: "The roadmap: gone" });

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText(ROADMAP_UNREAD)).toBeInTheDocument();
    unmount();

    show({}, { ok: true, value: EMPTY_ROADMAP });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByText(ROADMAP_EMPTY_TITLE)).toBeInTheDocument();
  });
});

describe("the roadmap's empty states (#287)", () => {
  /** The roadmap card. */
  function card() {
    return screen.getByRole("region", { name: /^Roadmap/ });
  }

  it("offers a working New roadmap control inside the card, not only in the head", () => {
    render(
      <PlanningScreen
        readMonth={SEEDED_READ_MONTH}
        mayAdminister
        mayContribute
        readings={planningReadings({ ok: true, value: EMPTY_ROADMAP })}
      />,
    );

    expect(within(card()).getByText(ROADMAP_EMPTY_TITLE)).toBeInTheDocument();
    expect(within(card()).getByRole("button", { name: NEW_ROADMAP_LABEL })).toBeEnabled();
  });

  // A named roadmap with no lanes read as "No roadmap yet" under its own name before #287.
  it("says a named roadmap has no epics rather than no roadmap", () => {
    render(
      <PlanningScreen
        readMonth={SEEDED_READ_MONTH}
        mayAdminister
        mayContribute
        readings={planningReadings({
          ok: true,
          value: { name: "Helios 2.1", window: "Q3–Q4 2026", lanes: [] },
        })}
      />,
    );

    expect(within(card()).getByText(ROADMAP_NO_EPICS_TITLE)).toBeInTheDocument();
    expect(within(card()).queryByText(ROADMAP_EMPTY_TITLE)).not.toBeInTheDocument();
  });

  it("states the reason on the card's control for a member", () => {
    render(
      <PlanningScreen
        readMonth={SEEDED_READ_MONTH}
        mayAdminister={false}
        mayContribute
        readings={planningReadings({ ok: true, value: EMPTY_ROADMAP })}
      />,
    );

    expect(within(card()).getByRole("button", { name: NEW_ROADMAP_LABEL })).toHaveAttribute(
      "title",
      NEW_ROADMAP_ROLE_REASON,
    );
  });
});

describe("a member session (#287)", () => {
  /**
   * The page as a member sees it — may draft and edit, may not push or change the roadmap.
   *
   * With a batch open, because the push button only exists where there are drafts to push.
   */
  function asMember() {
    return render(
      <PlanningScreen
        readMonth={SEEDED_READ_MONTH}
        mayAdminister={false}
        mayContribute
        readings={planningReadings(undefined, { batch: { ok: true, value: planningBatch() } })}
      />,
    );
  }

  it("leaves the generator fully usable", () => {
    asMember();

    expect(screen.getByLabelText(PROMPT_LABEL)).toBeEnabled();
    expect(screen.getByRole("region", { name: GENERATOR_TITLE })).toBeInTheDocument();
  });

  // Scoped, not broken: every control a member may not use says why rather than vanishing.
  it("states the reason on every control it takes away", () => {
    asMember();

    for (const label of [NEW_ROADMAP_LABEL, ADD_EPIC_LABEL]) {
      expect(screen.getAllByRole("button", { name: label })[0]).toHaveAttribute("title");
    }
  });

  it("refuses the push with the role's own reason", () => {
    asMember();

    const push = screen.getByRole("button", { name: /^Push / });

    expect(push).toHaveAttribute("title", PUSH_ROLE_REASON);
    expect(push).toHaveAttribute("aria-disabled", "true");
  });

  it("refuses roadmap changes with the roadmap's own reason", () => {
    asMember();

    expect(screen.getByRole("button", { name: ADD_EPIC_LABEL })).toHaveAttribute(
      "title",
      READ_ONLY_STEP_REASON,
    );
  });
});
