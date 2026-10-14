import type { SyncStatus } from "@/app/api/backlog";
import type { GithubToken } from "@/app/api/github-token";
import type { Reading } from "@/app/api/reading";
import { relativeAgo } from "@/app/format";
import { SOURCES_PATH } from "@/app/paths";
import { SettingsFrame } from "@/app/settings/settings-frame";
import { Button, Card, EmptyState } from "@/app/ui";

import { RepositorySwitch, ScanButton } from "./controls";
import type { RepositoriesReadings } from "./data";
import {
  ADD_SOURCE_LINK,
  EMPTY_NOTE,
  EMPTY_TITLE,
  LIST_FAILED_TITLE,
  LIST_LABEL,
  NO_SOURCE,
  REPOSITORIES_SUBLINE,
  REPOSITORIES_TITLE,
  SCANNING_TITLE,
  SCAN_READ_ONLY,
  STATUS_UNREAD,
  TOKEN_MISSING,
  TOKEN_SET,
  repoScanLine,
  repositoryGroups,
  scanningLine,
  scansByRepo,
  switchReason,
} from "./view";
import "./repositories.css";

export interface RepositoriesScreenProps {
  readonly workspaceName: string;
  /** Owner or Admin: may switch repositories on and off. */
  readonly mayAdminister: boolean;
  /** Member or above: may start a scan. */
  readonly mayContribute: boolean;
  readonly readings: RepositoriesReadings;
}

/**
 * Settings → Repositories: where the repositories are, which source names each one, whether it
 * is switched on, and whether their issues are being scanned — in one place, where before they
 * were three screens' business (`./view.ts`).
 */
export function RepositoriesScreen({
  workspaceName,
  mayAdminister,
  mayContribute,
  readings,
}: RepositoriesScreenProps) {
  return (
    <SettingsFrame
      actions={
        <Button href={SOURCES_PATH} size="sm">
          {ADD_SOURCE_LINK}
        </Button>
      }
      active="repositories"
      subline={REPOSITORIES_SUBLINE}
      title={REPOSITORIES_TITLE}
      workspaceName={workspaceName}
    >
      <ScanningCard
        mayContribute={mayContribute}
        now={readings.now}
        scanning={readings.scanning}
        token={readings.backlogToken}
      />
      <RepositoryList mayAdminister={mayAdminister} readings={readings} />
    </SettingsFrame>
  );
}

function ScanningCard({
  scanning,
  token,
  now,
  mayContribute,
}: Readonly<{
  scanning: Reading<SyncStatus>;
  token: Reading<GithubToken> | null;
  now: string;
  mayContribute: boolean;
}>) {
  // The token itself is readable only by an Owner or Admin; the sync's own pause says the same
  // thing to everyone else.
  const tokenMissing =
    (token?.ok === true && !token.value.configured) ||
    (scanning.ok && scanning.value.pause === "not_configured");
  const line = scanning.ok
    ? scanningLine(
        scanning.value,
        scanning.value.syncedAt === null ? null : relativeAgo(scanning.value.syncedAt, new Date(now)),
      )
    : STATUS_UNREAD;

  return (
    <Card className="repos-scanning">
      <div className="repos-scanning__body">
        <h2 className="repos-scanning__title">{SCANNING_TITLE}</h2>
        {line !== null && <p className="repos-scanning__line">{line}</p>}
        <p className={tokenMissing ? "repos-scanning__warn" : "repos-scanning__note"}>
          {tokenMissing ? TOKEN_MISSING : TOKEN_SET}
        </p>
      </div>
      <ScanButton
        reason={mayContribute ? undefined : SCAN_READ_ONLY}
        running={scanning.ok && scanning.value.running}
      />
    </Card>
  );
}

function RepositoryList({
  readings,
  mayAdminister,
}: Readonly<{ readings: RepositoriesReadings; mayAdminister: boolean }>) {
  if (!readings.enablement.ok || !readings.sources.ok) {
    const reason = !readings.enablement.ok
      ? readings.enablement.reason
      : (readings.sources as { reason: string }).reason;

    return (
      <Card className="repos-seat" fill>
        <EmptyState fill note={reason} title={LIST_FAILED_TITLE} />
      </Card>
    );
  }

  const groups = repositoryGroups(readings.enablement.value, readings.sources.value);
  const scans = readings.scanning.ok ? scansByRepo(readings.scanning.value) : new Map();
  const now = new Date(readings.now);

  if (groups.length === 0) {
    return (
      <Card className="repos-seat" fill>
        <EmptyState fill note={EMPTY_NOTE} title={EMPTY_TITLE}>
          <Button href={SOURCES_PATH} size="sm">
            {ADD_SOURCE_LINK}
          </Button>
        </EmptyState>
      </Card>
    );
  }

  return (
    <section aria-label={LIST_LABEL} className="repos-groups">
      {groups.map((group) => (
        <Card className="repos-group" key={group.login}>
          <h2 className="repos-group__login">{group.login}</h2>
          <ul className="repos-list">
            {group.repos.map((row) => (
              <li className="repos-row" key={row.repo}>
                <span className="repos-row__name">{row.name}</span>
                <span className={row.sources.length === 0 ? "repos-row__none" : "repos-row__source"}>
                  {row.sources.length === 0 ? NO_SOURCE : row.sources.join(", ")}
                </span>
                <span className="repos-row__scan">
                  {readings.scanning.ok ? repoScanLine(row.enabled, scans.get(row.repo), now) : ""}
                </span>
                <RepositorySwitch
                  enabled={row.enabled}
                  name={row.name}
                  reason={switchReason(row, mayAdminister)}
                  repo={row.repo}
                />
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </section>
  );
}
