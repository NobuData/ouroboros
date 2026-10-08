import React, { type ReactNode } from "react";

import styles from "./styles.module.css";

/** A release version: `MAJOR.MINOR.PATCH`. */
const VERSION = /^\d+\.\d+\.\d+$/;

/** Props of {@link Since}. */
export interface SinceProps {
  /** The first release that has the feature, as `MAJOR.MINOR.PATCH`: `"0.7.16"`. */
  version: string;
  /** The module whose version that is, when it is not obvious: `"ouroboros-rest"`. */
  module?: string;
}

/**
 * The badge's wording.
 *
 * @param version the release, `MAJOR.MINOR.PATCH`.
 * @param module the module the version belongs to, if named.
 * @returns e.g. `Since ouroboros-rest 0.7.16`, or `Since 0.7.16`.
 * @throws {Error} when the version is not `MAJOR.MINOR.PATCH`.
 */
export function sinceLabel(version: string, module?: string): string {
  if (!VERSION.test(version)) {
    throw new Error(`<Since> needs a version like 0.7.16, got "${version}"`);
  }
  return ["Since", module?.trim(), version].filter(Boolean).join(" ");
}

/**
 * A small badge saying which release a feature arrived in.
 *
 * @param props.version the release, `MAJOR.MINOR.PATCH`.
 * @param props.module the module that version belongs to (optional).
 * @returns the badge.
 */
export default function Since({ version, module }: SinceProps): ReactNode {
  return <span className={styles.since}>{sinceLabel(version, module)}</span>;
}
