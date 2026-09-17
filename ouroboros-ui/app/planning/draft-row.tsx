"use client";

import { useEffect, useId, useRef, useState } from "react";

import type { PlanningDraft } from "@/app/api/planning";
import { Button, EffortChip, Tag, TextAreaField, TextField } from "@/app/ui";

import {
  BODY_LABEL,
  CANCEL_LABEL,
  EDIT_LABEL,
  MAX_TITLE_LENGTH,
  PUSHING_MARK,
  type RowPush,
  type RowSizing,
  SAVE_LABEL,
  SIZING_MARK,
  TITLE_LABEL,
  TITLE_REQUIRED,
  UNSIZED_MARK,
} from "./generator";

import "./planning.css";

/**
 * One draft row of the generator card — mockup 09's `.draft-row`
 * (AM.2, [#284](https://github.com/NobuData/ouroboros/issues/284)).
 *
 * Checkbox, mono local key, title, dependency note, effort chip, workflow tag — the mockup's order —
 * then the row's push state and its **Edit** affordance. Every judgement about what to draw is
 * decided by the card from `generator.ts` and handed in; the row draws it and owns only its editor.
 *
 * ### The checkbox decides what gets created
 *
 * It is a real checkbox, labelled `Include OTA-1`, so selection works from the keyboard (Space) and
 * reads as checked or not. An inert one is `disabled` with its reason as the tooltip.
 *
 * ### The inline editor
 *
 * **Edit** opens a title and body form under the row and moves focus into it; **Escape** or
 * **Cancel** closes it and returns focus to **Edit**; **Save** sends the patch, and the row closes
 * once the service accepted it. A title left blank is refused before anything is sent.
 */

/** What the row takes. */
export interface DraftRowProps {
  /** The draft. */
  readonly draft: PlanningDraft;
  /** Whether it is checked right now, pending clicks included. */
  readonly selected: boolean;
  /** Its estimate as drawn. */
  readonly sizing: RowSizing;
  /** Its dependency note, or `null`. */
  readonly blocks: string | null;
  /** Its push state as drawn. */
  readonly push: RowPush;
  /** Why the checkbox cannot change, when it cannot. */
  readonly selectReason?: string;
  /** Why the editor cannot open, when it cannot. */
  readonly editReason?: string;
  /** Whether the editor is open. */
  readonly editing: boolean;
  /** Called with the new checked state. */
  readonly onSelect: (selected: boolean) => void;
  /** Called to open (`true`) or close (`false`) the editor. */
  readonly onEditing: (open: boolean) => void;
  /**
   * Called to save an edit.
   *
   * @returns Whether the service accepted it — the editor stays open on a refusal.
   */
  readonly onSave: (title: string, body: string) => Promise<boolean>;
}

/**
 * The row.
 *
 * @param props See {@link DraftRowProps}.
 * @returns The list item.
 */
export function DraftRow({
  draft,
  selected,
  sizing,
  blocks,
  push,
  selectReason,
  editReason,
  editing,
  onSelect,
  onEditing,
  onSave,
}: DraftRowProps) {
  const ids = useId();
  const line = useRef<HTMLDivElement>(null);

  return (
    <li className="planning-draft">
      <div className="planning-draft__line" ref={line}>
        <input
          aria-label={`Include ${draft.localKey}`}
          checked={selected}
          className="planning-draft__check"
          disabled={selectReason !== undefined}
          onChange={(event) => { onSelect(event.currentTarget.checked); }}
          title={selectReason}
          type="checkbox"
        />
        <span className="planning-draft__key">{draft.localKey}</span>
        <span className="planning-draft__title">{draft.title}</span>
        {blocks !== null && <span className="planning-draft__dep">{blocks}</span>}
        <PushState push={push} />
        <Sizing sizing={sizing} />
        {draft.suggestedWorkflow !== null && <Tag>{draft.suggestedWorkflow}</Tag>}
        <Button
          aria-expanded={editing}
          aria-label={`${EDIT_LABEL} ${draft.localKey}`}
          onClick={() => { onEditing(!editing); }}
          reason={editReason}
          size="sm"
          tone="ghost"
        >
          {EDIT_LABEL}
        </Button>
      </div>

      {editing && editReason === undefined && (
        <DraftEditor
          draft={draft}
          id={ids}
          onClose={() => {
            onEditing(false);
            // The primitive forwards no ref, so focus returns through the row's own markup.
            line.current?.querySelector<HTMLButtonElement>("button[aria-expanded]")?.focus();
          }}
          onSave={onSave}
        />
      )}
    </li>
  );
}

/**
 * The row's push state.
 *
 * @param props.push What to say.
 * @returns The link, the mark, or nothing.
 */
function PushState({ push }: Readonly<{ push: RowPush }>) {
  switch (push.state) {
    case "none":
      return null;
    case "pushing":
      return <span className="planning-draft__pushing">{PUSHING_MARK}</span>;
    case "failed":
      return <span className="planning-draft__failed">{push.text}</span>;
    case "pushed":
      return push.href === null ? (
        <span className="planning-draft__pushed">{push.text}</span>
      ) : (
        <a className="planning-draft__pushed" href={push.href} rel="noreferrer" target="_blank">
          {push.text}
        </a>
      );
  }
}

/**
 * The row's estimate.
 *
 * @param props.sizing What to draw.
 * @returns The effort chip, or the mark saying why there is none.
 */
function Sizing({ sizing }: Readonly<{ sizing: RowSizing }>) {
  if (sizing.state === "sized") return <EffortChip effort={sizing.effort} />;

  return (
    <span className="planning-draft__sizing">
      {sizing.state === "sizing" ? SIZING_MARK : UNSIZED_MARK}
    </span>
  );
}

/**
 * The inline editor.
 *
 * @param props.draft The draft being edited — the form opens on its title and body.
 * @param props.id A stable id prefix for the fields.
 * @param props.onClose Close without saving (or after a save was accepted).
 * @param props.onSave Send the edit; resolves to whether it was accepted.
 * @returns The form.
 */
function DraftEditor({
  draft,
  id,
  onClose,
  onSave,
}: Readonly<{
  draft: PlanningDraft;
  id: string;
  onClose: () => void;
  onSave: (title: string, body: string) => Promise<boolean>;
}>) {
  const [title, setTitle] = useState(draft.title);
  const [body, setBody] = useState(draft.body ?? "");
  const [saving, setSaving] = useState(false);
  const [blank, setBlank] = useState(false);
  const form = useRef<HTMLFormElement>(null);

  // Focus moves into the editor it opened — the title, the field most edits are for.
  useEffect(() => {
    form.current?.querySelector("input")?.focus();
  }, []);

  /**
   * Save the edit.
   *
   * @param event The submit.
   */
  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (saving) return;

    if (title.trim() === "") {
      setBlank(true);
      return;
    }

    setSaving(true);
    const accepted = await onSave(title, body);
    setSaving(false);

    if (accepted) onClose();
  }

  return (
    <form
      aria-label={`${EDIT_LABEL} ${draft.localKey}`}
      className="planning-draft__editor"
      ref={form}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
      onSubmit={(event) => void submit(event)}
    >
      <TextField
        autoComplete="off"
        error={blank ? TITLE_REQUIRED : undefined}
        id={`${id}-title`}
        label={TITLE_LABEL}
        maxLength={MAX_TITLE_LENGTH}
        onChange={(event) => {
          setTitle(event.currentTarget.value);
          setBlank(false);
        }}
        required
        value={title}
      />
      <TextAreaField
        id={`${id}-body`}
        label={BODY_LABEL}
        onChange={(event) => { setBody(event.currentTarget.value); }}
        rows={4}
        value={body}
      />
      <div className="planning-draft__editor-actions">
        <Button reason={saving ? SAVE_LABEL : undefined} size="sm" tone="primary" type="submit">
          {SAVE_LABEL}
        </Button>
        <Button onClick={onClose} size="sm" tone="ghost" type="button">
          {CANCEL_LABEL}
        </Button>
      </div>
    </form>
  );
}
