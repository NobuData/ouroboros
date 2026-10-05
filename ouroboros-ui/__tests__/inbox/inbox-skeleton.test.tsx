import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Loading from "@/app/(app)/inbox/loading";
import { InboxSkeleton, SKELETON_CARDS, SKELETON_SIDE_CARDS } from "@/app/inbox/inbox-skeleton";
import { INBOX_EYEBROW, INBOX_LOADING, INBOX_SUBLINE } from "@/app/inbox/view";

import { maskIds, renderInBothPalettes } from "../helpers/palettes";

/**
 * The `/inbox` loading state (BO.5, #470): the real eyebrow and subline, bars where the reads will
 * land, and one busy region a screen reader hears once.
 */

describe("the route's loading file", () => {
  it("draws the skeleton", () => {
    render(<Loading />);

    expect(screen.getByRole("main", { name: INBOX_LOADING })).toHaveAttribute("aria-busy", "true");
  });
});

describe("the skeleton", () => {
  it("draws the frame's known words, and a bar for the headline the service has not sent", () => {
    const { container } = render(<InboxSkeleton />);

    expect(screen.getByText(INBOX_EYEBROW)).toBeInTheDocument();
    expect(screen.getByText(INBOX_SUBLINE)).toBeInTheDocument();
    expect(screen.queryByRole("heading")).toBeNull();
    expect(container.querySelector(".inbox-skeleton__bar--title")).toHaveAttribute("aria-hidden", "true");
  });

  it("reserves the queue's and the side column's geometry, hidden from assistive technology", () => {
    const { container } = render(<InboxSkeleton />);

    expect(container.querySelectorAll(".inbox__main .inbox-skeleton__card")).toHaveLength(SKELETON_CARDS);
    expect(container.querySelectorAll(".inbox__side .inbox-skeleton__card")).toHaveLength(SKELETON_SIDE_CARDS);
    expect(container.querySelector(".inbox__grid")).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("draws the same markup in both palettes", () => {
    const [light, dark] = renderInBothPalettes(<InboxSkeleton />);

    expect(maskIds(light!)).toBe(maskIds(dark!));
  });
});
