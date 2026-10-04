import {
  confirmPage,
  failedPage,
  problemPage,
  receiptPage,
  signInPage,
  type AnswerAction,
  type AnswerCard,
  type TokenProblem,
} from "./answer.pages";

const CARD: AnswerCard = {
  workspace: "Acme Robotics",
  severity: "warn",
  question: "Allow a one-time edit to a protected path?",
  why: "The OTA rollback fix wants to add one line to boot/rollback_flag.c.",
  refs: [{ type: "path", id: "boot/rollback_flag.c", label: "boot/rollback_flag.c" }],
};

const ALLOW: AnswerAction = {
  label: "Allow once",
  consequence: "Grants a single-use exception.",
  takesNote: false,
  style: "primary",
};

describe("the answer pages (#463)", () => {
  it("renders the whole card and one POST button on the confirm page", () => {
    const page = confirmPage({ card: CARD, action: ALLOW, formAction: "/api/v1/inbox/answer/t" });

    expect(page.status).toBe(200);
    expect(page.html).toContain("Allow a one-time edit to a protected path?");
    expect(page.html).toContain("boot/rollback_flag.c");
    expect(page.html).toContain("Grants a single-use exception.");
    expect(page.html).toContain('<form method="post" action="/api/v1/inbox/answer/t">');
    expect(page.html.match(/<button/g)).toHaveLength(1);
    expect(page.html).toContain("Opening this page changed nothing");
    expect(page.html).not.toContain("<textarea");
    expect(page.html).not.toContain("<script");
  });

  it("asks for a note when the action takes one, and re-renders a refusal as 422", () => {
    const page = confirmPage({
      card: CARD,
      action: { ...ALLOW, label: "Deny", takesNote: true, style: "danger" },
      formAction: "/x",
      noteError: "This answer needs a note.",
    });

    expect(page.status).toBe(422);
    expect(page.html).toContain('<textarea class="answer__note" id="note" name="note"');
    expect(page.html).toContain("This answer needs a note.");
    expect(page.html).toContain("answer__button--danger");
  });

  it("asks a merge-class link to sign in, and refuses a POST without one", () => {
    const get = signInPage({
      card: CARD,
      action: ALLOW,
      signInUrl: "/login?next=x",
      refused: false,
    });
    const post = signInPage({
      card: CARD,
      action: ALLOW,
      signInUrl: "/login?next=x",
      refused: true,
    });

    expect(get.status).toBe(200);
    expect(get.html).toContain('href="/login?next=x"');
    expect(get.html).not.toContain("<form");
    expect(post.status).toBe(401);
    expect(post.html).toContain("Nothing was done");
  });

  it("shows a receipt", () => {
    const page = receiptPage({
      card: CARD,
      actionLabel: "Allow once",
      receipt: "allowed once by Ken · by email",
      inboxUrl: "https://ouro.example/inbox",
    });

    expect(page.status).toBe(200);
    expect(page.html).toContain("✓ Allow once");
    expect(page.html).toContain("allowed once by Ken · by email");
  });

  it("renders expired, used and revoked as three distinguishable designed pages", () => {
    const pages = (["expired", "used", "answered"] as TokenProblem[]).map((problem) =>
      problemPage(problem, "https://ouro.example/inbox", CARD),
    );
    const headings = pages.map((page) => /data-problem="([a-z_]+)">([^<]+)</.exec(page.html)?.[2]);

    expect(pages.map((page) => page.status)).toEqual([410, 410, 410]);
    expect(new Set(headings).size).toBe(3);
    expect(headings).toEqual([
      "This link has expired",
      "This link was already used",
      "This decision was already answered",
    ]);
  });

  it.each([
    ["unknown", 404],
    ["wrong_user", 403],
    ["not_member", 403],
    ["superseded", 410],
    ["withdrawn", 410],
  ] as const)("answers %s with %d", (problem, status) => {
    expect(problemPage(problem, "https://ouro.example/inbox").status).toBe(status);
  });

  it("never shows the card on an unknown link", () => {
    expect(problemPage("unknown", "https://ouro.example/inbox").html).not.toContain(CARD.question);
  });

  it("says a failed action left the decision open", () => {
    const page = failedPage({
      card: CARD,
      message: "The merge plan is not armable.",
      status: 409,
      inboxUrl: "https://ouro.example/inbox?item=1",
    });

    expect(page.status).toBe(409);
    expect(page.html).toContain("still open");
  });

  it("escapes every value", () => {
    const page = confirmPage({
      card: { ...CARD, question: '<img src=x onerror="1">', workspace: "<W>" },
      action: { ...ALLOW, label: "<b>go</b>" },
      formAction: '/x" onmouseover="y',
    });

    expect(page.html).not.toContain("<img");
    expect(page.html).not.toContain("<b>go</b>");
    expect(page.html).toContain('action="/x&quot; onmouseover=&quot;y"');
  });
});
