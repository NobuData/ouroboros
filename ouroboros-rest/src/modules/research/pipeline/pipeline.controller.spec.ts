import { HttpStatus, RequestMethod } from "@nestjs/common";
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";

import type { Principal } from "../../auth/principal";
import { HUMAN_ONLY } from "../../auth/service.scopes";
import type { Organization } from "../../db/schema";
import { REQUIRED_ROLES } from "../../tenancy/roles.guard";
import type { GapHandoffService } from "./gap-handoff.service";
import { PipelineController } from "./pipeline.controller";
import type { RoadmapDriftService } from "./roadmap.drift.service";
import type { RoadmapIssuesService } from "./roadmap.issues.service";
import type { RoadmapService } from "./roadmap.service";

/**
 * The pipeline's routes (CM.5, #624): what each is, who may call it, and what it hands on.
 */

const TENANT = { id: "org-acme" } as Organization;
const PRINCIPAL = { user: { id: "user-ken" } } as Principal;
const INVESTIGATION = "5eed0091-0000-4000-8000-000000000124";
const SUGGESTION = "5eed0097-0000-4000-8000-000000002001";
const SOURCE = "5eed0020-0000-4000-8000-000000000001";

const handler = (name: string): object =>
  Object.getOwnPropertyDescriptor(PipelineController.prototype, name)!.value as object;
const meta = (key: string, name: string): unknown => Reflect.getMetadata(key, handler(name));

function services() {
  return {
    gaps: { draftEpic: jest.fn().mockResolvedValue("drafted") },
    roadmap: {
      generate: jest.fn().mockResolvedValue("generated"),
      card: jest.fn().mockResolvedValue("card"),
      suggest: jest.fn().mockResolvedValue("suggested"),
      apply: jest.fn().mockResolvedValue("applied"),
      dismiss: jest.fn().mockResolvedValue("dismissed"),
      settings: jest.fn().mockResolvedValue("settings"),
      saveSettings: jest.fn().mockResolvedValue("saved"),
    },
    issues: { file: jest.fn().mockResolvedValue("filed") },
    drift: { check: jest.fn().mockResolvedValue("checked") },
  };
}

function controller(fakes: ReturnType<typeof services>): PipelineController {
  return new PipelineController(
    fakes.gaps as unknown as GapHandoffService,
    fakes.roadmap as unknown as RoadmapService,
    fakes.issues as unknown as RoadmapIssuesService,
    fakes.drift as unknown as RoadmapDriftService,
  );
}

const READS = ["card", "settings"];
const CONTRIBUTOR_WRITES = ["draftEpic", "suggest", "check"];
const ADMIN_WRITES = ["generate", "apply", "dismiss", "file", "saveSettings"];

describe("the pipeline controller", () => {
  it("serves ten routes under /research", () => {
    const base = "investigations/:investigationId";

    expect(Reflect.getMetadata(PATH_METADATA, PipelineController)).toBe("research");
    expect(
      [
        "draftEpic",
        "generate",
        "card",
        "suggest",
        "apply",
        "dismiss",
        "file",
        "check",
        "settings",
        "saveSettings",
      ].map((name) => [meta(METHOD_METADATA, name), meta(PATH_METADATA, name)]),
    ).toEqual([
      [RequestMethod.POST, `${base}/draft-epic`],
      [RequestMethod.POST, `${base}/roadmap`],
      [RequestMethod.GET, `${base}/roadmap`],
      [RequestMethod.POST, `${base}/roadmap/suggestions`],
      [RequestMethod.POST, `${base}/roadmap/suggestions/:suggestionId/apply`],
      [RequestMethod.POST, `${base}/roadmap/suggestions/:suggestionId/dismiss`],
      [RequestMethod.POST, `${base}/roadmap/issues`],
      [RequestMethod.POST, `${base}/roadmap/drift-check`],
      [RequestMethod.GET, "roadmap-settings"],
      [RequestMethod.PUT, "roadmap-settings"],
    ]);
  });

  it("lets every member read", () => {
    for (const name of READS) {
      expect(meta(REQUIRED_ROLES, name)).toBeUndefined();
      expect(meta(HUMAN_ONLY, name)).toBeUndefined();
    }
  });

  it("lets a contributor draft, suggest and check — and only a person", () => {
    for (const name of CONTRIBUTOR_WRITES) {
      expect(meta(REQUIRED_ROLES, name)).toEqual(["owner", "admin", "member"]);
      expect(meta(HUMAN_ONLY, name)).toBe(true);
    }
  });

  it("keeps everything that writes to the repository or the tracker to owners and admins", () => {
    for (const name of ADMIN_WRITES) {
      expect(meta(REQUIRED_ROLES, name)).toEqual(["owner", "admin"]);
      expect(meta(HUMAN_ONLY, name)).toBe(true);
    }
  });

  it("answers a creation 201 and an action on something that exists 200", () => {
    for (const name of ["generate", "suggest"])
      expect(meta(HTTP_CODE_METADATA, name)).toBeUndefined();
    for (const name of ["draftEpic", "apply", "dismiss", "file", "check"]) {
      expect(meta(HTTP_CODE_METADATA, name)).toBe(HttpStatus.OK);
    }
  });

  it("hands each route's request to its service, in the session's workspace", async () => {
    const fakes = services();
    const routes = controller(fakes);
    const params = { investigationId: INVESTIGATION };
    const suggestion = { investigationId: INVESTIGATION, suggestionId: SUGGESTION };

    expect(await routes.draftEpic(TENANT, PRINCIPAL, params, { targetSourceId: SOURCE })).toBe(
      "drafted",
    );
    expect(
      await routes.generate(TENANT, params, { targetSourceId: SOURCE, path: "ROADMAP.md" }),
    ).toBe("generated");
    expect(await routes.card(TENANT, params)).toBe("card");
    expect(
      await routes.suggest(TENANT, PRINCIPAL, params, { text: "Gust into MVP.", hint: { a: 1 } }),
    ).toBe("suggested");
    expect(await routes.apply(TENANT, PRINCIPAL, suggestion)).toBe("applied");
    expect(await routes.dismiss(TENANT, PRINCIPAL, suggestion)).toBe("dismissed");
    expect(await routes.file(TENANT, PRINCIPAL, params, { pushUnsized: true })).toBe("filed");
    expect(await routes.check(TENANT, params)).toBe("checked");
    expect(await routes.settings(TENANT)).toBe("settings");
    expect(await routes.saveSettings(TENANT, PRINCIPAL, { directCommit: true })).toBe("saved");

    expect(fakes.gaps.draftEpic).toHaveBeenCalledWith(
      "org-acme",
      "user-ken",
      INVESTIGATION,
      SOURCE,
    );
    expect(fakes.roadmap.generate).toHaveBeenCalledWith("org-acme", INVESTIGATION, {
      targetSourceId: SOURCE,
      path: "ROADMAP.md",
    });
    expect(fakes.roadmap.card).toHaveBeenCalledWith("org-acme", INVESTIGATION);
    expect(fakes.roadmap.suggest).toHaveBeenCalledWith("org-acme", "user-ken", INVESTIGATION, {
      text: "Gust into MVP.",
      hint: { a: 1 },
    });
    expect(fakes.roadmap.apply).toHaveBeenCalledWith(
      "org-acme",
      "user-ken",
      INVESTIGATION,
      SUGGESTION,
    );
    expect(fakes.roadmap.dismiss).toHaveBeenCalledWith(
      "org-acme",
      "user-ken",
      INVESTIGATION,
      SUGGESTION,
    );
    expect(fakes.issues.file).toHaveBeenCalledWith("org-acme", "user-ken", INVESTIGATION, {
      pushUnsized: true,
    });
    expect(fakes.drift.check).toHaveBeenCalledWith("org-acme", INVESTIGATION);
    expect(fakes.roadmap.settings).toHaveBeenCalledWith("org-acme");
    expect(fakes.roadmap.saveSettings).toHaveBeenCalledWith("org-acme", "user-ken", true);
  });

  it("passes an empty body on as nothing asked", async () => {
    const fakes = services();
    const routes = controller(fakes);
    const params = { investigationId: INVESTIGATION };

    await routes.draftEpic(TENANT, PRINCIPAL, params, {});
    await routes.generate(TENANT, params, {});
    await routes.suggest(TENANT, PRINCIPAL, params, { text: "Just words." });
    await routes.file(TENANT, PRINCIPAL, params, {});

    expect(fakes.gaps.draftEpic).toHaveBeenCalledWith(
      "org-acme",
      "user-ken",
      INVESTIGATION,
      undefined,
    );
    expect(fakes.roadmap.generate).toHaveBeenCalledWith("org-acme", INVESTIGATION, {});
    expect(fakes.roadmap.suggest).toHaveBeenCalledWith("org-acme", "user-ken", INVESTIGATION, {
      text: "Just words.",
      hint: null,
    });
    expect(fakes.issues.file).toHaveBeenCalledWith("org-acme", "user-ken", INVESTIGATION, {});
  });
});
