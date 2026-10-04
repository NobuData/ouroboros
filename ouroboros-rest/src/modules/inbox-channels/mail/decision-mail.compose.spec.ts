import {
  composeDigestMail,
  composeInstantMail,
  digestOrder,
  type MailCard,
} from "./decision-mail.compose";

/** A card with two actions, one merge-class. */
function card(overrides: Partial<MailCard> = {}): MailCard {
  return {
    severity: "err",
    question: "Approve merge for a refactor PR?",
    why: "Policy: anything labeled refactor needs a human.",
    refs: [{ type: "pr", id: "22222222-0000-4000-8000-000000000002", label: "PR #509" }],
    waited: "6m",
    actions: [
      {
        label: "Approve & merge",
        consequence: "Merges once green.",
        url: "https://ouro.example/api/v1/inbox/answer/ouro_act_a",
        primary: true,
        requiresConfirm: true,
      },
      {
        label: "Return to loop with note",
        consequence: "Sends it back.",
        url: "https://ouro.example/api/v1/inbox/answer/ouro_act_b",
        primary: false,
        requiresConfirm: false,
      },
    ],
    inboxUrl: "https://ouro.example/inbox?item=6a1f",
    ...overrides,
  };
}

describe("the decision mails (#463)", () => {
  describe("instant", () => {
    const mail = composeInstantMail("Acme Robotics", card());

    it("leads the subject with the question", () => {
      expect(mail.subject).toBe("[Ouroboros] Needs you: Approve merge for a refactor PR?");
    });

    it("carries every action link in both parts, and the inbox link", () => {
      for (const part of [mail.text, mail.html]) {
        expect(part).toContain("https://ouro.example/api/v1/inbox/answer/ouro_act_a");
        expect(part).toContain("https://ouro.example/api/v1/inbox/answer/ouro_act_b");
        expect(part).toContain("inbox?item=6a1f");
      }
    });

    it("warns beside a merge-class link that it asks for a sign-in", () => {
      expect(mail.text).toContain("Approve & merge (asks you to sign in first)");
      expect(mail.text).not.toContain("Return to loop with note (asks");
      expect(mail.html).toContain("sign in to confirm");
    });

    it("escapes every fact in the HTML part", () => {
      const evil = composeInstantMail(
        "<Acme>",
        card({ question: "<script>alert(1)</script>", why: 'a "quoted" & <b>bold</b>' }),
      );

      expect(evil.html).not.toContain("<script>");
      expect(evil.html).toContain("&lt;script&gt;");
      expect(evil.html).toContain("&lt;Acme&gt;");
      expect(evil.html).toContain("&quot;quoted&quot; &amp; &lt;b&gt;");
    });

    it("cuts a long subject", () => {
      const long = composeInstantMail("W", card({ question: "x".repeat(400) }));

      expect([...long.subject].length).toBe(120);
      expect(long.subject.endsWith("…")).toBe(true);
    });
  });

  describe("digest", () => {
    it("lists the open cards, the resolved summary and the inbox", () => {
      const mail = composeDigestMail({
        workspace: "Acme Robotics",
        day: "2026-10-04",
        open: [card(), card({ severity: "info", question: "Should the loops trust this fact?" })],
        resolved: ["Split #490 into 6 tickets — approved"],
        inboxUrl: "https://ouro.example/inbox",
      });

      expect(mail.subject).toBe("[Ouroboros] 2 decisions waiting · Acme Robotics");
      expect(mail.text).toContain("[Blocking] Approve merge for a refactor PR?");
      expect(mail.text).toContain("[FYI] Should the loops trust this fact?");
      expect(mail.text).toContain("Resolved in the last day (1)");
      expect(mail.text).toContain("✓ Split #490 into 6 tickets — approved");
      expect(mail.html).toContain("Split #490 into 6 tickets — approved");
      expect(mail.html).toContain("Open the inbox");
    });

    it("says so when nothing is waiting", () => {
      const mail = composeDigestMail({
        workspace: "Acme",
        day: "2026-10-04",
        open: [],
        resolved: [],
        inboxUrl: "https://ouro.example/inbox",
      });

      expect(mail.subject).toBe("[Ouroboros] Nothing is waiting on you · Acme");
      expect(mail.text).toContain("(none)");
    });

    it("orders by severity, then age", () => {
      const ordered = digestOrder([
        { id: "info-old", severity: "info" as const, createdAt: new Date(1) },
        { id: "err-new", severity: "err" as const, createdAt: new Date(3) },
        { id: "warn", severity: "warn" as const, createdAt: new Date(2) },
        { id: "err-old", severity: "err" as const, createdAt: new Date(2) },
      ]);

      expect(ordered.map((row) => row.id)).toEqual(["err-old", "err-new", "warn", "info-old"]);
    });
  });
});
