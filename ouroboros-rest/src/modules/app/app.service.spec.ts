import { AppService } from "./app.service";
import { SERVICE_NAME, serviceVersion } from "../../version";

describe("AppService", () => {
  it("names the service and the build that is answering", () => {
    const heartbeat = new AppService().heartbeat();

    expect(heartbeat.service).toBe(SERVICE_NAME);
    expect(heartbeat.version).toBe(serviceVersion());
    expect(heartbeat.status).toBe("ok");
  });

  it("reports the seconds since it was constructed", () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date("2026-08-10T12:00:00.000Z"));
      const service = new AppService();

      jest.setSystemTime(new Date("2026-08-10T12:00:02.500Z"));

      expect(service.heartbeat().uptimeSeconds).toBe(2.5);
    } finally {
      jest.useRealTimers();
    }
  });

  it("starts at zero rather than at a negative or a rounded-up second", () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date("2026-08-10T12:00:00.000Z"));

      expect(new AppService().heartbeat().uptimeSeconds).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});
