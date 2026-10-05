"use client";

import { useEffect, useId, useRef, useState } from "react";

import { ShellOverlay } from "@/app/shell/overlay";
import { Button, Tag, cx } from "@/app/ui";

import {
  CLASS_VERBS,
  HISTORY_CLOSE,
  HISTORY_EMPTY,
  HISTORY_FAILED,
  HISTORY_LOADING,
  HISTORY_OLDER,
  HISTORY_TITLE,
  type HistoryResult,
  NO_NOTE,
  type PolicyVersionEntry,
  type RuleDiff,
  type RuleSide,
  SIDE_STATES,
  diffHeading,
  historyTrigger,
  previousOf,
  versionByline,
  versionDiff,
  versionTag,
} from "./card-view";

import "./policy-history.css";

/**
 * The Autonomy policies card's version tag and the history it opens
 * (BS.4, [#494](https://github.com/NobuData/ouroboros/issues/494)) — mockup 17's `policy v7`.
 *
 * **The tag earns its place by opening.** Pressed, it shows every published version, newest
 * first: who published it and when, the note they left, the audit log's line for it, and a
 * before → after of every rule it changed — drawn from the two documents with the same chips
 * the card draws (`app/policies/card-view.ts`'s `versionDiff`). So *what changed between v6 and
 * v7* is something a reader can see rather than infer, and it agrees with the audit card because
 * both state the service's own line.
 *
 * **It reads on every opening.** The history may have grown since the page was read — the
 * reader may have just published — so nothing is kept between openings, and an answer that
 * arrives after the dialog closed is dropped rather than drawn into the next one.
 *
 * **A workspace that has published nothing has nothing to open**, so its tag is text.
 */

/** What the tag takes. */
export interface PolicyVersionTagProps {
  /** The version in force, or `null` when nothing is published. */
  readonly version: number | null;
  /**
   * Read a page of history, newest first — the first page, or the one before a version.
   * A Server Action in the app; a test passes its own.
   */
  readonly loadHistory: (before?: number) => Promise<HistoryResult>;
}

/** The marker on the version the workspace is running. */
export const IN_FORCE = "in force";

/** The failed read's retry button. */
export const HISTORY_RETRY = "Try again";

/** The older-versions button while its page is being read. */
export const HISTORY_OLDER_LOADING = "Reading older versions…";

/** What a version that changed no rule says where its diff would be. */
export const NO_RULE_CHANGES = "No rule changed in this version.";

/** What stands where a rule's *before* would be while the version before it is not loaded. */
export const LOAD_OLDER_TO_COMPARE = "Show older versions to compare with the version before.";

/** The two sides' labels. */
export const BEFORE = "Before";
export const AFTER = "After";

/** What a side with no terms says where its chips would be. */
export const NO_TERMS = "no conditions";

/** Where a read stands. */
type Phase = "loading" | "ready" | "failed";

/** What the dialog holds for one opening. */
interface HistoryState {
  /** Where the first page's read stands. */
  readonly phase: Phase;
  /** The versions loaded so far, newest first. */
  readonly items: readonly PolicyVersionEntry[];
  /** The `before` that reads the next page, or `null` when there is none. */
  readonly nextBefore: number | null;
  /** Why the last read failed, or `null`. */
  readonly failure: string | null;
  /** Whether an older page is being read. */
  readonly loadingOlder: boolean;
}

/** An opening that has asked and not been answered. */
const LOADING: HistoryState = {
  phase: "loading",
  items: [],
  nextBefore: null,
  failure: null,
  loadingOlder: false,
};

/**
 * The version tag.
 *
 * @param props See {@link PolicyVersionTagProps}.
 * @returns The tag — a button opening the history when a version is in force, text otherwise.
 */
export function PolicyVersionTag({ version, loadHistory }: PolicyVersionTagProps) {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<HistoryState>(LOADING);
  /**
   * Which read's answer may still be drawn. Every opening, close and unmount moves it on, so an
   * answer to an earlier question finds a different number and is dropped.
   */
  const current = useRef(0);
  /** A latch as well as the state: two presses inside one frame both read "not loading". */
  const busy = useRef(false);

  // An answer that arrives after the card is gone has nowhere to be drawn.
  useEffect(
    () => () => {
      current.current += 1;
    },
    [],
  );

  if (version === null) return <Tag>{versionTag(null)}</Tag>;

  /**
   * Read a page and fold it in — unless the opening it was asked for is over.
   *
   * @param before The version to read older than; omitted, the first page.
   */
  function load(before?: number): void {
    if (busy.current) return;

    const asked = current.current;
    busy.current = true;

    void loadHistory(before)
      .catch((): HistoryResult => ({ ok: false, reason: HISTORY_FAILED }))
      .then((result) => {
        if (asked !== current.current) return;

        busy.current = false;
        setHistory((now) => {
          if (!result.ok) {
            return {
              ...now,
              phase: before === undefined ? "failed" : now.phase,
              failure: result.reason === "" ? HISTORY_FAILED : result.reason,
              loadingOlder: false,
            };
          }

          return {
            phase: "ready",
            items: before === undefined ? result.page.items : [...now.items, ...result.page.items],
            nextBefore: result.page.nextBefore,
            failure: null,
            loadingOlder: false,
          };
        });
      });
  }

  /** Open the dialog and read the first page afresh. */
  function show(): void {
    current.current += 1;
    busy.current = false;
    setHistory(LOADING);
    setOpen(true);
    load();
  }

  /** Close the dialog, abandoning any read still in flight. */
  function close(): void {
    current.current += 1;
    busy.current = false;
    setOpen(false);
  }

  /** Ask for the first page again after a failure. */
  function retry(): void {
    setHistory(LOADING);
    load();
  }

  /** Read the page before the oldest version loaded. */
  function older(): void {
    if (history.nextBefore === null || busy.current) return;

    setHistory((now) => ({ ...now, failure: null, loadingOlder: true }));
    load(history.nextBefore);
  }

  return (
    <>
      <button
        aria-haspopup="dialog"
        aria-label={historyTrigger(version)}
        className={cx("ou-tag", "policy-history__trigger")}
        onClick={show}
        type="button"
      >
        {versionTag(version)}
      </button>

      <ShellOverlay label={HISTORY_TITLE} onClose={close} open={open}>
        <div className="policy-history">
          <h2 className="shell-overlay__title">{HISTORY_TITLE}</h2>

          {history.phase === "loading" && (
            <p className="policy-history__state" role="status">
              {HISTORY_LOADING}
            </p>
          )}

          {history.phase === "failed" && (
            <div className="policy-history__failed">
              <p className="policy-history__error" role="alert">
                {history.failure}
              </p>
              <Button onClick={retry} size="sm">
                {HISTORY_RETRY}
              </Button>
            </div>
          )}

          {history.phase === "ready" && history.items.length === 0 && (
            <p className="policy-history__state" role="status">
              {HISTORY_EMPTY}
            </p>
          )}

          {history.phase === "ready" && history.items.length > 0 && (
            <ol className="policy-history__list">
              {history.items.map((entry) => (
                <VersionEntry
                  entry={entry}
                  inForce={entry.version === version}
                  key={entry.version}
                  previous={previousOf(history.items, entry.version)}
                />
              ))}
            </ol>
          )}

          {history.phase === "ready" && history.failure !== null && (
            <p className="policy-history__error" role="alert">
              {history.failure}
            </p>
          )}

          <div className="policy-history__actions">
            {history.phase === "ready" && history.nextBefore !== null && (
              <Button
                onClick={older}
                reason={history.loadingOlder ? HISTORY_OLDER_LOADING : undefined}
              >
                {history.loadingOlder ? HISTORY_OLDER_LOADING : HISTORY_OLDER}
              </Button>
            )}
            <Button onClick={close} tone="ghost">
              {HISTORY_CLOSE}
            </Button>
          </div>
        </div>
      </ShellOverlay>
    </>
  );
}

/**
 * One version: its heading, byline, note, audit line and diff.
 *
 * @param props.entry The version.
 * @param props.previous The version before it, or `null` when it is the first or not loaded.
 * @param props.inForce Whether it is the version the workspace is running.
 * @returns The list item.
 */
function VersionEntry({
  entry,
  previous,
  inForce,
}: Readonly<{ entry: PolicyVersionEntry; previous: PolicyVersionEntry | null; inForce: boolean }>) {
  const headingId = useId();
  const diff = versionDiff(entry, previous);

  return (
    <li aria-labelledby={headingId} className="policy-history__entry">
      <div className="policy-history__head">
        <h3 className="policy-history__version" id={headingId}>
          v{entry.version}
        </h3>
        {inForce && <Tag>{IN_FORCE}</Tag>}
        <span className="policy-history__byline">{versionByline(entry)}</span>
      </div>

      {entry.changeNote === null || entry.changeNote === "" ? (
        <p className={cx("policy-history__note", "policy-history__note--none")}>{NO_NOTE}</p>
      ) : (
        <p className="policy-history__note">
          <q>{entry.changeNote}</q>
        </p>
      )}

      <p className="policy-history__line">{entry.summary}</p>

      <div className="policy-history__diff">
        <h4 className="policy-history__diff-title">{diffHeading(entry.version)}</h4>
        {diff.length === 0 ? (
          <p className="policy-history__state">{NO_RULE_CHANGES}</p>
        ) : (
          <ul className="policy-history__rules">
            {diff.map((rule) => (
              <RuleChangeRow key={rule.ruleId} rule={rule} />
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

/**
 * One changed rule: its name, which way it moved in words, and both sides.
 *
 * @param props.rule The rule's diff.
 * @returns The list item.
 */
function RuleChangeRow({ rule }: Readonly<{ rule: RuleDiff }>) {
  return (
    <li className="policy-history__rule">
      <p className="policy-history__rule-head">
        <span className="policy-history__rule-name">{rule.name}</span>{" "}
        <span
          className={cx(
            "policy-history__class",
            rule.classification === "loosening" && "policy-history__class--loosening",
          )}
        >
          {CLASS_VERBS[rule.classification]}
        </span>{" "}
        <span className="policy-history__summary">— {rule.summary}</span>
      </p>

      <dl className="policy-history__sides">
        {rule.before === null ? (
          <div className="policy-history__side">
            <dt className="policy-history__side-label">{BEFORE}</dt>
            <dd className={cx("policy-history__side-value", "policy-history__byline")}>
              {LOAD_OLDER_TO_COMPARE}
            </dd>
          </div>
        ) : (
          <Side label={BEFORE} side={rule.before} />
        )}
        <Side label={AFTER} side={rule.after} />
      </dl>
    </li>
  );
}

/**
 * One side of a rule's diff: its state in words, then its terms chips.
 *
 * @param props.label `Before` or `After`.
 * @param props.side The side.
 * @returns The term and its description.
 */
function Side({ label, side }: Readonly<{ label: string; side: RuleSide }>) {
  return (
    <div className="policy-history__side">
      <dt className="policy-history__side-label">{label}</dt>
      <dd className="policy-history__side-value">
        <span className="policy-history__side-state">{SIDE_STATES[side.state]}</span>
        {side.state !== "absent" &&
          (side.chips.length === 0 ? (
            <span className="policy-history__byline">{NO_TERMS}</span>
          ) : (
            side.chips.map((chip) => <Tag key={chip}>{chip}</Tag>)
          ))}
      </dd>
    </div>
  );
}
