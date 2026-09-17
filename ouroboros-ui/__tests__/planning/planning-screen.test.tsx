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
  ROADMAP_GANTT_NOTE,
  ROADMAP_UNREAD,
  SIDE_REGIONS,
  SOON_MARK,
} from "@/app/planning/view";
import { GENERATOR_TITLE, SOURCES_UNREAD } from "@/app/planning/generator";

import { renderInBothPalettes } from "../helpers/palettes";
import { EMPTY_ROADMAP, planningReadings } from "../helpers/planning";

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
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

const { PlanningScreen } = await import("@/app/planning/planning-screen");

describe("the head", () => {
  it("is mockup 09's eyebrow, heading and subline, verbatim", () => {
    render(<PlanningScreen mayAdminister mayContribute readings={planningReadings()} />);

    expect(screen.getByText(PLANNING_EYEBROW)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(PLANNING_TITLE);
    expect(screen.getByText(PLANNING_SUBLINE)).toBeInTheDocument();
  });

  it("draws Import from Jira as an inert ghost marked soon, naming #291, that opens nothing", () => {
    render(<PlanningScreen mayAdminister mayContribute readings={planningReadings()} />);

    const importJira = screen.getByRole("button", { name: `${IMPORT_JIRA_LABEL} ${SOON_MARK}` });

    expect(importJira).toHaveClass("ou-btn--ghost");
    expect(importJira).toHaveAttribute("aria-disabled", "true");
    expect(importJira).toHaveAttribute("title", IMPORT_JIRA_SOON_NOTE);

    fireEvent.click(importJira);

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("draws New roadmap live for an owner or an admin, and inert with the reason for anyone else", () => {
    const { unmount } = render(<PlanningScreen mayAdminister mayContribute readings={planningReadings()} />);

    expect(screen.getByRole("button", { name: NEW_ROADMAP_LABEL })).not.toHaveAttribute("aria-disabled");
    unmount();

    render(<PlanningScreen mayAdminister={false} mayContribute={false} readings={planningReadings()} />);

    expect(screen.getByRole("button", { name: NEW_ROADMAP_LABEL })).toHaveAttribute(
      "title",
      NEW_ROADMAP_ROLE_REASON,
    );
  });

  it("puts Import from Jira before New roadmap, as the mockup does", () => {
    render(<PlanningScreen mayAdminister mayContribute readings={planningReadings()} />);

    const labels = screen.getAllByRole("button").map((button) => button.textContent);

    expect(labels.indexOf(`${IMPORT_JIRA_LABEL} ${SOON_MARK}`)).toBeLessThan(labels.indexOf(NEW_ROADMAP_LABEL));
  });
});

describe("the frame", () => {
  it("is mounted as the page's main landmark, with no chrome of its own", () => {
    const { container } = render(<PlanningScreen mayAdminister mayContribute readings={planningReadings()} />);

    expect(container.firstElementChild?.tagName).toBe("MAIN");
    expect(container.firstElementChild).toHaveClass("planning");
  });

  it("seats the generator in the 7, the two side cards in the 5 and the roadmap in the 12", () => {
    const { container } = render(<PlanningScreen mayAdminister mayContribute readings={planningReadings()} />);

    const generator = container.querySelector(".planning__generator")!;
    const side = container.querySelector(".planning__side")!;
    const roadmap = container.querySelector(".planning__roadmap")!;

    expect(within(generator as HTMLElement).getByRole("region", { name: GENERATOR_TITLE })).toBeInTheDocument();
    expect(
      within(side as HTMLElement).getAllByRole("region").map((region) => region.getAttribute("aria-labelledby")),
    ).toEqual(SIDE_REGIONS.map((region) => region.id));
    expect(within(roadmap as HTMLElement).getByRole("region", { name: "Roadmap — Helios 2.1" })).toBeInTheDocument();

    // Grid order is document order: 7, then 5, then 12.
    expect([...container.querySelector(".planning__grid")!.children]).toEqual([generator, side, roadmap]);
  });

  it("names the issue each unbuilt region waits for", () => {
    render(<PlanningScreen mayAdminister mayContribute readings={planningReadings()} />);

    for (const region of SIDE_REGIONS) expect(screen.getByText(region.note)).toBeInTheDocument();
  });

  it("renders identically in both palettes", () => {
    const [light, dark] = renderInBothPalettes(<PlanningScreen mayAdminister mayContribute readings={planningReadings()} />);

    expect(light).toBe(dark);
  });
});

describe("the generator region (#284)", () => {
  it("builds the tracker segment from the workspace's sources and the catalog", () => {
    render(<PlanningScreen mayAdminister mayContribute readings={planningReadings()} />);

    const trackers = screen.getByRole("group", { name: "Target tracker" });

    expect(within(trackers).getByRole("button", { name: "GitHub Issues" })).toHaveAttribute("aria-pressed", "true");
    // The seed's Jira source exists, but this build's catalog cannot write to Jira.
    expect(within(trackers).getByRole("button", { name: /^Jira/ })).toHaveAttribute("aria-disabled", "true");
    expect(within(trackers).getByRole("button", { name: /^Linear/ })).toHaveAttribute("aria-disabled", "true");
  });

  it("says the trackers could not be read, and leaves the rest of the page standing", () => {
    render(
      <PlanningScreen
        mayAdminister
        mayContribute
        readings={planningReadings(undefined, { sources: { ok: false, reason: "The service failed." } })}
      />,
    );

    expect(screen.getByText(`${SOURCES_UNREAD} The service failed.`)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Roadmap — Helios 2.1" })).toBeInTheDocument();
  });
});

describe("the roadmap region", () => {
  it("is headed by the roadmap's name and window, and counts its epics until the gantt arrives", () => {
    render(<PlanningScreen mayAdminister mayContribute readings={planningReadings()} />);

    const region = screen.getByRole("region", { name: "Roadmap — Helios 2.1" });

    expect(within(region).getByText("Q3–Q4 2026")).toBeInTheDocument();
    expect(within(region).getByText("5 epics planned.")).toBeInTheDocument();
    expect(within(region).getByText(ROADMAP_GANTT_NOTE)).toBeInTheDocument();
  });

  it("says how to start one when the workspace has planned nothing", () => {
    render(<PlanningScreen mayAdminister mayContribute readings={planningReadings({ ok: true, value: EMPTY_ROADMAP })} />);

    const region = screen.getByRole("region", { name: "Roadmap" });

    expect(within(region).getByText(ROADMAP_EMPTY_TITLE)).toBeInTheDocument();
    expect(within(region).getByText(ROADMAP_EMPTY_NOTE)).toBeInTheDocument();
  });

  it("says the roadmap could not be read, with the service's reason, and leaves the rest standing", () => {
    render(<PlanningScreen mayAdminister mayContribute readings={planningReadings({ ok: false, reason: "The service failed." })} />);

    const region = screen.getByRole("region", { name: "Roadmap" });

    expect(within(region).getByText(ROADMAP_UNREAD)).toBeInTheDocument();
    expect(within(region).getByText("The service failed.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(PLANNING_TITLE);
    expect(screen.getByRole("button", { name: NEW_ROADMAP_LABEL })).toBeInTheDocument();
  });
});
