---
id: fhir-alignment
title: FHIR alignment
sidebar_label: FHIR alignment
---

# FHIR alignment

This API is **not FHIR-compliant**, and does not claim to be. It is aligned with FHIR: the
resources map onto FHIR concepts, and this page documents how.

If you are integrating a system that already speaks FHIR, this page tells you where the
two models meet and where they diverge.

## Why not full FHIR

[HL7 FHIR](https://hl7.org/fhir/) is the interoperability standard for healthcare data.
Implementing it fully would make this API interoperable with any FHIR-capable system,
which is a real advantage.

It would also mean:

- Implementing resources far beyond what a surgical referral needs
- Exposing FHIR's extension and profiling machinery to integrators who do not want it
- Requiring every referring hospital to understand FHIR before they can send a referral

The audience here is a backend engineer at a referring hospital with a deadline, not a
FHIR implementer. A narrower, workflow-shaped interface gets them to a working integration
faster.

**The trade-off, stated plainly:** this API is easier to integrate against and harder to
interoperate with. If you need true FHIR interoperability, you need a FHIR server, not
this.

---

## Resource mapping

| This API | FHIR resource | Notes |
|---|---|---|
| Patient | `Patient` | Closely aligned. Identifier model is the same idea. |
| Facility | `Organization` | Narrower. Only referring and receiving facilities. |
| Practitioner | `Practitioner`, `PractitionerRole` | Collapsed into one concept. |
| **Referral** | `ServiceRequest` | The central resource here. One of many in FHIR. |
| Availability slot | `Slot` | Aligned. |
| Appointment | `Appointment` | Aligned on the core fields. |
| Procedure | `Procedure` | Aligned. |
| Consent | `Consent` | Simplified. See below. |
| Document | `DocumentReference` | Metadata plus content, same as FHIR. |
| Audit event | `AuditEvent` | Extended with a mandatory purpose. |

---

## Where the models differ

### The referral is central

In FHIR, `ServiceRequest` is one resource among hundreds, with no particular prominence.
Here the referral is the organising concept: appointments and procedures exist only
downstream of an accepted referral, and the lifecycle is modelled explicitly.

That reflects the workflow this API serves. It also means the model does not generalise to
other clinical workflows, which FHIR's does.

### Identifiers

FHIR's `Patient.identifier` carries a system and a value. So does this API, and the
thinking is the same: an identifier belongs to the system that issued it.

The difference is enforcement. This API only lets you read and write identifiers in your
own organisation's namespace. FHIR leaves that to implementation.

### Consent is simplified

FHIR's `Consent` resource models provisions, actors, actions, periods and nested rules.
It can express almost any policy, which makes it powerful and difficult.

Here, consent is scoped to one referral, for one purpose, over a named set of data
categories. That covers the surgical referral case and nothing else.

### Audit events require a purpose

FHIR's `AuditEvent` has an optional `purposeOfEvent`. Here it is mandatory, because an
audit record without a reason cannot answer the question an auditor actually asks. See
[The audit trail](./audit-trail.md).

### Codes are plain strings

FHIR uses `CodeableConcept` with bound terminologies: SNOMED CT, LOINC, ICD-10. This API
uses plain strings for `requested_specialty`, `requested_procedure` and
`clinical_summary.diagnoses`.

**This is the most significant departure**, and the one to be clearest about. It means:

- Easier to integrate, because you send text rather than resolving codes.
- Harder to process automatically, because `"Cholelithiasis"` and `"Gallstones"` are
  different strings for the same condition.
- No automatic cross-system comparison, aggregation or decision support.

A production system handling real volume would need coded terminology. A string field
pushes that problem onto the humans reading the referral, which works at small scale and
fails at large.

### No bundles, no search parameters

FHIR has a `Bundle` resource for transactions and a rich search grammar. This API uses
conventional REST collection endpoints with simple query parameters.

---

## For FHIR-based systems

If your system already holds FHIR resources, the mapping is mostly mechanical.

**Sending a referral.** Map `ServiceRequest` to the referral body:

| FHIR field | API field |
|---|---|
| `ServiceRequest.subject` | `patient_id` |
| `ServiceRequest.requester` | `X-Acting-Practitioner` header |
| `ServiceRequest.performer` | `receiving_facility_id` |
| `ServiceRequest.priority` | `urgency` (`routine`, `urgent`) |
| `ServiceRequest.reasonCode` | `reason` (as display text) |
| `ServiceRequest.code` | `requested_procedure` (as display text) |

**Priority.** FHIR allows `routine`, `urgent`, `asap` and `stat`. This API accepts only
`routine` and `urgent`. Map `asap` and `stat` to your emergency pathway, not to this API.
See the scope note in [Referrals](../reference/referrals.md).

**Codes.** Send the display text from your `CodeableConcept`, not the code. Sending
`"73211009"` where a clinician expects a condition name makes the referral harder to
review, not easier.

**Receiving.** Map the referral back onto `ServiceRequest.status`:

| API status | FHIR `ServiceRequest.status` |
|---|---|
| `PENDING`, `UNDER_REVIEW` | `active` |
| `ACCEPTED`, `SCHEDULING`, `SCHEDULED` | `active` |
| `COMPLETED` | `completed` |
| `REJECTED` | `revoked` |
| `CANCELLED` | `revoked` |

FHIR's status vocabulary is coarser than this API's lifecycle, so some detail is lost in
the round trip. Keep the API status alongside the FHIR one if that detail matters to you.

---

## If this API went to full FHIR

The likely path, in order: adopt coded terminology for diagnoses and procedures, then
expose FHIR-shaped read endpoints alongside the existing ones, then accept FHIR resources
on write.

Terminology comes first because it is the hard part. The rest is shape.

---

## Related

- [Referrals](../reference/referrals.md): the resource that maps to `ServiceRequest`
- [Patients](../reference/patients.md): the identifier model
- [The consent model](./consent-model.md): what consent covers here
- [The audit trail](./audit-trail.md): why purpose is mandatory