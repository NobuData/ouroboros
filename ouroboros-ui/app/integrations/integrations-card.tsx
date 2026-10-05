"use client";

import { useState } from "react";

import type { IntegrationTile, Integrations } from "@/app/api/settings-integrations";
import type { WebhookList } from "@/app/api/settings-webhooks";
import { sectionTitleId, settingsSection } from "@/app/settings/view";
import { Button, Card, CardHead, Tag, cx } from "@/app/ui";
import { WebhookSheet } from "@/app/webhooks/webhook-sheet";

import {
  type TileStanding,
  actionName,
  connectedTag,
  linksAway,
  opensWebhookSheet,
  statusLine,
  tileMark,
  tileStanding,
} from "./view";

import "./integrations.css";

/** The modifier for each standing — literals, so the style suite can see every one. */
const STANDING_CLASS: Record<TileStanding, string> = {
  ok: "integrations__tile--ok",
  attention: "integrations__tile--attention",
  disconnected: "integrations__tile--disconnected",
  v2: "integrations__tile--v2",
  unbuilt: "integrations__tile--unbuilt",
};

/**
 * The Integrations card — mockup 17's `c-7` grid, in its truth states
 * (BS.5, [#495](https://github.com/NobuData/ouroboros/issues/495)).
 *
 * One tile per integration, exactly as BR.4's status hub composed it: nothing here counts,
 * infers or remembers a connection. The rules are `app/integrations/view.ts`'s — above all that
 * the ok mark is drawn only for a tile that is connected and ok.
 *
 * ### Nothing is configured here
 *
 * A tile's action is a **link to the surface that owns the connection** (Sources, the build
 * farm), and a tile with nowhere to go — a v2 connector, a surface not built yet — has no control
 * at all: *off* would invite a press that goes nowhere. The one exception is the tile this card
 * *is* the owning surface of: **Webhooks** opens the management sheet (`app/webhooks/`), for a
 * reader who may manage. Anybody else sees its state and no control, because the webhooks API
 * would refuse them.
 *
 * @param props.integrations The grid as read.
 * @param props.webhooks The webhook list as read, to open the sheet with — `null` for a reader
 *   who may not manage, or when it could not be read (the sheet then reads for itself).
 * @param props.mayManage Whether the reader is an owner or an admin.
 * @returns The card.
 */
export function IntegrationsCard({
  integrations,
  webhooks,
  mayManage,
}: Readonly<{ integrations: Integrations; webhooks: WebhookList | null; mayManage: boolean }>) {
  const section = settingsSection("integrations");
  const titleId = sectionTitleId(section.id);
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <Card aria-labelledby={titleId} as="section">
      <CardHead
        beside={<Tag>{connectedTag(integrations.connectedCount)}</Tag>}
        title={section.title}
        titleId={titleId}
      />

      <ul className="integrations">
        {integrations.tiles.map((tile) => (
          <Tile
            key={tile.kind}
            onManageWebhooks={
              opensWebhookSheet(tile, mayManage)
                ? () => {
                    setSheetOpen(true);
                  }
                : undefined
            }
            tile={tile}
          />
        ))}
      </ul>

      {mayManage && (
        <WebhookSheet
          initial={webhooks}
          onClose={() => {
            setSheetOpen(false);
          }}
          open={sheetOpen}
        />
      )}
    </Card>
  );
}

/**
 * One tile: mark, name, status in words, the reason when there is one, and its action.
 *
 * @param props.tile The tile.
 * @param props.onManageWebhooks Open the webhook sheet — given only for the webhooks tile of a
 *   reader who may manage.
 * @returns The tile.
 */
function Tile({
  tile,
  onManageWebhooks,
}: Readonly<{ tile: IntegrationTile; onManageWebhooks?: () => void }>) {
  const standing = tileStanding(tile);

  return (
    <li className={cx("integrations__tile", STANDING_CLASS[standing])}>
      <span aria-hidden className="integrations__mark">
        {tileMark(tile)}
      </span>
      <span className="integrations__name">{tile.label}</span>
      <span className="integrations__status">
        <span aria-hidden className="integrations__dot" />
        <span className="integrations__line">{statusLine(tile)}</span>
      </span>
      {tile.reason !== null && tile.reason !== "" && (
        <span className="integrations__reason">{tile.reason}</span>
      )}

      {onManageWebhooks !== undefined && tile.deepLink !== null ? (
        <Button
          aria-haspopup="dialog"
          aria-label={actionName(tile)}
          className="integrations__action"
          onClick={onManageWebhooks}
          size="sm"
          tone="ghost"
        >
          {tile.deepLink.label}
        </Button>
      ) : linksAway(tile) && tile.deepLink !== null ? (
        <Button
          aria-label={actionName(tile)}
          className="integrations__action"
          href={tile.deepLink.path}
          size="sm"
          tone="ghost"
        >
          {tile.deepLink.label}
        </Button>
      ) : null}
    </li>
  );
}
