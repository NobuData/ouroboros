import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import type { BuildJob, BuildJobSubmission } from "@/app/api/farm";
import {
  COMMAND_REQUIRED,
  FIELDS_REFUSED,
  POOL_GONE,
  REPOSITORY_NOT_MIRRORED,
  SUBMIT_FAILED,
  SUBMIT_FORBIDDEN,
  SUBMIT_POOL_DISABLED,
} from "@/app/farm/submit";

const api = vi.hoisted(() => ({ submitJob: vi.fn() }));

vi.mock("@/app/api/farm", () => ({
  farm: { submitJob: (submission: BuildJobSubmission) => api.submitJob(submission) },
}));

const actions = await import("@/app/farm/submit-actions");

/**
 * The submit dialog's Server Action (#260): the submission is handed to the service exactly as
 * given, a refusal is a value with its sentence under the field it is about, and anything that
 * is not an `ApiError` travels.
 */

/** What the dialog sends for `pool-a`'s default command: no command at all. */
const SUBMISSION: BuildJobSubmission = {
  pool: "pool-a",
  repository: "acme-robotics/helios-firmware",
  ref: "refs/heads/main",
  commit: "9e7bd4034c1f1b2a6d8e0f5c7a9b3d1e2f4a6c80",
};

/** The job the service answers a submission with. */
const JOB: BuildJob = {
  id: "5eed0028-0000-4000-8000-000000000483",
  number: 483,
  status: "queued",
  pool: "pool-a",
  repository: "acme-robotics/helios-firmware",
  ref: "refs/heads/main",
  commit: SUBMISSION.commit,
  command: ["sh", "-c", "curl -H 'Authorization: Bearer hunter2' https://example.test"],
  commandLine: "sh -c 'curl -H '\\''Authorization: Bearer hunter2'\\'' https://example.test'",
  executor: "container",
  image: "ghcr.io/acme-robotics/zephyr-sdk:0.17",
  label: "pool-a",
  title: "acme-robotics/helios-firmware @ refs/heads/main",
  runnerId: null,
  runId: null,
  retryOf: null,
  queuedAt: "2026-09-19T14:02:00.000Z",
  offeredAt: null,
  startedAt: null,
  finishedAt: null,
  exitCode: null,
};

/**
 * A refusal, as the typed client throws one.
 *
 * @param status The HTTP status.
 * @param code The service's code.
 * @param details What the envelope carried.
 * @returns The error.
 */
function refusal(status: number, code: string, details: Record<string, unknown> = {}): ApiError {
  return new ApiError(status, code, `${code} message`, details);
}

beforeEach(() => {
  api.submitJob.mockReset();
});

describe("submitBuild", () => {
  it("submits exactly what it was given, and answers what the toast says", async () => {
    api.submitJob.mockResolvedValue(JOB);

    await expect(actions.submitBuild(SUBMISSION)).resolves.toEqual({
      ok: true,
      job: { id: JOB.id, number: 483, pool: "pool-a" },
    });
    expect(api.submitJob).toHaveBeenCalledExactlyOnceWith(SUBMISSION);
  });

  it("answers three fields of the job and not the job — the command above all stays behind", async () => {
    // A Server Action's answer travels to the browser. Nothing on the page draws the command,
    // and a command is where a pasted token would be.
    api.submitJob.mockResolvedValue(JOB);

    expect(JSON.stringify(await actions.submitBuild(SUBMISSION))).not.toContain("hunter2");
  });

  it.each([
    [refusal(404, "farm_pool_not_found"), { reason: FIELDS_REFUSED, fields: { pool: POOL_GONE } }],
    [
      refusal(409, "farm_pool_disabled"),
      { reason: FIELDS_REFUSED, fields: { pool: SUBMIT_POOL_DISABLED } },
    ],
    [
      refusal(404, "farm_repository_not_found"),
      { reason: FIELDS_REFUSED, fields: { repository: REPOSITORY_NOT_MIRRORED } },
    ],
    [
      refusal(422, "farm_command_required"),
      { reason: FIELDS_REFUSED, fields: { command: COMMAND_REQUIRED } },
    ],
    [
      refusal(422, "validation_failed", { commit: ["commit must be 40 lower-case hex characters"] }),
      {
        reason: FIELDS_REFUSED,
        fields: { commit: "commit must be 40 lower-case hex characters" },
      },
    ],
    [refusal(403, "forbidden"), { reason: SUBMIT_FORBIDDEN, fields: {} }],
    [refusal(500, "internal_error"), { reason: SUBMIT_FAILED, fields: {} }],
  ])("answers %s as a value, under its field", async (error, expected) => {
    api.submitJob.mockRejectedValue(error);

    await expect(actions.submitBuild(SUBMISSION)).resolves.toEqual({ ok: false, ...expected });
  });

  it("lets anything that is not a refusal travel — Next.js's redirect above all", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    api.submitJob.mockRejectedValue(redirect);

    await expect(actions.submitBuild(SUBMISSION)).rejects.toBe(redirect);
  });
});
