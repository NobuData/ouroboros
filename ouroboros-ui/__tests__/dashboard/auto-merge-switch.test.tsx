import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The auto-merge switch ([#83](https://github.com/NobuData/ouroboros/issues/83), over
 * [#74](https://github.com/NobuData/ouroboros/issues/74)) — the dashboard's one control that
 * changes something, and therefore the one part of this page that can lie.
 *
 * The issue's criteria about it are two, and they pull in opposite directions: **an owner's
 * toggle persists, verified by the next poll returning the new state**, and **a failed
 * `PATCH` rolls the optimistic toggle back and surfaces an error**. Between them sits the
 * thing worth testing — the window in which this browser believes something the server has
 * not confirmed — so most of this suite is about what the switch does *before* and *after*
 * the answer rather than about the answer.
 *
 * What the action itself does is `pulse-actions.test.ts`; it is replaced here, because a
 * suite that drove the real one would be testing the API client through a button.
 */

/** What the write answers, per case. */
const setAutoMerge = vi.fn();

/** What tells the server's own render that the setting moved. */
const refresh = vi.fn();

vi.mock("@/app/dashboard/pulse-actions", () => ({
  setAutoMerge: (enabled: boolean) => setAutoMerge(enabled),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const { AutoMergeSwitch } = await import("@/app/dashboard/auto-merge-switch");
const { AUTO_MERGE_READ_ONLY } = await import("@/app/dashboard/view");

/** The switch, whatever it is drawn as. */
function control(): HTMLElement {
  return screen.getByRole("switch");
}

/**
 * A write this suite finishes itself, for the cases about the window before the answer.
 *
 * A never-settling promise would do the same job and cost the rest of the file: React
 * entangles async transitions, so one left in flight — even by an unmounted component —
 * holds up the transitions after it, and the cases that assert an optimistic position
 * *expiring* would then never see it expire. So every case that opens one closes it.
 *
 * @returns The promise to answer the write with, and the function that answers it.
 */
function deferredWrite(): {
  promise: Promise<{ ok: boolean; enabled?: boolean }>;
  answer: (result: { ok: boolean; enabled?: boolean }) => void;
} {
  let answer!: (result: { ok: boolean; enabled?: boolean }) => void;
  const promise = new Promise<{ ok: boolean; enabled?: boolean }>((resolve) => {
    answer = resolve;
  });

  return { promise, answer };
}

beforeEach(() => {
  setAutoMerge.mockReset().mockResolvedValue({ ok: true, enabled: true });
  refresh.mockReset();
});

describe("an administrator's press", () => {
  it("moves the switch before the server has answered", async () => {
    // The whole point of an optimistic control: the position changes on the press, not a
    // round trip later. The write is held open so the assertion is about that window.
    const write = deferredWrite();
    setAutoMerge.mockReturnValue(write.promise);
    render(<AutoMergeSwitch enabled={false} canAdminister />);

    fireEvent.click(control());

    expect(control()).toHaveAttribute("aria-checked", "true");

    write.answer({ ok: true, enabled: true });
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  });

  it("sends the position to move to, not a request to invert whatever is stored", async () => {
    // Two administrators pressing at once then agree on an outcome rather than racing to
    // swap the row twice.
    render(<AutoMergeSwitch enabled={true} canAdminister />);

    fireEvent.click(control());

    await waitFor(() => expect(setAutoMerge).toHaveBeenCalledExactlyOnceWith(false));
  });

  it("asks the server to re-render the page once the write has landed", async () => {
    // This is the acceptance criterion's *"verified by the next poll returning the new
    // state"*: until #87's polling hook exists, `router.refresh()` is the poll — the route's
    // Server Components re-run and every card is redrawn from a fresh aggregate.
    render(<AutoMergeSwitch enabled={false} canAdminister />);

    fireEvent.click(control());

    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  });

  it("holds the position the row came back with, not the one that was sent", async () => {
    // They differ exactly when somebody else moved the switch first, and the row is the
    // authority on that.
    setAutoMerge.mockResolvedValue({ ok: true, enabled: false });
    render(<AutoMergeSwitch enabled={false} canAdminister />);

    fireEvent.click(control());

    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(control()).toHaveAttribute("aria-checked", "false");
  });

  it("says nothing at all when the write landed", async () => {
    render(<AutoMergeSwitch enabled={false} canAdminister />);

    fireEvent.click(control());

    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("ignores a second press while the first is still in flight", async () => {
    // A queued second press would race the first one's refresh, and a switch that ends up
    // wherever the last response happened to leave it is worse than one that waits.
    const write = deferredWrite();
    setAutoMerge.mockReturnValue(write.promise);
    render(<AutoMergeSwitch enabled={false} canAdminister />);

    fireEvent.click(control());
    fireEvent.click(control());

    expect(setAutoMerge).toHaveBeenCalledOnce();
    expect(control()).toHaveAttribute("aria-checked", "true");

    write.answer({ ok: true, enabled: true });
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  });
});

describe("a write that did not land", () => {
  it("puts the switch back where the server still has it", async () => {
    setAutoMerge.mockResolvedValue({ ok: false, reason: "The service is not available." });
    render(<AutoMergeSwitch enabled={false} canAdminister />);

    fireEvent.click(control());

    await waitFor(() =>
      expect(control()).toHaveAttribute("aria-checked", "false"),
    );
  });

  it("surfaces the reason, assertively, and describes the switch with it", async () => {
    setAutoMerge.mockResolvedValue({ ok: false, reason: "The service is not available." });
    render(<AutoMergeSwitch enabled={false} canAdminister />);

    fireEvent.click(control());

    const alert = await screen.findByRole("alert");

    expect(alert).toHaveTextContent("The service is not available.");
    expect(control()).toHaveAccessibleDescription("The service is not available.");
  });

  it("does not ask the page to re-render, because nothing about it changed", async () => {
    setAutoMerge.mockResolvedValue({ ok: false, reason: "The service is not available." });
    render(<AutoMergeSwitch enabled={false} canAdminister />);

    fireEvent.click(control());

    await screen.findByRole("alert");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("clears the last failure when the next press is made", async () => {
    setAutoMerge.mockResolvedValueOnce({ ok: false, reason: "The service is not available." });
    render(<AutoMergeSwitch enabled={false} canAdminister />);

    fireEvent.click(control());
    await screen.findByRole("alert");

    fireEvent.click(control());

    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("the server's own answer, when it arrives", () => {
  it("retires the optimistic position rather than being merged with it", async () => {
    // The refresh brings a fresh aggregate, which arrives here as a changed prop. Whatever
    // this browser was holding is out of date by definition — including a position somebody
    // else's press put in the row.
    const { rerender } = render(<AutoMergeSwitch enabled={false} canAdminister />);

    fireEvent.click(control());
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());

    rerender(<AutoMergeSwitch enabled={false} canAdminister />);

    expect(control()).toHaveAttribute("aria-checked", "false");
  });

  it("draws a change nobody made in this browser", async () => {
    // A poll, or another administrator: the switch follows the read value with no press.
    const { rerender } = render(<AutoMergeSwitch enabled={false} canAdminister />);

    rerender(<AutoMergeSwitch enabled={true} canAdminister />);

    expect(control()).toHaveAttribute("aria-checked", "true");
    expect(setAutoMerge).not.toHaveBeenCalled();
  });
});

describe("a reader who may not change it", () => {
  it("still sees the switch, in the position the workspace is in", () => {
    // Hiding it would leave a card that looks like it has no setting (design system § 3.5).
    render(<AutoMergeSwitch enabled={true} canAdminister={false} />);

    expect(control()).toHaveAttribute("aria-checked", "true");
    expect(control()).toHaveAttribute("aria-disabled", "true");
  });

  it("is told why, in the tooltip and in the switch's description", () => {
    render(<AutoMergeSwitch enabled={false} canAdminister={false} />);

    expect(control()).toHaveAttribute("title", AUTO_MERGE_READ_ONLY);
    expect(control()).toHaveAccessibleDescription(AUTO_MERGE_READ_ONLY);
  });

  it("writes nothing when the control is pressed anyway", () => {
    // The press is inert in the browser. What stops a *forged* write is the service's role
    // gate, which is `pulse-actions.test.ts`'s subject and not this component's job.
    render(<AutoMergeSwitch enabled={false} canAdminister={false} />);

    fireEvent.click(control());

    expect(setAutoMerge).not.toHaveBeenCalled();
    expect(control()).toHaveAttribute("aria-checked", "false");
  });

  it("keeps the reason quiet rather than announcing it as an alert", () => {
    // It is a standing fact about the row, not the outcome of anything the reader did.
    render(<AutoMergeSwitch enabled={false} canAdminister={false} />);

    expect(screen.queryByRole("alert")).toBeNull();
  });
});
