import {
  INSTALL_SCRIPT_PATH,
  INSTALLER_PATHS,
  RELEASE_FILE_PATH,
  isInstallerBase,
  isInstallerPath,
} from "./installer.paths";

/**
 * Where the installer answers (#248) — the one definition the controllers, the global prefix's
 * exclusions, the route table and the specification suite all read.
 */

describe("the installer's paths", () => {
  it("sit at the origin root, outside /api/v1", () => {
    expect(INSTALL_SCRIPT_PATH).toBe("/install.sh");
    expect(RELEASE_FILE_PATH).toBe("/runner/:version/:file");
    expect(INSTALLER_PATHS).toEqual(["/install.sh", "/runner/:version/:file"]);
  });

  it.each([["install.sh"], ["runner"]])("recognise the controller path %s", (base) => {
    expect(isInstallerBase(base)).toBe(true);
  });

  it.each([["farm"], ["health"], ["runners"], [""]])("do not claim %j", (base) => {
    expect(isInstallerBase(base)).toBe(false);
  });

  it.each([["/install.sh"], ["/runner/0.5.0/SHA256SUMS"], ["/runner/{version}/{file}"]])(
    "recognise %s as the installer's",
    (path) => {
      expect(isInstallerPath(path)).toBe(true);
    },
  );

  it.each([["/api/v1/install.sh"], ["/install.sh.bak"], ["/runners"], ["/health/live"]])(
    "do not claim %s",
    (path) => {
      expect(isInstallerPath(path)).toBe(false);
    },
  );
});
