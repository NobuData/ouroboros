import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkflowDefinition } from "@/app/api/workflows";
import { CONFLICT_NOTE, CONFLICT_TITLE, KEEP_LABEL, PENDING_NOTE, RELOAD_LABEL, SAVED_NOTE } from "@/app/workflows/autosave";
import { stageEntry } from "@/app/workflows/canvas/graph";
import { DRY_RUN_DIALOG_TITLE, RUN_LABEL, TICKET_LABEL } from "@/app/workflows/dry-run";
import { NOTHING_SELECTED_TITLE } from "@/app/workflows/inspector/inspector";
import { CHANGE_NOTE_LABEL, DISMISS_TOAST_LABEL, FINDINGS_LABEL, FINDINGS_MESSAGE } from "@/app/workflows/publish";
import { DRY_RUN_LABEL, canvasDefinition } from "@/app/workflows/view";

import { ISSUE_485, NOT_TAKEN_EXPLANATION, TAKEN_EXPLANATION, dryRunTickets, dryRunWalk } from "../helpers/dry-run";
import { shimReactFlow } from "../helpers/react-flow";
import {
  MOCKUP_ACTIVE_PATH,
  READ_AT,
  inspectorReadings,
  railEntry,
  standardFixDefinition,
  workflowDetail,
} from "../helpers/workflows";

/**
 * The studio's draft, publish and dry-run flows end to end in the page (#152) — the session, the head's
 * actions and subline, the editor on the real React Flow canvas, the dialogs and the toast, with the four
 * Server Actions standing in for the service.
 *
 * The ticket's acceptance criteria, each a case below:
 *
 * - **Edit → close the tab → reopen: the draft is intact** — hiding the page writes the edit at once, with
 *   the etag the page read; reopening is the stored draft, which is `data.ts`' read.
 * - **A stale draft write surfaces the reload dialog; nothing is silently overwritten.**
 * - **Publishing an invalid graph anchors each finding to a node, and clicking one selects that node.**
 * - **A successful publish bumps the version and updates the head.**
 * - **Dry run of the seeded `standard-fix` with `#485` highlights the mockup's exact active path**, and the
 *   side sheet explains both branches and the loop's bound (the sheet's own suite holds those sentences).
 * - **The dry-run overlay clears as soon as the graph is edited.**
 */

const saveDraft = vi.fn();
const publishWorkflow = vi.fn();
const dryRunWorkflow = vi.fn();
const sizedTickets = vi.fn();
const refresh = vi.fn();

vi.mock("@/app/workflows/draft-actions", () => ({
  saveDraft: (...args: unknown[]) => saveDraft(...args),
  publishWorkflow: (...args: unknown[]) => publishWorkflow(...args),
  dryRunWorkflow: (...args: unknown[]) => dryRunWorkflow(...args),
  sizedTickets: () => sizedTickets(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));

beforeAll(() => {
  shimReactFlow();
});

const { StudioSession } = await import("@/app/workflows/studio-session");
const { StudioEditor } = await import("@/app/workflows/studio-editor");
const { StudioActions } = await import("@/app/workflows/studio-actions");
const { StudioSubline } = await import("@/app/workflows/studio-subline");
const { StudioToast } = await import("@/app/workflows/studio-toast");

/** The mockup's four accent edges, as the canvas names its edges. */
const MOCKUP_ACTIVE_IDS = MOCKUP_ACTIVE_PATH.map(({ from, to }) => `${from}→${to}`);

/** Let React Flow's effects, the Server Actions' promises and their zero-delay timers run. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/**
 * Open the seeded `standard-fix` in a session, laid out as the studio lays it out.
 *
 * @param options Whether the reader may edit, and what Reload does.
 * @returns The render, settled, with the workflow and the reload spy.
 */
async function open({ mayAdminister = true, reload = vi.fn() } = {}) {
  const workflow = workflowDetail();
  const view = render(
    <StudioSession mayAdminister={mayAdminister} now={READ_AT} reload={reload} workflow={workflow}>
      <p data-testid="subline">
        <StudioSubline entry={railEntry()} fallback="" />
      </p>
      <div className="studio__actions">
        <StudioActions entry={railEntry()} mayAdminister={mayAdminister} />
      </div>
      <StudioToast />
      <div className="studio__grid">
        <StudioEditor
          definition={canvasDefinition(workflow)}
          inspector={inspectorReadings()}
          mayAdminister={mayAdminister}
          workflowId={workflow.id}
        />
      </div>
    </StudioSession>,
  );
  await settle();

  return { ...view, workflow, reload };
}

/** React Flow's wrapper for one stage. */
function stage(container: HTMLElement, id: string): HTMLElement {
  const found = container.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`);
  if (found === null) throw new Error(`no stage ${id}`);
  return found;
}

/** The ids of every edge drawn in the active treatment. */
function active(container: HTMLElement): string[] {
  return [...container.querySelectorAll(".react-flow__edge")]
    .filter((element) => element.querySelector(".studio-edge--active") !== null)
    .map((element) => element.getAttribute("data-id") ?? "");
}

/**
 * Move a stage five pixels right with the keyboard — React Flow's own move, and a real edit.
 *
 * @param container The render.
 * @param id The stage.
 */
async function move(container: HTMLElement, id: string): Promise<void> {
  const node = stage(container, id);
  node.focus();
  fireEvent.keyDown(node, { key: "Enter" });
  fireEvent.keyDown(node, { key: "ArrowRight" });
  await settle();
}

/** Hide the page, as closing or leaving the tab does. */
async function hidePage(): Promise<void> {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/**
 * A stage's position in a document.
 *
 * @param document The document.
 * @param id The stage.
 * @returns Its position.
 */
function positionOf(document: WorkflowDefinition, id: string): unknown {
  return (document.nodes as { id: string; position: unknown }[]).find((node) => node.id === id)?.position;
}

beforeEach(() => {
  saveDraft.mockReset().mockImplementation((_id: string, _etag: string, definition: WorkflowDefinition) =>
    Promise.resolve({ ok: true, value: { etag: "etag-2", definition, updatedAt: READ_AT } }),
  );
  publishWorkflow.mockReset();
  dryRunWorkflow.mockReset().mockResolvedValue({ ok: true, value: dryRunWalk() });
  sizedTickets.mockReset().mockResolvedValue({ ok: true, value: dryRunTickets() });
  refresh.mockReset();
});

afterEach(() => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
});

describe("autosave", () => {
  it("writes nothing for the draft the page opened on", async () => {
    await open();

    expect(saveDraft).not.toHaveBeenCalled();
    expect(screen.queryByText(PENDING_NOTE)).toBeNull();
    expect(screen.getByTestId("subline")).not.toHaveTextContent("draft edits");
  });

  it("writes an edit the moment the tab is hidden, guarded by the page's etag, and the head says draft edits", async () => {
    const { container, workflow } = await open();

    await move(container, "implement");

    expect(screen.getByText(PENDING_NOTE)).toBeInTheDocument();
    expect(screen.getByTestId("subline")).toHaveTextContent("Last edited 2h ago · v14 · draft edits · used by 42% of runs.");

    await hidePage();

    await waitFor(() => expect(screen.getByText(SAVED_NOTE)).toBeInTheDocument());
    expect(saveDraft).toHaveBeenCalledOnce();
    const [id, etag, written] = saveDraft.mock.calls[0] as [string, string, WorkflowDefinition];
    expect(id).toBe(workflow.id);
    expect(etag).toBe(workflow.draft.etag);
    expect(positionOf(written, "implement")).toEqual({ x: 593, y: 420 });
    expect(screen.getByTestId("subline")).toHaveTextContent("Last edited 0s ago · v14 · draft edits");
  });

  it("opens the reload dialog on a stale write, sends nothing more, and reloads when asked", async () => {
    saveDraft.mockResolvedValue({
      ok: false,
      refusal: {
        code: "workflow_draft_conflict",
        message: "This draft was changed in the code editor. Reload it before saving again.",
        details: { expected: "etag-1", current: "etag-9", editedIn: "code", updatedAt: "2026-09-13T11:58:00.000Z" },
      },
    });
    const { container, reload } = await open();

    await move(container, "implement");
    await hidePage();

    const dialog = await screen.findByRole("dialog", { name: CONFLICT_TITLE });
    expect(dialog).toHaveTextContent(/in the code editor/);
    expect(dialog).toHaveTextContent(/nothing was overwritten/);

    fireEvent.click(within(dialog).getByRole("button", { name: RELOAD_LABEL }));
    expect(reload).toHaveBeenCalledOnce();
    expect(saveDraft).toHaveBeenCalledOnce();
  });

  it("keeps the page readable after Not now, says autosave is paused, and writes no later edit", async () => {
    saveDraft.mockResolvedValue({
      ok: false,
      refusal: { code: "workflow_draft_conflict", message: "Changed.", details: { editedIn: "visual" } },
    });
    const { container } = await open();

    await move(container, "implement");
    await hidePage();
    fireEvent.click(within(await screen.findByRole("dialog", { name: CONFLICT_TITLE })).getByRole("button", { name: KEEP_LABEL }));
    await settle();

    expect(screen.queryByRole("dialog", { name: CONFLICT_TITLE })).toBeNull();
    expect(screen.getByText(CONFLICT_NOTE)).toBeInTheDocument();

    await move(container, "plan");
    await hidePage();
    expect(saveDraft).toHaveBeenCalledOnce();
  });
});

describe("publishing", () => {
  it("anchors each finding of an invalid graph to its stage, and a finding selects the stage it names", async () => {
    publishWorkflow.mockResolvedValue({
      ok: false,
      refusal: {
        code: "workflow_definition_invalid",
        message: "This definition cannot be published yet.",
        details: {
          findings: [
            { source: "engine", code: "unreachable_node", message: "Nothing reaches this stage.", node: "implement" },
            { source: "dsl", code: "structure.terminal_missing", message: "A workflow needs a terminal.", path: "" },
          ],
        },
      },
    });
    const { container } = await open();
    const title = stageEntry(standardFixDefinition(), "implement")?.title ?? "";

    fireEvent.click(screen.getByRole("button", { name: "Publish v15" }));
    const dialog = screen.getByRole("dialog", { name: "Publish v15" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Publish v15" }));

    expect(await within(dialog).findByText(FINDINGS_MESSAGE)).toBeInTheDocument();
    const findings = within(dialog).getByRole("list", { name: FINDINGS_LABEL });
    // The finding about the document as a whole is listed, and has nowhere to go.
    expect(within(findings).getByText("A workflow needs a terminal.").closest("button")).toBeNull();
    expect(within(findings).getAllByRole("button")).toHaveLength(1);

    fireEvent.click(within(findings).getByRole("button", { name: new RegExp(`Select ${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) }));
    await settle();

    expect(screen.queryByRole("dialog", { name: "Publish v15" })).toBeNull();
    expect(stage(container, "implement")).toHaveClass("selected");
    expect(screen.getByRole("heading", { level: 2, name: title })).toBeInTheDocument();
  });

  it("bumps the version, updates the head, leaves a toast, and refreshes the rail", async () => {
    const { workflow } = await open();
    publishWorkflow.mockResolvedValue({
      ok: true,
      value: {
        version: 15,
        definition: standardFixDefinition(),
        changeNote: "Added the review gate.",
        publishedAt: READ_AT,
        publishedBy: "9f1c0a5e0f6d4a1b9d5e2b8f3c7a4e10",
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Publish v15" }));
    const dialog = screen.getByRole("dialog", { name: "Publish v15" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: CHANGE_NOTE_LABEL }), {
      target: { value: "  Added the review gate.  " },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Publish v15" }));

    expect(await screen.findByText(/^Published v15\./)).toBeInTheDocument();
    expect(publishWorkflow).toHaveBeenCalledExactlyOnceWith(workflow.id, "Added the review gate.");
    expect(screen.queryByRole("dialog", { name: "Publish v15" })).toBeNull();
    expect(screen.getByRole("button", { name: "Publish v16" })).toBeInTheDocument();
    expect(screen.getByTestId("subline")).toHaveTextContent("· v15 · used by 42% of runs.");
    expect(refresh).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: DISMISS_TOAST_LABEL }));
    expect(screen.queryByText(/^Published v15\./)).toBeNull();
  });

  it("writes a waiting edit before it publishes, so the version is the picture on the screen", async () => {
    const { container } = await open();
    publishWorkflow.mockResolvedValue({
      ok: true,
      value: { version: 15, definition: {}, changeNote: null, publishedAt: READ_AT, publishedBy: null },
    });

    await move(container, "implement");
    fireEvent.click(screen.getByRole("button", { name: "Publish v15" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Publish v15" })).getByRole("button", { name: "Publish v15" }));

    await waitFor(() => expect(publishWorkflow).toHaveBeenCalledOnce());
    expect(saveDraft).toHaveBeenCalledOnce();
    expect(saveDraft.mock.invocationCallOrder[0]).toBeLessThan(publishWorkflow.mock.invocationCallOrder[0]);
  });

  it("publishes nothing when the waiting edit meets a conflict, and says why", async () => {
    saveDraft.mockResolvedValue({
      ok: false,
      refusal: { code: "workflow_draft_conflict", message: "Changed.", details: {} },
    });
    const { container } = await open();

    await move(container, "implement");
    fireEvent.click(screen.getByRole("button", { name: "Publish v15" }));
    const dialog = screen.getByRole("dialog", { name: "Publish v15" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Publish v15" }));

    expect(await screen.findByRole("dialog", { name: CONFLICT_TITLE })).toBeInTheDocument();
    expect(publishWorkflow).not.toHaveBeenCalled();
  });
});

describe("the dry run", () => {
  /**
   * Open the picker, keep its default, and run.
   *
   * @returns The sheet.
   */
  async function dryRun(): Promise<HTMLElement> {
    fireEvent.click(screen.getByRole("button", { name: DRY_RUN_LABEL }));
    const dialog = screen.getByRole("dialog", { name: DRY_RUN_DIALOG_TITLE });
    const picker = await within(dialog).findByRole("combobox", { name: TICKET_LABEL });

    expect(picker).toHaveValue(ISSUE_485);
    fireEvent.click(within(dialog).getByRole("button", { name: RUN_LABEL }));

    const sheet = await screen.findByRole("complementary", { name: "Dry run with issue #485" });
    await settle();
    return sheet;
  }

  it("walks seeded standard-fix for #485 and paints the mockup's exact active path, with the step sheet", async () => {
    const { container, workflow } = await open();

    const sheet = await dryRun();

    expect(dryRunWorkflow).toHaveBeenCalledExactlyOnceWith(workflow.id, ISSUE_485);
    expect(active(container)).toEqual(MOCKUP_ACTIVE_IDS);
    expect(within(sheet).getByText(TAKEN_EXPLANATION)).toBeInTheDocument();
    expect(within(sheet).getByText(NOT_TAKEN_EXPLANATION)).toBeInTheDocument();
    expect(within(sheet).getByText(/at most 2 times/)).toBeInTheDocument();
    // The sheet takes the inspector's track while the walk is on the canvas.
    expect(screen.queryByText(NOTHING_SELECTED_TITLE)).toBeNull();
    // Nothing was edited, so nothing was written first.
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it("clears the overlay as soon as the graph is edited", async () => {
    const { container } = await open();
    await dryRun();

    await move(container, "plan");

    expect(active(container)).toEqual([]);
    expect(screen.queryByRole("complementary", { name: "Dry run with issue #485" })).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: stageEntry(standardFixDefinition(), "plan")?.title })).toBeInTheDocument();
  });

  it("selects a step's stage on the canvas and keeps the sheet open", async () => {
    const { container } = await open();
    const sheet = await dryRun();

    fireEvent.click(within(sheet).getByRole("button", { name: "Effort re-check" }));
    await settle();

    expect(stage(container, "effort-recheck")).toHaveClass("selected");
    expect(screen.getByRole("complementary", { name: "Dry run with issue #485" })).toBeInTheDocument();
    expect(active(container)).toEqual(MOCKUP_ACTIVE_IDS);
  });

  it("is a member's too — it writes nothing — while Publish is not drawn", async () => {
    await open({ mayAdminister: false });

    expect(screen.queryByRole("button", { name: /^Publish v/ })).toBeNull();
    await dryRun();

    expect(dryRunWorkflow).toHaveBeenCalledOnce();
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it("keeps a refusal in the picker, and paints nothing", async () => {
    dryRunWorkflow.mockResolvedValue({
      ok: false,
      refusal: { code: "engine_unavailable", message: "The engine is unavailable.", details: {} },
    });
    const { container } = await open();

    fireEvent.click(screen.getByRole("button", { name: DRY_RUN_LABEL }));
    const dialog = screen.getByRole("dialog", { name: DRY_RUN_DIALOG_TITLE });
    await within(dialog).findByRole("combobox", { name: TICKET_LABEL });
    fireEvent.click(within(dialog).getByRole("button", { name: RUN_LABEL }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/engine could not walk/);
    expect(active(container)).toEqual([]);
  });
});
