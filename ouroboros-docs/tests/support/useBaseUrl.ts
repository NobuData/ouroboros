/**
 * A stand-in for `@docusaurus/useBaseUrl` in tests: the site's `baseUrl` is `/`, so a
 * static path becomes a root-relative URL.
 *
 * @param path a path relative to `static/`.
 * @returns the path with a leading slash.
 */
export default function useBaseUrl(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}
