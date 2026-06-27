# Failure-path performance baseline

This document records failure-path cost before any performance budget becomes enforceable. The machine-readable observation is [`failure-path-baseline.json`](./failure-path-baseline.json).

## Reproduce

```bash
npm run benchmark:failure-path          # informational report under ignored test-results/
npm run benchmark:failure-path:record   # refresh the committed baseline
```

The manual benchmark launches headless Google Chrome, loads a network-free fixture with 180 fixed components, and warms up three times before collecting 12 samples. `AURORAFLOW_BENCHMARK_BROWSER_CHANNEL=chromium` selects the bundled Chromium channel when available. The default report compares each current median with this committed baseline and labels the observed trend `faster`, `slower`, or `unchanged`; every comparison is diagnostic only.

The fixture always exceeds the 500-node snapshot bound and deterministically yields 625 SAT candidate seeds. Every aggregate sample starts after the intentionally invalid Playwright action fails, then includes failure screenshot capture, suggestion generation, bounded DOM snapshot capture, SAT extraction/ranking, memory-backed registry and history I/O, guarded candidate probes, failure-artifact write, and pending-registry persistence. The invalid action's selector wait is excluded, so the number measures AuroraFlow failure handling rather than an application timeout. Memory registry I/O keeps the baseline deterministic; real Redis transport latency remains visible through `auroraflow_redis_operation_duration_ms` in consumer environments.

The isolated measurements time bounded DOM capture, SAT candidate extraction from that snapshot, and the production file writer writing a representative 13,753-byte failure event. Fixture invariants fail the command if node bounds, SAT seed count, or artifact size drift between samples.

## Recorded observation

Environment: Node 22.22.1, Chrome 149.0.7827.53, Linux/WSL2, four logical CPUs, approximately 2 GB memory.

| Measurement              |     Median |       Mean |         p95 |               Range |
| ------------------------ | ---------: | ---------: | ----------: | ------------------: |
| Safe-action failure path | 564.249 ms | 652.144 ms | 1040.430 ms | 524.311–1040.430 ms |
| DOM snapshot             | 275.715 ms | 298.632 ms |  493.699 ms |  251.293–493.699 ms |
| SAT candidate extraction |   6.022 ms |   6.636 ms |   17.499 ms |     3.173–17.499 ms |
| Artifact write           |   3.266 ms |   4.465 ms |   10.677 ms |     2.087–10.677 ms |

Statistics use deterministic nearest-rank percentiles. These values describe one constrained development host; they are not cross-machine SLOs.

## Approval and gating

Baseline policy remains `warning_only`, approval remains `pending`, and `hardThresholds` is `null`. A slower median emits a warning-only observation without a tolerance or exit-code change; only a broken fixture, missing metric, browser failure, or invalid report fails the command. The benchmark is absent from `npm run verify` and required CI jobs.

A separate maintainer-approved change must define environment-normalized budgets and promotion criteria before adding any hard performance gate.
