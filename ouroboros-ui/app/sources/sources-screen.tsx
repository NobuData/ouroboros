import type { Role } from "@/app/api/membership";
import { SettingsFrame } from "@/app/settings/settings-frame";
import { Card, EmptyState } from "@/app/ui";

import { AddSourceButton, AddSourceFlow } from "./add-source";
import type { SourcesReadings } from "./data";
import { SourceRow } from "./source-row";
import { SourcesBanner } from "./sources-banner";
import {
  DEGRADED_HEADLINE,
  EMPTY_MEMBER_NOTE,
  EMPTY_NOTE,
  EMPTY_TITLE,
  LIST_FAILED_NOTE,
  LIST_FAILED_TITLE,
  SOURCES_FAILED_HEADLINE,
  type SourcesState,
  degradedReads,
  degradedReason,
  readOnlyNote,
  sourcesState,
} from "./states";
import { ADD_SOURCE_LABEL, LIST_LABEL, SOURCES_SUBLINE, SOURCES_TITLE } from "./view";

import "./sources.css";

/**
 * The `/settings/sources` screen ([#141](https://github.com/NobuData/ouroboros/issues/141)):
 * mockup 17's chrome on the settings frame, the add-source flow mounted on its head, the
 * list of sources below, and every state the page can be in that is not *a list*.
 *
 * It renders **inside the app shell** and inside the settings section's frame
 * (`app/settings/settings-frame.tsx`), so it starts at its page head, contributes no chrome of
 * its own, and draws the section's tab row with the underline on **Sources**.
 *
 * A component rather than markup written in the route, for the reason every screen in this
 * module is: everything it draws can be rendered and asserted on without Next.js's routing
 * around it. The route gates and reads (`app/(app)/settings/sources/page.tsx`,
 * `app/sources/data.ts`), three pure modules hold the decisions (`view.ts` for the rows'
 * words, `catalog.ts` for the two dialogs, `states.ts` for the page's states), and this draws.
 *
 * ### The states, and where each is explained once
 *
 * `states.ts` decides them; this draws them, and the rule is DASH-I.7's: a *reason* is said
 * once, in a banner with the retry, and what sits below says what is missing without
 * repeating it. The listing refused is the one read the list cannot survive; the catalog
 * refused degrades every row's summary and both dialogs' forms, so it is one banner naming
 * what failed. An empty workspace guides — *Connect your first ticket source*, with the
 * primary action for a role that may and an explanation for one that may not. A member sees
 * every row and may change none of them; the note under the tab set names the role once.
 */

/** What the screen takes. */
export interface SourcesScreenProps {
  /** The active workspace's display name, for the eyebrow. */
  readonly workspaceName: string;
  /**
   * Whether this reader may add, configure, test, sync or pause a source —
   * `app/api/membership.ts`'s `mayAdminister`, decided once by the route.
   */
  readonly mayAdminister: boolean;
  /** The reader's strongest role, for the read-only note to **name** — never to decide from. */
  readonly role?: Role;
  /** Everything the rows are drawn from — see `app/sources/data.ts`. */
  readonly readings: SourcesReadings;
}

/**
 * The screen.
 *
 * @param props See {@link SourcesScreenProps}.
 * @returns The screen.
 */
export function SourcesScreen({
  workspaceName,
  mayAdminister,
  role = "viewer",
  readings,
}: SourcesScreenProps) {
  const state = sourcesState(readings);
  const degraded = state.kind === "failed" ? [] : degradedReads(readings);

  return (
    <AddSourceFlow mayAdminister={mayAdminister}>
      <SettingsFrame
        actions={<AddSourceButton />}
        active="sources"
        subline={SOURCES_SUBLINE}
        title={SOURCES_TITLE}
        workspaceName={workspaceName}
      >
        {!mayAdminister && <ReadOnlyNote role={role} />}

        {state.kind === "failed" && (
          <SourcesBanner headline={SOURCES_FAILED_HEADLINE} reason={state.reason} />
        )}
        {degraded.length > 0 && (
          <SourcesBanner headline={DEGRADED_HEADLINE} reason={degradedReason(degraded)} />
        )}

        <SourceList mayAdminister={mayAdminister} readings={readings} state={state} />
      </SettingsFrame>
    </AddSourceFlow>
  );
}

/**
 * The sentence a reader who may look and not change is given.
 *
 * @param props.role The reader's strongest role.
 * @returns The paragraph.
 */
function ReadOnlyNote({ role }: Readonly<{ role: Role }>) {
  const note = readOnlyNote(role);

  return (
    <p className="sources-readonly" role="note">
      <span className="sources-readonly__head">{note.head}</span> {note.body}
    </p>
  );
}

/**
 * The list: one row per source — or what stands where the rows would be.
 *
 * @param props.readings The readings.
 * @param props.mayAdminister Whether this reader may press a control, or add the first source.
 * @param props.state Which state the listing put the page in.
 * @returns The list.
 */
function SourceList({
  readings,
  mayAdminister,
  state,
}: Readonly<{ readings: SourcesReadings; mayAdminister: boolean; state: SourcesState }>) {
  if (state.kind === "failed" || !readings.sources.ok) {
    return (
      <Card className="sources-list__seat" fill>
        <EmptyState fill note={LIST_FAILED_NOTE} title={LIST_FAILED_TITLE} />
      </Card>
    );
  }

  if (state.kind === "empty") {
    return (
      <Card className="sources-guidance" fill>
        <EmptyState fill note={EMPTY_NOTE} title={EMPTY_TITLE}>
          {mayAdminister ? (
            <AddSourceButton />
          ) : (
            <p className="sources-guidance__note">{EMPTY_MEMBER_NOTE}</p>
          )}
        </EmptyState>
      </Card>
    );
  }

  const now = new Date(readings.now);
  const entries = new Map(
    readings.catalog.ok ? readings.catalog.value.map((entry) => [entry.kind, entry]) : [],
  );

  return (
    <ul aria-label={LIST_LABEL} className="sources-list">
      {readings.sources.value.map((source) => (
        <SourceRow
          entry={entries.get(source.kind) ?? null}
          key={source.id}
          mayAdminister={mayAdminister}
          now={now}
          source={source}
          status={readings.statuses.get(source.id) ?? null}
        />
      ))}
    </ul>
  );
}

/** Named so a suite can find the head's action by its label without importing the flow. */
export { ADD_SOURCE_LABEL };
