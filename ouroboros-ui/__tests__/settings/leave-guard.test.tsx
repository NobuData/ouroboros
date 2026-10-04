import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { settingsAccess } from "@/app/settings/access";
import { LEAVE_CANCEL, LEAVE_CONFIRM, LEAVE_TITLE, leaveBody } from "@/app/settings/leave";
import type { SectionCommitResult } from "@/app/settings/save-model";
import { isLeaveGuarded, requestLeave, resetLeaveGuard } from "@/app/shell/leave-guard";

/**
 * The guard on leaving the settings page with unsaved changes (BS.1,
 * [#491](https://github.com/NobuData/ouroboros/issues/491), decision S7): armed only while
 * something is unsaved, and then it asks before a link, a shell departure or the tab itself
 * takes the reader away.
 */

/** Where the router is sent once the reader agrees to leave. */
const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  unstable_rethrow: () => {},
}));

const { SettingsLeaveGuard } = await import("@/app/settings/leave-guard");
const { SettingsSaveProvider, useSettingsSection } = await import("@/app/settings/save-provider");
const { SettingsSeat } = await import("@/app/settings/settings-seat");

/**
 * One field, to make the page dirty with.
 *
 * @returns The field.
 */
function NameField() {
  const fields = useSettingsSection<{ name: string }>({
    baseline: { name: "acme-robotics" },
    commit: (): Promise<SectionCommitResult> => Promise.resolve({ ok: true }),
  });

  return (
    <>
      <label htmlFor={fields.id("name")}>name</label>
      <input
        id={fields.id("name")}
        onChange={(event) => {
          fields.set("name", event.target.value);
        }}
        value={fields.values.name}
      />
    </>
  );
}

/**
 * Draw a page with the guard, a field, and the links a reader might leave by.
 *
 * @param roles The reader's roles. Defaults to an owner.
 * @returns The render result.
 */
function page(roles: Parameters<typeof settingsAccess>[0] = ["owner"]) {
  return render(
    <SettingsSaveProvider access={settingsAccess(roles)}>
      <SettingsLeaveGuard />
      <SettingsSeat section="workspace">
        <NameField />
      </SettingsSeat>
      <a href="/dashboard">Dashboard</a>
      <a href="/settings/sources?from=hub#list">Sources</a>
      <a href="#policies">Policies</a>
      <a href="/dashboard" rel="noreferrer" target="_blank">
        Dashboard in a new tab
      </a>
      <a href="https://github.com/NobuData/ouroboros">GitHub</a>
      <a href="/dashboard">
        <span data-inner>Dashboard, by its inner element</span>
      </a>
    </SettingsSaveProvider>,
  );
}

/** Make the page dirty. */
function edit(value = "acme-2"): void {
  fireEvent.change(screen.getByLabelText("name"), { target: { value } });
}

/**
 * Press a link, and say whether the browser was left to follow it.
 *
 * The answer is read by a listener at the far end of the event's path: a press the guard
 * stopped never arrives there, and one it let through arrives with its default intact. That
 * listener then prevents the default itself, only so jsdom does not try to navigate.
 *
 * @param element The link, or something inside it.
 * @param init The click's modifiers.
 * @returns `true` when the press reached the end of its path unprevented.
 */
function press(element: Element, init: MouseEventInit = {}): boolean {
  let followed = false;
  const atTheEnd = (event: Event): void => {
    followed = !event.defaultPrevented;
    event.preventDefault();
  };

  window.addEventListener("click", atTheEnd);
  act(() => {
    fireEvent.click(element, init);
  });
  window.removeEventListener("click", atTheEnd);

  return followed;
}

/** The question, when it is being asked. */
function dialog(): HTMLElement | null {
  return screen.queryByRole("alertdialog", { name: LEAVE_TITLE });
}

beforeEach(() => {
  push.mockClear();
  resetLeaveGuard();
  window.history.replaceState(null, "", "/settings");
});

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("a clean page", () => {
  it("is not listened to at all: links are followed and nothing is asked", () => {
    page();

    expect(press(screen.getByRole("link", { name: "Dashboard" }))).toBe(true);
    expect(dialog()).toBeNull();
    expect(isLeaveGuarded()).toBe(false);
  });

  it("lets the tab unload without a prompt", () => {
    page();

    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });
});

describe("a page with unsaved changes", () => {
  it("stops a link to another page and asks first", () => {
    page();
    edit();

    expect(press(screen.getByRole("link", { name: "Dashboard" }))).toBe(false);

    const question = dialog() as HTMLElement;

    expect(question).toHaveTextContent(leaveBody(1));
    expect(within(question).getByRole("heading", { level: 2 })).toHaveTextContent(LEAVE_TITLE);
    expect(push).not.toHaveBeenCalled();
  });

  it("stays, with the edit as it was, when the reader stays", () => {
    page();
    edit();
    press(screen.getByRole("link", { name: "Dashboard" }));

    fireEvent.click(within(dialog() as HTMLElement).getByRole("button", { name: LEAVE_CANCEL }));

    expect(dialog()).toBeNull();
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByLabelText("name")).toHaveValue("acme-2");
  });

  it("goes where the link said when the reader leaves", () => {
    page();
    edit();
    press(screen.getByRole("link", { name: "Sources" }));

    fireEvent.click(within(dialog() as HTMLElement).getByRole("button", { name: LEAVE_CONFIRM }));

    // The whole destination — its query and its fragment — as the link carried it.
    expect(push).toHaveBeenCalledExactlyOnceWith("/settings/sources?from=hub#list");
    expect(dialog()).toBeNull();
  });

  it("leaves the discarding to the leaving: the edits are not dropped ahead of it", () => {
    // Leaving unmounts the page, and that is what discards them. A departure that does not
    // happen — a workspace switch the service refuses — must leave the reader's edits intact.
    page();
    edit();
    press(screen.getByRole("link", { name: "Sources" }));

    fireEvent.click(within(dialog() as HTMLElement).getByRole("button", { name: LEAVE_CONFIRM }));

    expect(screen.getByLabelText("name")).toHaveValue("acme-2");
  });

  it("hears a press on something inside a link", () => {
    page();
    edit();

    expect(press(document.querySelector("[data-inner]") as HTMLElement)).toBe(false);
    expect(dialog()).not.toBeNull();
  });

  it("stops the press before the router's own click handling can hear it", () => {
    page();
    edit();
    const heard = vi.fn();
    document.addEventListener("click", heard);

    press(screen.getByRole("link", { name: "Dashboard" }));

    expect(heard).not.toHaveBeenCalled();
    document.removeEventListener("click", heard);
  });

  it("leaves a fragment of this page alone — the section nav discards nothing", () => {
    page();
    edit();

    expect(press(screen.getByRole("link", { name: "Policies" }))).toBe(true);
    expect(dialog()).toBeNull();
  });

  it("leaves a press that opens the link elsewhere alone", () => {
    page();
    edit();

    expect(press(screen.getByRole("link", { name: "Dashboard" }), { metaKey: true })).toBe(true);
    expect(press(screen.getByRole("link", { name: "Dashboard" }), { ctrlKey: true })).toBe(true);
    expect(press(screen.getByRole("link", { name: "Dashboard in a new tab" }))).toBe(true);
    expect(dialog()).toBeNull();
  });

  it("leaves another origin to the browser's own prompt", () => {
    page();
    edit();

    expect(press(screen.getByRole("link", { name: "GitHub" }))).toBe(true);
    expect(dialog()).toBeNull();
  });

  it("holds the tab's own unload with the browser's prompt", () => {
    page();
    edit();

    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it("is asked by the shell's own departures, and lets one through on leave", () => {
    page();
    edit();
    const proceed = vi.fn();

    expect(isLeaveGuarded()).toBe(true);

    // The command palette, a workspace switch, signing out.
    act(() => {
      requestLeave(proceed);
    });

    expect(proceed).not.toHaveBeenCalled();
    expect(dialog()).toHaveTextContent(leaveBody(1));

    fireEvent.click(within(dialog() as HTMLElement).getByRole("button", { name: LEAVE_CONFIRM }));

    expect(proceed).toHaveBeenCalledOnce();
    expect(dialog()).toBeNull();
    // Still the reader's, should the departure be refused and the page stay.
    expect(screen.getByLabelText("name")).toHaveValue("acme-2");
  });

  it("proceeds once, however the answer is pressed", () => {
    page();
    edit();
    const proceed = vi.fn();
    act(() => {
      requestLeave(proceed);
    });
    const confirm = within(dialog() as HTMLElement).getByRole("button", { name: LEAVE_CONFIRM });

    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(proceed).toHaveBeenCalledOnce();
  });

  it("keeps a shell departure from happening when the reader stays", () => {
    page();
    edit();
    const proceed = vi.fn();
    act(() => {
      requestLeave(proceed);
    });

    fireEvent.click(within(dialog() as HTMLElement).getByRole("button", { name: LEAVE_CANCEL }));

    expect(proceed).not.toHaveBeenCalled();
    expect(screen.getByLabelText("name")).toHaveValue("acme-2");
  });

  it("stays on Escape, as a dialog does", () => {
    page();
    edit();
    press(screen.getByRole("link", { name: "Dashboard" }));

    fireEvent.keyDown(dialog() as HTMLElement, { key: "Escape" });

    expect(dialog()).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });
});

describe("once nothing is unsaved again", () => {
  it("stops asking: the listeners and the shell's guard are released", () => {
    page();
    edit();
    edit("acme-robotics");

    expect(isLeaveGuarded()).toBe(false);
    expect(press(screen.getByRole("link", { name: "Dashboard" }))).toBe(true);

    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it("releases everything when the page unmounts with edits still on it", () => {
    // A back traversal, which nothing can hold: the page is simply gone, and must not go on
    // prompting on whatever page replaced it.
    const view = page();
    edit();
    expect(isLeaveGuarded()).toBe(true);

    view.unmount();

    expect(isLeaveGuarded()).toBe(false);

    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("a reader who may not edit", () => {
  it("is never asked: their page cannot hold an edit", () => {
    page(["viewer"]);
    edit();

    expect(isLeaveGuarded()).toBe(false);
    expect(press(screen.getByRole("link", { name: "Dashboard" }))).toBe(true);
    expect(dialog()).toBeNull();
  });
});
