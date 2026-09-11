import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DASHBOARD_QUEUE_HREF,
  DISMISS_LABEL,
  NOTHING_QUEUED_TITLE,
  QUEUE_ISSUE_CODES,
  type QueueOutcome,
  SEE_QUEUE_LABEL,
  deselectLabel,
  selectedLabel,
} from "@/app/issues/bar";
import { tableRows } from "@/app/issues/table";
import { QUEUE_NOTHING_SELECTED, QUEUE_ROLE_REASON } from "@/app/issues/view";

import { ESTIMATING_ROW, SEEDED_ROWS, SELECTED_TRIO, issueId, queuedSelection } from "../helpers/issues";
import { maskIds, renderInBothPalettes } from "../helpers/palettes";
import { settle } from "../helpers/settle";

/**
 * The selection action bar (#118), as a component.
 *
 * The issue's criteria that a render can show: the bar appears and disappears with the
 * selection; the combined estimate is the seeds' over the mockup's trio; the workflow menu
 * changes the primary action's label and what is sent; a press that took clears the selection,
 * re-reads the route and toasts the service's own number with a link to the dashboard's queue
 * card; a refusal naming issues opens the dialog that names them and offers to deselect them;
 * a refusal naming none is a line in the bar; a viewer's action is inert. The table is stood in
 * for by a picker that writes the same store and a publisher that hands the store the seeded
 * rows, and the server hop is replaced.
 */

/** What the action answers, per case. */
const queueUnder = vi.fn();

/** What tells the server's own render that the backlog moved. */
const refresh = vi.fn();

vi.mock("@/app/issues/head-actions", () => ({
  queueUnder: (ids: readonly string[], workflow: string | null) => queueUnder(ids, workflow),
  queueSelected: vi.fn(),
  reestimateAll: vi.fn(),
  syncBacklog: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const { SelectionBar } = await import("@/app/issues/selection-bar");
const { IssueSelectionProvider, useIssueSelection } = await import("@/app/issues/selection");

const [FIRST, SECOND, THIRD] = SELECTED_TRIO as [string, string, string];

/** The table's stand-in: one toggle per seeded issue, and the seeded rows published as seen. */
function Table() {
  const { toggle, seen } = useIssueSelection();

  useEffect(() => {
    seen.publish(tableRows(SEEDED_ROWS));
  }, [seen]);

  return (
    <div>
      {SEEDED_ROWS.map((row) => (
        <button key={row.id} onClick={() => toggle(row.id)} type="button">
          {`Select ${row.id}`}
        </button>
      ))}
    </div>
  );
}

/**
 * The bar beside the stand-in, inside one provider — the shape the screen has.
 *
 * @param mayContribute Whether the reader's role may queue.
 * @returns The element.
 */
function bar(mayContribute = true) {
  return (
    <IssueSelectionProvider>
      <Table />
      <SelectionBar mayContribute={mayContribute} />
    </IssueSelectionProvider>
  );
}

/**
 * Select issues through the stand-in, in the order given.
 *
 * @param ids The issues.
 */
function select(...ids: readonly string[]): void {
  for (const id of ids) fireEvent.click(screen.getByRole("button", { name: `Select ${id}` }));
}

/** The primary action, whatever workflow it names. */
function queueButton(): HTMLElement {
  return screen.getByRole("button", { name: /^Queue → / });
}

/** The bar's sentence. */
function sentence(): string {
  return document.querySelector(".issues-bar__summary")?.textContent ?? "";
}

/**
 * Choose a workflow through the menu.
 *
 * @param name The row's name.
 */
function choose(name: RegExp | string): void {
  fireEvent.click(screen.getByRole("button", { name: "Assign workflow" }));
  fireEvent.click(screen.getByRole("menuitemradio", { name }));
}

/**
 * A refusal naming issues, as the action answers one.
 *
 * @returns The outcome.
 */
function refused(): QueueOutcome {
  return {
    ok: false,
    reason: "Some of those issues have not been sized yet. Only sized issues can be queued. Nothing was queued.",
    offenders: [
      { issueId: ESTIMATING_ROW.id, code: QUEUE_ISSUE_CODES.notSized, issueNumber: 483, sizingStatus: "estimating" },
    ],
  };
}

/**
 * An answer this suite finishes itself, so a press can be observed while it is in flight.
 *
 * @returns The promise the action returns, and the way to settle it.
 */
function deferred(): { promise: Promise<QueueOutcome>; answer: (outcome: QueueOutcome) => void } {
  let answer!: (outcome: QueueOutcome) => void;
  const promise = new Promise<QueueOutcome>((resolve) => {
    answer = resolve;
  });

  return { promise, answer };
}

beforeEach(() => {
  queueUnder.mockReset().mockResolvedValue({ ok: true, queued: queuedSelection(3, 125) });
  refresh.mockReset();
});

describe("with nothing selected", () => {
  it("draws no bar at all", () => {
    const { container } = render(bar());

    expect(container.querySelector(".ou-sticky-bar")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Queue → / })).toBeNull();
  });
});

describe("with a selection", () => {
  it("appears with the first tick and goes with the last", () => {
    const { container } = render(bar());

    select(FIRST);
    expect(container.querySelector(".ou-sticky-bar")).toHaveClass("ou-sticky-bar--asking", "issues-bar");
    expect(sentence()).toContain(selectedLabel(1));

    select(FIRST);
    expect(container.querySelector(".ou-sticky-bar")).toBeNull();
  });

  it("reads the mockup's sentence over the seeds' sum for the mockup's trio", () => {
    render(bar());

    select(FIRST, SECOND, THIRD);

    expect(sentence()).toBe("3 issues selected · est. 2h 5m combined autonomous work");
    expect(queueButton()).toHaveTextContent("Queue → standard-fix");
  });

  it("counts an unsized issue apart from the sum, and reads suggested over a mixed selection", () => {
    render(bar());

    select(FIRST, ESTIMATING_ROW.id, issueId(488));

    expect(sentence()).toBe(
      "3 issues selected · est. 1h combined autonomous work · 1 issue not sized yet",
    );
    expect(queueButton()).toHaveTextContent("Queue → suggested");
  });

  it("names the chosen workflow on the primary action", () => {
    render(bar());

    select(FIRST, issueId(488));
    choose("docs-loop");

    expect(queueButton()).toHaveTextContent("Queue → docs-loop");

    choose(/Use suggested/);

    expect(queueButton()).toHaveTextContent("Queue → suggested");
  });
});

describe("a press", () => {
  it("sends the selection in its order under no workflow by default", async () => {
    render(bar());

    select(THIRD, FIRST);
    fireEvent.click(queueButton());

    await waitFor(() => expect(queueUnder).toHaveBeenCalledExactlyOnceWith([THIRD, FIRST], null));
  });

  it("sends the chosen workflow", async () => {
    render(bar());

    select(FIRST);
    choose("deps-refresh");
    fireEvent.click(queueButton());

    await waitFor(() => expect(queueUnder).toHaveBeenCalledExactlyOnceWith([FIRST], "deps-refresh"));
  });

  it("that took clears the selection, re-reads the route, and toasts the service's number with the way to the queue", async () => {
    const { container } = render(bar());

    select(FIRST, SECOND, THIRD);
    fireEvent.click(queueButton());

    const toast = await screen.findByRole("status");

    expect(toast).toHaveTextContent("Queued 3 issues · est. 2h 5m combined autonomous work.");
    expect(within(toast).getByRole("link", { name: SEE_QUEUE_LABEL })).toHaveAttribute("href", DASHBOARD_QUEUE_HREF);
    expect(container.querySelector(".ou-sticky-bar")).toBeNull();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("toasts what the service counted, not what was selected", async () => {
    queueUnder.mockResolvedValue({ ok: true, queued: queuedSelection(2, 95) });
    render(bar());

    select(FIRST, SECOND, THIRD);
    fireEvent.click(queueButton());

    expect(await screen.findByRole("status")).toHaveTextContent("Queued 2 issues · est. 1h 35m");
  });

  it("leaves the toast until it is dismissed", async () => {
    render(bar());

    select(FIRST);
    fireEvent.click(queueButton());
    await screen.findByRole("status");

    fireEvent.click(screen.getByRole("button", { name: DISMISS_LABEL }));

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("that was refused for named issues opens the dialog that names them, and keeps the selection", async () => {
    queueUnder.mockResolvedValue(refused());
    render(bar());

    select(FIRST, ESTIMATING_ROW.id);
    fireEvent.click(queueButton());

    const dialog = await screen.findByRole("dialog", { name: NOTHING_QUEUED_TITLE });

    expect(within(dialog).getByRole("heading", { level: 2 })).toHaveTextContent(NOTHING_QUEUED_TITLE);
    expect(within(dialog).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "#483 is still being sized.",
    ]);
    expect(dialog).toHaveTextContent("so the other 1 issue was left out with it.");
    expect(sentence()).toContain(selectedLabel(2));
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("deselects exactly the issues the refusal named, from the dialog", async () => {
    queueUnder.mockResolvedValue(refused());
    render(bar());

    select(FIRST, ESTIMATING_ROW.id, SECOND);
    fireEvent.click(queueButton());
    const dialog = await screen.findByRole("dialog");

    fireEvent.click(within(dialog).getByRole("button", { name: deselectLabel(1) }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(sentence()).toBe("2 issues selected · est. 1h 35m combined autonomous work");
  });

  it("closes the dialog without touching the selection", async () => {
    queueUnder.mockResolvedValue(refused());
    render(bar());

    select(FIRST, ESTIMATING_ROW.id);
    fireEvent.click(queueButton());
    const dialog = await screen.findByRole("dialog");

    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(sentence()).toContain(selectedLabel(2));
  });

  it("that was refused for no named issue says why in the bar", async () => {
    queueUnder.mockResolvedValue({ ok: false, reason: "The selection could not be queued. Nothing was queued.", offenders: [] });
    render(bar());

    select(FIRST);
    fireEvent.click(queueButton());

    expect(await screen.findByRole("alert")).toHaveTextContent("Nothing was queued.");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(sentence()).toContain(selectedLabel(1));
  });

  it("is sent once, however many times the action is pressed while it is in flight", async () => {
    const write = deferred();
    queueUnder.mockReturnValue(write.promise);
    render(bar());

    select(FIRST);
    fireEvent.click(queueButton());
    await settle();
    fireEvent.click(queueButton());

    expect(queueUnder).toHaveBeenCalledOnce();

    write.answer({ ok: true, queued: queuedSelection(1, 45) });
    expect(await screen.findByRole("status")).toHaveTextContent("Queued 1 issue");
  });

  it("clears the last press's report when the next one starts", async () => {
    queueUnder.mockResolvedValueOnce({ ok: false, reason: "Refused. Nothing was queued.", offenders: [] });
    const second = deferred();
    queueUnder.mockReturnValueOnce(second.promise);
    render(bar());

    select(FIRST);
    fireEvent.click(queueButton());
    await screen.findByRole("alert");
    await settle();

    fireEvent.click(queueButton());

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());

    second.answer({ ok: true, queued: queuedSelection(1, 45) });
    expect(await screen.findByRole("status")).toHaveTextContent("Queued 1 issue");
  });
});

describe("a viewer", () => {
  it("gets an inert action whatever is selected, with the role as the reason", () => {
    render(bar(false));

    select(FIRST, SECOND);

    expect(queueButton()).toHaveAttribute("aria-disabled", "true");
    expect(queueButton()).toHaveAttribute("title", QUEUE_ROLE_REASON);
    expect(queueButton()).not.toBeDisabled();

    fireEvent.click(queueButton());
    expect(queueUnder).not.toHaveBeenCalled();
  });

  it("never sees the zero-selection reason, since the bar is not drawn at zero", () => {
    render(bar(false));

    expect(screen.queryByTitle(QUEUE_NOTHING_SELECTED)).toBeNull();
  });
});

describe("both palettes", () => {
  it("render the same markup, so the theme is the stylesheet's alone", () => {
    const [light, dark] = renderInBothPalettes(bar());

    expect(maskIds(light!)).toBe(maskIds(dark!));
  });
});
