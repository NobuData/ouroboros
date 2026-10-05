import type { AppConfigService } from "../../config/config.service";
import type { InsightsPageService } from "../page/page.service";
import { DIGEST_RANGE } from "./digest.assembly";
import { weekPage } from "./digest.fixture";
import { DigestRouteComposer, routedReason } from "./digest.route";

/**
 * The weekly digest as the org `weekly_insights` route sends it (#488): the subscriber's figures,
 * read as of the slot, framed for an address that subscribed to nothing.
 */

const CONFIG = { uiUrl: "https://ouro.acme.dev/" } as unknown as AppConfigService;
const SLOT = new Date("2026-08-10T09:00:00.000Z");

/**
 * A composer over a page that records what it was asked.
 *
 * @returns The composer and the page's mock.
 */
function build(): { composer: DigestRouteComposer; read: jest.Mock } {
  const read = jest.fn().mockResolvedValue(weekPage());
  const pages = { read } as unknown as InsightsPageService;

  return { composer: new DigestRouteComposer(pages, CONFIG), read };
}

describe("the routed weekly digest", () => {
  it("reads the page for the digest's range, as of the route's slot", async () => {
    const { composer, read } = build();

    await composer.compose("org-acme", "Acme Robotics", SLOT);

    expect(read).toHaveBeenCalledWith("org-acme", { range: DIGEST_RANGE, now: SLOT });
  });

  it("carries no unsubscribe link and says it came through the route, in both parts", async () => {
    const { composer } = build();

    const mail = await composer.compose("org-acme", "Acme Robotics", SLOT);

    expect(mail.subject).toContain("Acme Robotics");
    for (const part of [mail.text, mail.html]) {
      expect(part).not.toContain("Unsubscribe");
      expect(part).not.toContain("you subscribed");
      expect(part).toContain("Settings → Notifications");
    }
    expect(mail.text).toContain(routedReason("Acme Robotics"));
    expect(mail.text).toContain("https://ouro.acme.dev/insights?range=7d");
  });
});
