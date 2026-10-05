"use client";

import type { OrgPolicy } from "@/app/api/org-policy";
import type { DryRunPolicy } from "@/app/api/policies";
import type { Reading } from "@/app/api/reading";
import type { AuditToday } from "@/app/api/settings-audit";
import type { Integrations, NotificationRoutes } from "@/app/api/settings-integrations";
import type { WorkspaceLifecycle } from "@/app/api/settings-lifecycle";
import type { MembersPage, ServiceAccountList } from "@/app/api/settings-members";
import type { WebhookList } from "@/app/api/settings-webhooks";
import type { RetentionSettings, WorkspaceSettings } from "@/app/api/settings-workspace";
import { AuditCard } from "@/app/audit-log/audit-card";
import { AUDIT_ADMINS_ONLY, actorOptions, auditUnread } from "@/app/audit-log/view";
import { IntegrationsCard } from "@/app/integrations/integrations-card";
import { NotificationsCard } from "@/app/integrations/notifications-card";
import { routesUnread } from "@/app/integrations/routes";
import { integrationsUnread } from "@/app/integrations/view";
import { DangerCard } from "@/app/lifecycle/danger-card";
import { lifecycleUnread } from "@/app/lifecycle/danger";
import { MembersCard } from "@/app/members/members-card";
import { membersUnread } from "@/app/members/view";
import { ownerNames, policyUnread } from "@/app/policies/card-view";
import { DryRunRow } from "@/app/policies/dry-run-row";
import { PolicyCard } from "@/app/policies/policy-card";
import { dryRunUnread } from "@/app/policies/view";
import { SiemRow } from "@/app/webhooks/siem-row";

import { type SettingsAccess, readOnlyNote } from "./access";
import { AppearanceCard } from "./appearance-card";
import { SettingsLeaveGuard } from "./leave-guard";
import { SettingsReadBanner } from "./read-banner";
import { SettingsDirtyBar, SettingsHeadActions } from "./save-controls";
import { SettingsSaveProvider } from "./save-provider";
import { SettingsFrame } from "./settings-frame";
import { SeatPlaceholder, SettingsSeat } from "./settings-seat";
import { SETTINGS_SECTIONS, SETTINGS_SUBLINE, SETTINGS_TITLE } from "./view";
import { WorkspaceCard } from "./workspace-card";
import { workspaceUnread } from "./workspace";

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
 * The **Workspace** seat holds its card (`app/settings/workspace-card.tsx`, #492) when both of its
 * reads succeeded, or its placeholder saying why it could not be drawn. The **Appearance** seat
 * holds its card (`app/settings/appearance-card.tsx`) — the reader's own
 * theme and font size, the same for every role. The **Members** seat holds the Members & Roles
 * card (`app/members/members-card.tsx`, #493), or its placeholder saying why the members could
 * not be read. The **Policies** seat holds the Autonomy policies card
 * (`app/policies/policy-card.tsx`, #494) — the five rules, their history and their publish flow,
 * with the dry-run policy's switch under them — or its placeholder saying why the document could
 * not be read. The **Audit** seat holds the Audit log card (`app/audit-log/audit-card.tsx`, #495)
 * with the SIEM row (`app/webhooks/siem-row.tsx`) in its footer — for an owner or an admin, who
 * are the readers the service answers; anybody else is told whose log it is to read. The
 * **Integrations** seat holds the truth-state grid (`app/integrations/integrations-card.tsx`) and
 * the **Notifications** seat the org routes (`app/integrations/notifications-card.tsx`), each or
 * its placeholder saying why it could not be read. The **Danger zone** seat holds its card
 * (`app/lifecycle/danger-card.tsx`, #496) — pause, disconnect, delete — or its placeholder
 * saying the workspace's state could not be read, and so that no control is drawn.
 *
 * ### When a read fails
 *
 * The seat it fills says why, and the page says it once above the grid with **Retry**
 * (`app/settings/read-banner.tsx`) — the DASH-I.7 pattern. The loading state is
 * `app/settings/settings-skeleton.tsx`.
 *
 * @param props.workspaceName The active workspace's display name, for the eyebrow.
 * @param props.access Who the reader is — `app/settings/access.ts`'s answer, from the route.
 * @param props.dryRun The dry-run policy as read, or why it could not be.
 * @param props.policy The org policy document in force as read, or why it could not be.
 * @param props.workspace The Workspace card's payload as read, or why it could not be.
 * @param props.retention The retention tiers as read, or why they could not be.
 * @param props.members The Members & Roles page as read, or why it could not be.
 * @param props.serviceAccounts The administrator's service-account list, or `null`.
 * @param props.audit The Audit card's today view as read, why it could not be, or `null` for a
 *   reader it is never requested for.
 * @param props.webhooks The administrator's webhook endpoints, or `null`.
 * @param props.integrations The integrations grid as read, or why it could not be.
 * @param props.routes The org notification routes as read, or why they could not be.
 * @param props.lifecycle Where the workspace stands as read, or why it could not be.
 * @param props.readAt When the page was read.
 * @returns The hub.
 */
export function SettingsScreen({
  workspaceName,
  access,
  dryRun,
  policy,
  workspace,
  retention,
  members,
  serviceAccounts = null,
  audit,
  webhooks = null,
  integrations,
  routes,
  lifecycle,
  readAt,
}: Readonly<{
  workspaceName: string;
  access: SettingsAccess;
  dryRun: Reading<DryRunPolicy>;
  policy?: Reading<OrgPolicy>;
  workspace?: Reading<WorkspaceSettings>;
  retention?: Reading<RetentionSettings>;
  members?: Reading<MembersPage>;
  serviceAccounts?: ServiceAccountList | null;
  audit?: Reading<AuditToday> | null;
  webhooks?: WebhookList | null;
  integrations?: Reading<Integrations>;
  routes?: Reading<NotificationRoutes>;
  lifecycle?: Reading<WorkspaceLifecycle>;
  readAt?: string;
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

        <SettingsReadBanner
          reads={{
            dryRun,
            policy,
            workspace,
            retention,
            members,
            audit,
            integrations,
            routes,
            lifecycle,
          }}
        />

        <div className="settings__grid">
          {SETTINGS_SECTIONS.map((section) => (
            <SettingsSeat key={section.id} section={section.id}>
              {section.id === "appearance" ? (
                <AppearanceCard />
              ) : section.id === "workspace" && workspace !== undefined && retention !== undefined ? (
                workspace.ok && retention.ok ? (
                  <WorkspaceCard
                    // A change of tier (the reader re-roled themselves) remounts it fresh.
                    key={access.tier}
                    readAt={readAt ?? new Date(0).toISOString()}
                    retention={retention.value}
                    settings={workspace.value}
                  />
                ) : (
                  <SeatPlaceholder>
                    <p className="settings__unread" role="note">
                      {workspaceUnread(workspace.ok ? null : workspace.reason, retention.ok ? null : retention.reason)}
                    </p>
                  </SeatPlaceholder>
                )
              ) : section.id === "members" && members !== undefined ? (
                members.ok ? (
                  <MembersCard
                    // A change of tier (the reader re-roled themselves) remounts it fresh.
                    key={access.tier}
                    mayOwn={access.mayOwn}
                    page={members.value}
                    readAt={readAt ?? new Date(0).toISOString()}
                    serviceAccounts={serviceAccounts}
                  />
                ) : (
                  <SeatPlaceholder>
                    <p className="settings__unread" role="note">
                      {membersUnread(members.reason)}
                    </p>
                  </SeatPlaceholder>
                )
              ) : section.id === "policies" && policy?.ok === true ? (
                <PolicyCard
                  dryRun={dryRun}
                  // A change of tier (the reader re-roled themselves) remounts it fresh.
                  key={access.tier}
                  owners={members?.ok === true ? ownerNames(members.value.members) : []}
                  policy={policy.value}
                />
              ) : section.id === "policies" ? (
                <SeatPlaceholder>
                  {policy !== undefined && !policy.ok && (
                    <p className="settings__unread" role="note">
                      {policyUnread(policy.reason)}
                    </p>
                  )}
                  {dryRun.ok ? (
                    <DryRunRow mayAdminister={access.mayEdit} policy={dryRun.value} />
                  ) : (
                    <p className="settings__unread" role="note">
                      {dryRunUnread(dryRun.reason)}
                    </p>
                  )}
                </SeatPlaceholder>
              ) : section.id === "audit" && audit !== undefined ? (
                audit?.ok === true ? (
                  <AuditCard
                    actors={actorOptions(members?.ok === true ? members.value : null, serviceAccounts)}
                    // A change of tier (the reader re-roled themselves) remounts it fresh.
                    key={access.tier}
                    siem={<SiemRow webhooks={webhooks} />}
                    today={audit.value}
                  />
                ) : (
                  <SeatPlaceholder>
                    <p className="settings__unread" role="note">
                      {audit === null ? AUDIT_ADMINS_ONLY : auditUnread(audit.reason)}
                    </p>
                  </SeatPlaceholder>
                )
              ) : section.id === "integrations" && integrations !== undefined ? (
                integrations.ok ? (
                  <IntegrationsCard
                    integrations={integrations.value}
                    key={access.tier}
                    mayManage={access.mayEdit}
                    webhooks={webhooks}
                  />
                ) : (
                  <SeatPlaceholder>
                    <p className="settings__unread" role="note">
                      {integrationsUnread(integrations.reason)}
                    </p>
                  </SeatPlaceholder>
                )
              ) : section.id === "notifications" && routes !== undefined ? (
                routes.ok ? (
                  <NotificationsCard key={access.tier} routes={routes.value} />
                ) : (
                  <SeatPlaceholder>
                    <p className="settings__unread" role="note">
                      {routesUnread(routes.reason)}
                    </p>
                  </SeatPlaceholder>
                )
              ) : section.id === "danger" && lifecycle !== undefined ? (
                lifecycle.ok ? (
                  <DangerCard
                    // A change of tier (the reader re-roled themselves) remounts it fresh.
                    key={access.tier}
                    lifecycle={lifecycle.value}
                    workspaceName={workspaceName}
                  />
                ) : (
                  <SeatPlaceholder>
                    <p className="settings__unread" role="note">
                      {lifecycleUnread(lifecycle.reason)}
                    </p>
                  </SeatPlaceholder>
                )
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
