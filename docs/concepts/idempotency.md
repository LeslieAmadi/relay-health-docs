---
id: idempotency
title: Idempotency and retries
sidebar_label: Idempotency and retries
---

# Idempotency and retries

A referral creates a clinical obligation. Creating the same one twice is not a tidy-up
problem, it puts a patient on a waiting list twice, and a clinician may review and accept
both.

This page explains the failure that causes duplicates, and how the API prevents it.

## The problem

Your integration submits a referral:

```
POST /v1/referrals
```

The request takes thirty seconds. Then the connection drops.

```
Your system                          Relay Health API
     │                                      │
     │ POST /v1/referrals ─────────────────►│
     │                                      │ referral created
     │                                      │ REF-3382
     │ ◄──────── X timeout ─────────────────┤
     │                                      │
     │ Did that work?                       │
```

You do not know whether the referral exists. Three things could have happened:

- The request never arrived. No referral was created.
- The request arrived and was processed. The referral exists; the response was lost.
- The request arrived and failed partway through.

From your side all three look identical.

**Retrying is not safe.** If the first request succeeded, a retry creates a second
referral for the same patient and the same problem. **Not retrying is not safe either.** If
the first request never arrived, the patient is waiting for care that was never requested.

:::warning You cannot resolve this by checking first
Querying `GET /v1/referrals` before retrying narrows the window but does not close it. The
first request may still be in flight, and land after your check. Two requests, one check,
no ordering guarantee.
:::

---

## The solution: an idempotency key

Send a unique key with every write. The API uses it to recognise a repeat of a request it
has already handled.

```bash
curl -X POST https://api.relayhealth.example/v1/referrals \
  -H "Authorization: Bearer $RELAY_TOKEN" \
  -H "Idempotency-Key: 8f14e45f-ea1b-4a2c-9c1f-7b3d0e5a2c81" \
  -H "X-Acting-Practitioner: PRACT-8831" \
  -H "Content-Type: application/json" \
  -d '{ ... }'
```

On the first request, the API processes it normally and stores the result against the key.

On any repeat with the same key, the API returns **the original response**. It does not
create a second referral.

```
First request                        Repeat with same key
     │                                      │
     ├─► 201 Created                        ├─► 201 Created
     │   REF-3382                           │   REF-3382
     │   (referral created)                 │   (nothing created)
```

The retry is now safe. Send it as many times as you need; exactly one referral exists.

---

## Generating keys

A key must be **unique per logical operation**, not per HTTP request.

| Do | Don't |
|---|---|
| Generate a UUID when you decide to create the referral | Generate one inside the retry loop |
| Store it alongside the pending referral in your database | Use a timestamp |
| Reuse the same key for every retry of that referral | Reuse a key across different referrals |

```
User clicks "Refer patient"
        ↓
Generate key: 8f14e45f-ea1b-...      ← once, here
        ↓
Store: pending referral + key
        ↓
POST (attempt 1) → timeout           ← same key
POST (attempt 2) → timeout           ← same key
POST (attempt 3) → 201 Created       ← same key
```

If you generate a new key inside the loop, every attempt looks like a new referral and you
are back to the original problem.

:::note Keys are scoped to your organisation
Another organisation using the same UUID does not collide with yours. Keys are namespaced
by the authenticated client.
:::

**Keys are retained for 24 hours.** After that the key is forgotten and the same value
would be treated as a new request. A retry loop should not run for 24 hours; if you are
still failing after that, escalate rather than retry.

---

## Same key, different body

Reusing a key with a different payload is a bug, and the API says so rather than guessing.

**409 Conflict**

```json
{
  "error": {
    "code": "IDEMPOTENCY_KEY_REUSED",
    "message": "This Idempotency-Key was used with a different request body.",
    "original_referral_id": "REF-3382"
  }
}
```

This usually means a key got reused across two different referrals, or a payload was
modified between retries. The API will not silently pick one. Generate a new key for the
new referral.

---

## What is idempotent without a key

Safe to repeat by their nature, no key required:

| Operation | Why |
|---|---|
| `GET` anything | Reads change nothing. |
| `POST /v1/referrals/{id}/cancel` | Cancelling a cancelled referral is a no-op. |
| Webhook delivery | See below. |

Every `POST` that creates a resource requires a key: referrals, patients, documents,
appointments.

---

## Webhooks are at-least-once

Idempotency runs in both directions. The API's delivery guarantee is at-least-once, which
means **the same event may arrive more than once**.

```json
{
  "event_id": "EVT-71004",
  "type": "referral.accepted",
  "created_at": "2026-09-19T09:16:31Z",
  "data": { "referral_id": "REF-3382", "status": "ACCEPTED" }
}
```

Treat `event_id` as a deduplication key. Record the ones you have processed, and discard
repeats.

```
Receive event
     ↓
Seen this event_id before? ──► yes ──► 200 OK, do nothing
     ↓ no
Process it
     ↓
Record event_id
     ↓
200 OK
```

Return `200` for a duplicate. Returning an error makes the API retry, which delivers it
again.

:::warning Events can arrive out of order
A retried `referral.accepted` can land after `appointment.confirmed`. Do not infer state
from the order events arrive in. The referral's own `status` field is the source of truth
— when in doubt, fetch the referral.
:::

---

## Retry schedule

When the API retries a webhook, it backs off:

| Attempt | Delay | Cumulative |
|---|---|---|
| 1 | immediate | 0s |
| 2 | 10s | 10s |
| 3 | 1m | ~1m |
| 4 | 10m | ~11m |
| 5 | 1h | ~1h |
| 6 | 6h | ~7h |
| 7 (final) | 18h | ~25h |

After the final attempt the event is marked undelivered and surfaced in your integration
dashboard. It is not delivered again.

For your own retries against the API, use the same shape: a couple of immediate attempts,
then exponential back-off with jitter. Retrying a timeout in a tight loop turns one failure
into a rate limit.

---

## Related

- [Handling failed referrals](../guides/handling-failed-referrals.md), recovering when
  you do not know a referral's state
- [Verifying webhook signatures](../guides/verifying-webhooks.md), confirming a delivery
  is genuine before you process it
- [Referrals](../reference/referrals.md), the create endpoint and its errors