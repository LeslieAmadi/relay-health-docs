---
id: matching-patients
title: Matching patients across facilities
sidebar_label: Matching patients across facilities
---

# Matching patients across facilities

How to resolve a `PATIENT_MATCH_CONFLICT`, and how to avoid causing one.

The API returns this when the details you sent match more than one existing patient, or
contradict the record they appear to match. It refuses to choose, and nothing is created.

:::warning This is a patient-safety stop, not a validation error
Attaching clinical information to the wrong patient can lead to someone being treated for
a condition they do not have, or anaesthetised despite an allergy. The cost of a person
spending ten minutes resolving an ambiguity is far lower than the cost of getting it
wrong. Treat a conflict as a stop, not a retry.
:::

## Before you start

You need:

- The `request_id` from the conflict response
- Access to your own patient record for this person
- A way to reach the receiving hospital's records team, for conflicts you cannot resolve
  alone

---

## Why conflicts happen

An identifier is local. The same person is `REF-48291` at your hospital and `SURG-90317`
at the receiving one. When you register a patient the API tries to work out whether it
already holds this person, using your identifier first and demographics as a fallback.

Demographics are weak evidence:

- Two people can share a name and a date of birth. In a large population this is common,
  not rare.
- Names change through marriage, transliteration and data entry.
- Dates of birth get transposed. `1979-04-12` and `1979-12-04` are one keystroke apart.
- Estimated dates of birth are recorded for patients whose real one is unknown, and many
  default to the first of January.

So when the evidence points two ways, the API stops.

---

## Steps

### 1. Read the conflict response

```json
{
  "error": {
    "code": "PATIENT_MATCH_CONFLICT",
    "message": "The supplied patient information matches multiple existing records.",
    "request_id": "req_9Lm4pR2wXz"
  }
}
```

The response does **not** list the candidate records. Returning them would tell you about
patients you have no relationship with, which is the disclosure the conflict exists to
prevent.

Record the `request_id`. The receiving hospital's records team can use it to see what your
request matched against.

### 2. Check your own record first

Before escalating anything, verify the details you sent.

- Is the date of birth right, and in `YYYY-MM-DD`?
- Are given and family names the right way round?
- Is this person already registered under a different identifier in your own system?
- Have you sent a referral for this patient before? If so, you already hold a
  `patient_id`.

```bash
curl "https://api.relayhealth.example/v1/patients?identifier=referring-hospital|REF-48291" \
  -H "Authorization: Bearer $RELAY_TOKEN" \
  -H "X-Acting-Practitioner: PRACT-8831"
```

A result here means the patient is already registered and you can use the returned
`patient_id` directly. Many conflicts resolve at this step.

### 3. If you already hold a patient_id, use it

Skip registration entirely and reference the `patient_id` on the referral.

```bash
curl -X POST https://api.relayhealth.example/v1/referrals \
  -H "Authorization: Bearer $RELAY_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "X-Acting-Practitioner: PRACT-8831" \
  -d '{ "patient_id": "PAT-100029", "...": "..." }'
```

### 4. If your details were wrong, correct them

Correct the record in your own system first, then retry registration with a **new
idempotency key**, because corrected details make it a different request.

### 5. If your details are right, escalate

A conflict you cannot resolve from your side needs the receiving hospital's records or
information governance team. Give them:

- The `request_id`
- Your identifier for the patient
- The demographics you sent
- The referral this is blocking, and its clinical urgency

They can see both candidate records. You cannot, and should not.

### 6. Document what was decided

When the conflict is resolved, record in your own system which `patient_id` this person
corresponds to, and why. The next person who hits this needs to know it was investigated.

---

## What not to do

**Do not change the details until it works.** Adjusting a date of birth until the match
succeeds does not resolve the ambiguity, it hides it, and it may attach your patient's
referral to someone else's record.

**Do not create a second patient to get past it.** You will have two records for one
person, and their clinical history will split between them.

**Do not retry automatically.** A conflict is not transient. The same request will produce
the same conflict indefinitely.

**Do not guess based on clinical plausibility.** "This must be the right one because the
other patient is 80 and this is a maternity referral" is reasoning that works until the
day it does not.

---

## Reducing conflicts

**Send your identifier every time.** An exact identifier match never produces a conflict.
Demographic matching is only a fallback.

**Store the `patient_id` on first registration** and reuse it. Re-registering a patient
you have already registered is the most common avoidable cause.

**Validate dates at entry.** Transposed day and month components are a frequent cause, and
a format check at the point of entry catches most of them.

**Handle merges.** If you receive a `patient.merged` event, update your stored
`patient_id`. Continuing to use a retired identifier still works, but your records drift
out of step.

---

## If you are the receiving hospital

Resolving a conflict means deciding whether two records describe one human being. That is
a clinical data-governance decision with a defined process at most hospitals, usually
involving a records team and a second check.

The API does not expose a merge endpoint, deliberately. Merging two patients is not a
thing an integration should be able to do with one request.

When a merge is performed through your internal process, the API emits `patient.merged` so
connected systems can update.

---

## Related

- [Patients](../reference/patients.md): the identifier model and match outcomes
- [Error reference](../reference/errors.md): `PATIENT_MATCH_CONFLICT` and related codes
- [Webhook events](../reference/webhooks.md): `patient.merged`