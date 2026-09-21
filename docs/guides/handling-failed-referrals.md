---
id: handling-failed-referrals
title: Handling failed referrals
sidebar_label: Handling failed referrals
---

# Handling failed referrals

A referral can fail in three different ways, and each needs a different response. Treating
them the same is how patients end up with duplicate referrals, or with none at all.

| What happened | How you find out | What it means |
|---|---|---|
| **The request failed** | An error response | Your referral was not created. |
| **The request is uncertain** | A timeout, or no response | You do not know whether it was created. |
| **The referral was declined** | A `referral.rejected` webhook | It was created, reviewed and refused. |

Work out which of the three you are in before doing anything else.

## Before you start

You need:

- The `Idempotency-Key` you sent with the original request, stored alongside the pending
  referral in your system
- A webhook endpoint subscribed to `referral.rejected`
- The [error reference](../reference/errors.md) to hand

If you are not storing idempotency keys with your pending referrals, fix that first. Every
recovery path on this page depends on it.

---

## If the request timed out

This is the dangerous case, because nothing comes back to tell you what happened.

**1. Retry with the same `Idempotency-Key`.** Not a new one.

```bash
curl -X POST https://api.relayhealth.example/v1/referrals \
  -H "Authorization: Bearer $RELAY_TOKEN" \
  -H "Idempotency-Key: 8f14e45f-ea1b-4a2c-9c1f-7b3d0e5a2c81" \
  -H "X-Acting-Practitioner: PRACT-8831" \
  -H "Content-Type: application/json" \
  -d @referral.json
```

If the original request succeeded, you get the original referral back. If it never
arrived, the referral is created now. Either way, exactly one exists.

**2. Back off between attempts.** Two quick retries, then exponential back-off with jitter.
Retrying a timeout in a tight loop turns one failure into a `RATE_LIMITED`.

**3. If retries keep failing, look for the referral before escalating.**

```bash
curl "https://api.relayhealth.example/v1/referrals?patient_id=PAT-100029&created_after=2026-09-19T09:00:00Z" \
  -H "Authorization: Bearer $RELAY_TOKEN" \
  -H "X-Acting-Practitioner: PRACT-8831"
```

If a referral appears for this patient in that window, it was created. Record its
`referral_id` against your pending item and stop retrying.

:::warning Do not generate a new key to get past a failure
A new `Idempotency-Key` tells the API this is a different referral. If the first attempt
succeeded, you have now referred the patient twice.
:::

**Verify it worked:** your system holds exactly one `referral_id` for this referral, and its
status is `PENDING` or later.

---

## If the request returned an error

The request failed and no referral was created. What you do next depends on the error.

**1. Read `error.code`, not `error.message`.** The code is stable; the message may change.

**2. Use the retry guidance** from the [error reference](../reference/errors.md). In summary:

| Group | Examples | Action |
|---|---|---|
| Fix and resend | `CLINICAL_SUMMARY_INCOMPLETE`, `PATIENT_NOT_FOUND` | Correct the request. Send it with a new key. |
| Retry as-is | `RATE_LIMITED`, `INTERNAL_ERROR` | Retry with the **same** key after back-off. |
| Needs a person | `PATIENT_MATCH_CONFLICT`, `ACCESS_DENIED` | Stop. Route to someone who can resolve it. |

The distinction between the first two rows matters. A corrected request is a different
request, so it takes a new key. A retried request is the same request, so it keeps the old
one.

**3. Never retry a `403`.** It means the API has decided you may not do this. Retrying
cannot change that decision; it only adds to the audit trail.

**Verify it worked:** a corrected request returns `201 Created` with a new `referral_id`.

---

## If the referral was rejected

A rejection is not an error. A clinician at the receiving hospital reviewed the referral and
declined it. It arrives as a webhook:

```json
{
  "event_id": "EVT-71022",
  "type": "referral.rejected",
  "created_at": "2026-09-19T15:40:02Z",
  "data": {
    "referral_id": "REF-3382",
    "status": "REJECTED",
    "rejection": {
      "reason": "capacity",
      "message": "No general surgery capacity within the clinically appropriate window.",
      "suggested_alternative_facility_id": "FAC-2244"
    }
  }
}
```

A rejected referral is final. You cannot reopen it or edit it. Every path forward is a new
referral, so each one takes a new `Idempotency-Key`.

**Act on the reason:**

| `reason` | What to do |
|---|---|
| `insufficient_information` | Complete the clinical summary and submit a new referral to the same facility. |
| `capacity` | Refer to another facility. Use `suggested_alternative_facility_id` if one is given. |
| `out_of_scope` | This facility does not offer the procedure. Refer elsewhere. |
| `patient_unsuitable` | A clinical decision. Route to the referring clinician; do not resubmit automatically. |
| `duplicate` | A matching referral already exists. Find it and track that one instead. |

`insufficient_information` is the only reason where resubmitting to the same facility is
likely to succeed.

:::note patient_unsuitable is not a data problem
Never resubmit a `patient_unsuitable` rejection automatically, even with better data. A
clinician has made a judgement about this patient. The next step is a conversation between
clinicians, not an API call.
:::

**Verify it worked:** the original referral stays `REJECTED` in your system, and any new
referral has its own `referral_id` and status.

---

## If a referral seems stuck

A referral sitting in `UNDER_REVIEW` for a long time has not failed. Clinical review takes
as long as it takes, and the API does not set a deadline on another organisation's clinicians.

Do not poll aggressively to check. Your webhook subscription will tell you when it moves.

If a referral has been waiting longer than is clinically acceptable for its urgency, that is
a clinical escalation, not a technical one. Contact the receiving facility through your
normal clinical channels.

---

## If a scheduled referral is cancelled

A referral can be cancelled after it was scheduled, by either side. You receive an
`appointment.cancelled` webhook, and the referral moves to `CANCELLED`.

If the receiving hospital cancelled it, check the reason before deciding what to do. If you
need to refer the patient again, that is a new referral with a new key.

---

## Related

- [Idempotency and retries](../concepts/idempotency.md): why the key decides everything on
  this page
- [Error reference](../reference/errors.md): every code and whether to retry
- [Referrals](../reference/referrals.md): the lifecycle and rejection reasons