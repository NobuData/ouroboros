import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CopilotStageDraft } from "@/app/api/workflow-copilot";
import { workflowCodePath, workflowNodePath, workflowPath } from "@/app/paths";
import { DEFAULT_POLL_SECONDS, type PollAnswer } from "@/app/poll";
import { publishDraft, publishOperation, publishStreaming, resetCopilotLive } from "@/app/workflows/copilot/copilot-live";
import { stageAnchorHref, stageAnchorId } from "@/app/workflows/copilot/copilot-view";
import {
  NOT_RUNNABLE,
  NO_STAGES_NOTE,
  NO_STAGES_TITLE,
  OPEN_CANVAS_LABEL,
  RUNNABLE_ONCE_PROMOTED,
  STAGES_LABEL,
  STAGES_SCROLL_LABEL,
  STALE_HEADLINE,
  STALE_RETRY_LABEL,
  VIEW_AS_CODE_LABEL,
  editName,
  stagesTitle,
  warningButtonName,
  warningExplanation,
} from "@/app/workflows/copilot/stages";
import { stagesEndpoint } from "@/app/workflows/copilot/stages-poll";

import { PALETTES, maskIds, renderInBothPalettes, renderInPalette } from "../../helpers/palettes";
import {
  ADVISORY_DB_WARNING,
  EXPLOIT_VERIFY_WARNING,
  SECURITY_PATCH_ID,
  SEEDED_NODE_IDS,
  copilotPromotion,
  freshDraft,
  seededAliases,
  seededProvenance,
  seededStageDraft,
} from "../../helpers/workflow-copilot";

/**
 * The draft's stage list as it is drawn (CE.3, #567) — mockup 20's nine rows.
 *
 * One acceptance criterion a `describe`, more or less: **the seeded list is the mockup's**, with
 * the pill on row 07; **unresolved references warn, with a note that says what is missing**;
 * **rows appear and change while a reply streams, in operation order**; **the pill clears when a
 * later read says a person has edited the stage, with no reload**; **edit and View as code lead
 * to the other two surfaces**; **the footer is derived**; **a finding's anchor lands on its
 * row**; both palettes, and the list's own scroller.
 */

// `next/link` wants the App Router; an anchor carries everything asserted here.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a {...rest} href={href}>
      {children}
    </a>
  ),
}));

const { StagesCard } = await import("@/app/workflows/copilot/stages-card");

/** What the poll's reader answers next. */
let answer: PollAnswer<CopilotStageDraft>;

/** The poll's reader. */
const read = vi.fn<(endpoint: string, etag: string | null) => Promise<PollAnswer<CopilotStageDraft>>>();

/** Whether the tab is visible. */
let visible = true;

/** Render the card on the seeded draft. */
function renderCard(overrides: Partial<Parameters<typeof StagesCard>[0]> = {}) {
  return render(
    <StagesCard
      aliases={seededAliases()}
      currentVersion={null}
      draft={seededStageDraft()}
      name="security-patch"
      poll={{ read, visible: () => visible }}
      promotion={{ ok: true, value: copilotPromotion() }}
      slug="security-patch"
      workflowId={SECURITY_PATCH_ID}
      {...overrides}
    />,
  );
}

/** Let the poll's answer land. */
async function land(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

/** Let an interval pass. */
async function interval(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(DEFAULT_POLL_SECONDS * 1000);
  });
}

/** The card. */
function card(): HTMLElement {
  return screen.getByRole("region", { name: stagesTitle("security-patch", null) });
}

/** The rows. */
function rows(): HTMLElement[] {
  return within(screen.getByRole("list", { name: STAGES_LABEL })).getAllByRole("listitem");
}

/** A row's visible words, on one line. */
function line(row: HTMLElement): string {
  return (row.querySelector(".copilot-stages__line")?.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** A row's tags: the plain ones and the warned ones, in order. */
function tags(row: HTMLElement): string[] {
  return [...row.querySelectorAll(".ou-tag, .copilot-stages__warn .ou-chip")].map((tag) =>
    (tag.textContent ?? "").replace(/\s+/g, " ").trim(),
  );
}

/** A stage the copilot adds mid-reply. */
const FUZZ = { id: "fuzz", type: "infra", title: "fuzz", description: "nightly", config: { runner_pool: "pool-b" } };

/** Publish an applied operation through the conversation's live store. */
function apply(kind: string, params: Record<string, unknown>, draftRev = 4): void {
  act(() => publishOperation(SECURITY_PATCH_ID, { op: { kind, params }, outcome: "applied", draftRev, warnings: [] }));
}

beforeEach(() => {
  vi.useFakeTimers();
  visible = true;
  answer = freshDraft(seededStageDraft());
  read.mockReset().mockImplementation(() => Promise.resolve(answer));
  resetCopilotLive();
  window.history.replaceState(null, "", "/workflows/security-patch/copilot");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the seeded draft", () => {
  it("is mockup 20's nine rows: number, name, tags, pill, edit", () => {
    renderCard();

    expect(rows().map(line)).toEqual([
      "01▸trigger, Trigger stagelabel:securityedit",
      "02◆analyze, Model stageskill:advisory-db ⚠warning: skill does not existⓘclaude-sonnet-5edit",
      "03◆plan, Model stageclaude-fable-5edit",
      "04◆implement, Model stagerouted by taskedit",
      "05▣build, Infra stagepool-aedit",
      "06▣test, Infra stagepool-atwister fulledit",
      "07◆exploit-verify, Model stagetask:exploit-verify ⚠warning: kind not in catalogⓘreruns CVE PoCsandboxedadded by copilotedit",
      "08◆review ×2, Model stageclaude-fable-5composer-2edit",
      "09●open PR, Terminal stagenever auto-mergeedit",
    ]);
  });

  it("draws each row's tags as the configuration composes them", () => {
    renderCard();

    expect(rows().map(tags)).toEqual([
      ["label:security"],
      ["skill:advisory-db ⚠warning: skill does not exist", "claude-sonnet-5"],
      ["claude-fable-5"],
      ["routed by task"],
      ["pool-a"],
      ["pool-a", "twister full"],
      ["task:exploit-verify ⚠warning: kind not in catalog", "reruns CVE PoC", "sandboxed"],
      ["claude-fable-5", "composer-2"],
      ["never auto-merge"],
    ]);
  });

  it("puts `added by copilot` on row 07 and on no other", () => {
    renderCard();

    const pilled = rows().filter((row) => within(row).queryByText("added by copilot") !== null);

    expect(pilled).toEqual([rows()[6]]);
  });

  it("heads the card with the draft's title, its revision, and the link to the code view", () => {
    renderCard();

    expect(within(card()).getByRole("heading", { level: 2 })).toHaveTextContent("Draft — security-patch · unpublished");
    expect(within(card()).getByText("draft v0.3")).toHaveClass("ou-tag");
    expect(within(card()).getByRole("link", { name: VIEW_AS_CODE_LABEL })).toHaveAttribute(
      "href",
      workflowCodePath("security-patch"),
    );
  });

  it("does not say unpublished for a workflow with a version in force", () => {
    renderCard({ currentVersion: 4, name: "standard-fix", draft: seededStageDraft({ label: "v4.2" }) });

    const region = screen.getByRole("region", { name: "Draft — standard-fix" });
    expect(region).not.toHaveTextContent(/unpublished/i);
    expect(within(region).getByText("draft v4.2")).toBeInTheDocument();
  });

  it("keeps the seat's element id, so a link to the region still lands", () => {
    renderCard();

    expect(card()).toHaveAttribute("id", "copilot-stages");
  });
});

describe("the footer", () => {
  it("is the count, the guards and the runnable line — the unenforced guard said as unenforced", () => {
    renderCard();

    expect(card().querySelector(".copilot-stages__foot")).toHaveTextContent(
      "9 stages · never auto-merge · spend cap $5.00/run (not enforced on real runs yet) · draft not yet runnable on real issues",
    );
  });

  it("draws what is not a protection, and what is not yet true, on the warning tone — never plainly", () => {
    renderCard();

    expect(screen.getByText("spend cap $5.00/run (not enforced on real runs yet)")).toHaveClass("copilot-stages__fact--warn");
    expect(screen.getByText(NOT_RUNNABLE)).toHaveClass("copilot-stages__fact--warn");
    expect(screen.getByText("never auto-merge", { selector: ".copilot-stages__fact" })).not.toHaveClass(
      "copilot-stages__fact--warn",
    );
  });

  it("says runnable once promoted for a draft with nothing unresolved, and lists no guard it was not given", () => {
    renderCard({
      draft: seededStageDraft({ warnings: [] }),
      promotion: { ok: false, reason: "The summary is unavailable." },
    });

    expect(card().querySelector(".copilot-stages__foot")).toHaveTextContent(`9 stages · ${RUNNABLE_ONCE_PROMOTED}`);
    expect(screen.queryByText("The summary is unavailable.")).toBeNull();
  });
});

describe("unresolved references", () => {
  it("are drawn on the warning chip, with a mark and what they are in words", () => {
    renderCard();

    const chip = within(rows()[1]).getByText(/skill:advisory-db/).closest(".ou-chip");

    expect(chip).toHaveClass("ou-chip--warn");
    expect(chip).toHaveTextContent("⚠");
    expect(chip).toHaveTextContent("skill does not exist");
    // A tag that resolves is a plain tag.
    expect(within(rows()[1]).getByText("claude-sonnet-5")).toHaveClass("ou-tag");
  });

  it("open a note that says precisely what is missing, where it will come from, and what the service said", () => {
    renderCard();

    const info = within(rows()[6]).getByRole("button", { name: warningButtonName("task:exploit-verify") });
    expect(info).toHaveAttribute("aria-expanded", "false");
    const note = document.getElementById(info.getAttribute("aria-controls") ?? "");
    expect(note).not.toBeNull();
    expect(note).not.toBeVisible();

    fireEvent.click(info);

    expect(info).toHaveAttribute("aria-expanded", "true");
    expect(note).toBeVisible();
    expect(note).toHaveTextContent(
      "This stage's task kind, exploit-verify, isn't in the catalog yet — the draft can't run on real issues until it exists.",
    );
    expect(note).toHaveTextContent("arrives with #570");
    expect(note).toHaveTextContent(EXPLOIT_VERIFY_WARNING.message);
  });

  it("say the same for the skill nobody has created", () => {
    renderCard();

    fireEvent.click(within(rows()[1]).getByRole("button", { name: warningButtonName("skill:advisory-db") }));

    const note = within(rows()[1]).getByRole("note");
    expect(note).toHaveTextContent(warningExplanation(ADVISORY_DB_WARNING));
    expect(note).toHaveTextContent("The advisory-db skill arrives with #571.");
    expect(note).toHaveTextContent(ADVISORY_DB_WARNING.message);
  });

  it("close on a second press, and on Escape with focus back on the control", () => {
    renderCard();

    const info = within(rows()[1]).getByRole("button", { name: warningButtonName("skill:advisory-db") });
    const note = document.getElementById(info.getAttribute("aria-controls") ?? "");

    fireEvent.click(info);
    fireEvent.click(info);
    expect(info).toHaveAttribute("aria-expanded", "false");
    expect(note).not.toBeVisible();

    fireEvent.click(info);
    rows()[1].focus();
    fireEvent.keyDown(rows()[1], { key: "Escape" });

    expect(note).not.toBeVisible();
    expect(info).toHaveFocus();
  });

  it("are a real button a keyboard reaches, and rows without one draw no note", () => {
    renderCard();

    expect(within(rows()[1]).getByRole("button")).toHaveAttribute("type", "button");
    expect(within(rows()[0]).queryByRole("button")).toBeNull();
    expect(within(rows()[0]).queryByRole("note", { hidden: true })).toBeNull();
    expect(within(card()).getAllByRole("button")).toHaveLength(2);
  });
});

describe("the cross-surface links", () => {
  it("send each row's edit to the canvas, focused on that row's stage", () => {
    renderCard();

    const hrefs = rows().map((row) => within(row).getByRole("link").getAttribute("href"));

    expect(hrefs).toEqual(
      ["trigger", "analyze", "plan", "implement", "build", "test", "exploit-verify", "review-primary", "open-pr"].map((id) =>
        workflowNodePath("security-patch", id),
      ),
    );
    expect(hrefs[6]).toBe("/workflows/security-patch?node=exploit-verify");
  });

  it("name each edit for its row, and send a folded row's to its first stage", () => {
    renderCard();

    expect(within(rows()[7]).getByRole("link", { name: editName("review ×2") })).toHaveAttribute(
      "href",
      workflowNodePath("security-patch", "review-primary"),
    );
    expect(within(rows()[1]).getByRole("link", { name: editName("analyze") })).toHaveTextContent("edit");
  });
});

describe("the anchors a finding lands on", () => {
  it("give every one of the ten stages an element with its anchor id, twins included", () => {
    renderCard();

    for (const id of SEEDED_NODE_IDS) {
      const target = document.getElementById(stageAnchorId(id));
      expect(target, id).not.toBeNull();
      expect(target?.closest("li")).not.toBeNull();
    }
    expect(document.getElementById(stageAnchorId("review-second"))?.closest("li")).toBe(rows()[7]);
    expect(rows()[7]).toHaveAttribute("id", stageAnchorId("review-primary"));
  });

  it("ring and focus the row the address names when the page opens on it", () => {
    window.history.replaceState(null, "", `/workflows/security-patch/copilot${stageAnchorHref("plan")}`);
    renderCard();

    expect(rows()[2]).toHaveClass("copilot-stages__row--target");
    expect(rows()[2]).toHaveFocus();
    expect(rows().filter((row) => row.classList.contains("copilot-stages__row--target"))).toHaveLength(1);
  });

  it("follow a press on a finding's link — a router link moves no `:target` — and bring the row into view", () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    try {
      const { container } = renderCard();
      const finding = document.createElement("a");
      finding.setAttribute("href", stageAnchorHref("exploit-verify"));
      finding.addEventListener("click", (event) => event.preventDefault());
      container.append(finding);

      act(() => finding.click());

      expect(rows()[6]).toHaveClass("copilot-stages__row--target");
      expect(rows()[6]).toHaveFocus();
      expect(scrolled).toHaveBeenLastCalledWith({ block: "nearest" });

      // Pressed again after the reader moved on, it comes back.
      rows()[0].focus();
      act(() => finding.click());
      expect(rows()[6]).toHaveFocus();
    } finally {
      Reflect.deleteProperty(Element.prototype, "scrollIntoView");
    }
  });

  it("land a twin's anchor on the row that stands for it", () => {
    window.history.replaceState(null, "", `/workflows/security-patch/copilot${stageAnchorHref("review-second")}`);
    renderCard();

    expect(rows()[7]).toHaveClass("copilot-stages__row--target");
  });

  it("ring nothing for a fragment that names no stage of the draft", () => {
    window.history.replaceState(null, "", "/workflows/security-patch/copilot#stage-nobody");
    renderCard();

    expect(card().querySelector(".copilot-stages__row--target")).toBeNull();
  });

  it("can be focused by script and are not in the tab order", () => {
    renderCard();

    for (const row of rows()) expect(row).toHaveAttribute("tabindex", "-1");
  });
});

describe("while a reply streams", () => {
  it("adds a row the moment its operation is applied, in the order the operations arrive", () => {
    renderCard();
    act(() => publishStreaming(SECURITY_PATCH_ID, true));

    apply("add_stage", { node: FUZZ });
    expect(rows()).toHaveLength(10);
    // Wired to nothing yet, it is listed last.
    expect(line(rows()[9])).toContain("10▣fuzz");
    expect(tags(rows()[9])).toEqual(["pool-b", "nightly"]);

    apply("add_edge", { edge: { from: "trigger", to: "fuzz", kind: "default" } });
    apply("add_edge", { edge: { from: "fuzz", to: "analyze", kind: "default" } });
    // Wired in ahead of analyze, it moves to where the graph puts it, and the numbers follow.
    expect(rows().map((row) => line(row).slice(0, 12))).toEqual(
      expect.arrayContaining([expect.stringMatching(/^02▣fuzz/), expect.stringMatching(/^03◆analyze/)]),
    );
    expect(card().querySelector(".copilot-stages__foot")).toHaveTextContent("10 stages");
  });

  it("changes a row when its stage is set, and removes it when its stage is removed", () => {
    renderCard();
    act(() => publishStreaming(SECURITY_PATCH_ID, true));

    apply("set_stage", {
      node: { id: "build", type: "infra", title: "build", config: { runner_pool: "pool-gpu" } },
    });
    expect(tags(rows()[4])).toEqual(["pool-gpu"]);

    apply("remove_stage", { id: "open-pr" }, 5);
    expect(rows()).toHaveLength(8);
    expect(card()).not.toHaveTextContent("open PR");
  });

  it("follows a new trigger, and ignores a proposed guard", () => {
    renderCard();
    act(() => publishStreaming(SECURITY_PATCH_ID, true));

    apply("set_trigger", { trigger: { event: "ticket_queued", conditions: { labels: ["cve"], effort_lte: "s" } } });
    expect(tags(rows()[0])).toEqual(["label:cve", "effort ≤ S"]);

    act(() =>
      publishOperation(SECURITY_PATCH_ID, {
        op: { kind: "set_guard", params: { guard: "spend_guard", params: { per_run_cap_cents: 900 } } },
        outcome: "proposed",
        draftRev: null,
        warnings: [],
      }),
    );
    expect(rows()).toHaveLength(9);
  });

  it("pills a stage the copilot adds at once, and warns on what the operation left unresolved", () => {
    renderCard();
    act(() => publishStreaming(SECURITY_PATCH_ID, true));

    act(() =>
      publishOperation(SECURITY_PATCH_ID, {
        op: {
          kind: "add_stage",
          params: { node: { id: "sbom", type: "llm", title: "sbom", config: { mode: "skill", skill: "sbom-diff" } } },
        },
        outcome: "applied",
        draftRev: 4,
        warnings: [
          {
            code: "reference.unknown_skill",
            node: "sbom",
            name: "sbom-diff",
            path: "/nodes/10/config/skill",
            message: "No skill named `sbom-diff` is defined in this workspace yet.",
          },
        ],
      }),
    );

    const added = rows()[9];
    expect(within(added).getByText("added by copilot")).toBeInTheDocument();
    expect(within(added).getByRole("button", { name: warningButtonName("skill:sbom-diff") })).toBeInTheDocument();
  });

  it("moves the revision tag with each applied batch", () => {
    renderCard();
    act(() => publishStreaming(SECURITY_PATCH_ID, true));

    apply("add_stage", { node: FUZZ }, 4);
    expect(within(card()).getByText("draft v0.4")).toBeInTheDocument();

    apply("remove_stage", { id: "fuzz" }, 5);
    expect(within(card()).getByText("draft v0.5")).toBeInTheDocument();
  });

  it("highlights the row an operation just added or changed, and no other", () => {
    renderCard();
    act(() => publishStreaming(SECURITY_PATCH_ID, true));

    apply("add_stage", { node: FUZZ });

    expect(rows().filter((row) => row.classList.contains("copilot-stages__row--fresh"))).toEqual([rows()[9]]);
  });

  it("takes the finished reply's draft when it arrives", () => {
    renderCard();
    act(() => publishStreaming(SECURITY_PATCH_ID, true));
    apply("add_stage", { node: FUZZ });

    act(() => {
      publishDraft(SECURITY_PATCH_ID, seededStageDraft({ label: "v0.4", etag: "etag-draft-4" }));
      publishStreaming(SECURITY_PATCH_ID, false);
    });

    // The service's draft did not keep it, so the list does not either.
    expect(rows()).toHaveLength(9);
    expect(within(card()).getByText("draft v0.4")).toBeInTheDocument();
  });

  it("is not overwritten by a route read from before the reply", () => {
    const { rerender } = renderCard();
    act(() => publishStreaming(SECURITY_PATCH_ID, true));
    apply("add_stage", { node: FUZZ }, 5);

    rerender(
      <StagesCard
        aliases={seededAliases()}
        currentVersion={null}
        draft={seededStageDraft({ label: "v0.4", etag: "etag-draft-4" })}
        name="security-patch"
        poll={{ read, visible: () => visible }}
        promotion={{ ok: true, value: copilotPromotion() }}
        slug="security-patch"
        workflowId={SECURITY_PATCH_ID}
      />,
    );

    expect(rows()).toHaveLength(10);
    expect(within(card()).getByText("draft v0.5")).toBeInTheDocument();
  });
});

describe("the poll", () => {
  it("asks this origin's route for this workflow's draft", async () => {
    renderCard();
    await land();

    expect(read).toHaveBeenCalledExactlyOnceWith(stagesEndpoint(SECURITY_PATCH_ID), null);
    expect(stagesEndpoint(SECURITY_PATCH_ID)).toBe(`/api/workflows/${SECURITY_PATCH_ID}/copilot/draft`);
  });

  it("asks again every fifteen seconds while the tab is visible", async () => {
    renderCard();
    await land();
    await interval();
    await interval();

    expect(read).toHaveBeenCalledTimes(3);
  });

  it("clears the pill when a later read says a person has edited the stage — with no reload", async () => {
    renderCard();
    await land();
    expect(within(rows()[6]).getByText("added by copilot")).toBeInTheDocument();

    answer = freshDraft(
      seededStageDraft({
        etag: "etag-draft-3-edited",
        nodeProvenance: seededProvenance().map((entry) => ({ ...entry, provenance: "human" as const })),
      }),
    );
    await interval();

    expect(screen.queryByText("added by copilot")).toBeNull();
    expect(rows()).toHaveLength(9);
  });

  it("clears the pill on a stage the stream added, when the read says it is a person's now", async () => {
    renderCard();
    act(() => publishStreaming(SECURITY_PATCH_ID, true));
    apply("add_stage", { node: FUZZ });
    expect(within(rows()[9]).getByText("added by copilot")).toBeInTheDocument();

    const definition = seededStageDraft().definition as { nodes: unknown[] };
    answer = freshDraft(
      seededStageDraft({
        label: "v0.4",
        etag: "etag-draft-4",
        definition: { ...definition, nodes: [...definition.nodes, FUZZ] },
        nodeProvenance: [...seededProvenance(), { nodeId: "fuzz", provenance: "human", addedRev: 4 }],
      }),
    );
    act(() => publishStreaming(SECURITY_PATCH_ID, false));
    await land();

    expect(rows()).toHaveLength(10);
    expect(within(rows()[9]).queryByText("added by copilot")).toBeNull();
  });

  it("shows a config change made on the canvas — the tags are composed from what was read", async () => {
    renderCard();
    await land();

    const definition = seededStageDraft().definition as { nodes: { id: string; config: Record<string, unknown> }[] };
    answer = freshDraft(
      seededStageDraft({
        etag: "etag-draft-3-pool",
        definition: {
          ...definition,
          nodes: definition.nodes.map((node) => (node.id === "build" ? { ...node, config: { runner_pool: "pool-gpu" } } : node)),
        },
      }),
    );
    await interval();

    expect(tags(rows()[4])).toEqual(["pool-gpu"]);
  });

  it("asks at once when the window regains focus", async () => {
    renderCard();
    await land();

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await land();

    expect(read).toHaveBeenCalledTimes(2);
  });

  it("does not ask while the tab is hidden, and asks at once when it is shown again", async () => {
    renderCard();
    await land();

    visible = false;
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await interval();
    await interval();
    expect(read).toHaveBeenCalledTimes(1);

    visible = true;
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await land();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("rests while a reply streams, and asks the moment it ends", async () => {
    renderCard();
    await land();

    act(() => publishStreaming(SECURITY_PATCH_ID, true));
    await interval();
    await interval();
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await land();
    expect(read).toHaveBeenCalledTimes(1);

    act(() => publishStreaming(SECURITY_PATCH_ID, false));
    await land();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("drops an answer that was in the air when the reply began", async () => {
    let release: (value: PollAnswer<CopilotStageDraft>) => void = () => {};
    read.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    renderCard();

    act(() => publishStreaming(SECURITY_PATCH_ID, true));
    apply("add_stage", { node: FUZZ });
    await act(async () => {
      release(freshDraft(seededStageDraft({ definition: null })));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(rows()).toHaveLength(10);
  });

  it("keeps the last good list under a quiet note when a read fails, and never an empty list", async () => {
    renderCard();
    await land();

    answer = { state: "failed", reason: "The draft could not be reached.", pollAfterSeconds: null };
    await interval();

    const note = within(card()).getByRole("status");
    expect(note).toHaveTextContent(STALE_HEADLINE);
    expect(note).toHaveTextContent("The draft could not be reached.");
    expect(rows()).toHaveLength(9);

    answer = freshDraft(seededStageDraft());
    fireEvent.click(within(note).getByRole("button", { name: STALE_RETRY_LABEL }));
    await land();

    expect(within(card()).queryByRole("status")).toBeNull();
  });

  it("stops asking when the card leaves", async () => {
    const { unmount } = renderCard();
    await land();
    unmount();
    await interval();

    expect(read).toHaveBeenCalledTimes(1);
  });
});

describe("with no stages", () => {
  it("draws the designed empty state for a workflow with no draft, with the way to the canvas", () => {
    renderCard({ draft: seededStageDraft({ definition: null, warnings: [], nodeProvenance: [], etag: "none", label: "v0.0" }) });

    expect(card()).toHaveTextContent(NO_STAGES_TITLE);
    expect(card()).toHaveTextContent(NO_STAGES_NOTE);
    expect(within(card()).getByRole("link", { name: OPEN_CANVAS_LABEL })).toHaveAttribute("href", workflowPath("security-patch"));
    expect(within(card()).queryByRole("list")).toBeNull();
    // No draft, so no revision to tag and nothing claimed about running it.
    expect(card()).not.toHaveTextContent(/draft v|runnable|stages ·/);
    expect(within(card()).getByRole("link", { name: VIEW_AS_CODE_LABEL })).toBeInTheDocument();
  });

  it("draws the same for a draft whose document is blank, with its revision", () => {
    renderCard({ draft: seededStageDraft({ definition: {}, warnings: [], nodeProvenance: [], label: "v0.1" }) });

    expect(card()).toHaveTextContent(NO_STAGES_TITLE);
    expect(within(card()).getByText("draft v0.1")).toBeInTheDocument();
  });

  it("fills in from the first operation of the first reply", () => {
    renderCard({ draft: seededStageDraft({ definition: null, warnings: [], nodeProvenance: [], etag: "none", label: "v0.0" }) });
    act(() => publishStreaming(SECURITY_PATCH_ID, true));

    apply("add_stage", { node: { id: "trigger", type: "trigger", title: "trigger", config: {} } }, 1);

    expect(rows()).toHaveLength(1);
    expect(card()).not.toHaveTextContent(NO_STAGES_TITLE);
    expect(within(card()).getByText("draft v0.1")).toBeInTheDocument();
  });
});

describe("accessibility", () => {
  it("is a named region holding one named, ordered list of nine items", () => {
    renderCard();

    const list = within(card()).getByRole("list", { name: STAGES_LABEL });

    expect(list.tagName).toBe("OL");
    expect(within(list).getAllByRole("listitem")).toHaveLength(9);
    expect(within(card()).getAllByRole("list")).toHaveLength(1);
  });

  it("scrolls inside its own wrapper: a named group a keyboard can focus", () => {
    renderCard();

    const scroller = within(card()).getByRole("group", { name: STAGES_SCROLL_LABEL });

    expect(scroller).toHaveAttribute("tabindex", "0");
    expect(scroller).toHaveClass("copilot-stages__scroll");
    expect(scroller).toContainElement(screen.getByRole("list", { name: STAGES_LABEL }));
  });

  it("hides the glyphs and the marks from a screen reader, and says the kind and the warning in words", () => {
    renderCard();

    for (const glyph of card().querySelectorAll(".copilot-stages__glyph")) expect(glyph).toHaveAttribute("aria-hidden", "true");
    expect(rows()[0]).toHaveTextContent("Trigger stage");
    expect(within(rows()[1]).getByText("warning:")).toHaveClass("sr-only");
  });

  it("adds no second region and no heading of its own inside the card", () => {
    renderCard();

    expect(within(card()).queryByRole("region")).toBeNull();
    expect(within(card()).getAllByRole("heading")).toHaveLength(1);
  });
});

describe("both palettes", () => {
  it.each(PALETTES)("renders the nine rows in the %s palette", (palette) => {
    renderInPalette(
      palette,
      <StagesCard
        aliases={seededAliases()}
        currentVersion={null}
        draft={seededStageDraft()}
        name="security-patch"
        poll={{ read, visible: () => visible }}
        promotion={{ ok: true, value: copilotPromotion() }}
        slug="security-patch"
        workflowId={SECURITY_PATCH_ID}
      />,
    );

    expect(document.documentElement).toHaveAttribute("data-theme", palette);
    expect(rows()).toHaveLength(9);
  });

  it("draws the same markup in both, because the palette is CSS's business", () => {
    const [light, dark] = renderInBothPalettes(
      <StagesCard
        aliases={seededAliases()}
        currentVersion={null}
        draft={seededStageDraft()}
        name="security-patch"
        poll={{ read, visible: () => visible }}
        promotion={{ ok: true, value: copilotPromotion() }}
        slug="security-patch"
        workflowId={SECURITY_PATCH_ID}
      />,
    );

    expect(light).toContain("copilot-stages__row");
    expect(maskIds(light ?? "")).toBe(maskIds(dark ?? ""));
  });
});
