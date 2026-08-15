import type { Dashboard } from "@/app/api/dashboard";
import { Button, Card, CardHead, EffortChip, EmptyState, Tag } from "@/app/ui";

import { type QueuedIssue, type Reading, moreQueued, queueRows } from "./view";

/**
 * *Up next in queue* ([#85](https://github.com/NobuData/ouroboros/issues/85)) — the mockup's
 * `c-5` card, and the forward-looking half of the page.
 *
 * Every other card here reports what has happened or what is happening. This one is what the
 * loop will do next: the aggregate's `queueHead` in queue order, one row per issue, with the
 * two markers that say how big it is and which workflow will run it.
 *
 * ### A list, not a table
 *
 * The two cards beside it are tables (`app/ui/table.tsx`) because they have columns — a heading over each
 * cell that says what the figure in it means. A queue row has no columns: it is one issue, and
 * the effort chip and the workflow tag are properties *of* it rather than a second and third
 * measurement. So this is a `ul`, which is also what a screen reader is best served by — *list
 * of five items* and then five issues, rather than a five-by-three grid whose column headers
 * would have to be invented to justify the markup.
 *
 * ### What it will not do yet
 *
 * **Neither `Manage queue →` nor the `+N queued` footer navigates.** The queue screen is
 * mockup 03 and [#49](https://github.com/NobuData/ouroboros/issues/49) holds its route, which
 * is post-MVP; the design system's honesty rule (§ 3.5) and #49's own first acceptance
 * criterion (*no dead nav links*) say the same thing about pointing at it today, and the
 * sidebar already answers the same destination the same way (`app/shell/nav-modules.ts`). Both
 * are therefore inert {@link Button}s carrying the one reason — which keeps the explanation in
 * the tab order where a dropped link would take it out — and both become an `href` the day #49
 * lands.
 *
 * @param props.aggregate The dashboard aggregate, or why it could not be read.
 * @returns The card.
 */
export function QueueCard({ aggregate }: Readonly<{ aggregate: Reading<Dashboard> }>) {
  const rows = aggregate.ok ? queueRows(aggregate.value.queueHead) : [];
  // The count is the workspace's whole queue and the rows are its head, so the footer is the
  // difference between two figures that are separately true rather than a flag on the slice.
  const more = aggregate.ok ? moreQueued(aggregate.value.stats.queued.count, rows.length) : 0;

  return (
    <Card as="section" fill className="dash-col--5" aria-labelledby={TITLE_ID}>
      <CardHead
        title={TITLE}
        titleId={TITLE_ID}
        trailing={
          <Button size="sm" tone="ghost" reason={QUEUE_SCREEN_SOON}>
            {MANAGE_LABEL}
          </Button>
        }
      />

      {rows.length === 0 ? (
        <EmptyState fill {...emptyPanel(aggregate)} />
      ) : (
        <>
          <ul className="dash-queue" aria-label={LIST_LABEL}>
            {rows.map((item) => (
              <QueueRow key={item.id} item={item} />
            ))}
          </ul>
          {more > 0 && (
            <p className="dash-queue__more">
              <Button size="sm" tone="ghost" reason={QUEUE_SCREEN_SOON}>
                {`+${more} queued →`}
              </Button>
            </p>
          )}
        </>
      )}
    </Card>
  );
}

/**
 * One queued issue: what it is, then how big it is and what will run it.
 *
 * @param props.item The row, already decided in `app/dashboard/view.ts`.
 * @returns The row.
 */
function QueueRow({ item }: Readonly<{ item: QueuedIssue }>) {
  return (
    <li className="dash-queue__row">
      <span className="dash-queue__issue">
        <span className="dash-queue__number">{`#${item.issueNumber}`}</span>
        {/*
          A real space between the number and the title, which the flex gap does not supply: a
          whitespace-only text node is not laid out as a flex item, so this changes nothing on
          screen and keeps a screen reader from reading "#485Watchdog reset…" as one word. It
          is the mockup's own `&nbsp;`, in the one form that survives both layouts — and the
          same treatment the two tables give their issue cells.
        */}{" "}
        <span className="dash-queue__title">{item.issueTitle}</span>
      </span>
      <span className="dash-queue__marks">
        {/*
          `effort` is `view.ts`'s own union and this is the design system's, so the assignment
          is where the two are checked against each other. The hue is the chip's — derived from
          the size rather than passed — because an `L` that was green on one screen would make
          the scale mean nothing.
        */}
        <EffortChip effort={item.effort} />
        <Tag>{item.workflowTag}</Tag>
      </span>
    </li>
  );
}

/** What the card is called, as the mockup titles it. */
const TITLE = "Up next in queue";

/** The id the card's `aria-labelledby` points at. */
const TITLE_ID = "dash-up-next-title";

/** What the head's control is labelled. */
const MANAGE_LABEL = "Manage queue →";

/**
 * The list's own name.
 *
 * The card's heading is directly above it, but a heading outside a list is not the list's
 * accessible name — the same gap the two tables' hidden captions fill.
 */
const LIST_LABEL = "Issues waiting for a loop, in queue order";

/**
 * Why neither control on this card can act yet.
 *
 * One sentence for both, because both point at the same missing screen: two controls naming
 * one destination should not describe it two ways. It is also the sentence the sidebar's
 * `/issues` entry carries, for the same reason.
 */
const QUEUE_SCREEN_SOON =
  "The queue screen is not built yet — it arrives with its own roadmap (mockup 03), and #49 " +
  "holds its placeholder route.";

/** What the card says when nothing is waiting for a loop. */
const NOTHING_QUEUED = "Nothing is queued";

/**
 * The note under {@link NOTHING_QUEUED} — what would put a row here.
 *
 * It says what fills the card rather than apologising for the emptiness: a workspace that has
 * caught up with its own queue is a workspace that is working, not one that has failed at
 * anything. [#86](https://github.com/NobuData/ouroboros/issues/86) is where every card's empty
 * and failed states are designed together, and this is the sentence until then.
 */
const NOTHING_QUEUED_NOTE =
  "Issues waiting for a loop appear here in the order Ouroboros will pick them up, with the " +
  "size somebody put on each and the workflow that will run it.";

/**
 * What the card says when the aggregate was refused.
 *
 * It names *what* could not be read and stops there. **Why** is the page banner's, once
 * (`app/dashboard/stale-banner.tsx`) — before
 * [#86](https://github.com/NobuData/ouroboros/issues/86) the service's sentence was repeated
 * here and in eight other places on one page, which reads as nine problems rather than one
 * and buries the single retry that would fix them.
 */
const QUEUE_NOT_READ = "The queue could not be read";

/**
 * What to draw in place of the list.
 *
 * An empty queue and an aggregate that was refused are not the same fact and must not read
 * alike — the same rule the stat row's em dash is written under.
 *
 * @param aggregate The dashboard aggregate, or why it could not be read.
 * @returns The empty state's heading and note.
 */
function emptyPanel(
  aggregate: Reading<Dashboard>,
): Readonly<{ title: string; note?: string }> {
  return aggregate.ok
    ? { title: NOTHING_QUEUED, note: NOTHING_QUEUED_NOTE }
    : { title: QUEUE_NOT_READ };
}
