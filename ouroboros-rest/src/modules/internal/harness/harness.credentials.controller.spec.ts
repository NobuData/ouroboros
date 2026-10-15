import { INTERNAL_ONLY } from "../internal.decorators";
import { HarnessCredentialsController } from "./harness.credentials.controller";
import type { HarnessCredentialsService } from "./harness.credentials.service";

describe("the harness credential routes", () => {
  it("are behind the internal key", () => {
    expect(Reflect.getMetadata(INTERNAL_ONLY, HarnessCredentialsController)).toBe(true);
  });

  it("mint, revoke and reconcile through the service, validating the reported totals", async () => {
    const service = {
      mint: jest.fn().mockResolvedValue({ id: "c1" }),
      revoke: jest.fn().mockResolvedValue(undefined),
      reconcile: jest.fn().mockResolvedValue({ id: "c1", matches: true }),
    };
    const controller = new HarnessCredentialsController(
      service as unknown as HarnessCredentialsService,
    );

    await expect(controller.mint({ run: "r", stage: "s", alias: "a" })).resolves.toEqual({
      id: "c1",
    });
    await controller.revoke("c1");
    await controller.reconcile("c1", { models: { a: { inputTokens: 1, outputTokens: 2 } } });

    expect(service.revoke).toHaveBeenCalledWith("c1");
    expect(service.reconcile).toHaveBeenCalledWith("c1", {
      a: { inputTokens: 1, outputTokens: 2 },
    });
    await expect(
      controller.reconcile("c1", { models: { a: { inputTokens: -1, outputTokens: 2 } } }),
    ).rejects.toMatchObject({
      code: "validation_failed",
    });
  });
});
