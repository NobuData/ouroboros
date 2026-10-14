"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useId, useState, useTransition } from "react";

import type { GithubToken } from "@/app/api/github-token";
import type { Reading } from "@/app/api/reading";
import { Button, Card, TextField, cx } from "@/app/ui";

import { type BacklogTokenOutcome, clearBacklogToken, setBacklogToken } from "./actions";
import {
  BACKLOG_TOKEN_ANCHOR,
  BACKLOG_TOKEN_FIELD_HINT,
  BACKLOG_TOKEN_FIELD_LABEL,
  BACKLOG_TOKEN_MAX_LENGTH,
  BACKLOG_TOKEN_MIN_LENGTH,
  BACKLOG_TOKEN_NONE,
  BACKLOG_TOKEN_NOTE,
  BACKLOG_TOKEN_PATTERN,
  BACKLOG_TOKEN_READ_ONLY,
  BACKLOG_TOKEN_REMOVE,
  BACKLOG_TOKEN_REMOVED,
  BACKLOG_TOKEN_REMOVE_CANCEL,
  BACKLOG_TOKEN_REMOVE_CONFIRM,
  BACKLOG_TOKEN_REMOVE_QUESTION,
  BACKLOG_TOKEN_REMOVING,
  BACKLOG_TOKEN_REPLACE,
  BACKLOG_TOKEN_SAVE,
  BACKLOG_TOKEN_SAVED,
  BACKLOG_TOKEN_SAVING,
  BACKLOG_TOKEN_TITLE,
  BACKLOG_TOKEN_UNREAD,
  backlogTokenState,
} from "./view";

/**
 * The **Backlog token** card of Settings → Sources
 * ([#1250](https://github.com/NobuData/ouroboros/issues/1250)).
 *
 * The Issues backlog reads GitHub with a workspace token that is not any source's
 * credential, and until this card nothing in the application could set it. An owner or an
 * admin stores one, replaces it, or removes it here; the card only ever shows its mask.
 *
 * What is typed is never kept: the form is reset the moment a write lands, and a refused
 * value is described by a sentence of this application's, not echoed.
 */

/** The name the token travels under in the form. */
const TOKEN_FIELD = "token";

/** What {@link BacklogTokenCard} needs. */
export interface BacklogTokenCardProps {
  /**
   * The token's state as the page read it, or `null` for a reader the service does not tell —
   * anybody who is neither an owner nor an admin.
   */
  readonly reading: Reading<GithubToken> | null;
  /** Whether the reader may set, replace and remove the token. */
  readonly mayAdminister: boolean;
}

/**
 * The card.
 *
 * @param props.reading The token's state, or `null` when it was not asked for.
 * @param props.mayAdminister Whether the reader may change it.
 * @returns The card: the state line and the form for an owner or an admin, a sentence saying
 *   who can act for everybody else.
 */
export function BacklogTokenCard({ reading, mayAdminister }: BacklogTokenCardProps) {
  const titleId = useId();

  return (
    <Card aria-labelledby={titleId} className="sources-token" id={BACKLOG_TOKEN_ANCHOR}>
      <h2 className="sources-token__heading" id={titleId}>
        {BACKLOG_TOKEN_TITLE}
      </h2>
      <p className="sources-configure__note">{BACKLOG_TOKEN_NOTE}</p>

      {mayAdminister ? (
        <BacklogTokenForm reading={reading} />
      ) : (
        <p className="sources-configure__note" data-testid="backlog-token-read-only">
          {BACKLOG_TOKEN_READ_ONLY}
        </p>
      )}
    </Card>
  );
}

/**
 * The state line, the input and the two controls.
 *
 * @param props.reading The token's state as the page read it.
 * @returns The form.
 */
function BacklogTokenForm({ reading }: Readonly<{ reading: Reading<GithubToken> | null }>) {
  const id = useId();
  const router = useRouter();
  // What the last write answered, once there has been one — newer than what the page read.
  const [written, setWritten] = useState<GithubToken | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState<"save" | "remove" | null>(null);
  const [, startTransition] = useTransition();

  const token = written ?? (reading?.ok === true ? reading.value : null);
  const configured = token?.configured === true;

  /**
   * Draw what a write came to, and have the page read again when it landed.
   *
   * @param outcome What the action answered.
   * @param sentence What to say when it landed.
   * @returns Whether it landed.
   */
  function settle(outcome: BacklogTokenOutcome, sentence: string): boolean {
    setBusy(null);

    if (!outcome.ok) {
      setFailure(outcome.reason);
      return false;
    }

    setWritten(outcome.token);
    setDone(sentence);
    setRemoving(false);
    router.refresh();
    return true;
  }

  function save(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (busy !== null) return;

    const form = event.currentTarget;
    const typed = new FormData(form).get(TOKEN_FIELD);

    setFailure(null);
    setDone(null);
    setBusy("save");

    startTransition(async () => {
      const landed = settle(
        await setBacklogToken(typeof typed === "string" ? typed : ""),
        BACKLOG_TOKEN_SAVED,
      );
      // What was typed is not kept: a stored token has no business in a form afterwards.
      if (landed) form.reset();
    });
  }

  function remove(): void {
    if (busy !== null) return;

    setFailure(null);
    setDone(null);
    setBusy("remove");

    startTransition(async () => {
      settle(await clearBacklogToken(), BACKLOG_TOKEN_REMOVED);
    });
  }

  return (
    <form className="sources-token__form" onSubmit={save}>
      <p
        className={cx("sources-token__state", !configured && "sources-token__state--none")}
        data-testid="backlog-token-state"
      >
        {token === null
          ? BACKLOG_TOKEN_UNREAD
          : configured
            ? backlogTokenState(token)
            : BACKLOG_TOKEN_NONE}
      </p>

      <TextField
        autoComplete="off"
        hint={BACKLOG_TOKEN_FIELD_HINT}
        id={`${id}-${TOKEN_FIELD}`}
        label={BACKLOG_TOKEN_FIELD_LABEL}
        maxLength={BACKLOG_TOKEN_MAX_LENGTH}
        minLength={BACKLOG_TOKEN_MIN_LENGTH}
        mono
        name={TOKEN_FIELD}
        pattern={BACKLOG_TOKEN_PATTERN}
        required
        spellCheck={false}
        type="password"
      />

      {failure !== null && (
        <p className="sources-add__failure" role="alert">
          {failure}
        </p>
      )}
      {done !== null && (
        <p className="sources-add__state" role="status">
          {done}
        </p>
      )}

      {removing ? (
        <>
          <p className="sources-token__question">{BACKLOG_TOKEN_REMOVE_QUESTION}</p>
          <div className="sources-add__actions">
            <Button
              onClick={remove}
              reason={busy === "remove" ? BACKLOG_TOKEN_REMOVING : undefined}
              tone="danger"
              type="button"
            >
              {BACKLOG_TOKEN_REMOVE_CONFIRM}
            </Button>
            <Button
              onClick={() => setRemoving(false)}
              reason={busy === "remove" ? BACKLOG_TOKEN_REMOVING : undefined}
              tone="ghost"
              type="button"
            >
              {BACKLOG_TOKEN_REMOVE_CANCEL}
            </Button>
          </div>
        </>
      ) : (
        <div className="sources-add__actions">
          <Button
            reason={busy === "save" ? BACKLOG_TOKEN_SAVING : undefined}
            tone="primary"
            type="submit"
          >
            {configured ? BACKLOG_TOKEN_REPLACE : BACKLOG_TOKEN_SAVE}
          </Button>
          {configured && (
            <Button onClick={() => setRemoving(true)} tone="ghost" type="button">
              {BACKLOG_TOKEN_REMOVE}
            </Button>
          )}
        </div>
      )}
    </form>
  );
}
