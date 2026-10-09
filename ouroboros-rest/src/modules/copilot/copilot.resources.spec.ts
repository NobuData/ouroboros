import type { CopilotMessage, CopilotSession } from "../db/schema";
import { DslWarningCode } from "../workflows/dsl.errors";
import {
  copilotChoices,
  copilotMessage,
  copilotSession,
  copilotTrace,
  copilotWarning,
  draftLabel,
} from "./copilot.resources";

const AT = new Date("2026-10-08T15:02:00.000Z");

const SESSION: CopilotSession = {
  id: "5eed008a-0000-4000-8000-000000000001",
  organization_id: "acme-robotics-id",
  workflow_id: "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94",
  status: "active",
  model_provenance: [{ seq: 2, alias: "coder-max", model_id: "claude-fable-5" }],
  draft_name: "security-patch",
  created_by: "user-1",
  created_at: AT,
  closed_at: null,
  last_seq: 2,
};

const REPLY: CopilotMessage = {
  id: "5eed008a-0000-4000-8000-000000000102",
  organization_id: "acme-robotics-id",
  session_id: SESSION.id,
  seq: 2,
  role: "copilot",
  body: "Drafted security-patch.",
  choices: [
    {
      prompt: "What triggers it?",
      options: ["label:security", "CVE pattern in title"],
      selected: null,
      answered_at: null,
    },
  ],
  tool_trace: {
    operations: [
      { op: { kind: "add_stage", params: { node: { id: "exploit-verify" } } }, outcome: "applied" },
      { op: { kind: "add_edge", params: {} }, outcome: "bounced", validator_message: "no stage" },
    ],
    reads: [{ tool: "catalog" }],
    dry_run_proposals: [{ ticket: "#489", reason: "edge case" }],
  },
  tokens_in: 18400,
  tokens_out: 2100,
  cost_cents: 12,
  status: "complete",
  created_at: AT,
};

describe("the copilot resources", () => {
  it("labels the draft from the version in force and the revision", () => {
    expect(draftLabel({ current_version: null, draft_rev: 3 })).toBe("v0.3");
    expect(draftLabel({ current_version: 14, draft_rev: 0 })).toBe("v14.0");
  });

  it("shows a session with its provenance in this API's names", () => {
    expect(copilotSession(SESSION)).toEqual({
      id: SESSION.id,
      workflowId: SESSION.workflow_id,
      status: "active",
      draftName: "security-patch",
      modelProvenance: [{ seq: 2, alias: "coder-max", modelId: "claude-fable-5" }],
      createdAt: "2026-10-08T15:02:00.000Z",
      closedAt: null,
      lastSeq: 2,
    });
  });

  it("shows a reply with its chips, trace and cost", () => {
    expect(copilotMessage(REPLY)).toEqual({
      id: REPLY.id,
      seq: 2,
      role: "copilot",
      body: "Drafted security-patch.",
      choices: [
        {
          prompt: "What triggers it?",
          options: ["label:security", "CVE pattern in title"],
          selected: null,
          answeredAt: null,
        },
      ],
      toolTrace: {
        operations: [
          {
            op: { kind: "add_stage", params: { node: { id: "exploit-verify" } } },
            outcome: "applied",
            validatorMessage: null,
          },
          {
            op: { kind: "add_edge", params: {} },
            outcome: "bounced",
            validatorMessage: "no stage",
          },
        ],
        reads: [{ tool: "catalog" }],
        dryRunProposals: [{ ticket: "#489", reason: "edge case" }],
      },
      tokensIn: 18400,
      tokensOut: 2100,
      costCents: 12,
      status: "complete",
      createdAt: "2026-10-08T15:02:00.000Z",
    });
  });

  it("keeps null where the row has null — no chips, no metering", () => {
    expect(copilotChoices(null)).toBeNull();
    expect(
      copilotMessage({
        ...REPLY,
        choices: null,
        tokens_in: null,
        tokens_out: null,
        cost_cents: null,
      }),
    ).toMatchObject({
      choices: null,
      tokensIn: null,
      tokensOut: null,
      costCents: null,
    });
    expect(copilotTrace({ operations: [], reads: [], dry_run_proposals: [] })).toEqual({
      operations: [],
      reads: [],
      dryRunProposals: [],
    });
  });

  it("shows a warning as the reference it is", () => {
    expect(
      copilotWarning({
        code: DslWarningCode.REFERENCE_UNKNOWN_TASK,
        node: "exploit-verify",
        name: "exploit-verify",
        path: "/nodes/0/config/routing/inherit_task",
        message: "No task route named `exploit-verify` exists in this workspace yet.",
      }),
    ).toEqual({
      code: "reference.unknown_task",
      node: "exploit-verify",
      name: "exploit-verify",
      path: "/nodes/0/config/routing/inherit_task",
      message: "No task route named `exploit-verify` exists in this workspace yet.",
    });
  });
});
