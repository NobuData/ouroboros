import "server-only";

/**
 * Everything the `/models/registry` page reads.
 *
 * Two calls — the workspace's provider connections, which every control on the page that names
 * a provider is drawn from, and CH.5's composed registry payload
 * ([#588](https://github.com/NobuData/ouroboros/issues/588)), which is every cell of the
 * allowed-models table (CI.2, [#592](https://github.com/NobuData/ouroboros/issues/592)) and
 * the inspector's whole prefill (CI.3,
 * [#593](https://github.com/NobuData/ouroboros/issues/593)) — issued together and each allowed
 * to fail on its own, for the reason `app/models/data.ts` and `app/dashboard/data.ts` exist:
 * the route stays three lines, the composition is a function that can be tested against a
 * stub, and the screen is handed one object rather than issuing calls of its own. CI.5 adds
 * the chain card here beside them, and the property that has to survive it is the one those
 * files establish — **one failed read is one degraded region, never a blank page**.
 *
 * ### The table is one request, and that is a correctness property
 *
 * `GET /api/v1/registry` joins five subsystems in one payload rather than having this reader
 * assemble them; the contract says why, and the half that would break is the table: a page
 * that read aliases, then health, then prices would render a row nobody's database was ever
 * in. Nothing here composes a cell from two reads.
 *
 * ### The connections, and which of the two reads answers *which providers do I have*
 *
 * Two endpoints list `provider_connections`: `GET /api/v1/routing/providers`, which is mockup
 * 06's health strip, and `GET /api/v1/providers`, which is mockup 07's cards. This page reads
 * the **second**, and until CI.3 it read the first.
 *
 * The reason is one field. Three controls here name a connection — the import menu's rows, the
 * create dialog's provider select, and the inspector's rebind select — and the last of them is
 * mockup 21's `Anthropic — key sk-ant-…Xq4A`, which needs the **mask**. The health payload does
 * not carry one and never should: it answers *is this provider up*. The connections payload
 * carries the mask, the id and the display name, is ordered by display name exactly as the
 * other is, and is readable by any member, so one read now answers the whole question. Reading
 * both would be two answers to *which providers has this workspace connected*, which is the
 * arrangement this file exists to avoid.
 *
 * What is **not** read is the health of each connection, and that is deliberate — see
 * `importSources` in `app/registry/view.ts` for why a paused connection is still a connection,
 * and the table's own health cell (CH.5) for where an alias's provider trouble is reported.
 *
 * {@link attempt} is `app/api/reading.ts`'s, shared with the dashboard and the routing page.
 * It catches an `ApiError` and nothing else, deliberately: a `401` reaches this layer as
 * Next.js's redirect signal rather than as an error (`app/api/server.ts`), and a `catch` wide
 * enough to hold it would swallow the navigation to the login screen and draw a registry page
 * captioned with the framework's internal message.
 */

import type { Workspace } from "@/app/api/access";
import { providers } from "@/app/api/providers";
import { attempt } from "@/app/api/reading";
import { registry } from "@/app/api/registry";

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

  // Both at once: neither read depends on the other, and a page that waited for the
  // connections before asking for the table would be paying two round trips for one screen.
  const [connections, aliases] = await Promise.all([
    attempt(async () => (await providers.list()).items),
    attempt(async () => (await registry.read()).aliases),
  ]);

  return { providers: connections, aliases };
}
