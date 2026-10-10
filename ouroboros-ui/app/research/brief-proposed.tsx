"use client";

import type { GapProposals } from "@/app/api/research";
import { Tag } from "@/app/ui";

import { PROPOSED_PREFIX, effortLetter, moreLabel } from "./brief";

/**
 * Mockup 22's **Proposed from gaps:** row (CN.4,
 * [#630](https://github.com/NobuData/ouroboros/issues/630)) — the epic, the first ticket stubs,
 * how many more, and the effort roll-up, exactly as #621 proposes them: a preview of what
 * **Draft epic from gaps →** will create, and nothing is created by drawing it.
 *
 * @param props.proposed The proposals.
 * @returns The row.
 */
export function ProposedFromGaps({ proposed }: Readonly<{ proposed: GapProposals }>) {
  const more = moreLabel(proposed.more);
  const effort = effortLetter(proposed.effort);

  return (
    <div aria-label={PROPOSED_PREFIX} className="research__proposed" role="group">
      <span className="research__proposed-label">{PROPOSED_PREFIX}</span>
      <Tag>{proposed.epic.label}</Tag>
      {proposed.top.map((ticket) => (
        <Tag key={ticket.key} title={ticket.capability}>
          {ticket.label}
        </Tag>
      ))}
      {more !== null && <Tag>{more}</Tag>}
      {effort !== null && <span className="research__proposed-effort">{effort}</span>}
    </div>
  );
}
