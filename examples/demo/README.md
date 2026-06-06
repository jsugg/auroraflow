# Page Object Demo

This example keeps the legacy `ExamplePage` concept as a deterministic documentation fixture instead of a production integration.

## Files

- `fixtures/example-app.html`: local HTML fixture used by tests.
- `pageObjects/ExamplePage.ts`: `PageObjectBase` implementation for the fixture.
- `tests/suites/e2e/examples/example-page.spec.ts`: smoke test that exercises the fixture through `PageFactory`.

Run the example suite:

```bash
npm run test:examples
```
