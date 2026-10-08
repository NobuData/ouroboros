import React, { useEffect, useRef, type ReactNode } from "react";
import ErrorBoundary from "@docusaurus/ErrorBoundary";
import { ErrorBoundaryErrorMessageFallback } from "@docusaurus/theme-common";
import {
  MermaidContainerClassName,
  useMermaidRenderResult,
} from "@docusaurus/theme-mermaid/client";

import type { MermaidConfig } from "./brandTheme";
import { useBrandMermaidConfig } from "./useBrandMermaidConfig";
import styles from "./styles.module.css";

/**
 * The site's Mermaid diagram — `@docusaurus/theme-mermaid`'s own component (swizzled,
 * CY.4 #1167) with one change: it renders with {@link useBrandMermaidConfig}, so diagrams
 * take their colours from the brand tokens in both themes.
 */

/** Props of a ```mermaid code block, as Docusaurus passes them. */
interface Props {
  /** The diagram source. */
  value: string;
}

/**
 * Inserts Mermaid's SVG and binds its interactive functions (click handlers).
 *
 * @param props.renderResult what `mermaid.render` returned.
 * @returns the diagram container.
 */
function MermaidRenderResult({
  renderResult,
}: {
  renderResult: NonNullable<ReturnType<typeof useMermaidRenderResult>>;
}): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) renderResult.bindFunctions?.(ref.current);
  }, [renderResult]);
  return (
    <div
      ref={ref}
      className={`${MermaidContainerClassName} ${styles.container}`}
      // Mermaid's own output, rendered from the page's own source — the theme does the same.
      dangerouslySetInnerHTML={{ __html: renderResult.svg }}
    />
  );
}

/**
 * Renders the diagram once the brand config is known.
 *
 * @param props.value the diagram source.
 * @param props.config the brand config.
 * @returns the diagram, or nothing while Mermaid works.
 */
function MermaidRenderer({ value, config }: Props & { config: MermaidConfig }): ReactNode {
  const renderResult = useMermaidRenderResult({ text: value, config });
  return renderResult === null ? null : <MermaidRenderResult renderResult={renderResult} />;
}

/**
 * A Mermaid diagram in the brand's colours.
 *
 * @param props.value the diagram source.
 * @returns the diagram; a syntax error shows the theme's error message instead of breaking
 *   the page.
 */
export default function Mermaid({ value }: Props): ReactNode {
  const config = useBrandMermaidConfig();
  return (
    <ErrorBoundary fallback={(params) => <ErrorBoundaryErrorMessageFallback {...params} />}>
      {config === null ? null : <MermaidRenderer value={value} config={config} />}
    </ErrorBoundary>
  );
}
