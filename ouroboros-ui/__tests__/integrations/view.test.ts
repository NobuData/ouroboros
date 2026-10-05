import { describe, expect, it } from "vitest";

import type { IntegrationTile } from "@/app/api/settings-integrations";
import {
  STANDING_WORDS,
  TILE_MARKS,
  actionName,
  connectedTag,
  earnsCheck,
  integrationsUnread,
  linksAway,
  opensWebhookSheet,
  statusLine,
  tileMark,
  tileStanding,
} from "@/app/integrations/view";

import { integrations, tile } from "../helpers/integrations";

/**
 * The Integrations card's rules (BS.5, #495): four availabilities, four different renderings, and
 * exactly one way to earn the ok mark.
 */

const AVAILABILITIES: readonly IntegrationTile["availability"][] = [
  "connected",
  "disconnected",
  "unavailable_v2",
  "unavailable_unbuilt",
];
const STATES: readonly IntegrationTile["state"][] = ["ok", "attention", "off"];

describe("the ok mark", () => {
  it("is earned by connected-and-ok and by no other availability × state pair", () => {
    for (const availability of AVAILABILITIES) {
      for (const state of STATES) {
        expect(earnsCheck({ availability, state }), `${availability} × ${state}`).toBe(
          availability === "connected" && state === "ok",
        );
      }
    }
  });

  it("is not earned by an availability or a state this build does not know", () => {
    const unknown = { availability: "connected_ish", state: "ok" } as unknown as IntegrationTile;
    const odd = { availability: "connected", state: "degraded" } as unknown as IntegrationTile;

    expect(earnsCheck(unknown)).toBe(false);
    expect(earnsCheck(odd)).toBe(false);
    expect(tileStanding(odd)).toBe("attention");
  });
});

describe("the availability vocabulary", () => {
  it("gives each availability its own standing", () => {
    expect(tileStanding({ availability: "connected", state: "ok" })).toBe("ok");
    expect(tileStanding({ availability: "connected", state: "attention" })).toBe("attention");
    expect(tileStanding({ availability: "connected", state: "off" })).toBe("attention");
    expect(tileStanding({ availability: "disconnected", state: "off" })).toBe("disconnected");
    expect(tileStanding({ availability: "unavailable_v2", state: "off" })).toBe("v2");
    expect(tileStanding({ availability: "unavailable_unbuilt", state: "off" })).toBe("unbuilt");
  });

  it("says the three kinds of not-connected in three different phrases", () => {
    const phrases = [STANDING_WORDS.disconnected, STANDING_WORDS.v2, STANDING_WORDS.unbuilt];

    expect(phrases).toEqual(["not connected", "v2", "not built yet"]);
    expect(new Set(phrases).size).toBe(3);
    expect(phrases).not.toContain("off");
  });

  it("prints a connected tile's context line, or the word when there is none", () => {
    expect(statusLine(tile("webhooks", "Webhooks", { contextLine: "2 active" }))).toBe("2 active");
    expect(statusLine(tile("github", "GitHub"))).toBe("connected");
  });

  it("never prints a context line for a tile that is not connected", () => {
    const stale = tile("slack", "Slack", {
      availability: "unavailable_unbuilt",
      state: "off",
      contextLine: "#ouroboros-loops",
    });

    expect(statusLine(stale)).toBe("not built yet");
  });
});

describe("the mark", () => {
  it("is the mockup's monogram for every kind the service lists", () => {
    for (const one of integrations().tiles) {
      expect(tileMark(one)).toBe(TILE_MARKS[one.kind]);
      expect(tileMark(one)).toMatch(/^[A-Z]{2}$/);
    }
  });

  it("falls back to the label's first two letters for a kind added later", () => {
    const later = { kind: "sentry", label: "s-entry" } as unknown as IntegrationTile;

    expect(tileMark(later)).toBe("SE");
  });
});

describe("a tile's action", () => {
  const webhooks = integrations().tiles.find((one) => one.kind === "webhooks")!;
  const linear = integrations().tiles.find((one) => one.kind === "linear")!;
  const teams = integrations().tiles.find((one) => one.kind === "teams")!;

  it("opens the sheet only for the webhooks tile of a reader who may manage", () => {
    expect(opensWebhookSheet(webhooks, true)).toBe(true);
    expect(opensWebhookSheet(webhooks, false)).toBe(false);
    expect(opensWebhookSheet(linear, true)).toBe(false);
  });

  it("links away for a tile with an owning surface elsewhere, and never for webhooks or a v2 tile", () => {
    expect(linksAway(linear)).toBe(true);
    expect(linksAway(webhooks)).toBe(false);
    expect(linksAway(teams)).toBe(false);
  });

  it("is named for the integration it acts on", () => {
    expect(actionName(linear)).toBe("Connect Linear");
    expect(actionName(webhooks)).toBe("Manage Webhooks");
  });
});

describe("the copy", () => {
  it("renders the count it was given", () => {
    expect(connectedTag(4)).toBe("4 connected");
    expect(connectedTag(0)).toBe("0 connected");
  });

  it("says why the grid could not be read", () => {
    expect(integrationsUnread("The service is restarting.")).toBe(
      "The integrations could not be read. The service is restarting.",
    );
    expect(integrationsUnread("")).toBe("The integrations could not be read.");
  });
});
