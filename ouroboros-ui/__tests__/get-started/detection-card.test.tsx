import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RepoDetection } from "@/app/api/detection";
import type { DetectionPollOptions } from "@/app/get-started/detection-poll";
import {
  CONVENTIONS_LINE,
  LEGACY_CONVENTIONS_LINE,
  NEVER_SCANNED_TITLE,
  PARTIAL_LINE,
  PROTECTED_ADMIN_REASON,
  PROTECTED_SAVED,
  RESCAN_VIEWER_REASON,
} from "@/app/get-started/detection-view";
import { GLOB_PROBLEMS } from "@/app/globs/glob";
import type { PollAnswer } from "@/app/poll";

import { maskIds, renderInBothPalettes } from "../helpers/palettes";
import { settle } from "../helpers/settle";
import { REPO, cardRow, scanProgress, seededCard } from "../helpers/onboarding";

/**
 * The *"We already figured this out"* card (BC.2, #391, mockup 13): rows that show their evidence
 * and say whether they were detected or measured, a debounced re-scan that keeps the stored rows
 * until the new scan lands, the protected-paths editor with its consequence and validation, and
 * the never-scanned, first-scan, partial and failed states.
 */

const rescanRepository = vi.fn();
const saveProtectedPaths = vi.fn();
const previewProtectedPaths = vi.fn();

vi.mock("@/app/get-started/actions", () => ({
  rescanRepository: (repo: string) => rescanRepository(repo),
  saveProtectedPaths: (repo: string, globs: readonly string[]) => saveProtectedPaths(repo, globs),
  previewProtectedPaths: (repo: string, globs: readonly string[]) => previewProtectedPaths(repo, globs),
}));

const { DetectionCard } = await import("@/app/get-started/detection-card");

/** What the poll answers next; null never answers. */
let answer: PollAnswer<RepoDetection> | null = null;

const POLL: DetectionPollOptions = {
  read: () => (answer === null ? new Promise(() => {}) : Promise.resolve(answer)),
  visible: () => true,
};

const OWNER = { contribute: true, administer: true };
const MEMBER = { contribute: true, administer: false };
const VIEWER = { contribute: false, administer: false };

/** The fixture clock: a minute after the fixture scan's progress started. */
const NOW = Date.parse(scanProgress().startedAt) + 60_000;

/**
 * The card over a first read.
 *
 * @param initial The first paint's detection.
 * @param abilities What the person may do.
 * @param now The clock.
 * @returns The render.
 */
function card(initial: RepoDetection = seededCard(), abilities = OWNER, now: () => number = () => NOW) {
  return render(
    <DetectionCard abilities={abilities} initial={{ ok: true, value: initial }} now={now} poll={POLL} repo={REPO} stepDone />,
  );
}

/** The card's region. */
const region = () => screen.getByRole("region", { name: "We already figured this out" });

/** The rows' list. */
const rows = () => within(region()).getByRole("list", { name: "We already figured this out" });

/** One row, by its label. */
const row = (label: string) =>
  within(rows())
    .getAllByRole("listitem")
    .find((item) => item.querySelector(".detect-row__label")?.textContent?.endsWith(label))!;

/** A fresh poll answer. */
function fresh(payload: RepoDetection): PollAnswer<RepoDetection> {
  return { state: "fresh", payload, etag: null, pollAfterSeconds: null };
}

beforeEach(() => {
  answer = null;
  for (const mock of [rescanRepository, saveProtectedPaths, previewProtectedPaths]) mock.mockReset();
  previewProtectedPaths.mockResolvedValue({ ok: true, repositories: [] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the seeded card", () => {
  it("matches the mockup: the step tag, the real duration and six rows", () => {
    card();

    expect(within(region()).getByRole("heading", { level: 2 })).toHaveTextContent("We already figured this out");
    expect(within(region()).getByText("✓ step 2 done")).toBeInTheDocument();
    expect(within(region()).getByText("scanned in 38s")).toBeInTheDocument();
    expect(
      within(rows())
        .getAllByRole("listitem")
        .map((item) => item.querySelector(".detect-row__label")!.textContent),
    ).toEqual([
      "found: Language",
      "found: Build",
      "found: Devcontainer",
      "found: Tests",
      "found: Protected paths",
      "needs attention: Conventions",
    ]);
  });

  it("splits each value's dim parenthetical off its claim", () => {
    card();

    const build = row("Build");
    expect(build.querySelector(".detect-row__value")).toHaveTextContent("west + twister (found west.yml)");
    expect(build.querySelector(".detect-row__affix")).toHaveTextContent("(found west.yml)");
  });

  it("labels every row detected — the devcontainer row makes no snapshot or timing claim", () => {
    card();

    for (const item of within(rows()).getAllByRole("listitem")) {
      expect(within(item).getByText("detected")).toBeInTheDocument();
    }
    expect(region()).not.toHaveTextContent(/snapshotted|env ready|ready in/);
  });

  it("chips a measured row as measured", () => {
    card(seededCard({ rows: [cardRow({ rowKey: "tests", value: "5 suites, 71 tests", label: "measured" })] }));

    expect(within(row("Tests")).getByText("measured")).toHaveClass("ou-chip--ok");
  });

  it("phrases conventions as a future capability, and points at the knowledge roadmap", () => {
    card(seededCard({ rows: [cardRow({ rowKey: "conventions", verdict: "warn", value: LEGACY_CONVENTIONS_LINE })] }));

    const conventions = row("Conventions");
    expect(conventions).toHaveTextContent(CONVENTIONS_LINE);
    expect(conventions).not.toHaveTextContent("we'll learn");
    expect(within(conventions).getByRole("link", { name: "knowledge roadmap →" })).toHaveAttribute("href", "/knowledge");
  });

  it("renders the duration from the scan, not a constant", () => {
    card(seededCard({ scan: { ...seededCard().scan!, durationMs: 72_400 } }));

    expect(within(region()).getByText("scanned in 1m 12s")).toBeInTheDocument();
  });

  it("draws no step tag until step 2 is done", () => {
    render(<DetectionCard abilities={OWNER} initial={{ ok: true, value: seededCard() }} poll={POLL} repo={REPO} stepDone={false} />);

    expect(within(region()).queryByText("✓ step 2 done")).toBeNull();
  });
});

describe("a row's evidence", () => {
  it("is reachable by keyboard, lists the probe hits, and Escape gives the focus back", async () => {
    card();

    const toggle = within(row("Language")).getByRole("button", { name: "Evidence for Language" });
    toggle.focus();
    expect(toggle).toHaveFocus();
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);

    const panel = within(row("Language")).getByRole("group", { name: "Evidence for Language" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAttribute("aria-controls", panel.id);
    expect(within(panel).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Read the repository's language breakdown",
      "Listed the repository's file tree",
      "Read west.yml",
    ]);
    expect(panel).toHaveTextContent("rule pack language 1.0.0 · high confidence");

    // The reader moved on inside the card; Escape still brings them back to the row's control.
    within(row("Build")).getByRole("button", { name: "Evidence for Build" }).focus();
    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(within(row("Language")).queryByRole("group")).toBeNull());
    expect(toggle).toHaveFocus();
  });

  it("names what was found, and closes on a press outside", () => {
    card();

    fireEvent.click(within(row("Build")).getByRole("button", { name: "Evidence for Build" }));
    expect(within(row("Build")).getByRole("group")).toHaveTextContent("Found west.yml");

    fireEvent.mouseDown(document.body);
    expect(within(row("Build")).queryByRole("group")).toBeNull();
  });

  it("is a control on every row", () => {
    card();

    expect(within(region()).getAllByRole("button", { name: /^Evidence for / })).toHaveLength(6);
  });
});

describe("re-scanning", () => {
  it("shows progress, keeps the stored rows until the new scan lands, then shows its duration", async () => {
    rescanRepository.mockResolvedValue({ ok: true, value: { progress: scanProgress(), joined: false } });
    card();

    fireEvent.click(within(region()).getByRole("button", { name: "Re-scan" }));

    await waitFor(() => expect(rescanRepository).toHaveBeenCalledWith(REPO));
    expect(await within(region()).findByRole("progressbar", { name: "Scan progress" })).toBeInTheDocument();
    expect(within(region()).getByText("Scanning — 4 of 9 probes settled…")).toBeInTheDocument();
    // The previous scan's values stay on screen while the new one runs.
    expect(row("Build")).toHaveTextContent("west + twister");
    expect(within(region()).getByText("scanned in 38s")).toBeInTheDocument();
    expect(within(region()).getByRole("button", { name: "Scanning…" })).toHaveAttribute("aria-disabled", "true");

    answer = fresh(
      seededCard({
        scan: { ...seededCard().scan!, scanSeq: 2, durationMs: 21_000, scannedAt: "2026-10-05T12:00:21.000Z" },
        rows: [cardRow({ rowKey: "build", value: "cmake (found CMakeLists.txt)" })],
        progress: scanProgress({ state: "done", scanSeq: 2, probesSettled: 9, finishedAt: "2026-10-05T12:00:21.000Z" }),
      }),
    );
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await settle();
    });

    await waitFor(() => expect(row("Build")).toHaveTextContent("cmake"));
    expect(within(region()).getByText("scanned in 21s")).toBeInTheDocument();
    expect(within(region()).queryByRole("progressbar")).toBeNull();
  });

  it("is debounced: right after a scan the button says how long to wait, and counts down", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "setTimeout"] });
    let now = Date.parse(scanProgress().startedAt) + 10_000;
    card(seededCard({ progress: scanProgress({ state: "done", scanSeq: 2 }) }), OWNER, () => now);

    await act(async () => {
      vi.advanceTimersByTime(1);
    });

    const button = within(region()).getByRole("button", { name: "Re-scan" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAccessibleDescription("Scanned a moment ago — re-scan in 20s.");

    now += 5_000;
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(button).toHaveAccessibleDescription("Scanned a moment ago — re-scan in 15s.");

    fireEvent.click(button);
    expect(rescanRepository).not.toHaveBeenCalled();

    now += 20_000;
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(button).not.toHaveAttribute("aria-disabled");
  });

  it("presses once however often it is clicked while asking", async () => {
    rescanRepository.mockReturnValue(new Promise(() => {}));
    card();

    const button = within(region()).getByRole("button", { name: "Re-scan" });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    expect(rescanRepository).toHaveBeenCalledTimes(1);
  });

  it("says why when the service refuses, in its words", async () => {
    rescanRepository.mockResolvedValue({ ok: false, reason: "No connected source covers acme-robotics/helios-firmware." });
    card();

    fireEvent.click(within(region()).getByRole("button", { name: "Re-scan" }));

    expect(await within(region()).findByRole("alert")).toHaveTextContent("No connected source covers");
  });

  it("is held for a viewer, with the reason", () => {
    card(seededCard(), VIEWER);

    const button = within(region()).getByRole("button", { name: "Re-scan" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAccessibleDescription(RESCAN_VIEWER_REASON);
  });
});

describe("the protected-paths editor", () => {
  /** Open the editor from the row. */
  function openEditor() {
    fireEvent.click(within(row("Protected paths")).getByRole("button", { name: "edit" }));

    return within(row("Protected paths")).getByRole("group", { name: "Protected path patterns" });
  }

  it("summarises the stored list as the mockup does", () => {
    card();

    expect(row("Protected paths")).toHaveTextContent("boot/, keys/ suggested · edit");
  });

  it("opens inline with the consequence stated", () => {
    card();

    const editor = openEditor();

    expect(editor).toHaveTextContent("These paths are refused by run guardrails");
    expect(editor).toHaveAccessibleDescription(/These paths are refused by run guardrails/);
    expect(within(editor).getByRole("list", { name: "Protected path patterns" })).toHaveTextContent("boot/**");
    expect(within(editor).getByRole("button", { name: "Save protected paths" })).toHaveAccessibleDescription(
      "Nothing changed yet.",
    );
  });

  it("rejects an invalid glob with the designed error, and never adds it", () => {
    card();
    const editor = openEditor();

    fireEvent.change(within(editor).getByLabelText("Add a path pattern"), { target: { value: "/etc/**" } });
    fireEvent.click(within(editor).getByRole("button", { name: "Add" }));

    expect(within(editor).getByText(GLOB_PROBLEMS.absolute)).toBeInTheDocument();
    expect(within(editor).getByRole("list", { name: "Protected path patterns" })).not.toHaveTextContent("/etc/**");

    fireEvent.change(within(editor).getByLabelText("Add a path pattern"), { target: { value: "../keys/**" } });
    fireEvent.click(within(editor).getByRole("button", { name: "Add" }));
    expect(within(editor).getByText(GLOB_PROBLEMS.parent)).toBeInTheDocument();
  });

  it("saves the whole list, says it is saved, and shows the stored list as edited", async () => {
    saveProtectedPaths.mockResolvedValue({
      ok: true,
      value: seededCard({
        protectedPaths: [
          { glob: "boot/**", source: "edited" },
          { glob: "firmware/keys/**", source: "edited" },
          { glob: "keys/**", source: "edited" },
        ],
      }),
    });
    card();
    const editor = openEditor();

    fireEvent.change(within(editor).getByLabelText("Add a path pattern"), { target: { value: "firmware/keys/**" } });
    fireEvent.click(within(editor).getByRole("button", { name: "Add" }));
    fireEvent.click(within(editor).getByRole("button", { name: "Save protected paths" }));

    await waitFor(() =>
      expect(saveProtectedPaths).toHaveBeenCalledWith(REPO, ["boot/**", "keys/**", "firmware/keys/**"]),
    );
    expect(await within(row("Protected paths")).findByRole("status")).toHaveTextContent(PROTECTED_SAVED);
    expect(row("Protected paths")).toHaveTextContent("boot/, firmware/keys/, keys/ edited");
    expect(within(row("Protected paths")).queryByRole("group", { name: "Protected path patterns" })).toBeNull();
  });

  it("previews what the list matches in this repository", async () => {
    card();
    openEditor();

    await waitFor(() => expect(previewProtectedPaths).toHaveBeenCalledWith(REPO, ["boot/**", "keys/**"]));
  });

  it("keeps the draft and says why when the save is refused", async () => {
    saveProtectedPaths.mockResolvedValue({ ok: false, reason: "Only owners and admins may do this." });
    card();
    const editor = openEditor();

    fireEvent.click(within(editor).getByRole("button", { name: "Remove keys/**" }));
    fireEvent.click(within(editor).getByRole("button", { name: "Save protected paths" }));

    expect(await within(row("Protected paths")).findByRole("alert")).toHaveTextContent("Only owners and admins may do this.");
    expect(saveProtectedPaths).toHaveBeenCalledWith(REPO, ["boot/**"]);
    expect(within(row("Protected paths")).getByRole("group", { name: "Protected path patterns" })).toBeInTheDocument();
  });

  it("cancels without saving", () => {
    card();
    const editor = openEditor();

    fireEvent.click(within(editor).getByRole("button", { name: "Cancel" }));

    expect(within(row("Protected paths")).queryByRole("group", { name: "Protected path patterns" })).toBeNull();
    expect(saveProtectedPaths).not.toHaveBeenCalled();
  });

  it("is an owner's or admin's — a member sees the list and why they cannot edit it", () => {
    card(seededCard(), MEMBER);

    const edit = within(row("Protected paths")).getByRole("button", { name: "edit" });
    expect(edit).toHaveAttribute("aria-disabled", "true");
    expect(edit).toHaveAccessibleDescription(PROTECTED_ADMIN_REASON);

    fireEvent.click(edit);
    expect(within(row("Protected paths")).queryByRole("group", { name: "Protected path patterns" })).toBeNull();
  });

  it("has a row of its own when the scan stored none", () => {
    card(seededCard({ rows: [cardRow({ rowKey: "build", value: "make" })] }));

    expect(row("Protected paths")).toHaveTextContent("boot/, keys/ suggested · edit");
  });
});

describe("the card's states", () => {
  it("says what a scan does before the first one, with a button to run it", async () => {
    rescanRepository.mockResolvedValue({ ok: true, value: { progress: scanProgress(), joined: false } });
    card(seededCard({ scan: null, rows: [], protectedPaths: [] }));

    expect(within(region()).getByRole("heading", { level: 3 })).toHaveTextContent(NEVER_SCANNED_TITLE);
    expect(within(region()).queryByText(/scanned in/)).toBeNull();
    expect(within(region()).queryByRole("list")).toBeNull();

    fireEvent.click(within(region()).getByRole("button", { name: "Scan this repository" }));

    await waitFor(() => expect(rescanRepository).toHaveBeenCalledWith(REPO));
    expect(await within(region()).findByRole("progressbar", { name: "Scan progress" })).toBeInTheDocument();
    expect(within(region()).queryByRole("heading", { level: 3 })).toBeNull();
  });

  it("shows the first scan's progress, and no rows yet", () => {
    card(seededCard({ scan: null, rows: [], protectedPaths: [], progress: scanProgress({ probesPlanned: 0, probesSettled: 0 }) }));

    expect(within(region()).getByText("Scanning — planning probes…")).toBeInTheDocument();
    expect(within(region()).queryByRole("list")).toBeNull();
  });

  it("marks undetermined rows on a partial scan rather than hiding them", () => {
    card(
      seededCard({
        rows: [
          ...seededCard().rows.filter((one) => one.rowKey !== "tests"),
          cardRow({
            rowKey: "tests",
            verdict: "warn",
            determined: false,
            confidence: "low",
            value: "Could not determine — the scan's probe budget ran out",
            evidence: { undetermined: true, unfinished: [{ probe: "file:tests/a.c", status: "skipped", reason: "budget" }], probes: ["tree"] },
          }),
        ],
      }),
    );

    expect(within(region()).getByText(PARTIAL_LINE)).toBeInTheDocument();
    const tests = row("Tests");
    expect(tests).toHaveClass("detect-row--undetermined");
    expect(tests.querySelector(".detect-row__label")).toHaveTextContent("undetermined: Tests");
    expect(within(tests).getByText("undetermined")).toBeInTheDocument();
    expect(tests).toHaveTextContent("Could not determine — the scan's probe budget ran out");

    fireEvent.click(within(tests).getByRole("button", { name: "Evidence for Tests" }));
    expect(within(tests).getByRole("list", { name: "Did not finish" })).toHaveTextContent("Read tests/a.c — skipped, budget");
  });

  it("says why a scan failed, and offers to retry", async () => {
    rescanRepository.mockResolvedValue({ ok: true, value: { progress: scanProgress({ startedAt: new Date(NOW).toISOString() }), joined: false } });
    card(
      seededCard({
        scan: null,
        rows: [],
        progress: scanProgress({ state: "failed", error: "GitHub rate-limited the scan." }),
      }),
    );

    expect(within(region()).getByRole("alert")).toHaveTextContent("The scan failed: GitHub rate-limited the scan.");

    fireEvent.click(within(region()).getByRole("button", { name: "Retry the scan" }));

    await waitFor(() => expect(rescanRepository).toHaveBeenCalledWith(REPO));
    await waitFor(() => expect(within(region()).queryByRole("alert")).toBeNull());
  });

  it("says why the card could not be read", () => {
    render(
      <DetectionCard abilities={OWNER} initial={{ ok: false, reason: "Detection is busy." }} poll={POLL} repo={REPO} stepDone />,
    );

    expect(within(region()).getByRole("alert")).toHaveTextContent("Detection is busy.");
  });
});

describe("both palettes", () => {
  it("draws the same card in light and dark — the hues are the tokens'", () => {
    const [light, dark] = renderInBothPalettes(
      <DetectionCard abilities={OWNER} initial={{ ok: true, value: seededCard() }} now={() => NOW} poll={POLL} repo={REPO} stepDone />,
    );

    expect(maskIds(light!)).toBe(maskIds(dark!));
    expect(light).toContain("detect-row--warn");
  });
});
