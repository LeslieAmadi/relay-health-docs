---
id: quickstart
title: Quickstart
sidebar_label: Quickstart
sidebar_position: 1
---

# Quickstart

Submit a surgical referral and receive a confirmed appointment, in about ten minutes.

You will authenticate, register a patient, submit a referral, attach a clinical document,
and watch the sandbox accept the referral and schedule a procedure. Every request is one
you would make in production.

## Before you start

You need:

- Sandbox client credentials — a `client_id` and `client_secret` from your integration
  dashboard
- A command line with `curl`
- A publicly reachable HTTPS URL to receive webhooks. Any request-inspection service or
  local tunnel works

Everything below runs against the sandbox:

```
https://sandbox.api.relayhealth.example/v1
```

**The sandbox stands in for the receiving hospital.** In production, a clinician reviews
each referral and accepts or rejects it, which takes hours or days. In the sandbox, a
simulated facility accepts any well-formed referral after about five seconds and schedules
it against generated availability. That lets you exercise the whole flow alone.

Once you are through this page, read
[Handling failed referrals](./guides/handling-failed-referrals.md) for the real
asynchronous behaviour, including rejection.

---

## 1. Authenticate

The API uses OAuth 2.0 client credentials. Your integration authenticates as an
organisation, not as a person.

```bash
curl -X POST https://sandbox.api.relayhealth.example/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=$RELAY_CLIENT_ID" \
  -d "client_secret=$RELAY_CLIENT_SECRET" \
  -d "scope=referral.write patient.write"
```

```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIs...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "referral.write patient.write"
}
```

Save the token. It lasts one hour; request a new one rather than retrying a 401.

```bash
export RELAY_TOKEN="eyJhbGciOiJSUzI1NiIs..."
```

:::note Scopes are not permissions
`referral.write` lets your organisation create referrals. It does not grant access to any
particular patient's clinical record. See
[The consent model](./concepts/consent-model.md).
:::

**Check it worked:** the response contains an `access_token` and the `scope` you asked
for. If a scope is missing, your client is not provisioned for it.

---

## 2. Register the patient

A patient's medical record number belongs to the organisation that issued it. Send yours,
and the API returns a `patient_id` of its own that you use from then on.

```bash
curl -X POST https://sandbox.api.relayhealth.example/v1/patients \
  -H "Authorization: Bearer $RELAY_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{
    "identifiers": [
      { "system": "referring-hospital", "value": "REF-48291" }
    ],
    "given_name": "Amara",
    "family_name": "Okonkwo",
    "birth_date": "1979-04-12",
    "sex": "female"
  }'
```

```json
{
  "patient_id": "PAT-100029",
  "identifiers": [
    { "system": "referring-hospital", "value": "REF-48291" }
  ],
  "match": {
    "outcome": "created",
    "confidence": null
  },
  "created_at": "2026-09-19T09:14:02Z"
}
```

`match.outcome` tells you what happened. `created` means no existing record matched.
`matched` means your identifier resolved to a patient the API already held — the
`patient_id` is the same one you had before.

:::warning Ambiguous matches are not resolved for you
If your details match more than one record, the API returns `409 Conflict` with
`PATIENT_MATCH_CONFLICT` rather than guessing. Attaching clinical information to the wrong
patient is a patient-safety event, so the API refuses to choose. See
[Matching patients across facilities](./guides/matching-patients.md).
:::

**Check it worked:** you have a `patient_id` beginning `PAT-`. Keep it.

```bash
export PATIENT_ID="PAT-100029"
```

---

## 3. Submit the referral

The referral is the central resource. It says: this patient needs surgical care you can
provide, and here is why.

```bash
curl -X POST https://sandbox.api.relayhealth.example/v1/referrals \
  -H "Authorization: Bearer $RELAY_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "X-Acting-Practitioner: PRACT-8831" \
  -d '{
    "patient_id": "'"$PATIENT_ID"'",
    "receiving_facility_id": "FAC-SANDBOX-001",
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

```json
{
  "referral_id": "REF-3382",
  "patient_id": "PAT-100029",
  "referring_facility_id": "ORG-102",
  "receiving_facility_id": "FAC-SANDBOX-001",
  "status": "PENDING",
  "urgency": "urgent",
  "created_at": "2026-09-19T09:15:44Z"
}
```

**Two headers matter here.**

`Idempotency-Key` protects you from duplicate referrals. If the request times out and you
retry with the same key, you get the original referral back rather than a second one. See
[Idempotency and retries](./concepts/idempotency.md).

`X-Acting-Practitioner` names the clinician making the referral. Your OAuth client
identifies the organisation; this identifies the person, so the audit trail can record
both. The API verifies the practitioner is authorised to act for your organisation.

:::note urgent is not emergency
`urgent` means clinical review should be prioritised. It does not mean immediate. This API
is not an emergency pathway — a life-threatening case cannot wait for another organisation
to review a referral. Use your established emergency clinical pathways instead.
:::

**Check it worked:** `status` is `PENDING` and you have a `referral_id`.

```bash
export REFERRAL_ID="REF-3382"
```

---

## 4. Attach a clinical document

Structured fields carry the summary. Reports, imaging and letters are attached as
documents.

```bash
curl -X POST https://sandbox.api.relayhealth.example/v1/documents \
  -H "Authorization: Bearer $RELAY_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "X-Acting-Practitioner: PRACT-8831" \
  -d '{
    "patient_id": "'"$PATIENT_ID"'",
    "referral_id": "'"$REFERRAL_ID"'",
    "document_type": "imaging-report",
    "title": "Abdominal ultrasound",
    "mime_type": "application/pdf",
    "content_base64": "JVBERi0xLjQKJ..."
  }'
```

```json
{
  "document_id": "DOC-55190",
  "referral_id": "REF-3382",
  "document_type": "imaging-report",
  "status": "available",
  "created_at": "2026-09-19T09:16:20Z"
}
```

**Check it worked:** `status` is `available` and `referral_id` matches yours.

---

## 5. Register a webhook, then wait

The receiving hospital reviews referrals on its own schedule. Do not poll.

```bash
curl -X POST https://sandbox.api.relayhealth.example/v1/webhooks \
  -H "Authorization: Bearer $RELAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-endpoint.example/relay",
    "events": [
      "referral.accepted",
      "referral.rejected",
      "appointment.confirmed"
    ]
  }'
```

```json
{
  "webhook_id": "WHK-2201",
  "url": "https://your-endpoint.example/relay",
  "events": ["referral.accepted", "referral.rejected", "appointment.confirmed"],
  "signing_secret": "whsec_8Kd...",
  "status": "active"
}
```

Store `signing_secret` now — it is shown once. You need it to verify that deliveries came
from the API. See [Verifying webhook signatures](./guides/verifying-webhooks.md).

Within about five seconds the sandbox accepts the referral and delivers:

```json
{
  "event_id": "EVT-71004",
  "type": "referral.accepted",
  "created_at": "2026-09-19T09:16:31Z",
  "data": {
    "referral_id": "REF-3382",
    "status": "ACCEPTED",
    "accepted_at": "2026-09-19T09:16:31Z"
  }
}
```

Then, once a slot is assigned:

```json
{
  "event_id": "EVT-71009",
  "type": "appointment.confirmed",
  "created_at": "2026-09-19T09:16:38Z",
  "data": {
    "referral_id": "REF-3382",
    "appointment_id": "APT-4417",
    "slot_id": "SLOT-1029",
    "scheduled_start": "2026-10-02T08:30:00Z",
    "scheduled_end": "2026-10-02T10:00:00Z"
  }
}
```

:::warning Deliveries can repeat
Webhook delivery is at-least-once. The same `event_id` may arrive more than once, and
events may arrive out of order. Treat `event_id` as a deduplication key and let the
referral's own `status` be the source of truth.
:::

**Check it worked:** you received `referral.accepted` followed by `appointment.confirmed`.

---

## 6. Confirm the scheduled procedure

Fetch the referral to see where it ended up.

```bash
curl https://sandbox.api.relayhealth.example/v1/referrals/$REFERRAL_ID \
  -H "Authorization: Bearer $RELAY_TOKEN" \
  -H "X-Acting-Practitioner: PRACT-8831"
```

```json
{
  "referral_id": "REF-3382",
  "patient_id": "PAT-100029",
  "status": "SCHEDULED",
  "urgency": "urgent",
  "accepted_at": "2026-09-19T09:16:31Z",
  "appointment": {
    "appointment_id": "APT-4417",
    "scheduled_start": "2026-10-02T08:30:00Z",
    "scheduled_end": "2026-10-02T10:00:00Z",
    "practitioner_id": "PRACT-2204",
    "facility_id": "FAC-SANDBOX-001"
  },
  "procedure": {
    "procedure_id": "PRC-9002",
    "procedure_type": "laparoscopic-cholecystectomy",
    "status": "scheduled"
  }
}
```

That is the full path: `PENDING → UNDER_REVIEW → ACCEPTED → SCHEDULING → SCHEDULED`.

Every request you made left an audit event recording the practitioner, the organisation,
the patient, the action and the reason. Retrieve them with `GET /v1/audit-events`.

---

## What next

- [Handling failed referrals](./guides/handling-failed-referrals.md) — rejection,
  timeouts, and what to do when you do not know whether a referral was created
- [Verifying webhook signatures](./guides/verifying-webhooks.md) — validating deliveries
  and handling duplicates
- [Matching patients across facilities](./guides/matching-patients.md) — resolving a
  `PATIENT_MATCH_CONFLICT`
- [The consent model](./concepts/consent-model.md) — why a valid token is not access to a
  record
- [Referrals reference](./reference/referrals.md) — every field, status and error
