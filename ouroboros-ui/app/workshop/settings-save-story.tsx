"use client";

import Link from "next/link";
import { useState } from "react";

import { DASHBOARD_PATH } from "@/app/paths";
import { settingsAccess } from "@/app/settings/access";
import { SettingsLeaveGuard } from "@/app/settings/leave-guard";
import { SaveButton, SettingsDirtyBar } from "@/app/settings/save-controls";
import { SettingsSaveProvider, useSettingsSection } from "@/app/settings/save-provider";
import type { SectionCommitResult } from "@/app/settings/save-model";
import { SectionMarks, SettingsSeat } from "@/app/settings/settings-seat";
import { sectionTitleId, settingsSection } from "@/app/settings/view";
import { Button, Card, CardHead, Eyebrow, Tag, TextField, Toggle } from "@/app/ui";

import "@/app/settings/settings.css";
import "./workshop.css";

/**
 * The settings save model story (BS.1,
 * [#491](https://github.com/NobuData/ouroboros/issues/491), decision **S7**) — a page of the
 * component workshop ([#48](https://github.com/NobuData/ouroboros/issues/48)).
 *
 * The save model is a contract five cards build against (BS.2–BS.6), and on the day it lands
 * the hub has no field to show it with: every card that owns one is a later issue. A contract
 * nobody can look at is a contract everyone re-derives — the reason the in-pane chrome has a
 * story (`app/workshop/chrome-story.tsx`) — so this is the same thing for saving: the real
 * provider, the real bar, the real leave guard and the real seats, over two fixture cards.
 *
 * What it demonstrates, one criterion each:
 *
 * - **An accurate count.** Each field that differs from what is saved is one; setting it back
 *   takes it off again.
 * - **Per-section, atomic commits.** Each card writes in one request. A refusal stops the save
 *   there: what landed before it stays saved, what comes after is not sent, and the bar says
 *   which is which.
 * - **Errors at their inputs.** A refusal names fields; the errors are drawn under them and
 *   focus moves to the first.
 * - **A question before leaving.** With anything unsaved, a link away asks first.
 * - **Immediate sections are not in the batch.** The Danger zone seat is marked, and holds no
 *   field.
 * - **Read-only as a rendering mode.** *View as a viewer* draws the same values with nothing to
 *   operate.
 *
 * ### The fixture is honest about being one
 *
 * Nothing is written anywhere: the "service" is this component's state, and its two refusals
 * are rules stated in the fields' own hints, so a reader can produce each outcome on purpose.
 */

/** The Workspace fixture's fields. */
interface WorkspaceValues {
  readonly name: string;
  readonly domain: string;
}

/** The Notifications fixture's fields. */
interface NotificationValues {
  readonly digest: boolean;
  readonly channel: string;
}

/** What the fixture "service" holds before anything is saved — mockup 17's own values. */
const SAVED_WORKSPACE: WorkspaceValues = { name: "acme-robotics", domain: "acme.ouroboros.dev" };
const SAVED_NOTIFICATIONS: NotificationValues = { digest: true, channel: "#eng-leads" };

/** What each fixture rule says, where its field will show it. */
const NAME_REQUIRED = "A workspace needs a name.";
const DOMAIN_TAKEN = "That domain is already used by another workspace.";
const CHANNEL_SHAPE = "A channel starts with #.";

/**
 * Wait, as a request would.
 *
 * @param ms How long. `0` resolves on the next turn, which is what a suite passes.
 * @returns When the time has passed.
 */
function pause(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * The story.
 *
 * @param props.latencyMs How long each fixture write takes — long enough to see *Saving…* by
 *   default; a suite passes `0`.
 * @returns The page, rendered inside the shell's content pane.
 */
export function SettingsSaveStory({ latencyMs = 400 }: Readonly<{ latencyMs?: number }>) {
  const [workspace, setWorkspace] = useState(SAVED_WORKSPACE);
  const [notifications, setNotifications] = useState(SAVED_NOTIFICATIONS);
  const [viewer, setViewer] = useState(false);

  return (
    <SettingsSaveProvider access={settingsAccess([viewer ? "viewer" : "owner"])}>
      <main className="settings">
        <div className="settings__head">
          <div className="settings__headings">
            <Eyebrow>Component workshop</Eyebrow>
            <h1 className="settings__title">Settings save model</h1>
            <p className="settings__sub">
              Field edits accumulate and are committed a section at a time; nothing here is
              written anywhere but this page.
            </p>
          </div>
          <div className="settings__actions">
            <Button
              aria-pressed={viewer}
              onClick={() => {
                setViewer((was) => !was);
              }}
              tone="ghost"
            >
              View as a viewer
            </Button>
            {!viewer && <SaveButton />}
          </div>
        </div>

        <SettingsDirtyBar />
        <SettingsLeaveGuard />

        <div className="settings__grid">
          <SettingsSeat section="workspace">
            <WorkspaceFixture
              latencyMs={latencyMs}
              onSaved={(changes) => {
                setWorkspace((was) => ({ ...was, ...changes }));
              }}
              saved={workspace}
            />
          </SettingsSeat>
          <SettingsSeat section="notifications">
            <NotificationsFixture
              latencyMs={latencyMs}
              onSaved={(changes) => {
                setNotifications((was) => ({ ...was, ...changes }));
              }}
              saved={notifications}
            />
          </SettingsSeat>
          <SettingsSeat section="danger" />
        </div>

        <p className="wk-prose wk-leave">
          With anything unsaved, leaving asks first:{" "}
          <Link className="wk-link" href={DASHBOARD_PATH}>
            go to the dashboard
          </Link>
          .
        </p>
      </main>
    </SettingsSaveProvider>
  );
}

/**
 * The Workspace fixture: two text fields, a rule the browser checks and a rule the "service"
 * does.
 *
 * @param props.saved What the fixture service holds.
 * @param props.onSaved Called with the changes a write accepted.
 * @param props.latencyMs How long a write takes.
 * @returns The card.
 */
function WorkspaceFixture({
  saved,
  onSaved,
  latencyMs,
}: Readonly<{
  saved: WorkspaceValues;
  onSaved: (changes: Partial<WorkspaceValues>) => void;
  latencyMs: number;
}>) {
  const fields = useSettingsSection<WorkspaceValues>({
    baseline: saved,
    labels: { name: "Workspace name", domain: "Tenant domain" },
    // Checked in the browser, before anything is sent — so nothing is, anywhere.
    validate: (draft) => (draft.name.trim() === "" ? { name: NAME_REQUIRED } : {}),
    commit: async (changes): Promise<SectionCommitResult> => {
      await pause(latencyMs);

      if (changes.domain?.includes("taken") === true) {
        return {
          ok: false,
          reason: "The workspace was not changed.",
          fields: { domain: DOMAIN_TAKEN },
        };
      }

      onSaved(changes);

      return { ok: true };
    },
  });
  const section = settingsSection("workspace");

  return (
    <Card aria-labelledby={sectionTitleId(section.id)} as="section">
      <CardHead beside={<SectionMarks />} title={section.title} titleId={sectionTitleId(section.id)} />
      <div className="wk-fields">
        <TextField
          error={fields.error("name")}
          hint="Clear it to see the browser's own check stop the save."
          id={fields.id("name")}
          label="Workspace name"
          mono
          onChange={(event) => {
            fields.set("name", event.target.value);
          }}
          readOnly={!fields.editable}
          value={fields.values.name}
        />
        <TextField
          error={fields.error("domain")}
          hint="A domain containing “taken” is refused by the fixture service."
          id={fields.id("domain")}
          label="Tenant domain"
          mono
          onChange={(event) => {
            fields.set("domain", event.target.value);
          }}
          readOnly={!fields.editable}
          value={fields.values.domain}
        />
      </div>
    </Card>
  );
}

/**
 * The Notifications fixture: a switch that is a batch field — it waits for **Save changes**
 * like any other — and a text field the "service" has a rule about.
 *
 * @param props.saved What the fixture service holds.
 * @param props.onSaved Called with the changes a write accepted.
 * @param props.latencyMs How long a write takes.
 * @returns The card.
 */
function NotificationsFixture({
  saved,
  onSaved,
  latencyMs,
}: Readonly<{
  saved: NotificationValues;
  onSaved: (changes: Partial<NotificationValues>) => void;
  latencyMs: number;
}>) {
  const fields = useSettingsSection<NotificationValues>({
    baseline: saved,
    labels: { digest: "Daily digest", channel: "Weekly report channel" },
    commit: async (changes): Promise<SectionCommitResult> => {
      await pause(latencyMs);

      if (changes.channel !== undefined && !changes.channel.startsWith("#")) {
        return {
          ok: false,
          reason: "The notification routes were not changed.",
          fields: { channel: CHANNEL_SHAPE },
        };
      }

      onSaved(changes);

      return { ok: true };
    },
  });
  const section = settingsSection("notifications");

  return (
    <Card aria-labelledby={sectionTitleId(section.id)} as="section">
      <CardHead beside={<SectionMarks />} title={section.title} titleId={sectionTitleId(section.id)} />
      <div className="wk-fields">
        <div className="wk-switch-row">
          <Toggle
            checked={fields.values.digest}
            label={`Daily digest to email — ${fields.values.digest ? "on" : "off"}`}
            onClick={() => {
              fields.set("digest", !fields.values.digest);
            }}
            reason={fields.editable ? undefined : "Changing a notification route takes an owner or an admin."}
          />
          <span className="wk-switch-text">Daily digest 09:00 → email</span>
          {/* A switch that waits for Save says so the moment it is moved. */}
          {fields.isDirty("digest") && <Tag>unsaved</Tag>}
        </div>
        <TextField
          error={fields.error("channel")}
          hint="A channel that does not start with # is refused by the fixture service."
          id={fields.id("channel")}
          label="Weekly report channel"
          mono
          onChange={(event) => {
            fields.set("channel", event.target.value);
          }}
          readOnly={!fields.editable}
          value={fields.values.channel}
        />
      </div>
    </Card>
  );
}
