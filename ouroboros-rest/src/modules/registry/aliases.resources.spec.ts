import type { AliasReferenceRow, AliasRow, ModelOptionRow } from "./aliases.rows";
import {
  ALIAS_WARNINGS,
  connectionOf,
  toAliasResource,
  toModelOptionResource,
  toReferenceResource,
} from "./aliases.resources";

const CONNECTION = "3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c";

const ROW: AliasRow = {
  id: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
  organization_id: "org-acme",
  alias: "coder-max",
  provider_connection_id: CONNECTION,
  model_id: "claude-fable-5",
  enabled: true,
  params: { thinking: "max", token_budget: 400_000 },
  restrictions: {},
  notes: "prod key",
  updated_by: "user-ken",
  created_at: new Date("2026-06-12T16:20:00.000Z"),
  updated_at: new Date("2026-08-23T09:59:41.882Z"),
  connection_kind: "anthropic",
  connection_display_name: "Anthropic Claude",
};

const REFERENCE: AliasReferenceRow = {
  alias_id: ROW.id,
  kind: "route",
  ref_id: "5eed0012-0000-4000-8000-000000000007",
  ref_label: "implement-primary",
  blocking: true,
};

describe("toAliasResource", () => {
  it("publishes the row with its connection and its references, in the contract's spellings", () => {
    expect(toAliasResource(ROW, [REFERENCE])).toEqual({
      id: ROW.id,
      alias: "coder-max",
      enabled: true,
      connection: { id: CONNECTION, kind: "anthropic", displayName: "Anthropic Claude" },
      modelId: "claude-fable-5",
      params: { thinking: "max", token_budget: 400_000 },
      restrictions: {},
      notes: "prod key",
      references: [
        {
          kind: "route",
          refId: "5eed0012-0000-4000-8000-000000000007",
          label: "implement-primary",
          blocking: true,
        },
      ],
      updatedBy: "user-ken",
      createdAt: "2026-06-12T16:20:00.000Z",
      updatedAt: "2026-08-23T09:59:41.882Z",
    });
  });

  it("publishes an unbound alias with a null connection and no references", () => {
    const unbound: AliasRow = {
      ...ROW,
      alias: "gpt5-experiments",
      provider_connection_id: null,
      connection_kind: null,
      connection_display_name: null,
      enabled: false,
      params: {},
      notes: null,
      updated_by: null,
    };

    expect(toAliasResource(unbound, [])).toMatchObject({
      connection: null,
      enabled: false,
      references: [],
      notes: null,
      updatedBy: null,
    });
  });
});

describe("connectionOf", () => {
  it("is null when the join found nothing, whichever column says so", () => {
    expect(connectionOf({ ...ROW, provider_connection_id: null })).toBeNull();
    expect(connectionOf({ ...ROW, connection_kind: null })).toBeNull();
    expect(connectionOf({ ...ROW, connection_display_name: null })).toBeNull();
  });
});

describe("toReferenceResource", () => {
  it("renames the columns and nothing else", () => {
    expect(
      toReferenceResource({ ...REFERENCE, kind: "escalation", ref_label: "escalation:effort≥L" }),
    ).toEqual({
      kind: "escalation",
      refId: REFERENCE.ref_id,
      label: "escalation:effort≥L",
      blocking: true,
    });
  });
});

describe("toModelOptionResource", () => {
  it("publishes a discovered model with its stamp as ISO 8601", () => {
    const row: ModelOptionRow = {
      model_id: "claude-fable-5",
      display: "Claude Fable 5",
      discovered_at: new Date("2026-08-23T09:55:00.000Z"),
      meta: { context_tokens: 1_000_000 },
    };

    expect(toModelOptionResource(row)).toEqual({
      modelId: "claude-fable-5",
      display: "Claude Fable 5",
      discoveredAt: "2026-08-23T09:55:00.000Z",
      meta: { context_tokens: 1_000_000 },
    });
  });
});

describe("the warning codes", () => {
  it("are two, stable, and spelled for a client to branch on", () => {
    expect(ALIAS_WARNINGS).toEqual({
      unbound: "alias_unbound",
      modelNotDiscovered: "model_not_discovered",
    });
  });
});
