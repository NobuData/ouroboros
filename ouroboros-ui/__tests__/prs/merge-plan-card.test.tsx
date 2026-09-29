import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PrMergePlan, PullRequestPage } from "@/app/api/pull-requests";
import { workflowPath } from "@/app/paths";
import type { PollAnswer } from "@/app/poll";
import {
  DISCARD_MESSAGE,
  MESSAGE_BLANK,
  MESSAGE_LABEL,
  MESSAGE_MOVED,
  MESSAGE_PREVIEW_LABEL,
  SAVE_FIRST,
  SAVE_MESSAGE,
} from "@/app/prs/merge-message";
import {
  ARM_CANCEL,
  ARM_CONFIRM,
  DISARMED,
  DISARM_LABEL,
  EDIT_POLICY_LINK,
  EPIC_LABEL,
  IRREVERSIBLE,
  MAY_HAVE_LANDED,
  MERGE_CONFIRM,
  MERGE_PLAN_ID,
  MERGE_PLAN_TITLE,
  PLAN_SAVED,
  PLAN_SENDING,
  TERMS_MOVED,
} from "@/app/prs/merge-plan";
import { IDENTITY_LINE } from "@/app/prs/merge-receipt";
import { MERGE_NOW_TERMS, RECHECK_TERMS } from "@/app/prs/merge-terms";
import {
  ACTION_UNREACHABLE,
  ACTION_UNREACHABLE_CODE,
  type MergeOutcome,
  type MergeRefusal,
  type PlanEdit,
  type PlanOutcome,
} from "@/app/prs/outcomes";
import type { PrPollOptions } from "@/app/prs/poll";
import { type PlanSenders, PrScreen } from "@/app/prs/pr-screen";
import { STRIP_TITLE } from "@/app/prs/strip";
import { THREAD_TITLE } from "@/app/prs/thread";
import { ACTIONS_LABEL, MERGE_LABEL, MERGE_NOW_LABEL } from "@/app/prs/view";
import { DASHBOARD_ORIGIN } from "@/app/runs/origin";

import {
  BLE_EPIC,
  KEN,
  OTA_EPIC,
  PR_514_ID,
  REV_2_ID,
  SEEDED_MESSAGE,
  armedPlan,
  blockedPage,
  mergeOutcome,
  mergePlan,
  mergedPlan,
  prPage,
  readyPage,
  revision,
} from "../helpers/pull-requests";

/**
 * The Merge plan card (#369), rendered through the screen: plan edits round-trip, the `Closes`
 * warning, the confirmation that names the gate and states the re-check, arm → the last gate
 * flips → merged with its receipt, the disarm reason, the identity footer that never claims a
 * bot, the direct merge only when every gate is green, and arm and disarm gated by role.
 */

// The Server Actions are never reached here: every case passes its own senders.
vi.mock("@/app/prs/head-actions", () => ({
  decideApproval: vi.fn(),
  requestHumanReview: vi.fn(),
  returnToLoop: vi.fn(),
}));
vi.mock("@/app/prs/criteria-actions", () => ({
  addClaim: vi.fn(),
  attachEvidence: vi.fn(),
  importFromPlan: vi.fn(),
  readEvidenceOptions: vi.fn(),
  verifyClaim: vi.fn(),
  waiveClaim: vi.fn(),
}));
vi.mock("@/app/prs/thread-actions", () => ({
  resolveEntry: vi.fn(),
}));
vi.mock("@/app/prs/merge-actions", () => ({
  armPlan: vi.fn(),
  disarmPlan: vi.fn(),
  editPlan: vi.fn(),
  mergeNow: vi.fn(),
}));

/** A poll that never answers — the page shows the server's first read. */
const QUIET: PrPollOptions = { read: () => new Promise(() => {}), visible: () => true };

const EPICS = [OTA_EPIC, BLE_EPIC];

/**
 * Senders that answer what the service would: the plan with the edit applied, armed, or merged.
 *
 * @param plan The plan before any press.
 * @returns The senders, each a spy.
 */
function senders(plan: PrMergePlan = mergePlan()) {
  let stored = plan;

  return {
    edit: vi.fn<PlanSenders["edit"]>().mockImplementation((_prId, edit: PlanEdit) => {
      stored = {
        ...stored,
        ...edit,
        // The service's rule: clearing the epic switches back-annotate off.
        ...(edit.epicId === null ? { backAnnotateEpic: false } : {}),
        updatedAt: "2026-09-27T14:50:00.000Z",
      };

      return Promise.resolve({ ok: true, answer: stored });
    }),
    arm: vi.fn<PlanSenders["arm"]>().mockImplementation((_prId, revisionId) => {
      stored = armedPlan({ ...stored, armed: true, armedAgainstRevisionId: revisionId });

      return Promise.resolve({ ok: true, answer: stored });
    }),
    disarm: vi.fn<PlanSenders["disarm"]>().mockImplementation(() => {
      stored = mergePlan({ ...stored, armed: false, armedBy: null, armedByPerson: null });

      return Promise.resolve({ ok: true, answer: stored });
    }),
    merge: vi
      .fn<PlanSenders["merge"]>()
      .mockResolvedValue({ ok: true, answer: mergeOutcome() }),
  };
}

/**
 * Draw the screen, as an owner unless told otherwise.
 *
 * @param initial The page.
 * @param options The reader's roles, the roadmap, the senders and the poll.
 * @returns The Testing Library render result.
 */
function draw(
  initial: PullRequestPage = prPage(),
  options: {
    mayArm?: boolean;
    mayContribute?: boolean;
    epics?: typeof EPICS | null;
    planSenders?: PlanSenders;
    poll?: PrPollOptions;
    now?: () => number;
  } = {},
) {
  return render(
    <PrScreen
      epics={options.epics === undefined ? EPICS : options.epics}
      initial={initial}
      initialError={null}
      mayArm={options.mayArm ?? true}
      mayContribute={options.mayContribute ?? true}
      now={options.now ?? (() => 1_000)}
      origin={DASHBOARD_ORIGIN}
      planSenders={options.planSenders ?? senders()}
      poll={options.poll ?? QUIET}
      prId={PR_514_ID}
    />,
  );
}

/** The card. */
function card(): HTMLElement {
  return screen.getByRole("region", { name: MERGE_PLAN_TITLE });
}

/** The message field. */
function message(): HTMLTextAreaElement {
  return within(card()).getByRole("textbox", { name: MESSAGE_LABEL });
}

/**
 * A switch, by the text of its row.
 *
 * @param text The row's text.
 * @returns The switch.
 */
function toggle(text: string): HTMLElement {
  const row = within(card())
    .getByText(text, { selector: ".prv-merge__key" })
    .closest(".prv-merge__row") as HTMLElement;

  return within(row).getByRole("switch");
}

/** The epic picker. */
function picker(): HTMLSelectElement {
  return within(card()).getByRole("combobox", { name: EPIC_LABEL });
}

/**
 * Type into the message field.
 *
 * @param text What it then holds.
 */
function type(text: string): void {
  fireEvent.change(message(), { target: { value: text } });
}

/**
 * Press something, and let what it sent settle.
 *
 * @param element What to press.
 */
async function press(element: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(element);
  });
}

/** The open confirmation. */
function dialog(): HTMLElement {
  return screen.getByRole("alertdialog");
}

/**
 * A sender whose answer the case releases.
 *
 * @returns The sender, and the release.
 * @typeParam T What it answers.
 */
function held<T>() {
  let release: (value: T) => void = () => undefined;
  const sender = vi.fn(
    () =>
      new Promise<T>((resolve) => {
        release = resolve;
      }),
  );

  return { sender, release: (value: T) => release(value) };
}

/**
 * A refusal, as a Server Action hands one back.
 *
 * @param code The service's code.
 * @param reason The service's sentence.
 * @param recheck The re-check's code, when it is what refused.
 * @returns The refusal.
 */
function refused(code: string, reason: string, recheck: MergeRefusal["recheck"] = null) {
  return { ok: false as const, status: 409, code, reason, recheck };
}

beforeEach(() => {
  window.history.replaceState(null, "", `/prs/${PR_514_ID}?from=dashboard`);
  Element.prototype.scrollIntoView = vi.fn();
});

describe("the seeded card (mockup 12)", () => {
  it("draws the strategy, the message, the three switches and the footer", () => {
    draw();

    expect(card()).toHaveAttribute("id", MERGE_PLAN_ID);
    expect(card()).toHaveTextContent("Strategy");
    expect(card()).toHaveTextContent("squash · delete branch");
    expect(message()).toHaveValue(SEEDED_MESSAGE);
    expect(toggle("Close issue #482 on merge")).toHaveAttribute("aria-checked", "true");
    expect(toggle("Comment evidence summary on the host PR")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(toggle("Back-annotate roadmap")).toHaveAttribute("aria-checked", "false");
    expect(card()).toHaveTextContent(IDENTITY_LINE);
    expect(within(card()).getByRole("button", { name: MERGE_LABEL })).toBeInTheDocument();
  });

  it("names each switch by what a press would do", () => {
    draw();

    expect(
      within(card())
        .getAllByRole("switch")
        .map((each) => each.getAttribute("aria-checked") + " · " + each.textContent),
    ).toEqual([
      "true · Switch off: Close issue #482 on merge",
      "true · Switch off: Comment evidence summary on the host PR",
      "false · Switch on: Back-annotate roadmap",
    ]);
  });

  it("links Edit policy to the pinned workflow", () => {
    draw();

    expect(within(card()).getByRole("link", { name: EDIT_POLICY_LINK })).toHaveAttribute(
      "href",
      workflowPath("standard-fix"),
    );
  });

  it("sits after the review thread, in the page's single column", () => {
    draw();

    const regions = screen.getAllByRole("region").map((region) => region.getAttribute("aria-labelledby"));
    const at = (name: string) =>
      regions.indexOf(screen.getByRole("region", { name }).getAttribute("aria-labelledby"));

    expect(at(STRIP_TITLE)).toBeLessThan(at(THREAD_TITLE));
    expect(at(THREAD_TITLE)).toBeLessThan(at(MERGE_PLAN_TITLE));
  });

  it("names the armed state in words as well as in hue", () => {
    draw(prPage({ pullRequest: { state: "armed" }, plan: armedPlan() }));

    expect(card()).toHaveClass("prv-merge--armed");
    expect(within(card()).getByText("Armed")).toBeInTheDocument();
    expect(card()).toHaveTextContent("Merges automatically when Second-model review turns green.");
    expect(card()).toHaveTextContent("against revision 2 · b7e41d0");
    expect(within(card()).getByText("armed 14:40:12")).toHaveAttribute(
      "datetime",
      "2026-09-27T14:40:12.000Z",
    );
  });
});

describe("the identity footer", () => {
  it("shows the real identity and never claims [bot], in any state of the card", () => {
    const pages = [
      prPage(),
      readyPage(),
      blockedPage(),
      prPage({ pullRequest: { state: "armed" }, plan: armedPlan() }),
      prPage({ pullRequest: { state: "merged" }, plan: mergedPlan() }),
      prPage({ pullRequest: { state: "merged" } }),
      prPage({ pullRequest: { state: "closed" } }),
      prPage({
        plan: mergePlan({ disarmReason: { code: "host_conflict", message: "Conflict." } }),
      }),
      // A result that claimed a bot is never repeated.
      prPage({
        plan: mergedPlan({
          mergedResult: {
            sha: "9c4ab7f02d31",
            identityUsed: "ouroboros-app[bot]",
            actionsExecuted: [],
            mergedAt: "2026-09-27T14:45:02.000Z",
          },
        }),
      }),
    ];

    for (const page of pages) {
      const { unmount } = draw(page);

      expect(card().textContent).not.toMatch(/\[bot\]/i);
      expect(card().textContent).not.toContain("ouroboros-app");
      expect(card().textContent).not.toMatch(/co-?authored/i);
      unmount();
    }
  });

  it("says who armed the plan", () => {
    draw(prPage({ pullRequest: { state: "armed" }, plan: armedPlan() }));

    expect(card()).toHaveTextContent(`${IDENTITY_LINE} Armed by ${KEN.name}.`);
  });

  it("states the configured token in the confirmation too", async () => {
    draw();
    await press(within(card()).getByRole("button", { name: MERGE_LABEL }));

    expect(dialog()).toHaveTextContent(IDENTITY_LINE);
    expect(dialog().textContent).not.toMatch(/\[bot\]/i);
  });
});

describe("plan edits round-trip", () => {
  it("saves the message, trimmed, and draws it from the answer", async () => {
    const planSenders = senders();
    draw(prPage(), { planSenders });

    type("fix(can): preserve ISR frame order\n\nCloses #482.\n");
    await press(within(card()).getByRole("button", { name: SAVE_MESSAGE }));

    expect(planSenders.edit).toHaveBeenCalledExactlyOnceWith(PR_514_ID, {
      commitMessage: "fix(can): preserve ISR frame order\n\nCloses #482.",
    });
    expect(message()).toHaveValue("fix(can): preserve ISR frame order\n\nCloses #482.");
    expect(within(card()).getByText(PLAN_SAVED)).toBeInTheDocument();
    // Saved: the draft is over, and so are its buttons.
    expect(within(card()).queryByRole("button", { name: SAVE_MESSAGE })).toBeNull();
  });

  it("offers Save and Discard only while the message differs from what is stored", () => {
    draw();

    expect(within(card()).queryByRole("button", { name: SAVE_MESSAGE })).toBeNull();

    type("reworded");
    expect(within(card()).getByRole("button", { name: SAVE_MESSAGE })).toBeInTheDocument();
    expect(within(card()).getByRole("button", { name: DISCARD_MESSAGE })).toBeInTheDocument();

    type(SEEDED_MESSAGE);
    expect(within(card()).queryByRole("button", { name: SAVE_MESSAGE })).toBeNull();
  });

  it("discards an edit, and sends nothing", async () => {
    const planSenders = senders();
    draw(prPage(), { planSenders });

    type("reworded");
    await press(within(card()).getByRole("button", { name: DISCARD_MESSAGE }));

    expect(message()).toHaveValue(SEEDED_MESSAGE);
    expect(planSenders.edit).not.toHaveBeenCalled();
  });

  it("will not save a blank message, and says why", async () => {
    const planSenders = senders();
    draw(prPage(), { planSenders });

    type("   ");

    const save = within(card()).getByRole("button", { name: SAVE_MESSAGE });
    expect(save).toHaveAttribute("aria-disabled", "true");
    expect(within(card()).getByRole("alert")).toHaveTextContent(MESSAGE_BLANK);

    await press(save);
    expect(planSenders.edit).not.toHaveBeenCalled();
  });

  it("persists each switch immediately, one field per press", async () => {
    const planSenders = senders(mergePlan({ epicId: OTA_EPIC.id }));
    draw(prPage({ plan: mergePlan({ epicId: OTA_EPIC.id }) }), { planSenders });

    await press(toggle("Close issue #482 on merge"));
    expect(planSenders.edit).toHaveBeenLastCalledWith(PR_514_ID, { closeTicket: false });
    expect(toggle("Close issue #482 on merge")).toHaveAttribute("aria-checked", "false");

    await press(toggle("Comment evidence summary on the host PR"));
    expect(planSenders.edit).toHaveBeenLastCalledWith(PR_514_ID, { commentEvidence: false });
    expect(toggle("Comment evidence summary on the host PR")).toHaveAttribute(
      "aria-checked",
      "false",
    );

    await press(toggle("Back-annotate roadmap (OTA hardening)"));
    expect(planSenders.edit).toHaveBeenLastCalledWith(PR_514_ID, { backAnnotateEpic: true });
    expect(toggle("Back-annotate roadmap (OTA hardening)")).toHaveAttribute(
      "aria-checked",
      "true",
    );

    expect(planSenders.edit).toHaveBeenCalledTimes(3);

    // And back again.
    await press(toggle("Close issue #482 on merge"));
    expect(planSenders.edit).toHaveBeenLastCalledWith(PR_514_ID, { closeTicket: true });
    expect(toggle("Close issue #482 on merge")).toHaveAttribute("aria-checked", "true");
  });

  it("round-trips the epic picker: choose, switch on, choose another, clear", async () => {
    const planSenders = senders();
    draw(prPage(), { planSenders });

    expect(
      within(picker())
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["No epic", OTA_EPIC.name, BLE_EPIC.name]);
    // Nothing to annotate yet: the switch waits for an epic.
    expect(toggle("Back-annotate roadmap")).toHaveAttribute("aria-disabled", "true");

    await act(async () => {
      fireEvent.change(picker(), { target: { value: OTA_EPIC.id } });
    });
    expect(planSenders.edit).toHaveBeenLastCalledWith(PR_514_ID, { epicId: OTA_EPIC.id });
    expect(picker()).toHaveValue(OTA_EPIC.id);

    await press(toggle("Back-annotate roadmap (OTA hardening)"));
    expect(planSenders.edit).toHaveBeenLastCalledWith(PR_514_ID, { backAnnotateEpic: true });

    await act(async () => {
      fireEvent.change(picker(), { target: { value: BLE_EPIC.id } });
    });
    expect(planSenders.edit).toHaveBeenLastCalledWith(PR_514_ID, { epicId: BLE_EPIC.id });
    expect(toggle("Back-annotate roadmap (BLE provisioning v2)")).toHaveAttribute(
      "aria-checked",
      "true",
    );

    await act(async () => {
      fireEvent.change(picker(), { target: { value: "" } });
    });
    expect(planSenders.edit).toHaveBeenLastCalledWith(PR_514_ID, { epicId: null });
    expect(picker()).toHaveValue("");
    // Nothing left to annotate: the switch went with the epic.
    expect(toggle("Back-annotate roadmap")).toHaveAttribute("aria-checked", "false");
  });

  it("draws a refusal on the card, in the service's words, and changes nothing", async () => {
    const planSenders = {
      ...senders(),
      edit: vi
        .fn<PlanSenders["edit"]>()
        .mockResolvedValue(
          refused("merge_plan_epic_not_found", "No such roadmap epic in this workspace."),
        ),
    };
    draw(prPage(), { planSenders });

    await act(async () => {
      fireEvent.change(picker(), { target: { value: OTA_EPIC.id } });
    });

    const status = within(card()).getByText("No such roadmap epic in this workspace.");
    expect(status).toHaveClass("prv-merge__outcome--failed");
    expect(picker()).toHaveValue("");
  });

  it("sends one change at a time — every control waits while one is in flight", async () => {
    const edit = held<PlanOutcome>();
    const planSenders = { ...senders(), edit: edit.sender as PlanSenders["edit"] };
    draw(prPage(), { planSenders });

    await press(toggle("Close issue #482 on merge"));

    expect(toggle("Comment evidence summary on the host PR")).toHaveAttribute(
      "title",
      PLAN_SENDING,
    );
    expect(picker()).toBeDisabled();
    expect(within(card()).getByRole("button", { name: MERGE_LABEL })).toHaveAttribute(
      "title",
      PLAN_SENDING,
    );

    // A second press while the first is in the air sends nothing.
    fireEvent.click(toggle("Comment evidence summary on the host PR"));
    fireEvent.click(toggle("Close issue #482 on merge"));
    expect(edit.sender).toHaveBeenCalledOnce();

    await act(async () => {
      edit.release({ ok: true, answer: mergePlan({ closeTicket: false }) });
    });

    expect(toggle("Close issue #482 on merge")).toHaveAttribute("aria-checked", "false");
    expect(picker()).toBeEnabled();
  });

  it("keeps an unsaved edit through a read, and says when the stored message moved", async () => {
    let served = prPage();
    const poll: PrPollOptions = {
      read: () =>
        Promise.resolve({
          state: "fresh",
          payload: served,
          etag: null,
          pollAfterSeconds: null,
        } satisfies PollAnswer<PullRequestPage>),
      visible: () => true,
    };
    draw(prPage(), { poll, planSenders: senders() });

    type("my edit\n\nCloses #482.");

    // Somebody else saved a message of their own, and the page read it.
    served = prPage({
      plan: mergePlan({
        commitMessage: "their edit\n\nCloses #482.",
        updatedAt: "2026-09-27T14:55:00.000Z",
      }),
    });
    // A switch press refreshes the page.
    await press(toggle("Comment evidence summary on the host PR"));
    await vi.waitFor(() => expect(within(card()).getByText(MESSAGE_MOVED)).toBeInTheDocument());

    expect(message()).toHaveValue("my edit\n\nCloses #482.");
  });
});

describe("the Closes warning", () => {
  it("warns when an edit removes Closes #N while the close switch is on", () => {
    draw();

    expect(within(card()).queryByText(/no closing keyword/)).toBeNull();

    type("can: fix flaky telemetry frame order under ISR load");

    const warning = within(card()).getByText(/no closing keyword for #482/);
    expect(warning).toHaveAttribute("role", "status");
    expect(warning).toHaveClass("prv-merge__warning");
    expect(warning).toHaveTextContent("the toggle and the message disagree");
    // The field is described by it, so a screen reader hears it on the field.
    expect(message().getAttribute("aria-describedby")).toContain(warning.id);
  });

  it("stops warning when the keyword is typed back", () => {
    draw();

    type("reworded");
    expect(within(card()).getByText(/no closing keyword/)).toBeInTheDocument();

    type("reworded\n\nFixes #482");
    expect(within(card()).queryByText(/no closing keyword/)).toBeNull();
  });

  it("stops warning once the close switch is off — nothing is left to disagree", async () => {
    draw(prPage({ plan: mergePlan({ commitMessage: "reworded" }) }), {
      planSenders: senders(mergePlan({ commitMessage: "reworded" })),
    });

    expect(within(card()).getByText(/no closing keyword/)).toBeInTheDocument();

    await press(toggle("Close issue #482 on merge"));

    expect(within(card()).queryByText(/no closing keyword/)).toBeNull();
  });

  it("warns every reader of a stored message that lost the keyword", () => {
    draw(prPage({ plan: mergePlan({ commitMessage: "reworded" }) }), {
      mayArm: false,
      mayContribute: false,
    });

    expect(within(card()).getByText(/no closing keyword for #482/)).toBeInTheDocument();
  });

  it("does not let the merge be armed over an unsaved edit", async () => {
    draw();

    type("reworded");

    const arm = within(card()).getByRole("button", { name: MERGE_LABEL });
    expect(arm).toHaveAttribute("aria-disabled", "true");
    expect(arm).toHaveAttribute("title", SAVE_FIRST);

    await press(arm);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("the arm confirmation", () => {
  it("names the specific gate being waited on and states the merge-time re-check", async () => {
    draw();

    await press(within(card()).getByRole("button", { name: MERGE_LABEL }));

    expect(dialog()).toHaveAccessibleName("Merge PR #514 when all gates are green");
    expect(dialog()).toHaveAccessibleDescription(
      expect.stringContaining("Merges automatically when Second-model review turns green."),
    );
    expect(dialog()).toHaveAccessibleDescription(expect.stringContaining(RECHECK_TERMS));
    expect(dialog()).toHaveTextContent(IRREVERSIBLE);

    const gates = within(dialog()).getByRole("list", { name: "Gates this merge waits on" });
    expect(within(gates).getAllByRole("listitem")).toHaveLength(1);
    expect(gates).toHaveTextContent("Second-model review — unavailable");
    expect(gates).toHaveTextContent("will not turn green on its own");

    expect(dialog()).toHaveTextContent("Revision 2 · b7e41d0");
    expect(dialog()).toHaveTextContent("squash · delete branch");
    expect(dialog()).toHaveTextContent(
      "close issue #482 · comment the evidence summary · delete the branch",
    );
  });

  it("is not a bare are-you-sure", async () => {
    draw();
    await press(within(card()).getByRole("button", { name: MERGE_LABEL }));

    expect(dialog().textContent).not.toMatch(/are you sure/i);
  });

  it("arms nothing until confirmed, and nothing when cancelled", async () => {
    const planSenders = senders();
    draw(prPage(), { planSenders });

    await press(within(card()).getByRole("button", { name: MERGE_LABEL }));
    expect(planSenders.arm).not.toHaveBeenCalled();

    await press(within(dialog()).getByRole("button", { name: ARM_CANCEL }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(planSenders.arm).not.toHaveBeenCalled();
    expect(within(card()).queryByText("Armed")).toBeNull();
  });

  it("opens with focus on the panel, so Enter on arrival confirms nothing", async () => {
    draw();
    await press(within(card()).getByRole("button", { name: MERGE_LABEL }));

    expect(within(dialog()).getByRole("button", { name: ARM_CONFIRM })).not.toHaveFocus();
    expect(dialog().contains(document.activeElement)).toBe(true);
  });

  it("arms against the revision it stated, then draws the armed state with Disarm", async () => {
    const planSenders = senders();
    draw(prPage(), { planSenders });

    await press(within(card()).getByRole("button", { name: MERGE_LABEL }));
    await press(within(dialog()).getByRole("button", { name: ARM_CONFIRM }));

    expect(planSenders.arm).toHaveBeenCalledExactlyOnceWith(PR_514_ID, REV_2_ID);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(card()).toHaveClass("prv-merge--armed");
    expect(card()).toHaveTextContent(
      "Armed. Merges automatically when Second-model review turns green.",
    );
    expect(within(card()).getByRole("button", { name: DISARM_LABEL })).toBeInTheDocument();
    expect(within(card()).queryByRole("button", { name: MERGE_LABEL })).toBeNull();
    // The button that opened the dialog is gone, so the card takes focus.
    expect(card()).toHaveFocus();
  });

  it("moves the head and the strip with the answer — nothing says unarmed beside armed", async () => {
    draw();

    await press(within(card()).getByRole("button", { name: MERGE_LABEL }));
    await press(within(dialog()).getByRole("button", { name: ARM_CONFIRM }));

    expect(document.querySelector(".prv-head__meta .ou-chip")).toHaveTextContent(
      "armed — 5 of 7 gates green",
    );
    expect(screen.getByRole("region", { name: STRIP_TITLE })).toHaveTextContent(
      "Auto-merge (squash) — armed",
    );
    expect(
      within(screen.getByRole("group", { name: ACTIONS_LABEL })).getByRole("button", {
        name: MERGE_LABEL,
      }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("locks the plan once armed — it is changed by disarming first", async () => {
    draw();

    await press(within(card()).getByRole("button", { name: MERGE_LABEL }));
    await press(within(dialog()).getByRole("button", { name: ARM_CONFIRM }));

    expect(within(card()).queryByRole("textbox")).toBeNull();
    expect(card()).toHaveTextContent(MESSAGE_PREVIEW_LABEL);
    for (const each of within(card()).getAllByRole("switch")) {
      expect(each).toHaveAttribute("aria-disabled", "true");
    }
    expect(picker()).toBeDisabled();
  });

  it("draws a refusal in the dialog, which stays open, and arms nothing", async () => {
    const planSenders = {
      ...senders(),
      arm: vi
        .fn<PlanSenders["arm"]>()
        .mockResolvedValue(
          refused("merge_revision_stale", "A newer revision exists — review its gates before arming."),
        ),
    };
    draw(prPage(), { planSenders });

    await press(within(card()).getByRole("button", { name: MERGE_LABEL }));
    await press(within(dialog()).getByRole("button", { name: ARM_CONFIRM }));

    expect(within(dialog()).getByRole("alert")).toHaveTextContent(
      "A newer revision exists — review its gates before arming.",
    );
    expect(card()).not.toHaveClass("prv-merge--armed");
  });

  it("is refused for a reader the service does not let arm, in the service's words", async () => {
    const planSenders = {
      ...senders(),
      arm: vi.fn<PlanSenders["arm"]>().mockResolvedValue({
        ok: false,
        status: 403,
        code: "merge_not_policy_eligible",
        reason: "Only an owner or admin may merge this PR — its pinned workflow does not auto-merge.",
        recheck: null,
      }),
    };
    draw(prPage(), { planSenders });

    await press(within(card()).getByRole("button", { name: MERGE_LABEL }));
    await press(within(dialog()).getByRole("button", { name: ARM_CONFIRM }));

    expect(within(dialog()).getByRole("alert")).toHaveTextContent(
      "Only an owner or admin may merge this PR",
    );
    expect(within(card()).queryByRole("button", { name: DISARM_LABEL })).toBeNull();
  });

  it("says an arm may have landed when the service did not answer", async () => {
    const planSenders = {
      ...senders(),
      arm: vi.fn<PlanSenders["arm"]>().mockResolvedValue({
        ok: false,
        status: 502,
        code: ACTION_UNREACHABLE_CODE,
        reason: ACTION_UNREACHABLE,
        recheck: null,
      }),
    };
    draw(prPage(), { planSenders });

    await press(within(card()).getByRole("button", { name: MERGE_LABEL }));
    await press(within(dialog()).getByRole("button", { name: ARM_CONFIRM }));

    expect(within(dialog()).getByRole("alert")).toHaveTextContent(MAY_HAVE_LANDED);
  });

  it("sends once, however often the button is pressed", async () => {
    const arm = held<PlanOutcome>();
    const planSenders = { ...senders(), arm: arm.sender as PlanSenders["arm"] };
    draw(prPage(), { planSenders });

    await press(within(card()).getByRole("button", { name: MERGE_LABEL }));

    const confirm = within(dialog()).getByRole("button", { name: ARM_CONFIRM });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    fireEvent.submit(dialog().querySelector("form") as HTMLFormElement);

    expect(arm.sender).toHaveBeenCalledOnce();

    await act(async () => {
      arm.release({ ok: true, answer: armedPlan() });
    });
  });

  it("goes inert when a new revision lands under it", async () => {
    let served = prPage();
    const planSenders = senders();
    const poll: PrPollOptions = {
      read: () =>
        Promise.resolve({
          state: "fresh",
          payload: served,
          etag: null,
          pollAfterSeconds: null,
        } satisfies PollAnswer<PullRequestPage>),
      visible: () => true,
    };
    draw(prPage(), { poll, planSenders });

    await press(within(card()).getByRole("button", { name: MERGE_LABEL }));
    expect(within(dialog()).getByRole("button", { name: ARM_CONFIRM })).not.toHaveAttribute(
      "aria-disabled",
    );

    served = prPage({
      revisions: [
        ...prPage().revisions,
        revision({ id: "5eed003b-0000-4000-8000-000000005143", seq: 3, headSha: "c0ffee1" }),
      ],
    });
    // A press elsewhere refreshes the page.
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await vi.waitFor(() =>
      expect(within(dialog()).getByRole("button", { name: ARM_CONFIRM })).toHaveAttribute(
        "aria-disabled",
        "true",
      ),
    );
    expect(within(dialog()).getByRole("alert")).toHaveTextContent(TERMS_MOVED);

    fireEvent.submit(dialog().querySelector("form") as HTMLFormElement);
    expect(planSenders.arm).not.toHaveBeenCalled();
  });
});

describe("arm → the staged last gate flips → merged", () => {
  it("draws the receipt — sha, identity and executed actions — from the read that follows", async () => {
    // What the service holds; every press and every gate flip moves it.
    let served = prPage();
    let clock = 1_000;
    const tick = () => (clock += 1);
    const planSenders = senders();
    const poll: PrPollOptions = {
      read: () =>
        Promise.resolve({
          state: "fresh",
          payload: served,
          etag: null,
          pollAfterSeconds: null,
        } satisfies PollAnswer<PullRequestPage>),
      visible: () => true,
      now: tick,
    };
    planSenders.arm.mockImplementation(() => {
      served = prPage({ pullRequest: { state: "armed" }, plan: armedPlan() });

      return Promise.resolve({ ok: true, answer: armedPlan() });
    });
    draw(prPage(), { poll, planSenders, now: tick });

    await press(within(card()).getByRole("button", { name: MERGE_LABEL }));
    await press(within(dialog()).getByRole("button", { name: ARM_CONFIRM }));

    await vi.waitFor(() => expect(card()).toHaveClass("prv-merge--armed"));
    expect(card()).toHaveTextContent("Merges automatically when Second-model review turns green.");
    expect(within(card()).queryByText("9c4ab7f")).toBeNull();

    // The staged last gate flips green; the executor's re-check passes and it merges.
    served = readyPage({ pullRequest: { state: "merged" }, plan: mergedPlan() });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await vi.waitFor(() => expect(within(card()).getByText("9c4ab7f")).toBeInTheDocument());

    const receipt = card().querySelector(".prv-merge__receipt") as HTMLElement;

    expect(receipt).toHaveTextContent("9c4ab7f · merged as ken-s · 14:45:02");
    expect(receipt).toHaveTextContent(
      "Ran: closed issue #482 · commented the evidence summary · deleted the branch",
    );
    expect(within(receipt).getByText("14:45:02")).toHaveAttribute(
      "datetime",
      "2026-09-27T14:45:02.000Z",
    );
    expect(within(card()).getByText("Merged")).toBeInTheDocument();

    // Merged: nothing is armed, nothing can be armed, and the plan is final.
    expect(card()).not.toHaveClass("prv-merge--armed");
    expect(within(card()).queryAllByRole("button")).toHaveLength(0);
    expect(within(card()).queryByRole("textbox")).toBeNull();
    expect(document.querySelector(".prv-head__meta .ou-chip")).toHaveTextContent("merged");
  });

  it("draws a merge the host's mirror has not caught up with as merged", () => {
    draw(prPage({ pullRequest: { state: "armed" }, plan: mergedPlan() }));

    expect(within(card()).getByText("9c4ab7f")).toBeInTheDocument();
    expect(card()).not.toHaveClass("prv-merge--armed");
    expect(document.querySelector(".prv-head__meta .ou-chip")).toHaveTextContent("merged");
  });

  it("lists what was switched on and did not run, apart from what ran", () => {
    draw(
      prPage({
        pullRequest: { state: "merged" },
        plan: mergedPlan({
          mergedResult: {
            sha: "9c4ab7f02d31",
            identityUsed: "ken-s",
            actionsExecuted: ["comment_evidence", "delete_branch"],
            mergedAt: "2026-09-27T14:45:02.000Z",
          },
        }),
      }),
    );

    const skipped = within(card()).getByRole("list", { name: "Switched on, and did not run" });

    expect(within(skipped).getAllByRole("listitem").map((row) => row.textContent)).toEqual([
      "Did not run: close issue #482",
    ]);
    expect(card()).toHaveTextContent(
      "Ran: commented the evidence summary · deleted the branch",
    );
  });
});

describe("a failed re-check renders its disarm reason", () => {
  it.each([
    ["gate_red", "A gate went red", "Physical HIL is red on revision 2."],
    ["head_moved", "The head moved", "Revision 3 was recorded after arming."],
    ["host_conflict", "The host reports a conflict", "The host reports a merge conflict."],
    ["host_refused", "The host refused the merge", "Branch protection refused the merge."],
  ] as const)("draws %s as its own reason, not a generic error", (code, headline, sentence) => {
    draw(prPage({ plan: mergePlan({ disarmReason: { code, message: sentence } }) }));

    const reason = card().querySelector(".prv-merge__disarmed") as HTMLElement;

    expect(reason).toHaveAttribute("role", "status");
    expect(reason).toHaveTextContent(`Disarmed — ${headline}`);
    expect(reason).toHaveTextContent(sentence);
    expect(reason.textContent).not.toMatch(/something went wrong|an error occurred/i);
    expect(card()).not.toHaveClass("prv-merge--armed");
    // It can be armed again.
    expect(within(card()).getByRole("button", { name: MERGE_LABEL })).not.toHaveAttribute(
      "aria-disabled",
    );
  });

  it("draws the reason a read brings, after an arm the re-check refused", async () => {
    let served = prPage({ pullRequest: { state: "armed" }, plan: armedPlan() });
    const poll: PrPollOptions = {
      read: () =>
        Promise.resolve({
          state: "fresh",
          payload: served,
          etag: null,
          pollAfterSeconds: null,
        } satisfies PollAnswer<PullRequestPage>),
      visible: () => true,
    };
    draw(served, { poll });

    await vi.waitFor(() => expect(card()).toHaveClass("prv-merge--armed"));

    // A gate went red between arm and fire: the re-check disarmed rather than merged.
    served = blockedPage({
      plan: mergePlan({
        disarmReason: { code: "gate_red", message: "Physical HIL is red on revision 2." },
      }),
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await vi.waitFor(() => expect(card()).toHaveTextContent("Disarmed — A gate went red"));
    expect(card()).toHaveTextContent("Physical HIL is red on revision 2.");
    expect(within(card()).queryByRole("button", { name: DISARM_LABEL })).toBeNull();
  });

  it("draws a direct merge's refusal in its dialog, in the re-check's own words", async () => {
    const planSenders = {
      ...senders(),
      merge: vi
        .fn<PlanSenders["merge"]>()
        .mockResolvedValue(
          refused("merge_recheck_failed", "The host reports a merge conflict.", {
            code: "host_conflict",
            disarmed: false,
          }),
        ),
    };
    draw(readyPage(), { planSenders });

    await press(within(card()).getByRole("button", { name: MERGE_NOW_LABEL }));
    await press(within(dialog()).getByRole("button", { name: MERGE_CONFIRM }));

    expect(within(dialog()).getByRole("alert")).toHaveTextContent(
      "The host reports a merge conflict.",
    );
    expect(within(card()).queryByText("9c4ab7f")).toBeNull();
  });
});

describe("Disarm", () => {
  it("disarms, says so, and offers arming again", async () => {
    const planSenders = senders(armedPlan());
    draw(prPage({ pullRequest: { state: "armed" }, plan: armedPlan() }), { planSenders });

    await press(within(card()).getByRole("button", { name: DISARM_LABEL }));

    expect(planSenders.disarm).toHaveBeenCalledExactlyOnceWith(PR_514_ID);
    expect(card()).not.toHaveClass("prv-merge--armed");
    expect(within(card()).getByText(DISARMED)).toBeInTheDocument();
    expect(within(card()).getByRole("button", { name: MERGE_LABEL })).not.toHaveAttribute(
      "aria-disabled",
    );
    expect(message()).toHaveValue(SEEDED_MESSAGE);
    expect(document.querySelector(".prv-head__meta .ou-chip")).toHaveTextContent(
      "verifying — 5 of 7 gates green",
    );
  });

  it("draws a refusal, and leaves the plan armed", async () => {
    const planSenders = {
      ...senders(armedPlan()),
      disarm: vi.fn<PlanSenders["disarm"]>().mockResolvedValue({
        ok: false,
        status: 403,
        code: "forbidden",
        reason: "A viewer may not disarm a merge.",
        recheck: null,
      }),
    };
    draw(prPage({ pullRequest: { state: "armed" }, plan: armedPlan() }), { planSenders });

    await press(within(card()).getByRole("button", { name: DISARM_LABEL }));

    expect(within(card()).getByText("A viewer may not disarm a merge.")).toHaveClass(
      "prv-merge__outcome--failed",
    );
    expect(card()).toHaveClass("prv-merge--armed");
  });
});

describe("the direct merge — only when all gates are already green", () => {
  it("offers Merge now in place of arming, on the card and in the head", () => {
    draw(readyPage());

    expect(within(card()).getByRole("button", { name: MERGE_NOW_LABEL })).toBeInTheDocument();
    expect(within(card()).queryByRole("button", { name: MERGE_LABEL })).toBeNull();
    expect(
      within(screen.getByRole("group", { name: ACTIONS_LABEL })).getByRole("button", {
        name: MERGE_NOW_LABEL,
      }),
    ).toBeInTheDocument();
  });

  it("is not offered while any required gate is not green", () => {
    for (const page of [prPage(), blockedPage(), prPage({ gates: null })]) {
      const { unmount } = draw(page);

      expect(screen.queryByRole("button", { name: MERGE_NOW_LABEL })).toBeNull();
      unmount();
    }
  });

  it("states its terms, merges, and draws the receipt with why an action did not run", async () => {
    const planSenders = {
      ...senders(),
      merge: vi.fn<PlanSenders["merge"]>().mockResolvedValue({
        ok: true,
        answer: mergeOutcome({
          plan: mergedPlan({
            mergedResult: {
              sha: "9c4ab7f02d31",
              identityUsed: "ken-s",
              actionsExecuted: ["comment_evidence", "delete_branch"],
              mergedAt: "2026-09-27T14:45:02.000Z",
            },
          }),
          ticket: { key: "#482", closed: false, detail: "#482 is still open after the merge" },
          failedActions: [
            { action: "close_ticket", detail: "#482 is still open after the merge" },
          ],
        }),
      } satisfies MergeOutcome),
    };
    draw(readyPage(), { planSenders });

    await press(within(card()).getByRole("button", { name: MERGE_NOW_LABEL }));

    expect(dialog()).toHaveAccessibleName("Merge PR #514 now");
    expect(dialog()).toHaveAccessibleDescription(expect.stringContaining(MERGE_NOW_TERMS));
    expect(within(dialog()).queryByRole("list", { name: "Gates this merge waits on" })).toBeNull();

    await press(within(dialog()).getByRole("button", { name: MERGE_CONFIRM }));

    expect(planSenders.merge).toHaveBeenCalledExactlyOnceWith(PR_514_ID);
    expect(planSenders.arm).not.toHaveBeenCalled();
    expect(card().querySelector(".prv-merge__receipt")).toHaveTextContent(
      "9c4ab7f · merged as ken-s",
    );
    expect(card()).toHaveTextContent(
      "Did not run: close issue #482 — #482 is still open after the merge",
    );
    expect(card()).toHaveTextContent(
      "Merged as ken-s (9c4ab7f). 1 action did not run — see the receipt.",
    );
    expect(card()).toHaveFocus();
  });

  it("goes inert when a gate is no longer green under the confirmation", async () => {
    let served = readyPage();
    const planSenders = senders();
    const poll: PrPollOptions = {
      read: () =>
        Promise.resolve({
          state: "fresh",
          payload: served,
          etag: null,
          pollAfterSeconds: null,
        } satisfies PollAnswer<PullRequestPage>),
      visible: () => true,
    };
    draw(readyPage(), { poll, planSenders });

    await press(within(card()).getByRole("button", { name: MERGE_NOW_LABEL }));

    served = prPage();
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await vi.waitFor(() =>
      expect(within(dialog()).getByRole("alert")).toHaveTextContent(TERMS_MOVED),
    );
    fireEvent.submit(dialog().querySelector("form") as HTMLFormElement);
    expect(planSenders.merge).not.toHaveBeenCalled();
  });
});

describe("arm and disarm are role-gated, hidden", () => {
  it("draws a member the plan read-only, with no arm and no merge", () => {
    for (const page of [prPage(), readyPage()]) {
      const { unmount } = draw(page, { mayArm: false });

      expect(within(card()).queryAllByRole("button")).toHaveLength(0);
      expect(within(card()).queryByRole("textbox")).toBeNull();
      expect(within(card()).queryByRole("link", { name: EDIT_POLICY_LINK })).toBeNull();
      expect(card()).toHaveTextContent(SEEDED_MESSAGE.split("\n")[0] as string);
      expect(picker()).toBeDisabled();
      unmount();
    }
  });

  it("sends nothing when a member presses a switch they may only read", async () => {
    const planSenders = senders();
    draw(prPage(), { mayArm: false, planSenders });

    await press(toggle("Close issue #482 on merge"));

    expect(planSenders.edit).not.toHaveBeenCalled();
    expect(toggle("Close issue #482 on merge")).toHaveAttribute("aria-checked", "true");
  });

  it("draws a member Disarm while armed, and a viewer nothing to press", () => {
    const armed = prPage({ pullRequest: { state: "armed" }, plan: armedPlan() });
    const member = draw(armed, { mayArm: false });

    expect(
      within(card())
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual([DISARM_LABEL]);
    member.unmount();

    draw(armed, { mayArm: false, mayContribute: false });

    expect(within(card()).queryAllByRole("button")).toHaveLength(0);
    expect(card()).toHaveClass("prv-merge--armed");
  });
});

describe("the states the host owns", () => {
  it("says a closed PR is closed, and offers nothing", () => {
    draw(prPage({ pullRequest: { state: "closed" } }));

    expect(within(card()).getByRole("note")).toHaveTextContent("This PR is closed on its host.");
    expect(within(card()).queryAllByRole("button")).toHaveLength(0);
  });

  it("still lets a plan armed on a closed PR be disarmed", () => {
    draw(prPage({ pullRequest: { state: "closed" }, plan: armedPlan() }));

    expect(
      within(card())
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual([DISARM_LABEL]);
  });

  it("says a PR merged on its host recorded nothing here", () => {
    draw(prPage({ pullRequest: { state: "merged" } }));

    expect(within(card()).getByRole("note")).toHaveTextContent("Merged on the host");
    expect(card().querySelector(".prv-merge__receipt")).toBeNull();
  });
});

describe("the roadmap", () => {
  it("says so when it could not be read, and when the workspace has none", () => {
    const unread = draw(prPage(), { epics: null });

    expect(picker()).toBeDisabled();
    expect(card()).toHaveTextContent("could not be read");
    unread.unmount();

    draw(prPage(), { epics: [] });

    expect(picker()).toBeDisabled();
    expect(card()).toHaveTextContent("no roadmap epics yet");
  });

  it("keeps an epic the roadmap no longer lists chosen, named as unknown", () => {
    const gone = "5eed001f-0000-4000-8000-0000000000aa";

    draw(prPage({ plan: mergePlan({ epicId: gone, backAnnotateEpic: true }) }));

    expect(picker()).toHaveValue(gone);
    expect(toggle("Back-annotate roadmap (an epic no longer on the roadmap)")).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
});
