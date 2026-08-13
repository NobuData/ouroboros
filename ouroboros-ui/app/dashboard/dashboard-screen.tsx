import { Button, type ButtonTone, Eyebrow } from "@/app/ui";

import { type EmptyPanel, EmptyCard } from "./empty-card";
import { StatCard } from "./stat-card";
import { SystemCard } from "./system-card";
import { type DashboardReadings, pageSubline, statRow, systemRows } from "./view";

import "./dashboard.css";

/**
 * The dashboard (#45) — `docs/mockups/02-dashboard.html` as a working page.
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
 * ### What is real here and what is not
 *
 * Two kinds of card sit on the same grid, and the difference is the point of this screen:
 *
 * - **Read.** The stat row and the system card are drawn from `/auth/me`, the members
 *   listing, the enablement lists, `/health/ready` and `/api/v1/engine/status`. Every
 *   figure on them came from the service, and a figure that could not be read is an em dash
 *   beside the reason rather than a zero.
 * - **Waiting.** The mockup's three loop panels have no source in the contract at all —
 *   nothing runs loops yet — so they keep their place in the grid as designed empty states
 *   naming what will fill them. Inventing three rows of plausible runs would make this
 *   screen a picture of a product rather than a view of one.
 *
 * @param props.readings Everything the reader was able to read, and why not for the rest.
 * @returns The screen.
 */
export function DashboardScreen({
  readings,
}: Readonly<{ readings: DashboardReadings }>) {
  const { workspace, user } = readings;

  return (
    <main className="dash">
      <div className="dash__head">
        <div className="dash__headings">
          <Eyebrow>Mission Control</Eyebrow>
          <h1 className="dash__title">{workspace.name}</h1>
          <p className="dash__sub">{pageSubline(workspace, user.displayName)}</p>
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
        {statRow(readings.members, readings.enablement).map((stat) => (
          <StatCard key={stat.id} stat={stat} />
        ))}

        <EmptyCard panel={ACTIVE_LOOPS} />
        <SystemCard rows={systemRows(readings.readiness, readings.engine)} />
        <EmptyCard panel={RECENTLY_CLOSED} />
        <EmptyCard panel={UP_NEXT} />
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
 * Neither destination exists: the workflow builder is mockup 04's roadmap and issue intake
 * is mockup 03's, and the placeholder routes that would hold their place are #49. So both
 * render *labelled* rather than absent or linked to a `404`, which is the same treatment
 * the sidebar gives an unbuilt module and the login screen gives enterprise SSO.
 *
 * `aria-disabled` rather than `disabled`, deliberately: a disabled button leaves the tab
 * order and takes its own explanation with it, so the keyboard reader who most needs the
 * tooltip is the one who can never reach it.
 *
 * **Neither fakes an outcome.** "Pull next issue" is a real action against a queue that
 * does not exist; a button that appeared to do it would be the one dishonest control on a
 * screen built to be honest.
 */
const ACTIONS: readonly Action[] = [
  {
    id: "edit-workflows",
    label: "Edit workflows",
    tone: "ghost",
    why: "The workflow builder is not built yet — it arrives with its own roadmap (mockup 04).",
  },
  {
    id: "pull-next",
    label: "⟳ Pull next issue",
    tone: "primary",
    why: "Issue intake is not built yet — it arrives with its own roadmap (mockup 03).",
  },
];

/** The mockup's `ACTIVE LOOPS` table, before there is a loop to put in it. */
const ACTIVE_LOOPS: EmptyPanel = {
  id: "active-loops",
  title: "Active loops",
  headline: "No loops yet",
  note:
    "This table lists what Ouroboros is working on right now. Nothing runs loops yet — " +
    "the run console and its data arrive with mockup 10.",
  span: 8,
};

/** The mockup's `RECENTLY CLOSED BY THE LOOP` table. */
const RECENTLY_CLOSED: EmptyPanel = {
  id: "recently-closed",
  title: "Recently closed by the loop",
  headline: "Nothing closed yet",
  note:
    "Issues Ouroboros finished, and the pull requests it opened for them, will appear " +
    "here once the loop has run.",
  span: 7,
};

/** The mockup's `UP NEXT IN QUEUE` list. */
const UP_NEXT: EmptyPanel = {
  id: "up-next",
  title: "Up next in queue",
  headline: "The queue is not open yet",
  note:
    "Issues waiting for a loop will be listed here. Issue intake arrives with mockup 03's " +
    "roadmap.",
  span: 5,
};
