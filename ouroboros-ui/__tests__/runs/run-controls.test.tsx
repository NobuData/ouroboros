import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RunControl, RunControlList } from "@/app/api/runs";
import type { HeadControl, SubmitOutcome } from "@/app/runs/control-actions";
import {
  ABORT_CANCEL,
  ABORT_LABEL,
  ABORT_NEEDS_CONFIRMATION,
  CONTROLS_LABEL,
  NO_RESPONSE,
  PAUSE_LABEL,
  RESUME_LABEL,
  SENDING_REASON,
  TAKEOVER_LABEL,
  pendingReason,
} from "@/app/runs/controls";
import type { ControlsPollOptions } from "@/app/runs/controls-poll";
import {
  COPIED_COMMANDS,
  COPY_COMMANDS_LABEL,
  HANDOFF_CLOSE,
  HANDOFF_LIMITATION,
  HANDOFF_TITLE,
  NO_BRANCH_HANDOFF,
  TICKET_LINK,
  TRANSCRIPT_LINK,
} from "@/app/runs/handoff";
import { type ControlSender, RunControls } from "@/app/runs/run-controls";
import type { PollAnswer } from "@/app/poll";

import { SEEDED_RUN_ID, runControl } from "../helpers/runs";

/**
 * The head's three actions (#310), rendered against a stubbed queue: Pause moving through
 * `sending` → `sent` → `acknowledged` and becoming Resume; an expired control drawn as *no
 * response*; one control per double click; the typed-confirmation abort; and the R7 take-over.
 */

// The Server Action is the production sender; every case here passes its own.
vi.mock("@/app/runs/control-actions", () => ({ submitRunControl: vi.fn() }));

/** The seeded tracker link. */
const TRACKER = "https://github.com/acme/helios-firmware/issues/482";

/** The seeded branch. */
const BRANCH = "loop/482-canbus-flake";

/** What the queue holds. Reassigned by the cases as the executor "answers". */
let queue: RunControl[];

/** Every submission the component made. */
let sent: HeadControl[];

/** What the next submission answers, or a promise the case resolves itself. */
let reply: (control: HeadControl) => Promise<SubmitOutcome>;

/** The controls' poll, reading {@link queue} and asking again every two seconds. */
const POLL: ControlsPollOptions = {
  visible: () => true,
  read: () =>
    Promise.resolve<PollAnswer<RunControlList>>({
      state: "fresh",
      payload: { controls: queue },
      etag: null,
      pollAfterSeconds: 2,
    }),
};

/** The sender the component is given: records, then answers {@link reply}. */
const send: ControlSender = (_runId, control) => {
  sent.push(control);
  return reply(control);
};

/**
 * A reply that queues the control as `pending` — and puts it on the queue, as the service does.
 *
 * @param control What was submitted.
 * @returns The outcome.
 */
function queued(control: HeadControl): Promise<SubmitOutcome> {
  const row = runControl({ kind: control.kind, state: "pending" });
  queue = [row, ...queue];
  return Promise.resolve({ ok: true, control: row });
}

/**
 * Draw the controls.
 *
 * @param over What to change.
 * @returns The render result and the snapshot-refresh spy.
 */
function draw(over: { branch?: string | null; trackerUrl?: string | null } = {}) {
  const onRunChanged = vi.fn();
  const result = render(
    <RunControls
      branch={over.branch === undefined ? BRANCH : over.branch}
      loopSeq={1847}
      onRunChanged={onRunChanged}
      poll={POLL}
      runId={SEEDED_RUN_ID}
      send={send}
      trackerUrl={over.trackerUrl === undefined ? TRACKER : over.trackerUrl}
    />,
  );
  return { ...result, onRunChanged };
}

/** Let the poll's first answer, and anything already resolved, land. */
async function settle(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

/**
 * Let the poll ask again.
 *
 * @param seconds How far to move the clock.
 */
async function advance(seconds: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(seconds * 1000);
  });
}

/** The chips' live region. */
function chips(): HTMLElement {
  return document.querySelector(".run-controls__status") as HTMLElement;
}

/**
 * One of the three head buttons.
 *
 * @param name Its label.
 * @returns The button.
 */
function headButton(name: string | RegExp): HTMLElement {
  return within(screen.getByRole("group", { name: CONTROLS_LABEL })).getByRole("button", { name });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  queue = [];
  sent = [];
  reply = queued;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the action row", () => {
  it("draws the mockup's three actions in its order, Abort as the danger one", async () => {
    draw();
    await settle();

    const group = screen.getByRole("group", { name: CONTROLS_LABEL });
    const labels = within(group)
      .getAllByRole("button")
      .map((button) => button.textContent);
    expect(labels).toEqual([PAUSE_LABEL, TAKEOVER_LABEL, ABORT_LABEL]);
    expect(headButton(ABORT_LABEL)).toHaveClass("ou-btn--danger");
  });
});

describe("Pause loop", () => {
  it("moves sending → sent → acknowledged, and only then becomes Resume", async () => {
    let finish: () => void = () => {};
    reply = (control) =>
      new Promise((resolve) => {
        finish = () => void queued(control).then(resolve);
      });
    draw();
    await settle();

    fireEvent.click(headButton(PAUSE_LABEL));
    expect(chips()).toHaveTextContent("Pause · sending");
    expect(headButton(PAUSE_LABEL)).toHaveAttribute("aria-disabled", "true");
    expect(headButton(PAUSE_LABEL)).toHaveAttribute("title", SENDING_REASON);

    await act(async () => finish());
    await settle();
    expect(chips()).toHaveTextContent("Pause · sent");
    // Queued is not stopped: the button has not flipped, and it will not queue a second one.
    expect(headButton(PAUSE_LABEL)).toHaveAttribute("title", pendingReason("pause"));

    queue = [{ ...queue[0]!, state: "delivered" }];
    await advance(2);
    expect(chips()).toHaveTextContent("Pause · received");

    queue = [{ ...queue[0]!, state: "acked", detail: "paused at a safe boundary" }];
    await advance(2);
    expect(chips()).toHaveTextContent("Pause · acknowledged");
    expect(within(chips()).getByTitle("paused at a safe boundary")).toBeInTheDocument();
    expect(headButton(RESUME_LABEL)).not.toHaveAttribute("aria-disabled");
    expect(sent).toEqual([{ kind: "pause", idempotencyKey: expect.any(String) }]);
  });

  it("sends a resume from a paused loop", async () => {
    queue = [runControl({ kind: "pause", state: "acked" })];
    draw();
    await settle();

    fireEvent.click(headButton(RESUME_LABEL));
    await settle();

    expect(sent.map((control) => control.kind)).toEqual(["resume"]);
    expect(chips()).toHaveTextContent("Resume · sent");
  });

  it("renders an expired control as no response — never as a success", async () => {
    queue = [runControl({ kind: "pause", state: "expired" })];
    draw();
    await settle();

    expect(chips()).toHaveTextContent(`Pause · ${NO_RESPONSE}`);
    expect(chips()).toHaveTextContent("no response — run may be between stages");
    expect(chips()).not.toHaveTextContent("acknowledged");
    expect(chips().querySelector(".ou-chip--warn")).not.toBeNull();
    // The loop never paused, so the button still offers to — and may be pressed again.
    expect(headButton(PAUSE_LABEL)).not.toHaveAttribute("aria-disabled");
  });

  it("produces one control for a double click", async () => {
    draw();
    await settle();

    const button = headButton(PAUSE_LABEL);
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.doubleClick(button);
    await settle();

    expect(sent).toHaveLength(1);
  });

  it("does not queue a second pause while one is on its way from elsewhere", async () => {
    queue = [runControl({ kind: "pause", state: "delivered" })];
    draw();
    await settle();

    fireEvent.click(headButton(PAUSE_LABEL));
    await settle();

    expect(sent).toEqual([]);
    expect(headButton(PAUSE_LABEL)).toHaveAttribute("title", pendingReason("pause"));
  });

  it("says why when the service refused, and queued nothing", async () => {
    reply = () =>
      Promise.resolve({ ok: false, status: 403, code: "forbidden", reason: "Only an owner or admin may do that." });
    draw();
    await settle();

    fireEvent.click(headButton(PAUSE_LABEL));
    await settle();

    expect(chips()).toHaveTextContent("Only an owner or admin may do that.");
    expect(headButton(PAUSE_LABEL)).not.toHaveAttribute("aria-disabled");
  });
});

describe("Abort run", () => {
  /** Open the dialog, and return it. */
  async function openAbort(): Promise<HTMLElement> {
    // A real press focuses the button first; jsdom's click does not.
    headButton(ABORT_LABEL).focus();
    fireEvent.click(headButton(ABORT_LABEL));
    await settle();
    return screen.getByRole("alertdialog");
  }

  /** The dialog's field. */
  function field(): HTMLInputElement {
    return screen.getByLabelText("Type 1847 to confirm") as HTMLInputElement;
  }

  /** The dialog's danger button. */
  function confirm(): HTMLElement {
    return screen.getByRole("button", { name: "Abort Loop #1847" });
  }

  it("is an alert dialog named for the loop, described by its consequences, focused in the field", async () => {
    draw();
    await settle();

    const dialog = await openAbort();

    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName("Abort Loop #1847?");
    expect(dialog).toHaveAccessibleDescription(/marked canceled/);
    expect(dialog).toHaveAccessibleDescription(/loop\/482-canbus-flake is preserved/);
    expect(dialog).toHaveAccessibleDescription(/cannot be undone/);
    expect(document.activeElement).toBe(field());
  });

  it("cannot be triggered without the correct loop number", async () => {
    draw();
    await settle();
    await openAbort();

    expect(confirm()).toHaveAttribute("aria-disabled", "true");
    expect(confirm()).toHaveAttribute("title", ABORT_NEEDS_CONFIRMATION);

    fireEvent.change(field(), { target: { value: "184" } });
    fireEvent.click(confirm());
    fireEvent.submit(field().form!);
    await settle();
    expect(sent).toEqual([]);

    fireEvent.change(field(), { target: { value: "1847" } });
    expect(confirm()).not.toHaveAttribute("aria-disabled");
  });

  it("sends the typed number, closes, and shows the abort's delivery", async () => {
    draw();
    await settle();
    await openAbort();

    fireEvent.change(field(), { target: { value: "#1847" } });
    fireEvent.click(confirm());
    await settle();

    expect(sent).toEqual([{ kind: "abort", confirmation: "#1847", idempotencyKey: expect.any(String) }]);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(chips()).toHaveTextContent("Abort · sent");
    expect(headButton(ABORT_LABEL)).toHaveAttribute("title", pendingReason("abort"));
  });

  it("draws the server's refusal of a forged confirmation and stays open", async () => {
    reply = () =>
      Promise.resolve({
        ok: false,
        status: 422,
        code: "abort_confirmation_invalid",
        reason: "Type the loop number to confirm the abort.",
      });
    draw();
    await settle();
    await openAbort();

    fireEvent.change(field(), { target: { value: "1847" } });
    fireEvent.submit(field().form!);
    await settle();

    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Type the loop number to confirm the abort.");
  });

  it("closes on Escape and on Keep running, forgetting what was typed", async () => {
    draw();
    await settle();

    await openAbort();
    fireEvent.change(field(), { target: { value: "1847" } });
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(document.activeElement).toBe(headButton(ABORT_LABEL));

    await openAbort();
    expect(field().value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: ABORT_CANCEL }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(sent).toEqual([]);
  });

  it("traps Tab inside the dialog", async () => {
    draw();
    await settle();
    const dialog = await openAbort();

    const cancel = screen.getByRole("button", { name: ABORT_CANCEL });
    cancel.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(field());

    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(cancel);
  });

  it("asks the page for a fresh snapshot once the abort is acknowledged", async () => {
    const { onRunChanged } = draw();
    await settle();
    expect(onRunChanged).not.toHaveBeenCalled();

    queue = [runControl({ kind: "abort", state: "acked" })];
    await advance(15);

    expect(onRunChanged).toHaveBeenCalled();
  });
});

describe("Take over in IDE", () => {
  it("pauses the loop, then hands over the branch, the commands and the links", async () => {
    draw();
    await settle();

    fireEvent.click(headButton(TAKEOVER_LABEL));
    await settle();

    expect(sent.map((control) => control.kind)).toEqual(["pause"]);

    const dialog = screen.getByRole("dialog", { name: HANDOFF_TITLE });
    expect(within(dialog).getByText("Pause · sent")).toBeInTheDocument();
    expect(dialog.querySelector(".run-handoff__commands")).toHaveTextContent(
      `git fetch origin ${BRANCH} git switch ${BRANCH}`,
    );
    expect(within(dialog).getByRole("link", { name: TICKET_LINK })).toHaveAttribute("href", TRACKER);
    expect(within(dialog).getByRole("link", { name: TRANSCRIPT_LINK })).toHaveAttribute(
      "href",
      `/api/runs/${SEEDED_RUN_ID}/transcript.jsonl`,
    );
    expect(within(dialog).getByRole("note")).toHaveTextContent(HANDOFF_LIMITATION);

    queue = [{ ...queue[0]!, state: "acked" }];
    await advance(2);
    expect(within(dialog).getByText("Pause · acknowledged")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: HANDOFF_CLOSE }));
    expect(screen.queryByRole("dialog")).toBeNull();
    // The loop stays paused: Resume is how it comes back.
    expect(headButton(RESUME_LABEL)).toBeInTheDocument();
  });

  it("copies the commands exactly as shown", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    vi.stubGlobal("ClipboardItem", undefined);
    draw();
    await settle();

    fireEvent.click(headButton(TAKEOVER_LABEL));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: COPY_COMMANDS_LABEL }));
    await settle();

    expect(writeText).toHaveBeenCalledExactlyOnceWith(`git fetch origin ${BRANCH}\ngit switch ${BRANCH}`);
    expect(screen.getByRole("dialog")).toHaveTextContent(COPIED_COMMANDS);
  });

  it("does not pause a loop that is already paused", async () => {
    queue = [runControl({ kind: "pause", state: "acked" })];
    draw();
    await settle();

    fireEvent.click(headButton(TAKEOVER_LABEL));
    await settle();

    expect(sent).toEqual([]);
    expect(screen.getByRole("dialog")).toHaveTextContent("Pause · acknowledged");
  });

  it("says so when there is no branch yet, and draws no ticket link it cannot build", async () => {
    draw({ branch: null, trackerUrl: null });
    await settle();

    fireEvent.click(headButton(TAKEOVER_LABEL));
    await settle();

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(NO_BRANCH_HANDOFF);
    expect(dialog.querySelector(".run-handoff__commands")).toBeNull();
    expect(within(dialog).queryByRole("link", { name: TICKET_LINK })).toBeNull();
    expect(within(dialog).getByRole("link", { name: TRANSCRIPT_LINK })).toBeInTheDocument();
  });

  it("reports a pause that could not be sent inside the dialog", async () => {
    reply = () => Promise.resolve({ ok: false, status: 502, code: "control_unreachable", reason: "Nothing was queued." });
    draw();
    await settle();

    fireEvent.click(headButton(TAKEOVER_LABEL));
    await settle();

    expect(screen.getByRole("dialog")).toHaveTextContent("Nothing was queued.");
  });
});
