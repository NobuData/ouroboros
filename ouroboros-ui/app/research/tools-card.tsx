"use client";

import type { Reading } from "@/app/api/reading";
import type { ResearchToolCatalog, ResearchToolCatalogEntry } from "@/app/api/research";
import { Card, CardHead, EmptyState, Tag } from "@/app/ui";

import { NO_TOOLS, TOOLS_TITLE, TOOLS_UNREADABLE, connectedTag, dotLabel, offersEnable } from "./side";
import { NO_TOOL_CONNECTED_NOTE, NO_TOOL_CONNECTED_READ_ONLY, noToolConnected } from "./states";
import { ToolEnable } from "./tools-enable";
import { regionTitleId } from "./view";

/**
 * The research tools card (CN.3, [#629](https://github.com/NobuData/ouroboros/issues/629)) —
 * mockup 22's side column, top.
 *
 * **Every fact on a row is the service's.** The glyph and name are the adapter's, the sub-line
 * is its template filled with this workspace's live counts, the dot is its health check under
 * this workspace's settings, and the *N connected* tag is counted from those dots. The card adds
 * no state of its own, so it cannot disagree with the tools it lists.
 *
 * An idle row offers **enable** — the tool's own configuration form, or, for a tool with no
 * adapter yet, the note saying when it arrives.
 */

/** The class for each dot — literals, so the style suite can see every one. */
const DOT_CLASS: Record<ResearchToolCatalogEntry["health"]["dot"], string> = {
  ok: "research__dot research__dot--ok",
  warn: "research__dot research__dot--warn",
  err: "research__dot research__dot--err",
  idle: "research__dot research__dot--idle",
};

/** What the card takes. */
export interface ToolsCardProps {
  /** The catalog, or why it could not be read. */
  readonly reading: Reading<ResearchToolCatalog>;
  /** Whether the reader may enable a tool. */
  readonly mayAdminister: boolean;
  /** Called once a tool's settings are stored, so the page re-reads. */
  readonly onChanged: () => void;
}

/**
 * The card.
 *
 * @param props See {@link ToolsCardProps}.
 * @returns The tools, one row each.
 */
export function ToolsCard({ reading, mayAdminister, onChanged }: ToolsCardProps) {
  const titleId = regionTitleId("tools");

  return (
    <Card aria-labelledby={titleId} as="section">
      <CardHead
        title={TOOLS_TITLE}
        titleId={titleId}
        trailing={reading.ok ? <Tag>{connectedTag(reading.value)}</Tag> : undefined}
      />

      {!reading.ok && <EmptyState note={reading.reason} title={TOOLS_UNREADABLE} variant="flush" />}
      {reading.ok && reading.value.tools.length === 0 && <EmptyState note={NO_TOOLS} variant="flush" />}
      {reading.ok && noToolConnected(reading.value) && (
        <p className="research__side-lead">
          {mayAdminister ? NO_TOOL_CONNECTED_NOTE : NO_TOOL_CONNECTED_READ_ONLY}
        </p>
      )}
      {reading.ok && reading.value.tools.length > 0 && (
        <ul className="research__side-list">
          {reading.value.tools.map((tool) => (
            <li className="research__side-row" key={tool.slug}>
              <span aria-hidden="true" className="research__tool-glyph">
                {tool.glyph}
              </span>
              <span className="research__side-text">
                <span className="research__side-name">{tool.name}</span>
                {tool.subLine !== null && <span className="research__side-sub">{tool.subLine}</span>}
              </span>
              <span
                aria-label={dotLabel(tool)}
                className={DOT_CLASS[tool.health.dot]}
                role="img"
                title={tool.health.detail}
              />
              {offersEnable(tool) && (
                <ToolEnable mayAdminister={mayAdminister} onEnabled={onChanged} tool={tool} />
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
