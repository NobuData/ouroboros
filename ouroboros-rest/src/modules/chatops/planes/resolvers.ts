/**
 * Turning what was typed into the thing it names (BZ.3,
 * [#537](https://github.com/NobuData/ouroboros/issues/537)).
 *
 * The dispatcher's parser splits `/ouro queue #485 standard-fix` into words; this is where `#485`
 * becomes one mirrored issue and `standard-fix` one of the workspace's workflows. Each vocabulary
 * is read from the plane that owns it — the offered workflows, the model registry, the routing
 * matrix, the decision kinds — so chat accepts exactly the names the UI's menus list.
 *
 * **Errors teach.** A name that resolves to nothing is a {@link ChatArgumentError}: it names the
 * argument, repeats what was typed, and carries the valid names — the nearest first.
 *
 * **Nothing is guessed.** A number carried by two repositories is refused with both spelled out;
 * a loop or a question is matched exactly, never by prefix.
 */

import { Injectable } from "@nestjs/common";

import {
  TicketLookupRepository,
  type TicketLookupRow,
} from "../../backlog/ticket.lookup.repository";
import { nearest } from "../../copilot/copilot.operations";
import { DecisionKindRegistry } from "../../decisions/decision-kind.registry";
import { decisionShortId, parseDecisionShortId } from "../../decisions/inbox.compose";
import { InboxQueueService } from "../../decisions/inbox.queue";
import { QuestionLookupRepository } from "../../decisions/question.lookup.repository";
import { DomainError } from "../../errors/error.envelope";
import { REGISTRY_ERRORS } from "../../registry/registry.errors";
import { RegistryService } from "../../registry/registry.service";
import { RoutingManagementService } from "../../routing/management.service";
import { LoopLookupRepository } from "../../runs/loop.lookup.repository";
import { WorkflowRegistryService } from "../../workflows/registry.service";
import { ChatArgumentError, type ArgumentResolvers } from "../grammar.ports";
import type { ArgumentSpec, ResolvedArgument } from "../grammar.types";

/** How many alternatives an error offers. */
export const MAX_SUGGESTIONS = 5;

/** A number as typed: an optional `#`, then digits. Nine digits bound it to `integer`. */
const NUMBER = /^#?(\d{1,9})$/;

/** `repo#485` or `owner/repo#485`. */
const REPOSITORY_NUMBER = /^(?:([\w.-]+)\/)?([\w.-]+)#(\d{1,9})$/;

/** A GitHub issue or pull request URL. */
const GITHUB_URL =
  /^https?:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)\/(issues|pull)\/(\d{1,9})(?:[/?#].*)?$/i;

/** What a ticket's text names, before any read. */
export interface TicketReference {
  readonly number: number;
  readonly owner?: string;
  readonly repository?: string;
}

/**
 * Read a ticket's spelling.
 *
 * @param raw - What was typed.
 * @returns The number and any repository it named; `"pull_request"` for a pull request URL;
 *   `undefined` when the text is none of the accepted forms.
 */
export function parseTicket(raw: string): TicketReference | "pull_request" | undefined {
  const text = raw.trim();
  // Slack wraps a pasted URL in angle brackets.
  const url = GITHUB_URL.exec(text.replace(/^<|>$/g, ""));

  if (url !== null) {
    return url[3].toLowerCase() === "pull"
      ? "pull_request"
      : { owner: url[1], repository: url[2], number: Number(url[4]) };
  }

  const bare = NUMBER.exec(text);
  if (bare !== null) return { number: Number(bare[1]) };

  const scoped = REPOSITORY_NUMBER.exec(text);
  if (scoped === null) return undefined;

  return {
    ...(scoped[1] === undefined ? {} : { owner: scoped[1] }),
    repository: scoped[2],
    number: Number(scoped[3]),
  };
}

/**
 * Valid names for an error to offer: the nearest to what was typed first, then the rest in the
 * vocabulary's own order.
 *
 * @param typed - What was typed.
 * @param vocabulary - Every valid name.
 * @returns At most {@link MAX_SUGGESTIONS} names.
 */
export function nearestFirst(typed: string, vocabulary: readonly string[]): string[] {
  const near = nearest(typed, vocabulary);
  const ordered =
    near === undefined ? [...vocabulary] : [near, ...vocabulary.filter((name) => name !== near)];

  return ordered.slice(0, MAX_SUGGESTIONS);
}

/**
 * How to spell each of several issues sharing a number so that each is one issue.
 *
 * @param rows - The issues.
 * @returns `repo#485` for each — or `owner/repo#485` when two repositories share a name.
 */
export function ticketSpellings(rows: readonly TicketLookupRow[]): string[] {
  const names = rows.map((row) => row.repository.toLowerCase());
  const shared = names.some((name, index) => names.indexOf(name) !== index);

  return rows.map(
    (row) => `${shared ? `${row.owner}/` : ""}${row.repository}#${String(row.number)}`,
  );
}

@Injectable()
export class PlaneArgumentResolvers implements ArgumentResolvers {
  /**
   * @param tickets - The exact `#485` → issue read.
   * @param loops - The exact loop number → run read.
   * @param questions - The exact `q-231` → item read.
   * @param inbox - The Needs-You queue, for the open questions an error offers.
   * @param kinds - The decision kinds, where a question's answers are declared.
   * @param workflows - The workflows the workspace offers.
   * @param aliases - The model registry.
   * @param routing - The routing matrix, for the task kinds.
   */
  constructor(
    private readonly tickets: TicketLookupRepository,
    private readonly loops: LoopLookupRepository,
    private readonly questions: QuestionLookupRepository,
    private readonly inbox: InboxQueueService,
    private readonly kinds: DecisionKindRegistry,
    private readonly workflows: WorkflowRegistryService,
    private readonly aliases: RegistryService,
    private readonly routing: RoutingManagementService,
  ) {}

  /** @inheritdoc */
  async resolve(
    organizationId: string,
    spec: ArgumentSpec,
    raw: string,
    previous: Readonly<Record<string, ResolvedArgument>>,
  ): Promise<ResolvedArgument> {
    const typed = raw.trim();

    switch (spec.type) {
      case "ticket":
        return this.ticket(organizationId, spec, typed);
      case "loop":
        return this.loop(organizationId, spec, typed);
      case "workflow":
        return this.workflow(organizationId, spec, typed);
      case "alias":
        return this.alias(organizationId, spec, typed);
      case "task_kind":
        return this.taskKind(organizationId, spec, typed);
      case "question":
        return this.question(organizationId, spec, typed);
      case "action":
        return this.action(organizationId, spec, typed, previous);
      case "pr":
        return pullRequest(spec, typed);
      default:
        // `keyword` and `confirm` are the parser's: reaching here is a wiring fault.
        throw new Error(
          `The /ouro parser settles ${spec.type} arguments; "${spec.name}" reached the planes.`,
        );
    }
  }

  /**
   * `#485`, `485`, `repo#485`, `owner/repo#485` or an issue URL → one mirrored issue.
   *
   * @param organizationId - The workspace.
   * @param spec - The argument.
   * @param typed - What was typed.
   * @returns The issue, with its canonical twin when one is stored.
   * @throws {ChatArgumentError} Not a ticket; a pull request; unknown; or in several repositories.
   */
  private async ticket(
    organizationId: string,
    spec: ArgumentSpec,
    typed: string,
  ): Promise<ResolvedArgument> {
    const reference = parseTicket(typed);

    if (reference === "pull_request") {
      throw new ChatArgumentError(
        spec.name,
        `${typed} is a pull request, not an issue — name the issue: #485, repo#485 or its URL`,
      );
    }
    if (reference === undefined) {
      throw new ChatArgumentError(
        spec.name,
        `"${typed}" is not a ticket — use #485, repo#485, owner/repo#485 or a GitHub issue URL`,
      );
    }

    const rows = await this.tickets.byNumber(
      organizationId,
      reference.number,
      reference.repository === undefined
        ? undefined
        : {
            name: reference.repository,
            ...(reference.owner === undefined ? {} : { owner: reference.owner }),
          },
    );
    const number = `#${String(reference.number)}`;

    if (rows.length === 0) {
      const where =
        reference.repository === undefined
          ? "this workspace"
          : `${reference.owner === undefined ? "" : `${reference.owner}/`}${reference.repository}`;

      throw new ChatArgumentError(spec.name, `no issue ${number} in ${where}`);
    }

    const [row] = rows;
    if (rows.length > 1) {
      throw new ChatArgumentError(
        spec.name,
        `${number} is in more than one repository — say which`,
        ticketSpellings(rows),
      );
    }

    return {
      type: "ticket",
      issueId: row.issueId,
      number: row.number,
      repository: row.repository,
      ticketId: row.ticketId,
    };
  }

  /**
   * `1847` or `#1847` → the run carrying that loop number.
   *
   * @param organizationId - The workspace.
   * @param spec - The argument.
   * @param typed - What was typed.
   * @returns The loop.
   * @throws {ChatArgumentError} Not a number, or no such loop — offering the loops in flight.
   */
  private async loop(
    organizationId: string,
    spec: ArgumentSpec,
    typed: string,
  ): Promise<ResolvedArgument> {
    const match = NUMBER.exec(typed);
    const row =
      match === null ? undefined : await this.loops.byLoopSeq(organizationId, Number(match[1]));

    if (row !== undefined) return { type: "loop", runId: row.runId, loopSeq: row.loopSeq };

    const live = await this.loops.live(organizationId, "", MAX_SUGGESTIONS);

    throw new ChatArgumentError(
      spec.name,
      match === null
        ? `"${typed}" is not a loop number — use the number on the run, like 1847`
        : `no loop ${match[1]} in this workspace`,
      live.map((loop) => String(loop.loopSeq)),
    );
  }

  /**
   * A workflow slug the workspace offers.
   *
   * @param organizationId - The workspace.
   * @param spec - The argument.
   * @param typed - What was typed.
   * @returns The workflow.
   * @throws {ChatArgumentError} `unknown workflow "feature-lopp"`, offering the real ones.
   */
  private async workflow(
    organizationId: string,
    spec: ArgumentSpec,
    typed: string,
  ): Promise<ResolvedArgument> {
    const { slugs } = await this.workflows.offered(organizationId);

    if (slugs.includes(typed)) return { type: "workflow", slug: typed };

    throw new ChatArgumentError(
      spec.name,
      `unknown workflow "${typed}"`,
      nearestFirst(typed, slugs),
    );
  }

  /**
   * A model alias, as the registry resolves it — so a raw model id is refused as the UI refuses it.
   *
   * @param organizationId - The workspace.
   * @param spec - The argument.
   * @param typed - What was typed.
   * @returns The alias.
   * @throws {ChatArgumentError} `unknown model alias "…"`, offering the registry's aliases.
   */
  private async alias(
    organizationId: string,
    spec: ArgumentSpec,
    typed: string,
  ): Promise<ResolvedArgument> {
    try {
      const resolved = await this.aliases.resolve(organizationId, typed);

      return { type: "alias", alias: resolved.alias };
    } catch (error) {
      if (!(error instanceof DomainError) || error.code !== REGISTRY_ERRORS.aliasNotFound) {
        throw error;
      }
    }

    const known = await this.aliases.list(organizationId);
    const isModel = known.some((entry) => entry.modelId === typed);

    throw new ChatArgumentError(
      spec.name,
      isModel
        ? `"${typed}" is a model id, not an alias — routes name an alias`
        : `unknown model alias "${typed}"`,
      nearestFirst(
        typed,
        known.map((entry) => entry.alias),
      ),
    );
  }

  /**
   * A routable task kind.
   *
   * @param organizationId - The workspace.
   * @param spec - The argument.
   * @param typed - What was typed.
   * @returns The task kind.
   * @throws {ChatArgumentError} `unknown task kind "…"`, offering the matrix's kinds.
   */
  private async taskKind(
    organizationId: string,
    spec: ArgumentSpec,
    typed: string,
  ): Promise<ResolvedArgument> {
    const names = (await this.routing.matrix(organizationId)).taskKinds.map((kind) => kind.name);

    if (names.includes(typed)) return { type: "task_kind", name: typed };

    throw new ChatArgumentError(
      spec.name,
      `unknown task kind "${typed}"`,
      nearestFirst(typed, names),
    );
  }

  /**
   * `q-231` → the item, when it is still asking.
   *
   * @param organizationId - The workspace.
   * @param spec - The argument.
   * @param typed - What was typed.
   * @returns The question.
   * @throws {ChatArgumentError} Not a short id; unknown; already answered; expired.
   */
  private async question(
    organizationId: string,
    spec: ArgumentSpec,
    typed: string,
  ): Promise<ResolvedArgument> {
    const shortSeq = parseDecisionShortId(typed);
    const row =
      shortSeq === undefined
        ? undefined
        : await this.questions.byShortSeq(organizationId, shortSeq);

    if (row !== undefined) {
      const shortId = decisionShortId(row.shortSeq);

      if (row.status === "resolved") {
        throw new ChatArgumentError(spec.name, `${shortId} was already answered`);
      }
      if (row.status === "expired") {
        throw new ChatArgumentError(spec.name, `${shortId} expired before it was answered`);
      }

      return { type: "question", itemId: row.itemId, shortId };
    }

    // Nobody in particular is looking: the ids are what is offered, not anybody's actions.
    const asking = await this.inbox.queue(organizationId, { userId: null, roles: [] });

    throw new ChatArgumentError(
      spec.name,
      shortSeq === undefined
        ? `"${typed}" is not a question id — use the id on the card, like q-231`
        : `no question ${decisionShortId(shortSeq)} in this workspace`,
      asking.items.slice(0, MAX_SUGGESTIONS).map((item) => item.shortId),
    );
  }

  /**
   * An answer of the question named before it.
   *
   * @param organizationId - The workspace.
   * @param spec - The argument.
   * @param typed - What was typed.
   * @param previous - The arguments already resolved; one of them is the question.
   * @returns The action.
   * @throws {ChatArgumentError} `unknown action "allow" for q-231`, offering its real answers.
   */
  private async action(
    organizationId: string,
    spec: ArgumentSpec,
    typed: string,
    previous: Readonly<Record<string, ResolvedArgument>>,
  ): Promise<ResolvedArgument> {
    const question = Object.values(previous).find((argument) => argument.type === "question");

    if (question === undefined) {
      throw new Error(`The /ouro grammar reads "${spec.name}" against a question typed before it.`);
    }

    const answers = await this.answersOf(organizationId, question.shortId);

    if (answers.includes(typed)) return { type: "action", actionId: typed };

    throw new ChatArgumentError(
      spec.name,
      `unknown action "${typed}" for ${question.shortId}`,
      nearestFirst(typed, answers),
    );
  }

  /**
   * The answers a question takes — its kind's declared actions, less the links.
   *
   * @param organizationId - The workspace.
   * @param shortId - The question.
   * @returns The action ids, in the order the card draws them.
   */
  private async answersOf(organizationId: string, shortId: string): Promise<string[]> {
    const shortSeq = parseDecisionShortId(shortId);
    const row =
      shortSeq === undefined
        ? undefined
        : await this.questions.byShortSeq(organizationId, shortSeq);

    if (row === undefined) return [];

    const kind = await this.kinds.pinnedKind(row.kindId, row.kindVersion);

    // Whether this person may press each is the executor's to decide; here only what exists.
    return this.kinds
      .actionsFor(kind, { roles: [], canApproveLoops: false })
      .filter((action) => !action.navigates)
      .map((action) => action.id);
  }
}

/**
 * A pull request number.
 *
 * @param spec - The argument.
 * @param typed - What was typed.
 * @returns The number.
 * @throws {ChatArgumentError} When it is not a number.
 */
function pullRequest(spec: ArgumentSpec, typed: string): ResolvedArgument {
  const match = NUMBER.exec(typed);

  if (match === null) {
    throw new ChatArgumentError(spec.name, `"${typed}" is not a pull request number — like 514`);
  }

  return { type: "pr", number: Number(match[1]) };
}
