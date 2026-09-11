import { fireEvent, render, screen } from "@testing-library/react";
import { Component, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { IssueSelectionProvider, toggled, useIssueSelection } from "@/app/issues/selection";

import { SELECTED_TRIO } from "../helpers/issues";

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

/** A reader and writer of the selection, standing in for the table that will be one. */
function Probe() {
  const { ids, toggle, clear } = useIssueSelection();

  return (
    <div>
      <output aria-label="Selected">{ids.join(",")}</output>
      {SELECTED_TRIO.map((id) => (
        <button key={id} onClick={() => toggle(id)} type="button">
          {`Toggle ${id}`}
        </button>
      ))}
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

describe("IssueSelectionProvider", () => {
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
