---
id: referrals
title: Referrals
sidebar_label: Referrals
---

# Referrals

A referral is a request to transfer a patient's surgical care from a referring facility to
this hospital. It is the central resource: appointments and procedures are created only
after a referral is accepted.

| | |
|---|---|
| Base path | `/v1/referrals` |
| Scopes | `referral.read`, `referral.write` |
| Practitioner context | Required on write operations |

---

## The referral lifecycle

A referral moves through states as the receiving hospital reviews and schedules it. Your
integration reacts to those changes; it does not drive them.

```
PENDING ──→ UNDER_REVIEW ──→ ACCEPTED ──→ SCHEDULING ──→ SCHEDULED ──→ COMPLETED
   │              │              │                            │
   │              ↓              │                            │
   │          REJECTED           │                            │
   │                             │                            │
   └──────── CANCELLED ←─────────┴────────────────────────────┘
```

| Status | Meaning | Set by |
|---|---|---|
| `PENDING` | Submitted, not yet picked up for review | Created on submission |
| `UNDER_REVIEW` | A clinician is assessing the referral | Receiving hospital |
| `ACCEPTED` | Care accepted; scheduling can begin | Receiving hospital |
| `REJECTED` | Care declined, with a reason | Receiving hospital |
| `SCHEDULING` | Accepted, awaiting a suitable slot | Receiving hospital |
| `SCHEDULED` | An appointment and procedure exist | Receiving hospital |
| `COMPLETED` | The procedure took place | Receiving hospital |
| `CANCELLED` | Withdrawn before completion | Either party |

:::note Only two transitions are yours
You can cancel a referral, and you can update one that is still `PENDING`. Everything else
is the receiving hospital's decision. Do not poll for changes — subscribe to
[webhook events](./webhooks.md).
:::

---

## The referral object

| Field | Type | Description |
|---|---|---|
| `referral_id` | string | Assigned by the API. Format `REF-nnnn`. |
| `patient_id` | string | The API's patient identifier. See [Patients](./patients.md). |
| `referring_facility_id` | string | Your organisation. Derived from the access token. |
| `receiving_facility_id` | string | The facility the referral is addressed to. |
| `referring_practitioner_id` | string | The clinician who made the referral. |
| `status` | enum | See the lifecycle above. |
| `urgency` | enum | `routine` or `urgent`. |
| `reason` | string | Free text. Why this patient needs surgical care. |
| `requested_specialty` | string | For example `general-surgery`. |
| `requested_procedure` | string | Optional. The procedure being requested. |
| `clinical_summary` | object | Minimum necessary clinical information. See below. |
| `appointment` | object | Present once `SCHEDULED`. See [Appointments](./appointments.md). |
| `procedure` | object | Present once scheduled. |
| `rejection` | object | Present only when `REJECTED`. |
| `created_at` | string | ISO 8601, UTC. |
| `accepted_at` | string | ISO 8601. Null until accepted. |
| `updated_at` | string | ISO 8601. |

### The clinical summary

Structured clinical information travelling with the referral. Send what the receiving
clinician needs to assess and safely treat this patient, and nothing else.

| Field | Type | Description |
|---|---|---|
| `diagnoses` | array of strings | Relevant diagnoses. |
| `allergies` | array of strings | Known allergies, particularly to anaesthetic agents and antibiotics. |
| `medications` | array of strings | Current medications, with dose and frequency. |
| `previous_procedures` | array of strings | Relevant surgical history. |
| `notes` | string | Optional free text. |

Reports, imaging and letters are attached separately as documents rather than embedded
here.

:::warning Send the minimum necessary
The receiving hospital does not need the patient's whole record. Sending unrelated
clinical history is not a convenience, it is an over-disclosure. The purpose of the
referral defines the scope of what may be shared. See
[The consent model](../concepts/consent-model.md).
:::

---

## Create a referral

```
POST /v1/referrals
```

**Required headers**

| Header | Description |
|---|---|
| `Authorization` | `Bearer` token with `referral.write` |
| `Idempotency-Key` | A unique value per logical referral. See [Idempotency](../concepts/idempotency.md). |
| `X-Acting-Practitioner` | The referring clinician's identifier |

**Body**

| Field | Required | Description |
|---|---|---|
| `patient_id` | Yes | Must already exist. |
| `receiving_facility_id` | Yes | The facility you are referring to. |
| `requested_specialty` | Yes | |
| `urgency` | Yes | `routine` or `urgent`. |
| `reason` | Yes | |
| `clinical_summary` | Yes | At minimum `diagnoses` and `allergies`. |
| `requested_procedure` | No | |

**Request**

```bash
curl -X POST https://api.relayhealth.example/v1/referrals \
  -H "Authorization: Bearer $RELAY_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 8f14e45f-ea1b-4a2c-9c1f-7b3d0e5a2c81" \
  -H "X-Acting-Practitioner: PRACT-8831" \
  -d '{
    "patient_id": "PAT-100029",
    "receiving_facility_id": "FAC-2210",
    "requested_specialty": "general-surgery",
    "requested_procedure": "laparoscopic-cholecystectomy",
    "urgency": "urgent",
    "reason": "Recurrent biliary colic with confirmed cholelithiasis.",
    "clinical_summary": {
      "diagnoses": ["Cholelithiasis"],
      "allergies": ["Penicillin"],
      "medications": ["Omeprazole 20mg once daily"],
      "previous_procedures": []
    }
  }'
```

**201 Created**

```json
{
  "referral_id": "REF-3382",
  "patient_id": "PAT-100029",
  "referring_facility_id": "ORG-102",
  "receiving_facility_id": "FAC-2210",
  "referring_practitioner_id": "PRACT-8831",
  "status": "PENDING",
  "urgency": "urgent",
  "requested_specialty": "general-surgery",
  "requested_procedure": "laparoscopic-cholecystectomy",
  "reason": "Recurrent biliary colic with confirmed cholelithiasis.",
  "created_at": "2026-09-19T09:15:44Z",
  "accepted_at": null,
  "updated_at": "2026-09-19T09:15:44Z"
}
```

**422 Unprocessable Entity**

```json
{
  "error": {
    "code": "CLINICAL_SUMMARY_INCOMPLETE",
    "message": "clinical_summary.allergies is required. Send an empty array if none are known.",
    "field": "clinical_summary.allergies"
  }
}
```

An empty array and an absent field mean different things. An empty `allergies` array means
no known allergies were recorded. An absent one means nobody checked. The API will not let
you conflate the two.

:::note urgent is not emergency
`urgent` prioritises clinical review. It does not mean immediate. This API is not an
emergency pathway — a life-threatening case cannot wait for another organisation to review
a referral asynchronously. Use your established emergency clinical pathways.
:::

---

## Retrieve a referral

```
GET /v1/referrals/{referral_id}
```

```bash
curl https://api.relayhealth.example/v1/referrals/REF-3382 \
  -H "Authorization: Bearer $RELAY_TOKEN" \
  -H "X-Acting-Practitioner: PRACT-8831"
```

**200 OK**

```json
{
  "referral_id": "REF-3382",
  "patient_id": "PAT-100029",
  "status": "SCHEDULED",
  "urgency": "urgent",
  "accepted_at": "2026-09-19T11:02:18Z",
  "appointment": {
    "appointment_id": "APT-4417",
    "scheduled_start": "2026-10-02T08:30:00Z",
    "scheduled_end": "2026-10-02T10:00:00Z",
    "practitioner_id": "PRACT-2204",
    "facility_id": "FAC-2210"
  },
  "procedure": {
    "procedure_id": "PRC-9002",
    "procedure_type": "laparoscopic-cholecystectomy",
    "status": "scheduled"
  },
  "updated_at": "2026-09-19T11:04:55Z"
}
```

Retrieving a referral is a read of clinical information and generates an audit event
naming the practitioner, the organisation and the purpose. See
[The audit trail](../concepts/audit-trail.md).

---

## List referrals

```
GET /v1/referrals
```

Returns referrals your organisation either sent or received. You never see another
organisation's referrals.

| Parameter | Type | Description |
|---|---|---|
| `status` | string | Filter by status. Repeatable. |
| `urgency` | string | `routine` or `urgent`. |
| `patient_id` | string | Referrals for one patient. |
| `created_after` | string | ISO 8601. |
| `created_before` | string | ISO 8601. |
| `page` | integer | Defaults to 1. |
| `limit` | integer | Defaults to 25, maximum 100. |

```bash
curl "https://api.relayhealth.example/v1/referrals?status=PENDING&urgency=urgent&limit=25" \
  -H "Authorization: Bearer $RELAY_TOKEN" \
  -H "X-Acting-Practitioner: PRACT-8831"
```

**200 OK**

```json
{
  "data": [
    {
      "referral_id": "REF-3382",
      "patient_id": "PAT-100029",
      "status": "PENDING",
      "urgency": "urgent",
      "requested_specialty": "general-surgery",
      "created_at": "2026-09-19T09:15:44Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 25,
    "total": 1
  }
}
```

List responses omit `clinical_summary`. Clinical detail is returned only when you retrieve
a single referral, so that a broad list query cannot be used to sweep clinical data.

---

## Cancel a referral

```
POST /v1/referrals/{referral_id}/cancel
```

Available while the referral is `PENDING`, `UNDER_REVIEW`, `ACCEPTED` or `SCHEDULED`. A
`COMPLETED` referral cannot be cancelled.

```bash
curl -X POST https://api.relayhealth.example/v1/referrals/REF-3382/cancel \
  -H "Authorization: Bearer $RELAY_TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-Acting-Practitioner: PRACT-8831" \
  -d '{ "reason": "Patient treated locally; referral no longer required." }'
```

**200 OK**

```json
{
  "referral_id": "REF-3382",
  "status": "CANCELLED",
  "cancelled_at": "2026-09-20T14:22:09Z",
  "cancelled_by": {
    "organization_id": "ORG-102",
    "practitioner_id": "PRACT-8831"
  }
}
```

A cancellation after `SCHEDULED` also releases the appointment slot and sets the procedure
to `cancelled`. Your integration receives `appointment.cancelled`.

---

## Rejection

A rejected referral carries a reason. Rejection is a clinical decision, not an error, so
it arrives as a webhook rather than an error response.

```json
{
  "referral_id": "REF-3382",
  "status": "REJECTED",
  "rejection": {
    "reason": "capacity",
    "message": "No general surgery capacity within the clinically appropriate window.",
    "rejected_at": "2026-09-19T15:40:02Z",
    "suggested_alternative_facility_id": "FAC-2244"
  }
}
```

| `reason` | Meaning |
|---|---|
| `capacity` | No capacity within an appropriate timeframe. |
| `out_of_scope` | The procedure is not offered at this facility. |
| `insufficient_information` | The clinical summary did not support a decision. |
| `patient_unsuitable` | Clinical assessment found the patient unsuitable. |
| `duplicate` | An equivalent referral already exists. |

`insufficient_information` is the only one you resolve by resubmitting. The others require
a different facility or a different clinical decision. See
[Handling failed referrals](../guides/handling-failed-referrals.md).

---

## Errors

| HTTP | `code` | Meaning |
|---|---|---|
| 400 | `INVALID_REQUEST` | Malformed body or parameter. |
| 401 | `TOKEN_INVALID` | Missing, expired or malformed token. |
| 403 | `SCOPE_INSUFFICIENT` | Token lacks `referral.write`. |
| 403 | `PRACTITIONER_NOT_AUTHORISED` | Practitioner is not registered to act for your organisation. |
| 404 | `PATIENT_NOT_FOUND` | No patient with that `patient_id`. |
| 404 | `FACILITY_NOT_FOUND` | No facility with that `receiving_facility_id`. |
| 409 | `REFERRAL_STATE_CONFLICT` | The operation is not valid from the current status. |
| 409 | `IDEMPOTENCY_KEY_REUSED` | Key reused with a different request body. |
| 422 | `CLINICAL_SUMMARY_INCOMPLETE` | Required clinical fields missing. |
| 422 | `SPECIALTY_NOT_OFFERED` | Facility does not offer the requested specialty. |
| 429 | `RATE_LIMITED` | Too many requests. Honour `Retry-After`. |

Full reference: [Error reference](./errors.md).

---

## Related

- [Idempotency and retries](../concepts/idempotency.md) — why every create needs a key
- [Handling failed referrals](../guides/handling-failed-referrals.md) — rejection,
  timeouts and recovery
- [Webhook events](./webhooks.md) — the events a referral emits
- [Patients](./patients.md) — creating and matching patients