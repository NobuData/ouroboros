import React, { type AnchorHTMLAttributes, type ReactNode } from "react";

/**
 * A stand-in for `@docusaurus/Link` in component tests: a plain anchor, so a test can read
 * where a component links without a Docusaurus router.
 *
 * @param props.to the link target.
 * @returns an `<a href={to}>` carrying the other props.
 */
export default function Link({
  to,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }): ReactNode {
  return <a href={to} {...rest} />;
}
