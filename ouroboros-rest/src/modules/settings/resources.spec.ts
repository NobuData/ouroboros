import type { WorkspaceSettings, WorkspaceSettingsEffective } from "../db/schema";
import { autoMergeFromWrite, autoMergeResource } from "./resources";

/**
 * The mapping, and the property that makes two mappers one contract: a view row and the
 * table row it reflects produce the same resource, so what a `GET` answers and what the
 * `PATCH` that caused it answered can never disagree.
 */

const WORKSPACE = "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10";
const ADMINISTRATOR = "user-someone";
const STAMP = new Date("2026-08-13T09:00:00.000Z");

describe("the auto-merge resource", () => {
  it("maps a chosen setting, stamps in ISO 8601", () => {
    const row: WorkspaceSettingsEffective = {
      organization_id: WORKSPACE,
      auto_merge_on_checks: true,
      is_explicit: true,
      updated_at: STAMP,
      updated_by: ADMINISTRATOR,
    };

    expect(autoMergeResource(row)).toEqual({
      enabled: true,
      updatedAt: "2026-08-13T09:00:00.000Z",
      updatedBy: ADMINISTRATOR,
    });
  });

  it("maps a workspace that has never chosen to off, with both stamps null together", () => {
    // The view's own answer for a workspace with no settings row — the nulls are the "this
    // is a default" signal, so nothing here may invent a time or an author for them.
    const row: WorkspaceSettingsEffective = {
      organization_id: WORKSPACE,
      auto_merge_on_checks: false,
      is_explicit: false,
      updated_at: null,
      updated_by: null,
    };

    expect(autoMergeResource(row)).toEqual({ enabled: false, updatedAt: null, updatedBy: null });
  });

  it("answers the defaults for no row at all, and off rather than on", () => {
    // Unreachable through the pipeline, and mapped anyway: a setting this surface could not
    // read must read as *off* — the safe default for "merge without review" is never yes.
    expect(autoMergeResource(undefined)).toEqual({
      enabled: false,
      updatedAt: null,
      updatedBy: null,
    });
  });

  it("maps what a write handed back to the same shape the view would answer", () => {
    const row: WorkspaceSettings = {
      organization_id: WORKSPACE,
      auto_merge_on_checks: true,
      updated_by: ADMINISTRATOR,
      created_at: new Date("2026-08-11T10:20:23.114Z"),
      updated_at: STAMP,
    };

    const effective: WorkspaceSettingsEffective = {
      organization_id: WORKSPACE,
      auto_merge_on_checks: true,
      is_explicit: true,
      updated_at: STAMP,
      updated_by: ADMINISTRATOR,
    };

    expect(autoMergeFromWrite(row)).toEqual(autoMergeResource(effective));
  });

  it("keeps a deleted setter honest: null updatedBy on a stored row", () => {
    // `on delete set null`, never cascade — the choice outlives the chooser, and the
    // resource says "somebody who is gone" rather than inventing an author.
    const row: WorkspaceSettings = {
      organization_id: WORKSPACE,
      auto_merge_on_checks: true,
      updated_by: null,
      created_at: new Date("2026-08-11T10:20:23.114Z"),
      updated_at: STAMP,
    };

    expect(autoMergeFromWrite(row)).toEqual({
      enabled: true,
      updatedAt: "2026-08-13T09:00:00.000Z",
      updatedBy: null,
    });
  });
});
