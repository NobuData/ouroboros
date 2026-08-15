import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * The `(app)` layout, and the one decision in it
 * ([#87](https://github.com/NobuData/ouroboros/issues/87)).
 *
 * It renders the shell, which is `__tests__/shell/app-shell.test.tsx`'s subject. What is
 * here is **where the polling store is provided**, because that placement is what makes the
 * contract's *one request per interval* true across the whole product: this is the one node
 * above both consumers — the topbar pills, which are chrome on every signed-in screen, and
 * the dashboard's own cards. Provided inside the dashboard route instead, the pills would
 * need a second poll and the two would disagree on one screen.
 *
 * The shell is stubbed, and deliberately: this suite is about the wrapping, and rendering
 * the real header would drag in a session, a router and four Server Actions to assert a
 * structural fact about two elements.
 */

vi.mock("@/app/shell/app-shell", () => ({
  AppShell: ({ children }: Readonly<{ children: React.ReactNode }>) => (
    <div data-testid="shell">{children}</div>
  ),
}));

vi.mock("@/app/dashboard/summary-store", () => ({
  DashboardSummaryProvider: ({ children }: Readonly<{ children: React.ReactNode }>) => (
    <div data-testid="summary-store">{children}</div>
  ),
}));

const { default: AppLayout } = await import("@/app/(app)/layout");

describe("the (app) layout", () => {
  it("renders its children inside the shell", () => {
    render(
      <AppLayout>
        <p>segment</p>
      </AppLayout>,
    );

    expect(screen.getByTestId("shell")).toContainElement(screen.getByText("segment"));
  });

  it("provides the summary store above the shell, not below it", () => {
    // Above, because the header is one of the two things that read it — a provider inside
    // the shell would have to be inside the header too.
    render(
      <AppLayout>
        <p>segment</p>
      </AppLayout>,
    );

    expect(screen.getByTestId("summary-store")).toContainElement(screen.getByTestId("shell"));
  });
});
