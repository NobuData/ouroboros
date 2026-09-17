import { Button, Card, CardHead, Chip, EmptyState, Tag, cx } from "@/app/ui";
import { SOURCES_PATH } from "@/app/paths";

import {
  CADENCE_NOTE,
  CONNECT_LABEL,
  SYNC_LIST_LABEL,
  SYNC_TITLE,
  SYNC_TITLE_ID,
  SYNC_UNREAD,
  type SyncRow,
  cadenceOf,
  syncRows,
} from "./sync";
import type { PlanningReadings } from "./view";

import "./planning.css";

/**
 * Mockup 09's **Tracker Sync** card, the top of the side column's `c-5`
 * (AM.3, [#285](https://github.com/NobuData/ouroboros/issues/285)).
 *
 * A row per tracker — monogram, name, a sub-line composed from real write capability, a status dot
 * — and the head's cadence tag read from the deployment's own poll configuration. Every judgement
 * and every sentence is [`sync.ts`](sync.ts)'s; this component only draws them.
 *
 * ### It is a read *and* a write view of the same sources the settings page manages
 *
 * Decision **N8**: these are the WF-Q sources (#141), so a kind nobody has connected offers
 * **connect ↗** into that surface rather than a dialog of its own. Two places that could add a
 * source would be two forms to keep in step, and the settings page is where a credential belongs.
 *
 * ### Nothing here is a control except that link
 *
 * The card reports; it does not act. There is no *Sync now* on it — that is the settings row's,
 * where the debounce and the reason for a refusal already live (`app/sources/source-controls.tsx`).
 * A second copy would be a second place to get a `409` wrong.
 */
export function TrackerSyncCard({ readings }: Readonly<{ readings: PlanningReadings }>) {
  const { sources, catalog } = readings;
  const cadence = cadenceOf(sources);

  return (
    <Card aria-labelledby={SYNC_TITLE_ID} as="section" className="planning__region" fill>
      <CardHead
        beside={cadence === null ? undefined : <Tag title={CADENCE_NOTE}>{cadence}</Tag>}
        title={SYNC_TITLE}
        titleId={SYNC_TITLE_ID}
      />
      {sources.ok ? (
        <ul aria-label={SYNC_LIST_LABEL} className="planning-sync">
          {syncRows(sources.value.items, catalog).map((row) => (
            <SyncRowItem key={row.key} row={row} />
          ))}
        </ul>
      ) : (
        <EmptyState fill note={sources.reason} title={SYNC_UNREAD} />
      )}
    </Card>
  );
}

/** Each monogram tint's classes — literal, so the stylesheet contract can see them rendered. */
const MONOGRAM_CLASS: Record<SyncRow["tint"], string> = {
  gh: "planning-mgram planning-mgram--gh",
  ji: "planning-mgram planning-mgram--ji",
  ln: "planning-mgram planning-mgram--ln",
  neutral: "planning-mgram",
};

/**
 * One tracker's row.
 *
 * The dot carries its state **in a word as well as a hue** — the design system's rule, and the
 * reason this is a {@link Chip} rather than a bare coloured circle: the mockup's three dots differ
 * only in colour, and a reader who cannot separate two hues would learn nothing from them.
 *
 * @param props.row The row, from `sync.ts`'s `syncRows`.
 * @returns The list item.
 */
function SyncRowItem({ row }: Readonly<{ row: SyncRow }>) {
  return (
    <li className="planning-sync__row">
      <span aria-hidden className={MONOGRAM_CLASS[row.tint]}>
        {row.monogram}
      </span>
      <span className="planning-sync__text">
        <span className="planning-sync__name">{row.name}</span>
        <span
          className={cx("planning-sync__sub", row.connect && "planning-sync__sub--absent")}
          title={row.reason}
        >
          {row.sub}
        </span>
      </span>
      <Chip dot={row.dot} tone={row.tone}>
        {row.state}
      </Chip>
      {row.connect && (
        <Button href={SOURCES_PATH} size="sm" tone="ghost">
          {CONNECT_LABEL}
        </Button>
      )}
    </li>
  );
}
