import { describe, expect, it, vi } from "vitest";

import {
  TEMPLATES_ENDPOINT,
  createTemplatesPoll,
  isTemplateTiles,
  templatesEndpoint,
} from "@/app/get-started/templates-poll";

import { REPO, seededTiles } from "../helpers/onboarding";

/** The template tiles' poll (#392): one endpoint per repository, and a guard on what comes back. */

describe("the template tiles' poll", () => {
  it("asks this origin, naming the repository", () => {
    expect(TEMPLATES_ENDPOINT).toBe("/api/onboarding/templates");
    expect(templatesEndpoint(REPO)).toBe(
      "/api/onboarding/templates?repo=acme-robotics%2Fhelios-firmware",
    );
  });

  it("accepts the grid — an empty one included", () => {
    expect(isTemplateTiles(seededTiles())).toBe(true);
    expect(isTemplateTiles(seededTiles({ tiles: [], selectedTemplate: null }))).toBe(true);
  });

  it.each([
    ["nothing", null],
    ["a string", "tiles"],
    ["no repository", { ...seededTiles(), repo: 7 }],
    ["no count", { ...seededTiles(), mergedLoops: "3" }],
    ["no studio path", { ...seededTiles(), studioPath: null }],
    ["tiles that are not a list", { ...seededTiles(), tiles: {} }],
    [
      "a tile with no slug",
      {
        ...seededTiles(),
        tiles: [{ name: "Quick fixes", selected: true, stageDots: [], effortRange: [] }],
      },
    ],
    [
      "a tile with no stages",
      { ...seededTiles(), tiles: [{ slug: "x", name: "x", selected: false, effortRange: [] }] },
    ],
    ["a tile that is not one", { ...seededTiles(), tiles: [null] }],
  ])("refuses %s", (_label, value) => {
    expect(isTemplateTiles(value)).toBe(false);
  });

  it("reads its own endpoint", async () => {
    const read = vi
      .fn()
      .mockResolvedValue({
        state: "fresh",
        payload: seededTiles(),
        etag: null,
        pollAfterSeconds: null,
      });
    const poll = createTemplatesPoll(templatesEndpoint(REPO), { read, visible: () => true });
    const stop = poll.start();

    await vi.waitFor(() => expect(poll.snapshot().data).toEqual(seededTiles()));
    stop();

    expect(read).toHaveBeenCalledWith(templatesEndpoint(REPO), null);
  });
});
