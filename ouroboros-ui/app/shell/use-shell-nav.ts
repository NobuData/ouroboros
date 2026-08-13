"use client";

import { useSyncExternalStore } from "react";

import { type NavRegistry, navRegistry, subscribeNavRegistry } from "./nav-registry";
import {
  SIDEBAR_SERVER_STATE,
  type SidebarState,
  sidebarState,
  subscribeSidebar,
} from "./sidebar-state";

/**
 * The two stores the sidebar renders from, as hooks
 * ([#644](https://github.com/NobuData/ouroboros/issues/644)).
 *
 * `app/shell/nav-registry.ts` and `app/shell/sidebar-state.ts` are both framework-free on
 * purpose — a registry that imported React would be a registry a Server Component could not
 * seed, and a preference module that did could not be read by the boot script's source. This
 * file is the one place either meets React, and it is four lines of `useSyncExternalStore`
 * each way.
 *
 * `useSyncExternalStore` rather than an effect that copies the store into state: it is
 * React's own answer for a value that lives outside the render tree, it renders the server's
 * value during hydration and corrects in the same pass, and it re-reads on every change
 * without a subscription per consumer to remember to tear down. `app/shell/client-value.ts`
 * argues the case at length for the values that never change; these do change, so they take
 * the subscribing form.
 */

/**
 * The registered navigation entries, the published badge counts, and the granted
 * capabilities.
 *
 * The same reader answers for the server and the browser, which is safe because nothing may
 * publish a count or a capability outside the browser and nothing may publish either at
 * module scope — see `readerScoped` in `app/shell/nav-registry.ts`. So the snapshot React
 * hydrates against is the one the server rendered: the entries, and no reader-specific state.
 *
 * @returns The registry, re-read whenever a module registers, a count is published, or a
 *   capability set changes.
 */
export function useNavRegistry(): NavRegistry {
  return useSyncExternalStore(subscribeNavRegistry, navRegistry, navRegistry);
}

/**
 * The sidebar's width choice and whether its drawer is open.
 *
 * @returns The state. On the server, and for the hydration render that has to match it,
 *   {@link SIDEBAR_SERVER_STATE} — no stored choice and no open drawer, because the server
 *   has neither storage nor a viewport to read one from.
 */
export function useSidebar(): SidebarState {
  return useSyncExternalStore(subscribeSidebar, sidebarState, () => SIDEBAR_SERVER_STATE);
}
