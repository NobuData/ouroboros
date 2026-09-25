/**
 * AWS Signature Version 4, for the S3 artifact driver (#330).
 *
 * Written here rather than taken from the AWS SDK because the driver needs four calls — put, get,
 * delete and a bucket check — and the SDK is a large dependency tree for a deployment whose
 * default never uses it. What this signs is exactly the header-based scheme S3 and MinIO both
 * accept ([the AWS reference](https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html)),
 * and `sigv4.spec.ts` holds it to AWS's own published example.
 */

import { createHash, createHmac } from "node:crypto";

/** The algorithm name every signed request carries. */
const ALGORITHM = "AWS4-HMAC-SHA256";

/** The service signed for. */
const SERVICE = "s3";

/** `x-amz-content-sha256` for a body whose hash is not computed up front. */
export const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";

/** The SHA-256 of nothing — the payload hash of a request with no body. */
export const EMPTY_PAYLOAD_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/** Who signs, and for where. */
export interface SigningCredentials {
  readonly accessKeyId: string;
  /** A secret. Used only as HMAC key material; never returned or logged. */
  readonly secretAccessKey: string;
  readonly region: string;
}

/** What is signed. */
export interface SignableRequest {
  readonly method: string;
  /** `host[:port]`, exactly as the `Host` header will carry it. */
  readonly host: string;
  /** The path, already {@link encodePath}-encoded — the same string the request is sent to. */
  readonly path: string;
  /** Extra headers to sign, lower-case names. `host`, `x-amz-date` and `x-amz-content-sha256` are added. */
  readonly headers?: Readonly<Record<string, string>>;
  /** The body's SHA-256 in hex, or {@link UNSIGNED_PAYLOAD}. */
  readonly payloadHash: string;
}

/**
 * Sign a request.
 *
 * @param request - The request.
 * @param credentials - The key and the region.
 * @param now - The signing time.
 * @returns Every header the request must send: the signed ones, and `authorization`.
 */
export function signRequest(
  request: SignableRequest,
  credentials: SigningCredentials,
  now: Date,
): Record<string, string> {
  const amzDate = now.toISOString().replaceAll(/[:-]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${credentials.region}/${SERVICE}/aws4_request`;

  const headers: Record<string, string> = {
    ...request.headers,
    host: request.host,
    "x-amz-content-sha256": request.payloadHash,
    "x-amz-date": amzDate,
  };
  const names = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort();
  const signedHeaders = names.join(";");
  const canonicalHeaders = names
    .map((name) => `${name}:${headers[name].trim().replaceAll(/\s+/g, " ")}\n`)
    .join("");

  const canonicalRequest = [
    request.method,
    request.path,
    "",
    canonicalHeaders,
    signedHeaders,
    request.payloadHash,
  ].join("\n");

  const stringToSign = [ALGORITHM, amzDate, scope, sha256Hex(canonicalRequest)].join("\n");

  const key = [credentials.region, SERVICE, "aws4_request"].reduce(
    (previous, part) => hmac(previous, part),
    hmac(`AWS4${credentials.secretAccessKey}`, day),
  );
  const signature = createHmac("sha256", key).update(stringToSign).digest("hex");

  return {
    ...headers,
    authorization:
      `${ALGORITHM} Credential=${credentials.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

/**
 * Encode a path the way SigV4 canonicalises it: every byte but the unreserved characters and `/`
 * percent-encoded, upper-case hex.
 *
 * @param path - The raw path, starting with `/`.
 * @returns The encoded path — what is signed and what is sent.
 */
export function encodePath(path: string): string {
  return path
    .split("/")
    .map((segment) =>
      encodeURIComponent(segment).replaceAll(
        /[!'()*]/g,
        (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join("/");
}

/**
 * SHA-256, hex.
 *
 * @param value - The input.
 * @returns The digest.
 */
export function sha256Hex(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * One HMAC-SHA256 step of the signing-key derivation.
 *
 * @param key - The previous step's key.
 * @param value - This step's input.
 * @returns The next key.
 */
function hmac(key: string | Buffer, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}
