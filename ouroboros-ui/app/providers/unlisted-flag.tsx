/**
 * The flag on a model a routing alias still names that the provider no longer lists
 * ([#230](https://github.com/NobuData/ouroboros/issues/230)).
 *
 * Mockup 07's `local/deepseek-v3.2 ⚠ removed upstream — alias local-ds still points here →`.
 * The model has no chip of its own any more — discovery dropped it, because the catalog is
 * discovery's report of what exists — so this is what stands where the chip was: the id the
 * alias spells, the warning, and a link to each alias whose route is now broken. Rendered by
 * both the chips and the pull-list, and shared so the two say it the same way.
 *
 * No state and no hooks, so either island renders it.
 */

import Link from "next/link";

import type { UnlistedModel } from "@/app/api/providers";
import { Chip } from "@/app/ui";

import { UNLISTED_FLAG, UNLISTED_POINTS_HERE, aliasLinks } from "./live";

/** What the flag takes. */
export interface UnlistedFlagProps {
  /** The stranded model and its aliases. */
  readonly unlisted: UnlistedModel;
}

/**
 * One flagged model.
 *
 * @param props See {@link UnlistedFlagProps}.
 * @returns The chip in the warn tone, and the sentence with its links.
 */
export function UnlistedFlag({ unlisted }: UnlistedFlagProps) {
  const links = aliasLinks(unlisted);

  return (
    <span className="providers-card__unlisted">
      <Chip mono tone="warn">
        {unlisted.modelId}
      </Chip>
      <span className="providers-card__unlisted-flag" role="status">
        <span aria-hidden="true">⚠</span> {UNLISTED_FLAG} —{" "}
        {links.map((link, index) => (
          <span key={link.name}>
            {index > 0 && ", "}
            alias{" "}
            <Link className="providers-card__alias-link" href={link.href}>
              {link.name}
            </Link>
          </span>
        ))}{" "}
        {UNLISTED_POINTS_HERE}
      </span>
    </span>
  );
}
