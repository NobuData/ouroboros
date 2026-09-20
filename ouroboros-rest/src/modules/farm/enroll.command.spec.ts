import { installerUrl, renderEnrollCommand } from "./enroll.command";

/**
 * The one-liner, and the three things about it the issue calls out: **the deployment's own
 * origin**, **a pinned version**, and **a token that actually enrols**.
 *
 * The fourth property is not in the issue and is the one a bug would hide in: the string's
 * destination is a shell, so every value in it is quoted. `?` is a glob character and `&`
 * backgrounds a command — an unquoted installer URL is a URL the shell rewrites, or a job it
 * detaches before anything is downloaded.
 */

/** What the fixture deployment serves from. */
const ORIGIN = "https://ouroboros.acme.dev";

/** The release it would install. */
const VERSION = "0.7.0";

/** A token shaped like the real thing, and not one. */
const TOKEN = "orb_enroll_0123456789abcdef.notarealsecretvaluebuttherightshape";

/** The command a case renders unless it varies something. */
function command(overrides: Record<string, string> = {}): string {
  return renderEnrollCommand({
    origin: ORIGIN,
    version: VERSION,
    tenant: "acme-robotics",
    pool: "pool-a",
    token: TOKEN,
    ...overrides,
  });
}

describe("the installer URL", () => {
  it("is this deployment's own, never a public host", () => {
    // Mockup 08 reads `get.ouroboros.dev`, which is design shorthand: a self-hosted
    // deployment behind a firewall installs from itself and trusts no public host with a
    // binary that will run on its build machines.
    expect(installerUrl(ORIGIN, VERSION)).toBe(
      "https://ouroboros.acme.dev/install.sh?version=0.7.0",
    );
    expect(installerUrl(ORIGIN, VERSION)).not.toContain("get.ouroboros.dev");
  });

  it("pins the version, so one pasted command is one build", () => {
    // Without `?version=` the command would install whatever was newest on the day it ran
    // rather than the day it was copied.
    expect(installerUrl(ORIGIN, "0.8.1")).toContain("version=0.8.1");
  });

  it("gives one path whether or not the origin carries a trailing slash", () => {
    expect(installerUrl("https://ouroboros.acme.dev/", VERSION)).toBe(
      installerUrl(ORIGIN, VERSION),
    );
  });

  it("names the route the installer controller actually serves", () => {
    // `installer.paths.ts` owns `/install.sh`, and a path that moved in one place and not the
    // other is a one-liner that downloads nothing.
    expect(installerUrl(ORIGIN, VERSION)).toContain("/install.sh");
  });
});

describe("the rendered command", () => {
  it("is mockup 08's one-liner, wrapped the way the card wraps it", () => {
    expect(command()).toBe(
      [
        "curl -fsSL 'https://ouroboros.acme.dev/install.sh?version=0.7.0' | sh -s -- \\",
        "  --tenant 'acme-robotics' \\",
        "  --pool 'pool-a' \\",
        `  --token '${TOKEN}'`,
      ].join("\n"),
    );
  });

  it("passes the flags the installer actually parses", () => {
    // `ouroboros-runner/install.sh` reads `--tenant`, `--pool` and `--token`; a flag it does
    // not know is a command that dies before it installs anything.
    const rendered = command();

    expect(rendered).toContain("--tenant ");
    expect(rendered).toContain("--pool ");
    expect(rendered).toContain("--token ");
  });

  it("carries the token in full, because a masked one enrols nothing", () => {
    // The acceptance criterion — *a command that actually enrols a runner*.
    expect(command()).toContain(TOKEN);
    expect(command()).not.toContain("••••");
  });

  it("quotes the URL, so a shell cannot rewrite it or detach the job", () => {
    // The load-bearing one. Unquoted, `?` is a glob and `&` would background `curl` — the
    // command would either fetch a different URL or return before anything downloaded.
    expect(command()).toContain("'https://ouroboros.acme.dev/install.sh?version=0.7.0'");
  });

  it("quotes every value, including the ones that do not need it today", () => {
    // The workspace slug comes out of a column, and a rendering function should not depend on
    // what that column happens to be constrained to somewhere else.
    const rendered = command({ tenant: "acme robotics; rm -rf /", pool: "pool-a" });

    expect(rendered).toContain("--tenant 'acme robotics; rm -rf /'");
    // Inside single quotes nothing is expanded, so the value is one inert word.
    expect(rendered).not.toContain("--tenant acme robotics");
  });

  it("closes, escapes and reopens a single quote rather than ending the word early", () => {
    // The one case naive quoting gets wrong, and it would turn the rest of the line into
    // shell rather than into an argument.
    expect(command({ tenant: "o'brien" })).toContain(`--tenant 'o'\\''brien'`);
  });

  it("continues each line with a backslash, so the four lines are one command", () => {
    const lines = command().split("\n");

    expect(lines).toHaveLength(4);
    for (const line of lines.slice(0, 3)) expect(line.endsWith(" \\")).toBe(true);
    expect(lines[3].endsWith("\\")).toBe(false);
  });
});
