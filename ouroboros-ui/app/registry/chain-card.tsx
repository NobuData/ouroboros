"use client";

import { useEffect, useRef, useState } from "react";

import { Button, Card, CardHead, EmptyState, Tag, cx } from "@/app/ui";

import {
  CHAIN_CAPTION,
  CHAIN_EMPTY_NOTE,
  CHAIN_EMPTY_TITLE,
  CHAIN_TITLE,
  RUN_CONSOLE_SOON,
  UNROUTED_TITLE,
  type ChainReading,
  type ChainTag,
  type ChainTone,
  type ChainView,
  type RouteLookup,
  chainKey,
  chainLoading,
  chainTag,
  chainView,
  taskArgument,
  unroutedReasons,
} from "./chain";
import { readChain } from "./chain-actions";
import type { TableRow } from "./table";

import "./registry.css";

/**
 * Mockup 21's **RESOLUTION CHAIN** card
 * ([#595](https://github.com/NobuData/ouroboros/issues/595)) — the proof that aliases resolve,
 * for whichever alias the table has selected (#592).
 *
 * `route.task("implement")` → route → **alias** (accent) → provider with its masked key suffix
 * → **model** (violet) with `● resolved · 42ms`, on a dotted rail. Where the rail came from is
 * decided in `app/registry/chain-actions.ts` and what it draws in `app/registry/chain.ts`; this
 * file holds the two things a pure module cannot — which alias is being asked about, and the
 * answers already read.
 *
 * ### The head's tag is the honesty
 *
 * A stored run shows `run #482`, drawn as the #46 Button's **inert** form with the reason it
 * cannot act: the run console has no route yet, and a link to a page that does not exist would
 * be the kind of stub that lies. A simulated chain carries
 * `simulated — live runs arrive with invocation` in the same place and **never** a run number.
 *
 * ### Answers are held, and a write asks again
 *
 * Arrowing through the table would otherwise ask the same question eight times, so each answer
 * is kept under `chainKey` — which carries the alias's switch and binding. Turning an alias off
 * refreshes the page, the row arrives with `enabled: false`, the key changes, and the card asks
 * again: re-viewing a disabled alias shows the dropped hop rather than the chain it had.
 *
 * @param props.row The selected row, or `null` when nothing is selected.
 * @param props.route What the page knows about the routes naming the alias, or `null` with no
 *   selection.
 * @returns The card.
 */
export function ChainCard({
  row,
  route,
}: Readonly<{ row: TableRow | null; route: RouteLookup | null }>) {
  const key = row === null || route === null ? null : chainKey(row, route);
  const [answers, setAnswers] = useState<Readonly<Record<string, ChainReading>>>({});

  // What has been asked, so a re-render while an answer is on its way does not ask twice.
  const asked = useRef(new Set<string>());

  useEffect(() => {
    if (key === null || row === null || route === null || asked.current.has(key)) return;

    asked.current.add(key);
    void readChain(row.alias, route).then((reading) => {
      setAnswers((held) => ({ ...held, [key]: reading }));
    });
  }, [key, row, route]);

  const reading = key === null ? undefined : answers[key];

  return (
    <Card aria-labelledby={CHAIN_TITLE_ID} as="section" fill>
      <CardHead
        title={CHAIN_TITLE}
        titleId={CHAIN_TITLE_ID}
        trailing={
          reading?.ok && reading.source.kind !== "unrouted" ? (
            <ChainTagView tag={chainTag(reading.source)} />
          ) : undefined
        }
      />
      <ChainBody reading={reading} row={row} />
    </Card>
  );
}

/**
 * The head's tag.
 *
 * @param props.tag The tag `chainTag` decided.
 * @returns A stored run as the inert #46 Button carrying why it cannot open the run console
 *   yet; a simulation as a plain tag with the simulated label.
 */
function ChainTagView({ tag }: Readonly<{ tag: ChainTag }>) {
  return tag.kind === "run" ? (
    <Button reason={RUN_CONSOLE_SOON} size="sm" tone="ghost">
      {tag.label}
    </Button>
  ) : (
    <Tag>{tag.label}</Tag>
  );
}

/**
 * Everything under the head, in each state the card can be in.
 *
 * @param props.row The selected row, or `null`.
 * @param props.reading The answer for it, or `undefined` while it is on its way.
 * @returns The body.
 */
function ChainBody({
  row,
  reading,
}: Readonly<{ row: TableRow | null; reading: ChainReading | undefined }>) {
  if (row === null) return <EmptyState fill note={CHAIN_EMPTY_NOTE} title={CHAIN_EMPTY_TITLE} />;

  if (reading === undefined) {
    return (
      <p className="registry-chain__state" role="status">
        {chainLoading(row.alias)}
      </p>
    );
  }

  if (!reading.ok) {
    return (
      <p className="registry-chain__failure" role="status">
        {reading.reason}
      </p>
    );
  }

  if (reading.source.kind === "unrouted") {
    return (
      <div className="registry-chain__unrouted">
        <p className="registry-chain__unrouted-title">{UNROUTED_TITLE}</p>
        {unroutedReasons(row).map((reason) => (
          <p className="registry-chain__reason" key={reason}>
            {reason}
          </p>
        ))}
      </div>
    );
  }

  return <ChainRail view={chainView(row.alias, reading.source)} />;
}

/** The modifier each status tone adds to the rail's last hop. Written out so the sheet's suite finds each. */
const TONE_CLASS: Record<ChainTone, string> = {
  ok: "registry-chain__hop--ok",
  err: "registry-chain__hop--err",
  neutral: "registry-chain__hop--neutral",
};

/**
 * The rail, the sentence under it, and the caption.
 *
 * The rail scrolls inside its own wrapper: hops are single mono lines, a long model id is a
 * long line, and the pane refuses horizontal scroll — so the wrapper takes it rather than the
 * page. The sentences sit outside the wrapper so they wrap.
 *
 * @param props.view What to draw.
 * @returns The rail.
 */
function ChainRail({ view }: Readonly<{ view: ChainView }>) {
  const status = (
    <span className="registry-chain__status">
      <span aria-hidden="true" className="registry-chain__dot" />
      {view.status.label}
    </span>
  );

  return (
    <>
      <div className="registry-chain__scroll">
        <ol
          aria-label={CHAIN_TITLE}
          className={cx("registry-chain", view.hop?.dropped && "registry-chain--dropped")}
        >
          <li className="registry-chain__hop">
            <span className="registry-chain__key">route.task(</span>
            {taskArgument(view.taskKind)}
            <span className="registry-chain__key">)</span>
          </li>
          <li className="registry-chain__hop">
            <Arrow />
            <span className="registry-chain__key">route</span> {view.routeTag}
          </li>
          <li className={cx("registry-chain__hop", view.hop === null && TONE_CLASS[view.status.tone])}>
            <Arrow />
            <span className="registry-chain__key">alias</span>{" "}
            <span className="registry-chain__alias">{view.alias}</span>
            {view.hop === null && status}
          </li>
          {view.hop !== null && (
            <>
              <li className="registry-chain__hop">
                <Arrow />
                <span className="registry-chain__key">provider</span>{" "}
                <span className="registry-chain__provider">{view.hop.provider}</span>
                {view.hop.keyLabel !== null && (
                  <>
                    {" "}
                    <span className="registry-chain__key">{view.hop.keyLabel}</span>
                  </>
                )}
              </li>
              <li className={cx("registry-chain__hop", TONE_CLASS[view.status.tone])}>
                <Arrow />
                <span className="registry-chain__key">model</span>{" "}
                <span className="registry-chain__model">{view.hop.modelId}</span>
                {status}
              </li>
            </>
          )}
        </ol>
      </div>

      {view.explanation !== null && <p className="registry-chain__explanation">{view.explanation}</p>}
      {view.failure !== null && <p className="registry-chain__failure">{view.failure}</p>}

      <p className="registry-chain__caption">{CHAIN_CAPTION}</p>
    </>
  );
}

/**
 * The mockup's `→` before every hop after the first. Decoration: the list's order says it.
 *
 * @returns The arrow.
 */
function Arrow() {
  return (
    <span aria-hidden="true" className="registry-chain__arrow">
      →
    </span>
  );
}

/** The id the card's `aria-labelledby` points at. */
const CHAIN_TITLE_ID = "registry-chain-title";
