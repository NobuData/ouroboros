"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { reconcileFocusRepo } from "@/app/shell/stale-focus";
import { Button, Toggle } from "@/app/ui";

import { scanIssuesNow, setRepositoryEnabled } from "./actions";
import { SCAN_NOW, SCAN_RUNNING, SWITCHING } from "./view";

/**
 * A repository's switch.
 *
 * Writes through {@link setRepositoryEnabled}, then has the page read again. Turning one off
 * also clears a focus on it in the header chip, which would otherwise keep narrowing every
 * screen to a repository nothing reads any more.
 */
export function RepositorySwitch({
  repo,
  name,
  enabled,
  reason,
}: Readonly<{ repo: string; name: string; enabled: boolean; reason?: string }>) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function flip(): Promise<void> {
    if (busy) return;

    setBusy(true);
    setFailure(null);
    const outcome = await setRepositoryEnabled(repo, !enabled);
    setBusy(false);

    if (!outcome.ok) {
      setFailure(outcome.reason);
      return;
    }

    if (enabled) await reconcileFocusRepo();
    router.refresh();
  }

  return (
    <div className="repos-switch">
      <Toggle
        checked={enabled}
        label={`${enabled ? "Turn off" : "Turn on"} ${name}`}
        onClick={() => void flip()}
        reason={busy ? SWITCHING : reason}
      />
      {failure !== null && (
        <p className="repos-switch__failure" role="alert">
          {failure}
        </p>
      )}
    </div>
  );
}

/** *Scan issues now* — asks the Issues backlog for a pass over every repository switched on. */
export function ScanButton({
  running,
  reason,
}: Readonly<{ running: boolean; reason?: string }>) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function scan(): Promise<void> {
    if (busy) return;

    setBusy(true);
    setFailure(null);
    const outcome = await scanIssuesNow();
    setBusy(false);

    if (!outcome.ok) {
      setFailure(outcome.reason);
      return;
    }

    router.refresh();
  }

  return (
    <div className="repos-scan">
      <Button
        onClick={() => void scan()}
        reason={running || busy ? SCAN_RUNNING : reason}
        size="sm"
      >
        {running || busy ? SCAN_RUNNING : SCAN_NOW}
      </Button>
      {failure !== null && (
        <p className="repos-switch__failure" role="alert">
          {failure}
        </p>
      )}
    </div>
  );
}
