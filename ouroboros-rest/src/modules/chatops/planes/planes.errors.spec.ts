import { HttpStatus } from "@nestjs/common";

import { ConflictError, InvalidRequestError, NotFoundError } from "../../errors/error.envelope";
import {
  CHAT_PLANE_ERRORS,
  draftAbsentForDryRun,
  routeNotConfigured,
  ticketNotCanonical,
  workflowUndecided,
} from "./planes.errors";

/**
 * The refusals the `/ouro` bindings raise themselves (#537) — the few made *before* a plane can
 * be called at all. Each code becomes `chat_commands.error_detail`, so the codes are pinned
 * here; each sentence is what a person reads in the channel, so it must say what to do next.
 */

describe("the /ouro plane errors", () => {
  it("has stable codes, all its own and all in the chat_ namespace", () => {
    expect(CHAT_PLANE_ERRORS).toEqual({
      routeNotConfigured: "chat_route_not_configured",
      ticketNotCanonical: "chat_ticket_not_canonical",
      workflowUndecided: "chat_workflow_undecided",
    });
  });

  it("answers a task kind with no route as a 404 that says where to give it one", () => {
    const error = routeNotConfigured("plan");

    expect(error).toBeInstanceOf(NotFoundError);
    expect(error.getStatus()).toBe(HttpStatus.NOT_FOUND);
    expect(error.code).toBe("chat_route_not_configured");
    expect(error.message).toBe(
      "plan has no route yet, so there is no primary model to repin. Give it one on the Routing page first.",
    );
    expect(error.details).toEqual({ taskKind: "plan" });
  });

  it("answers an issue with no canonical ticket as a 422 that says to sync the source", () => {
    const error = ticketNotCanonical("helios-firmware#486");

    expect(error).toBeInstanceOf(InvalidRequestError);
    expect(error.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(error.code).toBe("chat_ticket_not_canonical");
    expect(error.message).toBe(
      "helios-firmware#486 is mirrored from GitHub but is not in the workspace's ticket sources yet, and a dry run needs the synced ticket. Sync the source, then try again.",
    );
    expect(error.details).toEqual({ reference: "helios-firmware#486" });
  });

  it("answers an undecided workflow as a 422 that spells the command and the offered slugs", () => {
    const error = workflowUndecided("#486", ["standard-fix", "deep-fix"]);

    expect(error).toBeInstanceOf(InvalidRequestError);
    expect(error.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(error.code).toBe("chat_workflow_undecided");
    expect(error.message).toBe(
      "No workflow's trigger claims #486 and it has no estimate to suggest one — name the workflow: /ouro dry-run #486 <workflow> (standard-fix, deep-fix).",
    );
    expect(error.details).toEqual({ reference: "#486", offered: ["standard-fix", "deep-fix"] });
  });

  it("keeps the plane's code and status for a missing draft, and changes only the sentence", () => {
    const error = draftAbsentForDryRun("workflow_draft_absent", "standard-fix");

    expect(error).toBeInstanceOf(ConflictError);
    expect(error.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(error.code).toBe("workflow_draft_absent");
    expect(error.message).toBe(
      "standard-fix has no open draft, and a dry run rehearses a workflow's draft. Open one in Workflow Copilot, then try again.",
    );
    expect(error.message).not.toContain("publish");
    expect(error.details).toEqual({ workflow: "standard-fix" });
  });
});
