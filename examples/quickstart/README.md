# Quickstart Example

This quickstart is a deterministic Playwright + POM example using a local HTML fixture.

## What it demonstrates
- Local fixture navigation (`file://`) to avoid external flakiness.
- A minimal page object class with small, focused methods.
- Assertions based on visible user-facing behavior.

## Files
- `fixtures/sample-app.html`: deterministic UI fixture.
- `pageObjects/SampleAppPage.ts`: minimal POM wrapper.
- `tests/suites/e2e/examples/quickstart.spec.ts`: runnable E2E test.

## Common Failure Mode
Replacing role/label selectors with fragile CSS chains usually increases maintenance cost when UI markup changes.

## Run

```bash
npm run test:examples
```
