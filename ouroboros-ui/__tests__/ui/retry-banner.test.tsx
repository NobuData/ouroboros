import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RETRYING_LABEL, RETRY_LABEL, RetryBanner } from "@/app/ui";

import { PALETTES, renderInBothPalettes, renderInPalette } from "../helpers/palettes";

/**
 * The retry banner (#86's shape, a primitive since #205).
 *
 * The dashboard's and the routing page's banners are one component with two headlines, and
 * these are the properties both inherit: one headline, one reason, one control that can
 * always be pressed, announced politely.
 */

describe("what it says", () => {
  it("prints the headline and the reason, in that order", () => {
    render(<RetryBanner headline="Routing could not be read." onRetry={vi.fn()} reason="Down." />);

    const status = screen.getByRole("status");

    expect(status).toHaveTextContent("Routing could not be read. Down.");
  });

  it("renders the reason as-is, because it is the service's sentence", () => {
    render(<RetryBanner headline="H." onRetry={vi.fn()} reason="Choose a workspace <first>." />);

    expect(screen.getByText("Choose a workspace <first>.")).toBeInTheDocument();
  });
});

describe("the retry", () => {
  it("calls back on press", () => {
    const onRetry = vi.fn();
    render(<RetryBanner headline="H." onRetry={onRetry} reason="R." />);

    fireEvent.click(screen.getByRole("button", { name: RETRY_LABEL }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("is never inert, even while a retry is in flight — the label reports the state instead", () => {
    // The only control that can fix the page must never be the one thing on it that cannot
    // be pressed. A reader whose retry is slow should be able to press again; the caller's
    // guard is what keeps the second press from stacking a second transition.
    const onRetry = vi.fn();
    render(<RetryBanner headline="H." onRetry={onRetry} reason="R." retrying />);

    const retry = screen.getByRole("button", { name: RETRYING_LABEL });

    expect(retry).not.toBeDisabled();
    expect(retry).not.toHaveAttribute("aria-disabled");

    fireEvent.click(retry);

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("takes a caller's own labels", () => {
    render(
      <RetryBanner
        headline="H."
        onRetry={vi.fn()}
        reason="R."
        retryLabel="Try again"
        retryingLabel="Trying…"
      />,
    );

    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("how it is announced", () => {
  it("is a status rather than an alert", () => {
    render(<RetryBanner headline="H." onRetry={vi.fn()} reason="R." />);

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("draws its control out of the design system, and carries no inline style", () => {
    const { container } = render(<RetryBanner headline="H." onRetry={vi.fn()} reason="R." />);

    expect(container.querySelectorAll(".ou-btn")).toHaveLength(1);
    expect(container.querySelectorAll("[style]")).toHaveLength(0);
  });

  it("takes placement from the page and nothing else", () => {
    const { container } = render(
      <RetryBanner className="dash-stale" headline="H." onRetry={vi.fn()} reason="R." />,
    );

    expect(container.firstElementChild).toHaveClass("ou-retry", "dash-stale");
  });
});

describe("both palettes", () => {
  it.each(PALETTES)("renders in the %s palette", (palette) => {
    renderInPalette(palette, <RetryBanner headline="H." onRetry={vi.fn()} reason="R." />);

    expect(document.documentElement).toHaveAttribute("data-theme", palette);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("draws the same markup in both, because the palette is CSS's business", () => {
    const [light, dark] = renderInBothPalettes(
      <RetryBanner headline="H." onRetry={vi.fn()} reason="R." />,
    );

    expect(light).toBe(dark);
  });
});
