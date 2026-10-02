/**
 * A throwaway mailpit for the integration suites (#440) — the SMTP catcher `docker-compose.yml`
 * runs in development, so a suite proves the same path a developer watches in a browser.
 *
 * mailpit accepts every message on its SMTP port and serves what it caught over HTTP; nothing
 * leaves the container. Pinned to a minor release, like `MINIO_IMAGE`, and the same tag the
 * compose file names.
 */

import { GenericContainer, Wait } from "testcontainers";

import { startWithRetry } from "../../testing/container.fixture";

/** The pinned mailpit image. */
export const MAILPIT_IMAGE = "axllent/mailpit:v1.31";

/** The port mailpit accepts SMTP on inside the container. */
const SMTP_PORT = 1025;

/** The port mailpit serves its UI and API on inside the container. */
const HTTP_PORT = 8025;

/** One caught message, as far as a suite reads it. */
export interface CaughtMail {
  /** The recipients' addresses. */
  readonly to: string[];
  /** The sender's address. */
  readonly from: string;
  /** The sender's display name. */
  readonly fromName: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  /** The `Message-ID`, without angle brackets — as mailpit reports it. */
  readonly messageId: string;
  /** Every header, each with all its values. */
  readonly headers: Readonly<Record<string, string[]>>;
}

/** A running mailpit. */
export interface StartedMailpit {
  /** `smtp://<host>:<mapped port>` — a value for `OURO_SMTP_URL`. */
  readonly smtpUrl: string;
  /** `http://<host>:<mapped port>` — the UI and API. */
  readonly httpUrl: string;
  /** Everything caught so far, oldest first. */
  messages(): Promise<CaughtMail[]>;
  /** Forget everything caught. */
  clear(): Promise<void>;
  /** Stop and remove the container. */
  stop(): Promise<void>;
}

/** mailpit's message summary, as far as it is read. */
interface Summary {
  readonly ID: string;
}

/** mailpit's message detail, as far as it is read. */
interface Detail {
  readonly MessageID: string;
  readonly From: { readonly Name: string; readonly Address: string };
  readonly To: readonly { readonly Address: string }[];
  readonly Subject: string;
  readonly Text: string;
  readonly HTML: string;
}

/**
 * Start mailpit.
 *
 * @returns It, ready to accept mail.
 */
export async function startMailpit(): Promise<StartedMailpit> {
  const container = await startWithRetry(() =>
    new GenericContainer(MAILPIT_IMAGE)
      .withExposedPorts(SMTP_PORT, HTTP_PORT)
      .withWaitStrategy(Wait.forHttp("/readyz", HTTP_PORT))
      .start(),
  );

  const host = container.getHost();
  const httpUrl = `http://${host}:${String(container.getMappedPort(HTTP_PORT))}`;

  /**
   * One API call.
   *
   * @param path - The path under the API root.
   * @param init - The request.
   * @returns The response, when it was a success.
   * @throws {Error} Otherwise.
   */
  const api = async (path: string, init?: RequestInit): Promise<Response> => {
    const response = await fetch(`${httpUrl}/api/v1${path}`, init);

    if (!response.ok) {
      throw new Error(`mailpit answered ${String(response.status)} for ${path}`);
    }

    return response;
  };

  return {
    smtpUrl: `smtp://${host}:${String(container.getMappedPort(SMTP_PORT))}`,
    httpUrl,
    messages: async () => {
      const list = (await (await api("/messages?limit=200")).json()) as { messages: Summary[] };
      const caught: CaughtMail[] = [];

      // mailpit lists newest first.
      for (const { ID } of [...list.messages].reverse()) {
        const detail = (await (await api(`/message/${ID}`)).json()) as Detail;
        const headers = (await (await api(`/message/${ID}/headers`)).json()) as Record<
          string,
          string[]
        >;

        caught.push({
          to: detail.To.map((recipient) => recipient.Address),
          from: detail.From.Address,
          fromName: detail.From.Name,
          subject: detail.Subject,
          text: detail.Text,
          html: detail.HTML,
          messageId: detail.MessageID,
          headers,
        });
      }

      return caught;
    },
    clear: async () => {
      await api("/messages", { method: "DELETE" });
    },
    stop: async () => {
      await container.stop();
    },
  };
}
