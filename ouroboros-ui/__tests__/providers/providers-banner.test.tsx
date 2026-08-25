import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RETRY_LABEL } from "@/app/ui";

/**
 * The providers page's failed-read banner (#232): DASH-I.7's shape, with this page's retry.
 *
 * What the primitive draws is `ui/retry-banner.test.tsx`'s. What is this page's is the
 * headline and the reason it is handed, the placement, and that the retry re-runs the
 * route's reads — `app/models/routing-banner.test.tsx`'s cases, for this page.
 */

const refresh = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const { ProvidersBanner } = await import("@/app/providers/providers-banner");

beforeEach(() => {
  refresh.mockReset();
});

describe("the banner", () => {
  it("is a status carrying the headline and the service's reason", () => {
    render(
      <ProvidersBanner
        headline="The provider connections could not be read."
        reason="The vault is away."
      />,
    );

    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("The provider connections could not be read.");
    expect(banner).toHaveTextContent("The vault is away.");
  });

  it("re-runs the route's reads on retry", () => {
    // `router.refresh()` rather than a navigation: the route's Server Components run again
    // and the result is merged into the page, so a revealed key's countdown survives a retry.
    render(<ProvidersBanner headline="x" reason="y" />);

    fireEvent.click(screen.getByRole("button", { name: RETRY_LABEL }));

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("is never inert, because it is the only way out of this state", () => {
    render(<ProvidersBanner headline="x" reason="y" />);

    const retry = screen.getByRole("button", { name: RETRY_LABEL });

    expect(retry).not.toBeDisabled();
    expect(retry).not.toHaveAttribute("aria-disabled");
  });

  it("sits in the grid's rhythm by a class, and carries no inline style", () => {
    const { container } = render(<ProvidersBanner headline="x" reason="y" />);

    expect(container.firstElementChild).toHaveClass("ou-retry", "providers-banner");
    expect(container.querySelectorAll("[style]")).toHaveLength(0);
  });
});
