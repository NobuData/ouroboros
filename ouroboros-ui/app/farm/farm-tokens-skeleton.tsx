import { SettingsFrame } from "@/app/settings/settings-frame";
import { Card, EmptyState } from "@/app/ui";

import { TOKENS_LOADING, TOKENS_SUBLINE, TOKENS_TITLE } from "./enroll";

/**
 * The farm tokens page's loading state (AI.3, [#258](https://github.com/NobuData/ouroboros/issues/258)).
 *
 * The frame is real — the title, the subline and the tab row are known before any read — so
 * the skeleton draws it, and where the list will be it says what `app/farm/token-list.tsx` says
 * while *its* read is in flight: the sheet and the page wait in the same words. The eyebrow's
 * workspace is the one thing the skeleton cannot know, and it is drawn as an ellipsis, as
 * `app/sources/sources-skeleton.tsx` draws it.
 */

/** What the `<main>` is named while it loads. */
export const LOADING_LABEL = "Loading farm tokens";

/**
 * The skeleton.
 *
 * @returns The frame, busy, with the list's waiting line where the rows will be.
 */
export function FarmTokensSkeleton() {
  return (
    <SettingsFrame
      actions={null}
      active="farm-tokens"
      busy={LOADING_LABEL}
      subline={TOKENS_SUBLINE}
      title={TOKENS_TITLE}
      workspaceName="…"
    >
      <Card>
        <EmptyState note={TOKENS_LOADING} variant="flush" />
      </Card>
    </SettingsFrame>
  );
}
