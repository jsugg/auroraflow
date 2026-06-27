/** Fixed component count used by the failure-path performance fixture. */
export const FAILURE_PATH_FIXTURE_COMPONENTS = 180;

/** Builds a network-free, deterministic DOM that exceeds the default snapshot node budget. */
export function buildFailurePathFixtureHtml(): string {
  const rows = Array.from({ length: FAILURE_PATH_FIXTURE_COMPONENTS }, (_, index) => {
    const rowNumber = index + 1;
    return [
      `<article class="benchmark-row" data-benchmark-row="${rowNumber}">`,
      `<label for="benchmark-input-${rowNumber}">Fixture row ${rowNumber}</label>`,
      `<input id="benchmark-input-${rowNumber}" name="fixture-${rowNumber}" value="row-${rowNumber}">`,
      `<span>Deterministic fixture content ${rowNumber}</span>`,
      '</article>',
    ].join('');
  }).join('');

  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    '<style>body{font-family:sans-serif}.benchmark-row{display:block;padding:1px}',
    'button,input,span,label{display:inline-block;min-width:1px;min-height:1px}</style>',
    '</head><body><main>',
    '<button data-testid="benchmark-disabled" disabled>Unavailable benchmark action</button>',
    rows,
    '</main></body></html>',
  ].join('');
}
