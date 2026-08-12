import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import AuthLayout from "@/app/(auth)/layout";

/**
 * The `(auth)` layout is a pass-through, and stayed one when the sign-in screen (#44)
 * landed inside it: `/login` is a full-bleed split, so a frame here would be a frame that
 * screen has to undo. What the group shares is a rule rather than markup — a screen
 * outside the shell owns its own scroll container, which `app/login/login.css` is where
 * #44 does it and `__tests__/login/login-styles.test.ts` is where that is held.
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
