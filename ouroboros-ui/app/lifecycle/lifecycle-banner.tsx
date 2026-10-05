"use client";

import { useEffect, useRef, useState } from "react";

import { organization, unwrap, useSession } from "@/app/api/auth-client";
import { Button } from "@/app/ui";

import {
  PAUSED_GLYPH,
  PAUSED_HEADLINE,
  PAUSED_LABEL,
  RESUME_FAILED,
  RESUME_LABEL,
  RESUMING_LABEL,
  WHO_CAN_RESUME,
  mayResume,
  pausedBanner,
} from "./banner";
import { resumeWorkspace } from "./lifecycle-actions";
import { useLifecycle } from "./lifecycle-store";

import "./lifecycle.css";

/**
 * The app-wide paused banner
 * (BS.6, [#496](https://github.com/NobuData/ouroboros/issues/496)) —
 * *⏸ all loops paused — stages finishing*, on every signed-in screen while the workspace is
 * paused, with the way back beside it.
 *
 * ### It is a row of the shell, not a bar in the pane
 *
 * The shell's frame is a viewport-sized grid whose only scrolling cell is the pane
 * (`app/shell/shell.css`). The banner is a row of that grid between the header and the pane, so
 * it holds still by construction — nothing is `position: fixed` or `sticky` — and it cannot
 * collide with what a page sticks inside its own pane: the CP.4 subnav and bar publish their
 * extents for one another, and a second bar in the pane would be measured as the first.
 *
 * ### The resume path is inline, and never a dead button
 *
 * An owner or admin gets **Resume**, which resumes at once — resuming is the safe direction, and
 * the pause it undoes was the confirmed one. The answer goes into the lifecycle store, so the
 * banner clears on every screen of this tab on the press and in every other tab on its next
 * poll. Anybody else gets a link to the Danger zone, where the page says who can. A refusal is
 * said in the banner.
 *
 * The role is the organization plugin's own answer for the acting workspace — asked only while
 * there is a banner to draw, the way the account menu asks for the word it prints.
 *
 * Draws nothing while the workspace is active, before the first answer, and outside a
 * `LifecycleProvider`.
 *
 * @returns The banner, or nothing.
 */
export function LifecycleBanner() {
  const { lifecycle, apply } = useLifecycle();
  const banner = pausedBanner(lifecycle);

  if (banner === null) return null;

  return <PausedBar actionPath={banner.actionPath} message={banner.message} onResumed={apply} />;
}

/**
 * The bar itself — mounted only while paused, so its role read and its press state begin with
 * the pause and end with it.
 *
 * @param props.message The fuller sentence.
 * @param props.actionPath Where the lifecycle is changed, for a reader who may not resume here.
 * @param props.onResumed Called with the lifecycle a landed resume answered with.
 * @returns The bar.
 */
function PausedBar({
  message,
  actionPath,
  onResumed,
}: Readonly<{
  message: string;
  actionPath: string;
  onResumed: (next: Parameters<ReturnType<typeof useLifecycle>["apply"]>[0]) => void;
}>) {
  const role = useActiveRole();
  const [sending, setSending] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  // A latch beside the state: two presses inside one frame both read `sending` as false.
  const sent = useRef(false);

  /** Resume, and put the answer in the store. */
  async function resume(): Promise<void> {
    if (sent.current) return;

    sent.current = true;
    setSending(true);
    setRefusal(null);

    try {
      const outcome = await resumeWorkspace();

      if (outcome.ok) onResumed(outcome.value);
      else setRefusal(outcome.reason || RESUME_FAILED);
    } finally {
      sent.current = false;
      setSending(false);
    }
  }

  return (
    <section aria-label={PAUSED_LABEL} className="lifecycle-banner" data-lifecycle="paused">
      <p className="lifecycle-banner__line" role="status">
        <span aria-hidden className="lifecycle-banner__glyph">
          {PAUSED_GLYPH}
        </span>
        <strong className="lifecycle-banner__headline">{PAUSED_HEADLINE}</strong>
        <span className="lifecycle-banner__message">{message}</span>
      </p>

      {mayResume(role) ? (
        <Button
          onClick={() => void resume()}
          reason={sending ? RESUMING_LABEL : undefined}
          size="sm"
        >
          {sending ? RESUMING_LABEL : RESUME_LABEL}
        </Button>
      ) : (
        <a className="lifecycle-banner__link" href={actionPath}>
          {WHO_CAN_RESUME}
        </a>
      )}

      {refusal !== null && (
        <p className="lifecycle-banner__refusal" role="alert">
          {refusal}
        </p>
      )}
    </section>
  );
}

/**
 * The reader's role in the acting workspace, as the organization plugin reports it.
 *
 * Remembered *with* the workspace it was asked for (`app/shell/user-menu.tsx`'s staleness rule):
 * an answer that survives a workspace switch is void the moment it no longer describes where the
 * session is.
 *
 * @returns The role — possibly several, comma-separated — or `null` while it is not known.
 */
function useActiveRole(): string | null {
  const session = useSession();
  const activeOrganizationId = session.data?.session.activeOrganizationId ?? null;
  const [member, setMember] = useState<{ organizationId: string; role: string } | null>(null);

  useEffect(() => {
    if (activeOrganizationId === null) return;

    let cancelled = false;

    organization
      .getActiveMemberRole()
      .then((answer) => {
        if (cancelled) return;

        const found = unwrap(answer, "/organization/get-active-member-role");
        if (typeof found?.role === "string") {
          setMember({ organizationId: activeOrganizationId, role: found.role });
        }
      })
      .catch(() => {
        // Not known: the bar offers the link, which is right for every role.
      });

    return () => {
      cancelled = true;
    };
  }, [activeOrganizationId]);

  return member !== null && member.organizationId === activeOrganizationId ? member.role : null;
}
