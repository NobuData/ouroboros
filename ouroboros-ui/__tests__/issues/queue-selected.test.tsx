import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HeadOutcome } from "@/app/issues/view";
import { QUEUE_NOTHING_SELECTED, QUEUE_ROLE_REASON, queueLabel } from "@/app/issues/view";

import { SELECTED_TRIO } from "../helpers/issues";
import { settle } from "../helpers/settle";

/**
 * **Queue N selected ⟳** (#115) — the head control that proves the selection reaches outside the
 * table.
 *
 * The acceptance criterion is *disabled at zero selection and reflects the live count*, and the
 * table that makes a selection is N.3's, so a picker stands in for it here: it writes through the
 * same store the table will. Around that: the press sends the selection in its order, a press that
 * took clears it and re-reads the route, a refusal keeps it, and a viewer's control is inert
 * whatever is selected. What the action does with the ids is `head-actions.test.ts`'s; it is
 * replaced here.
 */

/** What the action answers, per case. */
const queueSelected = vi.fn();

/** What tells the server's own render that the backlog moved. */
const refresh = vi.fn();

vi.mock("@/app/issues/head-actions", () => ({
  queueSelected: (ids: readonly string[]) => queueSelected(ids),
  reestimateAll: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const { QueueSelectedButton } = await import("@/app/issues/queue-selected");
const { IssueSelectionProvider, useIssueSelection } = await import("@/app/issues/selection");

const [FIRST, SECOND, THIRD] = SELECTED_TRIO as [string, string, string];

/** The table's stand-in: one toggle per issue, writing through the selection store. */
function Picker() {
  const { toggle } = useIssueSelection();

  return (
    <div>
      {SELECTED_TRIO.map((id) => (
        <button key={id} onClick={() => toggle(id)} type="button">
          {`Select ${id}`}
        </button>
      ))}
    </div>
  );
}

/**
 * The head's button beside the picker, inside one provider — which is the shape the screen has.
 *
 * @param mayContribute Whether the reader's role may queue.
 * @returns The render result.
 */
function head(mayContribute = true) {
  return render(
    <IssueSelectionProvider>
      <Picker />
      <QueueSelectedButton mayContribute={mayContribute} />
    </IssueSelectionProvider>,
  );
}

/** The queue button, whatever count it carries. */
function button(): HTMLElement {
  return screen.getByRole("button", { name: /^Queue [\d,]+ selected/ });
}

/**
 * Select issues through the picker, in the order given.
 *
 * @param ids The issues.
 */
function select(...ids: readonly string[]): void {
  for (const id of ids) fireEvent.click(screen.getByRole("button", { name: `Select ${id}` }));
}

/**
 * An answer this suite finishes itself, so a press can be observed while it is in flight.
 *
 * @returns The promise the action returns, and the way to settle it.
 */
function deferred(): { promise: Promise<HeadOutcome>; answer: (outcome: HeadOutcome) => void } {
  let answer!: (outcome: HeadOutcome) => void;
  const promise = new Promise<HeadOutcome>((resolve) => {
    answer = resolve;
  });

  return { promise, answer };
}

beforeEach(() => {
  queueSelected.mockReset().mockResolvedValue({ ok: true, message: "Queued 3 issues." });
  refresh.mockReset();
});

describe("with nothing selected", () => {
  it("says zero, is inert, and names what it is waiting for", () => {
    head();

    expect(button()).toHaveTextContent(queueLabel(0));
    expect(button()).toHaveAttribute("aria-disabled", "true");
    expect(button()).toHaveAttribute("title", QUEUE_NOTHING_SELECTED);
    // `aria-disabled`, not `disabled`: the reason stays in the tab order.
    expect(button()).not.toBeDisabled();
  });

  it("does not act when pressed anyway", () => {
    head();

    fireEvent.click(button());

    expect(queueSelected).not.toHaveBeenCalled();
  });
});

describe("the live count", () => {
  it("follows the selection as it is built", () => {
    head();

    select(FIRST);
    expect(button()).toHaveTextContent(queueLabel(1));

    select(SECOND, THIRD);
    expect(button()).toHaveTextContent(queueLabel(3));
    expect(button()).not.toHaveAttribute("aria-disabled");
    expect(button()).not.toHaveAttribute("title");
  });

  it("follows a deselection back down, to inert again at zero", () => {
    head();

    select(FIRST, SECOND, FIRST);
    expect(button()).toHaveTextContent(queueLabel(1));

    select(SECOND);
    expect(button()).toHaveTextContent(queueLabel(0));
    expect(button()).toHaveAttribute("aria-disabled", "true");
  });
});

describe("a press", () => {
  it("sends the selection in the order it was built", async () => {
    head();

    select(THIRD, FIRST);
    fireEvent.click(button());

    await waitFor(() => expect(queueSelected).toHaveBeenCalledExactlyOnceWith([THIRD, FIRST]));
  });

  it("that took says so, clears the selection and re-reads the route", async () => {
    head();

    select(FIRST, SECOND, THIRD);
    fireEvent.click(button());

    expect(await screen.findByRole("status")).toHaveTextContent("Queued 3 issues.");
    expect(button()).toHaveTextContent(queueLabel(0));
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("that was refused says why, keeps the selection, and re-reads nothing", async () => {
    queueSelected.mockResolvedValue({
      ok: false,
      reason: "Some of those issues have not been sized yet. Nothing was queued.",
    });
    head();

    select(FIRST, SECOND, THIRD);
    fireEvent.click(button());

    expect(await screen.findByRole("alert")).toHaveTextContent(/Nothing was queued\./);
    // All or nothing: the reader may deselect the issue the refusal names and press again.
    expect(button()).toHaveTextContent(queueLabel(3));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("is sent once, however many times the button is pressed while it is in flight", async () => {
    const write = deferred();
    queueSelected.mockReturnValue(write.promise);
    head();

    select(FIRST);
    fireEvent.click(button());
    await settle();
    fireEvent.click(button());

    expect(queueSelected).toHaveBeenCalledOnce();

    write.answer({ ok: true, message: "Queued 1 issue." });
    expect(await screen.findByRole("status")).toHaveTextContent("Queued 1 issue.");
  });

  it("clears the last press's report when the next one starts", async () => {
    queueSelected.mockResolvedValueOnce({ ok: false, reason: "Refused. Nothing was queued." });
    const second = deferred();
    queueSelected.mockReturnValueOnce(second.promise);
    head();

    select(FIRST);
    fireEvent.click(button());
    await screen.findByRole("alert");
    await settle();

    fireEvent.click(button());

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());

    second.answer({ ok: true, message: "Queued 1 issue." });
    expect(await screen.findByRole("status")).toHaveTextContent("Queued 1 issue.");
  });
});

describe("a viewer", () => {
  it("gets an inert control whatever is selected, with the role as the reason", () => {
    head(false);

    select(FIRST, SECOND);

    expect(button()).toHaveTextContent(queueLabel(2));
    expect(button()).toHaveAttribute("aria-disabled", "true");
    expect(button()).toHaveAttribute("title", QUEUE_ROLE_REASON);

    fireEvent.click(button());
    expect(queueSelected).not.toHaveBeenCalled();
  });
});
