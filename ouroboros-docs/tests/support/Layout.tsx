import React, { type ReactNode } from "react";

/**
 * A stand-in for `@theme/Layout` in tests: renders the page's children and exposes the
 * title and description it was given as data attributes, so a test can read them.
 *
 * @param props.title the page title.
 * @param props.description the meta description.
 * @param props.children the page body.
 * @returns a wrapper around the body.
 */
export default function Layout({
  title,
  description,
  children,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
}): ReactNode {
  return (
    <div data-testid="layout" data-title={title} data-description={description}>
      {children}
    </div>
  );
}
