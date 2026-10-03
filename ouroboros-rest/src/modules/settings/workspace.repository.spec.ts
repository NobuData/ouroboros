import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { WorkspaceRepository } from "./workspace.repository";

/**
 * The card's three reads, each scoped to the workspace — a domain another workspace holds must
 * never be found here.
 */

const WORKSPACE = "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10";

describe("the workspace repository", () => {
  let database: RecordingDatabase;
  let workspace: WorkspaceRepository;

  beforeEach(() => {
    database = recordingDatabase();
    workspace = new WorkspaceRepository(database.service);
  });

  it("reads the organization row by id", async () => {
    database.answers({ rows: [{ id: WORKSPACE, name: "acme-robotics" }] });

    expect(await workspace.organization(WORKSPACE)).toEqual({
      id: WORKSPACE,
      name: "acme-robotics",
    });
    expect(database.statements[0].sql).toContain('from "ouroboros"."organization"');
    expect(database.statements[0].sql).toContain('where "id" = $1');
    expect(database.statements[0].parameters).toEqual([WORKSPACE]);
  });

  it("reads the primary domain of this workspace only", async () => {
    database.answers({ rows: [] });

    expect(await workspace.primaryDomain(WORKSPACE)).toBeUndefined();
    expect(database.statements[0].sql).toContain('from "ouroboros"."tenant_domains"');
    expect(database.statements[0].sql).toContain(
      'where "organization_id" = $1 and "is_primary" = $2',
    );
    expect(database.statements[0].parameters).toEqual([WORKSPACE, true]);
  });

  it("finds a domain by name within this workspace only", async () => {
    database.answers({ rows: [{ id: "d-1", domain: "acme.io" }] });

    expect(await workspace.domainNamed(WORKSPACE, "acme.io")).toEqual({
      id: "d-1",
      domain: "acme.io",
    });
    expect(database.statements[0].sql).toContain('where "organization_id" = $1 and "domain" = $2');
    expect(database.statements[0].parameters).toEqual([WORKSPACE, "acme.io"]);
  });
});
