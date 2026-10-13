"use client";

import { useId } from "react";

import type { SlackChannel } from "@/app/api/chatops";
import { ConsoleCompletionOption, ConsoleEntryOption, ConsoleNamed } from "@/app/shell/console-view";
import { Button } from "@/app/ui";
import { cx } from "@/app/ui/class-names";

import type { MirrorComposerState } from "./use-mirror-composer";
import {
  COMPOSER_HINT,
  COMPOSER_LABEL,
  OPEN_LABEL,
  PLAIN_TEXT_HINT,
  SENDING_LABEL,
  SEND_LABEL,
  composerPlaceholder,
  openName,
  sendReason,
} from "./view";

/** What the composer takes. */
export interface MirrorComposerProps {
  /** The channel the mirror is of. */
  readonly channel: SlackChannel;
  /** The composer's state (`app/chatops/use-mirror-composer.ts`). */
  readonly composer: MirrorComposerState;
  /** The box's ref — the one the state was built around. */
  readonly inputRef: React.RefObject<HTMLInputElement | null>;
}

/**
 * The mirror's composer (CA.2, [#542](https://github.com/NobuData/ouroboros/issues/542)) —
 * mockup 19's box and **Send**, and the honest answer to what they can do.
 *
 * **Commands work here; messages live in Slack.** `/ouro …` runs through the dispatcher the
 * palette's console uses, with the same completions under the box and the same keys, and what it
 * answers appears in the stream above as the record it now is. Anything else cannot be sent, and
 * the composer says so in words the moment the box holds it — with the way to where it *can* be
 * said — rather than leaving a greyed button to imply it.
 *
 * The hint is one live region, always mounted, so the change from the standing hint to the
 * reason is announced. A line the service would not read at all is an alert, and stays in the box.
 *
 * @param props See {@link MirrorComposerProps}.
 * @returns The composer.
 */
export function MirrorComposer({ channel, composer, inputRef }: MirrorComposerProps) {
  const hintId = useId();
  const { cli, mode } = composer;
  const sending = cli.pending !== null;
  const listed = composer.commanding && !sending && (cli.rows.length > 0 || cli.note !== null || cli.named !== null);

  return (
    <div className="chatops-mirror__composer">
      {listed && (
        <div className="chatops-mirror__complete">
          {cli.named !== null && <ConsoleNamed entry={cli.named} />}
          {cli.rows.length > 0 && (
            <div aria-label={cli.label} className="chatops-mirror__options" id={composer.listId} role="listbox">
              {cli.rows.map((row) =>
                row.kind === "entry" ? (
                  <ConsoleEntryOption
                    active={row.id === composer.activeRow?.id}
                    entry={row.entry}
                    id={composer.rowId(row)}
                    key={row.id}
                    onChoose={() => composer.choose(row)}
                    onPoint={() => composer.point(row)}
                  />
                ) : (
                  <ConsoleCompletionOption
                    active={row.id === composer.activeRow?.id}
                    completion={row.completion}
                    id={composer.rowId(row)}
                    key={row.id}
                    onChoose={() => composer.choose(row)}
                    onPoint={() => composer.point(row)}
                  />
                ),
              )}
            </div>
          )}
          {cli.note !== null && <p className="chatops-mirror__note">{cli.note}</p>}
        </div>
      )}

      <div className="chatops-mirror__send">
        <input
          aria-activedescendant={composer.activeId}
          aria-autocomplete="list"
          aria-controls={listed && cli.rows.length > 0 ? composer.listId : undefined}
          aria-describedby={hintId}
          aria-expanded={listed && cli.rows.length > 0}
          aria-label={COMPOSER_LABEL}
          autoComplete="off"
          className={cx("ou-input", "chatops-mirror__input")}
          onChange={composer.onChange}
          onClick={composer.onSelect}
          onKeyDown={composer.onKeyDown}
          onKeyUp={composer.onSelect}
          onSelect={composer.onSelect}
          placeholder={composerPlaceholder(channel)}
          readOnly={sending}
          ref={inputRef}
          role="combobox"
          spellCheck={false}
          type="text"
          value={composer.text}
        />
        <Button
          aria-busy={sending || undefined}
          onClick={composer.send}
          reason={sendReason(mode, sending)}
          size="sm"
          tone="primary"
        >
          {sending ? SENDING_LABEL : SEND_LABEL}
        </Button>
      </div>

      <p className={cx("chatops-mirror__hint", mode === "plain" && "chatops-mirror__hint--plain")} id={hintId} role="status">
        {mode === "plain" ? PLAIN_TEXT_HINT : COMPOSER_HINT}
        {mode === "plain" && channel.url !== "" && (
          <>
            {" "}
            <a
              aria-label={openName(channel)}
              className="chatops-mirror__out"
              href={channel.url}
              rel="noopener noreferrer"
              target="_blank"
            >
              {OPEN_LABEL}
            </a>
          </>
        )}
      </p>

      {composer.notice !== null && (
        <p className="chatops-mirror__alert" role="alert">
          {composer.notice}
        </p>
      )}
    </div>
  );
}
