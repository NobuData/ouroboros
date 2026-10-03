import { requireWorkspace } from "@/app/api/access";
import { AnalyzerScreen } from "@/app/analyzer/analyzer-screen";
import { readAnalyzer } from "@/app/analyzer/data";

/**
 * The Build Analyzer (BW.1, [#516](https://github.com/NobuData/ouroboros/issues/516)) — mockup
 * 18's `/analyzer`.
 *
 * Thin on purpose, the shape every screen in `(app)` takes: the gate returns the workspace this
 * request may render, the reader turns it into what the screen draws, and a component draws it.
 * The repository is the tenant chip's focus, chosen in the browser (`app/analyzer/repo.ts`).
 *
 * **This retires the `/analyzer` placeholder** #49 was to build — never built, so nothing is
 * deleted. Every member may read the page; running an analysis and saving the schedule are an
 * `owner`'s or `admin`'s.
 *
 * @returns The analyzer page, for the workspace this request is operating in.
 */
export default async function Page() {
  return <AnalyzerScreen readings={await readAnalyzer(await requireWorkspace())} />;
}
