---
id: gateway-deployment
title: Gateway deployment and operations
sidebar_label: Gateway deployment
---

# Relay Health Gateway

Deployment and operations guide. Version 1.0.

## Purpose

This document describes how to install, configure, operate and troubleshoot the Relay
Health Gateway, the component a referring hospital runs on its own infrastructure to
connect its patient management system to the Relay Health API.

## Scope

**Covered:** architecture, system requirements, installation, configuration, verification,
routine operations, monitoring, backup and troubleshooting.

**Not covered:** how to use the API itself (see the
[Quickstart](../quickstart.md)), clinical workflow design, or integration with any
specific patient management system.

## Audience

System administrators and platform engineers installing the Gateway, and the integration
engineers who will use it. It assumes familiarity with Linux, Docker and TLS certificates.
It does not assume any prior knowledge of Relay Health.

---

## System overview

### What the Gateway does

Hospital systems rarely call external APIs directly. The Gateway sits between your patient
management system and the Relay Health API and takes on four jobs that would otherwise be
duplicated in every integration:

| Job | Why it belongs here |
|---|---|
| Credential custody | OAuth client secrets stay inside your network, not in application code. |
| Webhook verification | Signatures are checked once, centrally, before anything reaches your systems. |
| Outbound queueing | Referrals survive a loss of connectivity instead of failing at the point of care. |
| Audit forwarding | A local copy of every request lands in your own audit store. |

### Components

| Component | Responsibility |
|---|---|
| **API proxy** | Accepts requests from internal systems, attaches credentials, forwards to the API. |
| **Token manager** | Obtains and refreshes OAuth access tokens. Holds the client secret. |
| **Outbound queue** | Persists referrals that cannot be sent immediately and retries them. |
| **Webhook receiver** | Terminates inbound webhooks, verifies signatures, rejects anything unverified. |
| **Event dispatcher** | Delivers verified events to your internal endpoints. |
| **Audit forwarder** | Writes a local audit record for every request and event. |

### How it fits together

```
          Your network                      │        Internet
                                            │
┌──────────────────────┐                    │
│ Patient management   │                    │
│ system               │                    │
└──────────┬───────────┘                    │
           │ HTTP (internal)                │
           ▼                                │
┌──────────────────────────────────┐        │     ┌────────────────────┐
│  Relay Health Gateway            │        │     │  Relay Health API  │
│                                  │        │     │                    │
│  API proxy ──── Token manager    │────────┼────►│  /v1/referrals     │
│      │                           │  HTTPS │     │  /oauth/token      │
│  Outbound queue                  │        │     │                    │
│                                  │        │     │                    │
│  Webhook receiver ◄──────────────┼────────┼─────┤  webhook delivery  │
│      │                           │  HTTPS │     └────────────────────┘
│  Event dispatcher                │        │
│      │                           │        │
│  Audit forwarder                 │        │
└──────┼───────────────────────────┘        │
       │                                    │
       ▼                                    │
┌──────────────────────┐                    │
│ Your audit store     │                    │
└──────────────────────┘                    │
```

Only the Gateway talks to the internet. No internal system needs outbound access, and no
client secret leaves the Gateway.

---

## Requirements

### Hardware

| Resource | Minimum | Recommended |
|---|---|---|
| CPU | 2 cores | 4 cores |
| Memory | 4 GB | 8 GB |
| Disk | 40 GB | 100 GB SSD |

Disk is dominated by the outbound queue and local audit records. Size it for your referral
volume and your audit retention period.

### Software

| Requirement | Version |
|---|---|
| Operating system | Ubuntu 22.04 LTS or 24.04 LTS, RHEL 9 |
| Docker Engine | 24.0 or later |
| Docker Compose | 2.20 or later |
| PostgreSQL | 14 or later |

PostgreSQL may run in the Compose stack for evaluation. For production, use a managed or
separately administered instance so that Gateway upgrades do not touch your data.

### Network

| Direction | Destination | Port | Purpose |
|---|---|---|---|
| Outbound | `api.relayhealth.example` | 443 | API requests |
| Inbound | Gateway webhook receiver | 443 | Webhook delivery |
| Internal | Gateway API proxy | 8080 | Requests from your systems |

The webhook receiver must be reachable from the internet over HTTPS with a valid
certificate. A self-signed certificate will cause every delivery to fail.

:::warning Do not expose the API proxy
Port 8080 accepts requests without authentication, on the assumption that it is only
reachable inside your network. Exposing it publicly would let anyone submit referrals
using your credentials. Bind it to an internal interface and firewall it.
:::

---

## Installation

### 1. Create the deployment directory

```bash
sudo mkdir -p /opt/relay-gateway/{config,data,certs}
cd /opt/relay-gateway
```

### 2. Fetch the Compose file

```bash
curl -fsSL https://downloads.relayhealth.example/gateway/v1/docker-compose.yml \
  -o docker-compose.yml
```

### 3. Create the environment file

```bash
cat > .env <<'EOF'
RELAY_CLIENT_ID=
RELAY_CLIENT_SECRET=
RELAY_API_BASE_URL=https://api.relayhealth.example/v1
RELAY_WEBHOOK_SECRET=
GATEWAY_DB_URL=postgres://relay:CHANGEME@postgres:5432/relay_gateway
GATEWAY_PUBLIC_URL=https://relay-gw.your-hospital.example
GATEWAY_INTERNAL_BIND=127.0.0.1:8080
GATEWAY_LOG_LEVEL=info
EOF

chmod 600 .env
```

Fill in `RELAY_CLIENT_ID`, `RELAY_CLIENT_SECRET` and `RELAY_WEBHOOK_SECRET` from your
integration dashboard, and set a real database password.

The `chmod` matters. The file holds your client secret.

### 4. Install TLS certificates

```bash
sudo cp fullchain.pem /opt/relay-gateway/certs/
sudo cp privkey.pem   /opt/relay-gateway/certs/
sudo chmod 600 /opt/relay-gateway/certs/privkey.pem
```

### 5. Start the stack

```bash
docker compose up -d
docker compose ps
```

All services should report `running`. If any show `restarting`, go to
[Troubleshooting](#troubleshooting).

### 6. Run the database migrations

```bash
docker compose exec gateway relay-gateway migrate
```

Migrations are idempotent. Running them twice is safe.

---

## Configuration

### Required

| Variable | Description |
|---|---|
| `RELAY_CLIENT_ID` | OAuth client identifier. |
| `RELAY_CLIENT_SECRET` | OAuth client secret. Never commit this. |
| `RELAY_WEBHOOK_SECRET` | Signing secret for verifying inbound webhooks. |
| `GATEWAY_DB_URL` | PostgreSQL connection string. |
| `GATEWAY_PUBLIC_URL` | The HTTPS URL the API delivers webhooks to. |

### Optional

| Variable | Default | Description |
|---|---|---|
| `GATEWAY_INTERNAL_BIND` | `127.0.0.1:8080` | Address the API proxy listens on. |
| `GATEWAY_LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error`. |
| `GATEWAY_QUEUE_MAX_RETRIES` | `7` | Attempts before a queued referral is parked. |
| `GATEWAY_WEBHOOK_TOLERANCE` | `300` | Seconds a webhook timestamp may be old. |
| `GATEWAY_AUDIT_ENDPOINT` | unset | Internal URL to forward audit records to. |
| `GATEWAY_AUDIT_RETENTION_DAYS` | `90` | Local audit retention. |

:::note Set the audit retention to match your policy
The default of 90 days is a starting point, not a recommendation. Clinical audit retention
is usually set by regulation and by your organisation's information governance policy.
Check before you go live.
:::

### Applying a change

```bash
docker compose up -d
```

Compose recreates only the containers whose configuration changed. Queued referrals
survive the restart.

---

## Verify the installation

### 1. Health check

```bash
curl http://127.0.0.1:8080/healthz
```

```json
{
  "status": "healthy",
  "version": "1.0.3",
  "checks": {
    "database": "ok",
    "api_connectivity": "ok",
    "token": "valid",
    "queue_depth": 0
  }
}
```

### 2. Confirm the webhook receiver is reachable

From outside your network:

```bash
curl -I https://relay-gw.your-hospital.example/webhooks
```

Expect `405 Method Not Allowed`. That means the endpoint exists and rejects `GET`, which
is correct. A timeout or certificate error means the API will not be able to deliver.

### 3. Send a test referral

```bash
curl -X POST http://127.0.0.1:8080/v1/referrals \
  -H "Content-Type: application/json" \
  -H "X-Acting-Practitioner: PRACT-8831" \
  -d @test-referral.json
```

Note there is no `Authorization` header. The Gateway attaches credentials for you.

### 4. Confirm the event came back

```bash
docker compose logs gateway | grep webhook
```

A verified `referral.accepted` event in the log confirms the full round trip.

---

## Operations

### Logs

```bash
docker compose logs -f gateway
docker compose logs --since 1h gateway | grep ERROR
```

Logs are structured JSON. Clinical identifiers are redacted at `info` level and above.

:::warning Debug logging records patient identifiers
At `debug`, request bodies are logged in full, including clinical data. Use it only for a
defined troubleshooting window, and purge the logs afterwards.
:::

### Queue

```bash
docker compose exec gateway relay-gateway queue status
docker compose exec gateway relay-gateway queue retry --id Q-4417
```

A queue depth that keeps growing means the Gateway cannot reach the API. Check outbound
connectivity before retrying individual items.

Items that exhaust their retries are **parked**, not discarded. They need a human decision,
because a referral that failed for a day may no longer be clinically appropriate to submit
unchanged.

### Backup

Back up the database. It holds the outbound queue, processed event identifiers and local
audit records.

```bash
docker compose exec postgres pg_dump -U relay relay_gateway \
  | gzip > /backup/relay-gateway-$(date +%F).sql.gz
```

Losing the processed-event table causes already-handled webhooks to be processed again
after a restore.

### Upgrade

```bash
docker compose pull
docker compose up -d
docker compose exec gateway relay-gateway migrate
```

Read the release notes before a major version upgrade. Queued referrals persist across
upgrades.

### Rotating the client secret

1. Generate a new secret in the integration dashboard.
2. Update `RELAY_CLIENT_SECRET` in `.env`.
3. `docker compose up -d`
4. Confirm `"token": "valid"` in the health check.
5. Revoke the old secret.

Do not revoke first. The Gateway will fail every request in the gap.

---

## Troubleshooting

### The Gateway will not start

```bash
docker compose logs gateway | tail -50
```

| Message | Cause | Fix |
|---|---|---|
| `database connection refused` | PostgreSQL not ready, or wrong URL | Check `GATEWAY_DB_URL` and that the database container is running. |
| `missing required configuration` | A required variable is unset | Check `.env` against the required table. |
| `migration pending` | Migrations not run | Run `relay-gateway migrate`. |

### Every API request returns 401

The token manager cannot authenticate.

```bash
docker compose exec gateway relay-gateway token status
```

Usually a wrong `RELAY_CLIENT_ID` or `RELAY_CLIENT_SECRET`, or a secret revoked at the
other end. A whitespace character pasted into `.env` is a common cause.

### Webhooks are not arriving

Check in this order:

1. Is `GATEWAY_PUBLIC_URL` correct and registered with the API?
2. Is the endpoint reachable from the internet? Test from outside your network.
3. Is the certificate valid and the chain complete? `openssl s_client -connect host:443`
4. Is the delivery arriving but failing verification? Check the log for
   `signature_mismatch`.

A `signature_mismatch` on every delivery usually means `RELAY_WEBHOOK_SECRET` is wrong, or
a proxy in front of the Gateway is modifying the request body.

### Webhooks are rejected as too old

Clock drift. The Gateway rejects deliveries whose timestamp is outside
`GATEWAY_WEBHOOK_TOLERANCE`.

```bash
timedatectl status
```

Fix NTP rather than widening the tolerance. The tolerance exists to prevent replay.

### The queue keeps growing

```bash
docker compose exec gateway relay-gateway queue status
curl -I https://api.relayhealth.example/v1/healthz
```

If the API is reachable from the host but not from the container, check Docker's DNS and
any egress proxy configuration.

---

## Security considerations

| Control | Why |
|---|---|
| `.env` at mode 600, owned by root | It holds the client secret. |
| API proxy bound to an internal interface | It accepts unauthenticated internal requests. |
| TLS with a valid chain on the webhook receiver | The API will not deliver to an untrusted certificate. |
| Signature verification before dispatch | The endpoint is public. Anyone can POST to it. |
| Debug logging time-boxed | It records clinical data in full. |
| Audit retention set deliberately | Clinical audit retention is a regulatory matter. |

The Gateway deliberately holds no clinical data at rest beyond the outbound queue. Events
carry identifiers rather than clinical records, so a compromise of the Gateway does not
expose patient histories.

---

## Related

- [Quickstart](../quickstart.md): using the API once the Gateway is running
- [Verifying webhook signatures](../guides/verifying-webhooks.md): what the receiver does
- [Webhook events](../reference/webhooks.md): the events the dispatcher forwards
- [The audit trail](../concepts/audit-trail.md): what the audit forwarder records