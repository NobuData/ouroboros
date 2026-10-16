"use client";

import { useEffect } from "react";

import { setNavCapabilities } from "@/app/shell/nav-registry";
import { APP_ADMIN_CAPABILITY } from "@/app/shell/nav-modules";

/**
 * The same-origin route that says whether the reader is an application administrator
 * (`app/api/account/status/route.ts`). Answers `{ "appAdmin": boolean }`.
 */
export const APP_ADMIN_ENDPOINT = "/api/account/status";

/**
 * Ask whether the reader is an application administrator.
 *
 * **Every failure is `false`** — a refused, unreachable or unreadable answer hides the entry,
 * which is the registry's own default for a capability nobody has published.
 *
 * @param fetchImpl The fetch to call through. Defaults to the browser's.
 * @returns `true` only for a `2xx` whose body says `appAdmin: true`.
 */
export async function readAppAdminFlag(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const response = await fetchImpl(APP_ADMIN_ENDPOINT, {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) return false;

    const body: unknown = await response.json();
    return (
      typeof body === "object" &&
      body !== null &&
      (body as { appAdmin?: unknown }).appAdmin === true
    );
  } catch {
    return false;
  }
}

/** What {@link AppAdminNavPublisher} takes. */
export interface AppAdminNavPublisherProps {
  /** The read. Defaults to {@link readAppAdminFlag}; suites pass their own. */
  readonly read?: () => Promise<boolean>;
}

/**
 * Shows the sidebar's **Accounts** entry to an application administrator (account approval).
 *
 * Draws nothing, like `InboxBadgePublisher` beside it in the `(app)` layout: on mount it asks
 * once and publishes {@link APP_ADMIN_CAPABILITY} with `setNavCapabilities` when the answer is
 * yes; on unmount it withdraws it. Once per mount is enough — whether somebody is an
 * administrator is a deployment setting, not something that moves while a page is open.
 *
 * **It publishes the whole capability set**, because that is what `setNavCapabilities` takes.
 * It is the only publisher today; a second one must merge with this one rather than replace it.
 *
 * @param props See {@link AppAdminNavPublisherProps}.
 * @returns Nothing.
 */
export function AppAdminNavPublisher({ read = readAppAdminFlag }: AppAdminNavPublisherProps) {
  useEffect(() => {
    let live = true;

    void read().then((admin) => {
      if (live) setNavCapabilities(admin ? [APP_ADMIN_CAPABILITY] : []);
    });

    return () => {
      live = false;
      setNavCapabilities([]);
    };
  }, [read]);

  return null;
}
