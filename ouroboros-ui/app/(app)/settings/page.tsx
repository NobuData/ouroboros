import { requireWorkspace } from "@/app/api/access";
import { settingsAccess } from "@/app/settings/access";
import { readSettings } from "@/app/settings/data";
import { SettingsScreen } from "@/app/settings/settings-screen";

/**
 * Workspace settings (BS.1, [#491](https://github.com/NobuData/ouroboros/issues/491)) — mockup
 * 17's `/settings`, the administration hub.
 *
 * Thin on purpose, the shape every screen in `(app)` takes: the gate returns the workspace this
 * request may render, the reader turns it into what the screen draws, and a component draws it.
 * The decisions are in `app/settings/view.ts` (the sections and the tabs),
 * `app/settings/access.ts` (who may do what) and `app/settings/save-model.ts` (how saving works).
 *
 * **This retires the redirect that stood here** — the route sent a visitor to the section's one
 * built tab until the hub existed — and with it the `/settings` placeholder #49 held. The
 * sidebar's **Settings** entry and the header menus' *Workspace settings* items lead here.
 *
 * `requireWorkspace()` is called here rather than in the group's layout for the reason
 * `app/(app)/layout.tsx` sets out. The gate is also two of the page's **inputs**: the eyebrow
 * names the workspace, and which of the page's three variants this reader gets — owner, admin,
 * read-only — is answered once, here, from the roles the service reported for them. The gate
 * that **enforces** is the service's, on every write behind the page.
 *
 * **Keyed by the workspace.** The screen holds the page's unsaved edits, and they are one
 * workspace's: a switch from the header menus re-renders this route in place, and the key is
 * what stops an edit made for one workspace from being offered for saving in another.
 *
 * @returns The settings hub, for the workspace this request is operating in.
 */
export default async function Page() {
  const access = await requireWorkspace();
  const readings = await readSettings(access);

  return (
    <SettingsScreen
      access={settingsAccess(access.membership.roles)}
      dryRun={readings.dryRun}
      members={readings.members}
      readAt={readings.readAt}
      serviceAccounts={readings.serviceAccounts}
      key={access.membership.id}
      workspaceName={access.membership.name}
    />
  );
}
