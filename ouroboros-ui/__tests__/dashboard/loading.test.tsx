import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Loading from "@/app/(app)/dashboard/loading";

/**
 * The dashboard's loading state.
 *
 * The design system asks every surface to design one rather than leave a blank region
 * (§ 3.3), and Next.js's `loading.tsx` is how a route says what it is. Two things can go
 * wrong with a skeleton and both are asserted below: it can be the wrong *shape*, so the
 * page jumps when the data arrives, and it can be read aloud — a dozen empty boxes
 * announced one by one is worse than saying nothing.
 */

describe("the dashboard's skeleton", () => {
  it("stands in for the same nine cards, at the same column spans", () => {
    // Not "some boxes": the grid the reader is about to see, so nothing moves when it does.
    const { container } = render(<Loading />);

    const spans = [...container.querySelectorAll(".dash-grid > *")].map(
      (card) => [...card.classList].find((name) => name.startsWith("dash-col--")),
    );

    expect(spans).toEqual([
      "dash-col--3",
      "dash-col--3",
      "dash-col--3",
      "dash-col--3",
      "dash-col--8",
      "dash-col--4",
      "dash-col--4",
      "dash-col--7",
      "dash-col--5",
    ]);
  });

  it("uses the page's own frame, so the shell does not reflow when the cards arrive", () => {
    const { container } = render(<Loading />);

    expect(container.querySelector(".dash")).not.toBeNull();
    expect(container.querySelector(".dash__head")).not.toBeNull();
  });

  it("says it is busy, once", () => {
    render(<Loading />);

    expect(screen.getByLabelText("Loading the dashboard")).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });

  it("hides the bars from the accessibility tree rather than reading them out", () => {
    const { container } = render(<Loading />);

    expect(container.querySelector(".dash-grid")).toHaveAttribute("aria-hidden");
  });

  it("carries no text, so nothing on it can be mistaken for data", () => {
    // A skeleton with a number in it is a number somebody will read.
    const { container } = render(<Loading />);

    expect(container.textContent?.trim()).toBe("");
  });

  it("is not a landmark, because the page it stands in for is the `main` one", () => {
    // Two `main` landmarks in one document — the fallback's and, a moment later, the
    // page's — is a document with no main landmark anyone can rely on.
    expect(screen.queryByRole("main")).toBeNull();
  });

  it("styles itself through classes only", () => {
    const { container } = render(<Loading />);

    expect(container.querySelectorAll("[style]")).toHaveLength(0);
  });
});
