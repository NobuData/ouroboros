import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OriginBadge } from "@/app/origin/origin-badge";
import { OriginSegment } from "@/app/origin/origin-segment";
import { OriginStrip } from "@/app/origin/origin-strip";

/**
 * The three origin primitives (DJ.3, #1316): the badge on a non-live row, the page strip, and the
 * filter that remembers its choice in a cookie.
 */

afterEach(() => {
  document.cookie = "ouro_origin=; Path=/; Max-Age=0";
});

describe("OriginBadge", () => {
  it("draws nothing for a live row", () => {
    const { container } = render(<OriginBadge origin="live" />);

    expect(container).toBeEmptyDOMElement();
  });

  it("labels a demo row in words, with what it means as its tooltip", () => {
    render(<OriginBadge origin="seeded" />);

    const badge = screen.getByText("Demo data");
    expect(badge).toHaveClass("origin-badge");
    expect(badge).toHaveAttribute("title", "Demo data loaded into this environment — not a real loop.");
  });

  it("labels a simulated row", () => {
    render(<OriginBadge origin="simulated" />);

    expect(screen.getByText("Simulated")).toHaveAttribute(
      "title",
      expect.stringContaining("run simulator"),
    );
  });
});

describe("OriginStrip", () => {
  it("is a note with the readiness link when everything shown is demo data", () => {
    render(<OriginStrip filter="all" present={["seeded"]} />);

    expect(screen.getByRole("note")).toHaveTextContent(
      "This page is showing demo data. No real loop has run in this workspace yet.",
    );
    expect(screen.getByRole("link", { name: "Check readiness →" })).toHaveAttribute(
      "href",
      "/get-started",
    );
  });

  it("draws nothing once live data exists", () => {
    const { container } = render(<OriginStrip filter="all" present={["live", "seeded"]} />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe("OriginSegment", () => {
  it("is a labelled group with the chosen origin pressed", () => {
    render(<OriginSegment onSelect={() => undefined} value="live" />);

    expect(screen.getByRole("group", { name: "Data origin" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Live" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Demo data" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("remembers a press in the origin cookie and hands it to the screen", () => {
    const onSelect = vi.fn();
    render(<OriginSegment onSelect={onSelect} value="live" />);

    fireEvent.click(screen.getByRole("button", { name: "All origins" }));

    expect(onSelect).toHaveBeenCalledWith("all");
    expect(document.cookie).toContain("ouro_origin=all");
  });
});
