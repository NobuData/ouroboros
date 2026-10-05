/**
 * The Integrations card's rules and copy, as values
 * (BS.5, [#495](https://github.com/NobuData/ouroboros/issues/495)).
 *
 * Mockup 17's grid draws eight tiles, three of them with a green dot the product has not earned
 * yet. The service (BR.4, #488) composes each tile from the plane that owns the connection and
 * says which of four things is true of it; this module is where those four are given **four
 * different renderings in words**, so *not connected* (you could connect this), *v2* (a later
 * connector) and *not built yet* (the surface does not exist) can never read as one grey "off".
 *
 * ### No tile can display an unearned ✓
 *
 * {@link tileStanding} is the one function that decides what a tile looks like, and
 * {@link earnsCheck} the one that decides whether the ok mark is drawn: only for a tile that is
 * `connected` **and** `ok`. Nothing else in the card reads `availability` or `state`.
 *
 * Framework-free and pure.
 */

import type { IntegrationTile } from "@/app/api/settings-integrations";

/** What a tile is, as the card draws it — one modifier class and one phrase each. */
export type TileStanding =
  /** Connected and healthy — the only standing with the ok mark. */
  | "ok"
  /** Connected, but a source is failing or a runner is offline. */
  | "attention"
  /** The reader has not connected this. */
  | "disconnected"
  /** A v2 connector kind. */
  | "v2"
  /** The surface that would own the connection does not exist yet. */
  | "unbuilt";

/** The availability vocabulary, in the words the card prints. */
export const STANDING_WORDS: Readonly<Record<TileStanding, string>> = {
  ok: "connected",
  attention: "connected",
  disconnected: "not connected",
  v2: "v2",
  unbuilt: "not built yet",
};

/** The monogram in each tile's mark — the mockup's, plus the build farm's. */
export const TILE_MARKS: Readonly<Record<IntegrationTile["kind"], string>> = {
  github: "GH",
  slack: "SL",
  jira: "JR",
  linear: "LN",
  teams: "MS",
  webhooks: "WH",
  datadog: "DD",
  pagerduty: "PD",
  build_farm: "BF",
};

/**
 * What a tile is.
 *
 * A `connected` tile whose state is anything but `ok` is `attention`: a state this build does not
 * know errs toward *look at this*, never toward the ok mark.
 *
 * @param tile The tile's availability and state.
 * @returns Its standing.
 */
export function tileStanding(tile: Pick<IntegrationTile, "availability" | "state">): TileStanding {
  switch (tile.availability) {
    case "connected":
      return tile.state === "ok" ? "ok" : "attention";
    case "disconnected":
      return "disconnected";
    case "unavailable_v2":
      return "v2";
    case "unavailable_unbuilt":
      return "unbuilt";
    default:
      // An availability added to the service after this build: say the least, claim nothing.
      return "unbuilt";
  }
}

/**
 * Whether a tile has earned the ok mark.
 *
 * @param tile The tile's availability and state.
 * @returns `true` only for a tile that is connected **and** ok.
 */
export function earnsCheck(tile: Pick<IntegrationTile, "availability" | "state">): boolean {
  return tileStanding(tile) === "ok";
}

/**
 * The monogram for a tile.
 *
 * @param tile The tile's kind and label.
 * @returns The mockup's two letters, or the label's first two for a kind this build has no mark for.
 */
export function tileMark(tile: Pick<IntegrationTile, "kind" | "label">): string {
  const known = (TILE_MARKS as Readonly<Record<string, string | undefined>>)[tile.kind];

  return known ?? tile.label.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase();
}

/**
 * The tile's status line.
 *
 * @param tile The tile.
 * @returns A connected tile's context line (`2 active`), or the word *connected* when the service
 *   gave none; for every other tile, its availability in words.
 */
export function statusLine(
  tile: Pick<IntegrationTile, "availability" | "state" | "contextLine">,
): string {
  const standing = tileStanding(tile);
  const connected = standing === "ok" || standing === "attention";

  return connected && tile.contextLine !== null && tile.contextLine !== ""
    ? tile.contextLine
    : STANDING_WORDS[standing];
}

/**
 * The tag beside the card's title — `4 connected`.
 *
 * @param count The service's `connectedCount`. Never counted here.
 * @returns The tag's text.
 */
export function connectedTag(count: number): string {
  return `${String(count)} connected`;
}

/**
 * Whether a tile's action opens the webhook management sheet rather than navigating.
 *
 * @param tile The tile's kind and link.
 * @param mayManage Whether the reader is an owner or an admin — the webhooks API's audience.
 * @returns `true` for the webhooks tile of a reader who may manage.
 */
export function opensWebhookSheet(
  tile: Pick<IntegrationTile, "kind" | "deepLink">,
  mayManage: boolean,
): boolean {
  return tile.kind === "webhooks" && tile.deepLink !== null && mayManage;
}

/**
 * Whether a tile's action is a link to the surface that owns the connection.
 *
 * The webhooks tile never is: its owning surface is the sheet on this card, which a reader who
 * may not manage cannot open — so for them it shows state and offers nothing.
 *
 * @param tile The tile's kind and link.
 * @returns `true` when there is somewhere else to go.
 */
export function linksAway(tile: Pick<IntegrationTile, "kind" | "deepLink">): boolean {
  return tile.kind !== "webhooks" && tile.deepLink !== null;
}

/**
 * The accessible name of a tile's action — the label alone is *Manage* eight times over.
 *
 * @param tile The tile's label and link.
 * @returns `Manage GitHub`.
 */
export function actionName(tile: Pick<IntegrationTile, "label" | "deepLink">): string {
  return `${tile.deepLink?.label ?? ""} ${tile.label}`.trim();
}

/**
 * What the seat says when the grid could not be read.
 *
 * @param reason The service's sentence.
 * @returns The note.
 */
export function integrationsUnread(reason: string): string {
  return `The integrations could not be read. ${reason}`.trim();
}
