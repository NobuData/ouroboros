/** The safe-first-issue picker's statements ([#387](https://github.com/NobuData/ouroboros/issues/387), BB.4). */

import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { FirstIssueRepository } from "./first-issue.repository";

const WORKSPACE = "org-1";
const REPOSITORY = "repo-1";
const UPDATED = new Date("2026-09-28T06:00:00.000Z");

describe("the first-issue repository", () => {
  let database: RecordingDatabase;
  let picker: FirstIssueRepository;

  beforeEach(() => {
    database = recordingDatabase();
    picker = new FirstIssueRepository(database.service);
  });

  describe("backlog", () => {
    it("counts the repository's open issues by sizing status, inside the workspace", async () => {
      // count(*) arrives from the driver as text.
      database.answers({ rows: [{ open: "9", sized: "7", sizing: "1", needs_human: "1" }] });

      await expect(picker.backlog(WORKSPACE, REPOSITORY)).resolves.toEqual({
        open: 9,
        sized: 7,
        sizing: 1,
        needsHuman: 1,
      });

      const { sql, parameters } = database.statements[0];
      expect(sql).toContain(`"ouroboros"."github_issues"`);
      expect(sql).toContain("i.state = 'open'");
      expect(sql).toContain("i.sizing_status in ('unsized', 'estimating')");
      expect(parameters).toEqual([WORKSPACE, REPOSITORY]);
    });

    it("answers zeros when nothing comes back", async () => {
      await expect(picker.backlog(WORKSPACE, REPOSITORY)).resolves.toEqual({
        open: 0,
        sized: 0,
        sizing: 0,
        needsHuman: 0,
      });
    });
  });

  describe("candidates", () => {
    it("reads sized open issues with the latest estimate and the model's rate", async () => {
      await picker.candidates(WORKSPACE, REPOSITORY);

      const { sql, parameters } = database.statements[0];
      expect(sql).toContain("order by ie.version desc");
      expect(sql).toContain("ie.github_issue_id = i.id");
      expect(sql).toContain(`"ouroboros".model_price($`);
      expect(sql).toContain("i.sizing_status = 'sized'");
      expect(sql).toContain("i.state = 'open'");
      expect(sql).toContain("order by i.number");
      expect(parameters).toEqual([WORKSPACE, WORKSPACE, WORKSPACE, REPOSITORY]);
    });

    it("maps a row, keeping only string files and a missing rate as null", async () => {
      database.answers({
        rows: [
          {
            issue_id: "issue-488",
            number: 488,
            title: "Typo sweep",
            url: "https://github.com/acme-robotics/helios-firmware/issues/488",
            updated_at: UPDATED,
            version: 1,
            effort: "xs",
            suggested_workflow: "docs-loop",
            routed_model: "ollama/qwen3-coder",
            files: ["docs/a.md", 7],
            cycle_min: 3,
            cycle_max: 6,
            est_tokens: 25000,
            billing_mode: null,
            input_cents_per_1m: null,
          },
          {
            issue_id: "issue-491",
            number: 491,
            title: "CRC",
            url: "https://github.com/acme-robotics/helios-firmware/issues/491",
            updated_at: UPDATED,
            version: 2,
            effort: "s",
            suggested_workflow: "standard-fix",
            routed_model: "claude-fable-5",
            files: null,
            cycle_min: 8,
            cycle_max: 14,
            est_tokens: 90000,
            billing_mode: "token",
            input_cents_per_1m: "1000",
          },
        ],
      });

      const [first, second] = await picker.candidates(WORKSPACE, REPOSITORY);

      expect(first).toEqual({
        issueId: "issue-488",
        number: 488,
        title: "Typo sweep",
        url: "https://github.com/acme-robotics/helios-firmware/issues/488",
        updatedAt: UPDATED,
        version: 1,
        effort: "xs",
        suggestedWorkflow: "docs-loop",
        routedModel: "ollama/qwen3-coder",
        files: ["docs/a.md"],
        cycleMin: 3,
        cycleMax: 6,
        estTokens: 25000,
        price: null,
      });
      expect(second.files).toEqual([]);
      expect(second.price).toEqual({ billingMode: "token", inputCentsPer1m: "1000" });
    });
  });

  describe("protectedPaths", () => {
    it("reads the repository's globs inside the workspace, sorted", async () => {
      database.answers({ rows: [{ path_glob: "boot/**" }, { path_glob: "keys/**" }] });

      await expect(
        picker.protectedPaths(WORKSPACE, "acme-robotics/helios-firmware"),
      ).resolves.toEqual(["boot/**", "keys/**"]);

      const { sql, parameters } = database.statements[0];
      expect(sql).toContain(`from "ouroboros"."protected_path_policies"`);
      expect(sql).toContain(`order by "path_glob"`);
      expect(parameters).toEqual([WORKSPACE, "acme-robotics/helios-firmware"]);
    });
  });
});
