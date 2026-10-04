"use client";

import { useRouter } from "next/navigation";

import { Button, StickyBar } from "@/app/ui";
import { isPlainClick } from "@/app/workflows/mode-switch";

import { useSettingsSave } from "./save-provider";
import {
  DISCARD_LABEL,
  NOTHING_TO_SAVE,
  SAVING_LABEL,
  dirtyLabel,
  saveLabel,
} from "./save-model";
import { EXPORT_AUDIT_LABEL } from "./view";

import "./settings.css";

/**
 * The controls of the settings page's save model
 * (BS.1, [#491](https://github.com/NobuData/ouroboros/issues/491), decision **S7**): the head's
 * two actions, and the dirty bar under the tab row.
 *
 * Both read `app/settings/save-provider.tsx` and hold nothing themselves, so the head's count
 * and the bar's cannot disagree.
 */

/** The Audit section, as a fragment of the page the head is on. */
const AUDIT_HASH = "#audit";

/**
 * **Save changes** — `Save changes (3)` while fields are unsaved.
 *
 * The one accent-filled action of the page. With nothing unsaved it is inert *with its
 * reason* — the design system's rule for a control that cannot act (§ 3.5) — rather than
 * missing, so the page always shows where saving happens.
 *
 * @param props.size The button's size — the head's default, the bar's small.
 * @returns The button.
 */
export function SaveButton({ size = "md" }: Readonly<{ size?: "sm" | "md" }>) {
  const save = useSettingsSave();
  const reason = save.saving ? SAVING_LABEL : save.pending === 0 ? NOTHING_TO_SAVE : undefined;

  return (
    <Button onClick={save.save} reason={reason} size={size} tone="primary">
      {save.saving ? SAVING_LABEL : saveLabel(save.pending)}
    </Button>
  );
}

/**
 * The page head's actions: **Export audit CSV** and **Save changes**.
 *
 * *Export audit CSV* is the mockup's shortcut — a link to the Audit section, where BS.5
 * ([#495](https://github.com/NobuData/ouroboros/issues/495)) puts the export itself — so it is
 * a navigation and is drawn for every reader. It is a real link, to the section's own address,
 * and a plain press is handed to the router for the tab row's reason: a native fragment jump
 * leaves a history entry the router cannot return to. *Save changes* is drawn only for a reader
 * who may change something: a viewer gets no button to wonder about, and the note under the
 * tab row says why.
 *
 * @returns The two actions, or the one.
 */
export function SettingsHeadActions() {
  const router = useRouter();
  const { access } = useSettingsSave();

  return (
    <>
      <Button
        href={AUDIT_HASH}
        onClick={(event) => {
          // A modified press opens the section in another tab, as any link would.
          if (!isPlainClick(event)) return;

          event.preventDefault();
          router.push(AUDIT_HASH);
        }}
        tone="ghost"
      >
        {EXPORT_AUDIT_LABEL}
      </Button>
      {access.mayEdit && <SaveButton />}
    </>
  );
}

/**
 * The dirty-state bar — `3 unsaved changes · [Save changes (3)] [Discard]`, stuck under the tab
 * row while the page scrolls.
 *
 * The CP.4 `StickyBar` in its *asking* manner, exactly as the Models page's bar is
 * (`app/models/dirty-bar.tsx`, the AA.3 discipline S7 names): the head's button scrolls away
 * with the head, and a reader three cards down still needs to see that something is unsaved
 * and be able to save it.
 *
 * ### Present only while there is something to decide
 *
 * A clean page has no bar, and a reader who may not edit — whose dirty state is empty by
 * construction — never sees one. What is always mounted is the live region the save's notice is
 * read from: a live region added in the same moment as its content is not announced, and
 * *Settings saved* is said at the exact moment the bar leaves.
 *
 * ### The count is a status, the failure is an alert
 *
 * *3 unsaved changes* is a fact about the page and joins the polite queue; a save that did not
 * land is an interruption, and names the section and the field it stopped at.
 *
 * @returns The live region, and the bar while anything is unsaved.
 */
export function SettingsDirtyBar() {
  const save = useSettingsSave();

  return (
    <>
      <p className="sr-only" role="status">
        {save.notice ?? ""}
      </p>

      {save.pending > 0 && (
        <StickyBar className="settings-dirty" tone="asking">
          <span className="settings-dirty__label" role="status">
            {dirtyLabel(save.pending)}
          </span>
          <span aria-hidden className="settings-dirty__sep">
            ·
          </span>
          <span className="settings-dirty__actions">
            <SaveButton size="sm" />
            <Button
              onClick={save.discard}
              reason={save.saving ? SAVING_LABEL : undefined}
              size="sm"
              tone="ghost"
            >
              {DISCARD_LABEL}
            </Button>
          </span>

          {save.failure !== null && (
            <p className="settings-dirty__failure" role="alert">
              {save.failure}
            </p>
          )}
        </StickyBar>
      )}
    </>
  );
}
