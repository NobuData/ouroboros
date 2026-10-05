import { Card, Eyebrow } from "@/app/ui";

import { INBOX_EYEBROW, INBOX_LOADING, INBOX_SUBLINE } from "./view";

import "./inbox.css";

/** How many decision-card shapes the skeleton draws — the seeded workspace's three. */
export const SKELETON_CARDS = 3;

/** How many side-card shapes it draws — the channels, the policies and the week. */
export const SKELETON_SIDE_CARDS = 3;

/**
 * The `/inbox` loading state (BO.5, [#470](https://github.com/NobuData/ouroboros/issues/470)).
 *
 * The frame is real — the eyebrow and the subline are known before any read — and the headline,
 * which is the service's sentence, is a bar. Under it the skeleton reserves the page's geometry:
 * the eight columns of decision cards (a question, a tag row, the why and an action row each) and
 * the four of side cards, so nothing jumps when the reads land.
 *
 * **It says one thing to a screen reader.** The `<main>` is `aria-busy` and named once; the bars
 * carry no text and are hidden from assistive technology.
 *
 * @returns The skeleton.
 */
export function InboxSkeleton() {
  return (
    <main aria-busy="true" aria-label={INBOX_LOADING} className="inbox inbox-skeleton">
      <div className="inbox__head">
        <div className="inbox__headings">
          <Eyebrow>{INBOX_EYEBROW}</Eyebrow>
          <span aria-hidden className="inbox-skeleton__bar inbox-skeleton__bar--title" />
          <p className="inbox__sub">{INBOX_SUBLINE}</p>
        </div>
        <div aria-hidden className="inbox__actions">
          <span className="inbox-skeleton__button" />
          <span className="inbox-skeleton__button" />
        </div>
      </div>
      <div aria-hidden className="inbox__grid">
        <div className="inbox__main">
          <ul className="inbox-queue__cards">
            {Array.from({ length: SKELETON_CARDS }, (_, index) => (
              <li key={index}>
                <Card className="inbox-skeleton__card">
                  <span className="inbox-skeleton__bar inbox-skeleton__bar--question" />
                  <span className="inbox-skeleton__bar inbox-skeleton__bar--short" />
                  <span className="inbox-skeleton__bar" />
                  <span className="inbox-skeleton__actions">
                    <span className="inbox-skeleton__button" />
                    <span className="inbox-skeleton__button" />
                  </span>
                </Card>
              </li>
            ))}
          </ul>
        </div>
        <div className="inbox__side">
          {Array.from({ length: SKELETON_SIDE_CARDS }, (_, index) => (
            <Card className="inbox-skeleton__card" key={index}>
              <span className="inbox-skeleton__bar inbox-skeleton__bar--short" />
              <span className="inbox-skeleton__bar" />
              <span className="inbox-skeleton__bar" />
            </Card>
          ))}
        </div>
      </div>
    </main>
  );
}
