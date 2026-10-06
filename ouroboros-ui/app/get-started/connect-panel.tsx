"use client";

import Link from "next/link";
import { useId } from "react";

import type { Reading } from "@/app/api/reading";
import { SOURCES_PATH } from "@/app/paths";
import { AddSourceButton, AddSourceFlow } from "@/app/sources/add-source";
import type { SourcesReadings } from "@/app/sources/data";
import { SourceRow } from "@/app/sources/source-row";
import { Card, CardHead, Chip } from "@/app/ui";
import { cx } from "@/app/ui/class-names";

import {
  type Abilities,
  CONNECT_LINE,
  CONNECT_LIST_LABEL,
  CONNECT_LOADING,
  CONNECT_NEXT,
  CONNECT_NONE,
  CONNECT_PILL_ACTIVE,
  CONNECT_PILL_DONE,
  CONNECT_SETTINGS_LABEL,
  CONNECT_TITLE,
  githubSources,
} from "./view";

import "@/app/sources/sources.css";
import "./get-started.css";

/** What {@link ConnectPanel} takes. */
export interface ConnectPanelProps {
  /** The workspace's ticket sources, as Settings → Sources reads them — or null while loading. */
  readonly sources: Reading<SourcesReadings> | null;
  /** Whether the rail says step 1 is done. */
  readonly stepDone: boolean;
  /** What the person may do: owners and admins add, test, sync and pause sources. */
  readonly abilities: Abilities;
}

/**
 * Step 1's embedded flow (BC.6, [#395](https://github.com/NobuData/ouroboros/issues/395)) —
 * *Connect GitHub* inside the wizard's frame.
 *
 * **No parallel implementation.** Connecting a source is `app/sources`' machinery
 * ([#141](https://github.com/NobuData/ouroboros/issues/141)): the same add-source dialog
 * (`AddSourceFlow`, catalog → the provider's own form → done) and the same rows
 * (`SourceRow`, with their Test / Sync / Pause / Resume controls) that Settings → Sources draws,
 * mounted here unchanged. What the wizard adds is the framing — which step this is, what comes
 * next — and keeps the return path: the Settings link, for a person who would rather do it there.
 *
 * **The regression lever lives here too.** A source paused in one of these rows regresses step 1
 * on the rail's next poll, with the service's reason in the banner above — and *Resume* in the
 * same row is the fix the banner points at.
 *
 * A viewer sees the opener inert with the sources module's own reason, and the rows with their
 * controls read-only, exactly as Settings → Sources would show them.
 *
 * @param props See {@link ConnectPanelProps}.
 * @returns The card.
 */
export function ConnectPanel({ sources, stepDone, abilities }: ConnectPanelProps) {
  const titleId = useId();
  const connected = sources?.ok === true ? githubSources(sources.value.sources.ok ? sources.value.sources.value : []) : [];

  return (
    <AddSourceFlow mayAdminister={abilities.administer}>
      <Card aria-labelledby={titleId} as="section" className="wizard-connect">
        <CardHead
          beside={
            stepDone ? (
              <Chip tone="ok">{CONNECT_PILL_DONE}</Chip>
            ) : (
              <Chip dot="pulse" tone="accent">
                {CONNECT_PILL_ACTIVE}
              </Chip>
            )
          }
          title={CONNECT_TITLE}
          titleId={titleId}
          trailing={
            <Link className="wizard-connect__settings" href={SOURCES_PATH}>
              {CONNECT_SETTINGS_LABEL}
            </Link>
          }
        />
        <p className="wizard-connect__line">{CONNECT_LINE}</p>

        {sources === null ? (
          <p aria-busy className="wizard-connect__state" role="status">
            {CONNECT_LOADING}
          </p>
        ) : !sources.ok ? (
          <p className="wizard-connect__failure" role="alert">
            {sources.reason}
          </p>
        ) : !sources.value.sources.ok ? (
          <p className="wizard-connect__failure" role="alert">
            {sources.value.sources.reason}
          </p>
        ) : connected.length === 0 ? (
          <p className="wizard-connect__state">{CONNECT_NONE}</p>
        ) : (
          <ul aria-label={CONNECT_LIST_LABEL} className={cx("sources-list", "wizard-connect__list")}>
            {connected.map((source) => (
              <SourceRow
                entry={
                  sources.value.catalog.ok
                    ? (sources.value.catalog.value.find((entry) => entry.kind === source.kind) ?? null)
                    : null
                }
                key={source.id}
                mayAdminister={abilities.administer}
                now={new Date(sources.value.now)}
                source={source}
                status={sources.value.statuses.get(source.id) ?? null}
              />
            ))}
          </ul>
        )}

        <div className="wizard-connect__actions">
          <AddSourceButton />
          <p className="wizard-connect__next">{CONNECT_NEXT}</p>
        </div>
      </Card>
    </AddSourceFlow>
  );
}
