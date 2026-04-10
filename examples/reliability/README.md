# Reliability Examples

## Why This Exists
These examples demonstrate deterministic reliability patterns for UI tests: network mocking, explicit timeout controls, and targeted retries for transient failures.

## Files
- `fixtures/reliability-app.html`: deterministic fixture used by reliability scenarios.
- `pageObjects/ReliabilityAppPage.ts`: minimal POM wrapper for the fixture.
- `tests/suites/e2e/examples/deterministic-network-mock.spec.ts`: stable network mock example.
- `tests/suites/e2e/examples/retries-and-timeouts.spec.ts`: targeted retry and timeout example.

## Common Failure Mode
If tests accidentally call real external APIs instead of mocked routes, suite stability drops and CI becomes flaky.

## Run

```bash
npm run test:examples
```
