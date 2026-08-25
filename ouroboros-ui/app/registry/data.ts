import "server-only";

/**
 * Everything the `/models/registry` frame reads.
 *
 * One call today — the workspace's provider connections, which is the list **Import from
 * provider** offers — and the module exists anyway, for the reason `app/models/data.ts` and
 * `app/dashboard/data.ts` exist: the route stays three lines, the composition is a function
 * that can be tested against a stub, and the screen is handed one object rather than issuing
 * calls of its own. CI.2–CI.5 add the alias table, the price catalog and the chain card here
 * beside it, and the property that has to survive them is the one those files establish —
 * **one failed read is one degraded region, never a blank page**.
 *
 * ### Why the health endpoint, for a list that is not about health
 *
 * `GET /api/v1/routing/providers` is the only read this application has over
 * `provider_connections` today (`app/api/routing.ts`), and it answers exactly the question
 * this page asks: *which providers has this workspace connected*. Mockup 07's own management
 * surface reads the same table through `app/api/providers.ts` since AE.2
 * ([#228](https://github.com/NobuData/ouroboros/issues/228)), and this page deliberately keeps
 * the strip: the cards need masks, caps and names, and a menu of import sources needs none
 * of them — a second, heavier read for the same list would be a second answer to one
 * question. The health each row carries is simply not read here — see `importSources` in
 * `app/registry/view.ts` for why a paused connection is still a connection.
 *
 * {@link attempt} is `app/api/reading.ts`'s, shared with the dashboard and the routing page.
 * It catches an `ApiError` and nothing else, deliberately: a `401` reaches this layer as
 * Next.js's redirect signal rather than as an error (`app/api/server.ts`), and a `catch` wide
 * enough to hold it would swallow the navigation to the login screen and draw a registry page
 * captioned with the framework's internal message.
 */

import type { Workspace } from "@/app/api/access";
import { attempt } from "@/app/api/reading";
import { routing } from "@/app/api/routing";

import type { RegistryReadings } from "./view";

/**
 * Read the registry page.
 *
 * @param access The workspace the gate returned. **A precondition made visible in the type
 *   rather than a source of values**: none of its fields is read, because the read is scoped
 *   to the session's own active organization and this client sends no tenant header
 *   (`app/api/server.ts`). Taking it anyway is what makes the page's authorization and the
 *   page's data one decision — there is no way to reach this read without having been through
 *   the gate, which is the property `app/(app)/layout.tsx` argues a layout cannot provide.
 * @returns Everything the screen draws, each part either read or explained.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all, which is how a
 *   session that expired between the gate and this call still reaches the login screen.
 */
export async function readRegistry(access: Workspace): Promise<RegistryReadings> {
  // Held, not read — see the parameter's note. The statement is what says so in code, so
  // nobody deletes an argument that is carrying a proof.
  void access;

  const providers = await attempt(async () => (await routing.providers()).providers);

  return { providers };
}
