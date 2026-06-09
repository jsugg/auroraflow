# Observability Dashboard Review Checklist

Use this checklist before merging dashboard or alert changes.

- [ ] Panels query source-controlled data sources only.
- [ ] Prometheus labels remain low-cardinality.
- [ ] `npm run observability:live-assert` passes and refreshes `observability-label-snapshot.json` for changed dashboard/rule semantics.
- [ ] Dashboard variables do not expose raw selectors, URLs, tokens, cookies, or request bodies.
- [ ] Panels have units, thresholds, and descriptions for operational interpretation.
- [ ] Alerts map to documented SLO or operational runbooks.
- [ ] Queries stay bounded to reasonable time windows.
- [ ] Dashboard JSON is exported and committed after UI edits.
- [ ] Grafana provisioning still loads without manual setup.
- [ ] Screenshots or diagnostics from a smoke run are attached to release evidence when required.
