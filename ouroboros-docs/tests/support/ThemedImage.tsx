import React, { type ImgHTMLAttributes, type ReactNode } from "react";

/**
 * A stand-in for `@theme/ThemedImage` in tests: one `<img>` per theme, each tagged with
 * its theme, as the real component renders them before hydration.
 *
 * @param props.sources the light and dark image URLs.
 * @returns both images.
 */
export default function ThemedImage({
  sources,
  ...rest
}: ImgHTMLAttributes<HTMLImageElement> & { sources: { light: string; dark: string } }): ReactNode {
  return (
    <>
      <img {...rest} src={sources.light} data-theme-variant="light" />
      <img {...rest} src={sources.dark} data-theme-variant="dark" />
    </>
  );
}
