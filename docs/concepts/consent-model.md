---
id: consent-model
title: The consent model
sidebar_label: The consent model
---

# The consent model

A valid access token proves who is calling. It does not give you a patient's medical
record.

This page explains how the API decides what clinical information an organisation may see,
and why it works that way.

## The principle

> Being technically able to request patient information does not mean you are authorised
> to receive it.

Most APIs collapse authentication and authorisation into one question: does this caller
have a valid token? For clinical data that is not enough. The same hospital, holding the
same valid token, may legitimately see one patient's record and must not see another's.

What separates the two cases is not identity. It is **purpose**.

---

## Six layers

Every request for clinical information is evaluated through six checks. All six must pass.

```
Identity          Who is calling?
    ↓
Organisation      Which hospital do they act for?
    ↓
Role              What is this caller permitted to do at all?
    ↓
Purpose           Why is this information being requested?
    ↓
Consent           Is there consent or another permitted basis for this disclosure?
    ↓
Data scope        Which parts of the record does that purpose justify?
```

Worked through for a real request:

| Layer | Example | Failure |
|---|---|---|
| Identity | OAuth client credentials | `TOKEN_INVALID` |
| Organisation | `ORG-102`, derived from the token | `TOKEN_INVALID` |
| Role | Scope `referral.write` | `SCOPE_INSUFFICIENT` |
| Purpose | Treatment of referral `REF-3382` | `ACCESS_DENIED` |
| Consent | Patient consented to share for this referral | `CONSENT_REQUIRED`, `CONSENT_EXPIRED` |
| Data scope | Diagnosis, allergies, medications, relevant history | `DATA_SCOPE_EXCEEDED` |

A `403` can therefore mean several different things, which is why the error codes
distinguish them. `SCOPE_INSUFFICIENT` means your integration cannot do this at all.
`ACCESS_DENIED` means it can, but not for this patient.

---

## Purpose is the load-bearing layer

Consent is not a permanent unlock. It is granted for a stated purpose, and it authorises
only what that purpose requires.

A patient consenting to share clinical information so a surgical hospital can treat them
has not consented to that hospital browsing their record for anything else. The consent is
attached to the referral, not to the relationship between the two hospitals.

```json
{
  "consent_id": "CON-4410",
  "patient_id": "PAT-100029",
  "purpose": "treatment",
  "referral_id": "REF-3382",
  "scope": ["diagnoses", "allergies", "medications", "relevant_history"],
  "status": "active",
  "granted_at": "2026-09-19T09:10:00Z",
  "expires_at": "2026-12-19T09:10:00Z",
  "revoked_at": null
}
```

When the referral closes, the basis for the disclosure closes with it.

---

## Minimum necessary

For a surgical referral, the receiving clinician typically needs:

- Relevant diagnoses
- Allergies, particularly to anaesthetic agents and antibiotics
- Current medications
- Relevant previous surgical history
- Relevant laboratory results and imaging

They do not need unrelated conditions from five years ago, mental health history unrelated
to the procedure, or the rest of the record simply because it exists.

The API enforces this through scope rather than trusting the caller to ask only for what
they need. A request outside the consented scope returns `DATA_SCOPE_EXCEEDED`.

:::warning Over-disclosure is a failure, not a convenience
Sending a patient's whole record because it is easier than deciding what is relevant is
not thoroughness. It is a privacy breach with extra steps. It also buries the information
the receiving clinician actually needs.
:::

This is also why [list endpoints omit the clinical summary](../reference/referrals.md).
Clinical detail is returned only when you retrieve a single referral, so a broad query
cannot be used to sweep clinical data across many patients.

---

## Break-glass access

Real clinical systems need an override. A patient arrives deteriorating, the clinician
needs information that normal access rules would withhold, and waiting for the correct
authorisation would cause harm.

Refusing to model that would make the API unusable in practice. Clinicians would work
around it, and the workaround would be invisible.

So break-glass exists, with conditions:

**1. It is never silent.** The clinician must state a justification.

```json
{
  "break_glass": {
    "reason": "Patient unresponsive on arrival. Allergy status required before anaesthesia."
  }
}
```

A request without one returns `BREAK_GLASS_JUSTIFICATION_REQUIRED`.

**2. It is attributed to a person, not a system.** The `X-Acting-Practitioner` header is
mandatory. An organisation cannot break glass; a named clinician can.

**3. It generates a high-priority audit event**, flagged for review rather than filed away.

**4. It does not widen indefinitely.** Break-glass covers the immediate clinical need, not
permanent access to the record.

The design intent is that break-glass is available, uncomfortable, and visible. A
clinician who needs it can use it in seconds. Someone using it routinely will be noticed.

---

## Why the audit trail records why

Most access logs answer who, what and when. A clinical audit trail must also answer
**why**.

```
Audit ID:      AUD-92831
Actor:         PRACT-8831
Organisation:  ORG-102
Action:        VIEW_CLINICAL_RECORD
Patient:       PAT-100029
Purpose:       Treatment of referral REF-3382
Timestamp:     2026-09-18T13:42:00Z
```

Without the purpose field, an audit can only confirm that an access happened. With it, an
auditor can ask whether the access was justified, which is the question that actually
matters. It is also what makes inappropriate access detectable: a clinician viewing a
record with no referral to justify it stands out.

See [The audit trail](./audit-trail.md).

---

## Individual and organisational identity

The OAuth client authenticates an organisation. That is correct for a system-to-system
integration, but it is not enough for a clinical audit trail, which needs to name a
person.

The API keeps both:

| Actor | How it is established | What it is for |
|---|---|---|
| Organisation | OAuth client credentials | Authorisation, rate limits, data scope |
| Practitioner | `X-Acting-Practitioner` header | Audit attribution, break-glass |

The API verifies the practitioner is registered to act for the authenticated organisation.
A client cannot name an arbitrary practitioner to shift accountability, and a practitioner
identifier alone grants nothing.

---

## What this means for your integration

- Send `X-Acting-Practitioner` on every request that touches clinical information, not
  only where it is strictly required.
- Request only the data scope your referral needs. Asking for more is not harmless.
- Handle `CONSENT_EXPIRED` as a state to resolve with the patient, not an error to retry.
- Never retry a `403`. The decision will not change.
- If you implement break-glass in your own interface, make the clinician type the reason.
  Do not pre-fill it, and do not let it become a checkbox.

---

## Related

- [The audit trail](./audit-trail.md): what is recorded and why
- [Error reference](../reference/errors.md): the `403` codes and what each one means
- [Referrals](../reference/referrals.md): the clinical summary and what belongs in it
