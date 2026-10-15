import { HttpStatus, RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";

import { INTERNAL_ONLY } from "../internal/internal.decorators";
import type { ClaimQueueItemDto } from "./ingest.dto";
import type { QueueItemClaimedResource } from "./ingest.resources";
import { QueueClaimController } from "./queue-claim.controller";
import type { QueueClaimService } from "./queue-claim.service";

const REQUEST: ClaimQueueItemDto = {
  idempotencyKey: "worker-a-claim-1",
  workspace: "acme-robotics",
  worker: "engine-worker-a",
};

const CLAIMED = { id: "5eed0008-0000-4000-8000-000000000001" } as QueueItemClaimedResource;

/** A controller over a claim service answering `answer`, and the status it set. */
function rig(answer: QueueItemClaimedResource | undefined) {
  const claims = { claim: jest.fn().mockResolvedValue(answer) };
  const statuses: number[] = [];
  const response = {
    status: (code: number) => {
      statuses.push(code);
      return response;
    },
  };

  return {
    controller: new QueueClaimController(claims as unknown as QueueClaimService),
    claims,
    response,
    statuses,
  };
}

describe("POST /internal/queue/claim (#91)", () => {
  it("answers the leased item with 200", async () => {
    const { controller, claims, response, statuses } = rig(CLAIMED);

    await expect(controller.claim(REQUEST, response)).resolves.toBe(CLAIMED);
    expect(claims.claim).toHaveBeenCalledWith(REQUEST);
    expect(statuses).toEqual([HttpStatus.OK]);
  });

  it("answers 204 with no body when nothing is claimable", async () => {
    const { controller, response, statuses } = rig(undefined);

    await expect(controller.claim(REQUEST, response)).resolves.toBeUndefined();
    expect(statuses).toEqual([HttpStatus.NO_CONTENT]);
  });

  it("is a POST on /internal/queue/claim, behind the internal key", () => {
    expect(Reflect.getMetadata(PATH_METADATA, QueueClaimController)).toBe("internal/queue");
    expect(Reflect.getMetadata(PATH_METADATA, QueueClaimController.prototype.claim)).toBe("claim");
    expect(Reflect.getMetadata(METHOD_METADATA, QueueClaimController.prototype.claim)).toBe(
      RequestMethod.POST,
    );
    expect(Reflect.getMetadata(INTERNAL_ONLY, QueueClaimController)).toBe(true);
  });
});
