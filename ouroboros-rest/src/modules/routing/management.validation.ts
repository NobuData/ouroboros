/**
 * What a **Save routes** batch is refused for, and which route each refusal belongs to.
 *
 * Z.2 ([#195](https://github.com/NobuData/ouroboros/issues/195)). Pure: the request, three
 * sets of names the workspace has, and a map of complaints out. No connection, so the whole
 * ticket's *"invalid states return the standard 422 envelope"* criterion is a table of inputs
 * rather than a set of scenarios to stage against a database.
 *
 * ---------------------------------------------------------------------------
 * **Two layers refuse a save, and neither is redundant.**
 *
 * `routing.dto.ts` refuses what is wrong with the *request*: an empty chain, a note that is
 * blank, a cap of zero, a floor below 1. Those are facts about the body, they are true whoever
 * sent it, and the pipe answers them before a statement is issued.
 *
 * This file refuses what is wrong with the request *in this workspace*: a task kind it does
 * not have, an alias it has never bound, a floor deeper than the chain that arrived with it.
 * None of them can be known without reading, and all of them are the difference between a
 * `422` naming the field and a foreign-key violation surfacing as `500 internal_error`.
 *
 * ---------------------------------------------------------------------------
 * **Every complaint is collected, and it is keyed by task kind.**
 *
 * The mockup commits the whole matrix in one press, so answering with the first failure would
 * send a client back for the second, and the third. The shape is
 * `{"<taskKind>": {"<field>": ["message"]}}` — `validation_failed`'s own `{field: [messages]}`
 * one level deeper, so a form that already renders one renders the other, and the ticket's
 * *"per-route errors map back to their route so the UI can mark exactly what failed"* is the
 * key rather than a convention a client has to be told about.
 *
 * **Nothing is committed when anything is wrong.** This runs before the transaction opens, so
 * the atomicity criterion is not a rollback that has to work — it is a write that never
 * started.
 */

import type { DesiredRoute } from "./management.rows";

/** The field a complaint about the kind itself is filed under — the body's own spelling. */
export const TASK_KIND_FIELD = "taskKind";

/** The field a complaint about the floor is filed under. */
export const FLOOR_FIELD = "floorHopIndex";

/**
 * The field one hop's alias is filed under.
 *
 * Addressed by index — `hops.0.alias` — the way `errors/validation.ts` addresses a nested
 * field, so a client can point at the input that produced the message without walking a tree.
 *
 * @param index - The hop's place in the array the body sent, from zero.
 * @returns The field path.
 */
export function hopAliasField(index: number): string {
  return `hops.${index.toString()}.alias`;
}

/** What a client is told. Written once so a message and its test cannot drift apart. */
export const SAVE_MESSAGES = {
  /** The kind is not one this workspace has at all. */
  unknownTaskKind: "This workspace has no task kind by that name.",
  /**
   * The kind exists and nothing routes it.
   *
   * A distinct message from the one above, because the two send somebody to different places:
   * one is a typo, and the other is a matrix row with an empty cell that needs a route created
   * before it can be saved onto. V016 makes the second possible on purpose —
   * `routes.task_kind_id` is unique, not mandatory.
   */
  noRouteForTaskKind: "This task kind has no route to save onto.",
  /** The batch names one kind twice. */
  duplicateTaskKind: "This task kind appears more than once in the batch.",
} as const;

/**
 * What a client is told when a hop names an alias the workspace does not have.
 *
 * @param alias - The name that was sent, echoed exactly. A caller that spelled it with a
 *   capital would otherwise be told their correctly-spelled alias does not exist — V015 stores
 *   aliases folded, and `Coder-Max` genuinely is not `coder-max`.
 * @returns The message.
 */
export function unknownAliasMessage(alias: string): string {
  return `This workspace has no model alias named "${alias}".`;
}

/**
 * What a client is told when the floor points past the end of the chain.
 *
 * The chain it is measured against is the one **in the same body**, not the one in the
 * database: a save that shortens a chain and lowers its floor is a legal edit, and measuring
 * against the stored chain would refuse it. V016's `route_chain_intact()` measures the same
 * way at commit, for the same reason.
 *
 * @param floor - The floor that was sent.
 * @param length - How many hops arrived with it.
 * @returns The message.
 */
export function floorTooDeepMessage(floor: number, length: number): string {
  return (
    `The floor is hop ${floor.toString()} and the chain sent with it has ` +
    `${length.toString()} ${length === 1 ? "hop" : "hops"}. A floor past the end of the chain ` +
    `is a protection that can never apply.`
  );
}

/** One route's complaints, keyed by the field of the request they are about. */
export type RouteProblems = Record<string, string[]>;

/** Every complaint in a batch, keyed by task kind. Empty means the batch may be committed. */
export type BatchProblems = Record<string, RouteProblems>;

/**
 * What is wrong with a batch, in this workspace.
 *
 * @param requests - The routes as the body asks for them, already normalised.
 * @param taskKinds - Every task-kind name the workspace has.
 * @param routedTaskKinds - The subset of those that have a route. A kind in the first set and
 *   not the second is the empty matrix cell — see {@link SAVE_MESSAGES.noRouteForTaskKind}.
 * @param aliases - Every alias name the workspace has, unbound ones included. Unbound is
 *   deliberately *not* a refusal: V019 permits an alias created ahead of its key, mockup 21
 *   draws it as a first-class row, and a chain that names one is a configuration whose third
 *   hop will be dropped with a stated reason when it resolves — which is Z.1's answer to give,
 *   not this one's to pre-empt.
 * @returns One entry per route that cannot be saved. Empty when every route can.
 */
export function batchProblems(
  requests: readonly DesiredRoute[],
  taskKinds: ReadonlySet<string>,
  routedTaskKinds: ReadonlySet<string>,
  aliases: ReadonlySet<string>,
): BatchProblems {
  const problems: BatchProblems = {};
  const duplicated = duplicateTaskKinds(requests);

  for (const request of requests) {
    const fields: RouteProblems = {};

    if (duplicated.has(request.taskKind)) {
      fields[TASK_KIND_FIELD] = [SAVE_MESSAGES.duplicateTaskKind];
    } else if (!taskKinds.has(request.taskKind)) {
      fields[TASK_KIND_FIELD] = [SAVE_MESSAGES.unknownTaskKind];
    } else if (!routedTaskKinds.has(request.taskKind)) {
      fields[TASK_KIND_FIELD] = [SAVE_MESSAGES.noRouteForTaskKind];
    }

    request.hops.forEach((hop, index) => {
      if (!aliases.has(hop.alias)) {
        fields[hopAliasField(index)] = [unknownAliasMessage(hop.alias)];
      }
    });

    if (request.floorHopIndex !== null && request.floorHopIndex > request.hops.length) {
      fields[FLOOR_FIELD] = [floorTooDeepMessage(request.floorHopIndex, request.hops.length)];
    }

    if (Object.keys(fields).length > 0) {
      // Merged rather than assigned, so the second entry naming a duplicated kind does not
      // discard the first one's complaints about its own aliases.
      problems[request.taskKind] = { ...problems[request.taskKind], ...fields };
    }
  }

  return problems;
}

/**
 * The task kinds a batch names more than once.
 *
 * A body that says two different things about one row has no reading under which both were
 * applied, and letting the later entry win silently would make **Save routes** depend on array
 * order.
 *
 * @param requests - The routes as the body asks for them.
 * @returns The names that appear at least twice.
 */
function duplicateTaskKinds(requests: readonly DesiredRoute[]): ReadonlySet<string> {
  const seen = new Set<string>();
  const twice = new Set<string>();

  for (const request of requests) {
    if (seen.has(request.taskKind)) {
      twice.add(request.taskKind);
    }

    seen.add(request.taskKind);
  }

  return twice;
}
