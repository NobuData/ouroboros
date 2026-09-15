import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { REGISTRY_FAILED_HEADLINE } from "@/app/registry/view";
import { RETRY_LABEL } from "@/app/ui";

/** The router's refresh — what the banner's retry does. */
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => refresh() }),
}));

const { RegistryFreshness } = await import("@/app/registry/registry-freshness");
const { RegistryFailedBanner } = await import("@/app/registry/registry-banner");

/**
 * The boundary that keeps the registry on screen when a refresh of it fails, and the banner
 * that explains why (#596) — the dashboard's DASH-I.7 technique, on this page.
 *
 * A `rerender` here is what `router.refresh()` delivers in the app: the same client component,
 * handed the server's new render.
 */

beforeEach(() => {
  refresh.mockReset();
});

/**
 * A region with state of its own, so the suite can tell a kept tree from a remounted one.
 *
 * @param props.label What it says.
 * @returns A counter.
 */
function Region({ label }: Readonly<{ label: string }>) {
  const [count, setCount] = useState(0);

  return (
    <button onClick={() => { setCount(count + 1); }} type="button">
      {label} {count}
    </button>
  );
}

describe("a read that worked", () => {
  it("draws the region and no banner", () => {
    render(
      <RegistryFreshness failure={null}>
        <Region label="table" />
      </RegistryFreshness>,
    );

    expect(screen.getByRole("button", { name: "table 0" })).toBeInTheDocument();
    expect(screen.queryByText(REGISTRY_FAILED_HEADLINE)).toBeNull();
  });
});

describe("a refresh that comes back refused", () => {
  it("keeps the last region that worked under the banner, instead of this render's", () => {
    const view = render(
      <RegistryFreshness failure={null}>
        <Region label="table" />
      </RegistryFreshness>,
    );

    view.rerender(
      <RegistryFreshness failure="registry away">
        <Region label="failed seat" />
      </RegistryFreshness>,
    );

    expect(screen.getByText(REGISTRY_FAILED_HEADLINE)).toBeInTheDocument();
    expect(screen.getByText("registry away")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "table 0" })).toBeInTheDocument();
    expect(screen.queryByText(/failed seat/)).toBeNull();
  });

  it("does not remount the kept region, so what the reader was doing in it survives", () => {
    const view = render(
      <RegistryFreshness failure={null}>
        <Region label="table" />
      </RegistryFreshness>,
    );

    fireEvent.click(screen.getByRole("button", { name: "table 0" }));
    fireEvent.click(screen.getByRole("button", { name: "table 1" }));

    view.rerender(
      <RegistryFreshness failure="registry away">
        <Region label="failed seat" />
      </RegistryFreshness>,
    );

    expect(screen.getByRole("button", { name: "table 2" })).toBeInTheDocument();
  });

  it("draws the fresh region again once a retry succeeds", () => {
    const view = render(
      <RegistryFreshness failure={null}>
        <Region label="table" />
      </RegistryFreshness>,
    );

    view.rerender(
      <RegistryFreshness failure="registry away">
        <Region label="failed seat" />
      </RegistryFreshness>,
    );
    view.rerender(
      <RegistryFreshness failure={null}>
        <Region label="table again" />
      </RegistryFreshness>,
    );

    expect(screen.getByRole("button", { name: "table again 0" })).toBeInTheDocument();
    expect(screen.queryByText(REGISTRY_FAILED_HEADLINE)).toBeNull();
  });
});

describe("a first paint that failed", () => {
  it("draws this render's own failed region under the banner — nothing was ever read here", () => {
    render(
      <RegistryFreshness failure="registry away">
        <Region label="failed seat" />
      </RegistryFreshness>,
    );

    expect(screen.getByText(REGISTRY_FAILED_HEADLINE)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "failed seat 0" })).toBeInTheDocument();
  });
});

describe("the banner", () => {
  it("says the state, the service's own sentence, and offers the retry — as a status", () => {
    render(<RegistryFailedBanner reason="registry away" />);

    const banner = screen.getByRole("status");

    expect(banner).toHaveTextContent(REGISTRY_FAILED_HEADLINE);
    expect(banner).toHaveTextContent("registry away");
    expect(banner).toHaveClass("registry-failed");
  });

  it("re-runs the route's reads when the retry is pressed", () => {
    render(<RegistryFailedBanner reason="registry away" />);

    fireEvent.click(screen.getByRole("button", { name: RETRY_LABEL }));

    expect(refresh).toHaveBeenCalledOnce();
  });

  it("never makes the retry inert", () => {
    render(<RegistryFailedBanner reason="registry away" />);

    const retry = screen.getByRole("button", { name: RETRY_LABEL });

    expect(retry).not.toBeDisabled();
    expect(retry).not.toHaveAttribute("aria-disabled");
  });
});
