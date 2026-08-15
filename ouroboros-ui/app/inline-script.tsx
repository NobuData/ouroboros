"use client";

/**
 * The one sanctioned way to put a bootstrap `<script>` in the document.
 *
 * The scripts this wraps (theme, sidebar, font scale) only ever do their work on a full
 * page load: the browser executes them synchronously while parsing the server's HTML,
 * before first paint. A script element that React itself creates on the client is never
 * executed at all, and React's development build says so out loud — "Encountered a
 * script tag while rendering React component" — every time a client render produces
 * one, which the Strict Mode remount of `<head>` does on every dev load.
 *
 * The bundled guide's answer (02-guides/preventing-flash-before-hydration.md,
 * "Extracting a reusable component") is the type swap below: the server renders the real
 * thing, and any client render produces `type="text/plain"` — inert on purpose, because
 * the moment a client render is happening, first paint is long past and the bootstrap's
 * job is already done or missed. `suppressHydrationWarning` covers the deliberate
 * attribute mismatch.
 *
 * @param html The bootstrap source, generated from the module that reads it back.
 * @returns The script element, executable only in server-rendered HTML.
 */
export function InlineScript({ html }: { html: string }) {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
