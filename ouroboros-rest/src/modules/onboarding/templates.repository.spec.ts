/** Step 3's statements ([#386](https://github.com/NobuData/ouroboros/issues/386), BB.3). */

import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { TemplateTilesRepository } from "./templates.repository";

const WORKSPACE = "org-1";

describe("the template tiles repository", () => {
  let database: RecordingDatabase;
  let tiles: TemplateTilesRepository;

  beforeEach(() => {
    database = recordingDatabase();
    tiles = new TemplateTilesRepository(database.service);
  });

  it("counts merged loops through V068's function over the runs read-model", async () => {
    // bigint arrives from the driver as text.
    database.answers({ rows: [{ merged: "3" }] });

    await expect(tiles.mergedLoops(WORKSPACE)).resolves.toBe(3);
    expect(database.statements[0].sql).toContain("ouroboros.merged_loop_count($1)");
    expect(database.statements[0].parameters).toEqual([WORKSPACE]);
  });

  it("answers zero when the count comes back empty", async () => {
    await expect(tiles.mergedLoops(WORKSPACE)).resolves.toBe(0);
  });

  it("reads the tiles through the resolver, with the gate evaluated by V068's functions", async () => {
    await tiles.templates(WORKSPACE, 3, 5);

    const { sql, parameters } = database.statements[0];
    expect(sql).toContain("ouroboros.workflow_templates_for($");
    expect(sql).toContain("ouroboros.workflow_template_unlock_threshold(t.unlock_rule");
    expect(sql).toContain("ouroboros.workflow_template_unlocked(t.unlock_rule");
    expect(sql).toContain("order by t.sort_order, t.slug");
    expect(parameters).toEqual([5, 3, 5, WORKSPACE]);
  });

  it("passes null for no override, so each template's own rule stands", async () => {
    await tiles.templates(WORKSPACE, 3, undefined);

    expect(database.statements[0].parameters).toEqual([null, 3, null, WORKSPACE]);
  });

  it("reads live instantiated workflows, newest first, scoped to the workspace", async () => {
    database.answers({
      rows: [
        {
          id: "w1",
          slug: "quick-fixes",
          name: "Quick fixes",
          current_version: 1,
          template_slug: "quick-fixes",
          template_version: 1,
        },
      ],
    });

    const rows = await tiles.instantiatedWorkflows(WORKSPACE);

    const { sql, parameters } = database.statements[0];
    expect(sql).toContain('"organization_id" = $1');
    expect(sql).toContain('"template_slug" is not null');
    expect(sql).toContain('"status" <> $2');
    expect(sql).toContain('order by "created_at" desc');
    expect(parameters).toEqual([WORKSPACE, "archived"]);
    expect(rows).toHaveLength(1);
  });

  it("drops a row whose provenance is half-written rather than inventing the other half", async () => {
    database.answers({
      rows: [
        {
          id: "w1",
          slug: "odd",
          name: "Odd",
          current_version: 1,
          template_slug: "quick-fixes",
          template_version: null,
        },
      ],
    });

    await expect(tiles.instantiatedWorkflows(WORKSPACE)).resolves.toEqual([]);
  });
});
