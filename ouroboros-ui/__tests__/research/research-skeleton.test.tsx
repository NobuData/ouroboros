import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Loading from "@/app/(app)/research/loading";
import { ResearchSkeleton } from "@/app/research/research-skeleton";
import { LOADING_LABEL, SKELETON_ROWS } from "@/app/research/states";
import { RESEARCH_HEADLINE, RESEARCH_REGIONS, RESEARCH_SUBLINE } from "@/app/research/view";

import { renderInBothPalettes } from "../helpers/palettes";

/**
 * What `/research` draws while it reads (#633): **skeletons match each region's shape; the page
 * never blanks on refresh**.
 */
describe("the research skeleton", () => {
  it("is what the route's loading boundary returns", () => {
    render(<Loading />);

    expect(screen.getByRole("main", { name: LOADING_LABEL })).toHaveAttribute("aria-busy", "true");
  });

  it("draws the real head, so nothing in it moves when the reads land", () => {
    render(<ResearchSkeleton />);

    expect(screen.getByRole("heading", { level: 1, name: RESEARCH_HEADLINE })).toBeInTheDocument();
    expect(screen.getByText(RESEARCH_SUBLINE)).toBeInTheDocument();
    // The two actions are bars: one of them is inert for a role the skeleton cannot know.
    expect(screen.queryByRole("button")).toBeNull();
    expect(document.querySelectorAll(".research__actions .research__sk-bar--action")).toHaveLength(2);
  });

  it("seats the six regions in the page's own grid, each under its title", () => {
    render(<ResearchSkeleton />);

    const seats = [...document.querySelectorAll(".research__grid .research__seat")];
    expect(seats.map((seat) => seat.querySelector("h2, h3")?.textContent)).toEqual(
      RESEARCH_REGIONS.map((region) => region.title),
    );
    expect(seats[0]).toHaveClass("research__seat--main");
    expect(document.querySelectorAll(".research__side > .research__seat--side")).toHaveLength(2);
    expect(document.querySelectorAll(".research__grid > .research__seat--wide")).toHaveLength(3);
  });

  it("reserves each region's own shape", () => {
    render(<ResearchSkeleton />);
    const [composer, tools, watch, brief, pipeline, list] = [...document.querySelectorAll(".research__seat")];
    const bars = (seat: Element | undefined, modifier: string) =>
      seat?.querySelectorAll(`.research__sk-bar--${modifier}`).length;

    expect(bars(composer, "field")).toBe(1);
    expect(bars(composer, "seg")).toBe(SKELETON_ROWS.kinds);
    expect(bars(composer, "chip")).toBe(SKELETON_ROWS.chips);
    expect(bars(composer, "action")).toBe(1);
    expect(bars(tools, "side-row")).toBe(SKELETON_ROWS.tools);
    expect(bars(watch, "side-row")).toBe(SKELETON_ROWS.watch);
    expect(bars(brief, "para")).toBe(SKELETON_ROWS.brief);
    expect(bars(brief, "side-row")).toBe(SKELETON_ROWS.brief);
    expect(bars(pipeline, "doc")).toBe(1);
    expect(bars(pipeline, "side-row")).toBe(SKELETON_ROWS.pipeline);
    expect(bars(list, "list-row")).toBe(SKELETON_ROWS.list);
  });

  it("says one thing to a screen reader: every bar is hidden", () => {
    render(<ResearchSkeleton />);

    for (const bar of document.querySelectorAll(".research__sk-bar")) {
      expect(bar.closest("[aria-hidden='true']")).not.toBeNull();
      expect(bar.textContent).toBe("");
    }
  });

  it("renders the same markup under both palettes", () => {
    const [light, dark] = renderInBothPalettes(<ResearchSkeleton />);

    expect(light).toBe(dark);
  });
});
