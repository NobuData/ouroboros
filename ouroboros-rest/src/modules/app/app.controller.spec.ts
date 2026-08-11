import { Test } from "@nestjs/testing";

import { AppController } from "./app.controller";
import { AppModule } from "./app.module";
import { AppService, type Heartbeat } from "./app.service";

describe("AppController", () => {
  let controller: AppController;
  let service: AppService;

  beforeEach(async () => {
    // Compiled from the module itself rather than from a hand-written provider list, so
    // this fails if AppModule ever stops declaring what the controller depends on.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    controller = moduleRef.get(AppController);
    service = moduleRef.get(AppService);
  });

  it("is wired to the service the module provides", () => {
    expect(controller).toBeInstanceOf(AppController);
    expect(service).toBeInstanceOf(AppService);
  });

  it("answers with whatever the service assembled, unchanged", () => {
    const heartbeat: Heartbeat = {
      service: "ouroboros-rest",
      version: "9.9.9",
      status: "ok",
      uptimeSeconds: 12.5,
    };
    const assemble = jest.spyOn(service, "heartbeat").mockReturnValue(heartbeat);

    expect(controller.heartbeat()).toBe(heartbeat);
    expect(assemble).toHaveBeenCalledTimes(1);
  });
});
