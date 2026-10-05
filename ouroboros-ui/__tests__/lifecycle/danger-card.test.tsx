import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DisconnectPreview, WorkspaceLifecycle } from "@/app/api/settings-lifecycle";
import {
  DELETE_CONFIRM,
  DELETE_OWNER_ONLY,
  DISCONNECT_CONFIRM,
  DISCONNECT_DIALOG_TITLE,
  DISCONNECT_NEEDS_PREVIEW,
  DISCONNECT_ROLE_NOTE,
  DISCONNECTED_TITLE,
  PAUSE_CONFIRM,
  PAUSE_DIALOG_TITLE,
  PAUSE_ROLE_NOTE,
  PAUSE_WHY,
  PENDING_DELETE_NOTE,
  PREVIEW_LOADING,
  STEP_UP_NOTE,
  deleteConsequences,
  disconnectSummary,
  inFlightSentence,
  inFlightUnavailable,
  pauseState,
  previewUnavailable,
  typeNameReason,
} from "@/app/lifecycle/danger";
import type { LifecycleOutcome } from "@/app/lifecycle/outcome";
import { RECOVERY_PATH } from "@/app/paths";
import { PASSWORD_REQUIRED, STEP_UP_FAILED, STEP_UP_PASSWORD } from "@/app/providers/keys";
import { settingsAccess } from "@/app/settings/access";
import { IMMEDIATE_MARK } from "@/app/settings/view";
import { ThemeProvider } from "@/app/theme-provider";

import {
  disconnectPreview,
  lifecycle,
  pausedLifecycle,
  pendingDeleteLifecycle,
} from "../helpers/lifecycle";
import { maskIds, renderInBothPalettes } from "../helpers/palettes";

/**
 * The Danger zone card, rendered (BS.6, [#496](https://github.com/NobuData/ouroboros/issues/496)):
 * every destructive control gated as the issue specifies — the pause confirming with the live
 * in-flight count, the disconnect previewing real consequences behind a typed name, the delete
 * needing an owner, the exact name and the step-up — and the three role variants.
 */

type Outcome<T> = Promise<LifecycleOutcome<T>>;

const actions = {
  pauseWorkspace: vi.fn<() => Outcome<WorkspaceLifecycle>>(),
  resumeWorkspace: vi.fn<() => Outcome<WorkspaceLifecycle>>(),
  readDisconnectPreview: vi.fn<() => Outcome<DisconnectPreview>>(),
  disconnectWorkspace: vi.fn<() => Outcome<DisconnectPreview>>(),
  deleteWorkspace: vi.fn<(name: string, password?: string) => Outcome<WorkspaceLifecycle>>(),
};

vi.mock("@/app/lifecycle/lifecycle-actions", () => ({
  pauseWorkspace: () => actions.pauseWorkspace(),
  resumeWorkspace: () => actions.resumeWorkspace(),
  readDisconnectPreview: () => actions.readDisconnectPreview(),
  disconnectWorkspace: () => actions.disconnectWorkspace(),
  deleteWorkspace: (name: string, password?: string) => actions.deleteWorkspace(name, password),
}));

/** The shell's store, as the card sees it. */
const store = {
  lifecycle: null as WorkspaceLifecycle | null,
  apply: vi.fn<(next: WorkspaceLifecycle) => void>(),
  refresh: vi.fn<() => Promise<void>>(() => Promise.resolve()),
};

vi.mock("@/app/lifecycle/lifecycle-store", () => ({ useLifecycle: () => store }));

const replace = vi.fn<(path: string) => void>();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh: vi.fn(), push: vi.fn() }),
  unstable_rethrow: () => {},
}));

const { SettingsSaveProvider } = await import("@/app/settings/save-provider");
const { SettingsSeat } = await import("@/app/settings/settings-seat");
const { DangerCard } = await import("@/app/lifecycle/danger-card");

const NAME = "acme-robotics";

/** The paused fixture's state, in the row's words — from the fixture's own stamp. */
const PAUSED_SINCE = pauseState(pausedLifecycle());

/**
 * The card in its seat, for a reader.
 *
 * @param roles The reader's roles. Defaults to an owner.
 * @param read The lifecycle as the page read it. Defaults to an active workspace.
 * @returns The element.
 */
function card(
  roles: Parameters<typeof settingsAccess>[0] = ["owner"],
  read: WorkspaceLifecycle = lifecycle(),
) {
  return (
    <SettingsSaveProvider access={settingsAccess(roles)}>
      <SettingsSeat section="danger">
        <DangerCard lifecycle={read} workspaceName={NAME} />
      </SettingsSeat>
    </SettingsSaveProvider>
  );
}

/** Let every pending answer land. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 3; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/**
 * Press something, and let what it started answer.
 *
 * @param element What to press.
 */
async function press(element: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(element);
  });
  await settle();
}

/**
 * Type into a field.
 *
 * @param field The field.
 * @param value What to type.
 */
function type(field: HTMLElement, value: string): void {
  fireEvent.change(field, { target: { value } });
}

/** The seat the card is mounted in. */
function seat(): HTMLElement {
  return document.getElementById("danger") as HTMLElement;
}

/** The pause switch. */
function pauseSwitch(): HTMLElement {
  return within(seat()).getByRole("switch");
}

beforeEach(() => {
  for (const action of Object.values(actions)) action.mockReset();
  actions.readDisconnectPreview.mockResolvedValue({ ok: true, value: disconnectPreview() });
  store.lifecycle = null;
  store.apply.mockClear();
  store.refresh.mockClear();
  replace.mockClear();
});

describe("the card", () => {
  it("draws mockup 17's three rows in the error rim, marked as acting at once", () => {
    render(card());

    const region = screen.getByRole("region", { name: "Danger zone" });

    expect(region).toHaveClass("settings__card--danger");
    expect(within(region).getByText(IMMEDIATE_MARK)).toHaveClass("ou-tag");
    expect(within(region).getAllByRole("listitem").map((row) => row.firstChild?.textContent)).toEqual([
      "Pause all loops",
      "Disconnect GitHub App",
      "Delete workspace",
    ]);
    expect(within(region).getByText(PAUSE_WHY)).toBeInTheDocument();
    expect(within(region).getByText("open PRs remain, loops stop")).toBeInTheDocument();
    expect(
      within(region).getByText("type the workspace name to confirm · 30-day recovery window"),
    ).toBeInTheDocument();
    expect(within(region).getByRole("button", { name: `Delete ${NAME}…` })).toBeInTheDocument();
  });
});

describe("Pause all loops", () => {
  it("is a switch in the workspace's real position, said in words beside it", () => {
    render(card());

    expect(pauseSwitch()).toHaveAttribute("aria-checked", "false");
    expect(pauseSwitch()).toHaveAccessibleName("Pause all loops");
    expect(within(seat()).getAllByRole("status")[0]).toHaveTextContent("Running");
  });

  it("asks first: the semantics verbatim and the live in-flight count, read when it opens", async () => {
    let answer: (outcome: LifecycleOutcome<DisconnectPreview>) => void = () => {};
    actions.readDisconnectPreview.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    render(card());

    await act(async () => {
      fireEvent.click(pauseSwitch());
    });

    const dialog = screen.getByRole("alertdialog", { name: PAUSE_DIALOG_TITLE });

    // The read started in the press: the first paint is already "reading".
    expect(within(dialog).getByRole("status")).toHaveTextContent(PREVIEW_LOADING);
    expect(dialog).toHaveTextContent(PAUSE_WHY);
    expect(actions.pauseWorkspace).not.toHaveBeenCalled();

    await act(async () => {
      answer({ ok: true, value: disconnectPreview() });
    });

    expect(within(dialog).getByRole("status")).toHaveTextContent(inFlightSentence(2));
    expect(actions.readDisconnectPreview).toHaveBeenCalledOnce();
  });

  it("pauses on confirm, and hands the answer to the shell's store so the banner moves at once", async () => {
    actions.pauseWorkspace.mockResolvedValue({ ok: true, value: pausedLifecycle() });
    render(card());

    await press(pauseSwitch());
    await press(screen.getByRole("button", { name: PAUSE_CONFIRM }));

    expect(actions.pauseWorkspace).toHaveBeenCalledOnce();
    expect(store.apply).toHaveBeenCalledExactlyOnceWith(pausedLifecycle());
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("pauses nothing when the dialog is cancelled", async () => {
    render(card());

    await press(pauseSwitch());
    await press(screen.getByRole("button", { name: "Cancel" }));

    expect(actions.pauseWorkspace).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(pauseSwitch()).toHaveAttribute("aria-checked", "false");
  });

  it("stays confirmable when the count cannot be read, and says so", async () => {
    actions.readDisconnectPreview.mockResolvedValue({ ok: false, reason: "The service is restarting.", code: "unavailable" });
    actions.pauseWorkspace.mockResolvedValue({ ok: true, value: pausedLifecycle() });
    render(card());

    await press(pauseSwitch());

    expect(screen.getByRole("alertdialog")).toHaveTextContent(
      inFlightUnavailable("The service is restarting."),
    );

    await press(screen.getByRole("button", { name: PAUSE_CONFIRM }));

    expect(actions.pauseWorkspace).toHaveBeenCalledOnce();
  });

  it("keeps a refusal in the dialog with the service's sentence", async () => {
    actions.pauseWorkspace.mockResolvedValue({ ok: false, reason: "Already paused.", code: "workspace_state_conflict" });
    render(card());

    await press(pauseSwitch());
    await press(screen.getByRole("button", { name: PAUSE_CONFIRM }));

    const dialog = screen.getByRole("alertdialog");

    expect(within(dialog).getByRole("alert")).toHaveTextContent("Already paused.");
    expect(store.apply).not.toHaveBeenCalled();
  });

  it("sends one pause for two presses inside one frame", async () => {
    let answer: (outcome: LifecycleOutcome<WorkspaceLifecycle>) => void = () => {};
    actions.pauseWorkspace.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    render(card());

    await press(pauseSwitch());

    const confirm = screen.getByRole("button", { name: PAUSE_CONFIRM });
    await act(async () => {
      fireEvent.click(confirm);
      fireEvent.click(confirm);
    });

    expect(actions.pauseWorkspace).toHaveBeenCalledOnce();

    await act(async () => {
      answer({ ok: true, value: pausedLifecycle() });
    });
  });

  it("draws the store's fresher copy over the page's read", () => {
    store.lifecycle = pausedLifecycle();
    render(card(["owner"], lifecycle()));

    expect(pauseSwitch()).toHaveAttribute("aria-checked", "true");
    expect(pauseSwitch()).toHaveAccessibleName("Resume all loops");
    expect(within(seat()).getAllByRole("status")[0]).toHaveTextContent(
      PAUSED_SINCE,
    );
  });

  it("resumes at once — no dialog — and hands the answer to the store", async () => {
    actions.resumeWorkspace.mockResolvedValue({ ok: true, value: lifecycle() });
    render(card(["admin"], pausedLifecycle()));

    await press(pauseSwitch());

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(actions.resumeWorkspace).toHaveBeenCalledOnce();
    expect(actions.readDisconnectPreview).not.toHaveBeenCalled();
    expect(store.apply).toHaveBeenCalledExactlyOnceWith(lifecycle());
  });

  it("says a refused resume in the row, and leaves the switch where the workspace is", async () => {
    actions.resumeWorkspace.mockResolvedValue({ ok: false, reason: "Not paused.", code: "workspace_state_conflict" });
    render(card(["owner"], pausedLifecycle()));

    await press(pauseSwitch());

    expect(within(seat()).getByRole("alert")).toHaveTextContent("Not paused.");
    expect(pauseSwitch()).toHaveAttribute("aria-checked", "true");
    expect(store.apply).not.toHaveBeenCalled();
  });
});

describe("Disconnect GitHub App", () => {
  /** Open the dialog and let its preview land. */
  async function open(): Promise<HTMLElement> {
    await press(within(seat()).getByRole("button", { name: "Disconnect…" }));

    return screen.getByRole("alertdialog", { name: DISCONNECT_DIALOG_TITLE });
  }

  it("previews the consequences the service computed, as given", async () => {
    render(card(["admin"]));

    const dialog = await open();

    expect(within(dialog).getAllByRole("listitem").map((item) => item.textContent)).toEqual(
      disconnectPreview().consequences,
    );
  });

  it("reads the preview again on every open — live state is never kept", async () => {
    render(card());

    await open();
    await press(screen.getByRole("button", { name: "Cancel" }));
    actions.readDisconnectPreview.mockResolvedValue({
      ok: true,
      value: disconnectPreview({ consequences: ["5 open pull requests remain on GitHub, untouched."] }),
    });

    const dialog = await open();

    expect(actions.readDisconnectPreview).toHaveBeenCalledTimes(2);
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(1);
    expect(dialog).toHaveTextContent("5 open pull requests remain");
  });

  it("keeps Disconnect inert, with its reason, until the name is typed exactly", async () => {
    render(card());

    const dialog = await open();
    const confirm = within(dialog).getByRole("button", { name: DISCONNECT_CONFIRM });
    const field = within(dialog).getByLabelText(`Type ${NAME} to confirm`);

    expect(confirm).toHaveAttribute("aria-disabled", "true");
    expect(confirm).toHaveAttribute("title", typeNameReason(NAME));

    for (const near of ["Acme-Robotics", `${NAME} `, "acme-robotic"]) {
      type(field, near);
      expect(confirm, near).toHaveAttribute("aria-disabled", "true");
    }

    await press(confirm);
    expect(actions.disconnectWorkspace).not.toHaveBeenCalled();

    type(field, NAME);
    expect(confirm).not.toHaveAttribute("aria-disabled");
  });

  it("disconnects, summarises what it did from the answer, and has the store re-read", async () => {
    const ran = disconnectPreview({ activeRuns: 1 });
    actions.disconnectWorkspace.mockResolvedValue({ ok: true, value: ran });
    render(card());

    const dialog = await open();
    type(within(dialog).getByLabelText(`Type ${NAME} to confirm`), NAME);
    await press(within(dialog).getByRole("button", { name: DISCONNECT_CONFIRM }));

    const summary = screen.getByRole("dialog", { name: DISCONNECTED_TITLE });

    expect(actions.disconnectWorkspace).toHaveBeenCalledOnce();
    // The counts are the answer's — one run, not the preview's two.
    expect(within(summary).getAllByRole("listitem").map((item) => item.textContent)).toEqual(
      disconnectSummary(ran),
    );
    expect(store.refresh).toHaveBeenCalledOnce();

    await press(within(summary).getByRole("button", { name: "Done" }));

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("cannot be confirmed blind: with no preview the button says why, even with the name typed", async () => {
    actions.readDisconnectPreview.mockResolvedValue({ ok: false, reason: "Not yours.", code: "forbidden" });
    render(card());

    const dialog = await open();
    type(within(dialog).getByLabelText(`Type ${NAME} to confirm`), NAME);
    const confirm = within(dialog).getByRole("button", { name: DISCONNECT_CONFIRM });

    expect(dialog).toHaveTextContent(previewUnavailable("Not yours."));
    expect(confirm).toHaveAttribute("title", DISCONNECT_NEEDS_PREVIEW);

    await press(confirm);
    fireEvent.submit(dialog.querySelector("form") as HTMLFormElement);
    await settle();

    expect(actions.disconnectWorkspace).not.toHaveBeenCalled();
  });

  it("keeps a refusal in the dialog, beside the name the reader typed", async () => {
    actions.disconnectWorkspace.mockResolvedValue({ ok: false, reason: "Pending deletion.", code: "workspace_state_conflict" });
    render(card());

    const dialog = await open();
    const field = within(dialog).getByLabelText(`Type ${NAME} to confirm`);
    type(field, NAME);
    await press(within(dialog).getByRole("button", { name: DISCONNECT_CONFIRM }));

    expect(within(dialog).getByRole("alert")).toHaveTextContent("Pending deletion.");
    expect(field).toHaveValue(NAME);
    expect(store.refresh).not.toHaveBeenCalled();
  });
});

describe("Delete workspace", () => {
  /** Open the dialog. */
  async function open(): Promise<HTMLElement> {
    await press(within(seat()).getByRole("button", { name: `Delete ${NAME}…` }));

    return screen.getByRole("alertdialog", { name: `Delete ${NAME}?` });
  }

  /**
   * Type the name and press the confirming button.
   *
   * @param dialog The dialog.
   */
  async function confirm(dialog: HTMLElement): Promise<void> {
    type(within(dialog).getByLabelText(`Type ${NAME} to confirm`), NAME);
    await press(within(dialog).getByRole("button", { name: DELETE_CONFIRM }));
  }

  it("lists the consequences, with the recovery window the service reports", async () => {
    render(card());

    const dialog = await open();

    expect(within(dialog).getAllByRole("listitem").map((item) => item.textContent)).toEqual(
      deleteConsequences(30),
    );
  });

  it("requires the name exactly — a near miss sends nothing", async () => {
    render(card());

    const dialog = await open();
    const button = within(dialog).getByRole("button", { name: DELETE_CONFIRM });
    const field = within(dialog).getByLabelText(`Type ${NAME} to confirm`);

    for (const near of ["", "ACME-ROBOTICS", ` ${NAME}`, `${NAME}s`]) {
      type(field, near);
      expect(button, near).toHaveAttribute("aria-disabled", "true");
      fireEvent.submit(dialog.querySelector("form") as HTMLFormElement);
    }
    await settle();

    expect(actions.deleteWorkspace).not.toHaveBeenCalled();
  });

  it("deletes with the name alone when the session is recent, and leaves for the recovery screen", async () => {
    actions.deleteWorkspace.mockResolvedValue({ ok: true, value: pendingDeleteLifecycle() });
    render(card());

    await confirm(await open());

    expect(actions.deleteWorkspace).toHaveBeenCalledExactlyOnceWith(NAME, undefined);
    expect(replace).toHaveBeenCalledExactlyOnceWith(RECOVERY_PATH);
  });

  it("asks for the password when the service wants the step-up, and resends with it", async () => {
    actions.deleteWorkspace
      .mockResolvedValueOnce({ ok: false, reason: "Confirm it is you.", code: "step_up_required" })
      .mockResolvedValueOnce({ ok: true, value: pendingDeleteLifecycle() });
    render(card());

    const dialog = await open();

    expect(within(dialog).queryByLabelText(STEP_UP_PASSWORD)).toBeNull();

    await confirm(dialog);

    expect(dialog).toHaveTextContent(STEP_UP_NOTE);
    expect(replace).not.toHaveBeenCalled();

    const password = within(dialog).getByLabelText(STEP_UP_PASSWORD);
    expect(password).toHaveAttribute("type", "password");

    type(password, "hunter2");
    await press(within(dialog).getByRole("button", { name: DELETE_CONFIRM }));

    expect(actions.deleteWorkspace).toHaveBeenLastCalledWith(NAME, "hunter2");
    expect(replace).toHaveBeenCalledExactlyOnceWith(RECOVERY_PATH);
  });

  it("sends nothing for an empty password, and says to enter one", async () => {
    actions.deleteWorkspace.mockResolvedValueOnce({ ok: false, reason: "Confirm it is you.", code: "step_up_required" });
    render(card());

    const dialog = await open();
    await confirm(dialog);
    await press(within(dialog).getByRole("button", { name: DELETE_CONFIRM }));

    expect(actions.deleteWorkspace).toHaveBeenCalledOnce();
    expect(dialog).toHaveTextContent(PASSWORD_REQUIRED);
  });

  it("says a password did not confirm it, and keeps no password in the field", async () => {
    actions.deleteWorkspace.mockResolvedValue({ ok: false, reason: "Confirm it is you.", code: "step_up_required" });
    render(card());

    const dialog = await open();
    await confirm(dialog);

    const password = within(dialog).getByLabelText(STEP_UP_PASSWORD);
    type(password, "wrong");
    await press(within(dialog).getByRole("button", { name: DELETE_CONFIRM }));

    expect(dialog).toHaveTextContent(STEP_UP_FAILED);
    expect(password).toHaveValue("");
    expect(document.body.innerHTML).not.toContain("wrong");
    expect(replace).not.toHaveBeenCalled();
  });

  it("reports a name the service refuses under the name field", async () => {
    actions.deleteWorkspace.mockResolvedValue({
      ok: false,
      reason: "That is not this workspace's name.",
      code: "workspace_name_mismatch",
    });
    render(card());

    const dialog = await open();
    await confirm(dialog);

    const field = within(dialog).getByLabelText(`Type ${NAME} to confirm`);

    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription("That is not this workspace's name.");
    // Under the field, and not as a second, general refusal.
    expect(dialog.querySelector(".danger-zone__error")).toBeNull();
  });

  it("keeps any other refusal in the dialog", async () => {
    actions.deleteWorkspace.mockResolvedValue({ ok: false, reason: "Owners only.", code: "forbidden_role" });
    render(card());

    const dialog = await open();
    await confirm(dialog);

    expect(within(dialog).getByRole("alert")).toHaveTextContent("Owners only.");
    expect(replace).not.toHaveBeenCalled();
  });

  it("forgets the typed name and the step-up when cancelled", async () => {
    actions.deleteWorkspace.mockResolvedValueOnce({ ok: false, reason: "Confirm it is you.", code: "step_up_required" });
    render(card());

    await confirm(await open());
    await press(screen.getByRole("button", { name: "Cancel" }));

    const reopened = await open();

    expect(within(reopened).getByLabelText(`Type ${NAME} to confirm`)).toHaveValue("");
    expect(within(reopened).queryByLabelText(STEP_UP_PASSWORD)).toBeNull();
  });
});

describe("an admin", () => {
  it("may pause and disconnect, and is told deleting is an owner's — with no button", () => {
    render(card(["admin"]));

    expect(pauseSwitch()).toBeInTheDocument();
    expect(within(seat()).getByRole("button", { name: "Disconnect…" })).toBeInTheDocument();
    expect(within(seat()).getByText(DELETE_OWNER_ONLY)).toBeInTheDocument();
    expect(within(seat()).queryByRole("button", { name: /^Delete/ })).toBeNull();
  });
});

describe("a viewer", () => {
  it.each([["viewer"], ["member"]] as const)("as %s: the three rows as text, and who can act", (role) => {
    render(card([role]));

    expect(within(seat()).getAllByRole("listitem")).toHaveLength(3);
    expect(within(seat()).getAllByRole("status")[0]).toHaveTextContent("Running");
    expect(within(seat()).getByText(PAUSE_ROLE_NOTE)).toBeInTheDocument();
    expect(within(seat()).getByText(DISCONNECT_ROLE_NOTE)).toBeInTheDocument();
    expect(within(seat()).getByText(DELETE_OWNER_ONLY)).toBeInTheDocument();
  });

  it("is drawn no control at all — nothing switched off, nothing to press", () => {
    render(card(["viewer"], pausedLifecycle()));

    expect(within(seat()).queryByRole("switch")).toBeNull();
    expect(within(seat()).queryByRole("button")).toBeNull();
    expect(seat().querySelector("[aria-disabled='true'], [disabled]")).toBeNull();
    expect(within(seat()).getAllByRole("status")[0]).toHaveTextContent(
      PAUSED_SINCE,
    );
  });
});

describe("a workspace pending deletion", () => {
  it("offers no control, and leads to the recovery screen", () => {
    render(card(["owner"], pendingDeleteLifecycle()));

    expect(within(seat()).getByRole("note")).toHaveTextContent(PENDING_DELETE_NOTE);
    expect(within(seat()).getByRole("link")).toHaveAttribute("href", RECOVERY_PATH);
    expect(within(seat()).queryByRole("switch")).toBeNull();
    expect(within(seat()).queryByRole("button")).toBeNull();
  });
});

describe("both palettes", () => {
  it.each([
    ["an owner", ["owner"], lifecycle()],
    ["an admin", ["admin"], lifecycle()],
    ["a viewer", ["viewer"], lifecycle()],
    ["an owner, paused", ["owner"], pausedLifecycle()],
    ["a viewer, paused", ["viewer"], pausedLifecycle()],
  ] as const)("draws the same markup in both for %s", (_who, roles, read) => {
    const [light, dark] = renderInBothPalettes(<ThemeProvider>{card([...roles], read)}</ThemeProvider>);

    expect(maskIds(light!)).toBe(maskIds(dark!));
    expect(light).toContain("danger-zone__row");
  });
});
