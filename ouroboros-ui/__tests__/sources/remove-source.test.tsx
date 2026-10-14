import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RemovalOutcome } from "@/app/sources/actions";
import type { TicketSourceRemoval } from "@/app/api/sources";
import {
  REMOVE_BLOCKED,
  REMOVE_CANCEL,
  REMOVE_CONFIRM,
  REMOVE_DIALOG_TITLE,
  REMOVE_FAILED,
  REMOVE_INTRO,
  REMOVE_IRREVERSIBLE,
  REMOVE_KEPT,
  REMOVE_LABEL,
  REMOVE_READING,
  REMOVE_READ_ONLY,
  REMOVE_UNREAD,
  removalLines,
} from "@/app/sources/view";

import { SEEDED_GITHUB_ID, source } from "../helpers/sources";

const state = vi.hoisted(() => ({
  refresh: vi.fn(),
  read: vi.fn<(id: string) => Promise<RemovalOutcome>>(),
  remove: vi.fn<(id: string) => Promise<RemovalOutcome>>(),
  reconcile: vi.fn<() => Promise<void>>(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: state.refresh }) }));
vi.mock("@/app/sources/actions", () => ({
  readSourceRemoval: (id: string) => state.read(id),
  removeSource: (id: string) => state.remove(id),
}));

vi.mock("@/app/shell/stale-focus", () => ({ reconcileFocusRepo: () => state.reconcile() }));

const { RemoveSource } = await import("@/app/sources/remove-source");

/**
 * The **Remove** control and its confirmation: nothing is removed unseen, and a source the
 * service would refuse offers no control that removes.
 */

/** What the seeded GitHub source has mirrored. */
function removal(over: Partial<TicketSourceRemoval> = {}): TicketSourceRemoval {
  return {
    sourceId: SEEDED_GITHUB_ID,
    displayName: source().displayName,
    tickets: 77,
    pullRequests: 12,
    draftBatches: 1,
    analyzerDraftBatches: 0,
    removable: true,
    ...over,
  };
}

/** Press the row's control and wait for the dialog. */
async function opened(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole("button", { name: REMOVE_LABEL }));

  return screen.findByRole("dialog", { name: REMOVE_DIALOG_TITLE });
}

beforeEach(() => {
  state.refresh.mockReset();
  state.reconcile.mockReset().mockResolvedValue(undefined);
  state.read.mockReset().mockResolvedValue({ ok: true, removal: removal() });
  state.remove.mockReset().mockResolvedValue({ ok: true, removal: removal() });
});

describe("RemoveSource", () => {
  it("reads what would go before it offers to remove anything", async () => {
    let answer: (outcome: RemovalOutcome) => void = () => {};
    state.read.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    render(<RemoveSource mayAdminister source={source()} />);

    const dialog = await opened();

    expect(within(dialog).getByRole("status")).toHaveTextContent(REMOVE_READING);
    expect(within(dialog).queryByRole("button", { name: REMOVE_CONFIRM })).toBeNull();
    expect(state.read).toHaveBeenCalledExactlyOnceWith(SEEDED_GITHUB_ID);

    answer({ ok: true, removal: removal() });

    expect(await within(dialog).findByRole("button", { name: REMOVE_CONFIRM })).toBeInTheDocument();
  });

  it("names the source and lists what goes with it, what stays, and that it cannot be undone", async () => {
    render(<RemoveSource mayAdminister source={source()} />);

    const dialog = await opened();
    await within(dialog).findByText(REMOVE_INTRO);

    expect(within(dialog).getByRole("heading")).toHaveTextContent(
      `${REMOVE_DIALOG_TITLE} · ${source().displayName}`,
    );
    for (const line of removalLines(removal())) {
      expect(within(dialog).getByText(line)).toBeInTheDocument();
    }
    expect(within(dialog).getByText(REMOVE_KEPT)).toBeInTheDocument();
    expect(within(dialog).getByText(REMOVE_IRREVERSIBLE)).toBeInTheDocument();
    expect(state.remove).not.toHaveBeenCalled();
  });

  it("removes on a yes, closes, and has the page read again", async () => {
    render(<RemoveSource mayAdminister source={source()} />);

    const dialog = await opened();
    fireEvent.click(await within(dialog).findByRole("button", { name: REMOVE_CONFIRM }));

    await waitFor(() => expect(state.refresh).toHaveBeenCalledOnce());
    expect(state.remove).toHaveBeenCalledExactlyOnceWith(SEEDED_GITHUB_ID);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("clears a focus on the removed source's repositories before the page reads again", async () => {
    // The chip names its focus without reading anything, so a focused repository whose
    // source is gone would stay in the header until somebody opened the chip's menu.
    render(<RemoveSource mayAdminister source={source()} />);

    const dialog = await opened();
    fireEvent.click(await within(dialog).findByRole("button", { name: REMOVE_CONFIRM }));

    await waitFor(() => expect(state.refresh).toHaveBeenCalledOnce());
    expect(state.reconcile).toHaveBeenCalledOnce();
    expect(state.reconcile.mock.invocationCallOrder[0]).toBeLessThan(
      state.refresh.mock.invocationCallOrder[0],
    );
  });

  it("removes nothing on a no", async () => {
    render(<RemoveSource mayAdminister source={source()} />);

    const dialog = await opened();
    await within(dialog).findByRole("button", { name: REMOVE_CONFIRM });
    fireEvent.click(within(dialog).getByRole("button", { name: REMOVE_CANCEL }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(state.remove).not.toHaveBeenCalled();
    expect(state.refresh).not.toHaveBeenCalled();
  });

  it("says why a source the analyzer drafted into stays, and offers no control that removes", async () => {
    state.read.mockResolvedValue({
      ok: true,
      removal: removal({ analyzerDraftBatches: 1, removable: false }),
    });
    render(<RemoveSource mayAdminister source={source()} />);

    const dialog = await opened();

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(REMOVE_BLOCKED);
    expect(within(dialog).queryByRole("button", { name: REMOVE_CONFIRM })).toBeNull();
    expect(within(dialog).queryByText(REMOVE_IRREVERSIBLE)).toBeNull();
    expect(within(dialog).getByRole("button", { name: REMOVE_CANCEL })).toBeInTheDocument();
  });

  it("removes nothing it could not count", async () => {
    state.read.mockResolvedValue({ ok: false, reason: REMOVE_UNREAD });
    render(<RemoveSource mayAdminister source={source()} />);

    const dialog = await opened();

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(REMOVE_UNREAD);
    expect(within(dialog).queryByRole("button", { name: REMOVE_CONFIRM })).toBeNull();
  });

  it("stays open and says why when the removal was refused", async () => {
    state.remove.mockResolvedValue({ ok: false, reason: REMOVE_FAILED });
    render(<RemoveSource mayAdminister source={source()} />);

    const dialog = await opened();
    fireEvent.click(await within(dialog).findByRole("button", { name: REMOVE_CONFIRM }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(REMOVE_FAILED);
    expect(state.refresh).not.toHaveBeenCalled();
    expect(state.reconcile).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("button", { name: REMOVE_CONFIRM })).toBeInTheDocument();
  });

  it("reads the counts afresh each time it is opened", async () => {
    render(<RemoveSource mayAdminister source={source()} />);

    const first = await opened();
    fireEvent.click(await within(first).findByRole("button", { name: REMOVE_CANCEL }));
    await opened();

    expect(state.read).toHaveBeenCalledTimes(2);
  });

  it("is inert, with the reason, for a reader who may not remove", () => {
    render(<RemoveSource mayAdminister={false} source={source()} />);

    const control = screen.getByRole("button", { name: REMOVE_LABEL });

    expect(control).toHaveAccessibleDescription(REMOVE_READ_ONLY);
    fireEvent.click(control);
    expect(state.read).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("removalLines", () => {
  it("draws every count, a zero included", () => {
    expect(removalLines({ tickets: 0, pullRequests: 0, draftBatches: 0 })).toEqual([
      "0 tickets, estimates and dependencies included",
      "0 pull request records, gates, reviews and approvals included",
      "0 Planning draft batches targeting it",
    ]);
  });

  it("uses the singular for one", () => {
    expect(removalLines({ tickets: 1, pullRequests: 1, draftBatches: 1 })).toEqual([
      "1 ticket, estimates and dependencies included",
      "1 pull request record, gates, reviews and approvals included",
      "1 Planning draft batch targeting it",
    ]);
  });
});
