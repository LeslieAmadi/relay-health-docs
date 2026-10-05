---
id: appointments
title: Appointments
sidebar_label: Appointments
---

# Appointments

An appointment is a scheduled clinical encounter at the receiving hospital. It exists only
after a referral has been accepted.

| | |
|---|---|
| Base path | `/v1/appointments`, `/v1/availability` |
| Scopes | `appointment.read`, `appointment.write` |
| Practitioner context | Required on write operations |

:::note An appointment is not a procedure
The appointment is when the patient attends. The procedure is the treatment performed. One
appointment can carry one procedure, and a procedure can be rescheduled without the
referral changing.
:::

---

## Availability

Availability is separate from booking. You read what is free, then you book one of them.
Those are two requests, and the gap between them is where contention happens.

```
GET /v1/availability
```

| Parameter | Required | Description |
|---|---|---|
| `facility_id` | Yes | The facility to check. |
| `procedure_type` | No | Narrow to slots suitable for this procedure. |
| `from` | No | ISO 8601. Defaults to now. |
| `to` | No | ISO 8601. Defaults to 90 days ahead. |

```bash
curl "https://api.relayhealth.example/v1/availability?facility_id=FAC-2210&procedure_type=laparoscopic-cholecystectomy&from=2026-10-01T00:00:00Z" \
  -H "Authorization: Bearer $RELAY_TOKEN" \
  -H "X-Acting-Practitioner: PRACT-8831"
```

**200 OK**

```json
{
  "data": [
    {
      "slot_id": "SLOT-1029",
      "facility_id": "FAC-2210",
      "practitioner_id": "PRACT-2204",
      "procedure_type": "laparoscopic-cholecystectomy",
      "start_time": "2026-10-02T08:30:00Z",
      "end_time": "2026-10-02T10:00:00Z",
      "status": "available"
    }
  ],
  "pagination": { "page": 1, "limit": 25, "total": 1 }
}
```

:::warning Availability is a snapshot, not a reservation
A slot returned here is free at the moment of the response. Reading it does not hold it.
Another hospital can book the same slot a second later.
:::

---

## The appointment object

| Field | Type | Description |
|---|---|---|
| `appointment_id` | string | Assigned by the API. Format `APT-nnnn`. |
| `referral_id` | string | The accepted referral this appointment serves. |
| `patient_id` | string | |
| `facility_id` | string | Where the patient attends. |
| `practitioner_id` | string | The clinician responsible. |
| `slot_id` | string | The booked slot. |
| `scheduled_start` | string | ISO 8601, UTC. |
| `scheduled_end` | string | ISO 8601, UTC. |
| `status` | enum | `confirmed`, `rescheduled`, `cancelled`, `attended`, `did_not_attend`. |
| `procedure` | object | The procedure to be performed. |
| `created_at` | string | |
| `updated_at` | string | |

All times are UTC. Convert to local time for display, and be careful across the European
daylight-saving boundary: a procedure booked in October for a date in November is an hour
out if you store local time.

---

## Book an appointment

```
POST /v1/appointments
```

The referral must be in `ACCEPTED` or `SCHEDULING`. Booking against a `PENDING` referral
returns `REFERRAL_STATE_CONFLICT`.

```bash
curl -X POST https://api.relayhealth.example/v1/appointments \
  -H "Authorization: Bearer $RELAY_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 6b3f9c20-18a4-4d7e-bb52-9f0c3e71a8d6" \
  -H "X-Acting-Practitioner: PRACT-8831" \
  -d '{
    "referral_id": "REF-3382",
    "slot_id": "SLOT-1029"
  }'
```

**201 Created**

```json
{
  "appointment_id": "APT-4417",
  "referral_id": "REF-3382",
  "patient_id": "PAT-100029",
  "facility_id": "FAC-2210",
  "practitioner_id": "PRACT-2204",
  "slot_id": "SLOT-1029",
  "scheduled_start": "2026-10-02T08:30:00Z",
  "scheduled_end": "2026-10-02T10:00:00Z",
  "status": "confirmed",
  "procedure": {
    "procedure_id": "PRC-9002",
    "procedure_type": "laparoscopic-cholecystectomy",
    "status": "scheduled"
  },
  "created_at": "2026-09-19T11:04:55Z"
}
```

The referral moves to `SCHEDULED` and you receive `appointment.confirmed`.

### When the slot is gone

**409 Conflict**

```json
{
  "error": {
    "code": "SLOT_UNAVAILABLE",
    "message": "SLOT-1029 was booked by another request.",
    "field": "slot_id",
    "request_id": "req_4Nb8wT1eLc"
  }
}
```

This is expected under normal load, not a fault. Two hospitals saw the same free slot and
one of them got there first.

**Recover by re-reading availability and choosing again:**

```
Fetch availability
      ↓
Book a slot ──► 409 SLOT_UNAVAILABLE
      ↓
Fetch availability again        ← do not reuse the stale list
      ↓
Book a different slot ──► 201 Created
```

Do not retry the same `slot_id`. It is taken. Do not reuse your earlier availability
response either, because other slots in it may also have gone.

:::warning Use a new idempotency key for a different slot
A different slot is a different booking, so it needs a new `Idempotency-Key`. Reusing the
key from the failed attempt returns `IDEMPOTENCY_KEY_REUSED`.
:::

---

## Retrieve an appointment

```
GET /v1/appointments/{appointment_id}
```

```bash
curl https://api.relayhealth.example/v1/appointments/APT-4417 \
  -H "Authorization: Bearer $RELAY_TOKEN" \
  -H "X-Acting-Practitioner: PRACT-8831"
```

You can retrieve appointments arising from referrals your organisation sent or received.

---

## List appointments

```
GET /v1/appointments
```

| Parameter | Description |
|---|---|
| `referral_id` | Appointments for one referral. |
| `patient_id` | Appointments for one patient. |
| `status` | Filter by status. Repeatable. |
| `from`, `to` | Scheduled start within a window. |
| `page`, `limit` | Paging. Defaults 1 and 25, maximum 100. |

---

## Reschedule

```
POST /v1/appointments/{appointment_id}/reschedule
```

```bash
curl -X POST https://api.relayhealth.example/v1/appointments/APT-4417/reschedule \
  -H "Authorization: Bearer $RELAY_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: a1d7f5c3-92be-4e08-8c6a-2b4d9e0f3a17" \
  -H "X-Acting-Practitioner: PRACT-8831" \
  -d '{
    "slot_id": "SLOT-1144",
    "reason": "Patient unavailable on the original date."
  }'
```

The `appointment_id` is kept and the slot changes. You receive
`appointment.rescheduled` with both the previous and the new start time, so your systems
can tell the patient what changed.

Rescheduling releases the original slot. It can be booked by someone else immediately.

---

## Cancel

```
POST /v1/appointments/{appointment_id}/cancel
```

```bash
curl -X POST https://api.relayhealth.example/v1/appointments/APT-4417/cancel \
  -H "Authorization: Bearer $RELAY_TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-Acting-Practitioner: PRACT-8831" \
  -d '{ "reason": "Patient treated locally." }'
```

**200 OK**

```json
{
  "appointment_id": "APT-4417",
  "status": "cancelled",
  "cancelled_at": "2026-09-28T10:11:42Z",
  "cancelled_by": { "organization_id": "ORG-102", "practitioner_id": "PRACT-8831" },
  "referral_status": "ACCEPTED"
}
```

Cancelling an appointment does **not** cancel the referral. The referral returns to
`ACCEPTED`, because the patient still needs care. If care is no longer needed, cancel the
referral separately.

That distinction matters. Treating a cancelled appointment as a cancelled referral silently
drops a patient who still requires surgery.

---

## Attendance

Only the receiving hospital can record attendance.

| `status` | Meaning |
|---|---|
| `attended` | The patient attended. |
| `did_not_attend` | The patient did not attend and did not cancel. |

A `did_not_attend` leaves the referral `ACCEPTED`, not completed. The patient still needs
care, and someone has to decide what happens next.

---

## Errors

| HTTP | `code` | Meaning |
|---|---|---|
| 403 | `SCOPE_INSUFFICIENT` | Token lacks `appointment.write`. |
| 404 | `APPOINTMENT_NOT_FOUND` | No such appointment, or not one you can see. |
| 404 | `SLOT_NOT_FOUND` | No slot with that `slot_id`. |
| 409 | `SLOT_UNAVAILABLE` | The slot was taken. |
| 409 | `REFERRAL_STATE_CONFLICT` | The referral is not in a bookable state. |
| 409 | `APPOINTMENT_ALREADY_EXISTS` | This referral already has an active appointment. |
| 422 | `SLOT_PROCEDURE_MISMATCH` | The slot is not suitable for the requested procedure. |

Full list: [Error reference](./errors.md).

---

## Related

- [Referrals](./referrals.md): the referral an appointment serves
- [Webhook events](./webhooks.md): `appointment.confirmed`, `rescheduled`, `cancelled`
- [Idempotency and retries](../concepts/idempotency.md): keys for booking