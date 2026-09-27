---
id: verifying-webhooks
title: Verifying webhook signatures
sidebar_label: Verifying webhook signatures
---

# Verifying webhook signatures

Your webhook endpoint is a public URL. Anyone who finds it can POST JSON to it.

Every delivery from the API carries a signature proving it came from us and has not been
altered. Verify it before you act on the payload. An unverified webhook endpoint that
updates clinical records is a way for a stranger to tell your hospital that a referral was
accepted.

## Before you start

You need:

- The `signing_secret` returned when you registered the endpoint. It is shown once. If you
  no longer have it, [rotate the secret](../reference/webhooks.md#managing-endpoints).
- Access to the **raw request body**, exactly as received. Not a parsed and re-serialised
  object.
- An HMAC-SHA256 function. Every language has one in its standard library.

:::warning The raw body is the whole problem
Most verification failures come from parsing JSON and re-serialising it before hashing.
Key order changes, whitespace changes, the signature no longer matches. Capture the raw
bytes before your framework touches them.
:::

---

## The signature header

```http
POST /relay HTTP/1.1
Content-Type: application/json
Relay-Signature: t=1758274591,v1=5d41402abc4b2a76b9719d911017c592a0e5f8b1c2d3e4f5a6b7c8d9e0f1a2b3
```

| Part | Meaning |
|---|---|
| `t` | Unix timestamp, in seconds, of when the delivery was signed. |
| `v1` | Hex-encoded HMAC-SHA256 signature. |

`v1` is the scheme version. If we ever change the signing algorithm, a `v2` will appear
alongside `v1` during a transition period. Parse by key rather than by position, so a new
scheme does not break your parser.

---

## Steps

### 1. Capture the raw body

Before any JSON parsing.

```javascript
// Express: capture the raw bytes on the webhook route only
app.post('/relay',
  express.raw({ type: 'application/json' }),
  (req, res) => {
    const rawBody = req.body;            // a Buffer, untouched
    const header = req.get('Relay-Signature');
    // ...
  }
);
```

### 2. Parse the header

```javascript
function parseSignature(header) {
  const parts = Object.fromEntries(
    header.split(',').map(p => p.split('=', 2))
  );
  return { timestamp: parts.t, signature: parts.v1 };
}
```

If either value is missing, reject the delivery.

### 3. Build the signed payload

The signed string is the timestamp, a full stop, then the raw body.

```
{timestamp}.{raw_body}
```

The timestamp is inside the signature for a reason. Without it, an attacker who captured
one valid delivery could replay it forever, because the body and its signature would stay
valid indefinitely.

```javascript
const signedPayload = `${timestamp}.${rawBody.toString('utf8')}`;
```

### 4. Compute the expected signature

```javascript
const crypto = require('crypto');

const expected = crypto
  .createHmac('sha256', signingSecret)
  .update(signedPayload)
  .digest('hex');
```

### 5. Compare in constant time

```javascript
const valid = crypto.timingSafeEqual(
  Buffer.from(expected, 'hex'),
  Buffer.from(signature, 'hex')
);
```

Do **not** use `===` or `==`. A normal string comparison returns as soon as it finds a
difference, so it takes slightly longer for a nearly-correct signature than a wrong one.
Measured over many attempts, that timing difference leaks the signature one character at a
time. A constant-time comparison always takes the same time whatever the input.

`timingSafeEqual` throws if the two buffers differ in length, so check the length first or
wrap it.

### 6. Reject old timestamps

```javascript
const age = Math.floor(Date.now() / 1000) - Number(timestamp);
if (age > 300) {
  return res.status(400).send('Timestamp too old');
}
```

Five minutes is a reasonable window. Without this check, a captured delivery stays valid
forever. Legitimate retries always carry a fresh timestamp and signature.

### 7. Only now, parse and process

```javascript
if (!valid) {
  return res.status(400).send('Invalid signature');
}

const event = JSON.parse(rawBody.toString('utf8'));

if (await alreadyProcessed(event.event_id)) {
  return res.status(200).send();   // duplicate, acknowledge and stop
}

await enqueue(event);              // process asynchronously
await recordProcessed(event.event_id);
return res.status(200).send();
```

Acknowledge with `200` as soon as the event is stored. Do the work on a queue. An endpoint
that takes longer than ten seconds is treated as failed and retried.

---

## Complete example

```javascript
const crypto = require('crypto');

function verifyWebhook(rawBody, header, secret, toleranceSeconds = 300) {
  if (!header) return { valid: false, reason: 'missing_header' };

  const parts = Object.fromEntries(header.split(',').map(p => p.split('=', 2)));
  const { t: timestamp, v1: signature } = parts;
  if (!timestamp || !signature) return { valid: false, reason: 'malformed_header' };

  const age = Math.floor(Date.now() / 1000) - Number(timestamp);
  if (Number.isNaN(age) || age > toleranceSeconds) {
    return { valid: false, reason: 'timestamp_out_of_tolerance' };
  }

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody.toString('utf8')}`)
    .digest('hex');

  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(signature, 'hex');
  if (a.length !== b.length) return { valid: false, reason: 'signature_mismatch' };

  return crypto.timingSafeEqual(a, b)
    ? { valid: true }
    : { valid: false, reason: 'signature_mismatch' };
}
```

---

## Verify it worked

Send a test delivery from your integration dashboard, or replay a past event:

```bash
curl -X POST https://api.relayhealth.example/v1/webhooks/WHK-2201/replay \
  -H "Authorization: Bearer $RELAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "event_ids": ["EVT-71004"] }'
```

You have it right when:

- A genuine delivery verifies and is processed once.
- The same delivery sent twice is processed once and acknowledged twice.
- A payload with one character changed is rejected.
- A delivery older than your tolerance window is rejected.

Test the last two deliberately. A verification function that accepts everything looks
identical to a working one until the day it matters.

---

## Rotating the secret

```
POST /v1/webhooks/{webhook_id}/rotate-secret
```

The new secret takes effect immediately and the old one stops working. Deploy the new
secret to your endpoint **before** rotating, not after, or you will reject every delivery
until deployment finishes.

Rotate if the secret may have been exposed: committed to a repository, pasted into a
ticket, or sent over email.

---

## Common failures

| Symptom | Cause |
|---|---|
| Every signature fails | The body was parsed and re-serialised before hashing. |
| Works locally, fails in production | A proxy or load balancer is modifying the body or headers. |
| Works, then fails after a deploy | The secret was rotated, or the environment variable is missing. |
| Intermittent failures | Two endpoints share a URL with different secrets. |
| Valid deliveries rejected as old | Server clock drift. Check NTP. |

---

## Related

- [Webhook events](../reference/webhooks.md): the event catalogue and delivery guarantees
- [Idempotency and retries](../concepts/idempotency.md): why the same event arrives twice
- [Handling failed referrals](./handling-failed-referrals.md): acting on what arrives