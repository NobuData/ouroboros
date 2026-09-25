import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { Logger } from "@nestjs/common";

import type { AppConfigService, ArtifactSettings } from "../../config/config.service";
import { DomainError } from "../../errors/error.envelope";
import { CoverageParser } from "../../test-results/coverage.parser";
import { HilParser } from "../../test-results/hil.parser";
import { JunitParser } from "../../test-results/junit.parser";
import { TestResultParserRegistry } from "../../test-results/parser.registry";
import type { ParseReport, TestResultIngestService } from "../../test-results/test-results.service";
import { buildJob, JOB, ORG } from "../dispatch/dispatch.fixture";
import { ArtifactStoreError, type ArtifactStore } from "./artifact.store";
import { LocalArtifactStore } from "./local.store";
import { ARTIFACT_ERRORS } from "./upload.errors";
import { parseManifest } from "./upload.manifest";
import {
  checksumOf,
  manifestOf,
  mockupFiles,
  multipart,
  uploadBody,
  type FixtureFile,
  type MultipartBody,
} from "./upload.fixture";
import { BUILT_IN_ARTIFACT_GLOBS, UPLOAD_MAX_FILES, UPLOAD_TOKEN_GRACE_MS } from "./upload.policy";
import type {
  ClosedUpload,
  UploadClose,
  UploadLedger,
  UploadRepository,
} from "./upload.repository";
import { ArtifactUploadService, receiptOf } from "./upload.service";
import { hashUploadToken, mintUploadToken } from "./upload.token";

/**
 * The job-scoped artifact upload (#330), with the database stood in for and everything else real:
 * the local-volume store in a temporary directory, AT.1's three parsers for detection, and the
 * multipart an agent sends. The PostgreSQL half — the ledger, the rows and the receipt — is
 * `upload.integration-spec.ts`.
 */

const NOW = new Date("2026-09-25T12:00:00.000Z");
const RUN = "7f000009-0000-4000-8000-000000000482";
const TEST_RUN = "7f00000a-0000-4000-8000-000000004823";

const SETTINGS: ArtifactSettings = {
  store: "local",
  dir: "unused",
  s3Region: "us-east-1",
  quotaBytes: 10_000_000,
  maxFileBytes: 1_000_000,
  maxJobBytes: 4_000_000,
  retentionDays: 30,
};

/** What the parse orchestration answers for Build 3's JUnit and lcov. */
const REPORT: ParseReport = {
  testRunId: TEST_RUN,
  totals: { total: 5, passed: 3, failed: 1, flaky: 1, skipped: 0 },
  split: { wallMs: null, simMs: null, physicalMs: null },
  warnings: [],
  parsedBy: { "junit-build3.xml": "junit", "coverage/lcov.info": "coverage" },
  coverage: {
    linesCovered: 4475,
    linesTotal: 5120,
    percent: 87.4,
    files: [{ file: "coverage/lcov.info", linesCovered: 4475, linesTotal: 5120 }],
  },
};

let root: string;
let store: ArtifactStore;
let settings: ArtifactSettings;
let token: string;
let ledger: UploadLedger;
let usage: number;
let closes: UploadClose[];
let closeAnswer: "closed" | "raced";
let parse: jest.Mock;
let repository: jest.Mocked<
  Pick<UploadRepository, "mint" | "ledger" | "usage" | "attempt" | "close">
>;
let service: ArtifactUploadService;

beforeEach(async () => {
  jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);

  root = await mkdtemp(join(tmpdir(), "ouro-upload-"));
  store = new LocalArtifactStore(root);
  settings = { ...SETTINGS };
  token = mintUploadToken().token;
  ledger = {
    jobId: JOB,
    organizationId: ORG,
    tokenHash: hashUploadToken(token),
    expiresAt: new Date(NOW.getTime() + 60_000),
    closedAt: null,
    runId: RUN,
    commitSha: "9e7bd4034c1f1b2a6d8e0f5c7a9b3d1e2f4a6c80",
  };
  usage = 0;
  closes = [];
  closeAnswer = "closed";
  parse = jest.fn().mockResolvedValue(REPORT);

  repository = {
    mint: jest.fn().mockResolvedValue(true),
    ledger: jest.fn().mockImplementation(() => Promise.resolve(ledger)),
    usage: jest.fn().mockImplementation(() => Promise.resolve(usage)),
    attempt: jest.fn().mockResolvedValue(TEST_RUN),
    close: jest.fn().mockImplementation((close: UploadClose): Promise<ClosedUpload | undefined> => {
      closes.push(close);
      if (closeAnswer === "raced") return Promise.resolve(undefined);
      const ids = new Map(
        close.artifacts.map((row, index) => [row.name, `artifact-${String(index)}`]),
      );
      return Promise.resolve(close.receipt(ids));
    }),
  };

  service = new ArtifactUploadService(
    repository as unknown as UploadRepository,
    store,
    new TestResultParserRegistry([new HilParser(), new CoverageParser(), new JunitParser()]),
    { parseAttempt: parse } as unknown as TestResultIngestService,
    {
      get artifacts() {
        return settings;
      },
    } as unknown as AppConfigService,
    () => NOW,
  );
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/**
 * Send a body as the agent would.
 *
 * @param body - The multipart.
 * @param authorization - The header; the minted token's bearer credential by default.
 * @returns The receipt.
 */
function send(body: MultipartBody, authorization: unknown = `Bearer ${token}`) {
  return service.accept({
    jobId: JOB,
    authorization,
    contentType: body.contentType,
    body: Readable.from([body.body]),
  });
}

/**
 * The refusal a request earns.
 *
 * @param promise - The request.
 * @returns The error, which must be a DomainError.
 */
async function refusal(promise: Promise<unknown>): Promise<DomainError> {
  const error: unknown = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(DomainError);
  return error as DomainError;
}

/** Every object left in the store. */
async function storedObjects(): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
}

describe("minting an offer's upload", () => {
  it("gives a run-attributed job a single-use token, its path, the globs and the caps", async () => {
    const job = buildJob({ run_id: RUN, artifact_globs: ["captures/*.csv"] });

    const upload = await service.forOffer(job, NOW, 3_600_000);

    expect(upload).toEqual({
      path: `/api/v1/farm/jobs/${JOB}/artifacts`,
      token: expect.stringMatching(/^ouro_upl_/) as string,
      expires_at: new Date(NOW.getTime() + 3_600_000 + UPLOAD_TOKEN_GRACE_MS).toISOString(),
      globs: [...BUILT_IN_ARTIFACT_GLOBS, "captures/*.csv"],
      max_file_bytes: SETTINGS.maxFileBytes,
      max_job_bytes: SETTINGS.maxJobBytes,
      max_files: UPLOAD_MAX_FILES,
    });
    // Only the hash is stored; the token travels once, in the offer.
    const [organizationId, jobId, hash, mintedAt, expiresAt] = repository.mint.mock.calls[0];
    expect([organizationId, jobId, mintedAt]).toEqual([ORG, JOB, NOW]);
    expect(hash).toBe(hashUploadToken(upload?.token ?? ""));
    expect(expiresAt.toISOString()).toBe(upload?.expires_at);
  });

  it("gives a job attributed to no run nothing — there is no attempt to fill", async () => {
    expect(await service.forOffer(buildJob({ run_id: null }), NOW, 1000)).toBeUndefined();
    expect(repository.mint).not.toHaveBeenCalled();
  });

  it("gives nothing for a job whose upload has already closed", async () => {
    repository.mint.mockResolvedValue(false);

    expect(await service.forOffer(buildJob({ run_id: RUN }), NOW, 1000)).toBeUndefined();
  });
});

describe("accepting an upload", () => {
  it("stores every file, parses the results, registers each with its kind and closes the upload", async () => {
    const files = mockupFiles();

    const receipt = await send(uploadBody(files));

    expect(receipt).toMatchObject({
      job: JOB,
      testRun: TEST_RUN,
      warnings: [],
      results: { total: 5, passed: 3, failed: 1, flaky: 1, skipped: 0, parseWarnings: 0 },
    });
    expect(receipt.files.map((file) => [file.name, file.status, file.kind])).toEqual([
      ["junit-build3.xml", "stored", "junit"],
      ["coverage/lcov.info", "stored", "coverage"],
      ["rig-capture-estop.csv", "stored", "capture"],
      ["serial-console.log", "stored", "log"],
    ]);

    // Only the result files are read back and parsed; the capture and the log are not results.
    const [parsed] = parse.mock.calls[0] as [{ files: { name: string; bytes: Buffer }[] }];
    expect(parsed.files.map((file) => file.name)).toEqual([
      "junit-build3.xml",
      "coverage/lcov.info",
    ]);
    expect(parsed.files[0].bytes.equals(files[0].bytes)).toBe(true);
    expect(repository.attempt).toHaveBeenCalledWith(ORG, JOB, RUN, ledger.commitSha);

    const [close] = closes;
    expect(close.tokenHash).toBe(ledger.tokenHash);
    expect(close.storedBytes).toBe(files.reduce((sum, file) => sum + file.bytes.length, 0));
    expect(close.artifacts[1]).toMatchObject({
      kind: "coverage",
      coverage: { linesCovered: 4475, linesTotal: 5120 },
      checksum: checksumOf(files[1].bytes),
      retainedUntil: new Date(NOW.getTime() + 30 * 86_400_000),
      storageRef: {
        driver: "local",
        key: expect.stringMatching(
          new RegExp(`^${ORG}/${JOB}/[0-9a-f-]{36}/coverage/lcov\\.info$`),
        ) as string,
      },
    });
    expect(await storedObjects()).toHaveLength(4);
  });

  it("does not parse an upload that carries no result file", async () => {
    const receipt = await send(
      uploadBody([{ name: "serial-console.log", bytes: Buffer.from("boot\n") }]),
    );

    expect(parse).not.toHaveBeenCalled();
    expect(receipt.results).toBeNull();
    expect(receipt.files).toEqual([
      expect.objectContaining({ name: "serial-console.log", status: "stored", kind: "log" }),
    ]);
  });

  it("stores a truncated file and says so — a warning and a truncation note, never a silent drop", async () => {
    const note = "cut at 64 MiB of 94 MiB (per-file cap)";
    const receipt = await send(
      uploadBody([
        {
          name: "rig-capture-estop.csv",
          bytes: Buffer.from("t,v\n0,1\n"),
          truncated: { original_bytes: 98_566_144, note },
        },
      ]),
    );

    expect(receipt.files[0]).toMatchObject({ status: "truncated", note });
    expect(receipt.warnings).toEqual([
      {
        code: "artifact_truncated",
        file: "rig-capture-estop.csv",
        message: expect.stringContaining(note) as string,
      },
    ]);
    expect(closes[0].artifacts[0].truncationNote).toBe(note);
  });

  it("lists what the agent left behind, with its reason", async () => {
    const receipt = await send(
      uploadBody(
        [{ name: "junit-build3.xml", bytes: mockupFiles()[0].bytes }],
        [
          {
            name: "logs/serial-console.log",
            size_bytes: 9_000_000,
            reason: "job_cap",
            detail: "the job's upload cap was reached",
          },
        ],
      ),
    );

    expect(receipt.files[1]).toEqual({
      name: "logs/serial-console.log",
      status: "skipped",
      size_bytes: 9_000_000,
      reason: "job_cap",
      note: "the job's upload cap was reached",
    });
    expect(receipt.warnings.map((warning) => warning.code)).toEqual(["artifact_skipped"]);
  });

  it("keeps what fits the workspace's quota and warns about the rest — never failing the job", async () => {
    const files = mockupFiles();
    usage = settings.quotaBytes - files[0].bytes.length - files[1].bytes.length;

    const receipt = await send(uploadBody(files));

    expect(receipt.files.map((file) => [file.name, file.status, file.reason])).toEqual([
      ["junit-build3.xml", "stored", undefined],
      ["coverage/lcov.info", "stored", undefined],
      ["rig-capture-estop.csv", "skipped", "quota"],
      ["serial-console.log", "skipped", "quota"],
    ]);
    expect(receipt.warnings.map((warning) => [warning.code, warning.file])).toEqual([
      ["artifact_quota_exceeded", "rig-capture-estop.csv"],
      ["artifact_quota_exceeded", "serial-console.log"],
    ]);
    expect(closes[0].artifacts.map((row) => row.name)).toEqual([
      "junit-build3.xml",
      "coverage/lcov.info",
    ]);
    expect(await storedObjects()).toHaveLength(2);
  });

  it("keeps nothing from an upload whose file does not match its checksum, with a typed refusal", async () => {
    const files = mockupFiles();
    const manifest = manifestOf(files);
    manifest.files[2].checksum = checksumOf(Buffer.from("something else"));

    const error = await refusal(send(uploadBody(files, [], manifest)));

    expect(error.code).toBe(ARTIFACT_ERRORS.checksumMismatch);
    expect(error.getStatus()).toBe(422);
    expect(error.envelope().details).toMatchObject({ file: "rig-capture-estop.csv" });
    expect(closes).toHaveLength(0);
    expect(await storedObjects()).toEqual([]);
  });

  it.each([
    ["longer", 1],
    ["shorter", -1],
  ])("refuses a file %s than its declared size, and keeps nothing", async (_what, delta) => {
    const files = mockupFiles();
    const manifest = manifestOf(files);
    manifest.files[3].size_bytes += delta;

    const error = await refusal(send(uploadBody(files, [], manifest)));

    expect(error.code).toBe(ARTIFACT_ERRORS.manifestInvalid);
    expect(error.envelope().details).toEqual({ file: "serial-console.log" });
    expect(await storedObjects()).toEqual([]);
  });

  it.each<[string, () => MultipartBody, RegExp]>([
    [
      "not multipart",
      () => ({ contentType: "application/json", body: Buffer.from("{}") }),
      /multipart/,
    ],
    [
      "no boundary",
      () => ({ contentType: "multipart/form-data", body: Buffer.from("x") }),
      /boundary/,
    ],
    ["no manifest", () => multipart([]), /manifest is missing/],
    [
      "a file before the manifest",
      () => multipart([{ field: "file", filename: "a.log", bytes: Buffer.from("a") }]),
      /after the manifest/,
    ],
    [
      "a first field that is not the manifest",
      () => multipart([{ field: "note", value: "hi" }]),
      /the only field is one manifest/,
    ],
    [
      "a manifest that is not JSON",
      () => multipart([{ field: "manifest", value: "{" }]),
      /not JSON/,
    ],
    [
      "a second field",
      () =>
        multipart([
          { field: "manifest", value: JSON.stringify(manifestOf([])) },
          { field: "note", value: "hi" },
        ]),
      /more parts than an upload may/,
    ],
    [
      "a file the manifest does not list",
      () => {
        const listed: FixtureFile = { name: "a.log", bytes: Buffer.from("a") };
        return multipart([
          { field: "manifest", value: JSON.stringify(manifestOf([listed])) },
          { field: "file", filename: "a.log", bytes: listed.bytes },
          { field: "file", filename: "b.log", bytes: Buffer.from("b") },
        ]);
      },
      /b\.log is not in the manifest/,
    ],
    [
      "a listed file that never arrives",
      () => uploadBody([], [], manifestOf([{ name: "a.log", bytes: Buffer.from("a") }])),
      /listed but was not sent/,
    ],
    [
      "one file sent twice",
      () => {
        const file: FixtureFile = { name: "a.log", bytes: Buffer.from("a") };
        return multipart([
          { field: "manifest", value: JSON.stringify(manifestOf([file])) },
          { field: "file", filename: "a.log", bytes: file.bytes },
          { field: "file", filename: "a.log", bytes: file.bytes },
        ]);
      },
      /sent twice/,
    ],
  ])("refuses %s as a malformed upload", async (_what, body, message) => {
    const error = await refusal(send(body()));

    expect(error.code).toBe(ARTIFACT_ERRORS.manifestInvalid);
    expect(error.message).toMatch(message);
    expect(await storedObjects()).toEqual([]);
  });

  it("refuses a file past the per-file cap, and an upload past the per-job cap, as too large", async () => {
    settings = { ...settings, maxFileBytes: 100, maxJobBytes: 150 };

    const file = await refusal(send(uploadBody([{ name: "big.bin", bytes: Buffer.alloc(101) }])));
    const job = await refusal(
      send(
        uploadBody([
          { name: "a.bin", bytes: Buffer.alloc(100) },
          { name: "b.bin", bytes: Buffer.alloc(100) },
        ]),
      ),
    );

    expect([file.code, file.getStatus(), file.envelope().details]).toEqual([
      ARTIFACT_ERRORS.tooLarge,
      413,
      { file: "big.bin", capBytes: 100 },
    ]);
    expect([job.code, job.getStatus()]).toEqual([ARTIFACT_ERRORS.tooLarge, 413]);
    expect(await storedObjects()).toEqual([]);
  });

  it("answers a request that lost the race to close with the replay refusal, and keeps nothing", async () => {
    closeAnswer = "raced";

    const error = await refusal(send(uploadBody(mockupFiles())));

    expect(error.code).toBe(ARTIFACT_ERRORS.uploadClosed);
    expect(await storedObjects()).toEqual([]);
  });

  it("removes what it wrote when the store fails, and reports the store's failure", async () => {
    const failing: ArtifactStore = {
      driver: "local",
      put: (key, body, size) =>
        key.endsWith("serial-console.log")
          ? Promise.reject(new ArtifactStoreError("the disk is full"))
          : store.put(key, body, size),
      get: (key) => store.get(key),
      delete: (key) => store.delete(key),
    };
    service = new ArtifactUploadService(
      repository as unknown as UploadRepository,
      failing,
      new TestResultParserRegistry([new JunitParser()]),
      { parseAttempt: parse } as unknown as TestResultIngestService,
      {
        get artifacts() {
          return settings;
        },
      } as unknown as AppConfigService,
      () => NOW,
    );

    await expect(send(uploadBody(mockupFiles()))).rejects.toThrow("the disk is full");
    expect(await storedObjects()).toEqual([]);
  });
});

describe("the token", () => {
  it.each<[string, () => void, unknown]>([
    ["no ledger for the job", () => repository.ledger.mockResolvedValue(undefined), undefined],
    ["another job's token", () => undefined, `Bearer ${mintUploadToken().token}`],
    ["no Authorization header", () => undefined, null],
    ["a malformed header", () => undefined, `Basic ${token}`],
    [
      "an expired token",
      () => {
        ledger = { ...ledger, expiresAt: NOW };
      },
      "default",
    ],
  ])("refuses %s with the one opaque refusal", async (_what, arrange, authorization) => {
    arrange();

    const error = await refusal(
      authorization === "default" ? send(uploadBody([])) : send(uploadBody([]), authorization),
    );

    expect([error.getStatus(), error.code, error.envelope().details]).toEqual([
      401,
      ARTIFACT_ERRORS.uploadRefused,
      {},
    ]);
    expect(repository.usage).not.toHaveBeenCalled();
  });

  it("is single use: the right token for a closed upload is refused as a replay, writing nothing", async () => {
    ledger = { ...ledger, closedAt: NOW };

    const error = await refusal(send(uploadBody(mockupFiles())));

    expect([error.getStatus(), error.code]).toEqual([409, ARTIFACT_ERRORS.uploadClosed]);
    expect(await storedObjects()).toEqual([]);
  });

  it("refuses a job that has lost its run", async () => {
    ledger = { ...ledger, runId: null };

    const error = await refusal(send(uploadBody([])));

    expect([error.getStatus(), error.code]).toEqual([409, ARTIFACT_ERRORS.jobUnattributed]);
  });
});

describe("the receipt", () => {
  it("lists sent files in manifest order, then the agent's skips", () => {
    const files: FixtureFile[] = [
      { name: "a.xml", bytes: Buffer.from("a") },
      { name: "b.csv", bytes: Buffer.from("b") },
    ];
    const receipt = receiptOf(
      parseManifest(
        JSON.stringify(
          manifestOf(files, [
            { name: "c.log", size_bytes: 3, reason: "unreadable", detail: "permission denied" },
          ]),
        ),
      ),
      new Map([
        ["a.xml", "store"],
        ["b.csv", "quota"],
      ]),
      new Map([["a.xml", "junit"]]),
      new Map([["a.xml", "id-a"]]),
    );

    expect(receipt.manifest.map((entry) => [entry.name, entry.status, entry.artifact_id])).toEqual([
      ["a.xml", "stored", "id-a"],
      ["b.csv", "skipped", undefined],
      ["c.log", "skipped", undefined],
    ]);
    expect(receipt.warnings.map((warning) => warning.code)).toEqual([
      "artifact_quota_exceeded",
      "artifact_skipped",
    ]);
  });
});
