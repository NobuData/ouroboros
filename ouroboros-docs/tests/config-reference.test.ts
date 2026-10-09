import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  anchorOf,
  escapeMdx,
  parseEnvExample,
  renderReference,
  stripReferences,
  variablesOf,
} from "../scripts/config-reference.ts";
import { envVarHref } from "../src/components/EnvVar";

/** The module directory (`ouroboros-docs/`). */
const MODULE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The repository's real template. */
const TEMPLATE = readFileSync(join(MODULE_DIR, "..", ".env.example"), "utf8");

/** The committed generated partial. */
const GENERATED = readFileSync(
  join(MODULE_DIR, "docs", "administration", "configuration", "_generated.mdx"),
  "utf8",
);

/** The page that wraps it. */
const PAGE = readFileSync(
  join(MODULE_DIR, "docs", "administration", "configuration", "index.mdx"),
  "utf8",
);

/**
 * Builds a section header the way `.env.example` writes one.
 *
 * @param title the header's title.
 * @returns its three lines.
 */
function header(title: string): string {
  const rule = `# ${"-".repeat(75)}`;
  return [rule, `# ${title}`, rule].join("\n");
}

describe("parseEnvExample", () => {
  it("reads a set variable with its description and development default", () => {
    const [section] = parseEnvExample(
      [
        header("Mail — ouroboros-rest"),
        "",
        "# Where mail goes.",
        "# Two lines.",
        "OURO_SMTP_URL=smtp://localhost:1025",
        "",
      ].join("\n"),
    );
    expect(section.title).toBe("Mail — ouroboros-rest");
    expect(section.variables).toEqual([
      {
        name: "OURO_SMTP_URL",
        state: "set",
        value: "smtp://localhost:1025",
        secret: false,
        paragraphs: [{ kind: "text", body: "Where mail goes. Two lines." }],
      },
    ]);
  });

  it("marks a …-change-me placeholder as a generated secret", () => {
    const [section] = parseEnvExample(
      [header("Auth"), "", "# The secret.", "BETTER_AUTH_SECRET=dev-secret-change-me"].join("\n"),
    );
    expect(section.variables[0]).toMatchObject({ name: "BETTER_AUTH_SECRET", secret: true });
  });

  it("reads a commented-out assignment ending a block as unset, with its example", () => {
    const [section] = parseEnvExample(
      [
        header("Farm"),
        "",
        "# A header name.",
        "# OURO_FARM_CLIENT_CERT_HEADER=x-ouro-client-cert",
        "",
      ].join("\n"),
    );
    expect(section.variables[0]).toMatchObject({
      name: "OURO_FARM_CLIENT_CERT_HEADER",
      state: "unset",
      value: "x-ouro-client-cert",
      paragraphs: [{ kind: "text", body: "A header name." }],
    });
  });

  it("reads an indented example ending a block as an unset variable", () => {
    const [section] = parseEnvExample(
      [header("Onboarding"), "", "# A label.", "#", "#   OURO_DATA_REGION=eu-central-1", ""].join(
        "\n",
      ),
    );
    expect(section.variables[0]).toMatchObject({
      name: "OURO_DATA_REGION",
      state: "unset",
      value: "eu-central-1",
      paragraphs: [{ kind: "text", body: "A label." }],
    });
  });

  it("keeps an indented example inside prose as code, not a variable", () => {
    const [section] = parseEnvExample(
      [
        header("GitHub"),
        "",
        "# The API.",
        "#",
        "#   OURO_GITHUB_API_BASE_URL=https://ghe.example.com/api/v3",
        "#",
        "# It moves the address.",
        "OURO_GITHUB_API_BASE_URL=https://api.github.com",
      ].join("\n"),
    );
    expect(section.variables).toHaveLength(1);
    expect(section.variables[0].paragraphs).toEqual([
      { kind: "text", body: "The API." },
      { kind: "code", body: "OURO_GITHUB_API_BASE_URL=https://ghe.example.com/api/v3" },
      { kind: "text", body: "It moves the address." },
    ]);
  });

  it("lets a variable with no comment of its own share the one above", () => {
    const [section] = parseEnvExample(
      [
        header("Pools"),
        "",
        "# Which pools run.",
        "OURO_MANAGED_KEY_POOL=false",
        "OURO_HOSTED_RUNNER_POOL=false",
      ].join("\n"),
    );
    expect(section.variables[1]).toMatchObject({
      name: "OURO_HOSTED_RUNNER_POOL",
      sharesWith: "OURO_MANAGED_KEY_POOL",
    });
  });

  it("drops a block that describes the file rather than a variable", () => {
    const sections = parseEnvExample(
      [
        "# Intro to the file.",
        "",
        header("Wiring"),
        "",
        "# The UI.",
        "OURO_UI_URL=http://localhost:3000",
        "",
        "# A note on nothing.",
        "",
      ].join("\n"),
    );
    expect(variablesOf(sections).map((variable) => variable.paragraphs)).toEqual([
      [{ kind: "text", body: "The UI." }],
    ]);
  });

  it("refuses a variable declared twice", () => {
    expect(() => parseEnvExample([header("A"), "OURO_X=1", "", "OURO_X=2"].join("\n"))).toThrow(
      "OURO_X is declared twice",
    );
  });

  it("refuses a variable before any section", () => {
    expect(() => parseEnvExample("OURO_X=1\n")).toThrow("declared before any section");
  });
});

describe("stripReferences", () => {
  it.each([
    ["The header (issue #250, decision B3).", "The header."],
    ["Lifecycle — ouroboros-rest (BR.5, #489)", "Lifecycle — ouroboros-rest"],
    ["Seals it with (roadmap decision P2, issue #222). Exactly", "Seals it with. Exactly"],
    [
      "See docker-compose.yml (see docker-compose.yml)",
      "See docker-compose.yml (see docker-compose.yml)",
    ],
    ["letters, digits and . _ : / ( ) -", "letters, digits and . _ : / ( ) -"],
  ])("turns %j into %j", (input, output) => {
    expect(stripReferences(input)).toBe(output);
  });
});

describe("escapeMdx", () => {
  it("escapes braces and angle brackets outside code spans only", () => {
    expect(escapeMdx("under <state-dir>/{x} and `<kept>{kept}`")).toBe(
      "under &lt;state-dir>/\\{x\\} and `<kept>{kept}`",
    );
  });

  it("sets a bare address as code, without the punctuation that ends its sentence", () => {
    expect(escapeMdx("Shown at http://localhost:8025, then.")).toBe(
      "Shown at `http://localhost:8025`, then.",
    );
  });
});

describe("renderReference", () => {
  const sections = parseEnvExample(
    [
      header("Mail — ouroboros-rest"),
      "",
      "# Where mail goes.",
      "#",
      "#   smtp://user@host",
      "OURO_SMTP_URL=",
      "",
      "# The secret.",
      "OURO_ENGINE_SHARED_SECRET=dev-change-me",
      "",
      "# Optional.",
      "# OURO_MAIL_FROM=no-reply@example.com",
    ].join("\n"),
  );
  const out = renderReference(sections);

  it("writes a heading per section and per variable", () => {
    expect(out).toContain("## Mail — ouroboros-rest\n");
    expect(out).toContain("### `OURO_SMTP_URL`\n");
    expect(out).toContain("### `OURO_ENGINE_SHARED_SECRET`\n");
  });

  it("states each development default", () => {
    expect(out).toContain("**Development default:** empty.");
    expect(out).toContain("**Development default:** a secret, generated by `yarn setup`.");
    expect(out).toContain("**Development default:** unset. Example: `no-reply@example.com`");
  });

  it("fences code paragraphs", () => {
    expect(out).toContain("```text\nsmtp://user@host\n```");
  });

  it("opens with front matter carrying the do-not-edit notice", () => {
    expect(out.startsWith("---\n# Generated from the root .env.example")).toBe(true);
  });

  it("refuses a description that still cites an issue outside parentheses", () => {
    const citing = parseEnvExample([header("A"), "# Added by issue #12.", "OURO_X=1"].join("\n"));
    expect(() => renderReference(citing)).toThrow(
      "OURO_X: its comment in .env.example still cites",
    );
  });
});

describe("the configuration reference (#1191)", () => {
  const variables = variablesOf(parseEnvExample(TEMPLATE));

  it("is current with the root .env.example", () => {
    expect(GENERATED).toBe(renderReference(parseEnvExample(TEMPLATE)));
  });

  it("lists every variable the template assigns, commented or not", () => {
    const assigned = new Set(
      [...TEMPLATE.matchAll(/^(?:# )?([A-Z][A-Z0-9_]*)=/gm)].map((match) => match[1]),
    );
    const listed = new Set(variables.map((variable) => variable.name));
    for (const name of assigned) expect(listed).toContain(name);
    expect(listed.size).toBeGreaterThanOrEqual(80);
  });

  it("gives every variable the anchor <EnvVar> links to", () => {
    for (const { name } of variables) {
      expect(GENERATED).toContain(`### \`${name}\`\n`);
      expect(envVarHref(name)).toBe(`/administration/configuration#${anchorOf(name)}`);
    }
  });

  it("names every …-change-me placeholder a generated secret and prints none of them", () => {
    const placeholders = [...TEMPLATE.matchAll(/^([A-Z][A-Z0-9_]*)=.*-change-me$/gm)].map(
      (match) => match[1],
    );
    expect(placeholders.length).toBeGreaterThan(0);
    for (const name of placeholders) {
      expect(variables.find((variable) => variable.name === name)?.secret).toBe(true);
    }
    expect(GENERATED).not.toContain("-change-me");
  });

  it("carries no internal issue references in its prose", () => {
    const prose = GENERATED.replace(/^---\n[\s\S]*?\n---\n/, "").replace(/`[^`]*`/g, "");
    expect(prose).not.toMatch(/#\d{2,}|\[[A-Z]{1,2}\.\d+\]|\bV\d{3}\b/);
  });

  it("is wrapped by the page, which links one variable so the build checks the anchors", () => {
    expect(PAGE).toContain('import Generated, { toc as generatedToc } from "./_generated.mdx";');
    expect(PAGE).toContain("<Generated />");
    expect(PAGE).toContain('<EnvVar name="OURO_VAULT_MASTER_KEY" />');
  });
});

describe("gen-config-reference --check", () => {
  const script = join(MODULE_DIR, "scripts", "gen-config-reference.ts");

  it("passes while the generated file is current", () => {
    expect(execFileSync("node", [script, "--check"], { encoding: "utf8" })).toContain("matches");
  });

  it("refuses an unknown argument with exit code 2", () => {
    const result = spawnSync("node", [script, "--frobnicate"], { encoding: "utf8" });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("only --check is accepted");
  });
});
