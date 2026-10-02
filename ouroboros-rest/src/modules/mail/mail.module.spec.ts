import { Test } from "@nestjs/testing";

import { ConfigurationModule } from "../config/config.module";
import { testConfiguration } from "../config/configuration.fixture";
import { MailModule, mailerFor } from "./mail.module";
import { MAILER, MailUnavailableError, type Mailer } from "./mailer";
import { SmtpMailer } from "./smtp.mailer";
import { UnconfiguredMailer } from "./unconfigured.mailer";

/** The wiring (BJ.4, #440). Nothing connects: nodemailer opens a socket on the first send. */

describe("the mail module", () => {
  it("provides a mailer that sends nothing when no mail server is configured", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), MailModule],
    }).compile();
    const mailer = moduleRef.get<Mailer>(MAILER);

    expect(mailer).toBeInstanceOf(UnconfiguredMailer);
    expect(mailer.transport).toBe("none");
    await expect(
      mailer.send({ to: "ken@acme.dev", subject: "s", text: "t", html: "<p>t</p>" }),
    ).rejects.toBeInstanceOf(MailUnavailableError);

    await moduleRef.close();
  });

  it("provides SMTP when a server is configured, and closes it on shutdown", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigurationModule.forRoot(
          testConfiguration({
            OURO_SMTP_URL: "smtp://localhost:1025",
            OURO_MAIL_FROM: "no-reply@acme.dev",
          }),
        ),
        MailModule,
      ],
    }).compile();
    const mailer = moduleRef.get<Mailer>(MAILER);
    const close = jest.spyOn(mailer as SmtpMailer, "close");

    expect(mailer).toBeInstanceOf(SmtpMailer);
    expect(mailer.transport).toBe("smtp");

    await moduleRef.init();
    await moduleRef.close();

    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe("mailerFor", () => {
  it.each([
    [{ smtpUrl: undefined, mailFrom: undefined }],
    [{ smtpUrl: "smtp://localhost:1025", mailFrom: undefined }],
    [{ smtpUrl: undefined, mailFrom: "no-reply@acme.dev" }],
  ])("refuses to send on half a configuration: %j", (config) => {
    expect(mailerFor(config).transport).toBe("none");
  });
});
