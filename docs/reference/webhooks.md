---
id: webhooks
title: Webhook events
sidebar_label: Webhook events
---

# Webhook events

Clinical review happens on the receiving hospital's schedule, not yours. Webhooks tell you
when a referral moves, so you do not have to ask.

| | |
|---|---|
| Base path | `/v1/webhooks` |
| Scopes | `webhook.manage` |
| Delivery | At-least-once, signed, with retries |

:::warning Do not poll instead
Polling a referral every few minutes to see whether it has been accepted will hit
`RATE_LIMITED` long before it tells you anything useful. Review takes hours or days.
Subscribe, then wait.
:::

---

## Register an endpoint

```
POST /v1/webhooks
```

```bash
curl -X POST https://api.relayhealth.example/v1/webhooks \
  -H "Authorization: Bearer $RELAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://integration.your-hospital.example/relay",
    "events": [
      "referral.accepted",
      "referral.rejected",
      "appointment.confirmed",
      "appointment.cancelled"
    ]
  }'
```

**201 Created**

```json
{
  "webhook_id": "WHK-2201",
  "url": "https://integration.your-hospital.example/relay",
  "events": ["referral.accepted", "referral.rejected", "appointment.confirmed", "appointment.cancelled"],
  "signing_secret": "whsec_8Kd2pQ...",
  "status": "active",
  "created_at": "2026-09-19T09:16:02Z"
}
```

**Store `signing_secret` now.** It is returned once and never again. If you lose it, rotate
it, which invalidates the old one.

Your endpoint must be HTTPS. Plain HTTP is rejected.

---

## The event envelope

Every event has the same outer shape. Only `data` differs by event type.

```json
{
  "event_id": "EVT-71004",
  "type": "referral.accepted",
  "created_at": "2026-09-19T09:16:31Z",
  "api_version": "v1",
  "data": {
    "referral_id": "REF-3382",
    "status": "ACCEPTED",
    "accepted_at": "2026-09-19T09:16:31Z"
  }
}
```

| Field | Description |
|---|---|
| `event_id` | Unique per event. Use it to deduplicate. |
| `type` | What happened. Branch on this. |
| `created_at` | When the event occurred, not when it was delivered. |
| `api_version` | The version the payload is shaped for. |
| `data` | Type-specific payload. Always includes `referral_id`. |

:::note Payloads are deliberately thin
Events tell you what changed and give you an identifier. They do not carry clinical data.
Fetch the referral if you need detail, so that the read is authorised and audited. A
webhook endpoint is a URL; a clinical record should not arrive at one unasked.
:::

---

## Event types

### Referral events

| Type | When | Key `data` fields |
|---|---|---|
| `referral.created` | The referral was accepted into the queue | `referral_id`, `status` |
| `referral.under_review` | A clinician has started assessing it | `referral_id`, `status` |
| `referral.accepted` | Care accepted; scheduling can begin | `referral_id`, `accepted_at` |
| `referral.rejected` | Care declined, with a reason | `referral_id`, `rejection` |
| `referral.cancelled` | Withdrawn by either party | `referral_id`, `cancelled_by`, `reason` |

**`referral.rejected`** carries the rejection object:

```json
{
  "event_id": "EVT-71022",
  "type": "referral.rejected",
  "created_at": "2026-09-19T15:40:02Z",
  "api_version": "v1",
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

Handle each `reason` differently. See
[Handling failed referrals](../guides/handling-failed-referrals.md).

### Appointment events

| Type | When | Key `data` fields |
|---|---|---|
| `appointment.confirmed` | A slot has been booked | `appointment_id`, `scheduled_start`, `scheduled_end` |
| `appointment.rescheduled` | The time changed | `appointment_id`, `previous_start`, `scheduled_start` |
| `appointment.cancelled` | The appointment was cancelled | `appointment_id`, `cancelled_by`, `reason` |

### Procedure events

| Type | When | Key `data` fields |
|---|---|---|
| `procedure.completed` | The procedure took place | `procedure_id`, `performed_at` |
| `procedure.cancelled` | Cancelled before taking place | `procedure_id`, `reason` |

### Patient events

| Type | When | Key `data` fields |
|---|---|---|
| `patient.merged` | Two records were determined to be one person | `patient_id`, `merged_patient_id` |

`patient.merged` matters more than it looks. If a `patient_id` you hold has been merged
into another, update your records. Requests using the retired identifier still resolve, but
responses return the surviving `patient_id`.

---

## Delivery guarantees

**At-least-once.** The same event may arrive more than once. This is not a defect. A
delivery that succeeded but whose acknowledgement was lost will be retried.

**Not ordered.** A retried `referral.accepted` can land after `appointment.confirmed`. Do
not infer state from arrival order.

**The resource is the source of truth.** If an event sequence looks wrong, fetch the
referral. Its `status` is authoritative.

### Deduplicate on `event_id`

```
Receive event
     ↓
Seen this event_id? ──► yes ──► return 200, do nothing
     ↓ no
Process it
     ↓
Record event_id
     ↓
return 200
```

Return `200` for a duplicate. Returning an error makes the API retry, which delivers it
again.

### Respond fast

Acknowledge with `200` as soon as you have stored the event. Do the work afterwards, on a
queue. If your endpoint takes longer than **10 seconds**, the delivery is treated as failed
and retried, and you will process the same event repeatedly.

### Retry schedule

| Attempt | Delay | Cumulative |
|---|---|---|
| 1 | immediate | 0s |
| 2 | 10s | 10s |
| 3 | 1m | ~1m |
| 4 | 10m | ~11m |
| 5 | 1h | ~1h |
| 6 | 6h | ~7h |
| 7 (final) | 18h | ~25h |

Any `2xx` counts as delivered. Anything else, including a timeout, is retried. After the
final attempt the event is marked undelivered and surfaced in your integration dashboard.
It is not delivered again.

An endpoint that fails every delivery for 72 hours is set to `paused`, and you are
notified. Reactivate it once the endpoint is healthy.

---

## Verifying a delivery

Every request carries a signature header. Verify it before you trust the payload.

```http
POST /relay HTTP/1.1
Content-Type: application/json
Relay-Signature: t=1758274591,v1=5d41402abc4b2a76b9719d911017c592...
```

Never process an event whose signature you have not verified. Anyone can POST JSON to your
endpoint. See [Verifying webhook signatures](../guides/verifying-webhooks.md).

---

## Managing endpoints

| Operation | Endpoint |
|---|---|
| List endpoints | `GET /v1/webhooks` |
| Retrieve one | `GET /v1/webhooks/{webhook_id}` |
| Update URL or events | `PATCH /v1/webhooks/{webhook_id}` |
| Rotate the secret | `POST /v1/webhooks/{webhook_id}/rotate-secret` |
| Delete | `DELETE /v1/webhooks/{webhook_id}` |

Rotating returns a new `signing_secret` and invalidates the old one immediately. Deploy the
new secret before rotating, not after.

### Replaying events

```
POST /v1/webhooks/{webhook_id}/replay
```

```json
{ "event_ids": ["EVT-71004", "EVT-71009"] }
```

Redelivers specific events, for when your endpoint was down longer than the retry window.
Replayed events keep their original `event_id`, so your deduplication will correctly skip
any you already processed.

---

## Errors

| HTTP | `code` | Meaning |
|---|---|---|
| 400 | `WEBHOOK_URL_INVALID` | Not a valid HTTPS URL. |
| 400 | `WEBHOOK_EVENT_UNKNOWN` | An event type in `events` does not exist. |
| 403 | `SCOPE_INSUFFICIENT` | Token lacks `webhook.manage`. |
| 404 | `WEBHOOK_NOT_FOUND` | No endpoint with that `webhook_id`. |
| 409 | `WEBHOOK_URL_DUPLICATE` | An active endpoint already uses this URL. |

---

## Related

- [Verifying webhook signatures](../guides/verifying-webhooks.md): validating a delivery
- [Idempotency and retries](../concepts/idempotency.md): why duplicates are expected
- [Handling failed referrals](../guides/handling-failed-referrals.md): acting on
  `referral.rejected`
- [Referrals](./referrals.md): the lifecycle these events describe