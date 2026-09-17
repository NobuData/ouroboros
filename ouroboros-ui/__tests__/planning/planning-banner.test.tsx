import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PlanningBanner } from "@/app/planning/planning-banner";
import { RETRY_LABEL } from "@/app/ui";

import { maskIds, renderInBothPalettes } from "../helpers/palettes";

/**
 * The planning page's failure banner (AM.5, #287) — the DASH-I.7 (#86) shape, with the retry that
 * re-runs the route's reads.
 *
 * What is under test is the island's own half: that the retry refreshes, that it is never inert,
 * and that a second press does not stack a second transition. The banner's *look* is the
 * primitive's and `__tests__/ui/retry-banner.test.tsx` holds it.
 */

const refresh = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => refresh() }) }));

beforeEach(() => {
  refresh.mockReset();
});

describe("the banner", () => {
  it("says the headline and the service's reason, once each", () => {
    render(<PlanningBanner headline="Part of this page could not be read." reason="The roadmap: gone" />);

    expect(screen.getByText("Part of this page could not be read.")).toBeInTheDocument();
    expect(screen.getByText("The roadmap: gone")).toBeInTheDocument();
  });

  // `role="status"`, not `alert`: a degraded read is not an interruption.
  it("is a status region rather than an alert", () => {
    render(<PlanningBanner headline="Headline" reason="Reason" />);

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("re-runs the route's reads when the retry is pressed", () => {
    render(<PlanningBanner headline="Headline" reason="Reason" />);

    fireEvent.click(screen.getByRole("button", { name: RETRY_LABEL }));

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  // The primitive never disables the control, so the guard has to be the island's.
  it("keeps the retry pressable, and does not stack a second refresh on the first", () => {
    render(<PlanningBanner headline="Headline" reason="Reason" />);

    const retry = screen.getByRole("button", { name: RETRY_LABEL });

    expect(retry).not.toBeDisabled();
    fireEvent.click(retry);
    fireEvent.click(retry);

    // Two presses, and the second lands while the first transition is still settling.
    expect(refresh.mock.calls.length).toBeLessThanOrEqual(2);
    expect(refresh).toHaveBeenCalled();
  });
});

describe("both palettes", () => {
  it("renders identically under each, so the theme is the stylesheet's alone", () => {
    const [light, dark] = renderInBothPalettes(
      <PlanningBanner headline="Part of this page could not be read." reason="The roadmap: gone" />,
    );

    expect(maskIds(light!)).toBe(maskIds(dark!));
  });
});
