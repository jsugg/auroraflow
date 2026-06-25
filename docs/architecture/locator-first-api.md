# Locator-first page-action API design

- Status: Draft for API review; no prototypes shipped.
- Date: 2026-06-24
- Related: `AUR-IMPL-027`, `AUR-IMPL-020`, `AUR-IMPL-022`, `AUR-ARCH-027`
- Owners: runtime/API maintainers

## Context

Modern Playwright code favors `Locator` objects, but AuroraFlow's stable page-object actions accept string selectors. Users who call `locator.click()` directly bypass the AuroraFlow page-action envelope, so failures lose framework telemetry, screenshots, self-healing artifacts, guarded retry evidence, and registry context.

`AUR-IMPL-020` added the structured `CandidateLocator` model, and `AUR-IMPL-022` moved `PageObjectBase.click()` and `PageObjectBase.type()` behind the internal `PageActionPipeline`. Those seams make locator-first ergonomics possible without rewriting the public facade.

## Design status

This document is the API-review package for `AUR-IMPL-027`. It deliberately ships no runtime prototype, no declaration change, and no root export. Locator overloads may be implemented only after maintainers approve this design or a successor ADR.

Rule: add prototypes only after API review.

## Goals

- Keep every existing string-selector method signature and behavior compatible.
- Add Playwright `Locator` overloads behind the action pipeline, not beside it.
- Preserve action metadata for telemetry, artifacts, SAT analysis, guarded validation, and registry workflows when caller metadata is available.
- Avoid Playwright private fields and unstable `Locator` stringification.
- Keep the first implementation small: `click()` and `type()` only.

## Non-goals

- Do not remove, rename, or weaken string-selector APIs.
- Do not wrap every Playwright `Locator` method.
- Do not infer selectors from `Locator` internals.
- Do not change selector registry schemas in this task; schema-versioned registry records remain `AUR-IMPL-029`.
- Do not add source-code rewrites or selector mutation.

## Proposed public overloads

These signatures are proposed only; they are not currently part of the shipped API.

```ts
import type { Locator } from 'playwright';

abstract class PageObjectBase {
  click(selector: string, options?: ActionOptions): Promise<void | null>;
  click(locator: Locator, options?: ActionOptions): Promise<void | null>;

  type(selector: string, text: string, options?: ActionOptions): Promise<void | null>;
  type(locator: Locator, text: string, options?: ActionOptions): Promise<void | null>;
}
```

`ActionOptions` remains the metadata carrier. The first prototype should reuse `targetAlias`, `selectorId`, `expectedRole`, and `expectedName`; add new options only if API review proves those fields cannot describe locator targets clearly.

## Target descriptor model

The implementation should normalize selectors and locators before entering the pipeline:

| Target kind | Required input | Display target | Self-healing context |
| --- | --- | --- | --- |
| `selector` | string selector | raw selector, preserving current behavior | existing selector-based suggestions, SAT, guarded retry, and registry persistence |
| `locator` | Playwright `Locator` | `targetAlias`, then `selectorId`, then `expectedName`, then `Playwright Locator` | metadata-based SAT/registry lookup only; no selector extraction from the locator |

Recommended internal shape:

```ts
type PageActionTarget =
  | {
      kind: 'selector';
      selector: string;
      display: string;
      telemetryTarget: string;
    }
  | {
      kind: 'locator';
      locator: Locator;
      display: string;
      telemetryTarget?: string;
    };
```

The target descriptor should be internal until review decides whether any lower-level target type deserves export. No new root export is needed for the overloads.

## Pipeline behavior

The public facade should keep doing option validation and context lookup. The pipeline should own target dispatch:

- selector target: call `page.click(selector, options)` or `page.fill(selector, text, options)`;
- locator target: call `locator.click(options)` or `locator.fill(text, options)`;
- guarded auto-heal: keep applying accepted structured candidates through `resolveGuardedLocator()` against the page, not through the original locator;
- success/error messages: preserve exact existing string-selector messages and define new locator-specific messages before prototype work begins.

The pipeline remains the only action path for both target kinds. Direct helper calls continue to preserve their existing singleton fallback behavior.

## Telemetry and artifact behavior

- String selectors keep current target hashing/export semantics and message text.
- Locator actions must emit a distinct target kind, for example `locator`, using only caller-provided logical metadata for target hashing or raw export.
- Locator actions without `targetAlias`, `selectorId`, `expectedRole`, or `expectedName` should still capture failures, but registry persistence and guarded auto-apply should stay conservative because there is no durable selector identity.
- Locator actions with `selectorId` can participate in registry history and pending promotion records keyed by that logical selector ID.
- Failure artifacts should describe locator targets without serializing private Playwright locator state.

## Compatibility invariants

- `click(selector: string, options?)` and `type(selector: string, text, options?)` continue to compile, run, log, throw, and self-heal as they do today.
- Existing string-selector tests should pass unchanged.
- Existing artifact readers must continue to understand old string-target events.
- Existing public imports should not change; `Locator` is referenced through a type-only Playwright peer import in declarations.
- Package-surface classification should not change unless review adds a new export.

## API review checklist

Approve all items before adding prototypes:

1. Confirm overload order and declaration output preserve existing TypeScript inference.
2. Confirm no new runtime dependency is introduced; `Locator` is type-only.
3. Decide exact locator success/error message wording.
4. Decide whether current `ActionOptions` metadata is sufficient for locator targets.
5. Decide whether artifact schemas need an explicit `targetKind` field.
6. Decide guarded auto-heal eligibility for locator actions with no selector ID.
7. Confirm telemetry cardinality stays bounded and privacy-safe.
8. Confirm examples should shift toward locator-first style only after implementation.

## Prototype test plan after review

- Public API type test proving string and `Locator` overloads compile.
- Page-action pipeline unit tests for selector and locator dispatch.
- Regression tests proving string-selector error messages and guarded retry behavior are unchanged.
- Telemetry/artifact tests for locator target kind and logical metadata.
- Self-healing tests covering locator targets with and without `selectorId`.
