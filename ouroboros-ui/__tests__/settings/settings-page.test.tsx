import { describe, expect, it, vi } from "vitest";

import { SETTINGS_PATH, SOURCES_PATH } from "@/app/paths";

/**
 * `/settings` ([#141](https://github.com/NobuData/ouroboros/issues/141), ahead of BS.1
 * #491): a redirect to the section's one built tab, asserted against the constants so the
 * sidebar entry, the redirect and the tab set stay one fact.
 */

const redirect = vi.fn((path: string) => {
  throw new Error(`NEXT_REDIRECT:${path}`);
});

vi.mock("next/navigation", () => ({ redirect: (path: string) => redirect(path) }));

const Page = (await import("@/app/(app)/settings/page")).default;

describe("the settings hub's address", () => {
  it("redirects to the sources tab, and renders nothing", () => {
    expect(() => Page()).toThrow(`NEXT_REDIRECT:${SOURCES_PATH}`);
    expect(redirect).toHaveBeenCalledWith(SOURCES_PATH);
  });

  it("sends the visitor somewhere under itself, so the Settings entry stays lit", () => {
    expect(SOURCES_PATH.startsWith(`${SETTINGS_PATH}/`)).toBe(true);
  });
});
