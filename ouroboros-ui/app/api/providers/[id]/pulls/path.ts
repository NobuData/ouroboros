/**
 * The path a pull-list polls for one connection — beside the route handler that answers it,
 * in a file a Client Component may import (a `route.ts` is server-only by convention).
 *
 * @param connectionId The connection.
 * @returns The path, relative to this origin.
 */
export function pullsPath(connectionId: string): string {
  return `/api/providers/${encodeURIComponent(connectionId)}/pulls`;
}
