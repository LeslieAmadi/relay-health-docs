---
id: errors
title: Error reference
sidebar_label: Error reference
---

# Error reference

Every error the API returns, what caused it, and whether retrying will help.

## Error format

All errors share one shape.

```json
{
  "error": {
    "code": "PATIENT_MATCH_CONFLICT",
    "message": "The supplied patient information matches multiple existing records.",
    "field": null,
    "request_id": "req_7Hx2kQ9mPz"
  }
}
```

| Field | Description |
|---|---|
| `code` | Stable, machine-readable. Branch on this, never on `message`. |
| `message` | Human-readable. May change wording between releases. |
| `field` | The request field at fault, where one applies. Otherwise `null`. |
| `request_id` | Quote this when contacting support. It locates the request in our logs. |

:::note Branch on the code
`code` values are part of the API contract and will not change within a major version.
`message` text is for people and may be reworded at any time.
:::

---

## Should I retry?

The most useful column below is **Retry**. Getting it wrong in either direction causes
harm: retrying a permanent error wastes effort and can trigger rate limits, and giving up
on a transient one leaves a patient without a referral.

| Retry | Meaning |
|---|---|
| **Yes** | Transient. Retry with back-off, reusing the same `Idempotency-Key`. |
| **After fix** | Your request is wrong. Correct it, then send it as a new request. |
| **No** | Retrying cannot succeed. Needs a different action or a person. |

---

## 400 Bad Request

| Code | Cause | Retry |
|---|---|---|
| `INVALID_REQUEST` | Malformed JSON, or a parameter of the wrong type. | After fix |
| `INVALID_DATE_FORMAT` | A date is not ISO 8601. Send `2026-09-19T09:15:44Z`. | After fix |
| `UNKNOWN_FIELD` | The body contains a field the API does not recognise. Usually a typo. | After fix |

## 401 Unauthorized

| Code | Cause | Retry |
|---|---|---|
| `TOKEN_MISSING` | No `Authorization` header. | After fix |
| `TOKEN_INVALID` | The token is malformed or was not issued by us. | After fix |
| `TOKEN_EXPIRED` | Tokens last one hour. Request a new one; do not retry the old one. | After fix |

## 403 Forbidden

A `403` means the API knows who you are and has decided you may not do this. It is never
fixed by retrying.

| Code | Cause | Retry |
|---|---|---|
| `SCOPE_INSUFFICIENT` | Your token lacks the scope this operation needs, for example `referral.write`. | No |
| `PRACTITIONER_NOT_AUTHORISED` | The `X-Acting-Practitioner` is not registered to act for your organisation. | No |
| `ACCESS_DENIED` | You may not access this patient or referral. | No |
| `DATA_SCOPE_EXCEEDED` | You requested clinical information outside the purpose of the referral. | After fix |
| `CONSENT_REQUIRED` | No consent or permitted basis covers this disclosure. | No |
| `CONSENT_EXPIRED` | The consent that covered this disclosure has lapsed. | No |
| `BREAK_GLASS_JUSTIFICATION_REQUIRED` | Emergency access was requested without a reason. | After fix |

:::warning A valid token is not access to a record
`SCOPE_INSUFFICIENT` and `ACCESS_DENIED` are different failures. The first means your
integration is not provisioned for an operation at all. The second means it is, but not
for this patient. See [The consent model](../concepts/consent-model.md).
:::

## 404 Not Found

| Code | Cause | Retry |
|---|---|---|
| `PATIENT_NOT_FOUND` | No patient with that `patient_id`. Register them first. | After fix |
| `REFERRAL_NOT_FOUND` | No referral with that `referral_id`, or not one your organisation can see. | No |
| `FACILITY_NOT_FOUND` | No facility with that `receiving_facility_id`. | After fix |
| `DOCUMENT_NOT_FOUND` | No document with that `document_id`. | No |

`REFERRAL_NOT_FOUND` is returned both when a referral does not exist and when it belongs
to another organisation. The API does not confirm that a referral exists to someone who
may not see it.

## 409 Conflict

A `409` means the request was valid but conflicts with the current state of something.

| Code | Cause | Retry |
|---|---|---|
| `PATIENT_MATCH_CONFLICT` | Your patient details match more than one existing record. The API will not choose. | No |
| `REFERRAL_STATE_CONFLICT` | The operation is not valid from the referral's current status. | No |
| `SLOT_UNAVAILABLE` | The slot was taken between your availability check and your booking. | After fix |
| `IDEMPOTENCY_KEY_REUSED` | This key was used before with a different request body. | After fix |

**`PATIENT_MATCH_CONFLICT`** needs a person. Attaching clinical information to the wrong
patient is a patient-safety event, so the API refuses to guess. See
[Matching patients across facilities](../guides/matching-patients.md).

**`SLOT_UNAVAILABLE`** is expected under normal load. Two referring hospitals can see the
same free slot; only one can book it. Fetch availability again and choose another.

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

## 422 Unprocessable Entity

The request is well-formed, but its content does not make clinical or business sense.

| Code | Cause | Retry |
|---|---|---|
| `CLINICAL_SUMMARY_INCOMPLETE` | A required clinical field is missing. | After fix |
| `PATIENT_DATA_INCOMPLETE` | The patient record lacks information needed for this referral. | After fix |
| `SPECIALTY_NOT_OFFERED` | The receiving facility does not offer the requested specialty. | No |
| `URGENCY_INVALID` | `urgency` must be `routine` or `urgent`. There is no emergency value. | After fix |

`URGENCY_INVALID` exists deliberately. This API is not an emergency pathway, and there is
no `emergency` value to send. Emergencies follow the hospitals' clinical pathways.

## 429 Too Many Requests

| Code | Cause | Retry |
|---|---|---|
| `RATE_LIMITED` | Too many requests. | Yes |

Wait for the number of seconds in the `Retry-After` header before retrying.

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 30
```

## 5xx Server errors

| HTTP | Code | Cause | Retry |
|---|---|---|---|
| 500 | `INTERNAL_ERROR` | Something failed on our side. | Yes |
| 502 | `UPSTREAM_UNAVAILABLE` | The receiving hospital's system is unreachable. | Yes |
| 503 | `SERVICE_UNAVAILABLE` | Planned maintenance or overload. | Yes |

For every 5xx, retry with exponential back-off and **the same `Idempotency-Key`**. A 5xx
does not tell you whether the operation happened. The key makes the retry safe either way.
See [Idempotency and retries](../concepts/idempotency.md).

---

## Things that are not errors

Several outcomes feel like failures but arrive as normal responses or webhook events,
because they are decisions rather than faults.

| Outcome | How it arrives | Why it is not an error |
|---|---|---|
| Referral rejected | `referral.rejected` webhook | A clinician declined the referral. That is a clinical decision. |
| No capacity | Rejection with reason `capacity` | The request was valid; the hospital cannot take it. |
| Appointment cancelled | `appointment.cancelled` webhook | The schedule changed after booking. |
| Timeout | No response at all | Nothing came back. Retry with the same key. |

A timeout is the most dangerous item here, because it returns nothing to branch on. You do
not know whether your request succeeded. Always retry a timed-out write with the same
`Idempotency-Key`.

---

## Related

- [Idempotency and retries](../concepts/idempotency.md): retrying safely
- [Handling failed referrals](../guides/handling-failed-referrals.md): rejection and
  recovery
- [Referrals](./referrals.md): errors specific to the referral endpoints