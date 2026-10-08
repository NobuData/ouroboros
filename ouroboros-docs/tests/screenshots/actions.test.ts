import { describe, expect, it } from "vitest";

import { runActions, type ActionPage } from "../../screenshots/lib/actions.ts";

/**
 * A page that records what was done to it instead of driving a browser.
 *
 * @returns the fake page and the log it writes.
 */
function fakePage(): { page: ActionPage; log: string[] } {
  const log: string[] = [];
  const locator = (selector: string) => ({
    first: () => ({
      click: async () => void log.push(`click ${selector}`),
      hover: async () => void log.push(`hover ${selector}`),
      fill: async (value: string) => void log.push(`fill ${selector} ${value}`),
      press: async (key: string) => void log.push(`press ${key} on ${selector}`),
    }),
  });
  const page = {
    locator,
    keyboard: { press: async (key: string) => void log.push(`press ${key}`) },
  } as unknown as ActionPage;
  return { page, log };
}

describe("runActions", () => {
  it("runs every kind of step, in order, on the first match", async () => {
    const { page, log } = fakePage();
    await runActions(page, [
      { click: "role=button[name=Invite]" },
      { fill: "input[name=email]", value: "maya@acme-robotics.dev" },
      { press: "Enter", on: "input[name=email]" },
      { hover: "text=Runners" },
      { press: "Escape" },
    ]);
    expect(log).toEqual([
      "click role=button[name=Invite]",
      "fill input[name=email] maya@acme-robotics.dev",
      "press Enter on input[name=email]",
      "hover text=Runners",
      "press Escape",
    ]);
  });

  it("does nothing for an entry without steps", async () => {
    const { page, log } = fakePage();
    await runActions(page);
    expect(log).toEqual([]);
  });
});
