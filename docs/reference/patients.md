---
id: patients
title: Patients
sidebar_label: Patients
---

# Patients

A patient record holds the identity and demographic information needed to attach a referral
to the right person. It holds no clinical data. Clinical information travels with the
referral that justifies it.

| | |
|---|---|
| Base path | `/v1/patients` |
| Scopes | `patient.read`, `patient.write` |
| Practitioner context | Required on write operations |

---

## Identity belongs to the organisation that issued it

A medical record number is local. The hospital that created it owns it, and it means
nothing outside that hospital's systems. The same person can be:

```
Referring hospital     MRN  REF-48291
Receiving hospital     MRN  SURG-90317
Relay Health API       patient_id  PAT-100029
```

All three identify one human being. None of them is more correct than the others.

The API therefore does not replace your identifier. It stores yours alongside its own and
returns a `patient_id` that is stable within the API. You keep using your MRN internally
and the `patient_id` when you talk to this API.

```json
{
  "patient_id": "PAT-100029",
  "identifiers": [
    { "system": "referring-hospital", "value": "REF-48291" }
  ]
}
```

:::warning Demographics are not identifiers
A name and date of birth can help *match* a patient. They cannot *identify* one. Two people
share a name and birthday more often than intuition suggests, and names change. Never treat
a demographic combination as a unique key.
:::

---

## The patient object

| Field | Type | Description |
|---|---|---|
| `patient_id` | string | Assigned by the API. Format `PAT-nnnnnn`. |
| `identifiers` | array | Organisation-scoped identifiers. See below. |
| `given_name` | string | |
| `family_name` | string | |
| `birth_date` | string | `YYYY-MM-DD`. |
| `sex` | enum | `female`, `male`, `other`, `unknown`. Administrative sex as recorded. |
| `contact` | object | Optional. Phone and email. |
| `match` | object | Present on create. See [Patient matching](#patient-matching). |
| `created_at` | string | ISO 8601, UTC. |
| `updated_at` | string | ISO 8601, UTC. |

### Identifiers

| Field | Description |
|---|---|
| `system` | The namespace the identifier belongs to, for example `referring-hospital`. |
| `value` | The identifier itself. |

You can only read and write identifiers in your own organisation's namespace. You never see
another hospital's MRN for a patient, even one you both treat.

:::note Why sex and not gender
The field records administrative sex as held in the patient record, because it affects
clinical decisions such as dosing and reference ranges. It is not a statement about gender
identity, and the API does not ask for one, because nothing in a surgical referral workflow
requires it.
:::

---

## Register a patient

```
POST /v1/patients
```

Registers a patient, or returns the existing record if your identifier already matches one.

**Required headers**

| Header | Description |
|---|---|
| `Authorization` | `Bearer` token with `patient.write` |
| `Idempotency-Key` | Unique per logical registration |
| `X-Acting-Practitioner` | The clinician or user registering the patient |

**Request**

```bash
curl -X POST https://api.relayhealth.example/v1/patients \
  -H "Authorization: Bearer $RELAY_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 2c5e8a91-4b7d-4f3a-9e21-6d8c0b1f7a34" \
  -H "X-Acting-Practitioner: PRACT-8831" \
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

**201 Created**

```json
{
  "patient_id": "PAT-100029",
  "identifiers": [
    { "system": "referring-hospital", "value": "REF-48291" }
  ],
  "given_name": "Amara",
  "family_name": "Okonkwo",
  "birth_date": "1979-04-12",
  "sex": "female",
  "match": {
    "outcome": "created",
    "confidence": null
  },
  "created_at": "2026-09-19T09:14:02Z",
  "updated_at": "2026-09-19T09:14:02Z"
}
```

**200 OK**, when your identifier already matches a patient:

```json
{
  "patient_id": "PAT-100029",
  "match": {
    "outcome": "matched",
    "confidence": "exact",
    "matched_on": "identifier"
  }
}
```

The status code tells you which happened: `201` for a new record, `200` for an existing one.
Both are success. Your integration should store the `patient_id` either way.

---

## Patient matching

Matching has three possible outcomes, and the API treats them very differently.

| `outcome` | HTTP | Meaning |
|---|---|---|
| `created` | 201 | No existing patient matched. A new record was created. |
| `matched` | 200 | Your identifier resolved to an existing patient. |
| `conflict` | 409 | The details match more than one record. Nothing was created. |

### Exact match

Your identifier is already on file. You get the same `patient_id` you had before. Safe,
and the common case for a returning patient.

### No match

No existing record corresponds to your identifier or demographics, so a new patient is
created.

### Conflict

The supplied details match more than one existing record, or contradict the record they
appear to match.

**409 Conflict**

```json
{
  "error": {
    "code": "PATIENT_MATCH_CONFLICT",
    "message": "The supplied patient information matches multiple existing records.",
    "request_id": "req_9Lm4pR2wXz"
  }
}
```

**The API does not choose.** Nothing is created and nothing is linked.

This is deliberate. An API that guesses will eventually guess wrong, and attaching clinical
information to the wrong patient is a patient-safety event, not a data-quality issue. The
cost of a human resolving an ambiguous match is far lower than the cost of treating the
wrong person.

Resolving a conflict needs a person with access to both records. See
[Matching patients across facilities](../guides/matching-patients.md).

:::warning Do not retry a conflict with altered details
Changing a date of birth until the match succeeds does not resolve the ambiguity, it hides
it. If the details you hold disagree with the record, that disagreement is the finding.
:::

---

## Retrieve a patient

```
GET /v1/patients/{patient_id}
```

```bash
curl https://api.relayhealth.example/v1/patients/PAT-100029 \
  -H "Authorization: Bearer $RELAY_TOKEN" \
  -H "X-Acting-Practitioner: PRACT-8831"
```

Returns the patient object. You see only the identifiers in your own namespace.

You can retrieve a patient your organisation has referred. You cannot browse patients you
have no relationship with. A patient you have no referral for returns `404`, not `403`, so
that the API does not confirm the record exists.

---

## Update a patient

```
PATCH /v1/patients/{patient_id}
```

You can correct demographics and contact details, and add an identifier in your own
namespace.

```bash
curl -X PATCH https://api.relayhealth.example/v1/patients/PAT-100029 \
  -H "Authorization: Bearer $RELAY_TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-Acting-Practitioner: PRACT-8831" \
  -d '{ "family_name": "Okonkwo-Adeyemi" }'
```

You cannot remove another organisation's identifier, change the `patient_id`, or merge two
patient records. Merging is a clinical data-governance decision handled outside the API.

---

## List patients

```
GET /v1/patients
```

Returns patients your organisation has referred.

| Parameter | Description |
|---|---|
| `identifier` | Look up by your own MRN, for example `referring-hospital|REF-48291`. |
| `page` | Defaults to 1. |
| `limit` | Defaults to 25, maximum 100. |

```bash
curl "https://api.relayhealth.example/v1/patients?identifier=referring-hospital|REF-48291" \
  -H "Authorization: Bearer $RELAY_TOKEN" \
  -H "X-Acting-Practitioner: PRACT-8831"
```

There is no demographic search. You cannot list patients by name or date of birth, because
that would turn the endpoint into a way to discover whether a named person has been
referred anywhere. Look up by the identifier you already hold.

---

## Errors

| HTTP | `code` | Meaning |
|---|---|---|
| 400 | `INVALID_REQUEST` | Malformed body, or a date not in `YYYY-MM-DD`. |
| 403 | `SCOPE_INSUFFICIENT` | Token lacks `patient.write`. |
| 403 | `IDENTIFIER_NAMESPACE_DENIED` | You tried to write an identifier in another organisation's namespace. |
| 404 | `PATIENT_NOT_FOUND` | No such patient, or none your organisation can see. |
| 409 | `PATIENT_MATCH_CONFLICT` | Details match more than one record. |
| 422 | `PATIENT_DATA_INCOMPLETE` | A field required for matching is missing. |

Full list: [Error reference](./errors.md).

---

## Related

- [Matching patients across facilities](../guides/matching-patients.md): resolving a conflict
- [Referrals](./referrals.md): attaching a referral to a patient
- [The consent model](../concepts/consent-model.md): why patient records hold no clinical data