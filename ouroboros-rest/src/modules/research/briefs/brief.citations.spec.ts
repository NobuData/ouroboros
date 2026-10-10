import {
  citeLabel,
  locatorLabel,
  parseGitLocator,
  repositoryHref,
  repositoryResolver,
  sourceHref,
} from "./brief.citations";

/** How a citation is named and linked (#621). */

describe("a citation's label", () => {
  it("pads a number to two digits, and leaves a longer one alone", () => {
    expect(citeLabel({ citeNo: 7, citeKey: null })).toBe("[07]");
    expect(citeLabel({ citeNo: 44, citeKey: null })).toBe("[44]");
    expect(citeLabel({ citeNo: 312, citeKey: null })).toBe("[312]");
  });

  it("is the symbolic key when the record has one", () => {
    expect(citeLabel({ citeNo: 44, citeKey: "git" })).toBe("[git]");
  });
});

describe("a git locator", () => {
  it("reads a repository, commit, path and line", () => {
    expect(parseGitLocator("git://helios-firmware@8c1b2e4/src/dock/dock_ctrl.c#L214")).toEqual({
      repository: "helios-firmware",
      sha: "8c1b2e4",
      path: "src/dock/dock_ctrl.c",
      lines: [214, 214],
    });
  });

  it("reads an owner, a line range and a bare repository", () => {
    expect(
      parseGitLocator("git://acme-robotics/helios-firmware@8c1b2e4/src/a.c#L200-L230"),
    ).toEqual({
      repository: "acme-robotics/helios-firmware",
      sha: "8c1b2e4",
      path: "src/a.c",
      lines: [200, 230],
    });
    expect(parseGitLocator("git://helios-firmware@8c1b2e4")).toEqual({
      repository: "helios-firmware",
      sha: "8c1b2e4",
      path: null,
      lines: null,
    });
  });

  it("is nothing for any other locator", () => {
    expect(parseGitLocator("https://example.com")).toBeNull();
    expect(parseGitLocator("git://helios-firmware@not-a-sha/x")).toBeNull();
  });
});

describe("a locator, as the panel prints it", () => {
  it("drops a web address's scheme and trailing slash", () => {
    expect(locatorLabel("web", "https://droneanalysts.example.com/s4-teardown")).toBe(
      "droneanalysts.example.com/s4-teardown",
    );
    expect(locatorLabel("doc", "http://example.com/")).toBe("example.com");
  });

  it("spells a code locator as repository, commit and path", () => {
    expect(locatorLabel("code", "git://helios-firmware@8c1b2e4/src/dock/dock_ctrl.c#L214")).toBe(
      "helios-firmware @ 8c1b2e4 · src/dock/dock_ctrl.c",
    );
    expect(locatorLabel("code", "git://helios-firmware@8c1b2e4")).toBe("helios-firmware @ 8c1b2e4");
  });

  it("leaves an internal locator as it is", () => {
    expect(locatorLabel("ticket", "issue-index://support/churn-2026-q2")).toBe(
      "issue-index://support/churn-2026-q2",
    );
    expect(locatorLabel("telemetry", "telemetry://fleet.docking_success/30d")).toBe(
      "telemetry://fleet.docking_success/30d",
    );
    expect(locatorLabel("code", "bisect://5eed/abc")).toBe("bisect://5eed/abc");
  });
});

describe("where a source opens", () => {
  const resolve = repositoryResolver(["acme-robotics/helios-firmware", "acme-robotics/tools"]);

  it("is the page itself for a web address", () => {
    expect(sourceHref("web", "https://skylink.example.com/releases/6.2", resolve)).toBe(
      "https://skylink.example.com/releases/6.2",
    );
  });

  it("is the file at its commit for a code source whose repository resolves", () => {
    expect(
      sourceHref("code", "git://helios-firmware@8c1b2e4/src/dock/dock_ctrl.c#L214", resolve),
    ).toBe(
      "https://github.com/acme-robotics/helios-firmware/blob/8c1b2e4/src/dock/dock_ctrl.c#L214",
    );
  });

  it("is nowhere for an internal locator, an unknown repository or a non-git code locator", () => {
    expect(sourceHref("ticket", "issue-index://support/churn-2026-q2", resolve)).toBeNull();
    expect(sourceHref("code", "git://elsewhere@8c1b2e4/a.c", resolve)).toBeNull();
    expect(sourceHref("code", "bisect://5eed/abc", resolve)).toBeNull();
  });

  it("links a range, a path with no line, and a commit's tree", () => {
    expect(repositoryHref("a/b", "8c1b2e4", "src/x y.c", [3, 9])).toBe(
      "https://github.com/a/b/blob/8c1b2e4/src/x%20y.c#L3-L9",
    );
    expect(repositoryHref("a/b", "8c1b2e4", "src/x.c", null)).toBe(
      "https://github.com/a/b/blob/8c1b2e4/src/x.c",
    );
    expect(repositoryHref("a/b", "8c1b2e4", null, null)).toBe(
      "https://github.com/a/b/tree/8c1b2e4",
    );
  });
});

describe("the repository resolver", () => {
  it("matches a full slug exactly, in any case", () => {
    const resolve = repositoryResolver(["Acme-Robotics/Helios-Firmware"]);

    expect(resolve("acme-robotics/helios-firmware")).toBe("acme-robotics/helios-firmware");
    expect(resolve("other/helios-firmware")).toBeNull();
  });

  it("resolves a bare name only one repository has, and never guesses between two", () => {
    expect(repositoryResolver(["acme/helios", "acme/tools"])(" Helios ")).toBe("acme/helios");
    expect(repositoryResolver(["acme/helios", "labs/helios"])("helios")).toBeNull();
    expect(repositoryResolver([])("helios")).toBeNull();
  });
});
