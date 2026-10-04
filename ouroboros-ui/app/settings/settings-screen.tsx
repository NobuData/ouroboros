"use client";

import type { DryRunPolicy } from "@/app/api/policies";
import type { Reading } from "@/app/api/reading";
import { DryRunRow } from "@/app/policies/dry-run-row";
import { dryRunUnread } from "@/app/policies/view";

import { type SettingsAccess, readOnlyNote } from "./access";
import { AppearanceCard } from "./appearance-card";
import { SettingsLeaveGuard } from "./leave-guard";
import { SettingsDirtyBar, SettingsHeadActions } from "./save-controls";
import { SettingsSaveProvider } from "./save-provider";
import { SettingsFrame } from "./settings-frame";
import { SeatPlaceholder, SettingsSeat } from "./settings-seat";
import { SETTINGS_SECTIONS, SETTINGS_SUBLINE, SETTINGS_TITLE } from "./view";

import "./settings.css";

/**
 * The settings hub — `docs/mockups/17-settings.html`'s frame
 * (BS.1, [#491](https://github.com/NobuData/ouroboros/issues/491)).
 *
 * The page head (eyebrow composed from the real workspace, the mockup's title and subline
 * verbatim, **Export audit CSV** and **Save changes**), the section nav with the mounted admin
 * surfaces beside it, and the grid of sections — eight seats in the mockup's rows, each either
 * holding its card or saying which issue brings it.
 *
 * It renders **inside the app shell**: no chrome of its own, and the shell's content pane as
 * its only scroll container. The tab row and the dirty bar stick against that pane, and the
 * scroll-spy reads it.
 *
 * ### What the frame decides for every card
 *
 * - **Where the admin surfaces live** (S2). Sources, Providers, Farm tokens and Knowledge / env
 *   are tabs of this nav and keep their own implementations; nothing here is a second copy.
 * - **How saving works** (S7). `SettingsSaveProvider` is above everything, so a field in any
 *   seat joins one dirty state and the head's button counts all of it; the Danger zone and
 *   Appearance seats are immediate by construction (`app/settings/save-model.ts`).
 * - **What a viewer sees.** The same page, legible: no **Save changes**, a note saying whose
 *   page this is to change, and no control drawn switched off. What a viewer *can* operate is
 *   what is theirs — the Appearance card.
 *
 * ### What is mounted today
 *
 * The **Appearance** seat holds its card (`app/settings/appearance-card.tsx`) — the reader's own
 * theme and font size, the same for every role. The **Policies** seat holds the dry-run policy's
 * row — the one policy control that exists — above the note for the rest of that card. Every
 * other seat is its placeholder.
 *
 * @param props.workspaceName The active workspace's display name, for the eyebrow.
 * @param props.access Who the reader is — `app/settings/access.ts`'s answer, from the route.
 * @param props.dryRun The dry-run policy as read, or why it could not be.
 * @returns The hub.
 */
export function SettingsScreen({
  workspaceName,
  access,
  dryRun,
}: Readonly<{
  workspaceName: string;
  access: SettingsAccess;
  dryRun: Reading<DryRunPolicy>;
}>) {
  return (
    <SettingsSaveProvider access={access}>
      <SettingsFrame
        actions={<SettingsHeadActions />}
        active="hub"
        subline={SETTINGS_SUBLINE}
        title={SETTINGS_TITLE}
        workspaceName={workspaceName}
      >
        <SettingsDirtyBar />
        <SettingsLeaveGuard />

        {!access.mayEdit && <ReadOnlyNote access={access} />}

        <div className="settings__grid">
          {SETTINGS_SECTIONS.map((section) => (
            <SettingsSeat key={section.id} section={section.id}>
              {section.id === "appearance" ? (
                <AppearanceCard />
              ) : section.id === "policies" ? (
                <SeatPlaceholder>
                  {dryRun.ok ? (
                    <DryRunRow mayAdminister={access.mayEdit} policy={dryRun.value} />
                  ) : (
                    <p className="settings__unread" role="note">
                      {dryRunUnread(dryRun.reason)}
                    </p>
                  )}
                </SeatPlaceholder>
              ) : undefined}
            </SettingsSeat>
          ))}
        </div>
      </SettingsFrame>
    </SettingsSaveProvider>
  );
}

/**
 * The sentence a reader who may look and not change is given, once, above the cards.
 *
 * @param props.access The reader's access, for the role the note names.
 * @returns The note.
 */
function ReadOnlyNote({ access }: Readonly<{ access: SettingsAccess }>) {
  const note = readOnlyNote(access.role);

  return (
    <p className="settings__readonly" role="note">
      <span className="settings__readonly-head">{note.head}</span> {note.body}
    </p>
  );
}
