import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DASHBOARD_PATH } from "@/app/paths";
import { LEAVE_CONFIRM, LEAVE_TITLE } from "@/app/settings/leave";
import { SAVED_NOTICE } from "@/app/settings/save-model";
import { IMMEDIATE_MARK } from "@/app/settings/view";
import { isLeaveGuarded, resetLeaveGuard } from "@/app/shell/leave-guard";

/**
 * The workshop's settings save model story (BS.1,
 * [#491](https://github.com/NobuData/ouroboros/issues/491), decision S7).
 *
 * The story exists so the save model's contract has one page where all of it is visibly true
 * before any card that owns a field has been built, and this suite holds it to that — driven
 * as a reader would drive it, over the real provider, bar, seats and leave guard. It is the
 * integration test of the save flow: `save-provider.test.tsx` steers a fixture write by write;
 * here the fixture service's two rules decide.
 */

/** Where the router is sent, and told to re-read. */
const push = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
  unstable_rethrow: () => {},
}));

const { SettingsSaveStory } = await import("@/app/workshop/settings-save-story");

/** Draw the story with writes that answer on the next turn. */
function story() {
  return render(<SettingsSaveStory latencyMs={0} />);
}

/** The head's Save button. */
function headSave(): HTMLElement {
  return within(document.querySelector(".settings__actions") as HTMLElement).getByRole("button", {
    name: /^(Save changes|Saving…)/,
  });
}

/** The dirty bar, or `null` on a clean page. */
function bar(): HTMLElement | null {
  return document.querySelector(".settings-dirty");
}

/**
 * Type into a field.
 *
 * @param label The field's label.
 * @param value What to set it to.
 */
function type(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

/** Press Save, and let every fixture write answer. */
async function save(): Promise<void> {
  await act(async () => {
    fireEvent.click(headSave());
  });
  // One turn per section's write, and one for the page to settle after the last.
  for (let turn = 0; turn < 4; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

beforeEach(() => {
  push.mockClear();
  refresh.mockClear();
  resetLeaveGuard();
  window.history.replaceState(null, "", "/workshop/settings-save");
});

describe("the story", () => {
  it("is honest about being a fixture, and draws the page's own frame", () => {
    story();

    expect(screen.getByText("Component workshop")).toHaveClass("ou-eyebrow");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Settings save model");
    expect(screen.getByText(/nothing here is written anywhere but this page/)).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveClass("settings");
  });

  it("mounts two batch sections and the Danger zone, each in its seat", () => {
    story();

    expect(document.getElementById("workspace")).toHaveClass("settings__seat--5");
    expect(document.getElementById("notifications")).toHaveClass("settings__seat--5");
    expect(
      within(document.getElementById("danger") as HTMLElement).getByText(IMMEDIATE_MARK),
    ).toBeInTheDocument();
    // The Danger zone holds no field.
    expect((document.getElementById("danger") as HTMLElement).querySelector("input")).toBeNull();
  });

  it("starts clean, on mockup 17's own values", () => {
    story();

    expect(screen.getByLabelText("Workspace name")).toHaveValue("acme-robotics");
    expect(screen.getByLabelText("Tenant domain")).toHaveValue("acme.ouroboros.dev");
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    expect(headSave()).toHaveTextContent(/^Save changes$/);
    expect(bar()).toBeNull();
  });
});

describe("an accurate count", () => {
  it("counts a text field and a switch alike, and says which section each is in", () => {
    story();

    type("Workspace name", "acme-2");
    fireEvent.click(screen.getByRole("switch"));

    expect(headSave()).toHaveTextContent("Save changes (2)");
    expect([...document.querySelectorAll(".settings__unsaved")].map((mark) => mark.textContent)).toEqual([
      "1 unsaved",
      "1 unsaved",
    ]);
    // A switch that waits for Save says so the moment it is moved — and has not been sent.
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
    expect(
      within(document.getElementById("notifications") as HTMLElement).getByText("unsaved"),
    ).toBeInTheDocument();
  });

  it("drops a switch flipped back, and a field retyped as it was", () => {
    story();

    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("switch"));
    type("Workspace name", "acme-2");
    type("Workspace name", "acme-robotics");

    expect(headSave()).toHaveTextContent(/^Save changes$/);
    expect(bar()).toBeNull();
  });
});

describe("saving", () => {
  it("commits both sections and leaves a clean page showing what was saved", async () => {
    story();
    type("Workspace name", "acme-2");
    type("Weekly report channel", "#eng-all");

    await save();

    expect(headSave()).toHaveTextContent(/^Save changes$/);
    expect(bar()).toBeNull();
    expect(screen.getByLabelText("Workspace name")).toHaveValue("acme-2");
    expect(screen.getByLabelText("Weekly report channel")).toHaveValue("#eng-all");
    expect(document.querySelector("p.sr-only[role='status']")).toHaveTextContent(SAVED_NOTICE);
  });

  it("stops the save in the browser when the name is empty: nothing is sent, anywhere", async () => {
    story();
    type("Workspace name", "");
    fireEvent.click(screen.getByRole("switch"));

    await save();

    expect(within(bar() as HTMLElement).getByRole("alert")).toHaveTextContent(
      "Nothing was saved. Workspace: Workspace name — A workspace needs a name.",
    );
    expect(screen.getByLabelText("Workspace name")).toHaveAccessibleDescription(
      expect.stringContaining("A workspace needs a name."),
    );
    expect(screen.getByLabelText("Workspace name")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Workspace name")).toHaveFocus();
    // The other section was not written: its switch is still unsaved.
    expect(headSave()).toHaveTextContent("Save changes (2)");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("stops at a refused first section, and does not send the one after it", async () => {
    story();
    type("Tenant domain", "taken.ouroboros.dev");
    fireEvent.click(screen.getByRole("switch"));

    await save();

    expect(within(bar() as HTMLElement).getByRole("alert")).toHaveTextContent(
      "Not saved — Workspace: Tenant domain — That domain is already used by another workspace. " +
        "Not sent: Notifications.",
    );
    expect(screen.getByLabelText("Tenant domain")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Tenant domain")).toHaveFocus();
    expect(headSave()).toHaveTextContent("Save changes (2)");
  });

  it("keeps a landed first section saved when the second is refused", async () => {
    story();
    type("Workspace name", "acme-2");
    type("Weekly report channel", "eng-leads");

    await save();

    expect(within(bar() as HTMLElement).getByRole("alert")).toHaveTextContent(
      "Not saved — Notifications: Weekly report channel — A channel starts with #. Saved: Workspace.",
    );
    // Workspace is saved and no longer counted; Notifications is still unsaved, with its error.
    expect(headSave()).toHaveTextContent("Save changes (1)");
    expect(screen.getByLabelText("Workspace name")).toHaveValue("acme-2");
    expect(screen.getByLabelText("Weekly report channel")).toHaveFocus();
    expect(
      within(document.getElementById("workspace") as HTMLElement).queryByText(/unsaved/),
    ).toBeNull();
  });

  it("saves the rest once the refused field is put right", async () => {
    story();
    type("Workspace name", "acme-2");
    type("Weekly report channel", "eng-leads");
    await save();

    type("Weekly report channel", "#eng-all");
    await save();

    expect(bar()).toBeNull();
    expect(screen.getByLabelText("Weekly report channel")).toHaveValue("#eng-all");
  });
});

describe("leaving", () => {
  it("is free on a clean page", () => {
    story();

    const swallow = (event: Event): void => {
      event.preventDefault();
    };
    window.addEventListener("click", swallow);
    fireEvent.click(screen.getByRole("link", { name: "go to the dashboard" }));
    window.removeEventListener("click", swallow);

    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("asks first with anything unsaved, and goes when told to", () => {
    story();
    type("Workspace name", "acme-2");

    fireEvent.click(screen.getByRole("link", { name: "go to the dashboard" }));

    const question = screen.getByRole("alertdialog", { name: LEAVE_TITLE });
    expect(push).not.toHaveBeenCalled();

    fireEvent.click(within(question).getByRole("button", { name: LEAVE_CONFIRM }));

    expect(push).toHaveBeenCalledExactlyOnceWith(DASHBOARD_PATH);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("viewing as a viewer", () => {
  it("draws the same values with nothing to operate, and no Save button", () => {
    story();

    fireEvent.click(screen.getByRole("button", { name: "View as a viewer" }));

    expect(screen.getByRole("button", { name: "View as a viewer" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: /Save changes/ })).toBeNull();
    expect(screen.getByLabelText("Workspace name")).toHaveValue("acme-robotics");
    expect(screen.getByLabelText("Workspace name")).toHaveAttribute("readonly");

    // Neither a keystroke nor a press changes anything, and nothing becomes unsaved.
    type("Workspace name", "acme-2");
    fireEvent.click(screen.getByRole("switch"));

    expect(screen.getByLabelText("Workspace name")).toHaveValue("acme-robotics");
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    expect(bar()).toBeNull();
  });

  it("holds no edit for a reader who stops being allowed to make one", () => {
    story();
    type("Workspace name", "acme-2");
    fireEvent.click(screen.getByRole("switch"));
    expect(headSave()).toHaveTextContent("Save changes (2)");

    fireEvent.click(screen.getByRole("button", { name: "View as a viewer" }));

    // Not hidden — gone: no bar offering a save the service would refuse, no unsaved drafts
    // in read-only fields, no leave guard armed over nothing.
    expect(bar()).toBeNull();
    expect(screen.getByLabelText("Workspace name")).toHaveValue("acme-robotics");
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    expect(document.querySelector(".settings__unsaved")).toBeNull();
    expect(isLeaveGuarded()).toBe(false);

    // And they do not come back with the role.
    fireEvent.click(screen.getByRole("button", { name: "View as a viewer" }));

    expect(headSave()).toHaveTextContent(/^Save changes$/);
    expect(screen.getByLabelText("Workspace name")).toHaveValue("acme-robotics");
  });
});
