import { requireWorkspace } from "@/app/api/access";
import { mayAdminister, primaryRole } from "@/app/api/membership";
import { FarmTokensScreen } from "@/app/farm/farm-tokens-screen";
import { readTokenListing } from "@/app/farm/token-data";

/**
 * Farm tokens (AI.3, [#258](https://github.com/NobuData/ouroboros/issues/258)) — the settings
 * section's second mounted tab, at `/settings/farm-tokens`.
 *
 * Thin on purpose, the shape `app/(app)/settings/sources/page.tsx` takes: the gate returns the
 * workspace this request may render, a reader composes what the screen draws, and a component
 * draws it. The reader is `app/farm/token-data.ts`'s — the one the enroll card's sheet reads
 * through too — and the decisions are `app/farm/enroll.ts`'s.
 *
 * **The listing is read only for a reader who may have it.** It is `owner` or `admin` at the
 * service, so for anybody else the read would be a guaranteed `403`; the route skips it and the
 * screen says why by role. Whether this reader may is answered once, here, through
 * `mayAdminister` — and the gate that **enforces** is the service's, on the read and on every
 * revoke.
 *
 * **Under `/settings`, not beside it**, for `SOURCES_PATH`'s reason: the sidebar's **Settings**
 * entry stays lit, and BS.1's ([#491](https://github.com/NobuData/ouroboros/issues/491)) hub
 * moves no URL.
 *
 * @returns The farm tokens page, for the workspace this request is operating in.
 */
export default async function Page() {
  const access = await requireWorkspace();
  const may = mayAdminister(access.membership.roles);

  return (
    <FarmTokensScreen
      listing={may ? await readTokenListing() : null}
      mayAdminister={may}
      role={primaryRole(access.membership.roles)}
      workspaceName={access.membership.name}
    />
  );
}
