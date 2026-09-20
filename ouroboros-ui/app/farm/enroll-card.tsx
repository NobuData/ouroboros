"use client";

import { useState, useTransition } from "react";

import { Button, Card, CardHead, SelectField } from "@/app/ui";

import {
  COMMAND_LABEL,
  COMMAND_WITHHELD,
  COPIED_TOAST,
  COPYING_COMMAND,
  COPY_BLOCKED_LIVE,
  COPY_BLOCKED_REVOKED,
  COPY_COMMAND,
  DISMISS_TOAST,
  ENROLL_COPY_ID,
  ENROLL_POOL_FIELD_ID,
  ENROLL_TITLE,
  MANAGE_TOKENS,
  MEMBER_NOTE,
  MTLS_NOTE,
  type MintedView,
  NO_POOLS_REASON,
  POOLS_UNREAD_REASON,
  POOL_LABEL,
  RESTING_TOKEN,
  type TokenListing,
  commandParts,
  explainer,
  hostOf,
  installsFrom,
  restingCommand,
  tokenLine,
} from "./enroll";
import { mintEnrollCommand, readEnrollmentTokens, revokeEnrollmentToken } from "./enroll-actions";
import { copyWhenReady } from "./clipboard";
import { useFarm } from "./farm-store";
import { TokenSheet } from "./token-sheet";

/**
 * The build farm's ENROLL A RUNNER card — mockup 08's, with a command that actually enrols
 * (AI.3, [#258](https://github.com/NobuData/ouroboros/issues/258)).
 *
 * What it says and every judgement it makes is `app/farm/enroll.ts`'s; this holds the state a
 * reader owns — the pool chosen, what the last mint answered, whether the sheet is open — and
 * draws.
 *
 * ### A credential surface
 *
 * - **Nothing is minted to draw the card.** At rest the block shows the command's shape and the
 *   explainer names no host, because the only read that knows this deployment's origin and its
 *   pinned version is the one that mints. **Copy command** is the mint: one press, one
 *   single-use token, handed to the clipboard.
 * - **The token's value is never in the DOM, and never in state.** The Server Action answers the
 *   command twice — whole, and masked on the server — and the whole one goes from the action's
 *   promise straight into the clipboard write (`app/farm/clipboard.ts`). What `useState` keeps is
 *   {@link MintedView}, which has no field for it.
 * - **The toast says it is a secret** and promises nothing about the clipboard. It stays until
 *   dismissed, for `app/workflows/studio-toast.tsx`'s reason: a message on a timer is one a
 *   keyboard or screen-reader reader may never reach.
 * - **A blocked copy leaves nothing live.** If the browser refuses the clipboard after the mint
 *   took, the token's value is lost and the token is not — so it is revoked at once, and the
 *   card says so. A credential nobody can use and nobody remembers is the failure the issue
 *   names.
 * - **There is a way back**: *Manage tokens →* opens the sheet that lists and revokes
 *   (`app/farm/token-sheet.tsx`). Its read starts in the press that opens it.
 *
 * ### A reader who may not mint
 *
 * Sees the explainer, the command's shape and the mTLS note — and no selector, no copy and no
 * sheet. The host is not named for them, because the read that knows it is one they may not
 * make. That is *presentation*; the gate that decides is the service's.
 *
 * @param props.mayAdminister Whether this reader may mint — `mayAdminister`, from the route.
 * @param props.tenant The workspace's slug — the command's `--tenant`.
 * @returns The card, as a direct child of the farm's grid.
 */
export function EnrollCard({
  mayAdminister,
  tenant,
}: Readonly<{ mayAdminister: boolean; tenant: string }>) {
  const { page, dataAt } = useFarm();
  const [chosen, setChosen] = useState<string | null>(null);
  const [minted, setMinted] = useState<(MintedView & { pool: string; at: number }) | null>(null);
  const [origin, setOrigin] = useState<string | null>(null);
  const [toast, setToast] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [listing, setListing] = useState<TokenListing | null>(null);
  const [copying, startCopy] = useTransition();
  const [, startRead] = useTransition();

  const pools = page?.pools ?? [];
  // A choice outlives the pool it names when the pool is deleted; the first pool stands in.
  const pool = pools.find((held) => held.name === chosen)?.name ?? pools[0]?.name ?? null;
  // What was minted is about the pool it was minted for: another pool is back to the shape.
  const current = mayAdminister && minted !== null && minted.pool === pool ? minted : null;
  const sentence = explainer(origin === null ? null : hostOf(origin));
  const blocked = page === null ? POOLS_UNREAD_REASON : pool === null ? NO_POOLS_REASON : undefined;

  /** Mint a token for the chosen pool and put the command on the clipboard. */
  function copy(): void {
    if (pool === null || copying) return;

    const forPool = pool;

    setFailure(null);
    setToast(false);

    // The callback runs synchronously, inside the press — which is what lets the clipboard
    // write be asked for while the browser still counts this as a gesture.
    startCopy(async () => {
      const minting = mintEnrollCommand(forPool);
      const writing = copyWhenReady(
        // The one place the value goes. A refused mint rejects the write: nothing to copy.
        minting.then((outcome) => (outcome.ok ? outcome.command : Promise.reject(new Error("refused")))),
      );
      // A refused mint is reported from `outcome` below; its echo here has nobody waiting.
      writing.catch(() => {});

      const outcome = await minting;
      if (!outcome.ok) {
        setFailure(outcome.reason);
        return;
      }

      setOrigin(outcome.origin);

      try {
        await writing;
      } catch {
        const revoked = await revokeEnrollmentToken(outcome.token.id);

        setFailure(revoked.ok ? COPY_BLOCKED_REVOKED : COPY_BLOCKED_LIVE);
        return;
      }

      // Field by field, so the value has no way in: `MintedView` has nowhere to put it.
      setMinted({
        shown: outcome.shown,
        origin: outcome.origin,
        version: outcome.version,
        token: outcome.token,
        pool: forPool,
        at: Date.now(),
      });
      setToast(true);
    });
  }

  /** Open the sheet, and start the read it needs. */
  function manage(): void {
    setSheetOpen(true);
    setListing(null);

    startRead(async () => {
      setListing(await readEnrollmentTokens());
    });
  }

  return (
    <Card aria-labelledby={TITLE_ID} as="section" className="farm-col--4 farm-enroll">
      <CardHead title={ENROLL_TITLE} titleId={TITLE_ID} />

      <p className="farm-enroll__lead">
        {sentence.before}
        <span className={sentence.mono ? "farm-enroll__host" : undefined}>{sentence.host}</span>
        {sentence.after}
      </p>

      {mayAdminister && pools.length > 0 && (
        <SelectField
          id={ENROLL_POOL_FIELD_ID}
          label={POOL_LABEL}
          onChange={(event) => setChosen(event.target.value)}
          value={pool ?? ""}
        >
          {pools.map((held) => (
            <option key={held.id} value={held.name}>
              {held.name}
            </option>
          ))}
        </SelectField>
      )}

      {current === null ? (
        <CommandBlock command={restingCommand(tenant, mayAdminister ? pool : null)} mask={RESTING_TOKEN} />
      ) : current.shown === null ? (
        <p className="farm-enroll__note">
          {COMMAND_WITHHELD} {installsFrom(current.origin, current.version)}
        </p>
      ) : (
        <CommandBlock command={current.shown} mask={current.token.masked} />
      )}

      <p className="farm-enroll__note">{MTLS_NOTE}</p>

      {mayAdminister ? (
        <>
          <div className="farm-enroll__actions">
            <Button
              aria-busy={copying || undefined}
              id={ENROLL_COPY_ID}
              onClick={copy}
              reason={blocked}
              size="sm"
              tone="ghost"
            >
              {copying ? COPYING_COMMAND : COPY_COMMAND}
            </Button>
            <Button onClick={manage} size="sm" tone="ghost">
              {MANAGE_TOKENS}
            </Button>
          </div>

          {current !== null && (
            <p className="farm-enroll__token">{tokenLine(current.token, Math.max(current.at, dataAt ?? 0))}</p>
          )}

          {failure !== null && (
            <p className="farm-enroll__failure" role="alert">
              {failure}
            </p>
          )}

          {/* Always mounted, so the region exists before it has something to say. */}
          <div className="farm-enroll__toast-seat" role="status">
            {toast && current !== null && (
              <div className="farm-enroll__toast">
                <span className="farm-enroll__toast-text">{COPIED_TOAST}</span>
                <Button aria-label={DISMISS_TOAST} onClick={() => setToast(false)} size="sm" tone="ghost">
                  ×
                </Button>
              </div>
            )}
          </div>

          <TokenSheet
            listing={listing}
            onClose={() => setSheetOpen(false)}
            onListing={setListing}
            open={sheetOpen}
          />
        </>
      ) : (
        <p className="farm-enroll__note" role="note">
          {MEMBER_NOTE}
        </p>
      )}
    </Card>
  );
}

/** The id the card's `aria-labelledby` points at. */
const TITLE_ID = "enroll-card-title";

/**
 * The command block — mockup 08's `.code`, with the mask in its own ink.
 *
 * A labelled group around a `<pre>`, so the block has a name a reader moving by landmark hears.
 * It wraps rather than scrolls: the card is four columns wide and the installer's URL is long,
 * and nothing on this page scrolls sideways (`docs/DESIGN_SYSTEM_APP_SHELL.md` § 1.3).
 *
 * @param props.command The command **as shown** — never the one that was minted.
 * @param props.mask The mask it carries, drawn apart from the rest.
 * @returns The block.
 */
function CommandBlock({ command, mask }: Readonly<{ command: string; mask: string }>) {
  const parts = commandParts(command, mask);

  return (
    <div aria-label={COMMAND_LABEL} role="group">
      <pre className="farm-enroll__code">
        {parts.before}
        <span className="farm-enroll__mask">{parts.mask}</span>
        {parts.after}
      </pre>
    </div>
  );
}
