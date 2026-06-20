# Agent Instructions

## AUR-QE-107 contract assertions

Contract specs are semantic-first.

- raw toContain/toMatch and bare boolean toBe(true)/toBe(false) stay banned in `tests/suites/contracts/**`.
- Use parsed workflow/JSON/Compose models where practical instead of asserting raw YAML, Markdown, or JSON text.
- Keep public compatibility or safety wording checks rare. When needed, route them through `tests/helpers/contractAssertions.ts` and include explicit rationale.
- Do not weaken `tests/suites/contracts/workflows/test-taxonomy.contract.spec.ts`; it enforces this policy.
