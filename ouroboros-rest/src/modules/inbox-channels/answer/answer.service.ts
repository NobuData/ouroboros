/**
 * `AnswerService` — what a token link does (BN.3, [#463](https://github.com/NobuData/ouroboros/issues/463),
 * decision **X5**).
 *
 * ```
 * GET / HEAD  token ─▶ inspect (spends nothing) ─▶ live? ─▶ the person still a member?
 *             session of someone else ─▶ "sent to someone else"            (403)
 *             merge-class, no session ─▶ the card + "sign in to confirm"   (200)
 *             otherwise               ─▶ the card + one button             (200)
 * POST        the same checks — a merge-class POST without a session is refused (401) —
 *             then the note held to the declaration (422 re-renders, nothing spent)
 *             ─▶ spend (V096: atomic, single use) ─▶ InboxActionsService.execute(channel email)
 *             ─▶ receipt · or "already answered" · or the plane's refusal (the item stays open)
 * ```
 *
 * **Nothing executes on link-open.** Mail scanners and link previewers fetch every link in a
 * message; the GET (and the HEAD Express serves from it) only reads. The answer is the POST from
 * the page's one button.
 *
 * **A token is one person's.** It names the user it was minted for, and the executor runs as that
 * user with their *current* roles — so a role taken away since the mail left is refused by the
 * executor. A signed-in session of anyone else refuses the link outright, on GET and on POST.
 *
 * **Merge-class needs a session** (X5): `requires_confirm` is V096's copy of the kind's
 * `merge_class`, and a stolen link alone can never merge to `main`. The session must be the
 * token's own person. The page is reached on the UI origin through `proxy.ts`, which is how the
 * session cookie arrives here.
 */

import { Injectable, Logger } from "@nestjs/common";

import { AppConfigService } from "../../config/config.service";
import { DecisionKindRegistry } from "../../decisions/decision-kind.registry";
import type { DecisionAction, PublishedDecisionKind } from "../../decisions/decision.types";
import { outcomeWords, refsOf } from "../../decisions/inbox.compose";
import { InboxRepository, type InboxItemRow } from "../../decisions/inbox.repository";
import { DomainError } from "../../errors/error.envelope";
import { describeForLog } from "../../errors/failure";
import { INBOX_ACTION_ERRORS } from "../../inbox-actions/inbox-actions.errors";
import type { ActionResolutionResource } from "../../inbox-actions/inbox-actions.resources";
import { InboxActionsService } from "../../inbox-actions/inbox-actions.service";
import { answerPath, inboxItemUrl, inboxUrl, signInUrl } from "../channel.links";
import { DecisionMailRepository, type MailRecipient } from "../mail/decision-mail.repository";
import { CHANNEL_WORDS, utcMinute } from "../mirror/mirror.compose";
import type { ActionTokenRecord } from "../tokens/action-token.repository";
import { ActionTokenService, type InspectedActionToken } from "../tokens/action-token.service";
import {
  MAX_ANSWER_NOTE,
  confirmPage,
  failedPage,
  problemPage,
  receiptPage,
  signInPage,
  type AnswerAction,
  type AnswerCard,
  type AnswerPage,
  type TokenProblem,
} from "./answer.pages";

/** The signed-in person a request carries, if any. */
export interface AnswerSession {
  readonly userId: string;
  readonly name: string;
}

/** A token that names a live item, an action and a member — ready to render or answer. */
interface Loaded {
  readonly token: InspectedActionToken;
  readonly presented: string;
  readonly item: InboxItemRow;
  readonly kind: PublishedDecisionKind;
  readonly action: DecisionAction;
  readonly member: MailRecipient;
  readonly card: AnswerCard;
}

/**
 * The problem a stored token's state is.
 *
 * @param record - The token.
 * @returns The problem, or undefined for a live token.
 */
export function problemOf(
  record: Pick<ActionTokenRecord, "state" | "revokeReason">,
): TokenProblem | undefined {
  switch (record.state) {
    case "live":
      return undefined;
    case "used":
      return "used";
    case "expired":
      return "expired";
    default:
      return record.revokeReason === "item_closed"
        ? "answered"
        : record.revokeReason === "superseded"
          ? "superseded"
          : "withdrawn";
  }
}

/**
 * A resolution as the receipt page says it.
 *
 * @param resolution - The executor's answer.
 * @returns `approved by Ken · by email · 2026-10-04 09:12 UTC · merge_sha 3f9a1c2`.
 */
export function receiptText(resolution: ActionResolutionResource): string {
  const details = Object.entries(resolution.outcome)
    .filter(([, value]) => ["string", "number", "boolean"].includes(typeof value))
    .slice(0, 4)
    .map(([key, value]) => `${key.replace(/_/g, " ")} ${String(value)}`);

  return [
    `${outcomeWords(resolution)}${resolution.actor === null ? "" : ` by ${resolution.actor.name}`}`,
    CHANNEL_WORDS[resolution.channel],
    utcMinute(new Date(resolution.resolvedAt)),
    ...details,
  ].join(" · ");
}

@Injectable()
export class AnswerService {
  private readonly logger = new Logger(AnswerService.name);

  /**
   * @param tokens - Inspects and spends tokens.
   * @param inbox - The item, as the queue reads it.
   * @param registry - The kinds, pinned, and their rendering.
   * @param mail - The token's person as a member (roles), and the workspace's name.
   * @param actions - The executor every channel answers through (BN.2).
   * @param config - `OURO_UI_URL`, for the inbox and sign-in links.
   */
  constructor(
    private readonly tokens: ActionTokenService,
    private readonly inbox: InboxRepository,
    private readonly registry: DecisionKindRegistry,
    private readonly mail: DecisionMailRepository,
    private readonly actions: InboxActionsService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * The page a link opens. Reads only.
   *
   * @param presented - The token from the path.
   * @param session - The signed-in person, if the request carried a session.
   * @returns The page.
   */
  async page(presented: string, session: AnswerSession | undefined): Promise<AnswerPage> {
    const loaded = await this.load(presented, session);

    if (!("item" in loaded)) {
      return loaded;
    }

    if (loaded.token.record.requiresConfirm && session === undefined) {
      return this.signIn(loaded, false);
    }

    return confirmPage({
      card: loaded.card,
      action: actionOf(loaded.action),
      formAction: answerPath(presented),
    });
  }

  /**
   * The answer — the page's button.
   *
   * @param presented - The token from the path.
   * @param session - The signed-in person, if any.
   * @param rawNote - The form's note, if any.
   * @returns The receipt, or the page saying why nothing was done.
   */
  async answer(
    presented: string,
    session: AnswerSession | undefined,
    rawNote: string | undefined,
  ): Promise<AnswerPage> {
    const loaded = await this.load(presented, session);

    if (!("item" in loaded)) {
      return loaded;
    }

    if (loaded.token.record.requiresConfirm && session === undefined) {
      return this.signIn(loaded, true);
    }

    const note = rawNote?.trim() ?? "";

    if (loaded.action.takes_note && note === "") {
      return confirmPage({
        card: loaded.card,
        action: actionOf(loaded.action),
        formAction: answerPath(presented),
        noteError: "This answer needs a note.",
      });
    }

    const spent = await this.tokens.spend(loaded.token);

    if (spent.outcome !== "accepted") {
      return this.problem(
        spent.outcome === "revoked"
          ? (await this.tokens.inspect(presented))?.record.revokeReason === "item_closed"
            ? "answered"
            : "superseded"
          : spent.outcome,
        loaded,
      );
    }

    return this.execute(loaded, session, loaded.action.takes_note ? note : undefined);
  }

  /**
   * Run the action through the executor as the token's person.
   *
   * @param loaded - The token, item, action and member.
   * @param session - The signed-in person, if any.
   * @param note - The note, for an action that takes one.
   * @returns The receipt, or why nothing was decided.
   */
  private async execute(
    loaded: Loaded,
    session: AnswerSession | undefined,
    note: string | undefined,
  ): Promise<AnswerPage> {
    const { record } = loaded.token;

    try {
      const result = await this.actions.execute(
        record.organizationId,
        record.itemId,
        record.actionId,
        {
          id: record.userId,
          name: session?.name ?? loaded.member.name,
          roles: loaded.member.roles,
        },
        { note: note?.slice(0, MAX_ANSWER_NOTE), idempotencyKey: `token:${record.id}` },
        record.channel,
      );

      return receiptPage({
        card: loaded.card,
        actionLabel: loaded.action.label,
        receipt: receiptText(result.resolution),
        inboxUrl: inboxUrl(this.config.uiUrl),
      });
    } catch (error) {
      if (error instanceof DomainError && error.code === INBOX_ACTION_ERRORS.alreadyAnswered) {
        return this.problem("answered", loaded);
      }

      if (!(error instanceof DomainError)) {
        this.logger.error(
          `Answering decision ${record.itemId} by token failed.`,
          describeForLog(error),
        );
      }

      return failedPage({
        card: loaded.card,
        message:
          error instanceof DomainError
            ? error.envelope().message
            : "The plane that owns this action failed; nothing was decided.",
        status: error instanceof DomainError ? error.getStatus() : 500,
        inboxUrl: inboxItemUrl(this.config.uiUrl, record.itemId),
      });
    }
  }

  /**
   * Everything both routes check before rendering anything about the decision.
   *
   * @param presented - The token from the path.
   * @param session - The signed-in person, if any.
   * @returns The loaded token, or the page that refuses it.
   */
  private async load(
    presented: string,
    session: AnswerSession | undefined,
  ): Promise<Loaded | AnswerPage> {
    const token = await this.tokens.inspect(presented);

    if (token === undefined) {
      return problemPage("unknown", inboxUrl(this.config.uiUrl));
    }

    const { record } = token;
    const item = await this.inbox.item(record.organizationId, record.itemId);
    const kind =
      item === undefined
        ? undefined
        : await this.registry.pinnedKind(item.kindId, item.kindVersion);
    const action = kind?.actions.find((candidate) => candidate.id === record.actionId);

    if (item === undefined || kind === undefined || action === undefined) {
      return problemPage("unknown", inboxUrl(this.config.uiUrl));
    }

    // Someone else's session never sees the card: the link is not theirs.
    if (session !== undefined && session.userId !== record.userId) {
      return problemPage("wrong_user", inboxUrl(this.config.uiUrl));
    }

    const prose = this.registry.render(kind, item.payload);
    const card: AnswerCard = {
      workspace: await this.mail.workspaceName(record.organizationId),
      severity: item.severity,
      question: prose.question,
      why: prose.why,
      refs: refsOf(item.refs),
    };
    const problem = problemOf(record);

    if (problem !== undefined) {
      return problemPage(problem, inboxItemUrl(this.config.uiUrl, item.id), card);
    }

    const [member] = await this.mail.recipients(record.organizationId, record.userId);

    if (member === undefined) {
      return problemPage("not_member", inboxUrl(this.config.uiUrl));
    }

    return { token, presented, item, kind, action, member, card };
  }

  /**
   * The sign-in page for a merge-class link.
   *
   * @param loaded - The token and its card.
   * @param refused - True for a POST that arrived without a session.
   * @returns The page.
   */
  private signIn(loaded: Loaded, refused: boolean): AnswerPage {
    return signInPage({
      card: loaded.card,
      action: actionOf(loaded.action),
      signInUrl: signInUrl(this.config.uiUrl, loaded.presented),
      refused,
    });
  }

  /**
   * A designed refusal about a loaded token.
   *
   * @param problem - Which (`unknown` is the spend's answer for a vanished token).
   * @param loaded - The token and its card.
   * @returns The page.
   */
  private problem(problem: TokenProblem, loaded: Loaded): AnswerPage {
    return problemPage(problem, inboxItemUrl(this.config.uiUrl, loaded.item.id), loaded.card);
  }
}

/**
 * A declared action as the pages show it.
 *
 * @param action - The declaration.
 * @returns The label, consequence, note flag and style.
 */
function actionOf(action: DecisionAction): AnswerAction {
  return {
    label: action.label,
    consequence: action.consequence_text,
    takesNote: action.takes_note,
    style: action.style,
  };
}
