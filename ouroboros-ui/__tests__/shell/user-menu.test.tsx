import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  MENU_USER,
  authStub,
  menuWorkspaces,
  signedIn,
  signedOut,
  stillLoading,
} from "../helpers/account";
import { renderThemed } from "../helpers/theme";
import { FONT_SCALE_ATTRIBUTE, setFontScale } from "@/app/font-scale";

/**
 * The account menu, now that it has a session to draw
 * ([#721](https://github.com/NobuData/ouroboros/issues/721)).
 *
 * The suite it replaces was about the *interaction* alone, because the contents were
 * placeholders: "Not signed in", a settings item that could not act, and a sign-out waiting
 * for sessions to exist. Those cases are still here — the interaction did not change, which
 * was the point of building it before there was anything to put in it — and around them are
 * the four the issue is actually about: the menu reflects the seeded user, switching workspace
 * updates the route without a reload, signing out goes through the server, and every part of
 * it is reachable from the keyboard.
 *
 * ### What is stubbed, and what is not
 *
 * The two hooks and `setActive`, through `helpers/account.ts`. Everything else in
 * `app/api/auth-client.ts` is the real module — `unwrap` above all, so a refusal is
 * translated by the code that ships rather than by the suite. The Server Action is stubbed
 * because it is a `"use server"` module over a `server-only` client; what it *does* is
 * `__tests__/shell/actions.test.ts`.
 */

vi.mock("@/app/api/auth-client", async () =>
  (await import("../helpers/account")).authClientModule(),
);

/** What tells the server that the session moved. */
const refresh = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

/** The Server Action the sign-out form submits to. */
const signOutOfSession = vi.fn();

vi.mock("@/app/shell/actions", () => ({ signOutOfSession: () => signOutOfSession() }));

/** The Server Action the stepper persists through — stubbed for the reason `actions` is. */
const { saveFontScale } = vi.hoisted(() => ({
  saveFontScale: vi.fn<(scale: string) => Promise<boolean>>().mockResolvedValue(true),
}));

vi.mock("@/app/shell/preference-actions", () => ({
  readFontScale: vi.fn().mockResolvedValue("100"),
  saveFontScale: (scale: string) => saveFontScale(scale),
}));

const { UserMenu } = await import("@/app/shell/user-menu");

/** The three seeded workspaces, and the one a fresh session acts in. */
const WORKSPACES = menuWorkspaces();

/** Open the menu and hand back its two controls. */
function open() {
  const trigger = screen.getByRole("button", { name: /^Account menu/ });
  fireEvent.click(trigger);
  return { trigger, menu: screen.getByRole("menu", { name: "Account" }) };
}

/** Open the menu and its workspace submenu, and hand back all three. */
function openSwitcher() {
  const opened = open();
  const switcher = screen.getByRole("menuitem", { name: /^Switch workspace/ });
  fireEvent.click(switcher);
  return { ...opened, switcher, submenu: screen.getByRole("menu", { name: "Switch workspace" }) };
}

beforeEach(() => {
  signedIn();
  refresh.mockClear();
  signOutOfSession.mockClear();
});

describe("the avatar", () => {
  it("starts closed, and says so on the button", () => {
    renderThemed(<UserMenu />);

    expect(screen.queryByRole("menu")).toBeNull();
    const trigger = screen.getByRole("button", { name: /^Account menu/ });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("names the signed-in person and the workspace they are acting in", () => {
    // The issue's first criterion, answered without opening anything: the button is an icon,
    // so its accessible name is all a screen reader has to go on.
    renderThemed(<UserMenu />);

    expect(
      screen.getByRole("button", { name: "Account menu — Ken Suenobu, acme-robotics" }),
    ).toBeInTheDocument();
  });

  it("draws the monogram when the account carries no picture", () => {
    const { container } = renderThemed(<UserMenu />);

    expect(container.querySelector(".shell-avatar__initials")).toHaveTextContent("KS");
    expect(container.querySelector("img")).toBeNull();
  });

  it("draws the picture when the identity provider sent one", () => {
    authStub.session.data = {
      user: { ...MENU_USER, image: "https://avatars.test/ken.png" },
      session: { activeOrganizationId: WORKSPACES[0].id },
    };

    const { container } = renderThemed(<UserMenu />);
    const picture = container.querySelector("img");

    expect(picture).toHaveAttribute("src", "https://avatars.test/ken.png");
    // Decorative: the button's own name is the person, and a second reading would be noise.
    expect(picture).toHaveAttribute("alt", "");
    // The page somebody is on is not the identity provider's business.
    expect(picture).toHaveAttribute("referrerpolicy", "no-referrer");
  });

  it("falls back to the monogram when the picture fails to load", () => {
    // A remote image is a third party's uptime, and the browser's broken-image glyph in a
    // 30px circle reads as a bug in this product rather than as an avatar that did not come.
    authStub.session.data = {
      user: { ...MENU_USER, image: "https://avatars.test/gone.png" },
      session: { activeOrganizationId: WORKSPACES[0].id },
    };

    const { container } = renderThemed(<UserMenu />);
    fireEvent.error(container.querySelector("img")!);

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector(".shell-avatar__initials")).toHaveTextContent("KS");
  });
});

describe("what the menu says about the session", () => {
  it("states who is signed in", () => {
    renderThemed(<UserMenu />);
    open();

    expect(screen.getByText("Ken Suenobu")).toBeInTheDocument();
    expect(screen.getByText("ken@acme-robotics.dev")).toBeInTheDocument();
  });

  it("claims nothing while the session is still being read", () => {
    stillLoading();
    renderThemed(<UserMenu />);
    open();

    expect(screen.getByText(/Loading your session/)).toBeInTheDocument();
    expect(screen.queryByText("Ken Suenobu")).toBeNull();
  });

  it("says nobody is signed in once the session has answered so", () => {
    // What the browser holds between a sign-out and the navigation after it. A menu still
    // naming somebody then would be the one place in the product claiming a session that has
    // been revoked.
    signedOut();
    renderThemed(<UserMenu />);
    open();

    expect(screen.getByText("Not signed in.")).toBeInTheDocument();
  });
});

describe("the workspace switcher", () => {
  it("offers the active workspace as a submenu when there is somewhere to go", () => {
    renderThemed(<UserMenu />);
    open();

    const switcher = screen.getByRole("menuitem", { name: /^Switch workspace/ });
    expect(switcher).toHaveAccessibleName("Switch workspace acme-robotics");
    expect(switcher).toHaveAttribute("aria-haspopup", "menu");
    expect(switcher).toHaveAttribute("aria-expanded", "false");
  });

  it("states the workspace as a fact when there is nowhere to switch to", () => {
    // The honesty rule (§ 3.5): a chooser whose only option is the one already chosen is a
    // control that cannot be changed, so the name is said and nothing pretends to be pressable.
    authStub.organizations.data = [WORKSPACES[0]];
    renderThemed(<UserMenu />);
    open();

    expect(screen.queryByRole("menuitem", { name: /^Switch workspace/ })).toBeNull();
    expect(screen.getByText("acme-robotics")).toBeInTheDocument();
  });

  it("lists every workspace as a radio, with the active one checked", () => {
    renderThemed(<UserMenu />);
    const { switcher } = openSwitcher();

    expect(switcher).toHaveAttribute("aria-expanded", "true");

    // Scoped to the submenu: since CP.3 the menu itself carries three more radios — the
    // theme's — and this case is about the workspaces alone.
    const choices = within(
      screen.getByRole("menu", { name: "Switch workspace" }),
    ).getAllByRole("menuitemradio");
    expect(choices.map((choice) => choice.textContent)).toEqual([
      "acme-robotics",
      "acme-labs",
      "kensuenobu",
    ]);
    expect(choices[0]).toHaveAttribute("aria-checked", "true");
    expect(choices[1]).toHaveAttribute("aria-checked", "false");
  });

  it("points the item at the submenu it controls", () => {
    renderThemed(<UserMenu />);
    const { switcher, submenu } = openSwitcher();

    expect(switcher.getAttribute("aria-controls")).toBe(submenu.getAttribute("id"));
  });

  it("moves the session, then tells the server without a navigation", async () => {
    // The issue's second criterion. `setActive` is what writes
    // `session."activeOrganizationId"`, which is what `ouroboros-rest` scopes a request by
    // (#713); `refresh()` is what re-renders the route's Server Components against it.
    renderThemed(<UserMenu />);
    openSwitcher();

    fireEvent.click(screen.getByRole("menuitemradio", { name: "acme-labs" }));

    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(authStub.setActive).toHaveBeenCalledWith({ organizationId: WORKSPACES[1].id });
  });

  it("closes and hands focus back to the avatar once the move lands", async () => {
    renderThemed(<UserMenu />);
    const { trigger } = openSwitcher();

    fireEvent.click(screen.getByRole("menuitemradio", { name: "acme-labs" }));

    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it("announces the move, which is the only report a screen reader gets of it", async () => {
    renderThemed(<UserMenu />);
    openSwitcher();

    fireEvent.click(screen.getByRole("menuitemradio", { name: "acme-labs" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Workspace: acme-labs."),
    );
  });

  it("spends no request on the workspace the session is already in", async () => {
    renderThemed(<UserMenu />);
    const { switcher } = openSwitcher();

    fireEvent.click(screen.getByRole("menuitemradio", { name: "acme-robotics" }));

    await waitFor(() => expect(screen.queryByRole("menu", { name: "Switch workspace" })).toBeNull());
    expect(authStub.setActive).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    // Pressing the checked radio is a confirmation, so it leaves the submenu and stays put.
    expect(document.activeElement).toBe(switcher);
  });

  it("renders a refusal rather than replacing the screen with an error page", async () => {
    // The menu is chrome. Throwing would reach the route's error boundary and take away the
    // screen the person is still entitled to be on, over one workspace that would not open.
    authStub.setActive.mockResolvedValue({
      data: null,
      error: { status: 403, code: "FORBIDDEN", message: "You are not a member of that organization." },
    });

    renderThemed(<UserMenu />);
    openSwitcher();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "acme-labs" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You are not a member of that organization.",
    );
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("menu", { name: "Account" })).toBeInTheDocument();
  });

  it("ignores a second press while the first is still in flight", async () => {
    // Two `set-active` calls racing would leave the session in whichever finished last, which
    // is not necessarily the one that was pressed last.
    let land = () => {};
    authStub.setActive.mockReturnValue(
      new Promise((resolve) => {
        land = () => resolve({ data: {}, error: null });
      }),
    );

    renderThemed(<UserMenu />);
    openSwitcher();

    fireEvent.click(screen.getByRole("menuitemradio", { name: "acme-labs" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "kensuenobu" }));

    expect(authStub.setActive).toHaveBeenCalledOnce();
    await act(async () => land());
  });
});

describe("signing out", () => {
  it("submits to the server rather than clearing anything here", () => {
    // The criterion is that the session row is deleted, and only the server can do that —
    // along with two `HttpOnly` cookies and `ouro_tenant`, which script cannot touch at all.
    renderThemed(<UserMenu />);
    open();

    const item = screen.getByRole("menuitem", { name: "Sign out" });
    expect(item).toHaveAttribute("type", "submit");
    expect(item.closest("form")).not.toBeNull();
  });

  it("is no longer marked unavailable, because it can act now", () => {
    renderThemed(<UserMenu />);
    open();

    expect(screen.getByRole("menuitem", { name: "Sign out" })).not.toHaveAttribute(
      "aria-disabled",
    );
  });

  it("leaves the settings item marked unavailable, with the reason it cannot act", () => {
    // #491 is the screen. A control that cannot act says why, and stays in the tab order to
    // be able to (§ 3.5).
    renderThemed(<UserMenu />);
    open();

    const item = screen.getByRole("menuitem", { name: "Workspace settings" });
    expect(item).toHaveAttribute("aria-disabled", "true");
    expect(item).not.toBeDisabled();
    expect(item.getAttribute("title")).toMatch(/arrive with #491/);
  });
});

/**
 * The interaction, unchanged from #41 — which was the argument for building it before there
 * was anything to put in the menu.
 */
describe("opening and dismissing", () => {
  it("opens from the avatar and moves focus into the menu", () => {
    renderThemed(<UserMenu />);
    const { trigger } = open();

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(document.activeElement).toBe(screen.getAllByRole("menuitem")[0]);
  });

  it("points the button at the menu it controls", () => {
    renderThemed(<UserMenu />);
    const { trigger, menu } = open();

    expect(trigger.getAttribute("aria-controls")).toBe(menu.getAttribute("id"));
  });

  it("closes again on a second press", () => {
    renderThemed(<UserMenu />);
    const { trigger } = open();

    fireEvent.click(trigger);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("re-opens in the state a menu opens in, whatever was left open inside it", () => {
    // A submenu still expanded from last time is a menu that opens differently depending on
    // what somebody did minutes ago, which is the kind of state a reader cannot see and
    // cannot predict.
    renderThemed(<UserMenu />);
    const { trigger } = openSwitcher();

    fireEvent.click(trigger);
    fireEvent.click(trigger);

    expect(screen.queryByRole("menu", { name: "Switch workspace" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: /^Switch workspace/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("closes on Escape and gives focus back to the avatar", () => {
    renderThemed(<UserMenu />);
    const { trigger, menu } = open();

    fireEvent.keyDown(menu, { key: "Escape" });

    expect(screen.queryByRole("menu")).toBeNull();
    // Without this the keyboard would be left on the document body, which is the same as
    // being nowhere.
    expect(document.activeElement).toBe(trigger);
  });

  it("closes when the pointer goes somewhere else", () => {
    renderThemed(
      <>
        <UserMenu />
        <button type="button">elsewhere</button>
      </>,
    );
    open();

    fireEvent.pointerDown(screen.getByRole("button", { name: "elsewhere" }));

    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("stays open when the pointer lands inside it", () => {
    renderThemed(<UserMenu />);
    const { menu } = open();

    fireEvent.pointerDown(menu);

    expect(screen.getByRole("menu", { name: "Account" })).toBeInTheDocument();
  });

  it("closes when the keyboard tabs out, without fighting the browser for focus", () => {
    renderThemed(<UserMenu />);
    const { menu } = open();

    fireEvent.keyDown(menu, { key: "Tab" });

    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("the keyboard", () => {
  it("walks the items with the arrow keys, wrapping at both ends", () => {
    renderThemed(<UserMenu />);
    const { menu } = open();
    const items = screen.getAllByRole("menuitem");

    expect(items.length).toBeGreaterThan(1);
    expect(document.activeElement).toBe(items[0]);

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);

    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(document.activeElement).toBe(items[0]);

    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(document.activeElement).toBe(items[items.length - 1]);
  });

  it("jumps to the ends with Home and End", () => {
    renderThemed(<UserMenu />);
    const { menu } = open();
    const items = screen.getAllByRole("menuitem");

    fireEvent.keyDown(menu, { key: "End" });
    expect(document.activeElement).toBe(items[items.length - 1]);

    fireEvent.keyDown(menu, { key: "Home" });
    expect(document.activeElement).toBe(items[0]);
  });

  it("opens the submenu with Right and lands on its first choice", () => {
    renderThemed(<UserMenu />);
    const { menu } = open();

    // Since CP.3 the first item is the stepper, so Right has to be pressed *on the
    // switcher* — which is also an assertion: Right anywhere else opens nothing.
    screen.getByRole("menuitem", { name: /^Switch workspace/ }).focus();
    fireEvent.keyDown(menu, { key: "ArrowRight" });

    expect(document.activeElement).toBe(
      within(screen.getByRole("menu", { name: "Switch workspace" })).getAllByRole(
        "menuitemradio",
      )[0],
    );
  });

  it("comes back out of the submenu with Left, landing where it was opened from", () => {
    renderThemed(<UserMenu />);
    const { menu, switcher, submenu } = openSwitcher();
    within(submenu).getAllByRole("menuitemradio")[0].focus();

    fireEvent.keyDown(menu, { key: "ArrowLeft" });

    expect(screen.queryByRole("menu", { name: "Switch workspace" })).toBeNull();
    expect(document.activeElement).toBe(switcher);
  });

  it("closes the submenu on Escape, not the whole menu", () => {
    // Innermost first: a choice still being made is not a menu to be dismissed.
    renderThemed(<UserMenu />);
    const { menu, switcher, submenu } = openSwitcher();
    within(submenu).getAllByRole("menuitemradio")[0].focus();

    fireEvent.keyDown(menu, { key: "Escape" });

    expect(screen.queryByRole("menu", { name: "Switch workspace" })).toBeNull();
    expect(screen.getByRole("menu", { name: "Account" })).toBeInTheDocument();
    expect(document.activeElement).toBe(switcher);
  });

  it("walks the submenu's choices as part of the same list while it is open", () => {
    // The roving focus reads the DOM rather than a list held in a ref, which is what makes
    // the choices part of the walk the moment they exist and absent from it the moment they
    // do not.
    renderThemed(<UserMenu />);
    const { menu, switcher, submenu } = openSwitcher();
    switcher.focus();

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(within(submenu).getAllByRole("menuitemradio")[0]);

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(within(submenu).getAllByRole("menuitemradio")[1]);
  });
});

describe("the font-size stepper (#645)", () => {
  beforeEach(() => {
    // Each case starts at the default the engine boots to; the engine is a module-level
    // singleton, so the step a previous case landed on would otherwise carry over.
    setFontScale("100");
    saveFontScale.mockClear();
  });

  it("offers the two steps as items of the menu itself", () => {
    renderThemed(<UserMenu />);
    open();

    expect(screen.getByRole("menuitem", { name: "Smaller text" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Larger text" })).toBeInTheDocument();
  });

  it("applies a step live, then persists it — in that order by design", () => {
    // "Live preview as you step": the stamp lands before the round trip is even started,
    // so the press is the preview.
    renderThemed(<UserMenu />);
    open();

    fireEvent.click(screen.getByRole("menuitem", { name: "Larger text" }));

    expect(document.documentElement.getAttribute(FONT_SCALE_ATTRIBUTE)).toBe("112.5");
    expect(saveFontScale).toHaveBeenCalledWith("112.5");
  });

  it("announces the size a press lands on", () => {
    renderThemed(<UserMenu />);
    open();

    fireEvent.click(screen.getByRole("menuitem", { name: "Larger text" }));

    expect(screen.getByRole("status")).toHaveTextContent("Font size 112.5%.");
  });

  it("keeps the menu open, because stepping is repeated", () => {
    renderThemed(<UserMenu />);
    open();

    fireEvent.click(screen.getByRole("menuitem", { name: "Larger text" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Larger text" }));

    expect(screen.getByRole("menu", { name: "Account" })).toBeInTheDocument();
    expect(document.documentElement.getAttribute(FONT_SCALE_ATTRIBUTE)).toBe("125");
  });

  it("says no at the ends without leaving the ring", () => {
    // aria-disabled, never disabled: the button keeps its place in the arrow walk and its
    // explanation, and a press changes nothing rather than erroring.
    renderThemed(<UserMenu />);
    open();

    const smaller = screen.getByRole("menuitem", { name: "Smaller text" });
    fireEvent.click(smaller);
    expect(document.documentElement.getAttribute(FONT_SCALE_ATTRIBUTE)).toBe("87.5");

    expect(smaller).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(smaller);
    expect(document.documentElement.getAttribute(FONT_SCALE_ATTRIBUTE)).toBe("87.5");
    expect(saveFontScale).toHaveBeenCalledTimes(1);
  });

  it("is walked by the same arrows as every other item", () => {
    renderThemed(<UserMenu />);
    const { menu } = open();

    // Opening put focus on the first item, which since CP.3 is the smaller-text step.
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Smaller text" }));

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Larger text" }));
  });
});

describe("the theme control (#645, over the #17 engine)", () => {
  it("offers the three choices as radios, with the current one checked", () => {
    renderThemed(<UserMenu />);
    open();

    const radios = within(screen.getByRole("group", { name: "Theme" })).getAllByRole(
      "menuitemradio",
    );
    expect(radios.map((radio) => radio.textContent)).toEqual(["Light", "Dark", "System"]);
    // A fresh provider is at the default, which is system.
    expect(radios[2]).toHaveAttribute("aria-checked", "true");
  });

  it("switches the palette through the engine, and announces it", () => {
    // The engine's stamp on <html> is the proof this is #17's machinery and not a second
    // implementation: nothing in the menu writes that attribute.
    renderThemed(<UserMenu />);
    open();

    fireEvent.click(within(screen.getByRole("group", { name: "Theme" })).getByRole(
      "menuitemradio",
      { name: "Dark" },
    ));

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(screen.getByRole("status")).toHaveTextContent("Theme: dark.");
    expect(
      within(screen.getByRole("group", { name: "Theme" })).getByRole("menuitemradio", {
        name: "Dark",
      }),
    ).toHaveAttribute("aria-checked", "true");
  });
});

describe("the role in the identity block (#645)", () => {
  it("names it beside the address once the plugin has answered", async () => {
    renderThemed(<UserMenu />);
    open();

    // signedIn() seeds Ken as the owner of acme-robotics — § 1.1's "ken@… · owner".
    await waitFor(() => expect(screen.getByText(/· owner/)).toBeInTheDocument());
  });

  it("stands the address alone until then", () => {
    // The fetch has not resolved inside this synchronous render: no role, no guess.
    authStub.getActiveMemberRole.mockReturnValue(new Promise(() => {}));
    renderThemed(<UserMenu />);
    open();

    expect(screen.getByText("ken@acme-robotics.dev")).toBeInTheDocument();
    expect(screen.queryByText(/·/)).toBeNull();
  });

  it("changes with the acting workspace, because the fetch is keyed on it", async () => {
    renderThemed(<UserMenu />);
    open();
    await waitFor(() => expect(screen.getByText(/· owner/)).toBeInTheDocument());

    // The session moves to the second workspace, where Ken is merely a viewer.
    authStub.getActiveMemberRole.mockResolvedValue({ data: { role: "viewer" }, error: null });
    act(() => {
      authStub.session = {
        data: { user: { ...MENU_USER }, session: { activeOrganizationId: WORKSPACES[1].id } },
        isPending: false,
      };
    });
    fireEvent.click(screen.getByRole("button", { name: /^Account menu/ })); // close…
    fireEvent.click(screen.getByRole("button", { name: /^Account menu/ })); // …and reopen

    await waitFor(() => expect(screen.getByText(/· viewer/)).toBeInTheDocument());
  });

  it("says nothing rather than failing when the plugin refuses", async () => {
    authStub.getActiveMemberRole.mockResolvedValue({
      data: null,
      error: { status: 500, message: "no" },
    });
    renderThemed(<UserMenu />);
    open();

    await waitFor(() => expect(authStub.getActiveMemberRole).toHaveBeenCalled());
    expect(screen.getByText("ken@acme-robotics.dev")).toBeInTheDocument();
    expect(screen.queryByText(/· \w/)).toBeNull();
  });
});

describe("the keyboard-shortcuts sheet (#645)", () => {
  it("opens from the menu item, over the pane, with the menu closed behind it", () => {
    renderThemed(<UserMenu />);
    open();

    fireEvent.click(screen.getByRole("menuitem", { name: "Keyboard shortcuts" }));

    // The sheet is a dialog through ShellOverlay — portal, scroll lock, trap, all its.
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeInTheDocument();
    // And not two layers of "which does Escape close": the menu went first.
    expect(screen.queryByRole("menu", { name: "Account" })).toBeNull();
  });

  it("lists only bindings that exist, the search shortcut among them", () => {
    renderThemed(<UserMenu />);
    open();
    fireEvent.click(screen.getByRole("menuitem", { name: "Keyboard shortcuts" }));

    const sheet = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    // The palette shortcut, in the platform's own spelling — the same hint the pill shows.
    expect(within(sheet).getByText(/⌘K|Ctrl K/)).toBeInTheDocument();
    expect(within(sheet).getByText("Open search")).toBeInTheDocument();
    expect(within(sheet).getByText(/Close a menu, drawer or dialog/)).toBeInTheDocument();
  });

  it("closes on Escape with focus back on the avatar", () => {
    // The menu item that opened it no longer exists, so the overlay's own restoration
    // would find its opener unmounted — the menu hands focus to the avatar instead.
    renderThemed(<UserMenu />);
    const { trigger } = open();
    fireEvent.click(screen.getByRole("menuitem", { name: "Keyboard shortcuts" }));

    fireEvent.keyDown(screen.getByRole("dialog", { name: "Keyboard shortcuts" }), {
      key: "Escape",
    });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
