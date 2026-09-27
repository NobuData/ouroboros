/**
 * How an artifact is handed to a browser — its content type, inline or attachment, and the
 * headers that make serving uploaded bytes safe (AT.5,
 * [#333](https://github.com/NobuData/ouroboros/issues/333)).
 *
 * **Text kinds preview inline; everything else downloads.** A JUnit report, a HIL results file, a
 * coverage report and a log are what a person opens to read; a rig capture is 2.1 MB of CSV
 * that belongs in a spreadsheet, not a browser tab, and `other` is whatever a pool's globs
 * collected. Inline is also refused whenever the file's type is not one of {@link INLINE_TYPES},
 * so a `.html` a runner uploaded as a log is still an attachment.
 *
 * **The bytes are the runner's, not ours.** Every answer carries `nosniff` and a sandboxing
 * content security policy, so a file that happens to contain markup can neither be sniffed into
 * HTML nor run script on this origin — whatever its name says.
 *
 * Pure: a name and a kind in, headers out.
 */

import type { TestArtifactKind } from "../db/schema";

/** The kinds a person opens to read — `junit`, `hil`, `coverage`, `log`. */
export const PREVIEWABLE_KINDS: ReadonlySet<TestArtifactKind> = new Set<TestArtifactKind>([
  "junit",
  "hil",
  "coverage",
  "log",
]);

/** What an unknown extension is served as — bytes, never a guess. */
export const OCTET_STREAM = "application/octet-stream";

/** Content types by extension, lowercased. Anything not listed is {@link OCTET_STREAM}. */
const TYPES_BY_EXTENSION: Readonly<Record<string, string>> = {
  xml: "application/xml",
  json: "application/json",
  csv: "text/csv; charset=utf-8",
  log: "text/plain; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  info: "text/plain; charset=utf-8",
  lcov: "text/plain; charset=utf-8",
  out: "text/plain; charset=utf-8",
};

/** The types a browser may render inline — text a browser shows as text, never markup it runs. */
export const INLINE_TYPES: ReadonlySet<string> = new Set([
  "application/xml",
  "application/json",
  "text/plain; charset=utf-8",
]);

/**
 * Headers every artifact answer carries: never sniffed, never scripted, never cached by a shared
 * cache (it is a workspace's file).
 */
export const ARTIFACT_SAFETY_HEADERS: Readonly<Record<string, string>> = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "sandbox; default-src 'none'",
  "Cache-Control": "private, no-cache",
};

/** How one artifact is served. */
export interface ArtifactPresentation {
  readonly contentType: string;
  /** `inline` — the browser shows it; `attachment` — the browser saves it. */
  readonly disposition: "inline" | "attachment";
  /** The whole `Content-Disposition` header. */
  readonly contentDisposition: string;
}

/**
 * The file's own name — the last segment of its manifest path.
 *
 * @param name - `test_artifacts.name`, e.g. `build/zephyr/junit-build3.xml`.
 * @returns `junit-build3.xml`.
 */
export function baseName(name: string): string {
  const segments = name.split("/");
  return segments[segments.length - 1] || name;
}

/**
 * The content type a name's extension implies.
 *
 * @param name - The artifact's name.
 * @returns One of {@link TYPES_BY_EXTENSION}'s values, or {@link OCTET_STREAM}.
 */
export function contentTypeOf(name: string): string {
  const file = baseName(name);
  const dot = file.lastIndexOf(".");
  if (dot <= 0) return OCTET_STREAM;

  return TYPES_BY_EXTENSION[file.slice(dot + 1).toLowerCase()] ?? OCTET_STREAM;
}

/**
 * Whether an artifact opens in the browser.
 *
 * @param kind - `test_artifacts.kind`.
 * @param name - The artifact's name.
 * @returns True for a previewable kind whose type is safe to render inline.
 */
export function isPreviewable(kind: TestArtifactKind, name: string): boolean {
  return PREVIEWABLE_KINDS.has(kind) && INLINE_TYPES.has(contentTypeOf(name));
}

/**
 * A `Content-Disposition` header naming the file — an ASCII `filename` for old clients, and the
 * exact name as RFC 5987's `filename*`. Nothing a name carries can end the header early: quotes,
 * backslashes and control characters never reach the ASCII form, and the encoded form escapes
 * everything but RFC 5987's attribute characters.
 *
 * @param disposition - `inline` or `attachment`.
 * @param name - The artifact's name.
 * @returns The header value.
 */
export function contentDisposition(disposition: "inline" | "attachment", name: string): string {
  const file = baseName(name);
  const ascii = file.replace(/[^A-Za-z0-9._ -]/g, "_");
  const encoded = encodeURIComponent(file).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/**
 * How an artifact is served.
 *
 * @param kind - `test_artifacts.kind`.
 * @param name - `test_artifacts.name`.
 * @returns Its type and disposition.
 */
export function presentationOf(kind: TestArtifactKind, name: string): ArtifactPresentation {
  const disposition = isPreviewable(kind, name) ? "inline" : "attachment";

  return {
    contentType: contentTypeOf(name),
    disposition,
    contentDisposition: contentDisposition(disposition, name),
  };
}
