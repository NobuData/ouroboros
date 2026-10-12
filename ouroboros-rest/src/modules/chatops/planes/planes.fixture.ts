/**
 * What the `/ouro` binding specs stand on (BZ.3,
 * [#537](https://github.com/NobuData/ouroboros/issues/537)).
 *
 * Two things, and both exist to make *"a command must not be a new control path"* something a
 * test can fail on:
 *
 *   * {@link strictDouble} — a plane service of which only the named methods exist. A binding
 *     that reaches for any other method throws on the spot, so a bespoke path beside the UI
 *     route's call cannot pass by going unnoticed.
 *   * {@link contextFor} — a {@link CommandContext} whose arguments are checked against the
 *     registry (`grammar.registry.ts`) before the binding sees them. The dispatcher keys
 *     `context.args` by the registry's argument names, so a spec that invented its own names
 *     would pass against a binding the dispatcher can never satisfy.
 *
 * Not shipped: `tsconfig.build.json` excludes `*.fixture.ts` alongside the specs.
 */

import { GRAMMAR } from "../grammar.registry";
import type { CommandContext, Invoker, ResolvedArgument } from "../grammar.types";

/** The workspace every spec runs in. */
export const WORKSPACE = "acme-robotics-id";

/** The public origin a reply's links are built on. */
export const APP_URL = "https://ouroboros.example";

/** The person typing — a workspace admin, so every command is theirs to run. */
export const INVOKER: Invoker = {
  userId: "user-mira",
  name: "Mira Okafor",
  roles: ["admin"],
  canApproveLoops: null,
};

/** The invoker as the planes name a requester. */
export const REQUESTER = { id: INVOKER.userId, name: INVOKER.name, roles: INVOKER.roles };

/** `#485`, resolved, with its canonical twin. */
export const TICKET: Extract<ResolvedArgument, { type: "ticket" }> = {
  type: "ticket",
  issueId: "issue-485",
  number: 485,
  repository: "helios-firmware",
  ticketId: "ticket-485",
};

/** Loop `1847`, resolved. */
export const LOOP: Extract<ResolvedArgument, { type: "loop" }> = {
  type: "loop",
  runId: "run-1847",
  loopSeq: 1847,
};

/**
 * A plane service of which only the named methods exist.
 *
 * @param name - The service, for the failure's sentence — `ControlsService`.
 * @param methods - The methods the command may call, as mocks the spec then asserts on.
 * @returns The double. Reading any other member throws, naming it.
 */
export function strictDouble<T extends object>(
  name: string,
  methods: Readonly<Record<string, jest.Mock>>,
): T {
  return new Proxy({} as T, {
    get(_target, property): unknown {
      // A promise machinery probe (`await double`) or an inspection is not a call on the plane.
      if (typeof property === "symbol" || property === "then") return undefined;
      if (Object.hasOwn(methods, property)) return methods[property];

      throw new Error(
        `${name}.${property} is not the call this command's UI route makes — a binding reached for it.`,
      );
    },
  });
}

/**
 * A plane service a command must not touch at all.
 *
 * @param name - The service, for the failure's sentence.
 * @returns A double with no methods.
 */
export function untouched<T extends object>(name: string): T {
  return strictDouble<T>(name, {});
}

/**
 * The invocation a binding is handed, with its arguments held to the registry.
 *
 * @param command - The command's id in the registry — `pause loop`.
 * @param args - The resolved arguments, by the registry's names.
 * @param overrides - Anything else about the invocation that the test varies.
 * @returns The context.
 * @throws {Error} When the registry defines no such command, no argument of that name, or one
 *   of another type — the mismatch the dispatcher would hit at run time.
 */
export function contextFor(
  command: string,
  args: Readonly<Record<string, ResolvedArgument>> = {},
  overrides: Partial<Omit<CommandContext, "args">> = {},
): CommandContext {
  const definition = GRAMMAR.commands.find((candidate) => candidate.id === command);

  if (definition === undefined) throw new Error(`The grammar defines no "${command}" command.`);

  for (const [name, value] of Object.entries(args)) {
    const spec = definition.arguments.find((candidate) => candidate.name === name);

    if (spec === undefined) {
      throw new Error(`"${command}" has no argument named "${name}" in the registry.`);
    }
    if (spec.type !== value.type) {
      throw new Error(
        `"${command}" registers "${name}" as a ${spec.type} argument, not ${value.type}.`,
      );
    }
  }

  return {
    organizationId: WORKSPACE,
    invoker: INVOKER,
    surface: "slack",
    appUrl: APP_URL,
    ...overrides,
    args,
  };
}

/**
 * What a command's registry entry says it binds to.
 *
 * @param command - The command's id.
 * @returns `CommandDefinition.binds` — `POST /api/v1/backlog/queue`.
 */
export function bindsOf(command: string): string {
  return GRAMMAR.commands.find((candidate) => candidate.id === command)?.binds ?? "";
}
