import React, { type ReactNode } from "react";
import Link from "@docusaurus/Link";

import styles from "./styles.module.css";

/** The configuration reference page, which lists every variable (DB.3, #1191). */
export const CONFIG_REFERENCE_ROUTE = "/administration/configuration";

/** What a variable name looks like: upper case, digits and underscores, e.g. `OURO_SMTP_URL`. */
const ENV_VAR_NAME = /^[A-Z][A-Z0-9_]*$/;

/**
 * The anchor of a variable's entry on the configuration reference.
 *
 * The reference gives each variable a heading named after it, and Docusaurus derives a
 * heading's id by lower-casing it, so `OURO_SMTP_URL` lives at `#ouro_smtp_url`.
 *
 * @param name the variable's name.
 * @returns the link target, e.g. `/administration/configuration#ouro_smtp_url`.
 * @throws {Error} when the name is not an environment variable name.
 */
export function envVarHref(name: string): string {
  if (!ENV_VAR_NAME.test(name)) {
    throw new Error(`<EnvVar> needs a variable name like OURO_SMTP_URL, got "${name}"`);
  }
  return `${CONFIG_REFERENCE_ROUTE}#${name.toLowerCase()}`;
}

/** Props of {@link EnvVar}. */
export interface EnvVarProps {
  /** The variable, exactly as `.env.example` spells it: `OURO_SMTP_URL`. */
  name: string;
}

/**
 * An environment variable, in the code face, linked to its entry in the configuration
 * reference. The link is checked at build time: a variable the reference does not list
 * fails `yarn build` as a broken anchor.
 *
 * @param props.name the variable's name.
 * @returns the linked name.
 */
export default function EnvVar({ name }: EnvVarProps): ReactNode {
  return (
    <Link to={envVarHref(name)} className={styles.envVar}>
      <code>{name}</code>
    </Link>
  );
}
