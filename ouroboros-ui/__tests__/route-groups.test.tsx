import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import AuthLayout from "@/app/(auth)/layout";

/**
 * The `(auth)` layout is the pass-through the sign-in frame (#44) will fill. What is
 * worth asserting now is the property that makes it safe to fill: it renders its
 * segment and adds nothing of its own.
 *
 * Its counterpart, `(app)`, stopped being a pass-through when the shell (#41) landed —
 * it is covered by `__tests__/shell/app-shell.test.tsx`.
 */
describe("the (auth) layout", () => {
  it("renders its children", () => {
    render(
      <AuthLayout>
        <p>segment</p>
      </AuthLayout>,
    );

    expect(screen.getByText("segment")).toBeInTheDocument();
  });

  it("wraps them in no markup of its own", () => {
    // Deliberate: a screen outside the shell is standalone (design system § 5), and
    // whatever chrome it needs is its own — including its scroll container.
    const { container } = render(
      <AuthLayout>
        <p>segment</p>
      </AuthLayout>,
    );

    expect(container.innerHTML).toBe("<p>segment</p>");
  });
});
