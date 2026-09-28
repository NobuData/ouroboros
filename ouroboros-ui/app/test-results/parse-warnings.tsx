import { PARSE_WARNINGS_LABEL, type ParseWarningsView } from "./states";

/**
 * The parse-warning banner ([#342](https://github.com/NobuData/ouroboros/issues/342)), over the
 * parser's typed warnings ([#329](https://github.com/NobuData/ouroboros/issues/329)).
 *
 * The upload arrived and only part of it could be read. A page that silently shows forty cases as
 * if they were the whole suite is worse than one that shows an error, so this names each file,
 * what failed to parse in it, and what is therefore missing from the page. It offers no retry:
 * reading the same file again reads the same bytes.
 *
 * @param props.view The banner, from `parseWarningsView`.
 * @returns The banner.
 */
export function ParseWarnings({ view }: Readonly<{ view: ParseWarningsView }>) {
  return (
    <section aria-label={PARSE_WARNINGS_LABEL} className="tests-warnings" role="status">
      <p className="tests-warnings__headline">{view.headline}</p>
      <ul className="tests-warnings__list">
        {view.warnings.map((warning) => (
          <li className="tests-warnings__item" key={warning.key}>
            <span className="tests-warnings__file">
              {warning.at === null ? warning.file : `${warning.file} · ${warning.at}`}
            </span>
            <span className="tests-warnings__failed">{warning.failed}</span>
            <span className="tests-warnings__missing">{warning.missing}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
