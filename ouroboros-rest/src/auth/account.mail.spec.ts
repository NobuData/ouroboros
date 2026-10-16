import { RecordingMailer } from "../modules/mail/mail.fixture";
import { UnconfiguredMailer } from "../modules/mail/unconfigured.mailer";
import { ADMIN_ACCOUNTS_PATH, approvedMail, heldMail, mailEnabled, uiLink } from "./account.mail";

/** Account approval's two emails: content, links, escaping, and whether to send at all. */

const PRIYA = { name: "Priya <Raman>", email: "priya@contractor.dev", githubLogin: "priyaraman" };

describe("whether mail is sent", () => {
  it("is yes for an SMTP mailer", () => {
    expect(mailEnabled(new RecordingMailer())).toBe(true);
  });

  it("is no without OURO_SMTP_URL, or with no mailer at all", () => {
    expect(mailEnabled(new UnconfiguredMailer())).toBe(false);
    expect(mailEnabled(new RecordingMailer("none"))).toBe(false);
    expect(mailEnabled(undefined)).toBe(false);
  });
});

describe("the UI link", () => {
  it("joins with exactly one slash", () => {
    expect(uiLink("http://localhost:3000", ADMIN_ACCOUNTS_PATH)).toBe(
      "http://localhost:3000/admin/accounts",
    );
    expect(uiLink("http://localhost:3000//", "/")).toBe("http://localhost:3000/");
  });
});

describe("the held email", () => {
  const message = heldMail("ken@acme-robotics.dev", PRIYA, "https://ouro.example");

  it("goes to the administrator, naming who waits", () => {
    expect(message.to).toBe("ken@acme-robotics.dev");
    expect(message.subject).toBe("Priya <Raman> is waiting for approval");
    expect(message.text).toContain("Priya <Raman> (@priyaraman, priya@contractor.dev)");
  });

  it("links to the admin page under OURO_UI_URL", () => {
    expect(message.text).toContain("https://ouro.example/admin/accounts");
    expect(message.html).toContain('href="https://ouro.example/admin/accounts"');
  });

  it("escapes what it interpolates into HTML", () => {
    expect(message.html).toContain("Priya &lt;Raman&gt;");
    expect(message.html).not.toContain("<Raman>");
  });

  it("leaves the login out for an account that has none", () => {
    expect(heldMail("k@x.dev", { ...PRIYA, githubLogin: null }, "https://o.x").text).toContain(
      "(priya@contractor.dev)",
    );
  });
});

describe("the approval email", () => {
  const message = approvedMail(PRIYA, "https://ouro.example");

  it("goes to the person approved, with a link back in", () => {
    expect(message.to).toBe("priya@contractor.dev");
    expect(message.subject).toBe("Your Ouroboros account was approved");
    expect(message.text).toContain("https://ouro.example/");
    expect(message.html).toContain("Hello Priya &lt;Raman&gt;");
  });
});
