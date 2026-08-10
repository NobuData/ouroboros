import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import AppLayout from "@/app/(app)/layout";
import AuthLayout from "@/app/(auth)/layout";

/**
 * The two route-group layouts are pass-throughs the shell (#41) and the sign-in frame
 * (#44) will fill. What is worth asserting now is the property that makes them safe to
 * fill: they render their segment and add nothing of their own, so a screen behaves the
 * same whichever group it is filed under.
 */
describe.each([
  ["(app)", AppLayout],
  ["(auth)", AuthLayout],
])("the %s layout", (_name, Layout) => {
  it("renders its children", () => {
    render(
      <Layout>
        <p>segment</p>
      </Layout>,
    );

    expect(screen.getByText("segment")).toBeInTheDocument();
  });

  it("wraps them in no markup of its own", () => {
    const { container } = render(
      <Layout>
        <p>segment</p>
      </Layout>,
    );

    expect(container.innerHTML).toBe("<p>segment</p>");
  });
});
