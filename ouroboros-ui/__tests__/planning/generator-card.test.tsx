import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PlanningBatch } from "@/app/api/planning";
import type { Reading } from "@/app/api/reading";
import type { BatchReader } from "@/app/planning/batch-poll";
import {
  ALL_SIZED_MARK,
  DRAFT_LABEL,
  DRAFT_ROLE_REASON,
  NO_TRACKER_REASON,
  OUTLINE_GUIDANCE_ACTION,
  OUTLINE_LABEL,
  OUTLINE_TOGGLE_LABEL,
  PROMPT_LABEL,
  PUSH_ROLE_REASON,
  QUEUE_SMALL_NOTE,
  REGENERATE_LABEL,
  RESUME_LABEL,
  SIZING_MARK,
  TRACKER_GROUP_LABEL,
  trackerOptions,
} from "@/app/planning/generator";

import { renderInBothPalettes } from "../helpers/palettes";
import {
  SEEDED_BATCH_ID,
  SEEDED_PROMPT,
  generatedBatch,
  planningBatch,
  planningDraft,
  pushResult,
  seededDrafts,
  writableCatalog,
} from "../helpers/planning";
import { SEEDED_GITHUB_ID, catalogPayload, seededSources } from "../helpers/sources";

/**
 * The generator card, drawn and driven (#284) — the acceptance criteria that are about what a person
 * sees and does: the seeded batch reproducing mockup 09's card element for element, sizing progress
 * that only claims `✓ all sized` when it is true, the live selection count, regenerate, a partial
 * push and its resume, capability-gated trackers, the honest footer, the planner's guidance, roles,
 * and the keyboard path through selection, editing and push.
 *
 * The Server Actions are mocked, not the API: `generator-actions.test.ts` is that module's suite. The
 * poll reads through its test seam.
 */

const actions = {
  generateBatch: vi.fn(),
  regenerateBatch: vi.fn(),
  patchDraft: vi.fn(),
  pushBatch: vi.fn(),
  readMilestones: vi.fn(),
};

vi.mock("@/app/planning/generator-actions", () => ({
  generateBatch: (...args: unknown[]) => actions.generateBatch(...args),
  regenerateBatch: (...args: unknown[]) => actions.regenerateBatch(...args),
  patchDraft: (...args: unknown[]) => actions.patchDraft(...args),
  pushBatch: (...args: unknown[]) => actions.pushBatch(...args),
  readMilestones: (...args: unknown[]) => actions.readMilestones(...args),
}));

const replace = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh: vi.fn(), push: vi.fn() }) }));

const { GeneratorCard } = await import("@/app/planning/generator-card");

/** What the poll's reader answers, per case. By default nothing new. */
let read: BatchReader;

/** The card's props, for this case. */
function props(
  over: Partial<{
    batch: Reading<PlanningBatch> | null;
    catalog: Parameters<typeof trackerOptions>[1];
    mayAdminister: boolean;
    mayContribute: boolean;
  }> = {},
) {
  return {
    batch: over.batch === undefined ? { ok: true as const, value: planningBatch() } : over.batch,
    trackers: trackerOptions(seededSources(), over.catalog ?? { ok: true, value: writableCatalog() }),
    trackersUnread: null,
    mayAdminister: over.mayAdminister ?? true,
    mayContribute: over.mayContribute ?? true,
    pollOptions: { read: (etag: string | null) => read(etag), visible: () => true },
  };
}

/** The draft list. */
function rows(): HTMLElement {
  return screen.getByRole("list", { name: "Draft — 6 tickets" });
}

/**
 * One draft's row.
 *
 * @param key Its local key.
 * @returns The list item.
 */
function row(key: string): HTMLElement {
  return screen.getByRole("checkbox", { name: `Include ${key}` }).closest("li")!;
}

beforeEach(() => {
  for (const action of Object.values(actions)) action.mockReset();
  replace.mockReset();
  read = () => Promise.resolve({ state: "unchanged", etag: null, pollAfterSeconds: null });
  actions.readMilestones.mockResolvedValue({
    ok: true,
    value: { sourceId: SEEDED_GITHUB_ID, supported: true, milestones: [{ externalRef: "3", name: "Helios 2.1" }] },
  });
});

describe("the seeded batch", () => {
  it("reproduces mockup 09's card element for element", async () => {
    render(<GeneratorCard {...props()} />);

    const card = screen.getByRole("region", { name: "Generate tickets" });

    // Head: title and the real estimator version.
    expect(within(card).getByText("estimator v0")).toBeInTheDocument();

    // The prompt, labelled verbatim and seeded with the OTA narrative.
    expect(screen.getByLabelText(PROMPT_LABEL)).toHaveValue(SEEDED_PROMPT);

    // The tracker segment: GitHub selected, with its monogram.
    const trackers = screen.getByRole("group", { name: TRACKER_GROUP_LABEL });
    const github = within(trackers).getByRole("button", { name: "GitHub Issues" });
    expect(github).toHaveAttribute("aria-pressed", "true");
    expect(within(github).getByText("GH")).toHaveClass("planning-mgram--gh");
    expect(within(trackers).getByText("JI")).toHaveClass("planning-mgram--ji");
    expect(within(trackers).getByText("LN")).toHaveClass("planning-mgram--ln");

    // Milestone, the two switches, and the primary action.
    await waitFor(() => { expect(screen.getByLabelText("Milestone")).toHaveDisplayValue("Helios 2.1"); });
    expect(screen.getByRole("switch", { name: "Auto-size with estimator" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: "Queue XS/S tickets immediately" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("button", { name: DRAFT_LABEL })).not.toHaveAttribute("aria-disabled");

    // DRAFT — 6 TICKETS, and the pill.
    expect(screen.getByRole("heading", { name: "Draft — 6 tickets" })).toBeInTheDocument();
    expect(screen.getByText(ALL_SIZED_MARK)).toBeInTheDocument();

    // Six rows: checkbox, key, title, dependency note, effort, workflow.
    const expected = [
      ["OTA-1", "Partition table & bootloader slot flag for A/B scheme", "blocks OTA-3", "L", "feature-loop"],
      ["OTA-2", "SHA-256 checksum verification before slot swap", "blocks OTA-3", "M", "feature-loop"],
      ["OTA-3", "Rollback state machine on failed boot confirmation", "blocks OTA-5", "L", "feature-loop"],
      ["OTA-4", "BLE recovery beacon when both slots fail checksum", "blocks OTA-5", "M", "feature-loop"],
      ["OTA-5", "Power-loss integration tests on HIL rig (kill power mid-flash)", null, "M", "hil-verify"],
      ["OTA-6", "Operator docs: recovery procedure & beacon pairing", null, "XS", "docs-loop"],
    ] as const;

    expect(within(rows()).getAllByRole("listitem")).toHaveLength(6);

    for (const [key, title, dep, effort, workflow] of expected) {
      const item = row(key);

      expect(within(item).getByRole("checkbox")).toBeChecked();
      expect(within(item).getByText(key)).toHaveClass("planning-draft__key");
      expect(within(item).getByText(title)).toBeInTheDocument();
      if (dep === null) expect(item.querySelector(".planning-draft__dep")).toBeNull();
      else expect(within(item).getByText(dep)).toBeInTheDocument();
      expect(within(item).getByTitle(`Effort: ${effort}`)).toHaveTextContent(effort);
      expect(within(item).getByText(workflow)).toHaveClass("ou-tag");
    }

    // Footer.
    expect(screen.getByText("est. total ~3 days of loop time · $14 est. spend")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: REGENERATE_LABEL })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Push 6 tickets to GitHub →" })).not.toHaveAttribute("aria-disabled");
  });

  it("renders identically in both palettes", () => {
    const [light, dark] = renderInBothPalettes(<GeneratorCard {...props()} />);

    expect(light).toBe(dark);
  });

  it("says a batch the address named could not be opened, and starts fresh", () => {
    render(<GeneratorCard {...props({ batch: { ok: false, reason: "No such batch." } })} />);

    expect(screen.getByText("That batch could not be opened. No such batch.")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: /Draft/ })).toBeNull();
  });
});

describe("sizing", () => {
  /** The seed with its last two drafts unsized. */
  const sizing = planningBatch({
    status: "drafting",
    drafts: seededDrafts().map((draft, index) => (index >= 4 ? { ...draft, estimate: null } : draft)),
  });

  it("shows sizing… per row and no pill until every draft has an estimate — then the pill, live", async () => {
    let answer: PlanningBatch | null = null;
    read = () =>
      Promise.resolve(
        answer === null
          ? { state: "unchanged", etag: null, pollAfterSeconds: 3 }
          : { state: "fresh", payload: answer, etag: null, pollAfterSeconds: 15 },
      );

    render(<GeneratorCard {...props({ batch: { ok: true, value: sizing } })} />);

    expect(within(row("OTA-5")).getByText(SIZING_MARK)).toBeInTheDocument();
    expect(within(row("OTA-6")).getByText(SIZING_MARK)).toBeInTheDocument();
    expect(screen.queryByText(ALL_SIZED_MARK)).toBeNull();
    expect(screen.getByText("sized 4 of 6")).toBeInTheDocument();

    // The estimator finishes; the next poll — here, the one a tab coming back into view asks — carries it.
    answer = planningBatch();

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });

    await waitFor(() => { expect(screen.getByText(ALL_SIZED_MARK)).toBeInTheDocument(); });
    expect(screen.queryByText(SIZING_MARK)).toBeNull();
  });
});

describe("drafting", () => {
  it("sends the form, opens the new batch at its own address, and shows the planner's guidance", async () => {
    const narrative = generatedBatch(
      { id: "5eed0021-0000-4000-8000-00000000000f", outline: null, drafts: [planningDraft()] },
      ["Narrative-only input: add an outline to draft one ticket per bullet."],
    );
    actions.generateBatch.mockResolvedValue({ ok: true, value: narrative });

    render(<GeneratorCard {...props({ batch: null })} />);

    fireEvent.change(screen.getByLabelText(PROMPT_LABEL), { target: { value: "Survive power loss." } });
    fireEvent.click(screen.getByRole("button", { name: DRAFT_LABEL }));

    await waitFor(() => { expect(actions.generateBatch).toHaveBeenCalledOnce(); });
    expect(actions.generateBatch.mock.calls[0]![0]).toMatchObject({
      prompt: "Survive power loss.",
      outline: null,
      targetSourceId: SEEDED_GITHUB_ID,
      milestone: null,
      autoSize: true,
      queueSmall: false,
    });

    await waitFor(() => { expect(replace).toHaveBeenCalledWith(`/planning?batch=${narrative.id}`, { scroll: false }); });

    const guidance = screen.getByRole("complementary", { name: "Planner guidance" });
    expect(within(guidance).getByText(narrative.notes[0]!)).toBeInTheDocument();

    // The hint points at the outline field: it opens it and puts the cursor there.
    const outlineToggle = screen.getByRole("button", { name: OUTLINE_TOGGLE_LABEL });
    expect(outlineToggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(within(guidance).getByRole("button", { name: OUTLINE_GUIDANCE_ACTION }));

    expect(outlineToggle).toHaveAttribute("aria-expanded", "true");
    await waitFor(() => { expect(screen.getByLabelText(OUTLINE_LABEL)).toHaveFocus(); });
  });

  it("says why the planner refused, and keeps the form", async () => {
    actions.generateBatch.mockResolvedValue({
      ok: false,
      refusal: { code: "dependency_cycle", message: "This batch's dependencies form a cycle (OTA-3 → OTA-5 → OTA-3).", details: {} },
    });

    render(<GeneratorCard {...props({ batch: null })} />);

    fireEvent.change(screen.getByLabelText(PROMPT_LABEL), { target: { value: "p" } });
    fireEvent.click(screen.getByRole("button", { name: DRAFT_LABEL }));

    expect(await screen.findByRole("alert")).toHaveTextContent("OTA-3 → OTA-5 → OTA-3");
    expect(screen.getByLabelText(PROMPT_LABEL)).toHaveValue("p");
    expect(replace).not.toHaveBeenCalled();
  });

  it("carries the queue switch's N7 explanation as its description", () => {
    render(<GeneratorCard {...props()} />);

    const queue = screen.getByRole("switch", { name: "Queue XS/S tickets immediately" });

    expect(queue).toHaveAccessibleDescription(QUEUE_SMALL_NOTE);
    fireEvent.click(queue);
    expect(queue).toHaveAttribute("aria-checked", "true");
  });
});

describe("selection", () => {
  it("moves the push count with the click, before the service answers", async () => {
    let settle: (value: unknown) => void = () => {};
    actions.patchDraft.mockReturnValue(new Promise((resolve) => { settle = resolve; }));

    render(<GeneratorCard {...props()} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Include OTA-2" }));

    expect(screen.getByRole("checkbox", { name: "Include OTA-2" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Push 5 tickets to GitHub →" })).toBeInTheDocument();
    expect(actions.patchDraft).toHaveBeenCalledExactlyOnceWith(SEEDED_BATCH_ID, "OTA-2", { selected: false });

    const drafts = seededDrafts().map((draft) => (draft.localKey === "OTA-2" ? { ...draft, selected: false } : draft));
    await act(async () => {
      settle({ ok: true, value: planningBatch({ drafts, summary: { ...planningBatch().summary, selectedCount: 5 } }) });
      await Promise.resolve();
    });

    expect(screen.getByRole("checkbox", { name: "Include OTA-2" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Push 5 tickets to GitHub →" })).toBeInTheDocument();
  });

  it("puts a refused click back, and says why", async () => {
    actions.patchDraft.mockResolvedValue({
      ok: false,
      refusal: { code: "batch_not_editable", message: "The batch is being pushed.", details: {} },
    });

    render(<GeneratorCard {...props()} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Include OTA-2" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The batch is being pushed.");
    await waitFor(() => { expect(screen.getByRole("checkbox", { name: "Include OTA-2" })).toBeChecked(); });
    expect(screen.getByRole("button", { name: "Push 6 tickets to GitHub →" })).toBeInTheDocument();
  });

  it("says nothing is selected, and will not push nothing", () => {
    const drafts = seededDrafts().map((draft) => ({ ...draft, selected: false }));

    render(<GeneratorCard {...props({ batch: { ok: true, value: planningBatch({ drafts }) } })} />);

    expect(screen.getByRole("button", { name: "Push 0 tickets to GitHub →" })).toHaveAttribute(
      "title",
      "Select at least one draft to push.",
    );
  });
});

describe("regenerate", () => {
  it("re-plans the batch and draws the answer, with the selections the service preserved", async () => {
    const drafts = seededDrafts().map((draft) => (draft.localKey === "OTA-4" ? { ...draft, selected: false } : draft));
    actions.regenerateBatch.mockResolvedValue({ ok: true, value: generatedBatch({ drafts }) });

    render(<GeneratorCard {...props()} />);

    fireEvent.click(screen.getByRole("button", { name: REGENERATE_LABEL }));

    await waitFor(() => { expect(actions.regenerateBatch).toHaveBeenCalledExactlyOnceWith(SEEDED_BATCH_ID); });
    await waitFor(() => { expect(screen.getByRole("checkbox", { name: "Include OTA-4" })).not.toBeChecked(); });
    expect(screen.getByRole("button", { name: "Push 5 tickets to GitHub →" })).toBeInTheDocument();
  });

  it("is closed for a batch already pushed", () => {
    render(<GeneratorCard {...props({ batch: { ok: true, value: planningBatch({ status: "pushed" }) } })} />);

    expect(screen.getByRole("button", { name: REGENERATE_LABEL })).toHaveAttribute("aria-disabled", "true");
  });
});

describe("a partial push", () => {
  /** Four landed; two did not. */
  const partial = planningBatch({
    status: "pushing",
    drafts: seededDrafts().map((draft, index) =>
      index < 4
        ? {
            ...draft,
            pushState: "pushed" as const,
            pushedTicket: {
              externalId: String(612 + index),
              externalKey: `#${612 + index}`,
              url: `https://github.com/acme-robotics/helios-firmware/issues/${612 + index}`,
            },
          }
        : { ...draft, pushState: "failed" as const, pushError: { code: "rate_limited", message: "rate limited" } },
    ),
  });

  it("renders every draft's own state, and resume re-runs only what did not land", async () => {
    const report = pushResult().report;
    actions.pushBatch.mockResolvedValueOnce({
      ok: true,
      value: {
        result: pushResult({
          outcome: "partial",
          pushedThisRun: 4,
          drafts: report.drafts.map((draft, index) => (index < 4 ? draft : { ...draft, pushState: "failed" as const })),
        }),
        batch: partial,
      },
    });

    render(<GeneratorCard {...props()} />);

    fireEvent.click(screen.getByRole("button", { name: "Push 6 tickets to GitHub →" }));

    await waitFor(() => { expect(actions.pushBatch).toHaveBeenCalledExactlyOnceWith(SEEDED_BATCH_ID, false); });

    const link = await within(row("OTA-1")).findByRole("link", { name: "pushed ✓ #612" });
    expect(link).toHaveAttribute("href", "https://github.com/acme-robotics/helios-firmware/issues/612");
    expect(within(row("OTA-4")).getByRole("link", { name: "pushed ✓ #615" })).toBeInTheDocument();
    expect(within(row("OTA-5")).getByText("failed — rate limited")).toBeInTheDocument();
    expect(within(row("OTA-6")).getByText("failed — rate limited")).toBeInTheDocument();
    expect(
      screen.getByText("Pushed 4 tickets to GitHub; 2 tickets did not land — Resume push re-runs only those."),
    ).toBeInTheDocument();

    // A pushed draft's content belongs to the tracker now.
    expect(within(row("OTA-1")).getByRole("button", { name: "Edit OTA-1" })).toHaveAttribute("aria-disabled", "true");

    actions.pushBatch.mockResolvedValueOnce({
      ok: true,
      value: {
        result: pushResult({ pushedThisRun: 2 }),
        batch: planningBatch({
          status: "pushed",
          drafts: partial.drafts.map((draft, index) => ({
            ...draft,
            pushState: "pushed" as const,
            pushError: null,
            pushedTicket: { externalId: String(612 + index), externalKey: `#${612 + index}`, url: `https://x/${612 + index}` },
          })),
        }),
      },
    });

    fireEvent.click(screen.getByRole("button", { name: RESUME_LABEL }));

    await waitFor(() => { expect(actions.pushBatch).toHaveBeenLastCalledWith(SEEDED_BATCH_ID, true); });
    expect(await within(row("OTA-6")).findByRole("link", { name: "pushed ✓ #617" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Push 6 tickets to GitHub →" })).toHaveAttribute(
      "title",
      "Every selected draft is already in GitHub.",
    );
  });

  it("opens straight onto resume for a batch a push left short", () => {
    render(<GeneratorCard {...props({ batch: { ok: true, value: partial } })} />);

    expect(screen.getByRole("button", { name: RESUME_LABEL })).not.toHaveAttribute("aria-disabled");
  });

  it("says why a push was refused", async () => {
    actions.pushBatch.mockResolvedValue({
      ok: false,
      refusal: { code: "push_in_progress", message: "This batch is already being pushed.", details: {} },
    });

    render(<GeneratorCard {...props()} />);

    fireEvent.click(screen.getByRole("button", { name: "Push 6 tickets to GitHub →" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("This batch is already being pushed.");
  });
});

describe("capability gating", () => {
  it("disables a read-only tracker with its reason — no push that fails on click", () => {
    render(<GeneratorCard {...props({ catalog: { ok: true, value: catalogPayload() } })} />);

    const reason = "This tracker is read-only in Ouroboros — it can sync tickets but not create them.";
    const github = within(screen.getByRole("group", { name: TRACKER_GROUP_LABEL })).getByRole("button", {
      name: /^GitHub Issues/,
    });

    expect(github).toHaveAttribute("aria-disabled", "true");
    expect(github).toHaveAttribute("title", reason);
    expect(github).toHaveAccessibleName(`GitHub Issues — ${reason}`);

    const push = screen.getByRole("button", { name: "Push 6 tickets to GitHub →" });
    expect(push).toHaveAttribute("title", reason);
    fireEvent.click(push);
    expect(actions.pushBatch).not.toHaveBeenCalled();
  });

  it("will not draft without a writable tracker", () => {
    render(<GeneratorCard {...props({ batch: null, catalog: { ok: true, value: catalogPayload() } })} />);

    fireEvent.change(screen.getByLabelText(PROMPT_LABEL), { target: { value: "p" } });

    expect(screen.getByRole("button", { name: DRAFT_LABEL })).toHaveAttribute("title", NO_TRACKER_REASON);
  });
});

describe("the footer's honesty", () => {
  it("omits the $ entirely when nothing is priced", () => {
    const { spend, ...unpriced } = planningBatch().summary;
    void spend;

    render(<GeneratorCard {...props({ batch: { ok: true, value: planningBatch({ summary: unpriced }) } })} />);

    expect(screen.getByText("est. total ~3 days of loop time")).toBeInTheDocument();
    expect(screen.queryByText(/\$/)).toBeNull();
  });
});

describe("roles", () => {
  it("lets a member draft and select, and not push", () => {
    render(<GeneratorCard {...props({ mayAdminister: false })} />);

    expect(screen.getByRole("button", { name: DRAFT_LABEL })).not.toHaveAttribute("aria-disabled");
    expect(screen.getByRole("checkbox", { name: "Include OTA-1" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Push 6 tickets to GitHub →" })).toHaveAttribute("title", PUSH_ROLE_REASON);
  });

  it("lets a viewer read, and act on nothing", () => {
    render(<GeneratorCard {...props({ mayAdminister: false, mayContribute: false })} />);

    expect(screen.getByLabelText(PROMPT_LABEL)).toBeDisabled();
    expect(screen.getByRole("button", { name: DRAFT_LABEL })).toHaveAttribute("title", DRAFT_ROLE_REASON);
    expect(screen.getByRole("checkbox", { name: "Include OTA-1" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Edit OTA-1" })).toHaveAttribute("title", DRAFT_ROLE_REASON);
    expect(screen.getByRole("button", { name: REGENERATE_LABEL })).toHaveAttribute("title", DRAFT_ROLE_REASON);
  });
});

describe("inline editing, by keyboard", () => {
  it("opens into the title, closes on Escape back to Edit, and saves the edit", async () => {
    const edited = seededDrafts().map((draft) =>
      draft.localKey === "OTA-1" ? { ...draft, title: "A/B partition table", provenance: "edited" as const } : draft,
    );
    actions.patchDraft.mockResolvedValue({ ok: true, value: planningBatch({ drafts: edited }) });

    render(<GeneratorCard {...props()} />);

    const edit = screen.getByRole("button", { name: "Edit OTA-1" });
    fireEvent.click(edit);

    const form = screen.getByRole("form", { name: "Edit OTA-1" });
    const title = within(form).getByLabelText("Title");
    await waitFor(() => { expect(title).toHaveFocus(); });

    fireEvent.keyDown(title, { key: "Escape" });
    expect(screen.queryByRole("form", { name: "Edit OTA-1" })).toBeNull();
    expect(edit).toHaveFocus();

    fireEvent.click(edit);
    const reopened = screen.getByRole("form", { name: "Edit OTA-1" });
    fireEvent.change(within(reopened).getByLabelText("Title"), { target: { value: " A/B partition table " } });
    fireEvent.change(within(reopened).getByLabelText("Body"), { target: { value: "- two slots" } });
    fireEvent.submit(reopened);

    await waitFor(() => {
      expect(actions.patchDraft).toHaveBeenCalledExactlyOnceWith(SEEDED_BATCH_ID, "OTA-1", {
        title: "A/B partition table",
        body: "- two slots",
      });
    });
    await waitFor(() => { expect(screen.queryByRole("form", { name: "Edit OTA-1" })).toBeNull(); });
    expect(within(row("OTA-1")).getByText("A/B partition table")).toBeInTheDocument();
  });

  it("refuses a blank title before sending anything", () => {
    render(<GeneratorCard {...props()} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit OTA-1" }));
    const form = screen.getByRole("form", { name: "Edit OTA-1" });
    fireEvent.change(within(form).getByLabelText("Title"), { target: { value: "  " } });
    fireEvent.submit(form);

    expect(within(form).getByRole("alert")).toHaveTextContent("A ticket needs a title.");
    expect(actions.patchDraft).not.toHaveBeenCalled();
  });

  it("keeps the editor open, with the refusal, when the service says no", async () => {
    actions.patchDraft.mockResolvedValue({
      ok: false,
      refusal: { code: "draft_already_pushed", message: "The draft's issue exists; edit it in the tracker.", details: {} },
    });

    render(<GeneratorCard {...props()} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit OTA-2" }));
    fireEvent.submit(screen.getByRole("form", { name: "Edit OTA-2" }));

    expect(await screen.findByText("The draft's issue exists; edit it in the tracker.")).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Edit OTA-2" })).toBeInTheDocument();
  });
});
