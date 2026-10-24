import data from "../data/reference-run.json";

/** One measured figure, linked to the bundle file it was computed from. */
type Figure = { id: string; value: number; display: string; label: string; href: string };

/** `data/reference-run.json` as `scripts/reference-run.mjs` writes it (DL.4, #1328). */
type ReferenceRun =
  | { bundle: null; note: string }
  | {
      bundle: string;
      source: string;
      manifestSha256: string;
      sample: 1;
      repository: string;
      issue: number;
      models: string[];
      pullRequest: string;
      recording: string | null;
      evidence: string;
      figures: Figure[];
    };

/**
 * The hero's figures: what one real reference run measured, each linked to its evidence, with the
 * sample stated beside them. No rate, percentage or per-merge cost — one run has none (L13).
 *
 * Until a bundle is published the data file holds no bundle and this renders no number at all,
 * only a line saying the first real run is being recorded.
 *
 * @returns The stats row and its caption.
 */
export default function ReferenceRunStats() {
  const run = data as ReferenceRun;
  if (run.bundle === null) {
    return (
      <div className="hero-stats hero-stats--pending rise d4">
        <p className="hero-stats-cap">
          No figures yet: the first real run is being recorded. We will publish what it measured,
          with its evidence, and no rate until enough runs support one.
        </p>
      </div>
    );
  }
  return (
    <>
      <div className="hero-stats rise d4">
        {run.figures.map((f) => (
          <a key={f.id} className="hero-stat" href={f.href}>
            <div className="v">{f.display}</div>
            <div className="k">{f.label}</div>
          </a>
        ))}
      </div>
      <div className="hero-stats-cap">
        n = 1 · one real run, {run.bundle} · {run.repository}#{run.issue} · {run.models.join(", ")} · ends at a
        draft pull request ·{" "}
        <a href={run.pullRequest}>pull request</a>
        {run.recording ? (
          <>
            {" "}· <a href={run.recording}>recording</a>
          </>
        ) : null}{" "}
        · <a href={run.evidence}>evidence →</a>
      </div>
    </>
  );
}
