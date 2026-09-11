import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { HeadOutcomeLine } from "@/app/issues/head-outcome";

/**
 * The line under a head action that says what its last press came back as (#115).
 *
 * Both actions report through it, so the two claims are made once: a press that took is a polite
 * `status` in the muted treatment, and a refusal is an `alert` in the error treatment. Before the
 * first press there is nothing to report and nothing is drawn.
 */

describe("HeadOutcomeLine", () => {
  it("draws nothing before there has been a press", () => {
    const { container } = render(<HeadOutcomeLine outcome={null} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("reports a press that took as a status", () => {
    render(<HeadOutcomeLine outcome={{ ok: true, message: "Queued 3 issues." }} />);

    const line = screen.getByRole("status");

    expect(line).toHaveTextContent("Queued 3 issues.");
    expect(line).toHaveClass("issues__outcome");
    expect(line).not.toHaveClass("issues__outcome--err");
  });

  it("reports a refusal as an alert, in the error treatment", () => {
    render(<HeadOutcomeLine outcome={{ ok: false, reason: "Nothing was queued." }} />);

    const line = screen.getByRole("alert");

    expect(line).toHaveTextContent("Nothing was queued.");
    expect(line).toHaveClass("issues__outcome", "issues__outcome--err");
    expect(screen.queryByRole("status")).toBeNull();
  });
});
