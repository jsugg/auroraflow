# Documentation exceptions and waivers

A waiver records a deliberate, time-bound decision not to meet a documentation requirement. It exists so that a gap is a visible decision with an owner, rather than an undocumented lapse someone discovers later.

**There are currently no active waivers.** That is the intended steady state.

## When a waiver is the right answer

Prefer fixing the requirement. Reach for a waiver only when the requirement genuinely does not fit the situation and the cost of meeting it now outweighs the risk of not meeting it.

A waiver is not a way to silence an automated check. If a check is wrong, fix the check; if a document is wrong, fix the document. Waive only when both are working correctly and the gap is still the right call for now.

## How to file one

1. Copy [`TEMPLATE.md`](./TEMPLATE.md) to `docs/exceptions/<short-slug>.md`.
2. Fill in every field. A waiver without a stated risk or a revisit trigger is not a waiver — it is an open-ended exemption.
3. Link the waiver from the document or check it applies to, so a reader meets the exception where they meet the gap.
4. Get it reviewed like any other change. The owner named in the waiver must be a real person who has agreed to hold it.

## What a waiver must record

| Field | Why it is required |
| --- | --- |
| Requirement waived | Names exactly what is not being met, so the scope cannot quietly widen. |
| Justification | Why meeting the requirement is not the right call now. |
| Risk | What could go wrong because of the gap, stated plainly. |
| Owner | The person accountable for revisiting it. Not a team, not a placeholder. |
| Expiry or revisit trigger | The date or event that forces the decision to be made again. |

## Lifecycle

A waiver is reviewed when its expiry date passes or its revisit trigger fires. At that point it is either renewed with a fresh justification, or the underlying gap is closed and the file is deleted. Deleting a resolved waiver is the goal; an accumulating `docs/exceptions/` directory is a signal that a requirement is wrong or unaffordable and should be renegotiated rather than repeatedly waived.
