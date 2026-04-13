# CI Template Examples

## Why This Exists
These templates provide copy-ready GitHub Actions workflows that mirror AuroraFlow baseline quality, matrix, and security patterns.

## Files
- `quality.workflow.example.yml`: fast PR quality gate template.
- `e2e-matrix.workflow.example.yml`: full matrix execution template.
- `security.workflow.example.yml`: baseline dependency and workflow security template.

## Common Failure Mode
Copying workflow snippets without pinned action SHAs and runtime policy controls causes supply-chain drift and noisy CI regressions over time.
