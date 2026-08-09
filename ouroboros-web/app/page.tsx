import Image from "next/image";
import ThemeToggle from "./theme-toggle";

const STAGES = [
  { label: "PULL", x: 50, y: 9.8, cls: "hot" },
  { label: "SIZE", x: 78.4, y: 21.6 },
  { label: "PLAN", x: 90.2, y: 50 },
  { label: "CODE", x: 78.4, y: 78.4 },
  { label: "BUILD", x: 50, y: 90.2 },
  { label: "TEST", x: 21.6, y: 78.4 },
  { label: "VERIFY", x: 9.8, y: 50 },
  { label: "MERGE", x: 21.6, y: 21.6, cls: "good" },
];

type Feature = {
  idx: string; title: string; copy: string; tags: string[];
  href: string; span: string; full?: boolean;
};

const FEATURES: Feature[] = [
  {
    idx: "01",
    title: "Workflow Studio",
    copy: "Stop re-explaining your process in every PR comment. Draw it once — node canvas, typed DSL, or a plain sentence. All three edit the same graph, losslessly.",
    tags: ["visual canvas", "loop DSL", "copilot"],
    href: "#studio",
    span: "wide",
  },
  {
    idx: "02",
    title: "Model Registry · BYOK",
    copy: "Stop grep-replacing model ids at 2 a.m. Every allowed model is a named alias binding your key to a model id. Swap the key behind it — change nothing else.",
    tags: ["anthropic", "copilot", "cursor", "ollama", "vllm"],
    href: "#models",
    span: "",
  },
  {
    idx: "03",
    title: "PR Verification",
    copy: "Stop merging on vibes. Every claim in the ticket maps to a test, a measurement, or a diff hunk — the PR merges because it's proven right, not because it looks right.",
    tags: ["evidence matrix", "7 gates"],
    href: "#verify",
    span: "",
  },
  {
    idx: "04",
    title: "Build Farm & HIL Rigs",
    copy: "Your machines, enrolled with one outbound-only command. The loop proves its work on firmware builds, QEMU, and real benches — power cyclers, dynos, bus floods — while you do literally anything else.",
    tags: ["byo compute", "physical tests"],
    href: "#farm",
    span: "",
  },
  {
    idx: "05",
    title: "Build Analyzer",
    copy: "You stopped reading build logs years ago. It never will. An AI reads every build you've ever run, attributes every shift in the curve, and drafts the fix — with evidence.",
    tags: ["change-points", "predicted vs measured"],
    href: "#analyzer",
    span: "",
  },
  {
    idx: "06",
    title: "Chat Ops",
    copy: "Stop alt-tabbing to check the spinner. Loops report to Slack or Teams; blocked builds ask their question in-channel and resume when you answer. Every control is a /ouro command — or a sentence.",
    tags: ["slack", "teams", "/ouro"],
    href: "#chatops",
    span: "",
  },
  {
    idx: "07",
    title: "Insights",
    copy: "Merge rate, cost per merged PR, cycle time by stage, model win-rates, flakes, DORA — computed from events, not self-reported. Numbers you can quote in the standup you no longer need.",
    tags: ["dora", "spend", "flakes"],
    href: "#more",
    span: "",
  },
  {
    idx: "08",
    title: "Planning & Tickets",
    copy: "Stop spending Friday writing tickets. Describe the outcome; Ouroboros drafts them sized and dependency-wired for GitHub, Jira, or Linear — and keeps the roadmap honest as reality drifts.",
    tags: ["github", "jira", "linear"],
    href: "#more",
    span: "",
  },
  {
    idx: "09",
    title: "Knowledge",
    full: true,
    copy: "Skills you write, playbooks you aim, and facts the loop learns from its own runs — proposed with evidence, confirmed by you, expiring with the code.",
    tags: ["skills", "learned facts"],
    href: "#more",
    span: "",
  },
];

const DIVES = [
  {
    id: "studio",
    eyebrow: "WORKFLOW STUDIO",
    title: "Three editors. One graph. Zero drift.",
    copy: "Workflows decide everything: which issues get pulled, which skills load, which models run each stage, what gates a merge. Edit them the way you think.",
    points: [
      { b: "Visual canvas", t: "— stages, branches, and the gate that loops back on failure. The ouroboros, literally." },
      { b: "Workflow-as-code", t: "— a typed DSL in a Monaco editor, compiled to and from the canvas losslessly." },
      { b: "Copilot", t: "— “create a workflow for security patches that proves the CVE is fixed” → an 8-stage draft, with questions." },
      { b: "Dry runs", t: "— rehearse any workflow on a real issue with zero side effects, and let the AI suggest improvements from what it saw." },
    ],
    shot: "/shots/04-workflow-builder.png",
    alt: "The Ouroboros visual workflow builder",
  },
  {
    id: "models",
    eyebrow: "MODEL REGISTRY · ROUTING · BYOK",
    title: "Route every kind of work to the model that earns it.",
    copy: "Bring your own keys for Anthropic, GitHub Copilot, Cursor — or none at all, with local models over Ollama and vLLM serving tokens at zero cost.",
    points: [
      { b: "Named aliases", t: "— coder-max, sizer, local-docs. Routes and workflows reference names, never raw model strings." },
      { b: "Per-task routing", t: "— planning on your strongest model, commit messages on your cheapest, with ordered fallbacks." },
      { b: "Escalation rules", t: "— big diffs escalate to max thinking; docs-only changes route entirely local." },
      { b: "Spend guards", t: "— per-run and per-provider caps that pause the loop before it gets expensive." },
    ],
    shot: "/shots/21-model-registry.png",
    alt: "The Ouroboros model registry",
    flip: true,
  },
  {
    id: "farm",
    eyebrow: "BUILD FARM · PHYSICAL TESTING",
    title: "It doesn't just compile. It survives the bench.",
    copy: "Enroll your own machines with one command — no inbound ports. Then let the loop prove its work on real hardware: power-loss recovery, bus floods, motor benches.",
    points: [
      { b: "Outbound-only runners", t: "— pools for firmware, macOS, GPU, and HIL jobs on hardware you control." },
      { b: "Hardware-in-the-loop", t: "— measured-vs-expected physics: “overshoot 1.7% ≤ 2.0% limit” beats “tests passed.”" },
      { b: "Failure triage", t: "— classify product bug vs flake vs rig issue; corrections feed straight back into the loop." },
      { b: "Warm caches", t: "— ccache, env snapshots, and history-replayed estimates keep cycles in minutes." },
    ],
    shot: "/shots/11-test-results.png",
    alt: "Ouroboros test results with physical HIL bench measurements",
  },
  {
    id: "verify",
    eyebrow: "PR VERIFICATION",
    title: "Does the PR do what the ticket says? Prove it.",
    copy: "Seven gates stand between generated code and your main branch — and the centerpiece is an evidence matrix mapping every claim in the issue to something concrete.",
    points: [
      { b: "Evidence, not vibes", t: "— each acceptance criterion resolves to a named test, a rig measurement, or a diff hunk." },
      { b: "Second-model review", t: "— an independent model votes on the diff; disagreements block." },
      { b: "Honest waivers", t: "— what the bench can't verify is waived explicitly and annotated on the PR, in public." },
      { b: "Policy-gated auto-merge", t: "— merges itself only when your rules say it may. Dry-run drafts until you flip the switch." },
    ],
    shot: "/shots/12-pr-verification.png",
    alt: "Ouroboros PR verification with the evidence matrix",
    flip: true,
  },
  {
    id: "analyzer",
    eyebrow: "BUILD ANALYZER",
    title: "Your last 1,284 builds have opinions.",
    copy: "You were never going to read 1,284 build logs. It already has. It mines your entire build history, explains every change in the curve, and drafts what to do about it.",
    points: [
      { b: "Change-point attribution", t: "— every duration or reliability shift pinned to the merge, config, or infra event that caused it." },
      { b: "Process suggestions", t: "— split the test gate, re-warm the cache, rebalance the pools — each with evidence and projected savings." },
      { b: "Drafted tickets", t: "— issues generated from patterns, not people, sized and ready for the loop." },
      { b: "Predicted vs measured", t: "— every applied suggestion is re-measured for 14 days; the analyzer retrains on its own misses." },
    ],
    shot: "/shots/18-build-analyzer.png",
    alt: "The Ouroboros build analyzer",
  },
  {
    id: "chatops",
    eyebrow: "CHAT OPS · AI PRESENCE",
    title: "The loop reports where your team already lives.",
    copy: "Stop refreshing the run page. Finished loops announce themselves in Slack or Teams; blocked builds ask their question in-channel and resume the moment someone answers.",
    points: [
      { b: "Blocking questions", t: "— “this fix wants to touch a protected path. Allow?” Answer in-channel; the build continues." },
      { b: "The /ouro command set", t: "— status, queue, pause, dry-run, route, explain — identical in Slack, Teams, and the app." },
      { b: "An AI presence", t: "— “why did #479 take 38 minutes?” gets an answer, a cause, and a one-click fix." },
      { b: "Same rules everywhere", t: "— chat actions are policy-checked and audit-logged exactly like the UI." },
    ],
    shot: "/shots/19-chatops.png",
    alt: "Ouroboros chat ops in a Slack channel",
    flip: true,
  },
];

const MARQUEE = "PULL → SIZE → PLAN → CODE → BUILD → TEST → VERIFY → MERGE → ";

const LIGHT_LOGO = {
  mark: { src: "/logo-mark-light.png", width: 496, height: 278 },
  lockup: { src: "/logo-lockup-light.png", width: 565, height: 417 },
};

function ThemedLogo({
  name, alt = "", className, width, height, priority, style,
}: {
  name: "mark" | "lockup"; alt?: string; className?: string;
  width: number; height: number; priority?: boolean; style?: React.CSSProperties;
}) {
  const light = LIGHT_LOGO[name];
  return (
    <>
      <Image src={`/logo-${name}.png`} alt={alt} width={width} height={height} priority={priority} style={style} className={[className, "logo-dark"].filter(Boolean).join(" ")} />
      <Image src={light.src} alt={alt} width={light.width} height={light.height} priority={priority} style={style} className={[className, "logo-light"].filter(Boolean).join(" ")} />
    </>
  );
}

export default function Home() {
  const seq = MARQUEE.repeat(4);
  return (
    <>
      <header className="topbar">
        <div className="topbar-in">
          <a className="brand" href="#top">
            <ThemedLogo name="mark" width={55} height={34} />
            <span>OURO<b>BOROS</b></span>
          </a>
          <nav className="topnav" aria-label="Site">
            <a href="#loop">The Loop</a>
            <a href="#features">Features</a>
            <a href="#studio">Studio</a>
            <a href="#models">Models</a>
            <a href="#analyzer">Analyzer</a>
            <a href="#enterprise">Enterprise</a>
          </nav>
          <a className="btn primary sm" href="#cta" style={{ marginLeft: 12 }}>
            Start free
          </a>
          <ThemeToggle />
        </div>
      </header>

      <main id="top">
        {/* hero */}
        <section className="hero wrap">
          <ThemedLogo
            name="mark"
            className="hero-mark rise"
            alt="The Ouroboros circuit snake, looped into an infinity symbol"
            width={505}
            height={311}
            priority
          />
          <span className="eyebrow rise d1">ouroboros.build — autonomous development loops</span>
          <h1 className="rise d2">
            Infinity in <em>Autonomy.</em>
          </h1>
          <p className="lede rise d3">
            Sizes the work, writes the code, builds on your hardware, proves the work
            and merges it. Watch the progress, or do something better.{" "}
            <strong>That&rsquo;s the point.</strong>
          </p>
          <div className="hero-cta rise d4">
            <a className="btn primary" href="#cta">Run your first loop</a>
            <a className="btn ghost" href="#loop">Watch it work ↓</a>
          </div>
          <div className="hero-stats rise d4">
            <div><div className="v">92%</div><div className="k">autonomous merge rate</div></div>
            <div><div className="v">~4 min</div><div className="k">to your first PR</div></div>
            <div><div className="v">$1.87</div><div className="k">per merged PR</div></div>
            <div><div className="v">31%</div><div className="k">tokens served locally, free</div></div>
          </div>
          <div className="hero-stats-cap">measured on the acme-robotics demo fleet · 90 days · 1,284 builds</div>
        </section>

        {/* marquee */}
        <div className="marquee" aria-hidden="true">
          <div className="marquee-in">
            {seq}<b>{"↺ "}</b>{seq}<b>{"↺ "}</b>
          </div>
        </div>

        {/* the loop */}
        <section className="section" id="loop">
          <div className="wrap">
            <div className="section-head">
              <span className="eyebrow">The Loop</span>
              <h2>Issue in. Verified pull request out. Forever.</h2>
              <p>
                Eight stages, and the honest part: when a gate fails, the loop bites its own
                tail — back to code, another attempt, until the evidence is green. Nobody
                re-runs anything. Nobody stares at a spinner. You find out when it merges,
                not when it breaks.
              </p>
              <p>
                But that&rsquo;s not all. Create bug fixes, fix regressions, create product
                roadmaps and improvements, perform project and competitive gap analysis with
                full research tools, in addition to handling your build.
              </p>
            </div>
            <div className="loop-grid">
              <div className="ring reveal" role="img" aria-label="The Ouroboros loop: pull, size, plan, code, build, test, verify, merge — with failed gates returning to code">
                <svg viewBox="0 0 560 560" aria-hidden="true">
                  <defs>
                    <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="#3dd6f5" stopOpacity="0.9" />
                      <stop offset="55%" stopColor="#1793c4" stopOpacity="0.55" />
                      <stop offset="100%" stopColor="#3dd6f5" stopOpacity="0.9" />
                    </linearGradient>
                  </defs>
                  <circle cx="280" cy="280" r="225" fill="none" stroke="url(#ringGrad)" strokeWidth="2" opacity="0.85" />
                  <circle cx="280" cy="280" r="225" fill="none" stroke="#3dd6f5" strokeWidth="7" opacity="0.08" />
                  <path d="M174,386 A150,150 0 0 0 386,386" fill="none" stroke="#1793c4" strokeWidth="1.6" strokeDasharray="6 6" opacity="0.9" />
                </svg>
                {STAGES.map((s) => (
                  <span
                    key={s.label}
                    className={`stage ${s.cls ?? ""}`}
                    style={{ left: `${s.x}%`, top: `${s.y}%` }}
                  >
                    {s.label}
                  </span>
                ))}
                <span className="fail-note" style={{ left: "50%", top: "72.5%" }}>fail ↺ back to code</span>
                <div className="ring-center">
                  <ThemedLogo name="mark" width={505} height={311} style={{ width: "62%", height: "auto" }} />
                  <div className="cap">the loop bites its tail</div>
                </div>
              </div>
              <div className="loop-copy reveal">
                <div className="step">
                  <span className="n">PULL · SIZE</span>
                  <h3>It reads your backlog so you don&rsquo;t have to.</h3>
                  <p>Every open issue is continuously estimated — effort, risk, files touched, cost — and queued into the workflow you chose for it.</p>
                </div>
                <div className="step">
                  <span className="n">PLAN · CODE · BUILD · TEST</span>
                  <h3>Real work on real hardware.</h3>
                  <p>The right model for each stage writes the change; your own build farm compiles it and runs the suite — including physical hardware-in-the-loop benches.</p>
                </div>
                <div className="step">
                  <span className="n">VERIFY · MERGE</span>
                  <h3>Merged on evidence, not optimism.</h3>
                  <p>An evidence matrix proves the PR does what the ticket says. Gates green, policy satisfied — the loop merges, closes the issue, and pulls the next one.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* product shot */}
        <section className="wrap reveal" style={{ paddingBottom: 96 }}>
          <div className="frame crop">
            <div className="chrome">
              <i /><i /><i />
              <span className="url">app.ouroboros.build — mission control</span>
            </div>
            <Image src="/shots/02-dashboard.png" alt="The Ouroboros dashboard: live loops, queue, merge rate, and spend" width={1600} height={1200} />
          </div>
        </section>

        {/* features */}
        <section className="section" id="features" style={{ paddingTop: 0 }}>
          <div className="wrap">
            <div className="section-head center">
              <span className="eyebrow">Everything the loop needs</span>
              <h2>Nine systems. One turning wheel.</h2>
            </div>
            <div className="bento">
              {FEATURES.map((f) => (
                <a key={f.idx} className={`tile reveal ${f.span} ${f.full ? "full" : ""}`} href={f.href}>
                  <span className="idx">{f.idx}</span>
                  <h3>{f.title}</h3>
                  <p>{f.copy}</p>
                  <span className="tags">
                    {f.tags.map((t) => (
                      <span key={t} className="tag">{t}</span>
                    ))}
                  </span>
                  <span className="go">Learn more →</span>
                </a>
              ))}
            </div>
          </div>
        </section>

        {/* deep dives */}
        <section className="wrap">
          {DIVES.map((d) => (
            <div key={d.id} className={`dive ${d.flip ? "flip" : ""}`} id={d.id}>
              <div className="dive-copy reveal">
                <span className="eyebrow">{d.eyebrow}</span>
                <h3>{d.title}</h3>
                <p>{d.copy}</p>
                <ul>
                  {d.points.map((p) => (
                    <li key={p.b}><span><b>{p.b}</b> {p.t}</span></li>
                  ))}
                </ul>
              </div>
              <div className="dive-shot reveal">
                <div className="frame">
                  <div className="chrome">
                    <i /><i /><i />
                    <span className="url">app.ouroboros.build</span>
                  </div>
                  <Image src={d.shot} alt={d.alt} width={1600} height={1200} />
                </div>
              </div>
            </div>
          ))}
        </section>

        {/* the rest, in brief */}
        <section className="section" id="more" style={{ paddingTop: 72 }}>
          <div className="wrap">
            <div className="section-head center">
              <span className="eyebrow">And the instruments around it</span>
              <h2>Measure it. Steer it. Plan with it.</h2>
            </div>
            <div className="bento">
              {[
                { shot: "/shots/15-insights.png", cap: "Insights — merge rate, spend, DORA, flaky-test intelligence", alt: "Ouroboros insights dashboard" },
                { shot: "/shots/20-workflow-copilot.png", cap: "Workflow Copilot — dry runs with AI improvement suggestions", alt: "Ouroboros workflow copilot and dry run" },
                { shot: "/shots/08-build-farm.png", cap: "Build farm — pools, live logs, one-line enrollment", alt: "Ouroboros build farm" },
              ].map((m) => (
                <div key={m.shot} className="tile reveal" style={{ padding: 0, overflow: "hidden" }}>
                  <Image src={m.shot} alt={m.alt} width={1600} height={1200} style={{ display: "block" }} />
                  <p style={{ padding: "14px 18px 18px", flex: "none" }} className="mono">{m.cap}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* enterprise */}
        <section className="ent section" id="enterprise">
          <div className="wrap">
            <div className="section-head center">
              <span className="eyebrow">Enterprise</span>
              <h2>Autonomy your security team can sign off on.</h2>
              <p>
                Isolated tenants per domain, SSO-enforced, least-privilege GitHub App scopes —
                and a paper trail for every decision a machine ever made.
              </p>
            </div>
            <div className="ent-grid">
              <div className="ent-card reveal">
                <h4>Tenancy &amp; SSO</h4>
                <p>Every domain is an isolated tenant. SAML/OIDC through your IdP, roles synced from your groups, keys sealed in a per-tenant vault.</p>
              </div>
              <div className="ent-card reveal">
                <h4>Policies as sentences</h4>
                <p>&ldquo;Refactors need a human. Protected paths need allow-once. Loops pause at $2.50.&rdquo; Versioned, auditable, editable as code.</p>
              </div>
              <div className="ent-card reveal">
                <h4>Audit everything</h4>
                <p>Every merge, key rotation, waiver, and chat command in one log — streamed to your SIEM, retained on your terms, in your region.</p>
              </div>
            </div>
            <div className="ent-badges">
              <span className="tag">SOC 2 Type II</span>
              <span className="tag">ISO 27001</span>
              <span className="tag">SSO / SAML / SCIM</span>
              <span className="tag">EU data residency</span>
              <span className="tag">Self-hostable runners</span>
              <span className="tag">Zero data retention option</span>
            </div>
          </div>
        </section>

        {/* final cta */}
        <section className="cta wrap" id="cta">
          <ThemedLogo name="lockup" alt="Ouroboros — Infinity in Autonomy" width={571} height={443} />
          <h2>Your Build Automation Tool, designed for the future, available now.</h2>
          <p>
            You? You&rsquo;re at lunch. First loop in about four minutes — draft PRs only,
            until you say otherwise.
          </p>
          <div className="hero-cta">
            <a className="btn primary" href="#top">Start free — no card</a>
            <a className="btn ghost" href="#features">Explore the features</a>
            <a className="btn ghost" href="https://www.youtube.com/@OuroborosBuild" target="_blank" rel="noopener">Explore our YouTube</a>
          </div>
        </section>
      </main>

      <footer>
        <div className="foot">
          <div>
            <a className="brand" href="#top">
              <ThemedLogo name="mark" width={55} height={34} />
              <span>OURO<b>BOROS</b></span>
            </a>
            <div className="tagline">Infinity in Autonomy</div>
            <p className="blurb">
              Autonomous development loops: issue in, verified pull request out.
              On your models, your build farm, your rules — babysitting not required.
            </p>
          </div>
          <div>
            <h5>Product</h5>
            <ul>
              <li><a href="#loop">The Loop</a></li>
              <li><a href="#studio">Workflow Studio</a></li>
              <li><a href="#models">Models &amp; BYOK</a></li>
              <li><a href="#farm">Build Farm &amp; HIL</a></li>
              <li><a href="#verify">PR Verification</a></li>
            </ul>
          </div>
          <div>
            <h5>Intelligence</h5>
            <ul>
              <li><a href="#analyzer">Build Analyzer</a></li>
              <li><a href="#chatops">Chat Ops</a></li>
              <li><a href="#more">Insights</a></li>
              <li><a href="#more">Planning</a></li>
              <li><a href="#more">Knowledge</a></li>
            </ul>
          </div>
          <div>
            <h5>Company</h5>
            <ul>
              <li><a href="#enterprise">Enterprise</a></li>
              <li><a href="#cta">Pricing</a></li>
              <li><a href="#top">Docs</a></li>
              <li><a href="#top">Security</a></li>
            </ul>
          </div>
        </div>
        <div className="foot-base">
          <div className="foot-base-in">
            <span>© 2026 Ouroboros · ouroboros.build</span>
            <span>the loop bites its tail ↺</span>
          </div>
        </div>
      </footer>
    </>
  );
}
