/**
 * Completions for the `/ouro` grammar's arguments (BZ.3,
 * [#537](https://github.com/NobuData/ouroboros/issues/537)).
 *
 * One source per vocabulary, each read from the plane that owns it — the same reads
 * `resolvers.ts` validates against, so nothing is offered that would then be refused:
 *
 * ```
 * tickets     open issues by number or title prefix         backlog  (ticket lookup)
 * loops       loops in flight by number prefix              runs     (loop lookup)
 * workflows   the workspace's offered workflows             workflows registry
 * aliases     model aliases, with the model each names      model registry
 * task_kinds  routable task kinds                           routing matrix
 * questions   the questions asking this person              Needs-You queue
 * actions     the answers the named question takes from them  Needs-You queue
 * ```
 *
 * `questions` and `actions` are read **as the invoker**: the queue is the one their inbox page
 * shows, and an action they may not press is not offered.
 */

import { Injectable } from "@nestjs/common";

import { TicketLookupRepository } from "../../backlog/ticket.lookup.repository";
import { InboxQueueService } from "../../decisions/inbox.queue";
import { RegistryService } from "../../registry/registry.service";
import { RoutingManagementService } from "../../routing/management.service";
import { LoopLookupRepository } from "../../runs/loop.lookup.repository";
import { WorkflowRegistryService } from "../../workflows/registry.service";
import type { Completion, CompletionSources } from "../grammar.ports";
import type { CompletionSource, Invoker } from "../grammar.types";

/** Digits only — what a number prefix is narrowed by. */
const DIGITS = /^\d*$/;

/**
 * The entries whose value starts with what was typed, case-insensitively.
 *
 * @param entries - Every completion of the vocabulary.
 * @param prefix - What has been typed.
 * @param limit - The most to return.
 * @returns The matches, in the vocabulary's order.
 */
function startingWith(entries: readonly Completion[], prefix: string, limit: number): Completion[] {
  const typed = prefix.toLowerCase();

  return entries.filter((entry) => entry.value.toLowerCase().startsWith(typed)).slice(0, limit);
}

@Injectable()
export class PlaneCompletionSources implements CompletionSources {
  /**
   * @param tickets - The backlog's ticket lookup.
   * @param loops - The runs' loop lookup.
   * @param inbox - The Needs-You queue.
   * @param workflows - The workflows the workspace offers.
   * @param aliases - The model registry.
   * @param routing - The routing matrix.
   */
  constructor(
    private readonly tickets: TicketLookupRepository,
    private readonly loops: LoopLookupRepository,
    private readonly inbox: InboxQueueService,
    private readonly workflows: WorkflowRegistryService,
    private readonly aliases: RegistryService,
    private readonly routing: RoutingManagementService,
  ) {}

  /** @inheritdoc */
  async complete(
    organizationId: string,
    invoker: Invoker,
    source: CompletionSource,
    prefix: string,
    previous: Readonly<Record<string, string>>,
    limit: number,
  ): Promise<Completion[]> {
    const typed = prefix.trim();

    if (limit <= 0) return [];

    switch (source) {
      case "tickets":
        return this.openTickets(organizationId, typed, limit);
      case "loops":
        return this.liveLoops(organizationId, typed, limit);
      case "workflows": {
        const { slugs } = await this.workflows.offered(organizationId);

        return startingWith(
          slugs.map((slug) => ({ value: slug, label: "workflow" })),
          typed,
          limit,
        );
      }
      case "aliases": {
        const aliases = await this.aliases.list(organizationId);

        return startingWith(
          aliases.map((entry) => ({ value: entry.alias, label: entry.modelId })),
          typed,
          limit,
        );
      }
      case "task_kinds": {
        const { taskKinds } = await this.routing.matrix(organizationId);

        return startingWith(
          taskKinds.map((kind) => ({ value: kind.name, label: kind.description })),
          typed,
          limit,
        );
      }
      case "questions":
        return this.openQuestions(organizationId, invoker, typed, limit);
      case "actions":
        return this.answers(organizationId, invoker, typed, previous, limit);
      default:
        return [];
    }
  }

  /**
   * Open issues by number or title prefix.
   *
   * @param organizationId - The workspace.
   * @param typed - What was typed; a leading `#` is the number's own spelling.
   * @param limit - The most to return.
   * @returns `#485` with the title — `repo#485` where two offered issues share the number.
   */
  private async openTickets(
    organizationId: string,
    typed: string,
    limit: number,
  ): Promise<Completion[]> {
    const rows = await this.tickets.open(organizationId, typed.replace(/^#/, ""), limit);
    const numbers = rows.map((row) => row.number);

    return rows.map((row) => ({
      value:
        numbers.indexOf(row.number) === numbers.lastIndexOf(row.number)
          ? `#${String(row.number)}`
          : `${row.repository}#${String(row.number)}`,
      label: row.title,
    }));
  }

  /**
   * Loops in flight by number prefix.
   *
   * @param organizationId - The workspace.
   * @param typed - What was typed; a leading `#` is dropped.
   * @param limit - The most to return.
   * @returns `1847` with the issue it is working and its status.
   */
  private async liveLoops(
    organizationId: string,
    typed: string,
    limit: number,
  ): Promise<Completion[]> {
    const digits = typed.replace(/^#/, "");

    // A loop is named by its number; anything else completes to nothing.
    if (!DIGITS.test(digits)) return [];

    const rows = await this.loops.live(organizationId, digits, limit);

    return rows.map((row) => ({
      value: String(row.loopSeq),
      label: `#${String(row.issueNumber)} ${row.issueTitle} · ${row.status}`,
    }));
  }

  /**
   * The questions asking the invoker, by short id.
   *
   * @param organizationId - The workspace.
   * @param invoker - Who is typing.
   * @param typed - What was typed.
   * @param limit - The most to return.
   * @returns `q-231` with the question.
   */
  private async openQuestions(
    organizationId: string,
    invoker: Invoker,
    typed: string,
    limit: number,
  ): Promise<Completion[]> {
    const queue = await this.inbox.queue(organizationId, {
      userId: invoker.userId,
      roles: invoker.roles,
    });

    return startingWith(
      queue.items.map((item) => ({ value: item.shortId, label: item.question })),
      typed,
      limit,
    );
  }

  /**
   * The answers the invoker may give the question typed before.
   *
   * @param organizationId - The workspace.
   * @param invoker - Who is typing.
   * @param typed - What was typed.
   * @param previous - The raw arguments before this one; one of them is the question's id.
   * @param limit - The most to return.
   * @returns `allow_once` with the button's label — nothing when no asking question is named.
   */
  private async answers(
    organizationId: string,
    invoker: Invoker,
    typed: string,
    previous: Readonly<Record<string, string>>,
    limit: number,
  ): Promise<Completion[]> {
    const named = new Set(Object.values(previous).map((value) => value.trim().toLowerCase()));
    const queue = await this.inbox.queue(organizationId, {
      userId: invoker.userId,
      roles: invoker.roles,
    });
    const item = queue.items.find((candidate) => named.has(candidate.shortId));

    if (item === undefined) return [];

    return startingWith(
      item.actions
        .filter((action) => !action.navigates && action.allowed)
        .map((action) => ({ value: action.id, label: action.label })),
      typed,
      limit,
    );
  }
}
