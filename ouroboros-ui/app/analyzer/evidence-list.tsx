"use client";

import Link from "next/link";

import type { EvidenceLink } from "./duration-view";

/**
 * A finding's evidence, as both of the analyzer's Details sheets draw it (BW.2,
 * [#517](https://github.com/NobuData/ouroboros/issues/517); BW.3,
 * [#518](https://github.com/NobuData/ouroboros/issues/518)) — the change-point sheet behind a
 * chip and the suggestion sheet behind a row.
 *
 * One line per reference: what kind it is, what it names — **a link to the surface it resolves
 * on** (the build farm, a pull request, the workflow studio, a loop's test results) — a merge's
 * short sha, and where it opens. A reference whose row is gone keeps its id, is plain text, and
 * says it can no longer be opened: it is never a link to somewhere plausible.
 *
 * @param props.links The references, as `evidenceLink` resolved them, in the finding's order.
 * @returns The list.
 */
export function EvidenceList({ links }: Readonly<{ links: readonly EvidenceLink[] }>) {
  return (
    <ul className="analyzer-ev">
      {links.map((link) => (
        <li className="analyzer-ev__ref" key={link.key}>
          <span className="analyzer-ev__kind">{link.kind}</span>
          <Reference label={link.name} link={link} />
          {link.detail !== null && <span className="analyzer-ev__detail">{link.detail}</span>}
          <span className="analyzer-ev__where">
            {link.href === null ? link.destination : `opens in ${link.destination}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * A reference's name — a link to the surface it resolves on, or plain text when it opens nothing.
 *
 * @param props.label What to call it.
 * @param props.link Where it opens, if anywhere.
 * @returns The link, or the text.
 */
export function Reference({ label, link }: Readonly<{ label: string; link: EvidenceLink | null }>) {
  return link === null || link.href === null ? (
    <span>{label}</span>
  ) : (
    <Link className="analyzer-ev__link" href={link.href}>
      {label}
    </Link>
  );
}
