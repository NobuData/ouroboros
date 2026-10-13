"use client";

import type { ConsoleCommand, ConsoleGrammar } from "@/app/api/console";
import type { Reading } from "@/app/api/reading";
import { InfoTip } from "@/app/inbox/info-tip";
import { Button, Card, CardHead, EmptyState, Tag } from "@/app/ui";
import { cx } from "@/app/ui/class-names";

import { COMMANDS_ANCHOR } from "./presence-view";
import {
  COMMANDS_CAPTION,
  COMMANDS_EMPTY,
  COMMANDS_LIST_LABEL,
  COMMANDS_TITLE,
  COMMANDS_UNREAD,
  TEAMS_QUALIFIER,
  TRY_LABEL,
  deniedText,
  runnable,
  stageChip,
  stageNote,
  stageTipName,
  tryLine,
  tryName,
  usageParts,
} from "./view";

import "./chatops-side.css";

/** What the card takes. */
export interface CommandsCardProps {
  /** The `/ouro` grammar, with what this reader may run resolved onto it — or why it could not be read. */
  readonly grammar: Reading<ConsoleGrammar>;
  /** The id the card's title takes, so the card is named by it. */
  readonly titleId: string;
  /**
   * Put a line in the mirror's composer. A row offers **Try it** only when this is given — with
   * no composer on the page there is nowhere to try anything.
   *
   * @param line The line, prefix included.
   */
  readonly onTry?: (line: string) => void;
}

/**
 * The commands card (CA.3, [#543](https://github.com/NobuData/ouroboros/issues/543)) — mockup
 * 19's **COMMANDS**, generated from the registry.
 *
 * **No row is written here.** Each is a command of the grammar the dispatcher itself reads
 * (BZ.3, [#537](https://github.com/NobuData/ouroboros/issues/537)), in the grammar's order: its
 * example as the code form, the words the grammar marks optional dimmed as hints, and its one
 * line of purpose. A command added to the registry appears; one removed is gone; and the page
 * cannot teach a grammar the dispatcher stopped accepting.
 *
 * **A command this reader may not run is dimmed, not hidden**, with what is missing said under
 * it in the dispatcher's own words. A command that is listed and not yet runnable carries its
 * stage chip, and what it says instead of running behind the ⓘ beside it; neither offers
 * **Try it**.
 *
 * **Try it** puts the command's skeleton in the mirror's composer and the focus on it. It sends
 * nothing: the reader finishes the line and sends it themselves.
 *
 * The caption is the mockup's, with its Teams third qualified — Teams is not here yet. A long
 * grammar scrolls inside the card, never the pane. The card carries an id: the AI-presence
 * card's pointer to what works today (#544) lands on it.
 *
 * @param props See {@link CommandsCardProps}.
 * @returns The card.
 */
export function CommandsCard({ grammar, titleId, onTry }: CommandsCardProps) {
  return (
    <Card aria-labelledby={titleId} as="section" className="chatops-side__commands" id={COMMANDS_ANCHOR}>
      <CardHead title={COMMANDS_TITLE} titleId={titleId} />

      {!grammar.ok && <EmptyState note={grammar.reason} title={COMMANDS_UNREAD} variant="flush" />}
      {grammar.ok && grammar.value.commands.length === 0 && <EmptyState title={COMMANDS_EMPTY} variant="flush" />}
      {grammar.ok && grammar.value.commands.length > 0 && (
        // The scroller is a region a keyboard can reach and move: a dimmed row has no control to tab to.
        <div aria-label={COMMANDS_LIST_LABEL} className="chatops-side__cmd-scroll" role="group" tabIndex={0}>
          <ul className="chatops-side__cmds">
            {grammar.value.commands.map((command) => (
              <CommandRow command={command} key={command.id} onTry={onTry} />
            ))}
          </ul>
        </div>
      )}

      <p className="chatops-side__caption">
        {COMMANDS_CAPTION} <span className="chatops-side__qualifier">{TEAMS_QUALIFIER}</span>
      </p>
    </Card>
  );
}

/**
 * One command.
 *
 * @param props.command The command, as the grammar lists it.
 * @param props.onTry Put a line in the composer, when there is one.
 * @returns The row.
 */
function CommandRow({
  command,
  onTry,
}: Readonly<{ command: ConsoleCommand; onTry?: (line: string) => void }>) {
  const denied = deniedText(command);
  const chip = stageChip(command);
  const note = stageNote(command);
  // A chip that names the issue it waits for keeps the note behind its ⓘ; a bare stage shows it.
  const named = chip !== null && chip !== command.stage;

  return (
    <li
      className={cx(
        "chatops-side__cmd",
        denied !== null && "chatops-side__cmd--denied",
        chip !== null && "chatops-side__cmd--staged",
      )}
    >
      <div className="chatops-side__cmd-line">
        <code className="chatops-side__cmd-code">
          {usageParts(command).map((part, index) =>
            part.hint ? (
              // The parts of one example never reorder, so their place is their key.
              <span className="chatops-side__cmd-arg" key={index}>
                {part.text}
              </span>
            ) : (
              part.text
            ),
          )}
        </code>
        <span className="chatops-side__cmd-what">{command.summary}</span>
        {chip !== null && (
          <span className="chatops-side__cmd-stage">
            <Tag>{chip}</Tag>
            {note !== null && named && <InfoTip label={stageTipName(command)}>{note}</InfoTip>}
          </span>
        )}
        {onTry !== undefined && runnable(command) && (
          <Button aria-label={tryName(command)} onClick={() => onTry(tryLine(command))} size="sm" tone="ghost">
            {TRY_LABEL}
          </Button>
        )}
      </div>
      {note !== null && !named && <p className="chatops-side__cmd-why">{note}</p>}
      {denied !== null && <p className="chatops-side__cmd-why">{denied}</p>}
    </li>
  );
}
