import type { UserPreferences } from "../db/schema";
import { preferencesResource } from "./resources";

/**
 * The one decision the mapper makes — absence becomes the defaults — and the shape it
 * promises: exactly what `openapi.yaml`'s `Preferences` schema says, no more. A field added
 * to the row (timestamps, a future preference) must not leak onto the wire by accident.
 */

describe("the preferences resource", () => {
  it("maps a stored row to the contract's names", () => {
    const row: UserPreferences = {
      user_id: "user-someone",
      font_scale: "112.5",
      created_at: new Date("2026-08-01T00:00:00Z"),
      updated_at: new Date("2026-08-13T00:00:00Z"),
    };

    expect(preferencesResource(row)).toEqual({ fontScale: "112.5" });
  });

  it("answers the defaults for no row at all", () => {
    // A preference always has a value, even for somebody who has never expressed one —
    // which is why the surface has no 404.
    expect(preferencesResource(undefined)).toEqual({ fontScale: "100" });
  });

  it("carries nothing but what the contract promises", () => {
    const resource = preferencesResource(undefined);

    // The timestamps and the key stay behind: they are the row's business, and a client
    // that started depending on them would be depending on the table's shape.
    expect(Object.keys(resource)).toEqual(["fontScale"]);
  });
});
