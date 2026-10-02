import { createTransport } from "nodemailer";

import {
  SMTP_CONNECTION_TIMEOUT_MS,
  SMTP_GREETING_TIMEOUT_MS,
  SMTP_SOCKET_TIMEOUT_MS,
  SmtpMailer,
  type SmtpTransport,
} from "./smtp.mailer";

jest.mock("nodemailer", () => ({
  createTransport: jest.fn(() => ({ sendMail: jest.fn(), close: jest.fn() })),
}));

/**
 * A transport that records what it was asked to send.
 *
 * @param outcome - What `sendMail` answers.
 * @returns The transport and its two spies.
 */
function transport(outcome: Promise<{ messageId: string }>) {
  const sendMail = jest.fn((_mail: object) => outcome);
  const close = jest.fn();

  return { smtp: { sendMail, close } as unknown as SmtpTransport, sendMail, close };
}

describe("SmtpMailer", () => {
  it("opens nodemailer on the configured URL with every timeout set", () => {
    new SmtpMailer("smtps://digest:swordfish@smtp.acme.dev:465", "no-reply@acme.dev");

    expect(createTransport).toHaveBeenCalledWith({
      url: "smtps://digest:swordfish@smtp.acme.dev:465",
      connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
      greetingTimeout: SMTP_GREETING_TIMEOUT_MS,
      socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
    });
  });

  it("sends both parts from the configured address, under the product's name", async () => {
    const { smtp, sendMail } = transport(Promise.resolve({ messageId: "<generated@acme.dev>" }));
    const mailer = new SmtpMailer("smtp://localhost:1025", "no-reply@acme.dev", smtp);

    const receipt = await mailer.send({
      to: "ken@acme.dev",
      subject: "Weekly insights",
      text: "27 merged",
      html: "<p>27 merged</p>",
    });

    expect(mailer.transport).toBe("smtp");
    expect(receipt).toEqual({ messageId: "<generated@acme.dev>" });
    expect(sendMail).toHaveBeenCalledWith({
      from: { name: "Ouroboros", address: "no-reply@acme.dev" },
      to: "ken@acme.dev",
      subject: "Weekly insights",
      text: "27 merged",
      html: "<p>27 merged</p>",
    });
  });

  it("carries a caller's Message-ID and headers through", async () => {
    const { smtp, sendMail } = transport(Promise.resolve({ messageId: "<run.user@acme.dev>" }));
    const mailer = new SmtpMailer("smtp://localhost:1025", "no-reply@acme.dev", smtp);

    await mailer.send({
      to: "ken@acme.dev",
      subject: "s",
      text: "t",
      html: "<p>t</p>",
      messageId: "<run.user@acme.dev>",
      headers: { "List-Unsubscribe": "<https://acme.dev/u>" },
    });

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: "<run.user@acme.dev>",
        headers: { "List-Unsubscribe": "<https://acme.dev/u>" },
      }),
    );
  });

  it("lets the server's refusal reach the caller", async () => {
    const { smtp } = transport(Promise.reject(new Error("connect ECONNREFUSED 127.0.0.1:1025")));
    const mailer = new SmtpMailer("smtp://localhost:1025", "no-reply@acme.dev", smtp);

    await expect(
      mailer.send({ to: "ken@acme.dev", subject: "s", text: "t", html: "<p>t</p>" }),
    ).rejects.toThrow("ECONNREFUSED");
  });

  it("closes its transport", () => {
    const { smtp, close } = transport(Promise.resolve({ messageId: "<x@acme.dev>" }));

    new SmtpMailer("smtp://localhost:1025", "no-reply@acme.dev", smtp).close();

    expect(close).toHaveBeenCalledTimes(1);
  });
});
