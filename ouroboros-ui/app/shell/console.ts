import type {
  ConsoleArgument,
  ConsoleCommandRecord,
  ConsoleCommandResult,
  ConsoleCompletionSource,
  ConsoleGrammar,
  ConsoleLink,
  ConsoleOutcome,
} from "@/app/api/console";

/**
 * The in-app console's *model*: when the palette is in command mode, what a line names, what
 * the caret is completing, and every sentence the mode says (BZ.5,
 * [#539](https://github.com/NobuData/ouroboros/issues/539)).
 *
 * The half of the console that holds no state and renders nothing, split off for the reason
 * `app/shell/command.ts` is: every rule below is a pure function of a line and a grammar
 * somebody else owns, so the reading of a line can be tested without a palette, a DOM or a
 * service. `app/shell/use-console.ts` is where it meets React, and
 * `app/shell/command-palette.tsx` draws what comes back.
 *
 * **Framework-free apart from type imports**, which disappear at build time — `app/api/console.ts`
 * is `server-only`, and nothing of it but its shapes reaches the browser through here.
 *
 * ### The console reads a line; it does not parse one
 *
 * The dispatcher (BZ.3) is the only thing that decides what a line *means*. What is here is
 * narrower and is all a text box needs: whether the line has got as far as naming a command
 * ({@link namedEntry}), and which word the caret is in ({@link completionTarget}). The
 * completions themselves are asked of the service with the text as typed, so what is offered is
 * what would be accepted — a second parser in the browser would be a second opinion about that.
 */

/* ------------------------------------------------------------------ the prefix */

/**
 * What switches the palette into command mode, typed at the very start of its box.
 *
 * The issue allows for a configurable prefix; this ticket ships the one the grammar itself
 * names, as one constant, so making it a setting later is a change to who supplies this value.
 */
export const CONSOLE_PREFIX = "/ouro";

/**
 * Whether what is in the palette's box is a command rather than a search.
 *
 * The prefix exactly, or the prefix and a space: `/ourobouros` is a search for a word, and
 * `/our` is a prefix not finished yet. Matched without regard to case, because a phone's
 * keyboard capitalises what follows nothing.
 *
 * @param query The box's whole content.
 * @returns True while the palette is in command mode.
 */
export function isConsoleQuery(query: string): boolean {
  const head = query.slice(0, CONSOLE_PREFIX.length).toLowerCase();

  if (head !== CONSOLE_PREFIX) return false;

  return query.length === CONSOLE_PREFIX.length || query[CONSOLE_PREFIX.length] === " ";
}

/**
 * How many characters of the box belong to the prefix and the space after it.
 *
 * @param query The box's whole content, in command mode.
 * @returns The offset at which the command's own text starts.
 */
export function consoleOffset(query: string): number {
  return Math.min(query.length, CONSOLE_PREFIX.length + 1);
}

/**
 * What was typed after the prefix.
 *
 * @param query The box's whole content.
 * @returns The command's text as typed — empty for the bare prefix, and for a box that is not
 *   in command mode at all.
 */
export function consoleText(query: string): string {
  return isConsoleQuery(query) ? query.slice(consoleOffset(query)) : "";
}

/**
 * A command's text, as the box holds it.
 *
 * A text that already carries the prefix is not given a second one — `confirmWith` is
 * documented as what follows `/ouro`, and a service that sent the whole line instead should
 * still fill the box with something that runs.
 *
 * @param text What follows the prefix.
 * @returns `/ouro status`; the prefix and a space for an empty text, which is the box ready
 *   for a command.
 */
export function consoleQuery(text: string): string {
  const bare = isConsoleQuery(text.trimStart()) ? consoleText(text.trimStart()) : text;

  return `${CONSOLE_PREFIX} ${bare}`;
}

/* ------------------------------------------------------------------ the entries */

/** One line of the command list: a command of the grammar, or a word that is not one. */
export interface ConsoleEntry {
  /** The words that name it — `pause loop`, `help`. Unique across the list. */
  readonly id: string;
  /** Every spelling that names it — the id and its aliases, lower-cased. */
  readonly names: readonly string[];
  /** The example the row shows, with the prefix: `/ouro queue #485 [workflow]`. */
  readonly usage: string;
  /** What each position takes, with the prefix: `/ouro queue <ticket> [workflow]`. */
  readonly syntax: string;
  /** The one-line summary. */
  readonly summary: string;
  /** Its arguments, in the order they are typed. Empty for a builtin. */
  readonly arguments: readonly ConsoleArgument[];
  /** Whether the caller may run it. */
  readonly allowed: boolean;
  /** Why not, as a phrase. Null when it is allowed. */
  readonly deniedReason: string | null;
  /** Whether the grammar lists it for later rather than now. */
  readonly v2: boolean;
}

/** What a `v2` command is labelled, which is the grammar's own word for its stage. */
export const V2_LABEL = "v2";

/**
 * What a command the caller may not run says when the service gave no phrase of its own.
 *
 * @param words The requirement as the grammar phrases it — `workspace owners and admins`.
 * @returns `for workspace owners and admins only`.
 */
export function deniedFallback(words: string): string {
  return `for ${words} only`;
}

/**
 * The lines of the command list, from the grammar.
 *
 * Every command, in the grammar's own order, then the words that are not commands but that the
 * console answers (`help`; `link` and `unlink` are Slack's and are left out, because the
 * session already is the member).
 *
 * **A missing `allowed` is read as allowed.** A service that predates the field answers a
 * grammar without it, and dimming every row on that account would be the console claiming a
 * refusal nobody made. The dispatcher refuses whoever may not run a command either way.
 *
 * @param grammar The grammar, as the service answered it.
 * @returns The entries.
 */
export function consoleEntries(grammar: ConsoleGrammar): ConsoleEntry[] {
  const commands = grammar.commands.map((command): ConsoleEntry => {
    const allowed = command.allowed !== false;

    return {
      id: command.id,
      names: [command.id, ...command.aliases].map((name) => name.toLowerCase()),
      usage: `${CONSOLE_PREFIX} ${command.usage}`,
      syntax: command.syntax,
      summary: command.summary,
      arguments: command.arguments,
      allowed,
      deniedReason: allowed
        ? null
        : (command.deniedReason ?? deniedFallback(command.requires.words)),
      v2: command.stage === "v2",
    };
  });

  const builtins = grammar.builtins
    .filter((builtin) => builtin.surfaces.includes("console"))
    .map(
      (builtin): ConsoleEntry => ({
        id: builtin.id,
        names: [builtin.id.toLowerCase()],
        usage: `${CONSOLE_PREFIX} ${builtin.usage}`,
        syntax: `${CONSOLE_PREFIX} ${builtin.usage}`,
        summary: builtin.summary,
        arguments: [],
        allowed: true,
        deniedReason: null,
        v2: false,
      }),
    );

  return [...commands, ...builtins];
}

/** A command a line names, and where in the line its name ends. */
export interface NamedEntry {
  /** The entry. */
  readonly entry: ConsoleEntry;
  /** The offset just past the last character of its name, in the text as typed. */
  readonly end: number;
}

/**
 * Escape a string for use inside a regular expression.
 *
 * @param text The string.
 * @returns It, with every character a pattern would read as syntax escaped.
 */
function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The command a line has got as far as naming.
 *
 * A name counts once it is finished — followed by a space, or by the end of the line — so
 * `pause` names nothing (it is the start of two commands) and `status` names one. The longest
 * name wins, which is what keeps a command whose name begins with another's from being read as
 * the shorter one with an argument. Words may be separated by any run of spaces, and case is
 * not significant: the dispatcher reads a line the same way.
 *
 * @param text What follows the prefix, as typed.
 * @param entries The command list.
 * @returns The entry and where its name ends, or `null` while no command is named.
 */
export function namedEntry(text: string, entries: readonly ConsoleEntry[]): NamedEntry | null {
  let best: NamedEntry | null = null;
  let longest = 0;

  for (const entry of entries) {
    for (const name of entry.names) {
      const words = name.split(/\s+/).filter((word) => word !== "");
      if (words.length === 0) continue;

      const pattern = new RegExp(`^\\s*${words.map(escaped).join("\\s+")}(?=\\s|$)`, "i");
      const match = pattern.exec(text);

      if (match !== null && name.length > longest) {
        best = { entry, end: match[0].length };
        longest = name.length;
      }
    }
  }

  return best;
}

/**
 * The entries a partly typed name matches.
 *
 * Those whose name *starts* with what was typed, then those that merely contain it, each group
 * in the grammar's own order — `pause` offers the two commands that begin with it, and `loop`
 * the three that end with it. Deliberately not the palette's fuzzy matcher
 * (`app/shell/command.ts`): a command line is typed as it is spelled, and a scatter of letters
 * that happened to match would complete to something the reader did not type.
 *
 * @param text What follows the prefix, as typed.
 * @param entries The command list.
 * @returns The matches. Everything, for a text with nothing in it.
 */
export function filterEntries(text: string, entries: readonly ConsoleEntry[]): ConsoleEntry[] {
  const typed = text.trim().replace(/\s+/g, " ").toLowerCase();

  if (typed === "") return [...entries];

  const starting = entries.filter((entry) => entry.names.some((name) => name.startsWith(typed)));
  const containing = entries.filter(
    (entry) => !starting.includes(entry) && entry.names.some((name) => name.includes(typed)),
  );

  return [...starting, ...containing];
}

/**
 * The box's content after an entry is chosen from the list: its name, ready for an argument.
 *
 * @param entry The entry.
 * @returns `/ouro pause loop ` — the trailing space is what says the name is finished.
 */
export function entryQuery(entry: ConsoleEntry): string {
  return `${consoleQuery(entry.id)} `;
}

/* ------------------------------------------------------------------ completions */

/** The word the caret is in. */
export interface CompletionTarget {
  /** Where the word starts, in the text. */
  readonly start: number;
  /** Where it ends — the next space, or the end of the text. */
  readonly end: number;
  /** As much of it as lies before the caret, which is what a completion has to match. */
  readonly typed: string;
}

/**
 * Which word of a line the caret is completing.
 *
 * A caret just after a space is in a word that has not been started: its start and its end are
 * both the caret, and what was typed of it is nothing.
 *
 * @param text The line.
 * @param caret The caret's offset in it. Clamped to the line.
 * @returns The word's bounds, and the part of it before the caret.
 */
export function completionTarget(text: string, caret: number): CompletionTarget {
  const at = Math.max(0, Math.min(caret, text.length));

  let start = at;
  while (start > 0 && !/\s/.test(text[start - 1])) start -= 1;

  let end = at;
  while (end < text.length && !/\s/.test(text[end])) end += 1;

  return { start, end, typed: text.slice(start, at) };
}

/**
 * What to ask the completions endpoint, when there is anything to ask it.
 *
 * Only once the line names a command **and** the caret is past the name — on an argument. Until
 * then the completions are command names, which the console already holds and filters itself
 * ({@link filterEntries}), so nothing is asked over the wire.
 *
 * @param text What follows the prefix, as typed.
 * @param caret The caret's offset in that text.
 * @param named The command the line names, from {@link namedEntry}.
 * @returns The text up to the caret, as the endpoint wants it — or `null` when the caret is not
 *   on an argument.
 */
export function completionRequest(
  text: string,
  caret: number,
  named: NamedEntry | null,
): string | null {
  if (named === null || caret <= named.end) return null;

  return text.slice(0, caret).trimStart();
}

/** A line and where its caret belongs. */
export interface EditedLine {
  /** The line. */
  readonly text: string;
  /** The caret's offset in it. */
  readonly caret: number;
}

/**
 * A line with a completion accepted into it.
 *
 * The whole word under the caret is replaced — not only the part before it — and one space
 * follows, which is what tells the endpoint the word is finished and moves on to the next
 * argument. Whatever came after the word is kept, behind a single space.
 *
 * @param text The line.
 * @param caret The caret's offset in it.
 * @param value What the completion inserts.
 * @returns The new line, and the caret just past the space.
 */
export function acceptCompletion(text: string, caret: number, value: string): EditedLine {
  const { start, end } = completionTarget(text, caret);
  const head = `${text.slice(0, start)}${value} `;

  return { text: `${head}${text.slice(end).trimStart()}`, caret: head.length };
}

/** What each vocabulary is called, in the sentence that says none of it matches. */
export const COMPLETION_NOUNS: Readonly<Record<ConsoleCompletionSource, string>> = {
  tickets: "open tickets",
  loops: "live loops",
  workflows: "workflows",
  aliases: "model aliases",
  questions: "open questions",
  actions: "answers",
  task_kinds: "task kinds",
};

/**
 * What an empty answer from the completions endpoint says.
 *
 * Derived from what the service names: the vocabulary it was completing from, in the sentence
 * rather than the argument's own word. A service that does not say which vocabulary — one that
 * predates the field — names the argument instead, and the entry says what completes that. An
 * argument with no vocabulary at all — a pull request's number, the word `confirm` — has
 * nothing to match against, so nothing is said: an empty menu there is not a search that failed.
 *
 * @param entry The command the line names.
 * @param answer What the service said it was completing: the argument, and — when it says —
 *   the vocabulary.
 * @param typed What was typed of the word.
 * @returns `No open tickets match “#9”.`; `There are no open tickets to offer.` when nothing
 *   was typed yet; `null` when there is nothing to say.
 */
export function nothingMatches(
  entry: ConsoleEntry,
  answer: { readonly argument: string | null; readonly source?: ConsoleCompletionSource | null },
  typed: string,
): string | null {
  const source =
    answer.source ??
    entry.arguments.find((one) => one.name === answer.argument)?.completion ??
    null;

  // A vocabulary this build has no word for is treated as none, rather than printed as
  // `undefined`: the contract may grow one before this map does.
  const noun = source === null ? undefined : COMPLETION_NOUNS[source];
  if (noun === undefined) return null;

  return typed === "" ? `There are no ${noun} to offer.` : `No ${noun} match “${typed}”.`;
}

/* ------------------------------------------------------------------ replies */

/** How a reply is drawn: the dispatcher's four outcomes, and the preview that ran nothing. */
export type ConsoleTone = "ok" | "error" | "denied" | "pending" | "preview";

/** The mark each tone carries — a word, so the outcome is never colour alone. */
export const CONSOLE_MARKS: Readonly<Record<ConsoleTone, string>> = {
  ok: "Done",
  error: "Error",
  denied: "Denied",
  pending: "Started",
  preview: "Not run yet",
};

/** The dispatcher's outcomes, as tones. */
const OUTCOME_TONES: Readonly<Record<ConsoleOutcome, ConsoleTone>> = {
  ok: "ok",
  error: "error",
  denied: "denied",
  async_pending: "pending",
};

/** One reply, as the palette's box draws it. */
export interface ConsoleReplyView {
  /** The line it answers, with the prefix. */
  readonly line: string;
  /** How it came out. */
  readonly tone: ConsoleTone;
  /** What it said. */
  readonly text: string;
  /** Where it points, when it points anywhere. */
  readonly link: ConsoleLink | null;
  /** The box content that really does it, when the reply is a preview. */
  readonly confirmWith: string | null;
}

/**
 * The dispatcher's answer, as the box draws it.
 *
 * A reply carrying `confirmWith` is a **preview** whatever its outcome says: nothing has run,
 * and a mark reading *Done* over a sentence about what would happen is the one mistake this
 * box must not make.
 *
 * @param text The line that was run, without the prefix.
 * @param result What the dispatcher answered.
 * @returns The view.
 */
export function replyView(text: string, result: ConsoleCommandResult): ConsoleReplyView {
  const confirmWith =
    result.confirmWith === undefined || result.confirmWith === ""
      ? null
      : consoleQuery(result.confirmWith);

  return {
    line: consoleQuery(text),
    tone: confirmWith === null ? (OUTCOME_TONES[result.outcome] ?? "error") : "preview",
    text: result.reply.text,
    link: result.reply.link ?? null,
    confirmWith,
  };
}

/**
 * A line the service would not read at all, as the box draws it.
 *
 * @param text The line, without the prefix.
 * @param error The service's sentence.
 * @returns The view.
 */
export function refusalView(text: string, error: string): ConsoleReplyView {
  return { line: consoleQuery(text), tone: "error", text: error, link: null, confirmWith: null };
}

/**
 * What choosing a command the caller may not run says, in place of running it.
 *
 * @param entry The entry.
 * @returns The view — the reason, under the *Denied* mark.
 */
export function deniedView(entry: ConsoleEntry): ConsoleReplyView {
  return {
    line: consoleQuery(entry.id),
    tone: "denied",
    text: `You cannot run ${consoleQuery(entry.id)} here: ${entry.deniedReason ?? DENIED}.`,
    link: null,
    confirmWith: null,
  };
}

/** The reason of last resort, for a denial that arrived with none. */
const DENIED = "it is not open to you";

/**
 * The label of the action that puts a confirming command in the box.
 *
 * @param confirmWith The box content that really does it.
 * @returns `Put “/ouro abort loop 1847 confirm” in the box`.
 */
export function confirmLabel(confirmWith: string): string {
  return `Put “${confirmWith}” in the box`;
}

/** What stands beside that action, so nobody takes filling the box for running the command. */
export const CONFIRM_NOTE = "Nothing has run. Press ↵ once it is in the box to run it.";

/** What a reply still waiting for its result says about where the result will turn up. */
export const ASYNC_NOTE =
  "The result follows as a notification at the foot of the screen, even after this is closed.";

/**
 * What the box says while a line is out.
 *
 * @param text The line, without the prefix.
 * @returns `Running /ouro status…`.
 */
export function runningLabel(text: string): string {
  return `Running ${consoleQuery(text)}…`;
}

/** What a line that never reached the service says. */
export const RUN_FAILED = "The command could not be sent. Try again.";

/* ------------------------------------------------------------------ the list's sentences */

/** What command mode says of itself, where the palette says what it can search. */
export const CONSOLE_SCOPE =
  "Commands run as you, in this workspace — the same /ouro grammar as Slack. ↑ on an empty line recalls what you ran.";

/** The command list's accessible name. */
export const COMMANDS_LABEL = "Commands";

/** The completion list's accessible name. */
export const COMPLETIONS_LABEL = "Completions";

/** While the grammar is on its way. */
export const GRAMMAR_LOADING = "Reading the commands…";

/** When the grammar could not be read — the line still runs. */
export const GRAMMAR_UNREADABLE =
  "The commands could not be listed. You can still type one and press ↵ to run it.";

/** When the completions could not be read — the line still runs. */
export const COMPLETIONS_UNREADABLE =
  "Completions could not be read. You can still finish the command and press ↵ to run it.";

/**
 * What the list says when no command's name matches.
 *
 * @param text What follows the prefix, as typed.
 * @returns The sentence, which also says the line can be sent as it stands — the dispatcher
 *   answers anything typed.
 */
export function noCommandMatches(text: string): string {
  return `No command matches “${text.trim()}”. Press ↵ to send it as typed, or Esc to close.`;
}

/* ------------------------------------------------------------------ the palette's own row */

/** The heading the way into command mode is drawn under, in the palette's ordinary list. */
export const CONSOLE_GROUP = "Commands";

/** The row that leads into command mode. */
export const CONSOLE_ENTRY_LABEL = "Run a command";

/* ------------------------------------------------------------------ results that follow */

/** A result that arrived after its command was acknowledged, as the shell's toast draws it. */
export interface ConsoleToast {
  /** The command's id — the toast's own, since a command settles once. */
  readonly id: string;
  /** The line that was run, with the prefix. */
  readonly line: string;
  /** How it came out. */
  readonly tone: ConsoleTone;
  /** What it said. */
  readonly text: string;
  /** Where it points — the deep link — when it points anywhere. */
  readonly link: ConsoleLink | null;
}

/**
 * What a command that settled with nothing to say is given to say.
 *
 * @param line The line, with the prefix.
 * @returns The sentence.
 */
export function settledWithoutReply(line: string): string {
  return `${line} finished without a reply.`;
}

/**
 * A command that has settled, as a toast.
 *
 * @param record The command, no longer pending.
 * @returns The toast: the settled reply and its link, or — for one that failed without a
 *   reply — what went wrong.
 */
export function settledToast(record: ConsoleCommandRecord): ConsoleToast {
  const line = consoleQuery(record.rawText);

  return {
    id: record.id,
    line,
    tone: OUTCOME_TONES[record.outcome] ?? "error",
    text: record.settledReply?.text ?? record.errorDetail ?? settledWithoutReply(line),
    link: record.settledReply?.link ?? null,
  };
}

/** The toast's dismissal, named for a screen reader. */
export const DISMISS_TOAST = "Dismiss";

/** The region the toasts are announced in. */
export const TOASTS_LABEL = "Command results";

/* ------------------------------------------------------------------ answers */

/** Why a call to the console's plane did not answer. */
export interface ConsoleRefusal {
  /** The service's own sentence. */
  readonly error: string;
  /** The contract's code for it — `chat_command_not_found` — so a caller can tell a refusal
   *  that will never change from one worth asking again. */
  readonly code: string;
}

/** What a call answers: the payload, or the service's account of why not. */
export type ConsoleAnswer<T> = T | ConsoleRefusal;

/**
 * Whether a call was refused.
 *
 * @param answer What the call answered.
 * @returns True for a refusal, narrowed so the caller can read its sentence.
 */
export function isConsoleRefusal<T extends object>(answer: ConsoleAnswer<T>): answer is ConsoleRefusal {
  return "error" in answer && typeof (answer as ConsoleRefusal).error === "string";
}

/** The code of the one refusal that will never change: the command is not the caller's to read. */
export const COMMAND_GONE_CODE = "chat_command_not_found";
