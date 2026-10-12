/**
 * What the `/ouro` dispatcher needs from the planes, as ports (BZ.3,
 * [#537](https://github.com/NobuData/ouroboros/issues/537)).
 *
 * The dispatcher (`chatops/`) owns the grammar: parsing, identity, the role check, confirmation,
 * recording. The planes side (`chatops/planes/`) owns everything that reads or calls another
 * module: turning `#485` into an issue, offering completions, and the bindings themselves. These
 * three tokens are the whole of the seam between them, so the dispatcher can be tested with
 * doubles and a new surface or a new plane changes one side only.
 */

import type {
  ArgumentSpec,
  CommandBinding,
  CompletionSource,
  Invoker,
  ResolvedArgument,
} from "./grammar.types";

/** The bindings, one per available command — `CommandBinding[]`. */
export const COMMAND_BINDINGS = Symbol("COMMAND_BINDINGS");

/** {@link ArgumentResolvers}. */
export const ARGUMENT_RESOLVERS = Symbol("ARGUMENT_RESOLVERS");

/** {@link CompletionSources}. */
export const COMPLETION_SOURCES = Symbol("COMPLETION_SOURCES");

/** The bindings as injected. */
export type CommandBindings = readonly CommandBinding[];

/**
 * An argument that could not be read: it names the argument, says why in words a person can act
 * on, and offers the valid names nearest to what was typed.
 */
export class ChatArgumentError extends Error {
  /**
   * @param argument - The {@link ArgumentSpec.name} at fault.
   * @param message - The whole sentence shown — `unknown workflow "feature-lopp"`.
   * @param suggestions - Valid alternatives from the owning plane, nearest first; may be empty.
   */
  constructor(
    readonly argument: string,
    message: string,
    readonly suggestions: readonly string[] = [],
  ) {
    super(message);
    this.name = "ChatArgumentError";
  }
}

/** Turns typed text into the thing it names, in one workspace. */
export interface ArgumentResolvers {
  /**
   * Resolve one argument.
   *
   * `keyword` and `confirm` arguments never reach this: the parser settles them.
   *
   * @param organizationId - The workspace.
   * @param spec - The argument being read.
   * @param raw - What was typed for it, trimmed.
   * @param previous - The arguments already resolved, by name — an `action` is read against the
   *   `question` before it.
   * @returns The resolved argument.
   * @throws {ChatArgumentError} When the text names nothing, or more than one thing.
   */
  resolve(
    organizationId: string,
    spec: ArgumentSpec,
    raw: string,
    previous: Readonly<Record<string, ResolvedArgument>>,
  ): Promise<ResolvedArgument>;
}

/** One completion. */
export interface Completion {
  /** What to insert — `#485`, `standard-fix`, `q-231`. */
  readonly value: string;
  /** What to show beside it — the issue's title, the alias's model. */
  readonly label: string;
}

/** Offers completions from the plane that owns each vocabulary. */
export interface CompletionSources {
  /**
   * Complete an argument.
   *
   * @param organizationId - The workspace.
   * @param invoker - Who is typing; a source may offer only what they can see.
   * @param source - Which vocabulary.
   * @param prefix - What has been typed of the argument so far; may be empty.
   * @param previous - The raw text of the arguments before it, by name.
   * @param limit - The most to return.
   * @returns Completions, best first.
   */
  complete(
    organizationId: string,
    invoker: Invoker,
    source: CompletionSource,
    prefix: string,
    previous: Readonly<Record<string, string>>,
    limit: number,
  ): Promise<Completion[]>;
}
