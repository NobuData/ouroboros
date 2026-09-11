import { fireEvent, render, screen } from "@testing-library/react";
import { Component, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  IssueSelectionProvider,
  deselected as selectionWithout,
  selected as selectionWith,
  toggled,
  useIssueSelection,
  useSeenRows,
} from "@/app/issues/selection";
import { tableRows } from "@/app/issues/table";

import { SEEDED_ROWS, SELECTED_TRIO } from "../helpers/issues";

/**
 * The backlog's selection store (#115) — the seam the head's queue button reads and N.3's table
 * (#117) will write.
 *
 * Three properties matter to its readers: **the order is the order it was built in**, because the
 * queue hands out positions down the list it is sent; **a toggle is its own inverse**; and **the
 * store refuses to be read outside a provider**, because a default empty selection would draw a
 * queue button that can never be pressed with nothing saying why.
 */

const [FIRST, SECOND, THIRD] = SELECTED_TRIO as [string, string, string];

/** A reader and writer of the selection, standing in for the table. */
function Probe() {
  const { ids, toggle, select, deselect, clear, detail, inspect } = useIssueSelection();

  return (
    <div>
      <output aria-label="Selected">{ids.join(",")}</output>
      <output aria-label="Detail">{detail ?? ""}</output>
      {SELECTED_TRIO.map((id) => (
        <button key={id} onClick={() => toggle(id)} type="button">
          {`Toggle ${id}`}
        </button>
      ))}
      {SELECTED_TRIO.map((id) => (
        <button key={id} onClick={() => inspect(id)} type="button">
          {`Inspect ${id}`}
        </button>
      ))}
      <button onClick={() => select(SELECTED_TRIO)} type="button">
        Select all
      </button>
      <button onClick={() => deselect(SELECTED_TRIO)} type="button">
        Deselect all
      </button>
      <button onClick={() => inspect(null)} type="button">
        Close
      </button>
      <button onClick={clear} type="button">
        Clear
      </button>
    </div>
  );
}

/** Catches a render error so the misuse case can read it without an uncaught error. */
class Boundary extends Component<{ children: ReactNode }, { message: string | null }> {
  state = { message: null as string | null };

  static getDerivedStateFromError(error: Error) {
    return { message: error.message };
  }

  render() {
    return this.state.message === null ? this.props.children : <p role="alert">{this.state.message}</p>;
  }
}

/** The selection as the probe draws it. */
function selected(): string {
  return screen.getByRole("status", { name: "Selected" }).textContent ?? "";
}

/**
 * Press a probe's toggle.
 *
 * @param id The issue to toggle.
 */
function press(id: string): void {
  fireEvent.click(screen.getByRole("button", { name: `Toggle ${id}` }));
}

describe("toggled", () => {
  it("appends an issue that was not selected, after the ones that were", () => {
    expect(toggled([FIRST], SECOND)).toEqual([FIRST, SECOND]);
  });

  it("removes an issue that was, keeping the rest in their order", () => {
    expect(toggled([FIRST, SECOND, THIRD], SECOND)).toEqual([FIRST, THIRD]);
  });

  it("leaves the list it was given alone", () => {
    const ids = Object.freeze([FIRST]);

    expect(() => toggled(ids, SECOND)).not.toThrow();
    expect(ids).toEqual([FIRST]);
  });

  it("ignores an empty id, handing back the very same list", () => {
    const ids = [FIRST];

    expect(toggled(ids, "")).toBe(ids);
  });
});

describe("selected (#117)", () => {
  it("appends the issues that were not selected, in the order given, after the ones that were", () => {
    expect(selectionWith([SECOND], [FIRST, SECOND, THIRD])).toEqual([SECOND, FIRST, THIRD]);
  });

  it("adds an issue once however often it is given, and never an empty id", () => {
    expect(selectionWith([], [FIRST, FIRST, "", THIRD])).toEqual([FIRST, THIRD]);
  });

  it("hands back the very same list when nothing was added", () => {
    const ids = [FIRST, SECOND];

    expect(selectionWith(ids, [SECOND, FIRST])).toBe(ids);
    expect(selectionWith(ids, [])).toBe(ids);
  });
});

describe("deselected (#117)", () => {
  it("removes the issues given, keeping the rest in their order", () => {
    expect(selectionWithout([FIRST, SECOND, THIRD], [THIRD, FIRST])).toEqual([SECOND]);
  });

  it("hands back the very same list when none of them was selected", () => {
    const ids = [FIRST];

    expect(selectionWithout(ids, [SECOND, ""])).toBe(ids);
  });
});

describe("IssueSelectionProvider", () => {
  it("selects the page in one press, keeping what was already selected first, and deselects it in one", () => {
    render(
      <IssueSelectionProvider>
        <Probe />
      </IssueSelectionProvider>,
    );

    press(THIRD);
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    expect(selected()).toBe(`${THIRD},${FIRST},${SECOND}`);

    fireEvent.click(screen.getByRole("button", { name: "Deselect all" }));
    expect(selected()).toBe("");
  });

  it("holds the row whose detail is open apart from the checked set", () => {
    render(
      <IssueSelectionProvider>
        <Probe />
      </IssueSelectionProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: `Inspect ${FIRST}` }));
    expect(screen.getByRole("status", { name: "Detail" })).toHaveTextContent(FIRST);
    expect(selected()).toBe("");

    press(FIRST);
    fireEvent.click(screen.getByRole("button", { name: `Inspect ${SECOND}` }));
    expect(screen.getByRole("status", { name: "Detail" })).toHaveTextContent(SECOND);
    expect(selected()).toBe(FIRST);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByRole("status", { name: "Detail" })).toHaveTextContent("");
    expect(selected()).toBe(FIRST);
  });

  it("starts with nothing selected", () => {
    render(
      <IssueSelectionProvider>
        <Probe />
      </IssueSelectionProvider>,
    );

    expect(selected()).toBe("");
  });

  it("holds the order the selection was built in, not the order of the list", () => {
    render(
      <IssueSelectionProvider>
        <Probe />
      </IssueSelectionProvider>,
    );

    press(THIRD);
    press(FIRST);

    expect(selected()).toBe(`${THIRD},${FIRST}`);
  });

  it("deselects on a second toggle", () => {
    render(
      <IssueSelectionProvider>
        <Probe />
      </IssueSelectionProvider>,
    );

    press(FIRST);
    press(SECOND);
    press(FIRST);

    expect(selected()).toBe(SECOND);
  });

  it("clears everything at once", () => {
    render(
      <IssueSelectionProvider>
        <Probe />
      </IssueSelectionProvider>,
    );

    press(FIRST);
    press(SECOND);
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    expect(selected()).toBe("");
  });

  it("gives each provider its own selection", () => {
    // A selection is something one screen is in the middle of; two mounted screens do not share one.
    render(
      <>
        <IssueSelectionProvider>
          <Probe />
        </IssueSelectionProvider>
        <IssueSelectionProvider>
          <Probe />
        </IssueSelectionProvider>
      </>,
    );

    fireEvent.click(screen.getAllByRole("button", { name: `Toggle ${FIRST}` })[0]!);

    expect(screen.getAllByRole("status", { name: "Selected" }).map((one) => one.textContent)).toEqual([
      FIRST,
      "",
    ]);
  });
});

describe("useIssueSelection", () => {
  it("refuses to be read outside a provider, and says which provider it needs", () => {
    // React reports a caught render error on the console; it is the expected outcome here.
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <Boundary>
        <Probe />
      </Boundary>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(/needs an IssueSelectionProvider/);
    quiet.mockRestore();
  });
});

describe("useSeenRows (#118)", () => {
  /** A reader of the seen rows, and a writer standing in for the table. */
  function SeenProbe() {
    const { seen } = useIssueSelection();
    const rows = useSeenRows();

    return (
      <div>
        <output aria-label="Seen">{[...rows.keys()].join(",")}</output>
        <button onClick={() => seen.publish(tableRows(SEEDED_ROWS))} type="button">
          Draw the page
        </button>
      </div>
    );
  }

  it("starts empty, and follows what the table publishes", () => {
    render(
      <IssueSelectionProvider>
        <SeenProbe />
      </IssueSelectionProvider>,
    );

    expect(screen.getByRole("status", { name: "Seen" })).toHaveTextContent("");

    fireEvent.click(screen.getByRole("button", { name: "Draw the page" }));

    expect(screen.getByRole("status", { name: "Seen" })).toHaveTextContent(
      SEEDED_ROWS.map((row) => row.id).join(","),
    );
  });

  it("is the provider's own store, so two screens do not share a memory either", () => {
    render(
      <>
        <IssueSelectionProvider>
          <SeenProbe />
        </IssueSelectionProvider>
        <IssueSelectionProvider>
          <SeenProbe />
        </IssueSelectionProvider>
      </>,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Draw the page" })[0]!);

    const [first, second] = screen.getAllByRole("status", { name: "Seen" });
    expect(first?.textContent).not.toBe("");
    expect(second?.textContent).toBe("");
  });
});
