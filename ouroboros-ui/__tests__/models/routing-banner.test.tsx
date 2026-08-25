import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RoutingFailedBanner } from "@/app/models/routing-banner";
import { ROUTING_FAILED_HEADLINE } from "@/app/models/states";

/**
 * The routing page's failed-read banner (#205) — the DASH-I.7 pattern, on this page.
 *
 * The shape's own rules are `__tests__/ui/retry-banner.test.tsx`'s. What is here is what
 * this page adds: its headline, and a retry that re-runs the route's reads.
 */

const refresh = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

beforeEach(() => {
  refresh.mockReset();
});

describe("the failed-read banner", () => {
  it("says routing could not be read, and carries the service's own sentence", () => {
    render(<RoutingFailedBanner reason="The routing service is not available." />);

    const status = screen.getByRole("status");

    expect(status).toHaveTextContent(ROUTING_FAILED_HEADLINE);
    expect(status).toHaveTextContent("The routing service is not available.");
  });

  it("re-runs the route's reads on retry", () => {
    // `router.refresh()` rather than a navigation: the route's Server Components run again
    // and the result is merged into the page, so a selected row survives a retry.
    render(<RoutingFailedBanner reason="Down." />);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("is never inert, because it is the only way out of this state", () => {
    render(<RoutingFailedBanner reason="Down." />);

    const retry = screen.getByRole("button", { name: "Retry" });

    expect(retry).not.toBeDisabled();
    expect(retry).not.toHaveAttribute("aria-disabled");
  });

  it("sits in the strip's rhythm by a class, and carries no inline style", () => {
    const { container } = render(<RoutingFailedBanner reason="Down." />);

    expect(container.firstElementChild).toHaveClass("ou-retry", "models-failed");
    expect(container.querySelectorAll("[style]")).toHaveLength(0);
  });
});
