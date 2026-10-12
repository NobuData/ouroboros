/**
 * The sentences the `/ouro` dispatcher says itself (BZ.3,
 * [#537](https://github.com/NobuData/ouroboros/issues/537)) — fixed, so a test and a reader see
 * the same words, and so every surface says the same thing.
 *
 * What a *command* says is its binding's; what a *plane* refuses with is the plane's own
 * message. These are only the dispatcher's: who you are, whether you may, and the honest
 * fallback when something failed that nobody can be told the details of.
 */

import { requirementWords } from "./grammar.help";
import { COMMAND_PREFIX } from "./grammar.registry";
import type { CommandDefinition } from "./grammar.types";

/** The dispatcher's fixed replies. */
export const CHAT_REPLIES = {
  /** A platform user with no identity link: no authority, so nothing runs. */
  unlinked:
    "You're not linked — buttons and commands here act with your Ouroboros permissions, so link your account first.",
  /** A Slack workspace no organisation has installed and active. */
  notConnected:
    "This Slack workspace is not connected to Ouroboros any more. An owner or admin can connect it again in Settings.",
  /** A link whose member has since left the workspace. */
  notAMember:
    "Your linked Ouroboros account is no longer a member of this workspace, so commands here do nothing for you.",
  /** A failure nobody can be told the details of. Never a stack, never an unknown error's text. */
  failed:
    "Something went wrong running that command, and it may not have taken effect. Check in Ouroboros before trying again.",
  /** An async command whose result never arrived as a result. */
  asyncFailed: (command: string): string =>
    `\`${COMMAND_PREFIX} ${command}\` started but did not finish: something went wrong. Check in Ouroboros before trying again.`,
  /** A surface the dispatcher cannot name an invoker for yet. */
  surfaceUnavailable: "Commands cannot be run from here yet.",
} as const;

/**
 * What a member who may not run a command is told — naming what it takes, in words.
 *
 * @param definition - The command.
 * @returns `` `/ouro route` is for workspace owners and admins. ``
 */
export function deniedText(definition: CommandDefinition): string {
  return `\`${COMMAND_PREFIX} ${definition.id}\` is for ${requirementWords(definition.requires)}.`;
}

/**
 * A confirm prompt with its placeholders filled.
 *
 * @param template - The command's `confirmPrompt`.
 * @param values - What each `{name}` stands for; a placeholder with no value is left as written.
 * @returns The sentence.
 */
export function fill(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{([a-z_]+)\}/g, (whole, name: string) =>
    Object.hasOwn(values, name) ? values[name] : whole,
  );
}
