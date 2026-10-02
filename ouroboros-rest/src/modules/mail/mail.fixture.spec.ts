import { RecordingMailer } from "./mail.fixture";

describe("RecordingMailer", () => {
  it("keeps what it was handed, per recipient, and answers under the message's own id", async () => {
    const mailer = new RecordingMailer();

    const first = await mailer.send({ to: "ken@acme.dev", subject: "a", text: "a", html: "a" });
    const second = await mailer.send({
      to: "maya@acme.dev",
      subject: "b",
      text: "b",
      html: "b",
      messageId: "<mine@acme.dev>",
    });

    expect(mailer.transport).toBe("smtp");
    expect(first.messageId).toBe("<recorded-1@ouroboros.test>");
    expect(second.messageId).toBe("<mine@acme.dev>");
    expect(mailer.to("maya@acme.dev").map((message) => message.subject)).toEqual(["b"]);
  });

  it("fails an arranged number of sends, then succeeds", async () => {
    const mailer = new RecordingMailer();
    const message = { to: "ken@acme.dev", subject: "a", text: "a", html: "a" };
    mailer.failFor("ken@acme.dev", 2);

    await expect(mailer.send(message)).rejects.toThrow("ECONNREFUSED");
    await expect(mailer.send(message)).rejects.toThrow("ECONNREFUSED");
    await expect(mailer.send(message)).resolves.toBeDefined();
    expect(mailer.sent).toHaveLength(3);
  });

  it("can stand in for a deployment with no mail server", () => {
    expect(new RecordingMailer("none").transport).toBe("none");
  });
});
