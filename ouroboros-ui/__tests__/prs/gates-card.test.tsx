import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { PrGateRow, PullRequestPage } from "@/app/api/pull-requests";
import { BUILD_FARM_PATH, runPath, testsPath } from "@/app/paths";
import {
  APPROVAL_SENDING,
  APPROVED,
  APPROVE_LABEL,
  AUTO_MERGE_ELIGIBLE,
  DECLINED,
  DECLINE_CANCEL,
  DECLINE_LABEL,
  DECLINE_NEEDS_NOTE,
  DECLINE_NOTE_LABEL,
  GATES_TITLE,
  PENDING_PILL,
  REQUEST_LABEL,
  RUN_CONSOLE_LINK,
  UNAVAILABLE_NOTE,
  WAIVER_AUTHOR_UNKNOWN,
  WAIVER_BUTTON,
  declineTitle,
} from "@/app/prs/gates";
import type { ApprovalOutcome } from "@/app/prs/outcomes";
import type { PrPollOptions } from "@/app/prs/poll";
import { type ApprovalSender, PrScreen, type ReviewSender } from "@/app/prs/pr-screen";
import { DASHBOARD_ORIGIN } from "@/app/runs/origin";

import {
  ATTEMPT_4_ID,
  HIL_RED,
  PR_514_ID,
  TESTS_RED,
  gateRows,
  review,
  revisionOne,
  revisionTwo,
  stripPage,
} from "../helpers/pull-requests";
import { SEEDED_RUN_ID } from "../helpers/runs";

/**
 * The Verification gates card (#365), rendered in the PR screen: the seeded card against mockup
 * 12, `unavailable` apart from `pending`, the evidence links, the waiver popover, the scoped
 * snapshot, and the human-approval row's request, approve and decline.
 */

// The Server Actions are never reached here: the cases that press pass their own senders.
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

/** A poll that never answers — the page shows the server's first read. */
const QUIET: PrPollOptions = { read: () => new Promise(() => {}), visible: () => true };

/**
 * Draw the screen, as an owner unless told otherwise.
 *
 * @param initial The page.
 * @param options What else to pass.
 * @returns The Testing Library render result.
 */
function draw(
  initial: PullRequestPage = stripPage(),
  options: {
    mayContribute?: boolean;
    initialRevision?: number | null;
    sendApproval?: ApprovalSender;
    sendReview?: ReviewSender;
  } = {},
) {
  return render(
    <PrScreen
      initial={initial}
      initialError={null}
      initialRevision={options.initialRevision ?? null}
      mayArm
      mayContribute={options.mayContribute ?? true}
      origin={DASHBOARD_ORIGIN}
      poll={QUIET}
      prId={PR_514_ID}
      sendApproval={options.sendApproval}
      sendReview={options.sendReview}
    />,
  );
}

/**
 * The page with Revision 2's rows replaced.
 *
 * @param over Verdicts and evidence, by gate key.
 * @param cite What each gate's line was composed from, by gate key.
 * @returns The page.
 */
function withRows(
  over: Readonly<Record<string, readonly [PrGateRow["verdict"], string | null]>> = {},
  cite: Readonly<Record<string, NonNullable<PrGateRow["evidenceRef"]>>> = {},
): PullRequestPage {
  const two = revisionTwo();
  const rows = gateRows(over).map((row) => ({ ...row, evidenceRef: cite[row.key] ?? null }));

  return stripPage({ revisions: [revisionOne(), { ...two, gates: { ...two.gates, rows } }] });
}

/** The card. */
function card(): HTMLElement {
  return screen.getByRole("region", { name: GATES_TITLE });
}

/**
 * One gate's row.
 *
 * @param label The gate's name.
 * @returns The row.
 */
function gate(label: string): HTMLElement {
  const row = [...card().querySelectorAll<HTMLElement>(".prv-gate")].find(
    (each) => each.querySelector(".prv-gate__name")?.textContent === label,
  );

  if (row === undefined) throw new Error(`The card has no ${label} row.`);

  return row;
}

/**
 * What a gate's mark is announced as.
 *
 * @param label The gate's name.
 * @returns The verdict, in words.
 */
function announced(label: string): string | null {
  return within(gate(label)).getByRole("img").getAttribute("aria-label");
}

/** An answer the service gave. */
function answered(state: "approved" | "declined"): ApprovalOutcome {
  return {
    ok: true,
    outcome: { review: review({ state }), created: false, humanApproval: null, aggregate: null },
  };
}

describe("the seeded card", () => {
  it("draws mockup 12's header: the aggregate pill and the run console link", () => {
    draw();

    expect(card().querySelector(".ou-card__head .ou-chip")).toHaveTextContent("5 / 7 green");
    expect(card().querySelector(".ou-card__head .ou-chip")).toHaveClass("ou-chip--warn");
    expect(within(card()).getByRole("link", { name: RUN_CONSOLE_LINK })).toHaveAttribute(
      "href",
      runPath(SEEDED_RUN_ID, DASHBOARD_ORIGIN.id),
    );
  });

  it("draws the seven rows in the card's order, each mark announced in words", () => {
    draw();

    expect(
      [...card().querySelectorAll(".prv-gate")].map((row) => [
        row.querySelector(".prv-gate__mark")?.textContent,
        row.querySelector(".prv-gate__mark")?.getAttribute("aria-label"),
        row.querySelector(".prv-gate__name")?.textContent,
        row.querySelector(".prv-gate__evidence")?.textContent,
      ]),
    ).toEqual([
      ["✓", "green", "Build", "forge-01 · zephyr.elf · FLASH 43.5%"],
      ["✓", "green", "Test suite", "63/63 after attempt 4"],
      ["✓", "green", "Physical HIL", "overshoot 1.7% ≤ 2.0% · rig helios-rig-02"],
      ["✓", "green", "Diff vs plan", "all hunks map to planned files · 0 out-of-scope edits"],
      ["✓", "green", "Secrets & license", "clean (headers + manifest delta)"],
      ["–", "unavailable", "Second-model review", "unavailable — arrives with the provider stack"],
      ["○", "not required", "Human approval", "not required by policy"],
    ]);
  });

  it("draws the pill from the payload's aggregate, not from the rows", () => {
    const two = revisionTwo();

    draw(
      stripPage({
        revisions: [
          revisionOne(),
          {
            ...two,
            gates: { ...two.gates, aggregate: { ...two.gates.aggregate!, greenCount: 4 } },
          },
        ],
      }),
    );

    expect(card().querySelector(".ou-card__head .ou-chip")).toHaveTextContent("4 / 7 green");
    expect(card().querySelectorAll(".prv-gate--green")).toHaveLength(5);
  });
});

describe("unavailable and pending", () => {
  it("draws unavailable standing still, with its note and no spinner", () => {
    draw();

    const row = gate("Second-model review");

    expect(row).toHaveClass("prv-gate--unavailable");
    expect(row).not.toHaveClass("prv-gate--pending");
    expect(row).toHaveTextContent(UNAVAILABLE_NOTE);
    expect(row.querySelector(".prv-gate__dot")).toBeNull();
    expect(row).not.toHaveTextContent(PENDING_PILL);
    expect(announced("Second-model review")).toBe("unavailable");
  });

  it("draws pending as the mockup's row: the dot, the gradient class and in progress", () => {
    draw(withRows({ model_review: ["pending", "cursor/composer-2 voting…"] }));

    const row = gate("Second-model review");

    expect(row).toHaveClass("prv-gate--pending");
    expect(row).not.toHaveClass("prv-gate--unavailable");
    expect(row.querySelector(".prv-gate__mark .prv-gate__dot")).not.toBeNull();
    expect(row).toHaveTextContent("cursor/composer-2 voting…");
    expect(within(row).getByText(PENDING_PILL)).toHaveClass("ou-chip--accent");
    expect(row).not.toHaveTextContent(UNAVAILABLE_NOTE);
    expect(announced("Second-model review")).toBe("pending");
  });

  it("draws the two apart when both are on the card", () => {
    draw(withRows({ model_review: ["pending", "voting…"], build: ["unavailable", "no provider"] }));

    expect(card().querySelectorAll(".prv-gate__dot")).toHaveLength(1);
    expect(gate("Build").className).not.toBe(gate("Second-model review").className);
    expect(gate("Build").textContent).not.toBe(gate("Second-model review").textContent);
  });
});

describe("policy verdicts", () => {
  it("draws not_required as policy, with the auto-merge eligible tag", () => {
    draw();

    const row = gate("Human approval");

    expect(row).toHaveClass("prv-gate--not-required");
    expect(row).not.toHaveClass("prv-gate--green");
    expect(within(row).getByText(AUTO_MERGE_ELIGIBLE)).toHaveClass("ou-tag");
    expect(announced("Human approval")).toBe("not required");
  });

  it("opens a waived row's popover with the recorded reason, and says no author is named", () => {
    const evidence = `waived: rig recalibration pending · ${HIL_RED}`;

    draw(withRows({ physical_hil: ["waived", evidence] }));

    const row = gate("Physical HIL");
    const button = within(row).getByRole("button", { name: WAIVER_BUTTON });

    expect(row).toHaveClass("prv-gate--waived");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(within(row).queryByRole("group")).toBeNull();

    fireEvent.click(button);

    const popover = within(row).getByRole("group", { name: "Waiver · Physical HIL" });

    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveAttribute("aria-controls", popover.id);
    expect(popover).toHaveTextContent(evidence);
    expect(popover).toHaveTextContent("standard-fix@v14 pin");
    expect(popover).toHaveTextContent(WAIVER_AUTHOR_UNKNOWN);
  });

  it("closes the popover on Escape, on a press outside, and on a second press", () => {
    draw(withRows({ physical_hil: ["waived", "waived: accepted"] }));

    const row = gate("Physical HIL");
    const button = within(row).getByRole("button", { name: WAIVER_BUTTON });

    fireEvent.click(button);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(within(row).queryByRole("group")).toBeNull();

    fireEvent.click(button);
    fireEvent.mouseDown(gate("Build"));
    expect(within(row).queryByRole("group")).toBeNull();

    fireEvent.click(button);
    fireEvent.mouseDown(within(row).getByRole("group"));
    expect(within(row).getByRole("group")).toBeInTheDocument();

    fireEvent.click(button);
    expect(within(row).queryByRole("group")).toBeNull();
  });

  it("offers no waiver button on a row that is not waived", () => {
    draw();

    expect(within(card()).queryByRole("button", { name: WAIVER_BUTTON })).toBeNull();
  });
});

describe("the evidence links", () => {
  const CITED = {
    build: { kind: "build_job", id: "5eed0050-0000-4000-8000-000000000485" },
    test_suite: { kind: "test_run", id: ATTEMPT_4_ID },
    physical_hil: { kind: "hil_measurement", id: "5eed0050-0000-4000-8000-000000000002" },
    diff_vs_plan: { kind: "guardrail_evaluation", id: "5eed0050-0000-4000-8000-000000000003" },
    secrets_license: { kind: "guardrail_evaluation", id: "5eed0050-0000-4000-8000-000000000004" },
  } as const;

  it("lead each row to the system that produced its line", () => {
    draw(withRows({}, CITED));

    const tests = testsPath(SEEDED_RUN_ID, { from: DASHBOARD_ORIGIN.id, attempt: 4 });
    const consoleHref = runPath(SEEDED_RUN_ID, DASHBOARD_ORIGIN.id);
    const href = (label: string) => within(gate(label)).getByRole("link").getAttribute("href");

    expect(href("Build")).toBe(BUILD_FARM_PATH);
    expect(href("Test suite")).toBe(tests);
    expect(href("Physical HIL")).toBe(tests);
    expect(href("Diff vs plan")).toBe(consoleHref);
    expect(href("Secrets & license")).toBe(consoleHref);
  });

  it("draw no link on a row that cites nothing", () => {
    draw(withRows({}, CITED));

    expect(within(gate("Second-model review")).queryByRole("link")).toBeNull();
    expect(within(gate("Human approval")).queryByRole("link")).toBeNull();
  });
});

describe("scoping", () => {
  it("shows revision 1's two red gates, its own pill, and no approval affordance", () => {
    draw(stripPage({ review: review() }), { initialRevision: 1 });

    expect(card()).toHaveTextContent("Revision 1 · 3f9c2ae · 2 gates red");
    expect(card().querySelector(".ou-card__head .ou-chip")).toHaveTextContent("3 / 7 green");
    expect(card().querySelector(".ou-card__head .ou-chip")).toHaveClass("ou-chip--err");
    expect(gate("Test suite")).toHaveClass("prv-gate--red");
    expect(gate("Test suite")).toHaveTextContent(TESTS_RED);
    expect(gate("Physical HIL")).toHaveClass("prv-gate--red");
    expect(gate("Physical HIL")).toHaveTextContent(HIL_RED);
    expect(card().querySelectorAll(".prv-gate--red")).toHaveLength(2);
    expect(within(card()).queryByRole("button", { name: APPROVE_LABEL })).toBeNull();
  });
});

describe("the human-approval row", () => {
  it("requests a review from the row, and then offers the decision", async () => {
    const sendReview = vi.fn<ReviewSender>().mockResolvedValue({
      ok: true,
      outcome: { review: review(), created: true, humanApproval: null, aggregate: null },
    });

    draw(stripPage(), { sendReview });

    await act(async () => {
      fireEvent.click(within(gate("Human approval")).getByRole("button", { name: REQUEST_LABEL }));
    });

    expect(sendReview).toHaveBeenCalledExactlyOnceWith(PR_514_ID);
    expect(within(gate("Human approval")).queryByRole("button", { name: REQUEST_LABEL })).toBeNull();
    expect(within(gate("Human approval")).getByRole("button", { name: APPROVE_LABEL })).toBeEnabled();
    expect(within(gate("Human approval")).getByRole("button", { name: DECLINE_LABEL })).toBeEnabled();
  });

  it("approves on one press, says so, and offers nothing twice", async () => {
    let settle: (outcome: ApprovalOutcome) => void = () => {};
    const sendApproval = vi.fn<ApprovalSender>(
      () => new Promise((resolve) => (settle = resolve)),
    );

    draw(stripPage({ review: review() }), { sendApproval });

    const approve = within(gate("Human approval")).getByRole("button", { name: APPROVE_LABEL });

    fireEvent.click(approve);

    // In flight: the row's buttons wait, with the reason.
    expect(approve).toHaveAttribute("aria-disabled", "true");
    expect(approve).toHaveAttribute("title", APPROVAL_SENDING);

    await act(async () => settle(answered("approved")));

    expect(sendApproval).toHaveBeenCalledExactlyOnceWith(PR_514_ID, { decision: "approve" });
    expect(within(card()).getByRole("status")).toHaveTextContent(APPROVED);
    expect(within(gate("Human approval")).queryAllByRole("button")).toHaveLength(0);
  });

  it("draws the service's refusal of an approval on the card", async () => {
    const sendApproval = vi.fn<ApprovalSender>().mockResolvedValue({
      ok: false,
      status: 409,
      code: "pull_request_not_open",
      reason: "This PR is not open.",
    });

    draw(stripPage({ review: review() }), { sendApproval });

    await act(async () => {
      fireEvent.click(within(gate("Human approval")).getByRole("button", { name: APPROVE_LABEL }));
    });

    expect(within(card()).getByRole("status")).toHaveTextContent("This PR is not open.");
    expect(within(card()).getByRole("status")).toHaveClass("prv-gates__outcome--failed");
    expect(within(card()).getByRole("button", { name: APPROVE_LABEL })).toBeInTheDocument();
  });

  it("asks for the note before a decline is sent, and sends it trimmed", async () => {
    const sendApproval = vi.fn<ApprovalSender>().mockResolvedValue(answered("declined"));

    draw(stripPage({ review: review() }), { sendApproval });

    fireEvent.click(within(gate("Human approval")).getByRole("button", { name: DECLINE_LABEL }));

    const dialog = screen.getByRole("dialog", { name: declineTitle(514) });
    const confirm = within(dialog).getByRole("button", { name: DECLINE_LABEL });

    expect(confirm).toHaveAttribute("aria-disabled", "true");
    expect(confirm).toHaveAttribute("title", DECLINE_NEEDS_NOTE);

    fireEvent.click(confirm);
    fireEvent.change(within(dialog).getByLabelText(DECLINE_NOTE_LABEL), {
      target: { value: "   " },
    });
    fireEvent.click(confirm);
    expect(sendApproval).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText(DECLINE_NOTE_LABEL), {
      target: { value: "  Overshoot is still 2.4%.  " },
    });

    await act(async () => {
      fireEvent.click(confirm);
    });

    expect(sendApproval).toHaveBeenCalledExactlyOnceWith(PR_514_ID, {
      decision: "decline",
      note: "Overshoot is still 2.4%.",
    });
    expect(screen.queryByRole("dialog", { name: declineTitle(514) })).toBeNull();
    expect(within(card()).getByRole("status")).toHaveTextContent(DECLINED);
  });

  it("keeps the dialog open on a refused decline, and says why there", async () => {
    const sendApproval = vi.fn<ApprovalSender>().mockResolvedValue({
      ok: false,
      status: 403,
      code: "forbidden",
      reason: "Only a contributor may answer.",
    });

    draw(stripPage({ review: review() }), { sendApproval });

    fireEvent.click(within(gate("Human approval")).getByRole("button", { name: DECLINE_LABEL }));

    const dialog = screen.getByRole("dialog", { name: declineTitle(514) });

    fireEvent.change(within(dialog).getByLabelText(DECLINE_NOTE_LABEL), {
      target: { value: "No." },
    });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: DECLINE_LABEL }));
    });

    expect(within(dialog).getByRole("alert")).toHaveTextContent("Only a contributor may answer.");
    expect(within(card()).queryByRole("status")).toBeNull();
  });

  it("sends nothing when the decline is cancelled", () => {
    const sendApproval = vi.fn<ApprovalSender>();

    draw(stripPage({ review: review() }), { sendApproval });

    fireEvent.click(within(gate("Human approval")).getByRole("button", { name: DECLINE_LABEL }));
    fireEvent.click(screen.getByRole("button", { name: DECLINE_CANCEL }));

    expect(screen.queryByRole("dialog", { name: declineTitle(514) })).toBeNull();
    expect(sendApproval).not.toHaveBeenCalled();
  });

  it("draws a viewer the row and no affordance", () => {
    draw(stripPage({ review: review() }), { mayContribute: false });

    expect(gate("Human approval")).toHaveTextContent("not required by policy");
    expect(within(gate("Human approval")).queryAllByRole("button")).toHaveLength(0);
  });
});
