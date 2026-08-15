import { Button, type ButtonTone, Eyebrow, cx } from "@/app/ui";

import { ActiveLoopsCard } from "./active-loops-card";
import { Greeting } from "./greeting";
import { PulseCard } from "./pulse-card";
import { QueueCard } from "./queue-card";
import { RecentlyClosedCard } from "./recently-closed-card";
import { StatCard } from "./stat-card";
import { SystemCard } from "./system-card";
import { type DashboardReadings, pageSubline, statRow, systemRows } from "./view";

import "./dashboard.css";

/**
 * The dashboard ([#80](https://github.com/NobuData/ouroboros/issues/80), over #45's route)
 * — `docs/mockups/02-dashboard.html` as a working page.
 *
 * It renders **inside the app shell**, so it starts at its page head and contributes no
 * chrome of its own (`docs/DESIGN_SYSTEM_APP_SHELL.md` § 2). The shell's content pane is
 * the scroll container and already holds the 1440px measure; this holds the gutter rhythm,
 * the page head, and the twelve-column grid the mockup lays its cards on.
 *
 * It is a component rather than markup written in the route, for the reason the app shell
 * and the login screen are: everything it draws can then be rendered and asserted on
 * without Next.js's routing around it. The route reads (`app/dashboard/data.ts`), a pure
 * module decides (`app/dashboard/view.ts`), and this draws.
 *
 * ### The page head carries the two pieces of page-level truth
 *
 * *Who is looking* is the greeting, and it is the one client-rendered thing on the page
 * because it needs the reader's own clock (decision F7 — `app/dashboard/greeting.tsx`).
 * *What the loop is doing right now* is the subline, composed from the aggregate's
 * `activity` ([#70](https://github.com/NobuData/ouroboros/issues/70)); an aggregate that
 * could not be read puts the service's reason there rather than an empty workspace.
 *
 * ### What is real here and what is not
 *
 * Two kinds of card sit on the same grid, and the difference is the point of this screen:
 *
 * - **Read.** The stat row is drawn from the aggregate's `stats`
 *   ([#81](https://github.com/NobuData/ouroboros/issues/81)), the active-loops table from its
 *   `activeRuns` ([#82](https://github.com/NobuData/ouroboros/issues/82)), the loop pulse from
 *   its `pulse` ([#83](https://github.com/NobuData/ouroboros/issues/83)), the completions
 *   table from its `recentRuns` ([#84](https://github.com/NobuData/ouroboros/issues/84)), the
 *   queue card from its `queueHead`
 *   ([#85](https://github.com/NobuData/ouroboros/issues/85)), and the system card from
 *   `/health/ready` and `/api/v1/engine/status`. Every figure on them came from the service,
 *   and a figure that could not be read is an em dash beside the reason rather than a zero.
 *   **Every panel of the mockup now has a card drawing it from data** — nothing on this screen
 *   is a copy of the mockup's own rows.
 * - **Written.** One control on the whole page changes anything: the pulse card's auto-merge
 *   switch, which is [#74](https://github.com/NobuData/ouroboros/issues/74)'s operation and
 *   the workspace's own setting rather than a preference of this browser's. It is the only
 *   reason this screen's card list includes a Client Component that writes.
 *
 * @param props.readings Everything the reader was able to read, and why not for the rest.
 * @returns The screen.
 */
export function DashboardScreen({
  readings,
}: Readonly<{ readings: DashboardReadings }>) {
  const { aggregate, user } = readings;
  const subline = pageSubline(aggregate);

  return (
    <main className="dash">
      <div className="dash__head">
        <div className="dash__headings">
          <Eyebrow>Mission Control</Eyebrow>
          <Greeting
            displayName={user.displayName}
            activity={aggregate.ok ? aggregate.value.activity : null}
          />
          <p className={cx("dash__sub", subline.failed && "dash__sub--failed")}>
            {subline.text}
          </p>
        </div>
        <div className="dash__actions">
          {ACTIONS.map((action) => (
            <Button key={action.id} tone={action.tone} reason={action.why}>
              {action.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="dash-grid">
        {statRow(aggregate).map((stat) => (
          <StatCard key={stat.id} stat={stat} />
        ))}

        <ActiveLoopsCard aggregate={aggregate} readAt={readings.readAt} />
        <PulseCard aggregate={aggregate} workspace={readings.workspace} />
        <SystemCard rows={systemRows(readings.readiness, readings.engine)} />
        <RecentlyClosedCard aggregate={aggregate} />
        <QueueCard aggregate={aggregate} />
      </div>
    </main>
  );
}

/** One of the page head's two actions. */
interface Action {
  /** Stable identifier, and the React key. */
  readonly id: string;
  /** What the control says. */
  readonly label: string;
  /** Which of the button treatments it takes. */
  readonly tone: Extract<ButtonTone, "ghost" | "primary">;
  /**
   * Why it cannot act yet — its tooltip, and the whole of its honesty. Passing it to
   * {@link Button} as `reason` is what makes the control inert: there is no way to switch
   * one off in this product without saying what is missing.
   */
  readonly why: string;
}

/**
 * The mockup's two page-head actions, both inert.
 *
 * **#80 asks that these navigate to their [#49](https://github.com/NobuData/ouroboros/issues/49)
 * placeholders, and #49 has not landed** — it is post-MVP, and it is nineteen routes rather
 * than these two. So the treatment #45 shipped stands: both render *labelled* rather than
 * absent or linked to a `404`, which is what the sidebar already does for the same two
 * destinations (`app/shell/nav-modules.ts` marks `/issues` and `/workflows` `soon`) and
 * what #49 itself exists to prevent — "no dead nav links" is its first acceptance criterion.
 * Linking to a route nobody has written would satisfy the letter of this one by breaking
 * the other. The moment #49 lands, each `why` below becomes an `href`.
 *
 * `aria-disabled` rather than `disabled`, deliberately: a disabled button leaves the tab
 * order and takes its own explanation with it, so the keyboard reader who most needs the
 * tooltip is the one who can never reach it.
 *
 * **Neither fakes an outcome**, which is the half of the criterion that is about honesty
 * rather than about routing. "Pull next issue" is a real action against a queue whose intake
 * does not exist; a button that appeared to do it would be the one dishonest control on a
 * screen built to be honest. Real pull behaviour belongs to mockup 03's roadmap — link, do
 * not fake.
 */
const ACTIONS: readonly Action[] = [
  {
    id: "edit-workflows",
    label: "Edit workflows",
    tone: "ghost",
    why:
      "The workflow builder is not built yet — it arrives with its own roadmap (mockup 04), " +
      "and #49 holds its placeholder route.",
  },
  {
    id: "pull-next",
    label: "⟳ Pull next issue",
    tone: "primary",
    why:
      "Issue intake is not built yet — it arrives with its own roadmap (mockup 03), and " +
      "#49 holds its placeholder route.",
  },
];

