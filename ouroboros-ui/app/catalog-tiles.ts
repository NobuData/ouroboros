/**
 * The tiles a kind picker draws from a catalog the service answered — and the honest
 * *coming soon* tiles beside them.
 *
 * Written for the add-provider dialog ([#231](https://github.com/NobuData/ouroboros/issues/231))
 * and lifted here when the add-source dialog ([#141](https://github.com/NobuData/ouroboros/issues/141))
 * wanted the same three rules over a different catalog. Both pickers make the same claim —
 * *the tiles derive from the registry* — and the claim is one function rather than two so
 * that a change to what *derive* means is a change in one place.
 *
 * Framework-free and pure, like `app/format.ts` and `app/paths.ts`: a value module both
 * catalogs' decision files call, with nothing in it that names a provider, a tracker or a
 * screen.
 *
 * ### The three rules
 *
 * **The live tiles are the catalog's, in its order, with nothing added.** A kind this module
 * has never heard of gets a tile and a form exactly as a mockup's kind does, because there is
 * no list here to be absent from. Labels are copy the caller supplies; a kind without one is
 * labelled by its own name.
 *
 * **An announcement is a promise written down once, with where it comes from.** A `coming
 * soon` tile names the ticket that delivers its kind, so *soon* is an answer to *when?* rather
 * than the word on its own.
 *
 * **An announcement retires itself.** The moment the catalog answers an announced kind, the
 * live tile is drawn and the announcement is not — so the day a provider lands, its tile
 * flips from *soon* to live with no change to any list.
 */

/** What a catalog entry has to carry for a tile to be drawn from it. */
export interface CatalogEntryLike {
  /** The kind, as the service registers it. */
  readonly kind: string;
  /** The form's fields — what the tile's *needs* line is composed from. */
  readonly fields: readonly { readonly label: string; readonly required: boolean }[];
}

/** A kind a picker promises and this build does not have. */
export interface Announcement {
  /** The kind, as its provider will register it. What retires the announcement. */
  readonly kind: string;
  /** What the tile says. */
  readonly label: string;
  /** Where it comes from — the issue, named so *soon* is an answer to *when?*. */
  readonly source: string;
}

/** A tile for a kind this build can connect. */
export interface LiveTile<Entry extends CatalogEntryLike> {
  readonly live: true;
  readonly kind: Entry["kind"];
  /** The tile's heading. */
  readonly label: string;
  /** Two letters for the monogram box. */
  readonly monogram: string;
  /** What the form will ask for, in a line — so a reader knows what to have ready. */
  readonly needs: string;
  /** The entry, which is the form. */
  readonly entry: Entry;
}

/** A tile for a kind that is promised and not here. Draws nothing interactive. */
export interface SoonTile {
  readonly live: false;
  readonly kind: string;
  readonly label: string;
  readonly monogram: string;
  /** Where it comes from. */
  readonly source: string;
}

/** One tile in a picker. */
export type CatalogTile<Entry extends CatalogEntryLike> = LiveTile<Entry> | SoonTile;

/** What every tile says on its badge while its kind is not live. */
export const COMING_SOON_LABEL = "coming soon";

/** What a tile says a form with no fields would ask for. Unreachable in the dialect; total anyway. */
export const NEEDS_NOTHING = "Nothing to fill in";

/**
 * Two letters for a tile's monogram box.
 *
 * Derived from the label rather than chosen per kind: a tile in a picker needs only to be
 * tellable from its neighbours.
 *
 * @param label The tile's label.
 * @returns Its first two letters or digits, upper-cased; `?` for a label with none.
 */
export function monogramOf(label: string): string {
  const letters = label.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase();

  return letters.length === 0 ? "?" : letters;
}

/**
 * What a form will ask for, in a line — *Base URL · API key (optional)*.
 *
 * @param fields The entry's fields.
 * @returns The labels joined, each optional one saying so.
 */
export function needsOf(fields: CatalogEntryLike["fields"]): string {
  if (fields.length === 0) return NEEDS_NOTHING;

  return fields
    .map((field) => (field.required ? field.label : `${field.label} (optional)`))
    .join(" · ");
}

/**
 * The tiles to draw: one per live entry, in the service's order, then one per announcement
 * whose kind is not among them.
 *
 * @param entries What the catalog answered.
 * @param labelOf The label for a kind — the caller's copy, with the kind itself as the fallback.
 * @param announcements What is promised.
 * @returns The tiles.
 */
export function catalogTiles<Entry extends CatalogEntryLike>(
  entries: readonly Entry[],
  labelOf: (kind: string) => string,
  announcements: readonly Announcement[],
): CatalogTile<Entry>[] {
  const live = new Set<string>(entries.map((entry) => entry.kind));

  return [
    ...entries.map((entry): LiveTile<Entry> => {
      const label = labelOf(entry.kind);

      return {
        live: true,
        kind: entry.kind,
        label,
        monogram: monogramOf(label),
        needs: needsOf(entry.fields),
        entry,
      };
    }),
    ...announcements
      .filter((announcement) => !live.has(announcement.kind))
      .map(
        (announcement): SoonTile => ({
          live: false,
          kind: announcement.kind,
          label: announcement.label,
          monogram: monogramOf(announcement.label),
          source: announcement.source,
        }),
      ),
  ];
}
