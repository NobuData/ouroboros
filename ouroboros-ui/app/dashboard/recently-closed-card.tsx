import type { Dashboard, RunStatus } from "@/app/api/dashboard";
import {
  Button,
  Card,
  CardHead,
  Chip,
  type ChipTone,
  type Column,
  EmptyState,
  Table,
  cx,
} from "@/app/ui";

import { type Completion, type Reading, recentCompletions } from "./view";

/**
 * *Recently closed by the loop* ([#84](https://github.com/NobuData/ouroboros/issues/84)) —
 * the mockup's `c-7` table, and the card that proves the loop ships.
 *
 * The table beside it is the present tense; this one is the receipt. Five columns over the
 * aggregate's `recentRuns`, with every figure decided in `app/dashboard/view.ts` and no
 * arithmetic in the card.
 *
 * ### The honest rows are drawn exactly like the good ones
 *
 * A `needs human` row is the point of this card as much as a `merged` one is. It keeps the
 * same columns, the same type and the same weight — the outcome pill and the warn tint on a
 * short check count are the whole of the difference — because a card that tucked its
 * interventions away would be reporting a merge rate rather than a week. That is also why
 * the check fraction is tinted on the **comparison** rather than on the status: `13/14` is
 * short whatever the run went on to be called.
 *
 * ### What it will not do yet
 *
 * **`All issues →` does not navigate, and neither does a `needs human` row.** The issues
 * screen is mockup 03 and the needs-you inbox is mockup 16; `#49` holds both routes and is
 * post-MVP. The design system's honesty rule (§ 3.5) and #49's own first acceptance
 * criterion (*no dead nav links*) say the same thing about pointing at either today, and the
 * sidebar already answers it the same way for both destinations
 * (`app/shell/nav-modules.ts`). So each is an inert {@link Button} carrying its reason —
 * which keeps the explanation in the tab order where a dropped link would take it out — and
 * each becomes an `href` the day #49 lands.
 *
 * @param props.aggregate The dashboard aggregate, or why it could not be read.
 * @returns The card.
 */
export function RecentlyClosedCard({
  aggregate,
}: Readonly<{ aggregate: Reading<Dashboard> }>) {
  const rows = aggregate.ok ? recentCompletions(aggregate.value.recentRuns) : [];

  return (
    <Card as="section" fill className="dash-col--7" aria-labelledby={TITLE_ID}>
      <CardHead
        title={TITLE}
        titleId={TITLE_ID}
        trailing={
          <Button size="sm" tone="ghost" reason={ALL_ISSUES_SOON}>
            All issues →
          </Button>
        }
      />

      {rows.length === 0 ? (
        <EmptyState fill {...emptyPanel(aggregate)} />
      ) : (
        <Table
          caption={CAPTION}
          captionHidden
          className="dash-closed"
          columns={COLUMNS}
          rows={rows}
          rowKey={(run) => run.id}
        />
      )}
    </Card>
  );
}

/** What the card is called, as the mockup titles it. */
const TITLE = "Recently closed by the loop";

/** The id the card's `aria-labelledby` points at. */
const TITLE_ID = "dash-recently-closed-title";

/**
 * The table's own name, for a reader moving between the page's tables by landmark.
 *
 * Hidden, for the reason the active-loops table's is: the card's heading is directly above
 * it, and a heading outside a table is not the table's accessible name.
 */
const CAPTION = "Runs the loop has closed, newest first";

/** Why *All issues* cannot act yet. */
const ALL_ISSUES_SOON =
  "The issues screen is not built yet — it arrives with its own roadmap (mockup 03), and " +
  "#49 holds its placeholder route.";

/**
 * Why the control on a `needs human` row cannot act yet.
 *
 * The same sentence the sidebar's `/inbox` entry carries (`app/shell/nav-modules.ts`), for
 * the same destination: two places naming one missing screen should not describe it two
 * ways.
 */
const INBOX_SOON =
  "The needs-you inbox is not built yet — it arrives with its own roadmap (mockup 16), and " +
  "#49 holds its placeholder route.";

/** What the control on a `needs human` row is labelled. */
const REVIEW_LABEL = "Review →";

/** What the card says when the workspace has closed nothing. */
const NOTHING_CLOSED = "Nothing closed yet";

/**
 * The note under {@link NOTHING_CLOSED} — what would put a row here.
 *
 * It says what fills the card rather than apologising for the emptiness: a workspace between
 * its first issue and its first merge has not failed at anything.
 * [#86](https://github.com/NobuData/ouroboros/issues/86) is where every card's empty and
 * failed states are designed together, and this is the sentence until then.
 */
const NOTHING_CLOSED_NOTE =
  "Issues Ouroboros finished, and the pull requests it opened for them, appear here as soon " +
  "as the first loop closes.";

/**
 * What to draw in place of the table.
 *
 * A workspace that has closed nothing and an aggregate that was refused are not the same
 * fact and must not read alike — the same rule the stat row's em dash is written under.
 *
 * @param aggregate The dashboard aggregate, or why it could not be read.
 * @returns The empty state's heading and note.
 */
function emptyPanel(
  aggregate: Reading<Dashboard>,
): Readonly<{ title: string; note: string }> {
  return aggregate.ok
    ? { title: NOTHING_CLOSED, note: NOTHING_CLOSED_NOTE }
    : { title: "The completions could not be read", note: aggregate.reason };
}

/**
 * The hue each outcome takes — the mockup's `pill ok` and `pill warn`, plus the danger
 * treatment for the third.
 *
 * **`failed` is here although the mockup draws no failed row**, because the contract has the
 * status and a run that fails is exactly the row this card must not quietly drop. The
 * treatment is the design system's own error hue, so it needed nothing invented for it.
 *
 * The three active statuses are mapped as well, for the reason the active table maps the
 * terminal ones: a run arriving in the wrong slice is drawn in a hue that suits it rather
 * than falling through to a colour that reports an outcome it has not reached.
 */
const OUTCOME_TONE: Record<RunStatus, ChipTone> = {
  merged: "ok",
  needs_human: "warn",
  failed: "err",
  coding: "accent",
  building: "accent",
  review: "accent",
};

/**
 * What each outcome is called.
 *
 * The contract's own words, exactly as the mockup prints them; only `needs_human` needs its
 * underscore taken out, which is the same substitution the active table makes.
 */
const OUTCOME_LABEL: Record<RunStatus, string> = {
  merged: "merged",
  needs_human: "needs human",
  failed: "failed",
  coding: "coding",
  building: "building",
  review: "review",
};

/**
 * The five columns, in the mockup's order.
 *
 * Declared once at module scope rather than rebuilt per render, for {@link Table}'s sake:
 * the descriptions do not depend on the data, and a fresh array each render would be a new
 * identity for every cell renderer in it.
 */
const COLUMNS: readonly Column<Completion>[] = [
  {
    key: "pair",
    header: "Issue → PR",
    cell: (run) => (
      <span className="dash-closed__issue">
        <span className="dash-closed__pair">{run.pair}</span>
        {/*
          A real space between the pair and the title, which the flex gap does not supply: a
          whitespace-only text node is not laid out as a flex item, so this changes nothing on
          screen and keeps a screen reader from reading "#512Debounce…" as one word. It is the
          mockup's own `&nbsp;`, in the one form that survives both layouts.
        */}{" "}
        <span className="dash-closed__title">{run.issueTitle}</span>
      </span>
    ),
  },
  {
    key: "model",
    header: "Model",
    cell: (run) => (
      <Chip tone="model" mono>
        {run.model}
      </Chip>
    ),
  },
  {
    key: "cycle",
    header: "Cycle",
    align: "end",
    mono: true,
    cell: (run) => run.cycle,
  },
  {
    key: "checks",
    header: "Checks",
    align: "end",
    mono: true,
    cell: (run) => (
      // The tint is a second signal rather than the only one: the fraction already says
      // `13/14` in figures, which is what a reader who cannot separate the two hues reads.
      // The tooltip is the third, and it is the only one that says how many.
      <span
        className={cx("dash-closed__checks", run.checksShort && "dash-closed__checks--short")}
        title={run.checksNote ?? undefined}
      >
        {run.checks}
      </span>
    ),
  },
  {
    key: "outcome",
    header: "Outcome",
    cell: (run) => (
      <span className="dash-closed__outcome">
        <Chip tone={OUTCOME_TONE[run.status]}>{OUTCOME_LABEL[run.status]}</Chip>
        {run.status === "needs_human" && (
          <Button size="sm" tone="ghost" reason={INBOX_SOON}>
            {REVIEW_LABEL}
          </Button>
        )}
      </span>
    ),
  },
];
