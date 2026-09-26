import {
  EMPTY_PAYLOAD_SHA256,
  encodePath,
  sha256Hex,
  signRequest,
  UNSIGNED_PAYLOAD,
} from "./sigv4";

/**
 * SigV4 as the S3 driver signs it (#330), held to AWS's own published example — the `GET /test.txt`
 * with a `Range` header in the S3 API reference's header-based authentication page, whose signature
 * is printed there.
 */

const AWS_EXAMPLE_CREDENTIALS = {
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  region: "us-east-1",
};

describe("signRequest", () => {
  it("reproduces AWS's published GET Object example exactly", () => {
    const headers = signRequest(
      {
        method: "GET",
        host: "examplebucket.s3.amazonaws.com",
        path: "/test.txt",
        headers: { range: "bytes=0-9" },
        payloadHash: EMPTY_PAYLOAD_SHA256,
      },
      AWS_EXAMPLE_CREDENTIALS,
      new Date("2013-05-24T00:00:00.000Z"),
    );

    expect(headers.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, " +
        "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, " +
        "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
    expect(headers["x-amz-date"]).toBe("20130524T000000Z");
    expect(headers["x-amz-content-sha256"]).toBe(EMPTY_PAYLOAD_SHA256);
    expect(headers.host).toBe("examplebucket.s3.amazonaws.com");
  });

  it("signs a streamed upload with the unsigned payload marker", () => {
    const headers = signRequest(
      { method: "PUT", host: "minio:9000", path: "/bucket/a.xml", payloadHash: UNSIGNED_PAYLOAD },
      AWS_EXAMPLE_CREDENTIALS,
      new Date("2026-09-25T12:00:00.000Z"),
    );

    expect(headers["x-amz-content-sha256"]).toBe("UNSIGNED-PAYLOAD");
    expect(headers.authorization).toMatch(
      /Credential=AKIAIOSFODNN7EXAMPLE\/20260925\/us-east-1\/s3\//,
    );
  });

  it("never puts the secret in what it returns", () => {
    const headers = signRequest(
      { method: "GET", host: "h", path: "/b/k", payloadHash: EMPTY_PAYLOAD_SHA256 },
      AWS_EXAMPLE_CREDENTIALS,
      new Date(),
    );

    expect(JSON.stringify(headers)).not.toContain(AWS_EXAMPLE_CREDENTIALS.secretAccessKey);
  });

  it("changes the signature when the path changes", () => {
    const sign = (path: string) =>
      signRequest(
        { method: "GET", host: "h", path, payloadHash: EMPTY_PAYLOAD_SHA256 },
        AWS_EXAMPLE_CREDENTIALS,
        new Date("2026-01-01T00:00:00.000Z"),
      ).authorization;

    expect(sign("/b/one")).not.toBe(sign("/b/two"));
  });
});

describe("encodePath", () => {
  it("keeps slashes and unreserved characters, and percent-encodes everything else", () => {
    expect(encodePath("/bucket/org/job/build/serial console · ü (1).log")).toBe(
      "/bucket/org/job/build/serial%20console%20%C2%B7%20%C3%BC%20%281%29.log",
    );
  });

  it("encodes the characters encodeURIComponent leaves alone", () => {
    expect(encodePath("/b/it's*!")).toBe("/b/it%27s%2A%21");
  });
});

describe("sha256Hex", () => {
  it("is the empty payload's hash for nothing", () => {
    expect(sha256Hex("")).toBe(EMPTY_PAYLOAD_SHA256);
  });
});
