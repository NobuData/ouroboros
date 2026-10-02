import type { Principal } from "../../auth/principal";
import type { Organization } from "../../db/schema";
import { REQUIRED_ROLES } from "../../tenancy/roles.guard";
import { DigestController } from "./digest.controller";
import type { InsightsDigestPreviewResource, InsightsDigestResource } from "./digest.resources";
import type { DigestService } from "./digest.service";

const TENANT = { id: "org-acme", name: "Acme Robotics" } as Organization;
const PRINCIPAL = { user: { id: "ken", email: "ken@acme.dev" } } as Principal;
const STATE = { subscribed: true } as InsightsDigestResource;
const PREVIEW = { subject: "s" } as InsightsDigestPreviewResource;

/** A controller over a stand-in service. */
function build() {
  const service = {
    state: jest.fn().mockResolvedValue(STATE),
    setSubscription: jest.fn().mockResolvedValue(STATE),
    setSchedule: jest.fn().mockResolvedValue(STATE),
    preview: jest.fn().mockResolvedValue(PREVIEW),
  };

  return { controller: new DigestController(service as unknown as DigestService), service };
}

describe("the digest controller", () => {
  it("reads the state for the session's workspace and person", async () => {
    const { controller, service } = build();

    await expect(controller.read(TENANT, PRINCIPAL)).resolves.toBe(STATE);
    expect(service.state).toHaveBeenCalledWith(TENANT, PRINCIPAL.user);
  });

  it("subscribes the caller, and nobody else: the person is the session's", async () => {
    const { controller, service } = build();

    await expect(controller.subscribe(TENANT, PRINCIPAL, { subscribed: false })).resolves.toBe(
      STATE,
    );
    expect(service.setSubscription).toHaveBeenCalledWith(TENANT, PRINCIPAL.user, false);
  });

  it("moves the schedule in the administrator's name", async () => {
    const { controller, service } = build();
    const patch = { weeklyDay: 5 };

    await expect(controller.reschedule(TENANT, PRINCIPAL, patch)).resolves.toBe(STATE);
    expect(service.setSchedule).toHaveBeenCalledWith(TENANT, PRINCIPAL.user, patch);
  });

  it("previews the workspace's digest", async () => {
    const { controller, service } = build();

    await expect(controller.preview(TENANT)).resolves.toBe(PREVIEW);
    expect(service.preview).toHaveBeenCalledWith(TENANT);
  });

  it("gates only the schedule: every member reads, previews and subscribes themselves", () => {
    const roles = (handler: keyof DigestController): unknown =>
      Reflect.getMetadata(REQUIRED_ROLES, DigestController.prototype[handler]);

    expect(roles("reschedule")).toEqual(["owner", "admin"]);
    expect(roles("read")).toBeUndefined();
    expect(roles("subscribe")).toBeUndefined();
    expect(roles("preview")).toBeUndefined();
  });
});
