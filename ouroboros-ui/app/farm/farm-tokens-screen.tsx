"use client";

import { useState } from "react";

import type { Role } from "@/app/api/membership";
import { BUILD_FARM_PATH } from "@/app/paths";
import { SettingsFrame } from "@/app/settings/settings-frame";
import { Button, Card } from "@/app/ui";

import {
  OPEN_BUILD_FARM,
  TOKENS_FORBIDDEN,
  TOKENS_SUBLINE,
  TOKENS_TITLE,
  type TokenListing,
  tokensReadOnlyHead,
} from "./enroll";
import { TokenList } from "./token-list";

import "./farm.css";

/**
 * The `/settings/farm-tokens` screen — the build farm's enrollment tokens as the settings
 * section's **Farm tokens** tab (AI.3, [#258](https://github.com/NobuData/ouroboros/issues/258)).
 *
 * The amendment on #258 is decision S2 of the Workspace Settings roadmap: `/settings` is the
 * administration hub, and the existing admin surfaces mount in its nav as tabs rather than being
 * written a second time. So this is a frame around `app/farm/token-list.tsx` — **the same list
 * the enroll card's sheet draws** — and owns nothing but the listing it was handed, which a
 * revoke updates in place.
 *
 * It renders inside the app shell and inside the settings frame
 * (`app/settings/settings-frame.tsx`), so it starts at its page head and draws the section's tab
 * row with the underline on **Farm tokens**. Minting stays where the command is — the head's
 * action leads to the build farm.
 *
 * **A reader who may not administer is told so, once, by role** — and no list is read for them:
 * the listing is `owner` or `admin` at the service, and a page of *could not be read* would
 * imply something is broken.
 *
 * @param props.workspaceName The active workspace's display name, for the eyebrow.
 * @param props.mayAdminister Whether this reader may list and revoke — decided by the route.
 * @param props.role The reader's strongest role, for the note to **name** — never to decide from.
 * @param props.listing What the route read, or `null` for a reader it did not read for.
 * @returns The screen.
 */
export function FarmTokensScreen({
  workspaceName,
  mayAdminister,
  role = "viewer",
  listing: initial,
}: Readonly<{
  workspaceName: string;
  mayAdminister: boolean;
  role?: Role;
  listing: TokenListing | null;
}>) {
  const [listing, setListing] = useState(initial);

  return (
    <SettingsFrame
      actions={
        <Button href={BUILD_FARM_PATH} tone="ghost">
          {OPEN_BUILD_FARM}
        </Button>
      }
      active="farm-tokens"
      subline={TOKENS_SUBLINE}
      title={TOKENS_TITLE}
      workspaceName={workspaceName}
    >
      {mayAdminister ? (
        <Card as="section" aria-label={TOKENS_TITLE}>
          <TokenList listing={listing} onListing={setListing} />
        </Card>
      ) : (
        <p className="farm-tokens__readonly" role="note">
          <span className="farm-tokens__readonly-head">{tokensReadOnlyHead(role)}</span>{" "}
          {TOKENS_FORBIDDEN}
        </p>
      )}
    </SettingsFrame>
  );
}
