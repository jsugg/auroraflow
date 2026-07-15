# Getting Started

This guide gets a new AuroraFlow test project running with Playwright, page objects, and deterministic local verification. It describes implemented behavior only.

## Requirements

- Node.js `>=20 <25`
- npm
- Playwright browsers
- Docker only when running Redis integration tests or the local observability stack

## Install in a test project

AuroraFlow is not yet published to the npm registry, so install it from a locally packed tarball. See the [release process](./operations/release-process.md#current-state-dry-run-only) for the canonical release state.

### Pre-publish install (current path)

Build a tarball from a repository checkout:

```bash
git clone https://github.com/jsugg/auroraflow.git
cd auroraflow
npm ci
npm pack
```

`npm pack` writes `auroraflow-<version>.tgz` to the repository root. Install that file in your test project:

```bash
npm install --save-dev /path/to/auroraflow-<version>.tgz @playwright/test playwright
npx playwright install --with-deps
```

This is the same install path the release dry run exercises through `npm run package:consumer-smoke`, which installs the packed tarball into a temporary project and typechecks it.

### Post-publish install (after the first release)

Once the package is published, install it from the registry instead:

```bash
npm install --save-dev auroraflow @playwright/test playwright
npx playwright install --with-deps
```

AuroraFlow declares `playwright` as a peer dependency. Keep the installed Playwright version inside the package peer range.

## Minimal Playwright configuration

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['json', { outputFile: 'test-results/playwright-results-local.json' }]],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
```

The JSON reporter output is the input for AuroraFlow flakiness and SLO artifact commands.

## First page object

```ts
// tests/pageObjects/LoginPage.ts
import type { Page } from 'playwright';
import { PageObjectBase } from 'auroraflow';

export class LoginPage extends PageObjectBase {
  constructor(page: Page) {
    super(page);
    this.url = 'https://example.test/login';
  }

  async signIn(email: string, password: string): Promise<void> {
    await this.open();
    await this.type('[data-testid="email"]', email, {
      selectorId: 'login.email',
      expectedName: 'Email',
    });
    await this.type('[data-testid="password"]', password, {
      selectorId: 'login.password',
      expectedName: 'Password',
    });
    await this.click('[data-testid="submit"]', {
      selectorId: 'login.submit',
      expectedRole: 'button',
      expectedName: 'Sign in',
    });
  }
}
```

`selectorId` is optional, but providing a stable ID allows registry-backed SAT history and pending promotion records to correlate future failures.

## First test

```ts
// tests/login.spec.ts
import { expect, test } from '@playwright/test';
import { PageFactory } from 'auroraflow';
import { LoginPage } from './pageObjects/LoginPage';

test('user can sign in', async ({ page }) => {
  const pages = new PageFactory(page);
  const loginPage = pages.getPage(LoginPage);

  await loginPage.signIn('user@example.test', 'correct-horse-battery-staple');

  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
});
```

`PageFactory` caches one page-object instance per constructor for the active Playwright `Page`.

## Run local checks

```bash
npm test
```

In the AuroraFlow repository itself, the equivalent contributor gate is:

```bash
npm run verify
npm run test:smoke
```

## Optional self-healing diagnostics

Self-healing capture is off by default. Enable it only for triage or guarded experiments:

```bash
SELF_HEAL_MODE=suggest npm test
SELF_HEAL_MODE=guarded SELF_HEAL_ALLOWED_DOMAINS=example.test npm test
```

Artifacts are written to `test-results/self-healing/*.json`. Guarded mode can dry-run locator candidates and retry supported actions once when policy allows it. Registry-backed promotion remains reviewed and mutates selector registry records only; it does not rewrite source files.

## Optional quality artifacts

AuroraFlow exports report-building APIs. This repository also keeps convenience scripts for CI and local development; those scripts are repository tooling, not a package CLI. In this repository, generate deterministic report artifacts from Playwright JSON output with:

```bash
npm run flakiness:report -- --input-dir test-results
npm run slo:dashboard -- --flakiness-json test-results/flakiness-summary.json
npm run slo:alerts -- --dashboard-json test-results/slo-dashboard.json \
  --policy-file configs/quality/slo-alert-policy.json
```

For command details, see:

- [Writing tests](./writing-tests.md)
- [Configuration](./configuration.md)
- [API](./api.md)
- [Self-healing architecture](./architecture/self-healing.md)
- [Flakiness analytics](./operations/flakiness-analytics.md)
- [SLO dashboard and alerting](./operations/slo-dashboard-alerting.md)
