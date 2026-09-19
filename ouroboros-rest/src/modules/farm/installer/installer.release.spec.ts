import {
  INSTALL_SCRIPT_FILE,
  RELEASE_FILES,
  SHELL_SCRIPT_MEDIA_TYPE,
  fillServer,
  installerOrigin,
  isReleaseFile,
  isReleaseVersion,
  newestRelease,
  shellQuote,
} from "./installer.release";

/**
 * The rules a runner release is served by (#248), without a file system: which names a request
 * may reach, which release is the default, and the one line this service changes.
 */

/** An installer as the repository carries it — the two published lines, empty. */
const SCRIPT = [
  "#!/bin/sh",
  "set -eu",
  "DEFAULT_SERVER=''",
  "DEFAULT_VERSION='0.5.0'",
  'echo "$DEFAULT_SERVER"',
  "",
].join("\n");

describe("the files a release holds", () => {
  it("are the three binaries, the installer and the checksums — as make release names them", () => {
    expect(Object.keys(RELEASE_FILES).sort()).toEqual([
      "SHA256SUMS",
      "install.sh",
      "ouroboros-runner-darwin-arm64",
      "ouroboros-runner-linux-amd64",
      "ouroboros-runner-linux-arm64",
    ]);
  });

  it("serve a binary as bytes, the installer as a shell script and the checksums as text", () => {
    expect(RELEASE_FILES["ouroboros-runner-linux-arm64"]).toBe("application/octet-stream");
    expect(RELEASE_FILES[INSTALL_SCRIPT_FILE]).toBe(SHELL_SCRIPT_MEDIA_TYPE);
    expect(SHELL_SCRIPT_MEDIA_TYPE).toMatch(/^text\/x-shellscript/u);
    expect(RELEASE_FILES.SHA256SUMS).toMatch(/^text\/plain/u);
  });

  it.each(Object.keys(RELEASE_FILES))("admits %s", (name) => {
    expect(isReleaseFile(name)).toBe(true);
  });

  // The allow-list is the traversal defence: nothing a request sends is joined into a path
  // unless it is one of the five. Prototype names are here because a plain `in` would say yes.
  it.each([
    [".."],
    ["../../etc/passwd"],
    ["SHA256SUMS.bak"],
    ["ouroboros-runner"],
    ["ouroboros-runner-windows-amd64"],
    [""],
    ["constructor"],
    ["__proto__"],
    ["toString"],
  ])("refuses %j", (name) => {
    expect(isReleaseFile(name)).toBe(false);
  });
});

describe("a release's version", () => {
  it.each([["0.5.0"], ["1.0.0-rc.1"], ["0.10.0+build.7"]])("admits %s", (version) => {
    expect(isReleaseVersion(version)).toBe(true);
  });

  it.each([["v0.5.0"], ["0.5"], ["latest"], [".."], ["0.5.0/../../etc"], [""]])(
    "refuses %j — SemVer has no slash, so a version can only ever name a child directory",
    (version) => {
      expect(isReleaseVersion(version)).toBe(false);
    },
  );
});

describe("the release /install.sh serves by default", () => {
  it("is the newest by precedence, not by string order", () => {
    expect(newestRelease(["0.9.0", "0.10.0", "0.4.2"])).toBe("0.10.0");
  });

  it("is a stable release when there is one, even beside a newer pre-release", () => {
    // An operator who copied in a release candidate to try it on one machine has not asked
    // for every new machine to get it.
    expect(newestRelease(["0.5.0", "0.6.0-rc.1"])).toBe("0.5.0");
  });

  it("is the newest pre-release when there is nothing else", () => {
    expect(newestRelease(["0.6.0-rc.1", "0.6.0-rc.2", "0.6.0-alpha"])).toBe("0.6.0-rc.2");
  });

  it("ignores entries that are not versions", () => {
    expect(newestRelease(["lost+found", "latest", "0.5.0", ".DS_Store"])).toBe("0.5.0");
  });

  it("is nothing, when there are no releases", () => {
    expect(newestRelease([])).toBeUndefined();
    expect(newestRelease(["README", "tmp"])).toBeUndefined();
  });
});

describe("filling the installer in", () => {
  it("writes the origin into DEFAULT_SERVER, quoted", () => {
    const filled = fillServer(SCRIPT, "https://ouroboros.acme.dev");

    expect(filled).toContain("\nDEFAULT_SERVER='https://ouroboros.acme.dev'\n");
  });

  it("changes nothing else", () => {
    const filled = fillServer(SCRIPT, "https://ouroboros.acme.dev")!;

    expect(filled.replace("'https://ouroboros.acme.dev'", "''")).toBe(SCRIPT);
  });

  it("refuses an installer without the line, rather than serving one that asks for --server", () => {
    expect(
      fillServer(SCRIPT.replace("DEFAULT_SERVER=''", "SERVER=''"), "https://x.dev"),
    ).toBeUndefined();
  });

  it("refuses an installer whose line was already filled in", () => {
    // Filling in twice would mean somebody else's origin is the one being served.
    const once = fillServer(SCRIPT, "https://first.dev")!;

    expect(fillServer(once, "https://second.dev")).toBeUndefined();
  });

  it("does not take an indented or commented mention for the line", () => {
    const decoy = "#!/bin/sh\n# DEFAULT_SERVER=''\n  DEFAULT_SERVER=''\n";

    expect(fillServer(decoy, "https://x.dev")).toBeUndefined();
  });
});

describe("quoting for the shell", () => {
  it("wraps a plain value in single quotes", () => {
    expect(shellQuote("https://ouroboros.acme.dev")).toBe("'https://ouroboros.acme.dev'");
  });

  it("closes, escapes and reopens around a single quote, so nothing can break out", () => {
    expect(shellQuote("a'b")).toBe(`'a'\\''b'`);
  });

  it("leaves expansions inert", () => {
    expect(shellQuote("$(id)`id`")).toBe("'$(id)`id`'");
  });
});

describe("the origin the installer names", () => {
  it("is OURO_FARM_PUBLIC_URL when it is set", () => {
    expect(installerOrigin("https://farm.acme.dev", "https://ouroboros.acme.dev")).toBe(
      "https://farm.acme.dev",
    );
  });

  it("is OURO_REST_URL otherwise, when that is https", () => {
    expect(installerOrigin(undefined, "https://ouroboros.acme.dev")).toBe(
      "https://ouroboros.acme.dev",
    );
  });

  it("is nothing when the fallback is plain http — the agent speaks TLS only", () => {
    expect(installerOrigin(undefined, "http://localhost:4000")).toBeUndefined();
  });
});
