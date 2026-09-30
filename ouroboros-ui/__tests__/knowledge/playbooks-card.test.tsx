import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PlaybookList } from "@/app/api/playbooks";
import type { Reading } from "@/app/api/reading";
import {
  CANDIDATE_REASONS,
  CHOOSE_RUN,
  CREATE_ADMIN_REASON,
  CREATE_SUBMIT,
  DESCRIPTION_LABEL,
  LABELS_LABEL,
  LAUNCH_VIEWER_REASON,
  NAME_LABEL,
  NAME_TAKEN,
  NEW_PLAYBOOK,
  NEW_PLAYBOOK_TITLE,
  NO_PLAYBOOKS_TITLE,
  NO_RUNS,
  PICKER_EMPTY,
  PICKER_SEARCH,
  PICKER_SEARCH_LABEL,
  PLAYBOOKS_UNREAD_TITLE,
  RUN_COUNT_NOTE,
  createdToast,
  launchName,
  pickerTitle,
  receiptText,
  receiptToast,
} from "@/app/knowledge/playbooks";

import { SEEDED_COMPLETIONS } from "../helpers/dashboard";
import {
  READ_AT,
  candidate,
  launchReceipt,
  mixedCandidates,
  playbook,
  playbookDraft,
  seededPlaybook,
  seededPlaybooks,
  seededSkills,
} from "../helpers/knowledge";
import { maskIds, renderInBothPalettes } from "../helpers/palettes";

/**
 * Mockup 14's playbooks card as it is drawn (#420): the three seeded rows with their counted
 * `run 9×` in both palettes, the safety-ranked picker behind **Run on issue… ▾** with each row's
 * reason, a launch's receipt and the honest queued note beside the count, the two-step
 * create-from-run dialog showing what the seeded run captured before saving, a viewer's and a
 * member's inert actions, and the empty and unread states.
 */

const listPlaybookIssues = vi.fn();
const launchPlaybook = vi.fn();
const listRecentRuns = vi.fn();
const draftPlaybook = vi.fn();
const createPlaybookFromRun = vi.fn();
const refresh = vi.fn();

vi.mock("@/app/knowledge/playbooks-actions", () => ({
  listPlaybookIssues: (id: string, q?: string) => listPlaybookIssues(id, q),
  launchPlaybook: (id: string, issueId: string) => launchPlaybook(id, issueId),
  listRecentRuns: () => listRecentRuns(),
  draftPlaybook: (runId: string) => draftPlaybook(runId),
  createPlaybookFromRun: (body: unknown) => createPlaybookFromRun(body),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
}));

const { PlaybooksCard } = await import("@/app/knowledge/playbooks-card");

/**
 * Draw the card.
 *
 * @param over Props to replace.
 * @returns The render result, and the toast spy.
 */
function draw(over: Partial<{ playbooks: Reading<PlaybookList>; mayLaunch: boolean; mayAdminister: boolean }> = {}) {
  const onToast = vi.fn();
  const result = render(
    <PlaybooksCard
      mayAdminister
      mayLaunch
      onToast={onToast}
      playbooks={{ ok: true, value: seededPlaybooks() }}
      readAt={READ_AT}
      skills={{ ok: true, value: seededSkills() }}
      {...over}
    />,
  );

  return { ...result, onToast };
}

/**
 * The row carrying a playbook's name.
 *
 * @param name The name.
 * @returns The `<li>`.
 */
function row(name: string): HTMLElement {
  const item = screen.getAllByRole("listitem").find((one) => one.textContent?.startsWith(name));
  if (item === undefined) throw new Error(`no row for ${name}`);

  return item;
}

/** The open dialog. */
function dialog(): HTMLElement {
  return screen.getByRole("dialog");
}

/**
 * Open the picker for one playbook and wait for its list.
 *
 * @param name The playbook.
 * @returns The dialog.
 */
async function openPicker(name: string): Promise<HTMLElement> {
  fireEvent.click(within(row(name)).getByRole("button", { name: `Run on issue: ${name}` }));

  await waitFor(() => {
    expect(listPlaybookIssues).toHaveBeenCalled();
  });
  await waitFor(() => {
    expect(within(dialog()).queryByText("Reading the issues…")).toBeNull();
  });

  return dialog();
}

beforeEach(() => {
  listPlaybookIssues.mockReset().mockResolvedValue({ ok: true, value: { items: mixedCandidates() } });
  launchPlaybook.mockReset().mockResolvedValue({ ok: true, value: launchReceipt() });
  listRecentRuns.mockReset().mockResolvedValue({ ok: true, value: { items: [...SEEDED_COMPLETIONS], total: 4, limit: 25, offset: 0 } });
  draftPlaybook.mockReset().mockResolvedValue({ ok: true, value: playbookDraft() });
  createPlaybookFromRun.mockReset().mockResolvedValue({ ok: true, value: playbook({ id: "new", name: "Thermal hunt", runCount: 0 }) });
  refresh.mockReset();
});

describe("the three rows", () => {
  it("are the mockup's — name, counted run count, description — under the 3 recipes chip", () => {
    draw();

    expect(screen.getByRole("region", { name: "Playbooks" })).toHaveTextContent("3 recipes");

    const flaky = row("Flaky test hunt");
    expect(flaky).toHaveTextContent("run 9×");
    expect(flaky).toHaveTextContent("Finds & fixes the flakiest test in the suite");
    expect(flaky).toHaveTextContent("standard-fix v14 · Offers open issues labelled flaky.");
    expect(within(flaky).getByTitle(RUN_COUNT_NOTE)).toHaveTextContent("run 9×");
    expect(row("CVE bump")).toHaveTextContent("run 14×");
    expect(row("New driver bring-up")).toHaveTextContent("run 3×");
    expect(screen.getByRole("button", { name: NEW_PLAYBOOK })).not.toHaveAttribute("aria-disabled");
  });

  it("renders the same markup in both palettes — the sheet is what differs", () => {
    const [light, dark] = renderInBothPalettes(
      <PlaybooksCard
        mayAdminister
        mayLaunch
        onToast={vi.fn()}
        playbooks={{ ok: true, value: seededPlaybooks() }}
        readAt={READ_AT}
        skills={{ ok: true, value: seededSkills() }}
      />,
    );

    expect(maskIds(light!)).toBe(maskIds(dark!));
    expect(light).toContain("run 14×");
  });

  it("draws a viewer's Run on issue inert with the reason, and a member's New playbook likewise", () => {
    draw({ mayLaunch: false, mayAdminister: false });

    const run = within(row("Flaky test hunt")).getByRole("button", { name: "Run on issue: Flaky test hunt" });
    expect(run).toHaveAttribute("aria-disabled", "true");
    expect(run).toHaveAttribute("title", LAUNCH_VIEWER_REASON);

    const tile = screen.getByRole("button", { name: NEW_PLAYBOOK });
    expect(tile).toHaveAttribute("aria-disabled", "true");
    expect(tile).toHaveAttribute("title", CREATE_ADMIN_REASON);

    fireEvent.click(run);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("the states", () => {
  it("draws the empty state with the create-from-run path as its primary action", () => {
    draw({ playbooks: { ok: true, value: { items: [] } } });

    expect(screen.getByText(NO_PLAYBOOKS_TITLE)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: NEW_PLAYBOOK })).toHaveClass("ou-btn--primary");
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("says the list could not be read, with the service's reason", () => {
    draw({ playbooks: { ok: false, reason: "The service failed." } });

    expect(screen.getByText(PLAYBOOKS_UNREAD_TITLE)).toBeInTheDocument();
    expect(screen.getByText("The service failed.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: NEW_PLAYBOOK })).toBeNull();
  });
});

describe("Run on issue… ▾", () => {
  it("opens the safety-ranked picker, honouring the playbook's filter, each unlaunchable row saying why", async () => {
    draw();
    const picker = await openPicker("Flaky test hunt");

    expect(listPlaybookIssues).toHaveBeenCalledExactlyOnceWith(seededPlaybook("Flaky test hunt").id, "");
    expect(picker).toHaveAccessibleName(pickerTitle(seededPlaybook("Flaky test hunt")));
    expect(picker).toHaveTextContent("Offers open issues labelled flaky.");

    const lines = within(picker).getAllByRole("listitem").map((item) => item.textContent ?? "");
    expect(lines[0]).toContain("#485");
    expect(lines[1]).toContain("#488");
    expect(lines[1]).toContain(CANDIDATE_REASONS.estimating);
    expect(lines[2]).toContain("#490");
    expect(lines[3]).toContain("#481");
    expect(lines[4]).toContain("#483");
    expect(lines[4]).toContain(CANDIDATE_REASONS.queued);

    expect(within(picker).getByRole("button", { name: launchName(candidate()) })).not.toHaveAttribute("aria-disabled");
    const queued = within(picker).getByRole("button", { name: "Queue #483" });
    expect(queued).toHaveAttribute("aria-disabled", "true");
    expect(queued).toHaveAttribute("title", CANDIDATE_REASONS.queued);
  });

  it("searches on Enter and says when nothing matches", async () => {
    draw();
    const picker = await openPicker("Flaky test hunt");

    listPlaybookIssues.mockResolvedValue({ ok: true, value: { items: [] } });
    fireEvent.change(within(picker).getByLabelText(PICKER_SEARCH_LABEL), { target: { value: " 999 " } });
    fireEvent.click(within(picker).getByRole("button", { name: PICKER_SEARCH }));

    await waitFor(() => {
      expect(listPlaybookIssues).toHaveBeenLastCalledWith(seededPlaybook("Flaky test hunt").id, "999");
    });
    await waitFor(() => {
      expect(dialog()).toHaveTextContent("No admitted issue matches 999.");
    });
  });

  it("says when the filter admits nothing, and when the list could not be read", async () => {
    listPlaybookIssues.mockResolvedValue({ ok: true, value: { items: [] } });
    draw();
    let picker = await openPicker("Flaky test hunt");
    expect(picker).toHaveTextContent(PICKER_EMPTY);

    fireEvent.keyDown(picker, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    listPlaybookIssues.mockResolvedValue({ ok: false, refusal: { code: "internal_error", message: "The service failed.", details: {} } });
    picker = await openPicker("CVE bump");
    expect(within(picker).getByRole("alert")).toHaveTextContent("The issues could not be read: The service failed.");
  });

  it("queues the issue, shows the receipt with its links, notes the launch beside the count and leaves the toast", async () => {
    const { onToast } = draw();
    const picker = await openPicker("Flaky test hunt");
    const flaky = seededPlaybook("Flaky test hunt");

    fireEvent.click(within(picker).getByRole("button", { name: launchName(candidate()) }));

    await waitFor(() => {
      expect(launchPlaybook).toHaveBeenCalledExactlyOnceWith(flaky.id, candidate().id);
    });
    await waitFor(() => {
      expect(within(dialog()).getByRole("status")).toHaveTextContent(receiptText(launchReceipt(), flaky));
    });

    const links = within(dialog()).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(receiptToast(launchReceipt(), flaky).links.map((link) => link.href));
    expect(onToast).toHaveBeenCalledExactlyOnceWith(receiptToast(launchReceipt(), flaky));
    expect(refresh).toHaveBeenCalled();

    // The count is the service's and does not move; the launch is noted beside it, honestly.
    expect(row("Flaky test hunt")).toHaveTextContent("run 9×");
    expect(row("Flaky test hunt")).toHaveTextContent("#485 queued");
  });

  it("lands a refused launch in the row as an alert the button is described by", async () => {
    launchPlaybook.mockResolvedValue({ ok: false, refusal: { code: "queue_issues_conflict", message: "Already queued.", details: {} } });
    draw();
    const picker = await openPicker("Flaky test hunt");
    const button = within(picker).getByRole("button", { name: launchName(candidate()) });

    fireEvent.click(button);

    await waitFor(() => {
      expect(within(dialog()).getByRole("alert")).toHaveTextContent("Not queued: the queue already holds this issue.");
    });
    expect(button).toHaveAttribute("aria-describedby", within(dialog()).getByRole("alert").id);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("+ New playbook from a past run…", () => {
  /**
   * Open the dialog and wait for the runs.
   *
   * @returns The dialog.
   */
  async function openCreate(): Promise<HTMLElement> {
    fireEvent.click(screen.getByRole("button", { name: NEW_PLAYBOOK }));

    await waitFor(() => {
      expect(listRecentRuns).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(within(dialog()).queryByText("Reading recent runs…")).toBeNull();
    });

    return dialog();
  }

  it("lists recent terminal runs, each linking to its console", async () => {
    draw();
    const create = await openCreate();

    expect(create).toHaveAccessibleName(NEW_PLAYBOOK_TITLE);
    const runs = within(create).getAllByRole("listitem");
    expect(runs).toHaveLength(SEEDED_COMPLETIONS.length);
    expect(runs[0]).toHaveTextContent("#474 — Debounce e-stop interrupt handler");
    expect(runs[0]).toHaveTextContent("standard-fix · merged");
    expect(within(runs[0]!).getByRole("link")).toHaveAttribute("href", expect.stringContaining("from=knowledge"));
  });

  it("says when no run has finished", async () => {
    listRecentRuns.mockResolvedValue({ ok: true, value: { items: [], total: 0, limit: 25, offset: 0 } });
    draw();
    const create = await openCreate();

    expect(create).toHaveTextContent(NO_RUNS);
  });

  it("shows what the seeded run captured — pin, overrides by slug, steers, where from — before saving, then saves", async () => {
    const { onToast } = draw();
    const create = await openCreate();

    fireEvent.click(within(create).getByRole("button", { name: `${CHOOSE_RUN}: #474` }));

    await waitFor(() => {
      expect(draftPlaybook).toHaveBeenCalledExactlyOnceWith(SEEDED_COMPLETIONS[0]!.id);
    });
    await waitFor(() => {
      expect(dialog()).toHaveTextContent("standard-fix v14");
    });

    const captured = dialog();
    expect(captured).toHaveTextContent("Loop #1791 — derived against acme-robotics/helios-firmware from 3 injection records and 2 steers.");
    expect(captured).toHaveTextContent("+ hil-safety enabled");
    expect(captured).toHaveTextContent("− repo-map disabled");
    expect(captured).toHaveTextContent("focus the flakiest suite first");
    expect(captured).toHaveTextContent("leave the CAN driver alone");
    expect(within(captured).getByLabelText(DESCRIPTION_LABEL)).toHaveValue(playbookDraft().suggestedDescription);
    expect(createPlaybookFromRun).not.toHaveBeenCalled();

    // A taken name is refused before a round trip.
    fireEvent.change(within(captured).getByLabelText(NAME_LABEL), { target: { value: "CVE bump" } });
    expect(within(captured).getByRole("alert")).toHaveTextContent(NAME_TAKEN);
    expect(within(captured).getByRole("button", { name: CREATE_SUBMIT })).toHaveAttribute("aria-disabled", "true");

    fireEvent.change(within(captured).getByLabelText(NAME_LABEL), { target: { value: "Thermal hunt" } });
    fireEvent.change(within(captured).getByLabelText(LABELS_LABEL), { target: { value: "thermal, power" } });
    fireEvent.click(within(captured).getByRole("button", { name: CREATE_SUBMIT }));

    await waitFor(() => {
      expect(createPlaybookFromRun).toHaveBeenCalledExactlyOnceWith({
        runId: playbookDraft().sourceRunId,
        name: "Thermal hunt",
        issueFilter: { labels: ["thermal", "power"] },
      });
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    expect(row("Thermal hunt")).toHaveTextContent("run 0×");
    expect(screen.getByRole("region", { name: "Playbooks" })).toHaveTextContent("4 recipes");
    expect(onToast).toHaveBeenCalledExactlyOnceWith(createdToast(playbook({ id: "new", name: "Thermal hunt", runCount: 0 })));
    expect(refresh).toHaveBeenCalled();
  });

  it("says why a run's draft was refused and keeps the run list", async () => {
    draftPlaybook.mockResolvedValue({ ok: false, refusal: { code: "playbook_run_unpinned", message: "No pin.", details: {} } });
    draw();
    const create = await openCreate();

    fireEvent.click(within(create).getByRole("button", { name: `${CHOOSE_RUN}: #474` }));

    await waitFor(() => {
      expect(within(dialog()).getByRole("alert")).toHaveTextContent("This run has no published workflow version a playbook could pin.");
    });
    expect(within(dialog()).getAllByRole("listitem")).toHaveLength(SEEDED_COMPLETIONS.length);
  });

  it("lands the service's taken name under the box", async () => {
    createPlaybookFromRun.mockResolvedValue({ ok: false, refusal: { code: "playbook_name_taken", message: "Taken.", details: {} } });
    draw();
    const create = await openCreate();

    fireEvent.click(within(create).getByRole("button", { name: `${CHOOSE_RUN}: #474` }));
    await waitFor(() => {
      expect(dialog()).toHaveTextContent("standard-fix v14");
    });

    fireEvent.change(within(dialog()).getByLabelText(NAME_LABEL), { target: { value: "Raced" } });
    fireEvent.click(within(dialog()).getByRole("button", { name: CREATE_SUBMIT }));

    await waitFor(() => {
      expect(within(dialog()).getByRole("alert")).toHaveTextContent(NAME_TAKEN);
    });
    expect(within(dialog()).getByLabelText(NAME_LABEL)).toHaveAttribute("aria-invalid", "true");
  });
});
