"use client";

import { useCallback, useState, useTransition } from "react";

import { Button, EmptyState, Table, type Column } from "@/app/ui";
import { ShellOverlay } from "@/app/shell/overlay";

import { readAuditTrail } from "./audit-actions";
import {
  AUDIT_EMPTY_NOTE,
  AUDIT_EMPTY_TITLE,
  AUDIT_LOADING,
  AUDIT_LOG_LABEL,
  AUDIT_SHEET_NOTE,
  AUDIT_SHEET_TITLE,
  SENTENCES,
  actorOf,
  kindOf,
  outcomeOf,
  reasonOf,
  stampOf,
  type AuditReading,
} from "./view";
import type { AuditEvent } from "@/app/api/audit";

import "./providers.css";

/**
 * Mockup 07's **Audit log** ghost action, and the sheet behind it
 * ([#225](https://github.com/NobuData/ouroboros/issues/225)).
 *
 * The mockup draws a button in the page head beside **+ Add provider**. AD.4's whole point is
 * that it becomes *the visible end of a trail that starts at every key operation* rather than
 * staying a button — so this is the destination, and it is deliberately **minimal**:
 * timestamped rows carrying time, actor, action and provider, with no filtering, no paging
 * and no drill-down. The full audit surface is mockup 17's territory, and building half of it
 * here would fork that page before it exists.
 *
 * ### It is a component, not a page, because AE.1 owns the page
 *
 * `/providers` is AE.1's ([#227](https://github.com/NobuData/ouroboros/issues/227)) and has
 * not landed. Rather than invent a page frame this ticket would then have to hand over — or
 * leave the acceptance criterion *the sheet renders seeded history* with nowhere to be
 * observed — the trail ships as **the head action and its sheet, mountable as one element**.
 * AE.1 renders `<AuditTrail />` in its page head beside its own **+ Add provider**, and
 * nothing about this file changes when it does. It is reachable today at
 * `/workshop/providers-audit`, which is the same thing the chrome story
 * ([#646](https://github.com/NobuData/ouroboros/issues/646)) is for a primitive whose page has
 * not arrived.
 *
 * ### Everything the sheet owes the keyboard is `ShellOverlay`'s
 *
 * The portal above the pane, the scroll lock, the focus trap, Escape, and focus returning to
 * this button on close. `docs/DESIGN_SYSTEM_APP_SHELL.md` § 1.3 names dialogs, sheets and the
 * palette as the three surfaces that behave this way, and that component is the one
 * implementation of it — `app/shell/shortcuts-sheet.tsx` is the same file with different
 * content inside.
 *
 * ### It reads when opened, and it reads again on every open
 *
 * A trail is a moving surface: somebody opening it twice in an incident wants the second read
 * to include what happened in between. Caching the first would make the sheet quietly stale
 * at exactly the moment its freshness matters, and the read is one indexed query over a
 * workspace's own rows.
 */

/**
 * The columns, in the order mockup 07's example row reads them: *2026-08-08 14:02 · Ken ·
 * rotated Anthropic key*.
 *
 * Declared outside the component because they close over nothing: a `Column<AuditEvent>[]`
 * rebuilt on every render would be a new array identity for `Table` to diff on every keypress
 * elsewhere on the page.
 */
const COLUMNS: readonly Column<AuditEvent>[] = [
  {
    key: "at",
    // The zone is named once, in the heading, rather than fifty times in the column — see
    // `stampOf` for why it is UTC at all.
    header: "When (UTC)",
    mono: true,
    className: "providers-audit__when",
    cell: (event) => stampOf(event.occurredAt),
  },
  {
    key: "actor",
    header: "Who",
    className: "providers-audit__who",
    cell: (event) => actorOf(event),
  },
  {
    key: "what",
    header: "What",
    cell: (event) => (
      <span className="providers-audit__what">
        <span>{SENTENCES[event.action]}</span>
        {/*
          The refusal marker. It is a word rather than only a colour, for the reason the
          health strip's `unknown` chip is a ring rather than a hue: a row that reads as a
          completed reveal to somebody who cannot distinguish the two would be the trail's
          most consequential lie. The code beside it is the service's own — see `reasonOf`
          on why it is never the message.
        */}
        {outcomeOf(event) === "failure" && (
          <span className="providers-audit__refused">
            refused{reasonOf(event) === null ? "" : ` · ${reasonOf(event) ?? ""}`}
          </span>
        )}
      </span>
    ),
  },
  {
    key: "kind",
    header: "Provider",
    mono: true,
    className: "providers-audit__kind",
    // No fallback: a refusal that happened before the row was read genuinely does not know
    // which provider it was about, and an empty cell is what that looks like.
    cell: (event) => kindOf(event),
  },
];

/**
 * The head action and its sheet.
 *
 * @returns The button, and the sheet while it is open.
 */
export function AuditTrail() {
  const [open, setOpen] = useState(false);
  const [reading, setReading] = useState<AuditReading | null>(null);
  const [pending, startReading] = useTransition();

  /**
   * Open the sheet and read the trail.
   *
   * The read starts in the same press that opens the sheet rather than in an effect, so the
   * sheet's first paint is already the loading state — an effect would render an empty sheet
   * for a frame first, which reads as *nothing has happened here* for exactly as long as it
   * takes to be replaced by rows.
   */
  const openSheet = useCallback(() => {
    setOpen(true);
    setReading(null);
    startReading(async () => {
      setReading(await readAuditTrail());
    });
  }, []);

  return (
    <>
      {/*
        `ghost` is the mockup's own treatment for this action: it sits beside the page's
        primary `+ Add provider` and must not compete with it.
      */}
      <Button onClick={openSheet} tone="ghost" type="button">
        {AUDIT_LOG_LABEL}
      </Button>

      <ShellOverlay label={AUDIT_SHEET_TITLE} onClose={() => setOpen(false)} open={open}>
        <h2 className="shell-overlay__title">{AUDIT_SHEET_TITLE}</h2>
        <p className="shell-overlay__note">{AUDIT_SHEET_NOTE}</p>

        <AuditBody pending={pending} reading={reading} />
      </ShellOverlay>
    </>
  );
}

/**
 * What the sheet draws under its heading — exactly one of four things.
 *
 * Split out so the four states are a `switch` on a union rather than a ladder of ternaries
 * inside the component that also owns the button, the transition and the overlay. The union
 * is `AuditReading`, and `pending` is the fourth state: a read that has not answered yet.
 *
 * @param props.pending Whether the read is still in flight.
 * @param props.reading What it produced, or `null` before it has.
 * @returns The rows, the empty state, the refusal, or the loading line.
 */
function AuditBody({
  pending,
  reading,
}: Readonly<{ pending: boolean; reading: AuditReading | null }>) {
  if (pending || reading === null) {
    // `role="status"` rather than an alert: a sheet that has just been opened and is fetching
    // is a fact about the surface the reader asked for, not an interruption to announce over
    // whatever they were doing.
    return (
      <p className="providers-audit__state" role="status">
        {AUDIT_LOADING}
      </p>
    );
  }

  if (!reading.ok) {
    return (
      <p className="providers-audit__state" role="status">
        {reading.reason}
      </p>
    );
  }

  if (reading.events.length === 0) {
    return <EmptyState note={AUDIT_EMPTY_NOTE} title={AUDIT_EMPTY_TITLE} />;
  }

  return (
    <Table
      caption={AUDIT_SHEET_TITLE}
      captionHidden
      className="providers-audit__table"
      columns={COLUMNS}
      rowKey={(event) => event.id}
      rows={[...reading.events]}
    />
  );
}
