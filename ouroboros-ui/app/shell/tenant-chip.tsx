"use client";

import { useListOrganizations, useSession } from "@/app/api/auth-client";

import { accountView } from "./account";

/**
 * The tenant chip: which workspace the session is acting in
 * ([#643](https://github.com/NobuData/ouroboros/issues/643)).
 *
 * Immediately right of the brand, where the shell specification puts it
 * (`docs/DESIGN_SYSTEM_APP_SHELL.md` § 1.1). The specification draws it as
 * `acme-robotics / helios-firmware ▾` — an org *and* a repository, with a caret — and this
 * draws the half that is true today. There is no repository scope in the product yet, and
 * nothing here switches: the switcher is
 * [#77](https://github.com/NobuData/ouroboros/issues/77), and a caret on a control that does
 * not open is the kind of lie the design system's honesty rule (§ 3.5) is aimed at.
 *
 * **It is a statement, not a control**, and that is the same judgement `app/shell/account.ts`
 * makes about a chooser with nothing to choose. Workspace *can* be switched today — from the
 * account menu, which [#721](https://github.com/NobuData/ouroboros/issues/721) built — so the
 * chip's tooltip says where rather than leaving a reader to hunt for it.
 *
 * ### Why it reads the session itself
 *
 * The same argument `app/shell/user-menu.tsx` makes, and the same read: `useSession()` and
 * `useListOrganizations()` are stores the organization plugin invalidates when `set-active`
 * returns, so this chip and that menu redraw together the moment a switch lands, with no code
 * in either to keep them in step. Threading the value down from the `(app)` layout would give
 * a value that is stale the first time somebody navigates between two pages in the group.
 *
 * The reading is `accountView()`'s rather than a second interpretation of the two stores:
 * *which workspace is active* is one question, and the shell answers it in one place.
 */

/**
 * The chip.
 *
 * @returns The workspace's slug, or an em dash while there is nothing true to write there.
 */
export function TenantChip() {
  const session = useSession();
  const workspaces = useListOrganizations();

  const view = accountView({
    user: session.data?.user,
    activeOrganizationId: session.data?.session.activeOrganizationId ?? null,
    organizations: workspaces.data,
    pending: session.isPending,
  });

  const slug = view.state === "signed-in" ? view.active?.slug : undefined;

  return (
    <span
      className="shell-tenant"
      title={
        slug === undefined
          ? "The workspace this session is acting in. Switching arrives with #77; the account menu switches it today."
          : `Workspace ${slug}. Switching from here arrives with #77; the account menu switches it today.`
      }
    >
      {/* The word the value needs to be understood, off-screen: printing it would double the
          width of a chip whose whole content is one slug, and the header has a 56px row to
          keep. `.sr-only` is app/globals.css's. */}
      <span className="sr-only">Workspace</span>
      <span className="shell-tenant__value">{slug ?? "—"}</span>
    </span>
  );
}
