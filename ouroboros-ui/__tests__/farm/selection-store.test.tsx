import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SelectionProvider, useFarmSelection } from "@/app/farm/selection-store";

/**
 * The table's selection, held above the table (#261) so the live log card can follow it. What the
 * two readers *do* with it is `runners-card.test.tsx`'s and `live-card.test.tsx`'s.
 */

/** A writer and a reader, as two regions of one screen. */
function Writer() {
  const { select } = useFarmSelection();

  return (
    <button onClick={() => select("runner-2")} type="button">
      select
    </button>
  );
}

function Reader() {
  return <output>{useFarmSelection().runnerId ?? "none"}</output>;
}

describe("the selection", () => {
  it("starts with nothing selected", () => {
    render(
      <SelectionProvider>
        <Reader />
      </SelectionProvider>,
    );

    expect(screen.getByRole("status")).toHaveTextContent("none");
  });

  it("is one answer for every region under the provider", () => {
    render(
      <SelectionProvider>
        <Writer />
        <Reader />
      </SelectionProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "select" }));

    expect(screen.getByRole("status")).toHaveTextContent("runner-2");
  });

  it("reads as nothing selected outside a provider, and selecting there does nothing", () => {
    render(
      <>
        <Writer />
        <Reader />
      </>,
    );

    fireEvent.click(screen.getByRole("button", { name: "select" }));

    expect(screen.getByRole("status")).toHaveTextContent("none");
  });
});
