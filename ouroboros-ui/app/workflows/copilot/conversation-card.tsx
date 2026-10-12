"use client";

import { useRouter } from "next/navigation";
import { type KeyboardEvent, useEffect, useId, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";

import type { ProviderConnection } from "@/app/api/providers";
import type { CopilotConversation, CopilotReadiness } from "@/app/api/workflow-copilot";
import { Button, Card, CardHead, Chip, Tag, cx } from "@/app/ui";

import { composerDraftStore, useComposerDraft } from "./composer-draft";
import {
  COMPOSER_LABEL,
  COMPOSER_PLACEHOLDER,
  CONNECTION_LOST,
  CONNECTION_LOST_CODE,
  CONVERSATION_CAPTION,
  type ChatMessage,
  EMPTY_NOTE,
  EMPTY_READER_NOTE,
  EMPTY_READER_TITLE,
  EMPTY_TITLE,
  COPILOT_WILL,
  COPILOT_WILL_NOT,
  EXAMPLES_LABEL,
  EXAMPLES_NOTE,
  EXAMPLE_BRIEFS,
  type ExchangeOrigin,
  INITIAL_CHAT,
  MESSAGES_LABEL,
  MESSAGE_MAX_LENGTH,
  NEW_CONVERSATION_LABEL,
  NEW_MESSAGES_LABEL,
  NOTHING_TO_SEND,
  type Placed,
  type ReplyFailure,
  SENDING,
  SEND_LABEL,
  SHOW_EARLIER_LABEL,
  THINKING,
  WILL_LABEL,
  WILL_NOT_LABEL,
  anchoredScrollTop,
  announcement,
  answerableId,
  chatMessages,
  chatReducer,
  chatSession,
  chipsLive,
  composerAbsent,
  composerGate,
  contentVersion,
  draftTag,
  firstVisible,
  hasUnseen,
  initialHidden,
  isAtBottom,
  mayRetry,
  modelPill,
  modelPillTitle,
  prerequisiteNotice,
  replyFailure,
  retryText,
  revealEarlier,
  segmentsText,
  sendsOnKey,
  shownMessages,
} from "./conversation";
import { ChoiceRows, MetaLine, ReplyEnding, ReplyText, Segments, StoredTrace } from "./conversation-parts";
import { type CopilotTransport, type TransportRefusal, browserTransport } from "./conversation-transport";
import {
  liveReadiness,
  publishDraft,
  publishOperation,
  publishStreaming,
  resetCopilotLive,
  useLiveDryRun,
} from "./copilot-live";
import {
  COPILOT_SEATS,
  INTERRUPTED_BODY,
  TRANSCRIPT_EMPTY,
  type TranscriptReason,
  seatElementId,
  transcriptNote,
} from "./copilot-view";

import "./conversation.css";

/**
 * The conversation card (CE.2, [#566](https://github.com/NobuData/ouroboros/issues/566)) —
 * mockup 20's `c-5` column: the head with the resolved model's pill and the draft's tag, the
 * bubbles, the chip rows, the composer, and the caption under it.
 *
 * ### What is the server's and what is this page's
 *
 * The conversation is the service's (decision **W9**): the route reads it on every arrival and
 * hands it in as `conversation`. What this component adds is only what happened **since** — the
 * reply arriving now, and what it watched of the replies before it (`conversation.ts`'
 * `ChatState`). When a reply finishes it calls `router.refresh()`, the route reads again, and the
 * two are merged by message id with the server's copy winning; nothing is set from an effect.
 *
 * ### Watching it build
 *
 * A send is a `POST` whose answer is a stream. Text and operation markers are drawn **in the
 * order the stream delivers them**, and each applied operation is published to `copilot-live.ts`
 * as it lands, so the stage list beside this card (CE.3, #567) can move in step.
 *
 * ### The composer says why
 *
 * `composerGate` decides whether a message may be sent, and its reason is drawn under the box
 * and tied to it with `aria-describedby` — never a silent grey. The box stays focusable while it
 * waits (read-only, `aria-disabled`), so a keyboard or screen-reader user can land on it and
 * hear the reason. A reader who may not write, and a closed conversation, have no box at all:
 * the same place says why.
 *
 * ### The scroller is its own, and it does not fight the reader
 *
 * The messages scroll inside this card's wrapper, never the pane. A streaming reply is followed
 * only while the reader is at the bottom; one who scrolled up is left where they are and offered
 * *New messages ↓*. *Show earlier messages* prepends a page and puts the message the reader was
 * looking at back where it was.
 *
 * ### One announcement per reply
 *
 * The arriving bubble is `aria-busy` and is not a live region. A single polite region under the
 * card says the reply once, when it settles.
 */

/** What the card takes. */
export interface ConversationCardProps {
  /** The workflow's id — what the three writes are addressed to. */
  readonly workflowId: string;
  /** The workflow's slug — the draft tag before there is a session to name it. */
  readonly slug: string;
  /** The workflow's name, for a closed conversation's note. */
  readonly name: string;
  /** The conversation the route read — `null` for a workflow that never had one. */
  readonly conversation: CopilotConversation | null;
  /** The service's readiness — `null` when it could not be read, which gates nothing. */
  readonly readiness: CopilotReadiness | null;
  /**
   * The workspace's provider connections (CE.5, #569) — what the gateway notice reports the
   * status of. `null`, the default, when they could not be read: the notice then says nothing
   * about them.
   */
  readonly providers?: readonly ProviderConnection[] | null;
  /** Whether the reader's role may write — decided at the gate. */
  readonly mayAdminister: boolean;
  /** How to reach the service. Defaults to this origin's routes; a test hands in a fake. */
  readonly transport?: CopilotTransport;
}

/** What a refusal with a status the service's sentence does not explain says instead. */
const SIGNED_OUT = "Your session has ended. Reload the page to sign in again — your message is back in the box.";

/**
 * What a refused send tells the reader.
 *
 * @param refusal The refusal.
 * @returns The service's sentence — or, for an expired session, what to do about it.
 */
function refusalWords(refusal: TransportRefusal): string {
  return refusal.status === 401 ? SIGNED_OUT : refusal.message;
}

/**
 * Where each message sits in the scroller.
 *
 * @param scroller The scroller.
 * @returns Every message's edges, measured from the top of the scrolled content.
 */
function placedMessages(scroller: HTMLElement): Placed[] {
  const origin = scroller.getBoundingClientRect().top - scroller.scrollTop;

  return [...scroller.querySelectorAll<HTMLElement>("[data-message-id]")].map((node) => {
    const box = node.getBoundingClientRect();

    return { id: node.dataset.messageId ?? "", top: box.top - origin, bottom: box.bottom - origin };
  });
}

/**
 * One half of the invitation's plain statement (CE.5, #569): what the copilot will do, or what
 * it will not.
 *
 * @param props.label The list's heading, and its accessible name.
 * @param props.items The statements.
 * @returns The labelled list.
 */
function ScopeList({ label, items }: Readonly<{ label: string; items: readonly string[] }>) {
  return (
    <div className="copilot-chat__scope-half">
      <p className="copilot-chat__scope-label">{label}</p>
      <ul aria-label={label} className="copilot-chat__scope-list">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The conversation card.
 *
 * @param props See {@link ConversationCardProps}.
 * @returns The card, and the caption under it.
 */
export function ConversationCard({
  workflowId,
  slug,
  name,
  conversation,
  readiness,
  providers = null,
  mayAdminister,
  transport = browserTransport,
}: ConversationCardProps) {
  const router = useRouter();
  const [state, dispatch] = useReducer(chatReducer, INITIAL_CHAT);
  const [spoken, setSpoken] = useState("");

  const element = seatElementId("conversation");
  const titleId = `${element}-title`;
  const inputId = useId();
  const reasonId = useId();
  const liveDryRun = useLiveDryRun(workflowId);

  /* ---- what is drawn ---- */

  const session = chatSession(conversation, state);
  const messages = useMemo(() => chatMessages(conversation, state), [conversation, state]);
  const { live } = state;

  const closed: TranscriptReason | null = session !== null && session.status !== "active" ? session.status : null;
  const last = messages.at(-1)?.message;
  const gate = composerGate({
    status: session?.status ?? null,
    mayAdminister,
    streaming: live !== null,
    pending: last?.role === "copilot" && last.status === "streaming",
    // The dry-run card knows a run started or ended before the route's readiness is read again.
    readiness: liveReadiness(readiness, liveDryRun),
    closedNote: closed === null ? "" : transcriptNote(closed, name),
  });
  const absent = composerAbsent(gate);
  const notice = closed === null ? prerequisiteNotice(readiness, providers) : null;
  const pill = modelPill(session);
  const answerable = answerableId(messages);

  /* ---- the composer's text, kept per workflow ---- */

  const drafts = useMemo(() => composerDraftStore(workflowId), [workflowId]);
  const text = useComposerDraft(drafts);

  /* ---- history, and the scroller ---- */

  const [hidden, setHidden] = useState(() => initialHidden(conversation?.messages.length ?? 0));
  const shown = shownMessages(messages, hidden);
  const earlier = messages.length - shown.length;

  const scroller = useRef<HTMLDivElement>(null);
  /** Whether a change in content should be followed — the reader is at the bottom. */
  const following = useRef(true);
  /** The message the reader was looking at when earlier ones were asked for. */
  const anchor = useRef<{ id: string; top: number; scrollTop: number } | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const version = contentVersion(messages.length, live);
  const [leftAt, setLeftAt] = useState(version);

  // Follow new content — only for a reader who is at the bottom.
  useLayoutEffect(() => {
    const box = scroller.current;
    if (box !== null && following.current) box.scrollTop = box.scrollHeight;
  }, [version]);

  // After earlier messages were prepended: put the one being read back where it was.
  useLayoutEffect(() => {
    const kept = anchor.current;
    const box = scroller.current;
    anchor.current = null;
    if (kept === null || box === null) return;

    const now = placedMessages(box).find((item) => item.id === kept.id);
    if (now !== undefined) box.scrollTop = anchoredScrollTop(kept.scrollTop, kept.top, now.top);
  }, [hidden]);

  /** Whether the component is still on the page — a reply may outlive it. */
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** Whether an exchange is in flight — set before the first await, so a double press sends once. */
  const busy = useRef(false);

  function onScroll(): void {
    const box = scroller.current;
    if (box === null) return;

    const bottom = isAtBottom(box);
    following.current = bottom;
    if (bottom === atBottom) return;

    setAtBottom(bottom);
    if (!bottom) setLeftAt(version);
  }

  function toNewest(): void {
    const box = scroller.current;
    if (box !== null) box.scrollTop = box.scrollHeight;
    following.current = true;
    setAtBottom(true);
  }

  function showEarlier(): void {
    const box = scroller.current;
    const next = revealEarlier(hidden);

    if (box !== null) {
      const first = firstVisible(placedMessages(box), box.scrollTop);
      anchor.current = first === null ? null : { id: first.id, top: first.top, scrollTop: box.scrollTop };
      // Prepending is not new content to follow.
      following.current = false;
      // The button goes with the last page; focus goes to the list it was above.
      if (next === 0) box.focus({ preventScroll: true });
    }
    setHidden(next);
  }

  /* ---- the exchange ---- */

  /**
   * Run one exchange: start the conversation if there is none, post, and read the reply's stream
   * to its end.
   *
   * @param origin A message, or a chip.
   */
  async function exchange(origin: ExchangeOrigin): Promise<void> {
    if (busy.current) return;
    busy.current = true;

    following.current = true;
    setAtBottom(true);
    dispatch({ type: "start", origin });
    publishStreaming(workflowId, true);

    let accepted = false;
    let finished = false;
    let said = "";
    let failure: ReplyFailure | null = null;
    /** Put an unsent message back in the box — unless something has been typed there since. */
    const giveBack = (): void => {
      if (origin.kind === "message" && drafts.get() === "") drafts.set(origin.text);
    };
    /** Give the reader their text back and say why nothing was sent. */
    const refuse = (words: string): void => {
      giveBack();
      if (mounted.current) dispatch({ type: "refused", message: words });
    };

    try {
      let sessionId = session !== null && session.status === "active" ? session.id : null;
      if (sessionId === null) {
        const started = await transport.startSession(workflowId);
        if (!started.ok) return refuse(refusalWords(started.refusal));

        if (mounted.current) dispatch({ type: "session", session: started.value });
        sessionId = started.value.id;
      }

      const opened =
        origin.kind === "message"
          ? await transport.send(workflowId, sessionId, origin.text)
          : await transport.answer(workflowId, sessionId, origin.messageId, {
              question: origin.question,
              selected: origin.selected,
            });
      if (!opened.ok) return refuse(refusalWords(opened.refusal));

      for await (const event of opened.events) {
        if (event.kind === "accepted") accepted = true;
        if (event.kind === "delta") said += event.text;
        if (event.kind === "error") failure = { code: event.code, message: event.message };
        if (event.kind === "operation" && event.outcome !== "bounced") {
          publishOperation(workflowId, {
            op: event.op,
            outcome: event.outcome,
            draftRev: event.draftRev,
            warnings: event.warnings ?? [],
          });
        }
        if (event.kind === "done") {
          finished = true;
          publishDraft(workflowId, event.draft);
        }
        if (mounted.current) dispatch({ type: "event", event });
      }
    } catch {
      // The stream broke mid-read. What arrived is kept; `ended` below says the rest.
    } finally {
      busy.current = false;
      publishStreaming(workflowId, false);
      if (!accepted) giveBack();

      if (mounted.current) {
        // A no-op after `done`; otherwise it settles what arrived as a reply that did not finish.
        dispatch({ type: "ended" });

        if (accepted) {
          const ending = finished ? failure : (failure ?? { code: CONNECTION_LOST_CODE, message: CONNECTION_LOST });
          setSpoken(announcement(said, ending));
          // The promotion summary, the draft's label and the seats beside this card are the
          // server's reads: have them made again now that the draft has moved.
          router.refresh();
        }
      }
    }
  }

  function send(): void {
    const message = text.trim();
    if (gate !== null || message === "") return;

    drafts.set("");
    void exchange({ kind: "message", text: message });
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    const pressed = {
      key: event.key,
      shiftKey: event.shiftKey,
      isComposing: event.nativeEvent.isComposing,
      keyCode: event.keyCode,
    };
    if (!sendsOnKey(pressed)) return;

    // Enter sends and must not also write a line break — whether or not anything was sent.
    event.preventDefault();
    send();
  }

  function startAgain(): void {
    if (session === null) return;

    resetCopilotLive(workflowId);
    setHidden(0);
    dispatch({ type: "detach", sessionId: session.id });
  }

  /* ---- drawing ---- */

  const silent = shown.length === 0 && live === null;

  return (
    <div className="copilot-chat__column">
      <Card aria-labelledby={titleId} as="section" className={cx("copilot-view__seat", "copilot-chat")} id={element}>
        <CardHead
          title={COPILOT_SEATS.conversation.title}
          titleId={titleId}
          trailing={
            <span className="copilot-chat__head-end">
              {pill !== null && (
                <Chip mono title={modelPillTitle(pill)} tone="model">
                  {pill.modelId}
                </Chip>
              )}
              <Tag>{draftTag(session?.draftName ?? slug)}</Tag>
            </span>
          }
        />

        {notice !== null && (
          <div className="copilot-chat__notice" role="status">
            <p className="copilot-chat__notice-title">{notice.title}</p>
            <p className="copilot-chat__notice-text">{notice.text}</p>
            {notice.status !== null && <p className="copilot-chat__notice-status">{notice.status}</p>}
            <a className="copilot-chat__notice-link" href={notice.href}>
              {notice.linkLabel}
            </a>
          </div>
        )}

        <div
          aria-label={MESSAGES_LABEL}
          className="copilot-chat__scroll"
          onScroll={onScroll}
          ref={scroller}
          role="group"
          tabIndex={0}
        >
          {earlier > 0 && (
            <Button className="copilot-chat__earlier" onClick={showEarlier} size="sm" tone="ghost">
              {SHOW_EARLIER_LABEL}
            </Button>
          )}

          {silent && closed !== null && <p className="copilot-chat__silent">{TRANSCRIPT_EMPTY}</p>}
          {silent && closed === null && !mayAdminister && (
            <div className="copilot-chat__empty">
              <p className="copilot-chat__empty-title">{EMPTY_READER_TITLE}</p>
              <p className="copilot-chat__empty-note">{EMPTY_READER_NOTE}</p>
            </div>
          )}
          {silent && closed === null && mayAdminister && (
            <div className="copilot-chat__empty">
              <p className="copilot-chat__empty-title">{EMPTY_TITLE}</p>
              <p className="copilot-chat__empty-note">{EMPTY_NOTE}</p>
              <ul aria-label={EXAMPLES_LABEL} className="copilot-chat__examples">
                {EXAMPLE_BRIEFS.map((brief) => (
                  <li key={brief}>
                    <button
                      className="copilot-chat__example"
                      disabled={gate !== null}
                      onClick={() => drafts.set(brief)}
                      type="button"
                    >
                      {brief}
                    </button>
                  </li>
                ))}
              </ul>
              <p className="copilot-chat__empty-note">{EXAMPLES_NOTE}</p>
              <div className="copilot-chat__scope">
                <ScopeList items={COPILOT_WILL} label={WILL_LABEL} />
                <ScopeList items={COPILOT_WILL_NOT} label={WILL_NOT_LABEL} />
              </div>
            </div>
          )}

          {(shown.length > 0 || live !== null) && (
            <ol className="copilot-chat__messages">
              {shown.map((entry, at) => (
                <Settled
                  answerable={entry.message.id === answerable}
                  entry={entry}
                  gate={gate}
                  key={entry.message.id}
                  newest={earlier + at === messages.length - 1 && live === null}
                  onAnswer={(question, selected) =>
                    void exchange({ kind: "answer", messageId: entry.message.id, question, selected })
                  }
                  onRetry={(again) => void exchange({ kind: "message", text: again })}
                  retry={retryText(messages, earlier + at)}
                />
              ))}

              {live !== null && live.user !== null && (
                <li className={cx("copilot-chat__msg", "copilot-chat__msg--user")} data-message-id={live.user.id}>
                  <MetaLine at={live.user.createdAt} role="user" />
                  <div className={cx("copilot-chat__bubble", "copilot-chat__bubble--user")}>{live.user.body}</div>
                </li>
              )}
              {live !== null && live.user === null && live.origin.kind === "message" && (
                <li className={cx("copilot-chat__msg", "copilot-chat__msg--user")}>
                  <MetaLine note={SENDING} role="user" />
                  <div className={cx("copilot-chat__bubble", "copilot-chat__bubble--user")}>{live.origin.text}</div>
                </li>
              )}
              {live !== null && (
                <li className={cx("copilot-chat__msg", "copilot-chat__msg--bot")}>
                  <MetaLine costCents={live.costCents} role="copilot" />
                  <div aria-busy="true" className={cx("copilot-chat__bubble", "copilot-chat__bubble--bot")}>
                    {live.segments.length === 0 && live.choices.length === 0 ? (
                      <p className="copilot-chat__thinking">{THINKING}</p>
                    ) : (
                      <Segments segments={live.segments} />
                    )}
                    {/* Questions are drawn as they are asked, and answered once the reply is whole. */}
                    <ChoiceRows choices={live.choices} live={false} onAnswer={() => {}} />
                  </div>
                </li>
              )}
            </ol>
          )}
        </div>

        {hasUnseen(atBottom, leftAt, version) && (
          <Button className="copilot-chat__newest" onClick={toNewest} size="sm">
            {NEW_MESSAGES_LABEL}
          </Button>
        )}

        <div className="copilot-chat__composer">
          {state.refusal !== null && (
            <p className="copilot-chat__refusal" role="alert">
              {state.refusal}
            </p>
          )}

          {absent ? (
            // Nothing to say under an empty state that already says who can start one.
            !(silent && closed === null) && (
              <div className="copilot-chat__closed">
                <p className="copilot-chat__readonly" role="note">
                  {gate?.message}
                </p>
                {closed !== null && mayAdminister && (
                  <Button onClick={startAgain} size="sm">
                    {NEW_CONVERSATION_LABEL}
                  </Button>
                )}
              </div>
            )
          ) : (
            <>
              <div className="copilot-chat__entry">
                <label className="sr-only" htmlFor={inputId}>
                  {COMPOSER_LABEL}
                </label>
                <textarea
                  aria-describedby={gate === null ? undefined : reasonId}
                  aria-disabled={gate !== null || undefined}
                  className={cx("ou-input", "copilot-chat__input")}
                  id={inputId}
                  maxLength={MESSAGE_MAX_LENGTH}
                  onChange={(event) => drafts.set(event.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder={COMPOSER_PLACEHOLDER}
                  readOnly={gate !== null}
                  rows={2}
                  value={text}
                />
                <Button
                  aria-describedby={gate === null ? undefined : reasonId}
                  onClick={send}
                  reason={gate?.message ?? (text.trim() === "" ? NOTHING_TO_SEND : undefined)}
                  size="sm"
                  tone="primary"
                >
                  {SEND_LABEL}
                </Button>
              </div>
              {gate !== null && (
                <p className="copilot-chat__reason" id={reasonId}>
                  {gate.message}
                </p>
              )}
            </>
          )}
        </div>

        {/* No `status` role: the page's own notices are found by it, and this is never looked at. */}
        <p aria-atomic="true" aria-live="polite" className="sr-only">
          {spoken}
        </p>
      </Card>

      <p className="copilot-chat__caption">{CONVERSATION_CAPTION}</p>
    </div>
  );
}

/**
 * One settled message: the person's bubble, or the copilot's with its markers, its questions
 * and — where it did not finish — how it ended.
 *
 * @param props.entry The message, and what the card watched of it.
 * @param props.newest Whether it is the conversation's last message.
 * @param props.answerable Whether its open questions are the ones that may be answered now.
 * @param props.gate Why the composer cannot send, or `null`.
 * @param props.retry What a Retry would send, or `null`.
 * @param props.onAnswer Post an answer.
 * @param props.onRetry Send a text again.
 * @returns The list item.
 */
function Settled({
  entry,
  newest,
  answerable,
  gate,
  retry,
  onAnswer,
  onRetry,
}: Readonly<{
  entry: ChatMessage;
  newest: boolean;
  answerable: boolean;
  gate: ReturnType<typeof composerGate>;
  retry: string | null;
  onAnswer: (question: number, selected: string) => void;
  onRetry: (text: string) => void;
}>) {
  const { message, record } = entry;

  if (message.role === "user") {
    return (
      <li className={cx("copilot-chat__msg", "copilot-chat__msg--user")} data-message-id={message.id}>
        <MetaLine at={message.createdAt} role="user" />
        <div className={cx("copilot-chat__bubble", "copilot-chat__bubble--user")}>{message.body}</div>
      </li>
    );
  }

  const failure = replyFailure(entry);
  const choices = message.choices ?? [];
  const watched = record !== null && record.segments.length > 0;
  const wordless = watched ? segmentsText(record.segments).trim() === "" : message.body.trim() === "";

  return (
    <li className={cx("copilot-chat__msg", "copilot-chat__msg--bot")} data-message-id={message.id}>
      <MetaLine at={message.createdAt} costCents={message.costCents} role="copilot" />
      <div className={cx("copilot-chat__bubble", "copilot-chat__bubble--bot")}>
        {watched ? <Segments segments={record.segments} /> : <ReplyText text={message.body} />}
        {wordless && failure !== null && <p className="copilot-chat__thinking">{INTERRUPTED_BODY}</p>}
        {!watched && <StoredTrace trace={message.toolTrace} />}
        <ChoiceRows
          choices={choices}
          live={choices.some((choice) => chipsLive(choice, answerable, gate))}
          onAnswer={onAnswer}
        />
      </div>
      {failure !== null && (
        <ReplyEnding
          failure={failure}
          onRetry={mayRetry(failure, newest, gate, retry) && retry !== null ? () => onRetry(retry) : undefined}
        />
      )}
    </li>
  );
}
