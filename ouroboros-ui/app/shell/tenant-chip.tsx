"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { useListOrganizations, useSession } from "@/app/api/auth-client";
import type { EnabledRepo } from "@/app/api/enablement";

import { type MenuWorkspace, accountView, tenantChipLabel, tenantChipTitle } from "./account";
import {
  ALL_REPOS_LABEL,
  focusRepoIn,
  focusRepoState,
  setFocusRepo,
  useFocusRepo,
} from "./focus-repo";
import { menuConsumesKey, menuFocusTarget, menuItems, menuKeyAction } from "./menu";
import { type FocusRepoReading, readFocusRepos } from "./repo-actions";
import { switchWorkspace } from "./switch-workspace";

/**
 * The tenant chip: which workspace the product is acting in, which repository it is looking
 * at, and the menu that changes either (H.1,
 * [#77](https://github.com/NobuData/ouroboros/issues/77)).
 *
 * Immediately right of the brand, where the shell specification puts it
 * (`docs/DESIGN_SYSTEM_APP_SHELL.md` § 1.1), drawn as mockup 02's `.tenant-chip` — muted
 * organization, bright repository, caret:
 *
 * ```
 * [ acme-robotics / helios-firmware ▾ ]
 *        ├─ Switch workspace   ▸ ─┬─ ● acme-robotics
 *        │                        ├─ ○ acme-labs
 *        │                        └─ ○ kensuenobu
 *        ├─ Focus repository   ▸ ─┬─ ● All repos
 *        │                        ├─ ○ helios-firmware
 *        │                        └─ … the enabled repositories
 *        └─ Workspace settings              (#491)
 * ```
 *
 * CP.1 ([#643](https://github.com/NobuData/ouroboros/issues/643)) drew the half that was true
 * then — a slug, no caret, no menu — because "a caret on a control that does not open is the
 * kind of lie the design system's honesty rule (§ 3.5) is aimed at". This issue is the one
 * that earns the caret, so the chip becomes a control and the tooltip that used to point at
 * the account menu is gone: switching is here now, where the specification always put it.
 *
 * ### The two halves are not the same kind of thing
 *
 * The **workspace** is server state. `session."activeOrganizationId"` is written by
 * `set-active` and every Server Component on the route is scoped by it (#713), so switching
 * is a call to BetterAuth followed by `router.refresh()` — `app/shell/switch-workspace.ts`
 * holds the call and the argument for making it from the browser.
 *
 * The **focus repository** is a filter preference this browser holds, per workspace, in
 * `localStorage` — `app/shell/focus-repo.ts` says why that is the honest home for it. Nothing
 * is hidden by choosing one; it narrows what a screen asks for. The read APIs already take it
 * (`GET /api/v1/runs` #71 and `GET /api/v1/queue` #73 accept `?repo=`, and the contract names
 * this issue while describing the parameter), and the hook that will send it with each poll
 * is [#87](https://github.com/NobuData/ouroboros/issues/87) — which reads the store rather
 * than being handed anything by this component.
 *
 * ### It reads the session itself
 *
 * The argument `app/shell/user-menu.tsx` makes, unchanged and now with a second beneficiary:
 * `useSession()` and `useListOrganizations()` are stores the organization plugin invalidates
 * when `set-active` returns, so this chip and that menu redraw together the moment a switch
 * lands — from either of them — with no code in either to keep them in step. Threading the
 * value down from the `(app)` layout would give a value that is stale the first time somebody
 * navigates between two pages in the group.
 *
 * ### The repository listing is read when the menu opens
 *
 * Behind `readFocusRepos()` is `1 + n` requests (`app/shell/repo-actions.ts`), so it is asked
 * for when somebody opens the menu rather than on every page load — the chip paints its
 * focus repository from the *stored name*, and needs the listing only when a choice is about
 * to be made from it. The answer is also what corrects a stored choice that has stopped being
 * true: a repository somebody has since disabled would otherwise narrow every listing to
 * nothing, which is a filter silently returning an empty product.
 */

/** Which submenu is open, if either. */
type Branch = "workspace" | "repo";

/**
 * The chip.
 *
 * @returns The control and, while open, its menu — or a plain statement while there is no
 *   workspace to name, which is the one state where nothing here could be pressed.
 */
export function TenantChip() {
  const router = useRouter();
  const session = useSession();
  const workspaces = useListOrganizations();

  const view = accountView({
    user: session.data?.user,
    activeOrganizationId: session.data?.session.activeOrganizationId ?? null,
    organizations: workspaces.data,
    pending: session.isPending,
  });

  /** The workspace the session is acting in, or `undefined` while nobody knows. */
  const active = view.state === "signed-in" ? view.active : undefined;
  const focus = useFocusRepo(active?.id);

  const [open, setOpen] = useState(false);
  /** Which submenu is showing. Only ever one: they are choices, not panels. */
  const [branch, setBranch] = useState<Branch | null>(null);
  /** The workspace a `set-active` is in flight for, so the row can say it is working. */
  const [moving, setMoving] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  /** What to tell a screen reader about a press that has just changed something. */
  const [announcement, setAnnouncement] = useState("");
  /**
   * The workspace's repositories, as the action answered — **remembered with the workspace
   * it was asked for**, so an answer that arrives after a switch, or survives one, is void
   * the moment it no longer describes where the session is. The same pairing
   * `app/shell/user-menu.tsx` makes with the member role, for the same reason.
   */
  const [listing, setListing] = useState<FocusRepoReading | null>(null);

  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const workspaceBranch = useRef<HTMLButtonElement>(null);
  const repoBranch = useRef<HTMLButtonElement>(null);
  /** Whichever submenu is open — there is only ever one, so one ref serves both. */
  const submenu = useRef<HTMLDivElement>(null);

  const menuId = useId();
  const workspaceMenuId = useId();
  const repoMenuId = useId();
  const noteId = useId();
  const failureId = useId();

  const activeId = active?.id ?? null;

  /**
   * Close the menu, optionally putting focus back where it came from.
   *
   * @param restoreFocus Whether to focus the chip again. True for a keyboard dismissal and
   *   for a completed choice, where focus would otherwise fall to the document; false for a
   *   click elsewhere, where stealing focus back is the wrong answer.
   */
  function close(restoreFocus: boolean): void {
    setOpen(false);
    setBranch(null);
    setFailure(null);
    if (restoreFocus) trigger.current?.focus();
  }

  /** Leave the open submenu, landing on the item that opened it. */
  function closeBranch(): void {
    const opener = branch === "repo" ? repoBranch : workspaceBranch;
    setBranch(null);
    opener.current?.focus();
  }

  // Dismissal from outside the menu: a pointer press anywhere else, which includes the chip
  // itself — the button's own handler toggles, and this effect is registered only while open,
  // so the two do not fight over the same press. The setters are written out rather than
  // reached through `close()`, so the effect depends on the one thing that decides whether it
  // should be registered at all.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && wrapper.current?.contains(target)) return;
      setOpen(false);
      setBranch(null);
      setFailure(null);
    };

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Opening moves focus into the menu, which is what makes the keyboard path work: the arrow
  // keys are handled on the menu, and Escape has somewhere to return from.
  useEffect(() => {
    if (open) menuItems(menu.current)[0]?.focus();
  }, [open]);

  // And opening a submenu moves it on again, which is what the ARIA menu pattern asks of a
  // submenu that was opened deliberately.
  useEffect(() => {
    if (branch !== null) menuItems(submenu.current)[0]?.focus();
  }, [branch]);

  // The repositories, read when the menu opens and re-read when the workspace changes under
  // it. Keyed on both, so a menu opened twice in the same workspace asks twice — the
  // enablement list is somebody else's screen to change (#491), and a menu is exactly where a
  // stale one would be noticed.
  useEffect(() => {
    if (!open || activeId === null) return;

    let cancelled = false;

    readFocusRepos()
      .then((answer) => {
        if (cancelled) return;
        setListing(answer);

        // A stored choice the workspace no longer enables is a filter that narrows every
        // listing to nothing, so it goes back to all repositories. Read from the store rather
        // than from this effect's closure: somebody may have chosen while the call was out.
        if (!answer.ok || answer.organizationId !== activeId) return;
        const held = focusRepoIn(focusRepoState(), activeId);
        if (held !== null && !answer.repos.some((one) => one.id === held.id)) {
          setFocusRepo(activeId, null);
        }
      })
      .catch(() => {
        // Nothing honest to say beyond what the submenu already says while it waits: the
        // action answers a refusal as a value, so reaching here means the hop itself failed.
        if (!cancelled) setListing({ ok: false, reason: "The repositories could not be read." });
      });

    return () => {
      cancelled = true;
    };
  }, [open, activeId]);

  /**
   * Move the session into another workspace.
   *
   * `router.refresh()` is what carries the switch to the server: it re-renders the route's
   * Server Components — which are scoped by `session."activeOrganizationId"` — without a
   * navigation, which is the issue's *"repaints dashboard data without a full page reload"*.
   *
   * @param workspace The workspace to move to.
   */
  async function choose(workspace: MenuWorkspace): Promise<void> {
    if (moving !== null) return;

    if (workspace.id === active?.id) {
      // Already there. Pressing the checked radio is a confirmation, not a request — so this
      // spends no round trip on it and simply leaves the submenu.
      closeBranch();
      return;
    }

    setMoving(workspace.id);
    setFailure(null);

    const refused = await switchWorkspace(workspace.id);
    setMoving(null);

    if (refused !== null) {
      setFailure(refused);
      return;
    }

    // The listing describes the workspace being left, and the effect above will ask again.
    setListing(null);
    setAnnouncement(`Workspace: ${workspace.slug}.`);
    close(true);
    router.refresh();
  }

  /**
   * Focus one repository, or go back to all of them.
   *
   * No `router.refresh()`: the preference lives in this browser and the server does not read
   * it, so there is nothing on the other side of the wire to re-render. What consumes it is
   * the polling hook (#87), through the store this writes to.
   *
   * @param repo The repository to focus, or `null` for all of them.
   */
  function chooseRepo(repo: EnabledRepo | null): void {
    if (activeId === null) return;

    setFocusRepo(activeId, repo === null ? null : { id: repo.id, name: repo.name });
    setAnnouncement(repo === null ? `Focus: ${ALL_REPOS_LABEL}.` : `Focus repository: ${repo.name}.`);
    close(true);
  }

  /**
   * Keyboard handling for the open menu.
   *
   * One handler on the menu container — the submenus are inside it, so their keys bubble
   * here — which keeps the roving focus with a single source of truth: the DOM. What each key
   * *means* is `app/shell/menu.ts`'s, shared with the account menu.
   *
   * @param event The key press.
   */
  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    const focused = document.activeElement;
    const inSubmenu = focused instanceof Node && (submenu.current?.contains(focused) ?? false);
    const onBranch = focused === workspaceBranch.current || focused === repoBranch.current;

    const action = menuKeyAction(event, { inSubmenu, onBranch });
    if (menuConsumesKey(action)) event.preventDefault();

    switch (action) {
      case "close":
        close(true);
        return;
      case "close-submenu":
        closeBranch();
        return;
      case "open-submenu":
        setBranch(focused === repoBranch.current ? "repo" : "workspace");
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

  const repoLabel = focus?.name ?? ALL_REPOS_LABEL;
  const repos = reposIn(listing, activeId);
  const listingNote = note(listing, activeId);

  /*
   * Nothing true to write: the session has not answered, nobody is signed in, or it points at
   * a workspace the listing does not hold — the last being a reference rather than a fact
   * (`app/api/identity.ts`), which is what somebody removed from a workspace still carries.
   *
   * A statement, not a control, because there is nothing here to switch *from*: the menu's
   * every branch is scoped to a workspace. This is the shape CP.1 shipped, kept for the one
   * state it is still the right answer to.
   */
  if (active === undefined) {
    return (
      <span className="shell-tenant" title="The workspace this session is acting in.">
        {/* The word the value needs to be understood, off-screen: printing it would double
            the width of a chip whose whole content is one slug, and the header has a 56px row
            to keep. `.sr-only` is app/globals.css's. */}
        <span className="sr-only">Workspace</span>
        <span className="shell-tenant__repo">—</span>
      </span>
    );
  }

  return (
    <div className="shell-menu shell-menu--start" ref={wrapper}>
      <button
        type="button"
        className="shell-tenant shell-tenant--control"
        ref={trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={tenantChipLabel(active.slug, repoLabel)}
        // Both halves below truncate, and at 150% they do — so the tooltip carries what the
        // ellipsis hides (§ 4's own remedy; `tenantChipTitle` says why it is the visible
        // text rather than the accessible name). On the button rather than on each span, so
        // one control offers one tooltip instead of two that fight over the pointer.
        title={tenantChipTitle(active.slug, repoLabel)}
        // Closing through `close()` rather than by flipping `open`, so a menu re-opened from
        // the chip opens in the state a menu opens in: submenus shut, nothing reported. No
        // focus is restored, because the press that closed it already put focus here.
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        {/* The organization, muted, with the separator the mockup draws attached to it — so
            the slash travels with the half that truncates first and never floats between two
            ellipses. */}
        <span className="shell-tenant__org">{active.slug} /</span>
        <span className="shell-tenant__repo">{repoLabel}</span>
        {/* Decoration: aria-expanded is what says the same thing to a screen reader. */}
        <span className="shell-tenant__caret" aria-hidden>
          ▾
        </span>
      </button>

      {open && (
        <div className="shell-menu__panel">
          <div
            className="shell-menu__items"
            id={menuId}
            role="menu"
            aria-label="Workspace and focus repository"
            ref={menu}
            onKeyDown={onKeyDown}
          >
            {view.state === "signed-in" && view.switchable ? (
              // role="none" so the submenu is a child of the menu in the accessibility tree
              // rather than of a generic box — the <li role="none"> of the ARIA menu pattern,
              // written with the elements this panel is built from.
              <div role="none" className="shell-menu__branch">
                <button
                  type="button"
                  className="shell-menu__item shell-menu__item--switch"
                  role="menuitem"
                  tabIndex={-1}
                  ref={workspaceBranch}
                  aria-haspopup="menu"
                  aria-expanded={branch === "workspace"}
                  aria-controls={branch === "workspace" ? workspaceMenuId : undefined}
                  onClick={() => setBranch((was) => (was === "workspace" ? null : "workspace"))}
                >
                  <span className="shell-menu__label">Switch workspace</span>{" "}
                  <span className="shell-menu__value">{active.slug}</span>
                  <span className="shell-menu__marker" aria-hidden>
                    ▸
                  </span>
                </button>

                {branch === "workspace" && (
                  <div
                    className="shell-menu__submenu"
                    id={workspaceMenuId}
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
                        // The active one included, and checked. A radio group needs the chosen
                        // option in it to be a group at all, and a list of only the others
                        // would make "which am I in?" a question the menu stops answering the
                        // moment it is opened.
                        aria-checked={workspace.id === active.id}
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
            ) : (
              /*
               * The workspace when there is nowhere to switch to: a fact rather than a
               * control. § 3.5 is against drawing a chooser with one choice, and
               * `app/shell/user-menu.tsx` and `app/login/enablement-card.tsx` both make the
               * same call on the same grounds — so the name is still said, and nothing
               * pretends to be pressable.
               *
               * `role="none"` because a menu's children are menu items: a paragraph among
               * them is content a screen reader in menu mode may skip past, or report as an
               * item that cannot be chosen. Nothing is lost by hiding it — the chip's own
               * accessible name carries the workspace, and carries it unopened.
               */
              <p className="shell-menu__workspace" role="none">
                {/* The space is written rather than left to the block layout: a name is
                    computed from the text, so without it a screen reader says
                    "Workspaceacme-robotics" and so does every accessible-name test. */}
                <span className="shell-menu__label">Workspace</span>{" "}
                <span className="shell-menu__value">{active.slug}</span>
              </p>
            )}

            <div role="none" className="shell-menu__branch">
              <button
                type="button"
                className="shell-menu__item shell-menu__item--switch"
                role="menuitem"
                tabIndex={-1}
                ref={repoBranch}
                aria-haspopup="menu"
                aria-expanded={branch === "repo"}
                aria-controls={branch === "repo" ? repoMenuId : undefined}
                onClick={() => setBranch((was) => (was === "repo" ? null : "repo"))}
              >
                <span className="shell-menu__label">Focus repository</span>{" "}
                <span className="shell-menu__value">{repoLabel}</span>
                <span className="shell-menu__marker" aria-hidden>
                  ▸
                </span>
              </button>

              {branch === "repo" && (
                <div
                  className="shell-menu__submenu"
                  id={repoMenuId}
                  role="menu"
                  aria-label="Focus repository"
                  // The note below is the submenu's own description rather than an item in
                  // it: "still loading" and "none are enabled" are facts about the list, and
                  // a reader walking the choices should meet them before the walk, not inside
                  // it as something that cannot be chosen.
                  aria-describedby={listingNote === null ? undefined : noteId}
                  ref={submenu}
                >
                  {/*
                    All repositories: always offered, and offered first, because it is the
                    default and it is true without anything having been read. It is what a
                    workspace with no listing yet — or none at all — can still choose.
                  */}
                  <button
                    type="button"
                    className="shell-menu__item shell-menu__choice"
                    role="menuitemradio"
                    tabIndex={-1}
                    aria-checked={focus === null}
                    onClick={() => chooseRepo(null)}
                  >
                    {ALL_REPOS_LABEL}
                  </button>

                  {repos.map((repo) => (
                    <button
                      type="button"
                      key={repo.id}
                      className="shell-menu__item shell-menu__choice"
                      role="menuitemradio"
                      tabIndex={-1}
                      aria-checked={focus?.id === repo.id}
                      // The organisation it hangs from: a repository name is unique only
                      // within one, so two of them may be called the same thing and the row
                      // has to be able to say which is which without printing a uuid.
                      title={`${repo.login}/${repo.name}`}
                      onClick={() => chooseRepo(repo)}
                    >
                      {repo.name}
                    </button>
                  ))}

                  {listingNote !== null && (
                    <p className="shell-menu__note" id={noteId}>
                      {listingNote}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/*
              aria-disabled, not disabled: a control removed from the tab order takes its own
              explanation with it, and would break the arrow ring mid-walk besides. #491 turns
              this into a link to /settings — the same placeholder, and the same wait, as the
              account menu's row of the same name.
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
        Outside the panel, and always mounted: the menu closes on a completed choice, and a
        live region that is removed at the moment its text is set announces nothing at all.
      */}
      <span className="sr-only" role="status">
        {announcement}
      </span>
    </div>
  );
}

/**
 * The repositories a listing offers for a workspace.
 *
 * @param listing What the action last answered, or `null` before it has.
 * @param organizationId The workspace the chip is drawing.
 * @returns The repositories, or none — which covers *not read yet*, *failed*, and *an answer
 *   about a workspace this is no longer in*. A menu drawing another workspace's repositories
 *   for even one frame is a menu that would let one be chosen.
 */
function reposIn(
  listing: FocusRepoReading | null,
  organizationId: string | null,
): readonly EnabledRepo[] {
  if (listing === null || !listing.ok) return [];

  return listing.organizationId === organizationId ? listing.repos : [];
}

/**
 * What the repository submenu says about its own list, beyond the choices in it.
 *
 * @param listing What the action last answered, or `null` before it has.
 * @param organizationId The workspace the chip is drawing.
 * @returns The sentence, or `null` when the list speaks for itself. Three states have one:
 *   the read is still out, it failed, and the workspace has enabled nothing — the third
 *   being the difference between "there is nothing to choose" and "the menu is broken".
 */
function note(listing: FocusRepoReading | null, organizationId: string | null): string | null {
  if (listing === null) return "Reading this workspace's repositories…";
  if (!listing.ok) return listing.reason;
  if (listing.organizationId !== organizationId) return "Reading this workspace's repositories…";
  if (listing.repos.length === 0) {
    return "No repositories are enabled in this workspace yet — every one of them is in scope.";
  }

  return null;
}
