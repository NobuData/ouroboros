import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

/**
 * The webhook signature snippets on the notifications page (#1198) verify a real delivery.
 *
 * `fixtures/webhook-delivery.json` is one delivery as `ouroboros-rest` signs it: the body, the
 * headers `signedHeaders` produced for it, the secret, and the moment it was received. It was
 * made by calling `ouroboros-rest/src/modules/webhooks/webhook.signing.ts`'s `signedHeaders`
 * directly; the first test below holds that file to the formula the page and the fixture assume,
 * so a change to how deliveries are signed fails here rather than in a reader's receiver.
 *
 * The snippets are read out of the page itself, so what is tested is what a reader copies.
 */

/** This file's directory. */
const HERE = dirname(fileURLToPath(import.meta.url));

/** The repository root. */
const REPO_ROOT = join(HERE, "..", "..");

/** The page, as written (not whitespace-collapsed: the snippets are code). */
const PAGE = readFileSync(
  join(REPO_ROOT, "ouroboros-docs", "docs", "administration", "notifications-and-webhooks.mdx"),
  "utf8",
);

/** One signed delivery, as the fixture holds it. */
interface Delivery {
  /** The endpoint's signing secret. */
  readonly secret: string;
  /** When the receiver got it, ISO-8601. */
  readonly receivedAt: string;
  /** The request's headers, names lower-cased. */
  readonly headers: Readonly<Record<string, string>>;
  /** The raw body. */
  readonly body: string;
}

/** The fixture. */
const DELIVERY = JSON.parse(
  readFileSync(join(HERE, "fixtures", "webhook-delivery.json"), "utf8"),
) as Delivery;

/** When the fixture was received, in milliseconds. */
const RECEIVED_MS = Date.parse(DELIVERY.receivedAt);

/**
 * The one fenced block of a language on the page.
 *
 * @param language the fence's info string, such as `js`.
 * @param marker text the block must contain, to pick it from others of the same language.
 * @returns the block's code.
 * @throws {Error} when no such block exists.
 */
function snippet(language: string, marker: string): string {
  const blocks = [...PAGE.matchAll(new RegExp("```" + language + "\\n([\\s\\S]*?)```", "g"))]
    .map((match) => match[1])
    .filter((code) => code.includes(marker));
  if (blocks.length !== 1) throw new Error(`expected one ${language} block with ${marker}`);
  return blocks[0];
}

/** A scratch directory for the snippets, removed afterwards. */
const SCRATCH = mkdtempSync(join(tmpdir(), "ouro-webhook-verify-"));

afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
});

describe("the webhook signature the page describes (#1198)", () => {
  it("is the formula ouroboros-rest signs with", () => {
    const signing = readFileSync(
      join(REPO_ROOT, "ouroboros-rest", "src", "modules", "webhooks", "webhook.signing.ts"),
      "utf8",
    );
    expect(signing).toContain('createHmac("sha256", secret)');
    expect(signing).toContain(".update(`${String(timestamp)}.${body}`)");
    expect(signing).toContain('.digest("hex")');
    expect(signing).toContain("return `${SIGNATURE_SCHEME}=${mac}`;");
    expect(signing).toMatch(/export const SIGNATURE_SCHEME = "v1";/);
    expect(DELIVERY.headers["x-ouro-signature"]).toMatch(/^v1=[0-9a-f]{64}$/);
  });
});

describe("the Node.js snippet (#1198)", () => {
  /** The snippet's `verify`, loaded from the page. */
  async function load(): Promise<
    (secret: string, headers: Record<string, string>, body: string, now?: number) => boolean
  > {
    const file = join(SCRATCH, "verify.mjs");
    writeFileSync(file, snippet("js", "export function verify"));
    const module = (await import(pathToFileURL(file).href)) as {
      verify: (
        secret: string,
        headers: Record<string, string>,
        body: string,
        now?: number,
      ) => boolean;
    };
    return module.verify;
  }

  it("accepts the fixture's delivery", async () => {
    const verify = await load();
    expect(verify(DELIVERY.secret, { ...DELIVERY.headers }, DELIVERY.body, RECEIVED_MS)).toBe(true);
  });

  it("refuses a tampered body, a wrong secret and a replay", async () => {
    const verify = await load();
    const headers = { ...DELIVERY.headers };
    expect(
      verify(DELIVERY.secret, headers, DELIVERY.body.replace("human", "bot"), RECEIVED_MS),
    ).toBe(false);
    expect(verify("whsec_someone_else", headers, DELIVERY.body, RECEIVED_MS)).toBe(false);
    expect(verify(DELIVERY.secret, headers, DELIVERY.body, RECEIVED_MS + 301_000)).toBe(false);
    expect(verify(DELIVERY.secret, headers, DELIVERY.body, RECEIVED_MS + 299_000)).toBe(true);
  });

  it("finds the v1 value among several signatures", async () => {
    const verify = await load();
    const headers = {
      ...DELIVERY.headers,
      "x-ouro-signature": `v2=abc, ${DELIVERY.headers["x-ouro-signature"]}`,
    };
    expect(verify(DELIVERY.secret, headers, DELIVERY.body, RECEIVED_MS)).toBe(true);
  });
});

/** Whether a `python3` is on the path. CI's runners have one; a bare machine may not. */
const PYTHON = spawnSync("python3", ["--version"]).status === 0;

describe.skipIf(!PYTHON)("the Python snippet (#1198)", () => {
  it("accepts the fixture's delivery and refuses a tampered one, a wrong secret and a replay", () => {
    const harness = [
      snippet("python", "def verify"),
      "import json, sys",
      "d = json.load(open(sys.argv[1]))",
      "now = int(sys.argv[2])",
      "body = d['body'].encode()",
      "print(verify(d['secret'], d['headers'], body, now))",
      "print(verify(d['secret'], d['headers'], body.replace(b'human', b'bot'), now))",
      "print(verify('whsec_someone_else', d['headers'], body, now))",
      "print(verify(d['secret'], d['headers'], body, now + 301))",
    ].join("\n");
    const file = join(SCRATCH, "verify.py");
    writeFileSync(file, harness);
    const run = spawnSync(
      "python3",
      ["-I", file, join(HERE, "fixtures", "webhook-delivery.json"), String(RECEIVED_MS / 1000)],
      { encoding: "utf8" },
    );
    expect(run.stderr).toBe("");
    expect(run.stdout.trim().split("\n")).toEqual(["True", "False", "False", "False"]);
  });
});
