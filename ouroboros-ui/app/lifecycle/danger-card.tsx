"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import type { WorkspaceLifecycle } from "@/app/api/settings-lifecycle";
import { RECOVERY_PATH } from "@/app/paths";
import { useSettingsAccess } from "@/app/settings/save-provider";
import { SectionMarks } from "@/app/settings/settings-seat";
import { sectionTitleId, settingsSection } from "@/app/settings/view";
import { Button, Card, CardHead, Toggle, cx } from "@/app/ui";

import {
  DELETE_OWNER_ONLY,
  DELETE_TITLE,
  DISCONNECT_BUTTON,
  DISCONNECT_ROLE_NOTE,
  DISCONNECT_TITLE,
  DISCONNECT_WHY,
  PAUSE_ROLE_NOTE,
  PAUSE_TITLE,
  PAUSE_WHY,
  PENDING_DELETE_NOTE,
  PREVIEW_PENDING,
  type PreviewState,
  RECOVERY_LINK,
  deleteButton,
  deleteWhy,
  pauseState,
  pauseSwitchLabel,
} from "./danger";
import { DeleteDialog } from "./delete-dialog";
import { DisconnectDialog } from "./disconnect-dialog";
import {
  deleteWorkspace,
  disconnectWorkspace,
  pauseWorkspace,
  readDisconnectPreview,
  resumeWorkspace,
} from "./lifecycle-actions";
import { useLifecycle } from "./lifecycle-store";
import { PauseDialog } from "./pause-dialog";

import "./danger.css";

/** Which of the card's dialogs is open. */
type OpenDialog = "pause" | "disconnect" | "delete" | null;

/** What {@link DangerCard} takes. */
export interface DangerCardProps {
  /** Where the workspace stands, as the page read it. */
  readonly lifecycle: WorkspaceLifecycle;
  /** The workspace's name — what the destructive confirmations ask the reader to type. */
  readonly workspaceName: string;
}

/**
 * The Danger zone card — mockup 17's `c-12` card
 * (BS.6, [#496](https://github.com/NobuData/ouroboros/issues/496)).
 *
 * Three rows, in the mockup's words, and behind each the friction its consequence warrants:
 *
 * - **Pause all loops** — a switch. Turning it on asks first, in a dialog that states what
 *   pausing means and how many runs are in flight now. Turning it off resumes at once: resuming
 *   restores the normal state and has nothing to warn about.
 * - **Disconnect GitHub App** — the service's preview of what it would do to this workspace as
 *   of now, the workspace's name typed to confirm, and a summary of what it did.
 * - **Delete workspace** — an owner's alone: the consequence list, the name typed exactly, and
 *   the step-up. On success the app leaves for the recovery screen.
 *
 * ### Every control acts at once, and none is a field
 *
 * The section is `saves: "immediate"` (`app/settings/view.ts`), so nothing here can sit unsaved
 * behind **Save changes** — the save model refuses a field in this seat by construction.
 *
 * ### What a reader who may not act sees
 *
 * The same three rows, legible: where the switch stands in words, and who can act — never a
 * control drawn switched off. An admin gets the pause and the disconnect and, in the delete
 * row, the sentence that deleting is an owner's.
 *
 * ### The shell's banner moves with it
 *
 * A landed pause, resume or disconnect is handed to the lifecycle store
 * (`app/lifecycle/lifecycle-store.tsx`), so the app-wide banner appears or clears in the same
 * moment rather than on its next poll. The card draws the store's copy when it has one — it is
 * the fresher of the two — and the page's read otherwise.
 *
 * @param props See {@link DangerCardProps}.
 * @returns The card.
 */
export function DangerCard({ lifecycle: read, workspaceName }: DangerCardProps) {
  const section = settingsSection("danger");
  const titleId = sectionTitleId(section.id);
  const router = useRouter();
  const access = useSettingsAccess();
  const store = useLifecycle();
  const lifecycle = store.lifecycle ?? read;
  const paused = lifecycle.state === "paused";

  const [dialog, setDialog] = useState<OpenDialog>(null);
  const [preview, setPreview] = useState<PreviewState>(PREVIEW_PENDING);
  const [resuming, setResuming] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  /** Which preview read is the current one — an answer to an older one is dropped. */
  const latest = useRef(0);
  // A latch beside the state: two presses inside one frame both read `resuming` as false.
  const resumeSent = useRef(false);

  /**
   * Open a dialog that is drawn from live state, and read that state in the same press — so
   * the dialog's first paint is already *reading*, and nothing from an earlier open is shown.
   *
   * @param which The dialog.
   */
  function openWithPreview(which: "pause" | "disconnect"): void {
    const read = (latest.current += 1);

    setRefusal(null);
    setPreview(PREVIEW_PENDING);
    setDialog(which);

    void readDisconnectPreview().then((outcome) => {
      if (latest.current !== read) return;

      setPreview(
        outcome.ok
          ? { status: "ready", preview: outcome.value }
          : { status: "failed", reason: outcome.reason },
      );
    });
  }

  /** Resume at once — no confirmation, and a refusal said in the row. */
  async function resume(): Promise<void> {
    if (resumeSent.current) return;

    resumeSent.current = true;
    setResuming(true);
    setRefusal(null);

    try {
      const outcome = await resumeWorkspace();

      if (outcome.ok) store.apply(outcome.value);
      else setRefusal(outcome.reason);
    } finally {
      resumeSent.current = false;
      setResuming(false);
    }
  }

  return (
    <Card aria-labelledby={titleId} as="section" className="settings__card--danger">
      <CardHead beside={<SectionMarks />} title={section.title} titleId={titleId} />

      {lifecycle.state === "pending_delete" && (
        <p className="danger-zone__pending" role="note">
          {PENDING_DELETE_NOTE}{" "}
          <a className="danger-zone__link" href={RECOVERY_PATH}>
            {RECOVERY_LINK}
          </a>
        </p>
      )}

      <ul className="danger-zone">
        <li className="danger-zone__row">
          <span className="danger-zone__what">{PAUSE_TITLE}</span>
          <p className="danger-zone__why">{PAUSE_WHY}</p>
          <span className="danger-zone__control">
            <span
              className={cx("danger-zone__state", paused && "danger-zone__state--paused")}
              role="status"
            >
              {pauseState(lifecycle)}
            </span>
            {access.mayEdit && lifecycle.state !== "pending_delete" && (
              <Toggle
                checked={paused}
                className="danger-zone__switch"
                label={pauseSwitchLabel(paused)}
                onClick={() => {
                  if (paused) void resume();
                  else if (!resuming) openWithPreview("pause");
                }}
              />
            )}
          </span>
          {!access.mayEdit && <p className="danger-zone__role">{PAUSE_ROLE_NOTE}</p>}
          {refusal !== null && (
            <p className="danger-zone__refusal" role="alert">
              {refusal}
            </p>
          )}
        </li>

        <li className="danger-zone__row">
          <span className="danger-zone__what">{DISCONNECT_TITLE}</span>
          <p className="danger-zone__why">{DISCONNECT_WHY}</p>
          {!access.mayEdit ? (
            <p className="danger-zone__role">{DISCONNECT_ROLE_NOTE}</p>
          ) : (
            lifecycle.state !== "pending_delete" && (
              <Button
                aria-haspopup="dialog"
                className="danger-zone__disconnect"
                onClick={() => {
                  openWithPreview("disconnect");
                }}
                tone="ghost"
              >
                {DISCONNECT_BUTTON}
              </Button>
            )
          )}
        </li>

        <li className="danger-zone__row">
          <span className="danger-zone__what">{DELETE_TITLE}</span>
          <p className="danger-zone__why danger-zone__why--mono">
            {deleteWhy(lifecycle.recoveryWindowDays)}
          </p>
          {!access.mayOwn ? (
            <p className="danger-zone__role">{DELETE_OWNER_ONLY}</p>
          ) : (
            lifecycle.state !== "pending_delete" && (
              <Button
                aria-haspopup="dialog"
                onClick={() => {
                  setDialog("delete");
                }}
                tone="danger"
              >
                {deleteButton(workspaceName)}
              </Button>
            )
          )}
        </li>
      </ul>

      {access.mayEdit && (
        <>
          <PauseDialog
            onClose={() => {
              setDialog(null);
            }}
            onPause={pauseWorkspace}
            onPaused={(next) => {
              store.apply(next);
              setDialog(null);
            }}
            open={dialog === "pause"}
            preview={preview}
          />
          <DisconnectDialog
            onClose={() => {
              setDialog(null);
            }}
            onDisconnect={disconnectWorkspace}
            // A disconnect pauses the workspace: the store re-reads, and the banner appears.
            onDisconnected={() => void store.refresh()}
            open={dialog === "disconnect"}
            preview={preview}
            workspaceName={workspaceName}
          />
        </>
      )}

      {access.mayOwn && (
        <DeleteDialog
          onClose={() => {
            setDialog(null);
          }}
          onDelete={deleteWorkspace}
          // Every page of the workspace is frozen from this moment; the recovery screen is
          // the one place left to be.
          onDeleted={() => {
            router.replace(RECOVERY_PATH);
          }}
          open={dialog === "delete"}
          recoveryWindowDays={lifecycle.recoveryWindowDays}
          workspaceName={workspaceName}
        />
      )}
    </Card>
  );
}
