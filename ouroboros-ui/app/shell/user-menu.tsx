"use client";

import { CircleUser, Monitor, Moon, Sun } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { organization, unwrap, useListOrganizations, useSession } from "@/app/api/auth-client";
import { FONT_SCALES, setFontScale } from "@/app/font-scale";
// The person's monogram, and the one rule this side of the wire still keeps. It lives with
// the login screen's tile because that is where the *workspace* monogram question was
// settled — the service computes those, so nothing here may re-derive them — and the
// signed-in person is the single case it does not describe (`app/login/monogram.tsx`). The
// shell draws the same person, so it reads the same function rather than a second copy of it.
import { initials } from "@/app/login/monogram";
import { describeTheme, resolveTheme, type Theme } from "@/app/theme";
import { useTheme } from "@/app/theme-provider";
import { useFontScale } from "@/app/use-font-scale";

import { type AccountView, type MenuWorkspace, accountMenuLabel, accountView } from "./account";
import { signOutOfSession } from "./actions";
import { menuConsumesKey, menuFocusTarget, menuItems, menuKeyAction } from "./menu";
import { saveFontScale } from "./preference-actions";
import { ShortcutsSheet } from "./shortcuts-sheet";
import { switchWorkspace } from "./switch-workspace";

/**
 * The account menu in the top-right corner of the header — the full § 1.1 shape, at last
 * (CP.3, [#645](https://github.com/NobuData/ouroboros/issues/645)).
 *
 * What shipped with the shell (#41) was the interaction around placeholders; #721 filled in
 * the session; this issue fills in the rest — the font-size stepper (over #649's engine),
 * the theme control (a second surface over the #17 engine, moved in from the header row as
 * the roadmap promised), the person's role in the acting workspace, and the
 * keyboard-shortcuts sheet. The one placeholder left standing is *Workspace settings*,
 * because `/settings` is #491's to build and a link to a 404 is worse than an honest wait:
 *
 * ```
 * [ (avatar) ▾ ]
 *      ├─ Ken Suenobu · ken@acme-robotics.dev · owner
 *      ├─ Font size  [A−] ▪▪▪▫▫ [A+]      ← live, persisted through #649
 *      ├─ Theme      ○ Light ○ Dark ● System
 *      ├─ Switch workspace  ▸ ─┬─ ● acme-robotics
 *      │                       ├─ ○ acme-labs
 *      │                       └─ ○ kensuenobu
 *      ├─ Workspace settings           (#491)
 *      ├─ Keyboard shortcuts ─▶ sheet over the pane
 *      └─ Sign out ─▶ session row deleted ─▶ /login
 * ```
 *
 * ### The two controls hold no state of their own
 *
 * The stepper reads `useFontScale()` and writes through `setFontScale` — the store #649
 * built, and the same one Settings → Appearance (#492) will subscribe to, which is the
 * whole of how the two stay in sync — then persists through the `saveFontScale` Server
 * Action, quietly: the step already applied, and a reader mid-squint is not interested in
 * why the durable half is slow. The theme radios read `useTheme()` and call `setTheme`,
 * so the engine, the persistence and the no-flash boot are all #17's; three
 * `menuitemradio`s rather than the header's old cycling button because a menu row has room
 * for the three states the cycle had to fold into one icon.
 *
 * ### It reads the browser's session, and it is the only thing in the product that does
 *
 * `app/api/auth-client.ts` reserved `useSession()` for exactly this component and says why: a
 * hook is the right answer only where something is already a Client Component for some other
 * reason, and a menu is. The alternative — the `(app)` layout reading the session and passing
 * it down — is the one that file and `app/(app)/layout.tsx` both argue against: a layout does
 * not re-render on a client-side navigation between siblings, and awaiting a session there
 * would hold up the shell that a route's `loading.tsx` is drawn inside.
 *
 * What that buys, beyond freshness, is the *other* half of switching workspace. The listing
 * and the session both live in stores the organization plugin invalidates when
 * `set-active` returns (`atomListeners` in its client), so the moment the call succeeds this
 * menu is already describing the new workspace with no code here to keep it in step.
 *
 * ### Two writes, two directions — and the split is not arbitrary
 *
 * Switching workspace is a call the **browser** makes; signing out is a **Server Action**.
 * `app/shell/actions.ts` sets out the argument in full; in one line, it is which side of the
 * wire can write the cookie each one has to change. `router.refresh()` is what carries the
 * first across to the server: it re-renders the route's Server Components — which since
 * [#713](https://github.com/NobuData/ouroboros/issues/713) are scoped by
 * `session."activeOrganizationId"` — without a navigation, which is the issue's *"without a
 * full reload"* in the framework's own words.
 *
 * ### What the interaction owns
 *
 * The part that did not change when the placeholders became real, which is why building it
 * once in #41 was worth it: the menu opens from the avatar, closes on Escape, on a click
 * outside, or when focus leaves; Escape returns focus to the button it came from; and
 * Arrow/Home/End move a roving focus through the items. The submenu adds the two keys the
 * ARIA menu pattern gives a submenu — Right to open it, Left to come back out — and Escape
 * inside it closes the submenu rather than the whole menu.
 *
 * @returns The avatar button and, while open, its menu.
 */
export function UserMenu() {
  const router = useRouter();
  const session = useSession();
  const workspaces = useListOrganizations();
  const scale = useFontScale();
  const { theme, resolved, setTheme } = useTheme();

  const activeOrganizationId = session.data?.session.activeOrganizationId ?? null;

  /**
   * `member.role` for a workspace, raw, remembered *with* the workspace it was asked for.
   *
   * Fetched apart from the session because the listing the menu renders from is the
   * plugin's `organization.list`, whose adapter discards the role on the way out —
   * `GET /api/v1/orgs` exists for screens that need roles *per workspace*, but this menu
   * needs one word for one workspace, and `get-active-member-role` is the plugin's own
   * one-request answer, called through the client BetterAuth routes are always called
   * through (the two-client rule).
   *
   * The pairing is the staleness rule: `activeRole` below is derived by comparing the
   * stored workspace against the acting one, so an answer that arrives after a switch —
   * or survives one — is void the moment it no longer describes where the session is,
   * with no state to remember to reset (and no reset for a lint rule to object to).
   */
  const [memberRole, setMemberRole] = useState<{
    organizationId: string;
    role: string;
  } | null>(null);

  useEffect(() => {
    if (activeOrganizationId === null) return;

    let cancelled = false;

    organization
      .getActiveMemberRole()
      .then((answer) => {
        if (cancelled) return;
        const member = unwrap(answer, "/organization/get-active-member-role");
        if (typeof member?.role === "string") {
          setMemberRole({ organizationId: activeOrganizationId, role: member.role });
        }
      })
      .catch(() => {
        // Nothing honest to say: the identity block simply does not name a role, which is
        // the same rendering as "not answered yet" because it is the same knowledge.
      });

    return () => {
      cancelled = true;
    };
  }, [activeOrganizationId]);

  /** The raw role text, exactly while it describes the acting workspace. */
  const activeRole =
    memberRole !== null && memberRole.organizationId === activeOrganizationId
      ? memberRole.role
      : null;

  const view = accountView({
    user: session.data?.user,
    // Read rather than asserted, for the reason `app/api/auth-server.ts` reads it the same
    // way: BetterAuth leaves the field off the base session and the plugin widens it, so a
    // build typed without the organization plugin would report every session as acting
    // nowhere rather than failing to compile.
    activeOrganizationId,
    organizations: workspaces.data,
    pending: session.isPending,
    activeRole,
  });

  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  /** The workspace a `set-active` is in flight for, so the row can say it is working. */
  const [moving, setMoving] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  /** What to tell a screen reader about a press that has just changed something. */
  const [announcement, setAnnouncement] = useState("");
  /** Whether the shortcuts sheet is showing — it outlives the menu that opened it. */
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const switcher = useRef<HTMLButtonElement>(null);
  const submenu = useRef<HTMLDivElement>(null);

  const menuId = useId();
  const submenuId = useId();
  const failureId = useId();

  /**
   * Close the menu, optionally putting focus back where it came from.
   *
   * A plain function rather than a `useCallback`: the React Compiler memoises what needs
   * memoising, and the one place a stable identity would have mattered — the effect below —
   * does not hold this function at all.
   *
   * @param restoreFocus Whether to focus the avatar again. True for a keyboard dismissal,
   *   where focus would otherwise fall to the document; false for a click elsewhere, where
   *   stealing focus back is the wrong answer.
   */
  function close(restoreFocus: boolean): void {
    setOpen(false);
    setSwitching(false);
    setFailure(null);
    if (restoreFocus) trigger.current?.focus();
  }

  /** Leave the submenu, landing on the item that opened it. */
  function closeSwitcher(): void {
    setSwitching(false);
    switcher.current?.focus();
  }

  // Dismissal from outside the menu: a pointer press anywhere else, which includes the
  // avatar itself — the button's own handler toggles, and this effect is registered only
  // while open, so the two do not fight over the same press.
  //
  // The three setters are written out rather than reached through `close()`, so the effect
  // depends on the one thing that decides whether it should be registered — `open` — and is
  // not re-subscribed by a render that changed something else entirely.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && wrapper.current?.contains(target)) return;
      setOpen(false);
      setSwitching(false);
      setFailure(null);
    };

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Opening moves focus into the menu, which is what makes the keyboard path work: the arrow
  // keys below are handled on the menu, and Escape has somewhere to return from.
  useEffect(() => {
    if (open) menuItems(menu.current)[0]?.focus();
  }, [open]);

  // And opening the submenu moves it on again, which is what the ARIA menu pattern asks of a
  // submenu that was opened deliberately.
  useEffect(() => {
    if (switching) menuItems(submenu.current)[0]?.focus();
  }, [switching]);

  /**
   * Move the session into another workspace.
   *
   * The call itself is `app/shell/switch-workspace.ts`'s, shared with the tenant chip
   * ([#77](https://github.com/NobuData/ouroboros/issues/77)), which offers the same switch
   * from the other end of the header — one write, one sentence for a refusal. What stays here
   * is what this menu does around it, and `router.refresh()` is the part that matters: it
   * tells the *server*, so every Server Component on the route re-renders against the
   * workspace the session now names.
   *
   * @param workspace The workspace to move to.
   */
  async function choose(workspace: MenuWorkspace): Promise<void> {
    if (moving !== null) return;

    if (view.state === "signed-in" && workspace.id === view.active?.id) {
      // Already there. Pressing the checked radio is a confirmation, not a request — so this
      // spends no round trip on it and simply leaves the submenu.
      closeSwitcher();
      return;
    }

    setMoving(workspace.id);
    setFailure(null);

    const refused = await switchWorkspace(workspace.id);
    setMoving(null);

    if (refused !== null) {
      // A refusal is a state to render, not an error boundary over the whole application:
      // the menu is chrome, and replacing every screen because one workspace could not be
      // opened would lose the screen the person is still entitled to be on.
      setFailure(refused);
      return;
    }

    setAnnouncement(`Workspace: ${workspace.slug}.`);
    close(true);
    router.refresh();
  }

  /**
   * Step the font scale one notch in either direction, live.
   *
   * The order is the design's "live preview as you step": `setFontScale` stamps `<html>`
   * before this function returns, so the press *is* the preview — and only then is the
   * durable half asked for, quietly, because the reader is already reading at the size
   * they chose and a failed PATCH must not take that away or interrupt it.
   *
   * @param direction `1` for larger, `-1` for smaller.
   */
  function step(direction: 1 | -1): void {
    const next = FONT_SCALES[FONT_SCALES.indexOf(scale) + direction];
    if (next === undefined) return;

    setFontScale(next);
    setAnnouncement(`Font size ${next}%.`);
    void saveFontScale(next);
  }

  /**
   * Choose a theme, through the #17 engine.
   *
   * @param choice The choice the radio names.
   */
  function pickTheme(choice: Theme): void {
    setTheme(choice);
    // resolveTheme rather than the hook's `resolved`, which still describes the palette
    // being left behind: this render happens before the state change is applied.
    setAnnouncement(`Theme: ${describeTheme(choice, resolveTheme(choice))}.`);
  }

  /**
   * Open the shortcuts sheet, from the menu item that names it.
   *
   * The menu closes first — a sheet over a still-open menu would be two layers of "Escape
   * closes which?" — and without restoring focus, because the sheet is about to take it.
   * When the sheet closes, focus comes back to the avatar rather than to the menu item,
   * which no longer exists; the overlay's own restoration checks `isConnected` and would
   * otherwise drop focus on the body.
   */
  function openShortcuts(): void {
    close(false);
    setShortcutsOpen(true);
  }

  /**
   * Keyboard handling for the open menu.
   *
   * One handler on the menu container — the submenu is inside it, so its keys bubble here —
   * which keeps the roving focus with a single source of truth: the DOM. What each key
   * *means* is `app/shell/menu.ts`'s since H.1
   * ([#77](https://github.com/NobuData/ouroboros/issues/77)) gave the header a second menu:
   * the pattern is one pattern, and Escape closing the innermost open thing is the kind of
   * rule that goes wrong in one copy at a time.
   *
   * @param event The key press.
   */
  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    const focused = document.activeElement;
    const inSubmenu = focused instanceof Node && (submenu.current?.contains(focused) ?? false);

    const action = menuKeyAction(event, { inSubmenu, onBranch: focused === switcher.current });
    if (menuConsumesKey(action)) event.preventDefault();

    switch (action) {
      case "close":
        close(true);
        return;
      case "close-submenu":
        closeSwitcher();
        return;
      case "open-submenu":
        setSwitching(true);
        return;
      case "dismiss":
        // Tabbing out is a dismissal, and the browser's own focus move is the right one — so
        // this closes without preventing it or dragging focus back.
        close(false);
        return;
      default: {
        const entries = menuItems(menu.current);
        const target = menuFocusTarget(
          action,
          entries.indexOf(focused as HTMLElement),
          entries.length,
        );
        if (target !== undefined) entries[target]?.focus();
      }
    }
  }

  const showSwitcher = view.state === "signed-in" && view.switchable;

  return (
    <div className="shell-menu" ref={wrapper}>
      <button
        type="button"
        className="shell-avatar"
        ref={trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={accountMenuLabel(view)}
        // Closing through `close()` rather than by flipping `open`, so a menu re-opened from
        // the avatar opens in the state a menu opens in: submenu shut, nothing reported. No
        // focus is restored, because the press that closed it already put focus here.
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        <Face view={view} />
      </button>

      {open && (
        <div className="shell-menu__panel">
          <Identity view={view} />

          {/*
            The workspace, when there is nowhere to switch to: a fact rather than a control.
            The design system's honesty rule (§ 3.5) is against drawing a chooser with one
            choice, and `app/login/enablement-card.tsx` makes the same call on the same
            grounds — so the name is still said, and nothing pretends to be pressable.
          */}
          {view.state === "signed-in" && !view.switchable && view.active !== undefined && (
            <p className="shell-menu__workspace">
              {/*
                The space between them is written rather than left to the block layout: a
                name is computed from the text, not from the boxes, so without it a screen
                reader says "Workspaceacme-robotics" and so does every accessible-name test.
              */}
              <span className="shell-menu__label">Workspace</span>{" "}
              <span className="shell-menu__value">{view.active.slug}</span>
            </p>
          )}

          <div
            className="shell-menu__items"
            id={menuId}
            role="menu"
            aria-label="Account"
            ref={menu}
            onKeyDown={onKeyDown}
          >
            {/*
              The font-size stepper (§ 1.1, over #649's engine). role="none" on the row is
              the <li role="none"> of the ARIA menu pattern: the two buttons are the menu's
              items, the label and the dots are furniture. The buttons stay in the tab-less
              roving ring like every other item — `menuItems()` reads roles, not markup shape.
            */}
            <div role="none" className="shell-menu__row" title={`Font size ${scale}%`}>
              <span className="shell-menu__label">Font size</span>
              <div role="none" className="shell-menu__stepper">
                <button
                  type="button"
                  className="shell-menu__item shell-menu__step"
                  role="menuitem"
                  tabIndex={-1}
                  // aria-disabled at the end of the range, never `disabled`: the house rule
                  // (§ 3.5) — a control out of the tab order takes its explanation with it,
                  // and here it would also break the arrow ring mid-walk.
                  aria-disabled={scale === FONT_SCALES[0] || undefined}
                  aria-label="Smaller text"
                  onClick={() => step(-1)}
                >
                  A−
                </button>
                {/*
                  Which of the five steps is on. Decoration beside two buttons that already
                  say what they do; the live region announces the value a press lands on,
                  and the row's title carries it for a hovering pointer.
                */}
                <span className="shell-menu__dots" aria-hidden>
                  {FONT_SCALES.map((mark) => (
                    <span
                      key={mark}
                      className={
                        FONT_SCALES.indexOf(mark) <= FONT_SCALES.indexOf(scale)
                          ? "shell-menu__dot shell-menu__dot--on"
                          : "shell-menu__dot"
                      }
                    />
                  ))}
                </span>
                <button
                  type="button"
                  className="shell-menu__item shell-menu__step"
                  role="menuitem"
                  tabIndex={-1}
                  aria-disabled={scale === FONT_SCALES[FONT_SCALES.length - 1] || undefined}
                  aria-label="Larger text"
                  onClick={() => step(1)}
                >
                  A+
                </button>
              </div>
            </div>

            {/*
              The theme, as three radios over the #17 engine — the control the header row
              gave up to this menu. role="group" rather than role="none", which is the ARIA
              menu pattern's own container for a menuitemradio set: it is what makes a
              screen reader say "Theme, group" before "Light, radio item, 1 of 3".
            */}
            <div role="group" aria-label="Theme" className="shell-menu__row">
              <span className="shell-menu__label">Theme</span>
              <div role="none" className="shell-menu__themes">
                {THEME_CHOICES.map(({ choice, label, icon: Icon }) => (
                  <button
                    key={choice}
                    type="button"
                    className="shell-menu__item shell-menu__theme"
                    role="menuitemradio"
                    tabIndex={-1}
                    aria-checked={theme === choice}
                    // The one choice whose consequence is not in its name: what "System"
                    // renders as depends on the OS, so the title resolves it the way the
                    // old toggle's tooltip did.
                    title={
                      choice === "system" ? `Follows the system — ${resolved} right now.` : undefined
                    }
                    onClick={() => pickTheme(choice)}
                  >
                    <Icon size={14} aria-hidden />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {showSwitcher && (
              // role="none" so the submenu below is a child of the menu in the accessibility
              // tree rather than of a generic box, which is the <li role="none"> of the ARIA
              // menu pattern written with the elements this panel is built from.
              <div role="none" className="shell-menu__branch">
                <button
                  type="button"
                  className="shell-menu__item shell-menu__item--switch"
                  role="menuitem"
                  tabIndex={-1}
                  ref={switcher}
                  aria-haspopup="menu"
                  aria-expanded={switching}
                  aria-controls={switching ? submenuId : undefined}
                  onClick={() => setSwitching((was) => !was)}
                >
                  {/*
                    "Switch workspace" rather than "Workspace", so the item's accessible name
                    says what pressing it does — and so it cannot be confused with the
                    *Workspace settings* item two rows below, which a reader hears in the
                    same breath.
                  */}
                  <span className="shell-menu__label">Switch workspace</span>{" "}
                  <span className="shell-menu__value">
                    {view.active?.slug ?? "none chosen"}
                  </span>
                  <span className="shell-menu__marker" aria-hidden>
                    ▸
                  </span>
                </button>

                {switching && (
                  <div
                    className="shell-menu__submenu"
                    id={submenuId}
                    role="menu"
                    aria-label="Switch workspace"
                    ref={submenu}
                  >
                    {view.workspaces.map((workspace) => (
                      <button
                        type="button"
                        key={workspace.id}
                        className="shell-menu__item shell-menu__choice"
                        role="menuitemradio"
                        tabIndex={-1}
                        // The active one included, and checked. A radio group needs the
                        // chosen option in it to be a group at all, and a list of only the
                        // others would make "which am I in?" a question the menu stops
                        // answering the moment it is opened.
                        aria-checked={workspace.id === view.active?.id}
                        aria-busy={moving === workspace.id || undefined}
                        aria-describedby={failure === null ? undefined : failureId}
                        onClick={() => void choose(workspace)}
                      >
                        {workspace.slug}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/*
              aria-disabled, not disabled: a control removed from the tab order takes its own
              explanation with it. #491 turns this into a link to /settings.
            */}
            <button
              type="button"
              className="shell-menu__item"
              role="menuitem"
              tabIndex={-1}
              aria-disabled="true"
              title="Workspace settings arrive with #491."
            >
              Workspace settings
            </button>

            <button
              type="button"
              className="shell-menu__item"
              role="menuitem"
              tabIndex={-1}
              onClick={openShortcuts}
            >
              Keyboard shortcuts
            </button>

            {/*
              A form, because signing out is a write only the server can finish — see
              `app/shell/actions.ts`. role="none" keeps the transport out of the
              accessibility tree, so the button inside it is the menu's own child.
            */}
            <form className="shell-menu__form" role="none" action={signOutOfSession}>
              <button type="submit" className="shell-menu__item" role="menuitem" tabIndex={-1}>
                Sign out
              </button>
            </form>
          </div>

          {failure !== null && (
            // role="alert" because it appears in answer to a press: somebody who has just
            // chosen a workspace and been given nothing needs to be told, whatever they are
            // reading the screen with.
            <p className="shell-menu__failure" id={failureId} role="alert">
              {failure}
            </p>
          )}
        </div>
      )}

      {/*
        Outside the panel, because it outlives it: the menu item that opens the sheet closes
        the menu behind itself. Focus returns to the avatar on close — the overlay's own
        restoration would find its opener unmounted.
      */}
      <ShortcutsSheet
        open={shortcutsOpen}
        onClose={() => {
          setShortcutsOpen(false);
          trigger.current?.focus();
        }}
      />

      {/*
        Outside the panel, and always mounted: the menu closes on a successful switch, and a
        live region that is removed at the moment its text is set announces nothing at all.
      */}
      <span className="sr-only" role="status">
        {announcement}
      </span>
    </div>
  );
}

/**
 * The three theme choices, in the order the row draws them — the two explicit palettes,
 * then the default that follows the OS. Module-scope so the row's map never rebuilds it.
 */
const THEME_CHOICES: readonly {
  readonly choice: Theme;
  readonly label: string;
  readonly icon: typeof Sun;
}[] = [
  { choice: "light", label: "Light", icon: Sun },
  { choice: "dark", label: "Dark", icon: Moon },
  { choice: "system", label: "System", icon: Monitor },
];

/**
 * Who is signed in, above the menu's items.
 *
 * Deliberately **outside** the `role="menu"`: a menu's children are menu items, and a
 * paragraph among them is a paragraph a screen reader in menu mode may skip past. What
 * carries the same fact into the accessibility tree is the avatar button's own name
 * (`accountMenuLabel`), which is read before the menu is ever opened.
 *
 * @param props.view What the menu draws.
 * @returns The identity block.
 */
function Identity({ view }: Readonly<{ view: AccountView }>) {
  if (view.state === "pending") {
    return <p className="shell-menu__identity shell-menu__identity--quiet">Loading your session…</p>;
  }

  if (view.state === "signed-out") {
    return <p className="shell-menu__identity shell-menu__identity--quiet">Not signed in.</p>;
  }

  return (
    <p className="shell-menu__identity">
      <span className="shell-menu__who">{view.person.name}</span>
      <span className="shell-menu__mail">
        {view.person.email}
        {/*
          The role in the acting workspace — "ken@… · owner", § 1.1's line. Rendered only
          once it is *known* (§ 3.5): while the fetch is out, or when the session acts
          nowhere, the address stands alone rather than beside a guess. It changes with the
          acting organization because the effect that feeds it is keyed on exactly that.
        */}
        {view.person.role !== null && (
          <span className="shell-menu__role"> · {view.person.role}</span>
        )}
      </span>
    </p>
  );
}

/**
 * What the avatar button draws: a picture, a monogram, or the generic mark.
 *
 * @param props.view What the menu draws.
 * @returns The face, hidden from assistive technology — the button's `aria-label` is its
 *   name, and a second reading of the same person would be noise.
 */
function Face({ view }: Readonly<{ view: AccountView }>) {
  /**
   * Whether the picture failed to load, in which case the monogram takes over.
   *
   * A remote image is a third party's uptime, and a broken one in a 30px circle is the
   * browser's broken-image glyph — which reads as a bug in this product rather than as an
   * avatar that did not arrive.
   */
  const [broken, setBroken] = useState(false);

  if (view.state !== "signed-in") {
    return <CircleUser size={20} aria-hidden />;
  }

  const { avatarUrl, name } = view.person;

  if (avatarUrl !== null && !broken) {
    return (
      /*
       * A plain <img>, and the one in this module. `next/image` refuses a remote host that
       * `next.config.ts` has not listed, and the host here is whichever identity provider
       * signed this person in — github.com's CDN today, an enterprise IdP's tomorrow
       * (#722). Enumerating them in the build configuration would make *adding a provider*
       * a rebuild, and a wildcard would be an image proxy for anyone who can set a URL on a
       * user record. The picture is 30px and already sized, so the optimiser has nothing to
       * do for it either way.
       *
       * `referrerPolicy` so the address of the page somebody is on is not handed to that
       * third party with every load.
       */
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className="shell-avatar__image"
        src={avatarUrl}
        alt=""
        width={30}
        height={30}
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
      />
    );
  }

  return (
    <span className="shell-avatar__initials" aria-hidden>
      {initials(name)}
    </span>
  );
}
