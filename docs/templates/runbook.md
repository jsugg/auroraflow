# <System> runbook

<!--
Copy to docs/operations/<name>.md and replace every placeholder.
Reference implementation: docs/operations/redis-production-runbook.md.

These are information requirements, not a layout to reproduce. A runbook is read by someone under
time pressure, so favor whatever ordering gets them to the fix fastest. If this runbook governs a
release-, security-, privacy-, or production-critical surface, add the ownership front matter that
docs/README.md describes.
-->

## Scope and ownership

What this runbook covers, and who owns the system in production. Be explicit about the boundary: AuroraFlow ships the client and reference assets; operators own deployment, credentials, TLS, capacity, retention, and incident response.

## Prerequisites

Access, credentials, tools, and environment the responder needs before starting. If they need something they cannot self-serve, say who grants it.

## Detection

How the responder knows this is happening: the symptom, the alert, the log line, the metric. Include what the failure looks like from the test author's side, not only from the infrastructure side.

## Mitigation

The immediate action that stops the bleeding, and its blast radius. Separate what is safe to do unilaterally from what needs a second pair of eyes.

## Recovery

How to restore normal service after the immediate risk is contained, including any data repair and the order operations must happen in.

## Verification

How the responder confirms the system is actually healthy — the command to run and the output that counts as proof. "It looks fine" is not verification.

## Escalation

When to stop and escalate, who to, and what evidence to bring. Include the point past which the responder should not keep trying.

## Rollback

How to undo the mitigation or recovery if it makes things worse, and any state that cannot be rolled back once changed.
