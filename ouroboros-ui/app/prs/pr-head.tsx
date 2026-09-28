import Link from "next/link";
import type { ReactNode } from "react";

import { Chip, Eyebrow, Tag } from "@/app/ui";

import type { PrHeadView, TagLink } from "./view";

/** What separates the tag's two halves — the mockup's `loop #1847 · issue #482`. */
const TAG_SEPARATOR = " · ";

/**
 * One half of the loop and issue tag.
 *
 * @param props.link The half, from `loopLink` or `issueLink`.
 * @returns A link inside the application, a link that leaves it, or plain text when there is
 *   nowhere honest to lead.
 */
function TagHalf({ link }: Readonly<{ link: TagLink }>) {
  if (link.href === null) return <span>{link.label}</span>;

  return link.external ? (
    <a className="prv-head__link" href={link.href} rel="noopener noreferrer" target="_blank">
      {link.label}
    </a>
  ) : (
    <Link className="prv-head__link" href={link.href}>
      {link.label}
    </Link>
  );
}

/**
 * The PR verification page head ([#363](https://github.com/NobuData/ouroboros/issues/363)) —
 * mockup 12's eyebrow, headline and meta row.
 *
 * The meta row is the mockup's four elements in the mockup's order: the loop and issue tag, both
 * halves linked so the page is never a dead end; the aggregate pill, coloured by the PR's state;
 * the branches; and the counts. Every value is `view.ts`'s; this file only draws.
 *
 * The headline links to the PR on its host when the payload's URL is one a link may carry, and
 * is plain text otherwise.
 *
 * @param props.view The head, from `prHead`.
 * @param props.actions The actions to draw beside the head, or nothing.
 * @returns The head.
 */
export function PrHead({
  view,
  actions = null,
}: Readonly<{ view: PrHeadView; actions?: ReactNode }>) {
  return (
    <div className="prv-head">
      <div className="prv-head__main">
        <Eyebrow>{view.eyebrow}</Eyebrow>
        <h1 className="prv-head__title">
          {view.hostUrl === null ? (
            view.headline
          ) : (
            <a
              className="prv-head__link"
              href={view.hostUrl}
              rel="noopener noreferrer"
              target="_blank"
            >
              {view.headline}
            </a>
          )}
        </h1>

        <div className="prv-head__meta">
          {(view.loop !== null || view.issue !== null) && (
            <Tag>
              {/*
                One child, so the tag's flex box has one item: as siblings, the separator would be
                an anonymous flex item of its own and lose the spaces on either side of its dot.
              */}
              <span>
                {view.loop !== null && <TagHalf link={view.loop} />}
                {view.loop !== null && view.issue !== null && TAG_SEPARATOR}
                {view.issue !== null && <TagHalf link={view.issue} />}
              </span>
            </Tag>
          )}
          <Chip dot={view.pill.dot} tone={view.pill.tone}>
            {view.pill.label}
          </Chip>
          <Tag>{view.branches}</Tag>
          <span className="prv-head__mono">{view.counts}</span>
        </div>
      </div>
      {actions !== null && <div className="prv-head__actions">{actions}</div>}
    </div>
  );
}
