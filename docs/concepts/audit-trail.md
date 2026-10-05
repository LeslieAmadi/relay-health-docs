---
id: audit-trail
title: The audit trail
sidebar_label: The audit trail
---

# The audit trail

Every access to clinical information is recorded. This page explains what is recorded, why
the record includes a reason, and how to read it.

## What an audit event answers

Most access logs answer three questions: who, what and when. A clinical audit trail has to
answer a fourth.

> **Why was this information accessed?**

Without it, an audit can confirm that an access happened but not whether it should have.
With it, an auditor can ask whether the stated purpose justified the access, which is the
question that actually matters.

It is also what makes inappropriate access visible. A clinician who views a record they
have no referral for stands out, because the purpose field has nothing to point at.

---

## An audit event

```json
{
  "audit_id": "AUD-92831",
  "action": "VIEW_CLINICAL_RECORD",
  "actor": {
    "type": "practitioner",
    "id": "PRACT-8831"
  },
  "organization_id": "ORG-102",
  "patient_id": "PAT-100029",
  "referral_id": "REF-3382",
  "purpose": "treatment",
  "purpose_detail": "Treatment of referral REF-3382",
  "outcome": "permitted",
  "break_glass": false,
  "request_id": "req_7Hx2kQ9mPz",
  "timestamp": "2026-09-18T13:42:00Z"
}
```

| Field | Description |
|---|---|
| `audit_id` | Unique, immutable. |
| `action` | What was done. See the action list below. |
| `actor` | The individual, from `X-Acting-Practitioner`. |
| `organization_id` | The authenticated organisation. |
| `patient_id` | The patient whose information was involved. |
| `referral_id` | The referral providing the basis, where one applies. |
| `purpose` | The lawful basis category, for example `treatment`. |
| `purpose_detail` | Human-readable reason. |
| `outcome` | `permitted` or `denied`. |
| `break_glass` | Whether emergency access was used. |
| `request_id` | Links the event to the originating request. |
| `timestamp` | ISO 8601, UTC. |

### Both actors are recorded

The organisation authenticates; the practitioner acts. Recording only the organisation
would mean an audit could say "someone at Hospital A viewed this record", which is not
accountability.

The API verifies the practitioner is registered to act for the authenticated organisation,
so a client cannot name an arbitrary practitioner to shift responsibility.

---

## Denied attempts are recorded too

An access that was refused is still an access attempt, and a pattern of refusals is
exactly what an investigation looks for.

```json
{
  "audit_id": "AUD-92844",
  "action": "VIEW_CLINICAL_RECORD",
  "actor": { "type": "practitioner", "id": "PRACT-8831" },
  "patient_id": "PAT-100104",
  "referral_id": null,
  "purpose": "treatment",
  "outcome": "denied",
  "denial_reason": "ACCESS_DENIED",
  "timestamp": "2026-09-18T14:02:11Z"
}
```

Note `referral_id: null`. There was no referral to justify the request, which is why it
was denied and why it stands out in a review.

---

## Actions

| Action | Recorded when |
|---|---|
| `VIEW_CLINICAL_RECORD` | Clinical information was returned. |
| `CREATE_REFERRAL` | A referral was submitted. |
| `UPDATE_REFERRAL` | A referral was changed. |
| `CANCEL_REFERRAL` | A referral was cancelled. |
| `ACCEPT_REFERRAL` | A referral was accepted. |
| `REJECT_REFERRAL` | A referral was rejected. |
| `CREATE_PATIENT` | A patient record was created. |
| `UPDATE_PATIENT` | Patient details were changed. |
| `VIEW_DOCUMENT` | A clinical document was retrieved. |
| `BREAK_GLASS_ACCESS` | Emergency access was used. |

Reads of non-clinical data, such as listing facilities, are not audited. Auditing
everything produces a log nobody reviews.

---

## Break-glass events

Break-glass access generates an event flagged for review rather than filed away.

```json
{
  "audit_id": "AUD-92901",
  "action": "BREAK_GLASS_ACCESS",
  "actor": { "type": "practitioner", "id": "PRACT-2204" },
  "organization_id": "FAC-2210",
  "patient_id": "PAT-100029",
  "purpose": "emergency_treatment",
  "purpose_detail": "Patient unresponsive on arrival. Allergy status required before anaesthesia.",
  "outcome": "permitted",
  "break_glass": true,
  "review_status": "pending",
  "timestamp": "2026-09-20T02:14:37Z"
}
```

`purpose_detail` holds the justification the clinician typed. It is mandatory, free text,
and not selectable from a list, because a dropdown of reasons becomes a reflex rather than
a decision.

`review_status` starts as `pending`. These events are meant to be looked at by a person.

---

## Querying the audit trail

```
GET /v1/audit-events
```

| Parameter | Description |
|---|---|
| `patient_id` | Events concerning one patient. |
| `referral_id` | Events concerning one referral. |
| `actor_id` | Events by one practitioner. |
| `action` | Filter by action. Repeatable. |
| `outcome` | `permitted` or `denied`. |
| `break_glass` | `true` to see emergency accesses only. |
| `from`, `to` | ISO 8601 window. |
| `page`, `limit` | Paging. Defaults 1 and 25, maximum 100. |

```bash
curl "https://api.relayhealth.example/v1/audit-events?referral_id=REF-3382" \
  -H "Authorization: Bearer $RELAY_TOKEN" \
  -H "X-Acting-Practitioner: PRACT-8831"
```

### What you can see

Your organisation's own audit events, and events concerning referrals you sent or
received. You cannot see another organisation's internal accesses, even for a shared
patient.

That boundary is deliberate. A referring hospital does not get visibility into who at the
receiving hospital opened a record.

:::note Reading the audit trail is itself audited
A query against `/v1/audit-events` generates its own event. Audit access is a sensitive
operation, and the trail has to cover the people reviewing it.
:::

---

## Immutability and retention

Audit events cannot be modified or deleted through the API. There is no `PATCH` and no
`DELETE`. An audit trail that can be edited is not an audit trail.

Retention is set by the operating hospital according to its regulatory obligations, which
vary by jurisdiction. The API does not impose a default, because a default here would be
guessing at a legal requirement.

:::warning A patient erasure request does not erase the audit trail
Where a patient exercises a right to erasure, clinical and audit records are usually
subject to a separate retention obligation that overrides it. This is a legal question for
your data protection officer, not an API setting.
:::

---

## What to do with this

**Forward events to your own audit store.** The API's trail covers requests made through
the API. Your organisation's obligations cover more than that. Pull events regularly and
keep them alongside your internal records.

**Review break-glass events.** They exist to be reviewed. An unreviewed break-glass log is
the same as having no control at all.

**Watch denials.** A rising count of `ACCESS_DENIED` for one practitioner is either a
misconfigured integration or something that needs a conversation.

---

## Related

- [The consent model](./consent-model.md): what the purpose field records against
- [Error reference](../reference/errors.md): the denial reasons that appear in audit events
- [Referrals](../reference/referrals.md): the referral that provides the basis for access