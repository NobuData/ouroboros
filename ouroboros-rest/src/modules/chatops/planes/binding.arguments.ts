/**
 * Reading a binding's arguments (BZ.3, [#537](https://github.com/NobuData/ouroboros/issues/537)).
 *
 * The dispatcher hands a binding its arguments by name, already resolved. A binding still has to
 * say which shape it expects — `context.args.ticket` is a union — and a mismatch there is a wiring
 * fault between the registry and the binding, never something a person typed: it is thrown as a
 * plain `Error`, which the dispatcher records as its own failure rather than as a reply.
 */

import type { Requester } from "../../controls/controls.service";
import type { CommandContext, Invoker, ResolvedArgument } from "../grammar.types";

/** A resolved argument of one type. */
type ArgumentOf<T extends ResolvedArgument["type"]> = Extract<ResolvedArgument, { type: T }>;

/**
 * An argument the command cannot run without.
 *
 * @param context - The invocation.
 * @param name - The argument's name in the registry.
 * @param type - The type the binding is written against.
 * @returns The argument.
 * @throws {Error} When the registry and the binding disagree about the command's arguments.
 */
export function argument<T extends ResolvedArgument["type"]>(
  context: CommandContext,
  name: string,
  type: T,
): ArgumentOf<T> {
  const value = optionalArgument(context, name, type);

  if (value === undefined) {
    throw new Error(`The /ouro binding expected a ${type} argument named "${name}".`);
  }

  return value;
}

/**
 * An argument that may not have been typed.
 *
 * @param context - The invocation.
 * @param name - The argument's name in the registry.
 * @param type - The type the binding is written against.
 * @returns The argument, or `undefined` when it was not typed.
 * @throws {Error} When an argument of another type is registered under the name.
 */
export function optionalArgument<T extends ResolvedArgument["type"]>(
  context: CommandContext,
  name: string,
  type: T,
): ArgumentOf<T> | undefined {
  const value = context.args[name] as ResolvedArgument | undefined;

  if (value === undefined) return undefined;
  if (value.type !== type) {
    throw new Error(
      `The /ouro binding expected "${name}" to be a ${type} argument, not ${value.type}.`,
    );
  }

  return value as ArgumentOf<T>;
}

/**
 * The invoker as the planes name a requester — the person, never the app.
 *
 * @param invoker - Who typed the command.
 * @returns Their id, display name and roles.
 */
export function requesterOf(invoker: Invoker): Requester {
  return { id: invoker.userId, name: invoker.name, roles: invoker.roles };
}

/**
 * A ticket as a reply names it.
 *
 * @param ticket - The resolved argument.
 * @returns `#485`.
 */
export function ticketReference(ticket: ArgumentOf<"ticket">): string {
  return `#${String(ticket.number)}`;
}
