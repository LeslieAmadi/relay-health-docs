---
id: index
title: Relay Health API
sidebar_label: Overview
sidebar_position: 0
slug: /
---

# Relay Health API

A referral API operated by a surgical hospital, so that referring hospitals can transfer a
patient's surgical care and track it through to a scheduled procedure.

The core workflow is the transfer of care, not appointment booking:

```
Referral ──► Clinical review ──► Acceptance ──► Availability ──► Appointment ──► Procedure
```

A referral is therefore the central resource. Appointments and procedures exist only
downstream of an accepted referral.

---

## Start here

**[Quickstart](./quickstart.md)**
From client credentials to a confirmed surgical referral in about ten minutes. Real
requests, real responses, a sandbox that stands in for the receiving hospital.

**[Referrals reference](./reference/referrals.md)**
The central resource: lifecycle, fields, endpoints, rejection reasons and errors.

**[Idempotency and retries](./concepts/idempotency.md)**
What to do when a request times out and you do not know whether the referral was created.

---

## What this API is for

**Who uses it.** Engineers at a referring hospital, integrating an existing
patient-management system with a surgical hospital's referral process.

**What it covers.** Routine and urgent surgical referrals: submitting them, attaching the
clinical information needed to assess them, tracking status, and receiving the appointment
once one is scheduled.

**What it does not cover.** Emergency care. A life-threatening case cannot wait for
another organisation to review a referral asynchronously. `urgent` prioritises clinical
review; it does not mean immediate. Emergencies follow the participating hospitals'
established clinical pathways.

---

## Three things that shape the design

**Referrals are asynchronous.** A clinician at the receiving hospital reviews each
referral and may accept or reject it. That takes hours or days. The API does not hold your
request open — you submit, and you receive
[webhook events](./reference/webhooks.md) as the referral moves.

**Technical access is not clinical authorisation.** A valid token proves who is calling.
It does not grant access to a patient's record. Access is evaluated as
`Identity → Organisation → Role → Purpose → Consent → Data scope`, and every read of
clinical information is audited. See [The consent model](./concepts/consent-model.md).

**Patient identity is organisation-specific.** A medical record number belongs to the
organisation that issued it. The same person has a different MRN at each hospital, so the
API keeps your identifier alongside its own rather than replacing it. See
[Matching patients across facilities](./guides/matching-patients.md).

---

## About this project

Relay Health is a demonstration API. It does not exist, and there is no service behind the
endpoints on these pages. I designed and documented it to work through a problem I know
from both sides: how hospitals exchange clinical information safely, and how a developer
integrates against a workflow that another organisation controls.

I trained as a medical doctor before moving into technical writing, which is why the
design gives weight to consent scope, audit purpose and the difference between *no known
allergies* and *nobody checked*.

The documentation is structured along [Diátaxis](https://diataxis.fr/) lines: a tutorial
to get started, how-to guides for specific goals, a reference for looking things up, and
explanations for the reasoning behind the design. The site is built with Docusaurus,
broken links fail the build, and it deploys through GitHub Actions.

Written by [Leslie Amadi](https://leslieamadi.github.io).
Source: [github.com/LeslieAmadi/relay-health-docs](https://github.com/LeslieAmadi/relay-health-docs).

:::note In progress
The quickstart, referrals reference and idempotency pages are complete. The remaining
guides, reference pages and concept pages are being written.
:::