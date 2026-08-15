import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { StaleBanner } from "@/app/dashboard/stale-banner";
import { clockTime } from "@/app/dashboard/view";

import { READ_AT } from "../helpers/dashboard";

/**
 * The banner a failed read degrades to (#86).
 *
 * It is the page's whole answer to *what went wrong* and its only answer to *what can I do
 * about it*, so the cases below are about both halves: that the reason appears here and the
 * retry works, and that the two states — data on screen that is old, and no data at all —
 * do not read alike.
 */

const refresh = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

beforeEach(() => {
  refresh.mockReset();
});

describe("the stale state", () => {
  it("says when the data on screen was read", () => {
    // The reader is looking at real figures from a moment ago. The one thing they cannot see
    // for themselves is how old those figures are.
    render(<StaleBanner reason="The service is not available." readAt={READ_AT} />);

    expect(
      screen.getByText(`Showing data from ${clockTime(READ_AT)} — the latest refresh failed.`),
    ).toBeInTheDocument();
  });

  it("carries the service's own sentence beside it", () => {
    render(<StaleBanner reason="The service is not available." readAt={READ_AT} />);

    expect(screen.getByText("The service is not available.")).toBeInTheDocument();
  });

  it("draws the time in the reader's own clock rather than a fixed zone", () => {
    // A banner saying 14:02 to somebody whose clock says 09:02 is a banner about nothing.
    // The formatter is `view.ts`'s, so this asserts the two agree rather than pinning a zone
    // the suite would then be the only thing running in.
    render(<StaleBanner reason="Nope." readAt={READ_AT} />);

    expect(screen.getByText(new RegExp(`from ${clockTime(READ_AT)} `))).toBeInTheDocument();
    expect(clockTime(READ_AT)).toMatch(/\d{1,2}:\d{2}/);
  });
});

describe("the unread state", () => {
  it("says the dashboard could not be read, rather than dating data that does not exist", () => {
    render(<StaleBanner reason="Choose a workspace first." readAt={null} />);

    expect(screen.getByText("The dashboard could not be read.")).toBeInTheDocument();
    expect(screen.queryByText(/Showing data from/)).toBeNull();
  });

  it("still carries the reason and the retry", () => {
    // The first paint failing is the case where the banner is the only thing on the page
    // that knows anything.
    render(<StaleBanner reason="Choose a workspace first." readAt={null} />);

    expect(screen.getByText("Choose a workspace first.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});

describe("the retry", () => {
  it("re-runs the route's reads", () => {
    // `router.refresh()` rather than a navigation: the route's Server Components run again
    // and the result is merged into the page, which is what lets the boundary above keep
    // what it is holding.
    render(<StaleBanner reason="Nope." readAt={READ_AT} />);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("is never disabled, because it is the only way out of this state", () => {
    // Every other inert control on this page says why it cannot act. This one can always
    // act, and a reader whose retry is slow should be able to press it again.
    render(<StaleBanner reason="Nope." readAt={READ_AT} />);

    const retry = screen.getByRole("button", { name: "Retry" });

    expect(retry).not.toBeDisabled();
    expect(retry).not.toHaveAttribute("aria-disabled");

    fireEvent.click(retry);

    expect(refresh).toHaveBeenCalled();
  });
});

describe("how it is announced", () => {
  it("is a status rather than an alert", () => {
    // A polite announcement: the data underneath is still there, and cutting across whatever
    // a screen reader was saying to report that a *refresh* failed is the wrong emphasis.
    render(<StaleBanner reason="Nope." readAt={READ_AT} />);

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says the state in words, not only in the warn hue", () => {
    // Design system § 3.4: meaning is never carried in colour alone.
    render(<StaleBanner reason="Nope." readAt={READ_AT} />);

    expect(screen.getByRole("status")).toHaveTextContent(/refresh failed|could not be read/);
  });

  it("carries every colour and length in a class", () => {
    const { container } = render(<StaleBanner reason="Nope." readAt={READ_AT} />);

    expect(container.querySelectorAll("[style]")).toHaveLength(0);
  });

  it("draws its control out of the design system", () => {
    const { container } = render(<StaleBanner reason="Nope." readAt={READ_AT} />);

    expect(container.querySelectorAll(".ou-btn")).toHaveLength(1);
  });
});
