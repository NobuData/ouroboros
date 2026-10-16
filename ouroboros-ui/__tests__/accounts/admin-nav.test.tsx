import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  APP_ADMIN_ENDPOINT,
  AppAdminNavPublisher,
  readAppAdminFlag,
} from "@/app/accounts/admin-nav";
import { ADMIN_ACCOUNTS_PATH } from "@/app/paths";
import { navGroup, permittedNavEntries } from "@/app/shell/nav";
import {
  ACCOUNTS_NAV_ENTRY,
  APP_ADMIN_CAPABILITY,
  SEEDED_NAV_ENTRIES,
} from "@/app/shell/nav-modules";
import { navRegistry, setNavCapabilities } from "@/app/shell/nav-registry";
import { SidebarNav } from "@/app/shell/sidebar-nav";

import { settle } from "../helpers/settle";

/**
 * The sidebar's **Accounts** entry (account approval): registered, gated on the application
 * administrator capability, and shown only once `AppAdminNavPublisher` hears `appAdmin: true`.
 */

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));

afterEach(() => {
  setNavCapabilities([]);
});

describe("the entry", () => {
  it("is registered beside the seeded eleven, in the bottom group after Settings", () => {
    const entry = navRegistry().entries.find((one) => one.id === "accounts");

    expect(entry).toEqual(ACCOUNTS_NAV_ENTRY);
    expect(SEEDED_NAV_ENTRIES).not.toContain(ACCOUNTS_NAV_ENTRY);
    expect(ACCOUNTS_NAV_ENTRY).toMatchObject({
      label: "Accounts",
      route: ADMIN_ACCOUNTS_PATH,
      group: "secondary",
      capability: APP_ADMIN_CAPABILITY,
    });
    expect(navGroup("secondary", navRegistry().entries).map((one) => one.id)).toEqual([
      "needs-you",
      "settings",
      "accounts",
    ]);
  });

  it("is hidden until the capability is granted", () => {
    expect(permittedNavEntries([ACCOUNTS_NAV_ENTRY], [])).toEqual([]);
    expect(permittedNavEntries([ACCOUNTS_NAV_ENTRY], [APP_ADMIN_CAPABILITY])).toEqual([
      ACCOUNTS_NAV_ENTRY,
    ]);
  });
});

describe("AppAdminNavPublisher", () => {
  it("shows Accounts in the sidebar for an application administrator", async () => {
    render(
      <>
        <AppAdminNavPublisher read={() => Promise.resolve(true)} />
        <SidebarNav />
      </>,
    );
    await settle();

    expect(screen.getByRole("link", { name: /Accounts/ })).toHaveAttribute(
      "href",
      ADMIN_ACCOUNTS_PATH,
    );
  });

  it("leaves it hidden for anybody else", async () => {
    render(
      <>
        <AppAdminNavPublisher read={() => Promise.resolve(false)} />
        <SidebarNav />
      </>,
    );
    await settle();

    expect(screen.queryByRole("link", { name: /Accounts/ })).toBeNull();
    expect(screen.getByRole("link", { name: /Settings/ })).toBeInTheDocument();
  });

  it("withdraws the capability when it unmounts", async () => {
    const { unmount } = render(<AppAdminNavPublisher read={() => Promise.resolve(true)} />);
    await settle();
    expect(navRegistry().capabilities).toEqual([APP_ADMIN_CAPABILITY]);

    act(() => unmount());

    expect(navRegistry().capabilities).toEqual([]);
  });

  it("publishes nothing for an answer that arrives after it unmounted", async () => {
    let answer: (admin: boolean) => void = () => {};
    const { unmount } = render(
      <AppAdminNavPublisher
        read={() =>
          new Promise<boolean>((resolve) => {
            answer = resolve;
          })
        }
      />,
    );

    act(() => unmount());
    await act(async () => {
      answer(true);
    });

    expect(navRegistry().capabilities).toEqual([]);
  });
});

describe("readAppAdminFlag", () => {
  it("asks the same-origin status route, uncached", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ appAdmin: true })),
    );

    await expect(readAppAdminFlag(fetchImpl)).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(APP_ADMIN_ENDPOINT, {
      cache: "no-store",
      credentials: "same-origin",
    });
    expect(APP_ADMIN_ENDPOINT).toBe("/api/account/status");
  });

  it("is false for a no, a refusal, a body it cannot read, and a network failure", async () => {
    const answering = (response: Response) => () => Promise.resolve(response);

    await expect(readAppAdminFlag(answering(Response.json({ appAdmin: false })))).resolves.toBe(
      false,
    );
    await expect(
      readAppAdminFlag(answering(Response.json({ appAdmin: true }, { status: 500 }))),
    ).resolves.toBe(false);
    await expect(readAppAdminFlag(answering(new Response("not json")))).resolves.toBe(false);
    await expect(readAppAdminFlag(answering(Response.json(null)))).resolves.toBe(false);
    await expect(readAppAdminFlag(() => Promise.reject(new TypeError("offline")))).resolves.toBe(
      false,
    );
  });
});
