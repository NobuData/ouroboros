import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PrCriterion, PullRequestPage } from "@/app/api/pull-requests";
import { prEvidencePath } from "@/app/paths";
import {
  CLAIM_CANCEL,
  CLAIM_CONFIRM,
  CLAIM_LABEL,
  CLAIM_NEEDS_TEXT,
  CLAIM_TITLE,
} from "@/app/prs/claim-dialog";
import {
  ADD_CLAIM_LABEL,
  ANNOTATED,
  ANNOTATION_FAILED_NOTE,
  ATTACH_LABEL,
  CLAIM_ADDED,
  CLAIM_VERIFIED,
  CRITERIA_SENDING,
  CRITERIA_TITLE,
  EVIDENCE_ATTACHED,
  FILES_ID,
  IMPORT_LABEL,
  NO_CRITERIA,
  OPENS_HOST,
  UNVERIFIED_PILL,
  VERIFIED_PILL,
  VERIFY_LABEL,
  VERIFY_NEEDS_EVIDENCE,
  WAIVED_ANNOTATED_PILL,
  WAIVED_FAILED_PILL,
  WAIVE_AGAIN_LABEL,
  WAIVE_LABEL,
} from "@/app/prs/criteria";
import { CRITERIA_ID } from "@/app/prs/criteria-card";
import {
  EVIDENCE_TITLE,
  MEASUREMENT_LABEL,
  OPTIONS_READING,
  PATH_LABEL,
  QUALIFIER_LABEL,
  TEST_LABEL,
} from "@/app/prs/evidence-dialog";
import {
  CHOOSE_TEST,
  NO_FILES_TO_CITE,
  NO_RUN_TO_CITE,
  attemptOptions,
  noOptions,
} from "@/app/prs/evidence-options";
import {
  FILES_TITLE,
  FULL_DIFF_LINK,
  HUNK_NOT_IN_SNAPSHOT,
  citedLine,
} from "@/app/prs/files";
import type { PrPollOptions } from "@/app/prs/poll";
import { type CriteriaSenders, PrScreen } from "@/app/prs/pr-screen";
import {
  WAIVE_AGAIN_CONSEQUENCE,
  WAIVE_CONFIRM,
  WAIVE_CONSEQUENCE,
  WAIVE_NEEDS_REASON,
  WAIVE_REASON_LABEL,
  WAIVE_TITLE,
} from "@/app/prs/waive-dialog";
import { DASHBOARD_ORIGIN } from "@/app/runs/origin";

import {
  ATTEMPT_4_ID,
  HOST_URL,
  PR_514_ID,
  REV_2_ID,
  TELEMETRY_PATH,
  THERMAL_REASON,
  TICKET_URL,
  WAIVE_COMMENT_URL,
  criterion,
  criterionId,
  evidence,
  evidenceId,
  matrix,
  matrixPage,
  mockupCriteria,
  waiver,
} from "../helpers/pull-requests";
import {
  measurement,
  page as attemptPage,
  physicalCase,
  suite,
  testCase,
} from "../helpers/test-results";

/**
 * The acceptance criteria matrix (#366), rendered in the PR screen: the seeded matrix against
 * mockup 12, every evidence link, the hunk's landing on the changed files, the authoring flow,
 * the typed picker, the evidence-gated Verify, and the waive dialog with its host link.
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

/** A poll that never answers — the page shows the server's first read. */
const QUIET: PrPollOptions = { read: () => new Promise(() => {}), visible: () => true };

/** The page's address. */
const ADDRESS = `/prs/${PR_514_ID}?from=dashboard`;

const KEY = "a".repeat(64);

/** What the picker offers from Build 4. */
const OPTIONS = attemptOptions(
  { id: ATTEMPT_4_ID, seq: 4 },
  attemptPage({
    suites: [
      suite({
        name: "telemetry integration",
        cases: [testCase({ id: "case-1", caseKey: KEY, name: "test_frame_order_under_load" })],
      }),
    ],
    physical: [
      physicalCase({
        name: "Motor overshoot on e-stop release",
        measurements: [measurement({ id: "5eed0036-0000-4000-8000-000000048201", value: 1.7 })],
      }),
    ],
  }),
);

/**
 * Senders that refuse to be called, except the ones a case supplies.
 *
 * @param over The senders the case presses.
 * @returns The senders.
 */
function senders(over: Partial<CriteriaSenders> = {}): CriteriaSenders {
  return {
    addClaim: vi.fn<CriteriaSenders["addClaim"]>(),
    importFromPlan: vi.fn<CriteriaSenders["importFromPlan"]>(),
    readOptions: vi
      .fn<CriteriaSenders["readOptions"]>()
      .mockResolvedValue({ ok: true, answer: OPTIONS }),
    attach: vi.fn<CriteriaSenders["attach"]>(),
    verify: vi.fn<CriteriaSenders["verify"]>(),
    waive: vi.fn<CriteriaSenders["waive"]>(),
    ...over,
  };
}

/**
 * Draw the screen, as an owner unless told otherwise.
 *
 * @param initial The page.
 * @param options What else to pass.
 * @returns The Testing Library render result.
 */
function draw(
  initial: PullRequestPage = matrixPage(),
  options: {
    mayContribute?: boolean;
    mayWaive?: boolean;
    criteriaSenders?: CriteriaSenders;
    initialHunk?: { path: string; lineStart: number; lineEnd: number } | null;
    poll?: PrPollOptions;
  } = {},
) {
  return render(
    <PrScreen
      criteriaSenders={options.criteriaSenders ?? senders()}
      initial={initial}
      initialError={null}
      initialHunk={options.initialHunk ?? null}
      mayArm
      mayContribute={options.mayContribute ?? true}
      mayWaive={options.mayWaive ?? true}
      now={() => 1_000}
      origin={DASHBOARD_ORIGIN}
      poll={options.poll ?? QUIET}
      prId={PR_514_ID}
    />,
  );
}

/**
 * The page with the given claims.
 *
 * @param criteria The claims.
 * @param planContext Whether there is a plan to import from.
 * @returns The page.
 */
function withClaims(criteria: readonly PrCriterion[], planContext = false): PullRequestPage {
  return matrixPage({ criteria: matrix(criteria, planContext) });
}

/** The card. */
function card(): HTMLElement {
  return screen.getByRole("region", { name: CRITERIA_TITLE });
}

/** The changed files card. */
function slot(): HTMLElement {
  return screen.getByRole("region", { name: FILES_TITLE });
}

/** The card's rows, in order. */
function rows(): HTMLElement[] {
  return within(card()).getAllByRole("listitem");
}

/**
 * The row of a claim.
 *
 * @param claim The claim's words.
 * @returns The row.
 */
function row(claim: string): HTMLElement {
  return within(card()).getByText(claim).closest("li") as HTMLElement;
}

beforeEach(() => {
  window.history.replaceState(null, "", ADDRESS);
  Element.prototype.scrollIntoView = vi.fn();
});

describe("the seeded matrix", () => {
  it("draws mockup 12's header: the question, the ticket link and the sentence", () => {
    draw();

    expect(card()).toHaveAttribute("id", CRITERIA_ID);

    const ticket = within(card()).getByRole("link", { name: "Issue #482 →" });

    expect(ticket).toHaveAttribute("href", TICKET_URL);
    expect(ticket).toHaveAttribute("target", "_blank");
    expect(ticket).toHaveAttribute("rel", "noopener noreferrer");
    expect(card()).toHaveTextContent(
      "Each claim from issue #482 is mapped to concrete evidence in this PR.",
    );
    expect(card()).toHaveTextContent("4 verified · 1 waived · 0 unverified");
  });

  it("draws the five claims in the matrix's order, each with its evidence and pill", () => {
    draw();

    expect(rows().map((each) => within(each).getAllByText(/./)[0]!.textContent)).toEqual([
      "Telemetry frames must arrive in ISR order under load",
      "No regression in e-stop response envelope",
      "Fix must not mask real ordering bugs in tests",
      "Zero heap allocation in ISR fast path",
      "Flake must not reappear across temperature range",
    ]);

    expect(rows()[0]).toHaveTextContent(
      "test_frame_order_under_load (10⁶ frames, 0 reordered) · hunk telemetry_buf.c:41–66",
    );
    expect(rows()[1]).toHaveTextContent("HIL overshoot 1.7% vs 2.0% limit (was 2.4% in rev 1)");
    expect(rows()[2]).toHaveTextContent("test asserts on seq gaps, not sleep-based");
    expect(rows()[3]).toHaveTextContent("static K_MSGQ_DEFINE · stack analysis clean");

    for (const verified of rows().slice(0, 4)) {
      expect(verified).toHaveTextContent(VERIFIED_PILL);
      expect(verified).not.toHaveClass("prv-crit--waived");
    }
  });

  it("draws the waived thermal row with its reason and the warn treatment", () => {
    draw();

    const thermal = row("Flake must not reappear across temperature range");

    expect(thermal).toHaveTextContent(THERMAL_REASON);
    expect(thermal).toHaveTextContent(WAIVED_ANNOTATED_PILL);
    expect(thermal).toHaveClass("prv-crit--waived");
    expect(within(thermal).getByText(WAIVED_ANNOTATED_PILL).closest(".ou-chip")).toHaveClass(
      "ou-chip--warn",
    );
  });

  it("links the waived pill to the host comment the waive posted, and says it leaves", () => {
    draw();

    const pill = within(row("Flake must not reappear across temperature range")).getByRole(
      "link",
      { name: new RegExp(WAIVED_ANNOTATED_PILL) },
    );

    expect(pill).toHaveAttribute("href", WAIVE_COMMENT_URL);
    expect(pill).toHaveAttribute("target", "_blank");
    expect(within(pill).getByRole("img", { name: OPENS_HOST })).toBeInTheDocument();
  });

  it("labels each row's provenance, and an extracted row as reserved", () => {
    draw(
      withClaims([
        criterion({ source: "plan" }),
        criterion({ id: criterionId(2), claim: "Second", source: "manual" }),
        criterion({ id: criterionId(3), claim: "Third", source: "extracted" }),
      ]),
    );

    expect(within(rows()[0]!).getByText("plan")).toBeInTheDocument();
    expect(within(rows()[1]!).getByText("manual")).toBeInTheDocument();
    expect(within(rows()[2]!).getByText("extracted · reserved")).toHaveAttribute(
      "title",
      expect.stringContaining("#372"),
    );
  });

  it("says so when no claim has been written", () => {
    draw(withClaims([]));

    expect(card()).toHaveTextContent(NO_CRITERIA);
    expect(within(card()).queryByRole("list")).toBeNull();
  });

  it("draws an unverified claim with no evidence as that, in words", () => {
    draw(withClaims([criterion()]));

    expect(rows()[0]).toHaveTextContent(UNVERIFIED_PILL);
    expect(rows()[0]).toHaveTextContent("no evidence cited");
  });

  it("keeps the matrix the PR's own when the strip scopes the gates to revision 1", () => {
    draw();

    fireEvent.click(screen.getByRole("button", { name: /Revision 1/ }));

    expect(rows()).toHaveLength(5);
    expect(card()).toHaveTextContent("4 verified · 1 waived · 0 unverified");
  });
});

describe("the evidence links", () => {
  it("lead a test and a measurement to their cited rows", () => {
    draw();

    expect(
      within(card()).getByRole("link", {
        name: "test_frame_order_under_load (10⁶ frames, 0 reordered)",
      }),
    ).toHaveAttribute("href", prEvidencePath(PR_514_ID, evidenceId(1), "dashboard"));
    expect(
      within(card()).getByRole("link", {
        name: "HIL overshoot 1.7% vs 2.0% limit (was 2.4% in rev 1)",
      }),
    ).toHaveAttribute("href", prEvidencePath(PR_514_ID, evidenceId(3), "dashboard"));
  });

  it("address a hunk to the changed files at its range, so it opens in a new tab too", () => {
    draw();

    const hunk = within(card()).getByRole("link", { name: "hunk telemetry_buf.c:41–66" });
    const [query, hash] = hunk.getAttribute("href")!.split("#");

    expect(hash).toBe(FILES_ID);
    expect(new URLSearchParams(query).get("hunk")).toBe(`${TELEMETRY_PATH}:41-66`);
    expect(hunk).toHaveAttribute(
      "title",
      `${TELEMETRY_PATH} · lines 41–66 · revision 2 · b7e41d0`,
    );
    expect(hunk).toHaveClass("prv-crit__ref--hunk");
  });

  it("bring the reader to the changed files at the range: the card, focus and the address", () => {
    draw();

    expect(slot()).not.toHaveTextContent("Cited:");

    fireEvent.click(within(card()).getByRole("link", { name: "hunk telemetry_buf.c:41–66" }));

    expect(slot()).toHaveAttribute("id", FILES_ID);
    expect(slot()).toHaveTextContent(
      citedLine({ path: TELEMETRY_PATH, lineStart: 41, lineEnd: 66 }),
    );
    expect(slot()).not.toHaveTextContent(HUNK_NOT_IN_SNAPSHOT);
    expect(slot()).toHaveFocus();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(new URLSearchParams(window.location.search).get("hunk")).toBe(
      `${TELEMETRY_PATH}:41-66`,
    );
    expect(new URLSearchParams(window.location.search).get("from")).toBe("dashboard");
  });

  it("leave a press that asks for a new tab to the browser", () => {
    draw();

    // jsdom cannot navigate: note whether the page claimed the press, then stop it there.
    let claimed: boolean | null = null;
    const observe = (event: MouseEvent): void => {
      claimed = event.defaultPrevented;
      event.preventDefault();
    };

    document.addEventListener("click", observe);
    fireEvent.click(within(card()).getByRole("link", { name: "hunk telemetry_buf.c:41–66" }), {
      ctrlKey: true,
    });
    document.removeEventListener("click", observe);

    expect(claimed).toBe(false);
    expect(slot()).not.toHaveTextContent("Cited:");
    expect(window.location.search).toBe("?from=dashboard");
  });

  it("draw the hunk the address cites on arrival", () => {
    draw(matrixPage(), { initialHunk: { path: TELEMETRY_PATH, lineStart: 41, lineEnd: 66 } });

    expect(slot()).toHaveTextContent(`Cited: ${TELEMETRY_PATH} · lines 41–66`);
  });

  it("say when the latest snapshot does not hold a cited path", () => {
    draw(matrixPage(), { initialHunk: { path: "src/removed.c", lineStart: 1, lineEnd: 2 } });

    expect(slot()).toHaveTextContent(HUNK_NOT_IN_SNAPSHOT);
  });

  it("link the whole diff on the host from the card", () => {
    draw();

    const link = within(slot()).getByRole("link", { name: new RegExp(FULL_DIFF_LINK) });

    expect(link).toHaveAttribute("href", `${HOST_URL}/files`);
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("open an analysis note in place, with the revision it was read on", () => {
    draw();

    const note = within(card()).getByRole("button", {
      name: "static K_MSGQ_DEFINE · stack analysis clean",
    });

    expect(note).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(note);

    expect(note).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(note.getAttribute("aria-controls")!)).toHaveTextContent(
      "Analysis note, read on revision 2 · b7e41d0 — the note is the evidence.",
    );

    fireEvent.click(note);

    expect(note).toHaveAttribute("aria-expanded", "false");
    expect(note).not.toHaveAttribute("aria-controls");
  });

  it("draw a test as plain text on a PR no loop opened", () => {
    draw(matrixPage({ pullRequest: { run: null } }));

    expect(
      within(card()).queryByRole("link", {
        name: "test_frame_order_under_load (10⁶ frames, 0 reordered)",
      }),
    ).toBeNull();
    expect(card()).toHaveTextContent("test_frame_order_under_load (10⁶ frames, 0 reordered)");
  });
});

describe("authoring", () => {
  it("adds a manual claim through the dialog, sent trimmed, and draws it from the answer", async () => {
    const added = criterion({ id: criterionId(6), claim: "Boot time stays under 2 s", sortOrder: 6 });
    const given = senders({
      addClaim: vi.fn<CriteriaSenders["addClaim"]>().mockResolvedValue({ ok: true, answer: added }),
    });

    draw(matrixPage(), { criteriaSenders: given });

    fireEvent.click(within(card()).getByRole("button", { name: ADD_CLAIM_LABEL }));

    const dialog = screen.getByRole("dialog", { name: CLAIM_TITLE });
    const confirm = within(dialog).getByRole("button", { name: CLAIM_CONFIRM });

    expect(confirm).toHaveAttribute("aria-disabled", "true");
    expect(confirm).toHaveAttribute("title", CLAIM_NEEDS_TEXT);

    fireEvent.click(confirm);
    expect(given.addClaim).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText(CLAIM_LABEL), {
      target: { value: "  Boot time stays under 2 s  " },
    });
    await act(async () => {
      fireEvent.click(confirm);
    });

    expect(given.addClaim).toHaveBeenCalledExactlyOnceWith(
      PR_514_ID,
      "Boot time stays under 2 s",
    );
    expect(screen.queryByRole("dialog", { name: CLAIM_TITLE })).toBeNull();
    expect(rows()).toHaveLength(6);
    expect(rows()[5]).toHaveTextContent("Boot time stays under 2 s");
    expect(within(rows()[5]!).getByText("manual")).toBeInTheDocument();
    expect(rows()[5]).toHaveTextContent(UNVERIFIED_PILL);
    expect(within(card()).getByRole("status")).toHaveTextContent(CLAIM_ADDED);
    expect(card()).toHaveTextContent("4 verified · 1 waived · 1 unverified");
  });

  it("keeps the dialog open on a refused claim, and says why there", async () => {
    const given = senders({
      addClaim: vi.fn<CriteriaSenders["addClaim"]>().mockResolvedValue({
        ok: false,
        status: 403,
        code: "forbidden",
        reason: "Only a member may do this.",
      }),
    });

    draw(matrixPage(), { criteriaSenders: given });

    fireEvent.click(within(card()).getByRole("button", { name: ADD_CLAIM_LABEL }));

    const dialog = screen.getByRole("dialog", { name: CLAIM_TITLE });

    fireEvent.change(within(dialog).getByLabelText(CLAIM_LABEL), { target: { value: "A claim" } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: CLAIM_CONFIRM }));
    });

    expect(within(dialog).getByRole("alert")).toHaveTextContent("Only a member may do this.");
    expect(rows()).toHaveLength(5);
  });

  it("sends nothing when the claim is cancelled", () => {
    const given = senders();

    draw(matrixPage(), { criteriaSenders: given });

    fireEvent.click(within(card()).getByRole("button", { name: ADD_CLAIM_LABEL }));
    fireEvent.click(screen.getByRole("button", { name: CLAIM_CANCEL }));

    expect(screen.queryByRole("dialog", { name: CLAIM_TITLE })).toBeNull();
    expect(given.addClaim).not.toHaveBeenCalled();
  });

  it("shows Import from plan only when planning context exists", () => {
    const { unmount } = draw(withClaims(mockupCriteria(), false));

    expect(within(card()).queryByRole("button", { name: IMPORT_LABEL })).toBeNull();

    unmount();
    draw(withClaims(mockupCriteria(), true));

    expect(within(card()).getByRole("button", { name: IMPORT_LABEL })).toBeInTheDocument();
  });

  it("imports the plan's claims, labels them plan, and says what became of it", async () => {
    const imported = [
      criterion({ id: criterionId(6), claim: "Frames in ISR order", source: "plan" }),
      criterion({ id: criterionId(7), claim: "No e-stop regression", source: "plan" }),
    ];
    const given = senders({
      importFromPlan: vi.fn<CriteriaSenders["importFromPlan"]>().mockResolvedValue({
        ok: true,
        answer: { draftId: "d", imported, alreadyPresent: ["x"], tooLong: [] },
      }),
    });

    draw(withClaims([], true), { criteriaSenders: given });

    await act(async () => {
      fireEvent.click(within(card()).getByRole("button", { name: IMPORT_LABEL }));
    });

    expect(given.importFromPlan).toHaveBeenCalledExactlyOnceWith(PR_514_ID);
    expect(rows()).toHaveLength(2);
    for (const each of rows()) expect(within(each).getByText("plan")).toBeInTheDocument();
    expect(within(card()).getByRole("status")).toHaveTextContent(
      "Imported 2 claims from the plan · 1 already present.",
    );
  });

  it("draws the service's refusal of an import on the card", async () => {
    const given = senders({
      importFromPlan: vi.fn<CriteriaSenders["importFromPlan"]>().mockResolvedValue({
        ok: false,
        status: 409,
        code: "plan_criteria_missing",
        reason: "The plan states no acceptance criteria.",
      }),
    });

    draw(withClaims([], true), { criteriaSenders: given });

    await act(async () => {
      fireEvent.click(within(card()).getByRole("button", { name: IMPORT_LABEL }));
    });

    expect(within(card()).getByRole("status")).toHaveTextContent(
      "The plan states no acceptance criteria.",
    );
    expect(within(card()).getByRole("status")).toHaveClass("prv-criteria__outcome--failed");
  });
});

describe("the evidence picker", () => {
  /**
   * Open the picker on the first claim and wait for its rows.
   *
   * @returns The dialog.
   */
  async function openPicker(): Promise<HTMLElement> {
    await act(async () => {
      fireEvent.click(within(rows()[0]!).getByRole("button", { name: ATTACH_LABEL }));
    });

    return screen.getByRole("dialog", { name: EVIDENCE_TITLE });
  }

  it("offers only the rows that exist for this run and revision", async () => {
    const given = senders();

    draw(withClaims([criterion()]), { criteriaSenders: given });

    const dialog = await openPicker();

    expect(given.readOptions).toHaveBeenCalledExactlyOnceWith(PR_514_ID);
    expect(dialog).toHaveTextContent("Telemetry frames must arrive in ISR order under load");
    expect(
      within(within(dialog).getByLabelText(TEST_LABEL)).getAllByRole("option").map((each) => each.textContent),
    ).toEqual(["Choose…", "telemetry integration · native_sim · test_frame_order_under_load"]);
    expect(dialog).toHaveTextContent("From attempt 4.");

    fireEvent.click(within(dialog).getByRole("radio", { name: "Measurement" }));
    expect(
      within(within(dialog).getByLabelText(MEASUREMENT_LABEL)).getAllByRole("option").map((each) => each.textContent),
    ).toEqual(["Choose…", "Motor overshoot on e-stop release · overshoot_pct 1.7 % (limit 2 %)"]);

    fireEvent.click(within(dialog).getByRole("radio", { name: "Hunk" }));
    expect(
      within(within(dialog).getByLabelText(PATH_LABEL)).getAllByRole("option").map((each) => each.textContent),
    ).toEqual([
      "Choose…",
      TELEMETRY_PATH,
      "drivers/can/telemetry_buf.h",
      "tests/integration/test_telemetry.c",
    ]);
  });

  it("offers no free-text reference: three typed kinds, and nothing else to cite by", async () => {
    draw(withClaims([criterion()]));

    const dialog = await openPicker();

    expect(within(dialog).getAllByRole("radio").map((each) => each.closest("label")!.textContent)).toEqual([
      "Test",
      "Measurement",
      "Hunk",
    ]);
    expect(within(dialog).getAllByRole("textbox").map((each) => each.id)).toEqual([
      within(dialog).getByLabelText(QUALIFIER_LABEL).id,
    ]);
  });

  it("says it is reading, and waits, until the rows arrive", async () => {
    const given = senders({
      readOptions: vi.fn<CriteriaSenders["readOptions"]>(() => new Promise(() => {})),
    });

    draw(withClaims([criterion()]), { criteriaSenders: given });

    const dialog = await openPicker();

    expect(within(dialog).getByRole("status")).toHaveTextContent(OPTIONS_READING);
    expect(within(dialog).getByRole("button", { name: ATTACH_LABEL })).toHaveAttribute(
      "title",
      OPTIONS_READING,
    );
  });

  it("attaches the chosen test with its qualifier, and draws the claim from the answer", async () => {
    const cited = criterion({
      evidence: [
        evidence({
          kind: "test_case",
          displayText: "test_frame_order_under_load (10⁶ frames, 0 reordered)",
          ref: { testCaseId: "case-1" },
        }),
      ],
    });
    const given = senders({
      attach: vi.fn<CriteriaSenders["attach"]>().mockResolvedValue({ ok: true, answer: cited }),
    });

    draw(withClaims([criterion()]), { criteriaSenders: given });

    const dialog = await openPicker();
    const confirm = within(dialog).getByRole("button", { name: ATTACH_LABEL });

    expect(confirm).toHaveAttribute("title", CHOOSE_TEST);
    fireEvent.click(confirm);
    expect(given.attach).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText(TEST_LABEL), { target: { value: "case-1" } });
    fireEvent.change(within(dialog).getByLabelText(QUALIFIER_LABEL), {
      target: { value: " 10⁶ frames, 0 reordered " },
    });
    await act(async () => {
      fireEvent.click(confirm);
    });

    expect(given.attach).toHaveBeenCalledExactlyOnceWith(PR_514_ID, criterionId(1), {
      kind: "test_case",
      caseKey: KEY,
      testRunId: ATTEMPT_4_ID,
      note: "10⁶ frames, 0 reordered",
    });
    expect(screen.queryByRole("dialog", { name: EVIDENCE_TITLE })).toBeNull();
    expect(rows()[0]).toHaveTextContent("test_frame_order_under_load (10⁶ frames, 0 reordered)");
    expect(within(card()).getByRole("status")).toHaveTextContent(EVIDENCE_ATTACHED);
  });

  it("attaches a hunk of a changed file, pinned to the snapshot's revision", async () => {
    const given = senders({
      attach: vi
        .fn<CriteriaSenders["attach"]>()
        .mockResolvedValue({ ok: true, answer: criterion() }),
    });

    draw(withClaims([criterion()]), { criteriaSenders: given });

    const dialog = await openPicker();

    fireEvent.click(within(dialog).getByRole("radio", { name: "Hunk" }));
    fireEvent.change(within(dialog).getByLabelText(PATH_LABEL), {
      target: { value: TELEMETRY_PATH },
    });
    fireEvent.change(within(dialog).getByLabelText("First line"), { target: { value: "41" } });
    fireEvent.change(within(dialog).getByLabelText("Last line"), { target: { value: "66" } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: ATTACH_LABEL }));
    });

    expect(given.attach).toHaveBeenCalledExactlyOnceWith(PR_514_ID, criterionId(1), {
      kind: "hunk",
      path: TELEMETRY_PATH,
      lineStart: 41,
      lineEnd: 66,
      revisionId: REV_2_ID,
    });
  });

  it("says why a kind has nothing to offer, and offers hunks regardless", async () => {
    const given = senders({
      readOptions: vi
        .fn<CriteriaSenders["readOptions"]>()
        .mockResolvedValue({ ok: true, answer: noOptions(NO_RUN_TO_CITE) }),
    });

    draw(withClaims([criterion()]), { criteriaSenders: given });

    const dialog = await openPicker();

    expect(dialog).toHaveTextContent(NO_RUN_TO_CITE);
    expect(within(dialog).queryByLabelText(TEST_LABEL)).toBeNull();
    expect(within(dialog).getByRole("button", { name: ATTACH_LABEL })).toHaveAttribute(
      "title",
      NO_RUN_TO_CITE,
    );

    fireEvent.click(within(dialog).getByRole("radio", { name: "Hunk" }));

    expect(within(dialog).getByLabelText(PATH_LABEL)).toBeInTheDocument();
  });

  it("offers no hunk when the latest revision has no files snapshot", async () => {
    draw(matrixPage({ criteria: matrix([criterion()]), files: null }));

    const dialog = await openPicker();

    fireEvent.click(within(dialog).getByRole("radio", { name: "Hunk" }));

    expect(dialog).toHaveTextContent(NO_FILES_TO_CITE);
    expect(within(dialog).queryByLabelText(PATH_LABEL)).toBeNull();
  });

  it("says why when the rows could not be read", async () => {
    const given = senders({
      readOptions: vi.fn<CriteriaSenders["readOptions"]>().mockResolvedValue({
        ok: false,
        status: 502,
        code: "pull_request_unreachable",
        reason: "The service did not answer.",
      }),
    });

    draw(withClaims([criterion()]), { criteriaSenders: given });

    const dialog = await openPicker();

    expect(dialog).toHaveTextContent("The service did not answer.");
    expect(within(dialog).getByRole("button", { name: ATTACH_LABEL })).toHaveAttribute(
      "title",
      "The service did not answer.",
    );

    // The hunks are the page's own, and are offered regardless.
    fireEvent.click(within(dialog).getByRole("radio", { name: "Hunk" }));

    expect(dialog).not.toHaveTextContent("The service did not answer.");
    expect(within(dialog).getByLabelText(PATH_LABEL)).toBeInTheDocument();
  });

  it("keeps the picker open on a refused citation, and says why there", async () => {
    const given = senders({
      attach: vi.fn<CriteriaSenders["attach"]>().mockResolvedValue({
        ok: false,
        status: 422,
        code: "evidence_unresolved",
        reason: "That test case does not resolve.",
      }),
    });

    draw(withClaims([criterion()]), { criteriaSenders: given });

    const dialog = await openPicker();

    fireEvent.change(within(dialog).getByLabelText(TEST_LABEL), { target: { value: "case-1" } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: ATTACH_LABEL }));
    });

    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "That test case does not resolve.",
    );
  });

  it("reads the rows again on every opening", async () => {
    const given = senders();

    draw(withClaims([criterion()]), { criteriaSenders: given });

    const dialog = await openPicker();
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep on this page" }));
    await openPicker();

    expect(given.readOptions).toHaveBeenCalledTimes(2);
  });
});

describe("Verify", () => {
  it("is unavailable with no evidence, and shows the reason", () => {
    const given = senders();

    draw(withClaims([criterion()]), { criteriaSenders: given });

    const verify = within(rows()[0]!).getByRole("button", { name: VERIFY_LABEL });

    expect(verify).toHaveAttribute("aria-disabled", "true");
    expect(verify).toHaveAttribute("title", VERIFY_NEEDS_EVIDENCE);
    expect(rows()[0]).toHaveTextContent(VERIFY_NEEDS_EVIDENCE);

    fireEvent.click(verify);

    expect(given.verify).not.toHaveBeenCalled();
  });

  it("verifies a claim with evidence, and draws the pill from the answer", async () => {
    const cited = criterion({ evidence: [evidence()] });
    const given = senders({
      verify: vi
        .fn<CriteriaSenders["verify"]>()
        .mockResolvedValue({ ok: true, answer: { ...cited, status: "verified" } }),
    });

    draw(withClaims([cited]), { criteriaSenders: given });

    const verify = within(rows()[0]!).getByRole("button", { name: VERIFY_LABEL });

    expect(verify).not.toHaveAttribute("aria-disabled", "true");
    expect(rows()[0]).not.toHaveTextContent(VERIFY_NEEDS_EVIDENCE);

    await act(async () => {
      fireEvent.click(verify);
    });

    expect(given.verify).toHaveBeenCalledExactlyOnceWith(PR_514_ID, criterionId(1));
    expect(rows()[0]).toHaveTextContent(VERIFIED_PILL);
    expect(within(rows()[0]!).queryByRole("button", { name: VERIFY_LABEL })).toBeNull();
    expect(within(card()).getByRole("status")).toHaveTextContent(CLAIM_VERIFIED);
  });

  it("draws the service's refusal on the card, and leaves the claim unverified", async () => {
    const given = senders({
      verify: vi.fn<CriteriaSenders["verify"]>().mockResolvedValue({
        ok: false,
        status: 409,
        code: "criterion_evidence_required",
        reason: "A claim is verified by its evidence.",
      }),
    });

    draw(withClaims([criterion({ evidence: [evidence()] })]), { criteriaSenders: given });

    await act(async () => {
      fireEvent.click(within(rows()[0]!).getByRole("button", { name: VERIFY_LABEL }));
    });

    expect(within(card()).getByRole("status")).toHaveTextContent(
      "A claim is verified by its evidence.",
    );
    expect(rows()[0]).toHaveTextContent(UNVERIFIED_PILL);
  });

  it("makes every button wait while a change is in flight", async () => {
    let answer: (value: Awaited<ReturnType<CriteriaSenders["verify"]>>) => void = () => {};
    const given = senders({
      verify: vi.fn<CriteriaSenders["verify"]>(
        () =>
          new Promise((resolve) => {
            answer = resolve;
          }),
      ),
    });
    const cited = criterion({ evidence: [evidence()] });

    draw(withClaims([cited]), { criteriaSenders: given });

    fireEvent.click(within(rows()[0]!).getByRole("button", { name: VERIFY_LABEL }));

    // Every control that acts — the analysis note's disclosure changes nothing, and stays.
    const acting = within(card())
      .getAllByRole("button")
      .filter((button) => button.classList.contains("ou-btn"));

    expect(acting.length).toBeGreaterThan(0);
    for (const button of acting) expect(button).toHaveAttribute("title", CRITERIA_SENDING);

    fireEvent.click(within(rows()[0]!).getByRole("button", { name: VERIFY_LABEL }));
    expect(given.verify).toHaveBeenCalledTimes(1);

    await act(async () => {
      answer({ ok: true, answer: { ...cited, status: "verified" } });
    });

    expect(within(card()).getByRole("button", { name: ADD_CLAIM_LABEL })).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });
});

describe("the waive dialog", () => {
  /** What a first waive answers. */
  const WAIVED = criterion({ status: "waived", waiver: waiver() });

  it("asks for the reason first, posts the annotation, and links the pill to the host comment", async () => {
    const given = senders({
      waive: vi.fn<CriteriaSenders["waive"]>().mockResolvedValue({
        ok: true,
        answer: {
          criterion: WAIVED,
          annotation: { state: "annotated", mode: "created", error: null },
        },
      }),
    });

    draw(withClaims([criterion()]), { criteriaSenders: given });

    fireEvent.click(within(rows()[0]!).getByRole("button", { name: WAIVE_LABEL }));

    const dialog = screen.getByRole("dialog", { name: WAIVE_TITLE });
    const confirm = within(dialog).getByRole("button", { name: WAIVE_CONFIRM });

    expect(dialog).toHaveTextContent("Telemetry frames must arrive in ISR order under load");
    expect(dialog).toHaveTextContent(WAIVE_CONSEQUENCE);
    expect(confirm).toHaveAttribute("aria-disabled", "true");
    expect(confirm).toHaveAttribute("title", WAIVE_NEEDS_REASON);

    fireEvent.click(confirm);
    fireEvent.change(within(dialog).getByLabelText(WAIVE_REASON_LABEL), {
      target: { value: "   " },
    });
    fireEvent.click(confirm);
    expect(given.waive).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText(WAIVE_REASON_LABEL), {
      target: { value: `  ${THERMAL_REASON}  ` },
    });
    await act(async () => {
      fireEvent.click(confirm);
    });

    expect(given.waive).toHaveBeenCalledExactlyOnceWith(PR_514_ID, criterionId(1), THERMAL_REASON);
    expect(screen.queryByRole("dialog", { name: WAIVE_TITLE })).toBeNull();
    expect(rows()[0]).toHaveTextContent(THERMAL_REASON);
    expect(rows()[0]).toHaveClass("prv-crit--waived");
    expect(
      within(rows()[0]!).getByRole("link", { name: new RegExp(WAIVED_ANNOTATED_PILL) }),
    ).toHaveAttribute("href", WAIVE_COMMENT_URL);
    expect(within(card()).getByRole("status")).toHaveTextContent(ANNOTATED.created);
  });

  it("re-waives onto the same comment: says so before, and that no second comment was posted after", async () => {
    const given = senders({
      waive: vi.fn<CriteriaSenders["waive"]>().mockResolvedValue({
        ok: true,
        answer: {
          criterion: WAIVED,
          annotation: { state: "annotated", mode: "edited", error: null },
        },
      }),
    });

    draw(withClaims([WAIVED]), { criteriaSenders: given });

    fireEvent.click(within(rows()[0]!).getByRole("button", { name: WAIVE_AGAIN_LABEL }));

    const dialog = screen.getByRole("dialog", { name: WAIVE_TITLE });

    expect(dialog).toHaveTextContent(WAIVE_AGAIN_CONSEQUENCE);

    fireEvent.change(within(dialog).getByLabelText(WAIVE_REASON_LABEL), {
      target: { value: "chamber booked for October" },
    });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: WAIVE_CONFIRM }));
    });

    expect(within(card()).getByRole("status")).toHaveTextContent(ANNOTATED.edited);
    expect(within(card()).getByRole("status")).toHaveTextContent("no second comment");
    expect(
      within(rows()[0]!).getAllByRole("link", { name: new RegExp(WAIVED_ANNOTATED_PILL) }),
    ).toHaveLength(1);
  });

  it("says when the host refused the annotation — waived, not annotated, no link", async () => {
    const refused = criterion({
      status: "waived",
      waiver: waiver({ state: "failed", url: null, commentId: null, annotatedAt: null }),
    });
    const given = senders({
      waive: vi.fn<CriteriaSenders["waive"]>().mockResolvedValue({
        ok: true,
        answer: {
          criterion: refused,
          annotation: {
            state: "failed",
            mode: null,
            error: { code: "host_permission", message: "the token cannot comment here" },
          },
        },
      }),
    });

    draw(withClaims([criterion()]), { criteriaSenders: given });

    fireEvent.click(within(rows()[0]!).getByRole("button", { name: WAIVE_LABEL }));

    const dialog = screen.getByRole("dialog", { name: WAIVE_TITLE });

    fireEvent.change(within(dialog).getByLabelText(WAIVE_REASON_LABEL), {
      target: { value: "why" },
    });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: WAIVE_CONFIRM }));
    });

    expect(rows()[0]).toHaveTextContent(WAIVED_FAILED_PILL);
    expect(rows()[0]).toHaveTextContent(ANNOTATION_FAILED_NOTE);
    expect(within(rows()[0]!).queryByRole("link")).toBeNull();
    expect(within(rows()[0]!).getByRole("button", { name: WAIVE_AGAIN_LABEL })).toBeInTheDocument();
    expect(within(card()).getByRole("status")).toHaveTextContent("the token cannot comment here");
    expect(within(card()).getByRole("status")).toHaveClass("prv-criteria__outcome--failed");
  });

  it("keeps the dialog open on a refused waive, and says why there", async () => {
    const given = senders({
      waive: vi.fn<CriteriaSenders["waive"]>().mockResolvedValue({
        ok: false,
        status: 409,
        code: "criterion_waiver_needs_run",
        reason: "A waiver belongs to a run, and no loop opened this PR.",
      }),
    });

    draw(withClaims([criterion()]), { criteriaSenders: given });

    fireEvent.click(within(rows()[0]!).getByRole("button", { name: WAIVE_LABEL }));

    const dialog = screen.getByRole("dialog", { name: WAIVE_TITLE });

    fireEvent.change(within(dialog).getByLabelText(WAIVE_REASON_LABEL), {
      target: { value: "why" },
    });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: WAIVE_CONFIRM }));
    });

    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "A waiver belongs to a run, and no loop opened this PR.",
    );
    expect(rows()[0]).toHaveTextContent(UNVERIFIED_PILL);
  });
});

describe("roles", () => {
  it("draws a member everything but Waive", () => {
    draw(withClaims([criterion()], true), { mayWaive: false });

    expect(within(card()).getByRole("button", { name: ADD_CLAIM_LABEL })).toBeInTheDocument();
    expect(within(card()).getByRole("button", { name: IMPORT_LABEL })).toBeInTheDocument();
    expect(within(rows()[0]!).getByRole("button", { name: ATTACH_LABEL })).toBeInTheDocument();
    expect(within(rows()[0]!).getByRole("button", { name: VERIFY_LABEL })).toBeInTheDocument();
    expect(within(rows()[0]!).queryByRole("button", { name: WAIVE_LABEL })).toBeNull();
  });

  it("draws a viewer the matrix, its links, and no control", () => {
    draw(withClaims(mockupCriteria(), true), { mayContribute: false, mayWaive: false });

    expect(rows()).toHaveLength(5);
    expect(within(card()).getAllByRole("link").length).toBeGreaterThan(0);
    // The analysis notes are disclosures, not actions: a viewer may still open them.
    expect(within(card()).getAllByRole("button").map((each) => each.textContent)).toEqual([
      "test asserts on seq gaps, not sleep-based",
      "static K_MSGQ_DEFINE · stack analysis clean",
    ]);
  });
});

describe("the poll", () => {
  it("gives an answer way to a read made after it", async () => {
    const cited = criterion({ evidence: [evidence()] });
    const polled = withClaims([{ ...cited, claim: "Reworded on the service", status: "verified" }]);
    let answer: () => void = () => {};
    const poll: PrPollOptions = {
      visible: () => true,
      now: () => 2_000,
      read: () =>
        new Promise((resolve) => {
          answer = () =>
            resolve({ state: "fresh", payload: polled, etag: null, pollAfterSeconds: null });
        }),
    };
    const given = senders({
      verify: vi
        .fn<CriteriaSenders["verify"]>()
        .mockResolvedValue({ ok: true, answer: { ...cited, status: "verified" } }),
    });

    draw(withClaims([cited]), { criteriaSenders: given, poll });

    await act(async () => {
      fireEvent.click(within(rows()[0]!).getByRole("button", { name: VERIFY_LABEL }));
    });

    expect(rows()[0]).toHaveTextContent("Telemetry frames must arrive in ISR order under load");

    await act(async () => {
      answer();
    });

    expect(rows()[0]).toHaveTextContent("Reworded on the service");
  });
});
