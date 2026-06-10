# Writing Tests

AuroraFlow tests are Playwright tests that use framework page objects for browser actions. Keep tests deterministic, user-facing, and explicit about selector ownership.

## Test structure

Recommended layout:

```text
tests/
  pageObjects/
    LoginPage.ts
  login.spec.ts
test-results/
  playwright-results-local.json
```

Page objects own browser actions and selectors. Specs own user journeys and assertions.

## Page object pattern

```ts
import type { Page } from 'playwright';
import { PageObjectBase } from 'auroraflow';

export class ProfilePage extends PageObjectBase {
  constructor(page: Page) {
    super(page);
    this.url = 'https://example.test/profile';
  }

  async updateDisplayName(name: string): Promise<void> {
    await this.open();
    await this.type('[data-testid="display-name"]', name, {
      selectorId: 'profile.displayName',
      expectedName: 'Display name',
    });
    await this.click('[data-testid="save-profile"]', {
      selectorId: 'profile.save',
      expectedRole: 'button',
      expectedName: 'Save profile',
    });
  }

  async statusText(): Promise<string> {
    return (
      (await this.getText('[data-testid="profile-status"]', {
        selectorId: 'profile.status',
      })) ?? ''
    ).trim();
  }
}
```

Use `PageObjectBase` actions instead of direct `page.click()` or `page.fill()` inside page objects when you want logging, screenshots, self-healing capture, and page-action telemetry.

## Safe-action boundary

These `PageObjectBase` actions enter the same safe-action boundary:

- `navigateTo()`
- `open()`
- `getTitle()`
- `click()`
- `type()`
- `getText()`
- `waitForSelector()`
- `waitForTimeout()`
- `takeScreenshot()`
- `close()`

On failure, the boundary logs context, captures a screenshot, optionally writes self-healing artifacts, records telemetry when enabled, and throws `PageActionError`. Invalid caller input, such as out-of-range timeouts, throws `PageActionInputError` before invoking Playwright.

## Selector IDs

Add stable `selectorId` values to action options for elements you expect to manage through the selector registry:

```ts
await this.click('[data-testid="checkout-submit"]', {
  selectorId: 'checkout.submit',
  targetAlias: 'Submit order button',
  expectedRole: 'button',
  expectedName: 'Submit order',
});
```

Good selector IDs are stable domain identifiers, not raw CSS selectors. They let SAT load active registry records, attach history, and create reviewable pending promotions after successful guarded retries.

## Assertions

Prefer Playwright locators and user-visible assertions in specs:

```ts
await expect(page.getByRole('status')).toHaveText('Saved');
```

Avoid asserting on internal implementation details unless the test is a framework unit or contract test.

## Waiting

Prefer locator assertions and `waitForSelector()` over fixed sleeps. Use `waitForTimeout()` only when the system under test has a documented, deterministic delay. AuroraFlow bounds explicit waits to avoid accidental long sleeps.

## Deterministic fixtures

Examples in this repository use local HTML fixtures and stable selectors to keep CI smoke tests reproducible. For external systems, isolate data setup and cleanup so tests are idempotent and parallel-safe.

## Self-healing modes in tests

- `SELF_HEAL_MODE=off`: default; no self-healing capture.
- `SELF_HEAL_MODE=suggest`: write failure artifacts and ranked candidates.
- `SELF_HEAL_MODE=guarded`: additionally dry-run candidates and retry supported actions once when policy allows it.

Guarded retries are conservative. A failed retry never hides the original failure. Pending promotions require registry configuration and review before any active selector record changes.

## Report artifacts

Use Playwright JSON output as the source for flakiness and SLO analysis. The report APIs are exported from the package; the commands below are repository convenience scripts used by AuroraFlow CI:

```bash
npm run flakiness:report -- --input-dir test-results
npm run slo:dashboard -- --flakiness-json test-results/flakiness-summary.json
npm run slo:alerts -- --dashboard-json test-results/slo-dashboard.json \
  --policy-file configs/quality/slo-alert-policy.json
```

Add `--trend-output` when you want bounded JSONL history across runs.
