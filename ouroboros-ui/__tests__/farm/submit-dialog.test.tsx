import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BuildJobSubmission, FarmPage } from "@/app/api/farm";
import type { FarmPollOptions } from "@/app/farm/farm-poll";
import { FarmScreen } from "@/app/farm/farm-screen";
import { LIVE_CARD_TITLE_ID } from "@/app/farm/live";
import { POOLS_TITLE } from "@/app/farm/pools";
import { RUNNERS_TITLE } from "@/app/farm/runners";
import {
  ARGV_PREVIEW,
  CANCEL,
  COMMIT_INVALID,
  DISMISS_TOAST,
  FIELDS_REFUSED,
  GO_TO_LIVE_LOG,
  REF_INVALID,
  REPOSITORY_INVALID,
  REPOSITORY_NOT_MIRRORED,
  SUBMIT,
  SUBMITTING,
  SUBMIT_BUILD,
  SUBMIT_FIELDS,
  SUBMIT_NO_POOLS,
  SUBMIT_POOL_DISABLED,
  SUBMIT_UNREAD,
  type SubmitOutcome,
  USES_POOL_DEFAULT,
  queuedToast,
  submitToPoolLabel,
} from "@/app/farm/submit";
import type { PollAnswer } from "@/app/poll";

import {
  ADMIN_READER,
  MEMBER_READER,
  failedFarmReadings,
  farmReadings,
  seededFarm,
} from "../helpers/farm";
import { settle } from "../helpers/settle";

const actions = vi.hoisted(() => ({
  submitBuild: vi.fn<(submission: BuildJobSubmission) => Promise<SubmitOutcome>>(),
}));

vi.mock("@/app/farm/submit-actions", () => ({
  submitBuild: (submission: BuildJobSubmission) => actions.submitBuild(submission),
}));

// The other cards share the screen; this suite presses none of their actions.
vi.mock("@/app/farm/enroll-actions", () => ({
  mintEnrollCommand: vi.fn(),
  readEnrollmentTokens: vi.fn(),
  revokeEnrollmentToken: vi.fn(),
}));

vi.mock("@/app/farm/pool-actions", () => ({
  createPool: vi.fn(),
  deletePool: vi.fn(),
  updatePool: vi.fn(),
}));

vi.mock("@/app/farm/lifecycle-actions", () => ({
  drainRunner: vi.fn(),
  undrainRunner: vi.fn(),
  removeRunner: vi.fn(),
}));

/**
 * The submit-build flow on the farm screen (#260): its two doors, the pool's default command
 * prefilled, the command drawn as the words it will be sent as, what is refused before and after
 * a round trip, the toast that leads to the live log card, and the `q:N` that is seen to move on
 * the rows the build lands on.
 */

/** `pool-a`'s default command, as the service stores it. */
const POOL_A_DEFAULT = "west build -b helios_mainboard app";

/** A full 40-character commit. */
const COMMIT = "9e7bd4034c1f1b2a6d8e0f5c7a9b3d1e2f4a6c80";

/** The build a successful submission answers. */
const QUEUED = { id: "5eed0028-0000-4000-8000-000000000483", number: 483, pool: "pool-a" };

/** What the poll answers. Reassigned by the cases that care. */
let answer: PollAnswer<FarmPage>;

/** How many times the page has been asked for — a submission asks once more. */
let reads: number;

/** A poll that answers {@link answer} and counts the asking. */
const LIVE: FarmPollOptions = {
  read: () => {
    reads += 1;

    return Promise.resolve(answer);
  },
  visible: () => true,
};

/**
 * What the poll answers with a page.
 *
 * @param page The page.
 * @returns The answer.
 */
function fresh(page: FarmPage): PollAnswer<FarmPage> {
  return { state: "fresh", payload: page, etag: null, pollAfterSeconds: 10 };
}

/**
 * Draw the screen.
 *
 * @param reader Who is reading. Defaults to an administrator.
 * @param page The page the first paint read.
 * @returns The render result.
 */
function draw(reader = ADMIN_READER, page: FarmPage = seededFarm()) {
  answer = fresh(page);

  return render(<FarmScreen poll={LIVE} reader={reader} readings={farmReadings(page)} />);
}

/** The head's door. */
function headDoor(): HTMLElement {
  return screen.getByRole("button", { name: SUBMIT_BUILD });
}

/**
 * A pool row's door.
 *
 * @param pool The pool's name.
 * @returns The control.
 */
function poolDoor(pool: string): HTMLElement {
  return within(screen.getByRole("region", { name: POOLS_TITLE })).getByRole("button", {
    name: submitToPoolLabel(pool),
  });
}

/** The open dialog. */
function dialog(): HTMLElement {
  return screen.getByRole("dialog", { name: SUBMIT_BUILD });
}

/**
 * One of the dialog's fields.
 *
 * @param field Which.
 * @returns Its control.
 */
function field(field: keyof typeof SUBMIT_FIELDS): HTMLInputElement {
  return within(dialog()).getByLabelText(SUBMIT_FIELDS[field].label) as HTMLInputElement;
}

/**
 * Type into a field.
 *
 * @param name Which field.
 * @param value What to type.
 */
function type(name: keyof typeof SUBMIT_FIELDS, value: string): void {
  fireEvent.change(field(name), { target: { value } });
}

/** Fill in the three fields that have no default. */
function fillIn(): void {
  type("repository", "acme-robotics/helios-firmware");
  type("ref", "refs/heads/main");
  type("commit", COMMIT);
}

/** Press the dialog's submit and let the write settle. */
async function submit(): Promise<void> {
  await act(async () => {
    fireEvent.click(within(dialog()).getByRole("button", { name: SUBMIT }));
    await Promise.resolve();
  });
  await settle();
}

/**
 * The seeded farm with some runners' queue depths replaced.
 *
 * @param depths Depth by runner name.
 * @returns The page.
 */
function withDepths(depths: Readonly<Record<string, number>>): FarmPage {
  const page = seededFarm();

  return {
    ...page,
    runners: page.runners.map((runner) =>
      runner.name in depths ? { ...runner, queueDepth: depths[runner.name] } : runner,
    ),
  };
}

beforeEach(() => {
  reads = 0;
  actions.submitBuild.mockReset();
  actions.submitBuild.mockResolvedValue({ ok: true, job: QUEUED });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the two doors", () => {
  it("opens from the head on the first enabled pool, with its default command prefilled", () => {
    draw();
    fireEvent.click(headDoor());

    expect(field("pool")).toHaveValue("pool-a");
    expect(field("command")).toHaveValue(POOL_A_DEFAULT);
  });

  it("opens from a pool's row on that pool", () => {
    draw();
    fireEvent.click(poolDoor("pool-b"));

    expect(field("pool")).toHaveValue("pool-b");
    // pool-b runs two kinds of job and has no default, so there is nothing to prefill.
    expect(field("command")).toHaveValue("");
  });

  it("starts each opening fresh, so an abandoned draft does not come back under another pool", () => {
    draw();

    fireEvent.click(poolDoor("pool-a"));
    type("repository", "acme-robotics/abandoned");
    fireEvent.click(within(dialog()).getByRole("button", { name: CANCEL }));

    fireEvent.click(poolDoor("pool-b"));

    expect(field("repository")).toHaveValue("");
    expect(field("pool")).toHaveValue("pool-b");
  });

  it("hands focus back to the door it was opened from", () => {
    draw();
    const door = poolDoor("pool-a");
    door.focus();
    fireEvent.click(door);

    fireEvent.click(within(dialog()).getByRole("button", { name: CANCEL }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(door).toHaveFocus();
  });

  it("is inert on a pool that is switched off, and says why", () => {
    const page = seededFarm();
    draw(ADMIN_READER, {
      ...page,
      pools: page.pools.map((pool) => (pool.name === "pool-b" ? { ...pool, enabled: false } : pool)),
    });

    expect(poolDoor("pool-b")).toHaveAttribute("aria-disabled", "true");
    expect(poolDoor("pool-b")).toHaveAttribute("title", SUBMIT_POOL_DISABLED);
    expect(poolDoor("pool-a")).not.toHaveAttribute("aria-disabled");
  });

  it("is inert in the head when there is no pool to submit to, and says which kind of none", () => {
    draw(ADMIN_READER, { ...seededFarm(), pools: [] });
    expect(headDoor()).toHaveAttribute("title", SUBMIT_NO_POOLS);
  });

  it("is inert in the head when the farm could not be read", () => {
    render(
      <FarmScreen
        poll={{ read: () => new Promise(() => {}), visible: () => true }}
        reader={ADMIN_READER}
        readings={failedFarmReadings()}
      />,
    );

    expect(headDoor()).toHaveAttribute("title", SUBMIT_UNREAD);
  });
});

describe("a member session", () => {
  it("sees no way to submit a build — neither door is drawn", () => {
    draw(MEMBER_READER);

    // Absent rather than disabled: the issue asks that a member see no action affordances.
    expect(screen.queryByRole("button", { name: SUBMIT_BUILD })).toBeNull();
    expect(screen.queryByRole("button", { name: submitToPoolLabel("pool-a") })).toBeNull();
    expect(screen.queryByRole("button", { name: submitToPoolLabel("pool-b") })).toBeNull();
  });
});

describe("the pool and its command", () => {
  it("swaps in the new pool's default while the command is still the old pool's", () => {
    draw();
    fireEvent.click(poolDoor("pool-b"));

    fireEvent.change(field("pool"), { target: { value: "pool-a" } });

    expect(field("command")).toHaveValue(POOL_A_DEFAULT);
  });

  it("never overwrites a command the reader typed", () => {
    draw();
    fireEvent.click(poolDoor("pool-a"));
    type("command", "make hil-sweep");

    fireEvent.change(field("pool"), { target: { value: "pool-b" } });

    expect(field("command")).toHaveValue("make hil-sweep");
  });

  it("offers a disabled pool as unselectable, and says it is disabled", () => {
    const page = seededFarm();
    draw(ADMIN_READER, {
      ...page,
      pools: page.pools.map((pool) => (pool.name === "pool-b" ? { ...pool, enabled: false } : pool)),
    });
    fireEvent.click(headDoor());

    const option = within(field("pool")).getByRole("option", { name: "pool-b — disabled" });

    expect(option).toBeDisabled();
  });
});

describe("the command, as the words it will be sent as", () => {
  it("draws each word of the prefilled default as its own chip", () => {
    draw();
    fireEvent.click(poolDoor("pool-a"));

    const preview = within(dialog()).getByText(ARGV_PREVIEW).parentElement as HTMLElement;

    expect([...preview.querySelectorAll("code")].map((word) => word.textContent)).toEqual([
      "west",
      "build",
      "-b",
      "helios_mainboard",
      "app",
    ]);
  });

  it("shows a quoted word as one word, which is the whole point of showing it", () => {
    draw();
    fireEvent.click(poolDoor("pool-a"));
    type("command", "sh -c 'make all'");

    const preview = within(dialog()).getByText(ARGV_PREVIEW).parentElement as HTMLElement;

    expect([...preview.querySelectorAll("code")].map((word) => word.textContent)).toEqual([
      "sh",
      "-c",
      "make all",
    ]);
  });

  it("says why a command cannot be read, under the field, as it is typed", () => {
    draw();
    fireEvent.click(poolDoor("pool-a"));
    type("command", 'sh -c "make all"');

    expect(field("command")).toHaveAccessibleDescription(/means something to a shell/u);
    expect(field("command")).toHaveAttribute("aria-invalid", "true");
    expect(within(dialog()).queryByText(ARGV_PREVIEW)).toBeNull();
  });

  it("says the pool's default runs when the field is cleared", () => {
    draw();
    fireEvent.click(poolDoor("pool-a"));
    type("command", "");

    expect(within(dialog()).getByText(USES_POOL_DEFAULT)).toBeInTheDocument();
  });
});

describe("submitting", () => {
  it("refuses an empty form under each field, without a round trip", async () => {
    draw();
    fireEvent.click(poolDoor("pool-a"));
    await submit();

    expect(field("repository")).toHaveAccessibleDescription(new RegExp(REPOSITORY_INVALID, "u"));
    expect(field("ref")).toHaveAccessibleDescription(new RegExp(REF_INVALID, "u"));
    expect(field("commit")).toHaveAccessibleDescription(new RegExp(COMMIT_INVALID, "u"));
    expect(actions.submitBuild).not.toHaveBeenCalled();
    expect(dialog()).toBeInTheDocument();
  });

  it("clears a field's complaint as soon as the field is edited", async () => {
    draw();
    fireEvent.click(poolDoor("pool-a"));
    await submit();

    type("commit", COMMIT);

    expect(field("commit")).not.toHaveAttribute("aria-invalid");
    expect(field("ref")).toHaveAttribute("aria-invalid", "true");
  });

  it("sends the prefilled default as no command at all, so the service's fallback applies", async () => {
    draw();
    fireEvent.click(poolDoor("pool-a"));
    fillIn();
    await submit();

    expect(actions.submitBuild).toHaveBeenCalledExactlyOnceWith({
      pool: "pool-a",
      repository: "acme-robotics/helios-firmware",
      ref: "refs/heads/main",
      commit: COMMIT,
    });
  });

  it("sends a typed command as argv", async () => {
    draw();
    fireEvent.click(poolDoor("pool-b"));
    fillIn();
    type("command", "sh -c 'make hil-sweep'");
    await submit();

    expect(actions.submitBuild).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ pool: "pool-b", command: ["sh", "-c", "make hil-sweep"] }),
    );
  });

  it("puts the service's refusal under the field it is about, and keeps the draft", async () => {
    actions.submitBuild.mockResolvedValue({
      ok: false,
      reason: FIELDS_REFUSED,
      fields: { repository: REPOSITORY_NOT_MIRRORED },
    });
    draw();
    fireEvent.click(poolDoor("pool-a"));
    fillIn();
    await submit();

    // Two alerts: the sentence under the form, and the one under the field it points at.
    expect(within(dialog()).getByText(FIELDS_REFUSED)).toHaveAttribute("role", "alert");
    expect(field("repository")).toHaveAccessibleDescription(new RegExp(REPOSITORY_NOT_MIRRORED, "u"));
    expect(field("repository")).toHaveValue("acme-robotics/helios-firmware");
    expect(screen.queryByText(queuedToast(QUEUED))).toBeNull();
  });

  it("makes one submission for two presses, and says it is submitting", async () => {
    let finish: (outcome: SubmitOutcome) => void = () => {};
    actions.submitBuild.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    draw();
    fireEvent.click(poolDoor("pool-a"));
    fillIn();

    const button = within(dialog()).getByRole("button", { name: SUBMIT });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(actions.submitBuild).toHaveBeenCalledTimes(1);
    expect(within(dialog()).getByRole("button", { name: SUBMITTING })).toHaveAttribute(
      "aria-busy",
      "true",
    );

    // Resolved, so the pending write does not outlive the case.
    await act(async () => {
      finish({ ok: true, job: QUEUED });
      await Promise.resolve();
    });
    await settle();
  });
});

describe("the toast", () => {
  /** Submit a valid build to pool-a. */
  async function submitted(): Promise<void> {
    fireEvent.click(poolDoor("pool-a"));
    fillIn();
    await submit();
  }

  it("has its seat mounted before it has anything to say", () => {
    draw();

    // A live region announces what is added to it, so it must exist first.
    const seat = document.querySelector(".farm-submit-toast__seat");

    expect(seat).toHaveAttribute("role", "status");
    expect(seat).toBeEmptyDOMElement();
  });

  it("closes the dialog, says the build is queued, and asks for a fresh page", async () => {
    draw();
    await settle();
    const before = reads;

    await submitted();

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText(queuedToast(QUEUED))).toBeInTheDocument();
    expect(reads).toBeGreaterThan(before);
  });

  it("LINKS TO THE LIVE LOG CARD: its action moves focus to the card's heading", async () => {
    draw();
    await submitted();

    fireEvent.click(screen.getByRole("button", { name: GO_TO_LIVE_LOG }));

    const heading = document.getElementById(LIVE_CARD_TITLE_ID);

    expect(heading).toHaveFocus();
    // A programmatic target, not a new tab stop.
    expect(heading).toHaveAttribute("tabindex", "-1");
  });

  it("stays until it is dismissed — never on a timer", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      draw();
      await submitted();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(120_000);
      });
      expect(screen.getByText(queuedToast(QUEUED))).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: DISMISS_TOAST }));
      expect(screen.queryByText(queuedToast(QUEUED))).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("navigates nowhere: the way to the live card is focus, not a link", async () => {
    const { container } = draw();
    await submitted();

    expect(container.querySelector("a")).toBeNull();
  });
});

describe("the queue depth that a submission moves", () => {
  /**
   * A runner's queue chip.
   *
   * @param name The runner's name.
   * @returns The chip.
   */
  function chip(name: string): HTMLElement {
    const row = within(screen.getByRole("region", { name: RUNNERS_TITLE }))
      .getAllByRole("row")
      .find((candidate) => within(candidate).queryByText(name) !== null) as HTMLElement;

    return row.querySelector(".queue-move") as HTMLElement;
  }

  it("UPDATES THE AFFECTED ROW VISIBLY, and says the move out loud", async () => {
    draw();
    await settle();
    expect(chip("forge-02")).toHaveTextContent("q:0");
    expect(chip("forge-02")).not.toHaveAttribute("data-moved");

    // The page a submission asks for: the build was accepted by forge-02 and waits behind it.
    answer = fresh(withDepths({ "forge-02": 1 }));
    fireEvent.click(poolDoor("pool-a"));
    fillIn();
    await submit();

    await waitFor(() => expect(chip("forge-02")).toHaveTextContent("q:1"));
    expect(chip("forge-02")).toHaveAttribute("data-moved");
    // Only the row it landed on.
    expect(chip("forge-01")).not.toHaveAttribute("data-moved");
    expect(
      within(screen.getByRole("region", { name: RUNNERS_TITLE })).getAllByRole("status")[2],
    ).toHaveTextContent("forge-02 queue q:0 → q:1");
  });

  it("marks nothing on arrival — a first paint is not a change", async () => {
    draw();
    await settle();

    expect(document.querySelectorAll(".queue-move[data-moved]")).toHaveLength(0);
  });
});
