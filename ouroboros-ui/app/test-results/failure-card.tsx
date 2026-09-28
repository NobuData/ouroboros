"use client";

import { type KeyboardEvent, useId } from "react";

import type { TestCaseFailureDetail } from "@/app/api/test-results";
import { Card, CardHead, Chip, Eyebrow, RetryBanner, Tag } from "@/app/ui";
import { cx } from "@/app/ui/class-names";

import {
  AI_SLOT_BODY,
  AI_SLOT_TITLE,
  AI_TRIAGE_EYEBROW,
  CONFIDENCE_PREFIX,
  FAILURE_STALE_HEADLINE,
  FAILURE_TITLE,
  FAILURE_UNREAD_HEADLINE,
  type FailureScope,
  HEURISTIC_CHIP,
  LOG_LABEL,
  type LogLineView,
  NEXT_FAILURE,
  NO_HINT,
  NO_LOG,
  PAGER_LABEL,
  PATH_LABEL,
  PREVIOUS_FAILURE,
  type PagerView,
  READING_FAILURE,
  READING_FAILURES,
  READING_HINT,
  RULE_PREFIX,
  TRIAGE_EYEBROW,
  type TriageView,
  logLines,
  pagerStep,
  pagerView,
  pathLine,
} from "./failure";

/**
 * The pager — the mockup's `1 of 1` pill, with the two buttons that move it when the scope holds
 * several failures.
 *
 * A button at an end is `aria-disabled` rather than `disabled`, so it keeps the focus it had
 * when the pager arrived there. The arrow keys, Home and End move the pager from either button.
 *
 * @param props.pager The pager, from `pagerView`.
 * @param props.onPage Bind the card to a failure, by its case's id.
 * @param props.onKeyDown A key was pressed on one of the buttons.
 * @returns The pill, between its buttons when there is somewhere to go.
 */
function Pager({
  pager,
  onPage,
  onKeyDown,
}: Readonly<{
  pager: PagerView;
  onPage: (caseId: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}>) {
  const count = (
    <Chip tone="err">
      <span aria-label={pager.label} role="img">
        {pager.text}
      </span>
    </Chip>
  );

  if (!pager.paged) return count;

  return (
    <div aria-label={PAGER_LABEL} className="tests-failure__pager" role="group">
      <button
        aria-disabled={pager.previous === null}
        aria-label={PREVIOUS_FAILURE}
        className="tests-failure__page"
        onClick={() => pager.previous !== null && onPage(pager.previous)}
        onKeyDown={onKeyDown}
        type="button"
      >
        ‹
      </button>
      {count}
      <button
        aria-disabled={pager.next === null}
        aria-label={NEXT_FAILURE}
        className="tests-failure__page"
        onClick={() => pager.next !== null && onPage(pager.next)}
        onKeyDown={onKeyDown}
        type="button"
      >
        ›
      </button>
    </div>
  );
}

/**
 * The log block — the mockup's `.code`.
 *
 * **The log is drawn as text and nothing else.** It is the runner's bytes, so each line is a text
 * node in a `<pre>`: markup in a log is characters on the screen, never elements in the page.
 * The block scrolls inside itself, both ways, and takes focus so the keyboard can scroll it.
 *
 * @param props.lines The lines, from `logLines`.
 * @returns The block.
 */
function LogBlock({ lines }: Readonly<{ lines: readonly LogLineView[] }>) {
  return (
    <pre aria-label={LOG_LABEL} className="tests-failure__log" role="group" tabIndex={0}>
      {lines.map((line) => (
        <span
          className={cx("tests-failure__line", line.tone === "err" && "tests-failure__line--err")}
          data-tone={line.tone}
          key={line.index}
        >
          {line.segments.map((segment, at) =>
            segment.figure ? (
              <span className="tests-failure__figure" key={at}>
                {segment.text}
              </span>
            ) : (
              segment.text
            ),
          )}
          {"\n"}
        </span>
      ))}
    </pre>
  );
}

/**
 * The designed empty slot: where a model's narrative arrives with the provider stack
 * ([#343](https://github.com/NobuData/ouroboros/issues/343)). Not a spinner and not a
 * placeholder — it says what is coming, and nothing that has not happened.
 *
 * @returns The slot.
 */
function NarrativeSlot() {
  return (
    <div className="tests-failure__slot">
      <p className="tests-failure__slot-title">{AI_SLOT_TITLE}</p>
      <p className="tests-failure__slot-body">{AI_SLOT_BODY}</p>
    </div>
  );
}

/**
 * The triage section.
 *
 * **A confidence and a model pill are drawn in one branch only** — `triage.kind === "model"` —
 * and `triageView` builds that variant only from an answer whose actor is `model`. Every other
 * branch has no such field to draw.
 *
 * @param props.triage The section, from `triageView`.
 * @returns The section: a model's narrative with its pill and confidence, or the heuristic hint
 *   with its rule and its chip above the designed slot.
 */
function Triage({ triage }: Readonly<{ triage: TriageView }>) {
  if (triage.kind === "model") {
    return (
      <section
        aria-label={AI_TRIAGE_EYEBROW}
        className="tests-failure__triage"
        data-actor="model"
      >
        <Eyebrow tone="quiet">{AI_TRIAGE_EYEBROW}</Eyebrow>
        <p className="tests-failure__narrative">{triage.narrative}</p>
        {(triage.model !== null || triage.confidence !== null) && (
          <div className="tests-failure__provenance">
            {triage.model !== null && (
              <Chip mono tone="model">
                {triage.model}
              </Chip>
            )}
            {triage.confidence !== null && (
              <span className="tests-failure__confidence">
                {CONFIDENCE_PREFIX} {triage.confidence}
              </span>
            )}
          </div>
        )}
      </section>
    );
  }

  return (
    <section
      aria-label={TRIAGE_EYEBROW}
      className="tests-failure__triage"
      data-actor={triage.kind === "heuristic" ? "heuristic" : undefined}
    >
      <Eyebrow tone="quiet">{TRIAGE_EYEBROW}</Eyebrow>

      {triage.kind === "reading" && <p className="tests-failure__note">{READING_HINT}</p>}
      {triage.kind === "unread" && <p className="tests-failure__note">{triage.reason}</p>}
      {triage.kind === "none" && <p className="tests-failure__note">{NO_HINT}</p>}

      {triage.kind === "heuristic" && (
        <>
          <div className="tests-failure__hint">
            <Chip>{HEURISTIC_CHIP}</Chip>
            <span className="tests-failure__rule" title={triage.ruleId ?? undefined}>
              {RULE_PREFIX} {triage.rule}
            </span>
          </div>
          {triage.reason !== null && <p className="tests-failure__reason">{triage.reason}</p>}
        </>
      )}

      <NarrativeSlot />
    </section>
  );
}

/** What the card is told. */
export interface FailureCardProps {
  /** The failures in scope, from `failureScope` — or `null` while the page has not been read. */
  readonly scope: FailureScope | null;
  /** The bound failure's index, from `boundIndex`; `-1` when there is none. */
  readonly index: number;
  /** The tag that names the attempt — `build 3`. */
  readonly build: string;
  /** Bind the card to another failure in scope, by its case's id. */
  readonly onPage: (caseId: string) => void;
  /** The bound case's failure payload, or `null` while it has not been read. */
  readonly failure: TestCaseFailureDetail | null;
  /** Why the failure could not be read or refreshed, or `null`. */
  readonly error: string | null;
  /** Read the failure again. */
  readonly onRetry: () => void;
  /** The triage section, from `triageView`. */
  readonly triage: TriageView;
}

/**
 * The failure-detail card ([#339](https://github.com/NobuData/ouroboros/issues/339)) — mockup
 * 11's card: the `1 of N` pill and the build's tag, the test's path, the rig's log block, and the
 * triage section.
 *
 * **It is bound by the page's selections.** The screen hands it the failures the suites card and
 * the physical-tests card leave in scope; the pager moves among them and changes neither
 * selection.
 *
 * **The path and the log scroll inside their own wrappers** — the path sideways on one line, the
 * log both ways — so a long path or a wide log never moves the pane or breaks the card.
 *
 * **The triage section tells the truth about what the product knows**: see `failure.ts`.
 *
 * Every value is `failure.ts`'s; this file only draws.
 *
 * @param props See {@link FailureCardProps}.
 * @returns The card.
 */
export function FailureCard({
  scope,
  index,
  build,
  onPage,
  failure,
  error,
  onRetry,
  triage,
}: FailureCardProps) {
  const titleId = useId();
  const entries = scope?.entries ?? [];
  const pager = pagerView(entries, index);
  const lines = failure === null ? [] : logLines(failure);

  /**
   * Move the pager with the arrow keys, Home and End.
   *
   * @param event The key press, on one of the pager's buttons.
   */
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    const target = pagerStep(event.key, index, entries.length);
    const entry = target === null ? undefined : entries[target];
    if (entry === undefined) return;

    event.preventDefault();
    onPage(entry.caseId);
  }

  return (
    <Card aria-labelledby={titleId} as="section" className="tests-failure">
      <CardHead
        beside={
          pager === null ? undefined : <Pager onKeyDown={onKeyDown} onPage={onPage} pager={pager} />
        }
        title={FAILURE_TITLE}
        titleId={titleId}
        trailing={<Tag>{build}</Tag>}
      />

      {scope === null && <p className="tests-failure__note">{READING_FAILURES}</p>}
      {scope !== null && scope.note !== null && <p className="tests-failure__note">{scope.note}</p>}

      {pager !== null && (
        <>
          {error !== null && (
            <RetryBanner
              className="tests-failure__banner"
              headline={failure === null ? FAILURE_UNREAD_HEADLINE : FAILURE_STALE_HEADLINE}
              onRetry={onRetry}
              reason={error}
            />
          )}

          {failure === null && error === null && (
            <p className="tests-failure__note" role="status">
              {READING_FAILURE}
            </p>
          )}

          {failure !== null && (
            <>
              {/* Focusable so the keyboard can scroll it. */}
              <div
                aria-label={PATH_LABEL}
                className="tests-failure__path"
                role="group"
                tabIndex={0}
              >
                {pathLine(failure)}
              </div>
              {lines.length === 0 ? (
                <p className="tests-failure__note">{NO_LOG}</p>
              ) : (
                <LogBlock lines={lines} />
              )}
            </>
          )}

          <Triage triage={triage} />
        </>
      )}
    </Card>
  );
}
