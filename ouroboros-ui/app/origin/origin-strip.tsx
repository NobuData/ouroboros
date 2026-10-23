import Link from "next/link";

import { type DataOrigin, type OriginFilter, READINESS_LINK, originStrip } from "./origin";

import "./origin.css";

/**
 * The page-level strip (DJ.3, [#1316](https://github.com/NobuData/ouroboros/issues/1316)): drawn
 * when a page's content is entirely non-live — *"This page is showing demo data. No real loop has
 * run in this workspace yet."* — with the readiness check beside it. Nothing when any live data
 * exists, or when the workspace holds nothing at all (its empty states speak instead).
 *
 * @param props.present Every origin the page's figures and rows hold.
 * @param props.filter The origin the page is showing.
 * @returns The strip, or null.
 */
export function OriginStrip({
  present,
  filter,
}: Readonly<{ present: readonly DataOrigin[]; filter: OriginFilter }>) {
  const view = originStrip(present, filter);

  if (view === null) return null;

  return (
    <p className="origin-strip" role="note">
      <span className="origin-strip__text">{view.text}</span>
      <Link className="origin-strip__link" href={READINESS_LINK.href}>
        {READINESS_LINK.label}
      </Link>
    </p>
  );
}
