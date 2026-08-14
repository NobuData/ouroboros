import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authStub, menuWorkspaces, signedIn, signedOut, stillLoading } from "../helpers/account";
import { renderInBothPalettes } from "../helpers/palettes";

/**
 * The tenant chip, now that it switches things (H.1,
 * [#77](https://github.com/NobuData/ouroboros/issues/77)).
 *
 * CP.1 shipped it as a statement — a slug, no caret — because "a caret on a control that does
 * not open is the kind of lie the design system's honesty rule (§ 3.5) is aimed at". This is
 * the issue that earns the caret, so most of this suite is new and the three cases about the
 * em dash are the ones that survive: the chip is still a statement in the one state where
 * there is nothing to switch *from*.
 *
 * The issue's criteria, one group each: the chip renders the workspace and the focus
 * repository; switching workspace repaints the route without a reload; the focus repository
 * persists per workspace; and every part of it is reachable from the keyboard with the menu
 * labelled for assistive technology.
 *
 * ### What is stubbed
 *
 * The two session hooks and `setActive`, through `helpers/account.ts` — the same stub the
 * account menu's suite uses, because the two components read the same stores. The repository
 * listing is a Server Action over a `server-only` client, so it is replaced here and what it
 * *does* is `__tests__/shell/repo-actions.test.ts`.
 */

vi.mock("@/app/api/auth-client", async () =>
  (await import("../helpers/account")).authClientModule(),
);

/** What tells the server that the session moved. */
const refresh = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

/** What the repository listing answers, per case. */
const { readFocusRepos } = vi.hoisted(() => ({ readFocusRepos: vi.fn() }));

vi.mock("@/app/shell/repo-actions", () => ({ readFocusRepos: () => readFocusRepos() }));

const { TenantChip } = await import("@/app/shell/tenant-chip");
const { FOCUS_REPO_STORAGE_KEY, resetFocusRepos, setFocusRepo } = await import(
  "@/app/shell/focus-repo"
);

/** The three seeded workspaces; the first is the one a fresh session acts in. */
const WORKSPACES = menuWorkspaces();

/** The seeded repositories of `acme-robotics`, as the enablement list reports them. */
const HELIOS = {
  id: "5eed0006-0000-4000-8000-000000000001",
  name: "helios-firmware",
  login: "acme-robotics",
};
const ATLAS = {
  id: "5eed0006-0000-4000-8000-000000000004",
  name: "atlas-scheduler",
  login: "acme-robotics",
};

/** Open the chip's menu and hand back both controls. */
function open() {
  const trigger = screen.getByRole("button", { name: /^Workspace and focus repository/ });
  fireEvent.click(trigger);

  return { trigger, menu: screen.getByRole("menu", { name: "Workspace and focus repository" }) };
}

/**
 * Open the menu and one of its submenus.
 *
 * @param name Which branch — the item's own name, which is also its submenu's label.
 * @returns The chip, the menu, the branch item and the submenu.
 */
function openBranch(name: "Switch workspace" | "Focus repository") {
  const opened = open();
  const branch = screen.getByRole("menuitem", { name: new RegExp(`^${name}`) });
  fireEvent.click(branch);

  return { ...opened, branch, submenu: screen.getByRole("menu", { name }) };
}

/** Wait for the repository listing to have arrived. */
async function listed() {
  await waitFor(() => expect(readFocusRepos).toHaveBeenCalled());
}

beforeEach(() => {
  signedIn();
  refresh.mockClear();
  window.localStorage.clear();
  resetFocusRepos();
  readFocusRepos.mockReset();
  readFocusRepos.mockResolvedValue({
    ok: true,
    organizationId: WORKSPACES[0].id,
    repos: [HELIOS, ATLAS],
  });
});

afterEach(() => {
  window.localStorage.clear();
  resetFocusRepos();
});

describe("what the chip says", () => {
  it("draws the workspace and the focus repository, in the mockup's two parts", () => {
    // `.tenant-chip`: muted organization, bright repository. The separator travels with the
    // organization, which is the half that truncates first.
    const { container } = render(<TenantChip />);

    expect(container.querySelector(".shell-tenant__org")).toHaveTextContent("acme-robotics /");
    expect(container.querySelector(".shell-tenant__repo")).toHaveTextContent("All repos");
  });

  it("says all repositories when nothing has been focused", () => {
    render(<TenantChip />);

    expect(screen.getByRole("button", { name: /All repos$/ })).toBeInTheDocument();
  });

  it("draws the repository this workspace was left focused on", () => {
    setFocusRepo(WORKSPACES[0].id, { id: HELIOS.id, name: HELIOS.name });

    const { container } = render(<TenantChip />);

    expect(container.querySelector(".shell-tenant__repo")).toHaveTextContent("helios-firmware");
  });

  it("carries both names in its own, containing the words a reader can see", () => {
    // WCAG 2.5.3 Label in Name: somebody driving the product by voice says what they can
    // see, so the accessible name has to hold the visible text verbatim.
    setFocusRepo(WORKSPACES[0].id, { id: HELIOS.id, name: HELIOS.name });
    render(<TenantChip />);

    expect(
      screen.getByRole("button", {
        name: "Workspace and focus repository: acme-robotics / helios-firmware",
      }),
    ).toBeInTheDocument();
  });

  it("is a control that opens a menu, and says so before it is opened", () => {
    render(<TenantChip />);
    const trigger = screen.getByRole("button", { name: /^Workspace and focus repository/ });

    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("renders identically under both palettes", () => {
    // The criterion is *"the chip renders … in both themes"*, and this is what a unit test
    // can honestly say about it: jsdom applies no stylesheet, so what is provable here is
    // that the chip expresses the theme **entirely in CSS** — the property that lets the
    // boot script paint it before hydration. `helpers/palettes.tsx` argues it at length; the
    // colours themselves are `scripts/verify-tokens.sh`'s question.
    setFocusRepo(WORKSPACES[0].id, { id: HELIOS.id, name: HELIOS.name });

    const [light, dark] = renderInBothPalettes(<TenantChip />);

    expect(dark).toBe(light);
  });

  it("shows the other workspace's own focus when the session moves", () => {
    // Per organization, which is the criterion: a repository belongs to one workspace, and
    // carrying a choice into another would be a filter naming something that is not there.
    setFocusRepo(WORKSPACES[0].id, { id: HELIOS.id, name: HELIOS.name });
    setFocusRepo(WORKSPACES[1].id, { id: "repo-labs", name: "labs-sandbox" });
    signedIn(WORKSPACES[1].id);

    const { container } = render(<TenantChip />);

    expect(container.querySelector(".shell-tenant__repo")).toHaveTextContent("labs-sandbox");
  });
});

describe("when there is nothing true to write", () => {
  it("shows an em dash while the session is still answering", () => {
    stillLoading();
    render(<TenantChip />);

    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows an em dash when nobody is signed in", () => {
    // Unreachable from inside the shell, and real for the moment between a sign-out and the
    // navigation after it — the same window `app/shell/account.ts` describes.
    signedOut();
    render(<TenantChip />);

    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows an em dash when the session points at a workspace the listing does not hold", () => {
    // A pointer is a reference rather than a fact (`app/api/identity.ts`): somebody removed
    // from a workspace still has a session naming it.
    signedIn("org_gone");
    render(<TenantChip />);

    expect(screen.getByText("—")).toBeInTheDocument();
    for (const workspace of WORKSPACES) {
      expect(screen.queryByText(workspace.slug)).toBeNull();
    }
  });

  it("is a statement rather than a control in every one of those states", () => {
    // There is nothing here to switch *from*: every branch of the menu is scoped to a
    // workspace, so a chip that opened one would be offering choices about nowhere.
    stillLoading();
    render(<TenantChip />);

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("the menu", () => {
  it("offers the workspace, the focus repository and the settings screen", () => {
    render(<TenantChip />);
    const { menu } = open();

    expect(within(menu).getByRole("menuitem", { name: /^Switch workspace/ })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: /^Focus repository/ })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Workspace settings" })).toBeInTheDocument();
  });

  it("waits for #491 rather than linking to a screen that is not there", () => {
    render(<TenantChip />);
    open();

    // aria-disabled, not disabled: a control removed from the tab order takes its own
    // explanation with it, and would break the arrow ring mid-walk besides.
    const settings = screen.getByRole("menuitem", { name: "Workspace settings" });
    expect(settings).toHaveAttribute("aria-disabled", "true");
    expect(settings).toHaveAttribute("title", expect.stringContaining("#491"));
  });

  it("closes on a press outside itself", () => {
    render(<TenantChip />);
    open();

    fireEvent.pointerDown(document.body);

    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("switching workspace", () => {
  it("lists every workspace, with the one the session is in checked", () => {
    render(<TenantChip />);
    const { submenu } = openBranch("Switch workspace");

    const choices = within(submenu).getAllByRole("menuitemradio");
    expect(choices.map((choice) => choice.textContent)).toEqual(
      WORKSPACES.map((workspace) => workspace.slug),
    );
    expect(choices[0]).toHaveAttribute("aria-checked", "true");
  });

  it("moves the session and repaints the route without a full reload", async () => {
    // The criterion in one case: `set-active` is the write, and `router.refresh()` is what
    // re-renders the route's Server Components — which are scoped by the session's active
    // organization — with no navigation and no reload.
    render(<TenantChip />);
    const { submenu } = openBranch("Switch workspace");

    fireEvent.click(within(submenu).getByRole("menuitemradio", { name: WORKSPACES[1].slug }));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(authStub.setActive).toHaveBeenCalledWith({ organizationId: WORKSPACES[1].id });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("announces where the session landed", async () => {
    render(<TenantChip />);
    const { submenu } = openBranch("Switch workspace");

    fireEvent.click(within(submenu).getByRole("menuitemradio", { name: WORKSPACES[2].slug }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(`Workspace: ${WORKSPACES[2].slug}.`),
    );
  });

  it("spends no request on the workspace the session is already in", () => {
    render(<TenantChip />);
    const { submenu } = openBranch("Switch workspace");

    fireEvent.click(within(submenu).getByRole("menuitemradio", { name: WORKSPACES[0].slug }));

    // Pressing the checked radio is a confirmation, not a request — so the submenu simply
    // closes and the menu stays open.
    expect(authStub.setActive).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu", { name: "Switch workspace" })).toBeNull();
    expect(screen.getByRole("menu", { name: "Workspace and focus repository" })).toBeInTheDocument();
  });

  it("reports a refusal without taking the screen away", async () => {
    authStub.setActive.mockResolvedValue({
      data: null,
      error: { status: 403, code: "FORBIDDEN", message: "You are not a member of that workspace." },
    });

    render(<TenantChip />);
    const { submenu } = openBranch("Switch workspace");

    fireEvent.click(within(submenu).getByRole("menuitemradio", { name: WORKSPACES[1].slug }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You are not a member of that workspace.",
    );
    // The menu is still open, on the screen the reader is still entitled to be on.
    expect(screen.getByRole("menu", { name: "Switch workspace" })).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("states the workspace rather than offering a choice of one", () => {
    // § 3.5 is against drawing a chooser with nothing to choose, which is the call
    // `app/shell/user-menu.tsx` and `app/login/enablement-card.tsx` both make.
    authStub.organizations = { data: [WORKSPACES[0]], isPending: false };

    render(<TenantChip />);
    const { menu } = open();

    expect(within(menu).queryByRole("menuitem", { name: /^Switch workspace/ })).toBeNull();
    expect(within(menu).getByText("Workspace")).toBeInTheDocument();
    expect(within(menu).getByText(WORKSPACES[0].slug)).toBeInTheDocument();
  });
});

describe("focusing a repository", () => {
  it("offers all repositories first, then the ones the workspace has enabled", async () => {
    render(<TenantChip />);
    const { submenu } = openBranch("Focus repository");
    await listed();

    await waitFor(() =>
      expect(
        within(submenu)
          .getAllByRole("menuitemradio")
          .map((choice) => choice.textContent),
      ).toEqual(["All repos", "helios-firmware", "atlas-scheduler"]),
    );
    // Nothing focused yet, so *all of them* is what is checked.
    expect(within(submenu).getByRole("menuitemradio", { name: "All repos" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("names the organisation each repository hangs from", async () => {
    // A repository name is unique only within its organisation, so two of them may be
    // called the same thing and the row has to be able to say which is which.
    render(<TenantChip />);
    const { submenu } = openBranch("Focus repository");
    await listed();

    await waitFor(() =>
      expect(within(submenu).getByRole("menuitemradio", { name: "helios-firmware" })).toHaveAttribute(
        "title",
        "acme-robotics/helios-firmware",
      ),
    );
  });

  it("remembers the choice for this workspace, and paints it on the chip", async () => {
    const { container } = render(<TenantChip />);
    const { submenu } = openBranch("Focus repository");
    await listed();

    fireEvent.click(await within(submenu).findByRole("menuitemradio", { name: "helios-firmware" }));

    expect(container.querySelector(".shell-tenant__repo")).toHaveTextContent("helios-firmware");
    // Per workspace, and in this browser — `localStorage` is what makes it survive the
    // session, which is the criterion.
    expect(window.localStorage.getItem(FOCUS_REPO_STORAGE_KEY)).toContain(WORKSPACES[0].id);
    expect(screen.getByRole("status")).toHaveTextContent("Focus repository: helios-firmware.");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("goes back to all repositories, forgetting the choice entirely", async () => {
    setFocusRepo(WORKSPACES[0].id, { id: HELIOS.id, name: HELIOS.name });

    const { container } = render(<TenantChip />);
    const { submenu } = openBranch("Focus repository");
    await listed();

    fireEvent.click(within(submenu).getByRole("menuitemradio", { name: "All repos" }));

    expect(container.querySelector(".shell-tenant__repo")).toHaveTextContent("All repos");
    // Stored as the absence of the key, so "never chosen" and "chosen all" are one state.
    expect(window.localStorage.getItem(FOCUS_REPO_STORAGE_KEY)).toBeNull();
  });

  it("tells the server nothing, because the server does not read it", async () => {
    // A client-side filter preference: what consumes it is the polling hook (#87), through
    // the store. A `router.refresh()` here would spend a render on nothing.
    render(<TenantChip />);
    const { submenu } = openBranch("Focus repository");
    await listed();

    fireEvent.click(await within(submenu).findByRole("menuitemradio", { name: "atlas-scheduler" }));

    expect(refresh).not.toHaveBeenCalled();
  });

  it("gives up a stored repository the workspace no longer enables", async () => {
    // Otherwise the filter narrows every listing to nothing, which is a product that looks
    // empty rather than one that is filtered.
    setFocusRepo(WORKSPACES[0].id, { id: "repo-retired", name: "retired-service" });

    const { container } = render(<TenantChip />);
    expect(container.querySelector(".shell-tenant__repo")).toHaveTextContent("retired-service");

    open();

    await waitFor(() =>
      expect(container.querySelector(".shell-tenant__repo")).toHaveTextContent("All repos"),
    );
    expect(window.localStorage.getItem(FOCUS_REPO_STORAGE_KEY)).toBeNull();
  });

  it("keeps a stored repository that is still enabled", async () => {
    setFocusRepo(WORKSPACES[0].id, { id: HELIOS.id, name: HELIOS.name });

    const { container } = render(<TenantChip />);
    open();
    await listed();

    await waitFor(() =>
      expect(
        screen.getByRole("menuitem", { name: /^Focus repository/ }),
      ).toBeInTheDocument(),
    );
    expect(container.querySelector(".shell-tenant__repo")).toHaveTextContent("helios-firmware");
  });

  it("says the listing is still being read rather than showing an empty choice", () => {
    // A submenu that offered only *All repos* while the read was out would be telling the
    // reader this workspace has no repositories.
    readFocusRepos.mockReturnValue(new Promise(() => {}));

    render(<TenantChip />);
    const { submenu } = openBranch("Focus repository");

    expect(submenu).toHaveAccessibleDescription(/Reading this workspace's repositories/);
  });

  it("says why when the repositories could not be read, and still offers all of them", async () => {
    readFocusRepos.mockResolvedValue({ ok: false, reason: "The service is not answering." });

    render(<TenantChip />);
    const { submenu } = openBranch("Focus repository");
    await listed();

    await waitFor(() =>
      expect(submenu).toHaveAccessibleDescription("The service is not answering."),
    );
    // *All repos* needs no listing to be true, so it is still there to be chosen.
    expect(within(submenu).getByRole("menuitemradio", { name: "All repos" })).toBeInTheDocument();
  });

  it("says so when the workspace has enabled nothing", async () => {
    readFocusRepos.mockResolvedValue({ ok: true, organizationId: WORKSPACES[0].id, repos: [] });

    render(<TenantChip />);
    const { submenu } = openBranch("Focus repository");
    await listed();

    await waitFor(() =>
      expect(submenu).toHaveAccessibleDescription(/No repositories are enabled/),
    );
  });

  it("draws no repository from a listing about another workspace", async () => {
    // The answer is paired with the workspace it was asked for, so one that arrives after a
    // switch — or survives one — describes somewhere the session no longer is.
    readFocusRepos.mockResolvedValue({
      ok: true,
      organizationId: WORKSPACES[2].id,
      repos: [HELIOS],
    });

    render(<TenantChip />);
    const { submenu } = openBranch("Focus repository");
    await listed();

    await waitFor(() =>
      expect(submenu).toHaveAccessibleDescription(/Reading this workspace's repositories/),
    );
    expect(within(submenu).queryByRole("menuitemradio", { name: "helios-firmware" })).toBeNull();
  });
});

describe("the keyboard", () => {
  it("labels the menu and each of its submenus", () => {
    // What a screen reader announces before the walk begins: which menu this is, and which
    // list it has just been taken into.
    render(<TenantChip />);
    const { menu, submenu } = openBranch("Focus repository");

    expect(menu).toHaveAccessibleName("Workspace and focus repository");
    expect(submenu).toHaveAccessibleName("Focus repository");
  });

  it("lands on the first item when the menu opens", () => {
    render(<TenantChip />);
    open();

    expect(document.activeElement).toBe(screen.getAllByRole("menuitem")[0]);
  });

  it("walks the items with the arrow keys, wrapping at both ends", () => {
    render(<TenantChip />);
    const { menu } = open();
    const items = screen.getAllByRole("menuitem");

    expect(items.length).toBeGreaterThan(1);

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);

    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(document.activeElement).toBe(items[0]);

    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(document.activeElement).toBe(items[items.length - 1]);
  });

  it("jumps to the ends with Home and End", () => {
    render(<TenantChip />);
    const { menu } = open();
    const items = screen.getAllByRole("menuitem");

    fireEvent.keyDown(menu, { key: "End" });
    expect(document.activeElement).toBe(items[items.length - 1]);

    fireEvent.keyDown(menu, { key: "Home" });
    expect(document.activeElement).toBe(items[0]);
  });

  it("opens either submenu with Right, from the item that owns it", () => {
    render(<TenantChip />);
    const { menu } = open();

    // Focus opens on the first item, which is the workspace branch.
    fireEvent.keyDown(menu, { key: "ArrowRight" });
    expect(screen.getByRole("menu", { name: "Switch workspace" })).toBeInTheDocument();
    expect(document.activeElement).toBe(
      within(screen.getByRole("menu", { name: "Switch workspace" })).getAllByRole(
        "menuitemradio",
      )[0],
    );
  });

  it("comes back out of a submenu with Left, landing on the item that opened it", () => {
    render(<TenantChip />);
    const { menu, branch } = openBranch("Focus repository");

    fireEvent.keyDown(menu, { key: "ArrowLeft" });

    expect(screen.queryByRole("menu", { name: "Focus repository" })).toBeNull();
    expect(document.activeElement).toBe(branch);
  });

  it("closes the submenu on Escape, not the whole menu", () => {
    // Innermost first: closing everything would throw away a choice still being made.
    render(<TenantChip />);
    const { menu, branch } = openBranch("Switch workspace");

    fireEvent.keyDown(menu, { key: "Escape" });

    expect(screen.queryByRole("menu", { name: "Switch workspace" })).toBeNull();
    expect(screen.getByRole("menu", { name: "Workspace and focus repository" })).toBeInTheDocument();
    expect(document.activeElement).toBe(branch);
  });

  it("closes on Escape and gives focus back to the chip", () => {
    render(<TenantChip />);
    const { menu, trigger } = open();

    fireEvent.keyDown(menu, { key: "Escape" });

    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("dismisses on Tab without dragging focus back", () => {
    render(<TenantChip />);
    const { menu, trigger } = open();

    fireEvent.keyDown(menu, { key: "Tab" });

    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).not.toBe(trigger);
  });

  it("keeps every item out of the tab order, which is what a roving focus means", () => {
    render(<TenantChip />);
    open();

    for (const item of screen.getAllByRole("menuitem")) {
      expect(item).toHaveAttribute("tabindex", "-1");
    }
  });
});
