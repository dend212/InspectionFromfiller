# Jobs Webhook API (n8n integration)

The Jobs module exposes a small HTTP API under `/api/webhooks/jobs/*` so
external systems (Workiz, CRMs, n8n workflows) can create and update jobs
without a Supabase session.

All three routes authenticate with a shared Bearer token. The intended
deployment is:

```
Workiz (or other CRM)
      │
      ▼
  n8n workflow
      │  reshapes the CRM payload into our canonical shape
      ▼
  POST /api/webhooks/jobs/*   (Bearer $JOBS_WEBHOOK_SECRET)
```

Put n8n in the middle so payload reshaping, retries, and future CRM swaps
happen in the automation layer without touching this codebase.

---

## Authentication

Every request must include:

```
Authorization: Bearer <JOBS_WEBHOOK_SECRET>
```

The secret is stored in the `JOBS_WEBHOOK_SECRET` environment variable
(server-side only). Generate a fresh one with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Missing or wrong token → `401 Unauthorized`. Comparison is timing-safe.

### Rotating the secret

1. Generate a new secret.
2. Update `JOBS_WEBHOOK_SECRET` in Vercel (Project → Settings → Environment Variables).
3. Redeploy.
4. Update the n8n credential / env var with the new value.
5. Delete the old secret from Vercel.

Brief downtime (< 30s) during redeploy is expected. For zero-downtime
rotation, split into two secrets and accept either — not implemented yet.

---

## `POST /api/webhooks/jobs/create`

Creates a new job. Idempotent on `externalId`.

### Request

```http
POST /api/webhooks/jobs/create
Authorization: Bearer <JOBS_WEBHOOK_SECRET>
Content-Type: application/json
```

```json
{
  "externalId": "workiz_job_abc123",
  "title": "Pump out service — 123 Main St",

  "assignedToEmail": "tech@sewertime.com",
  "assignedToName": "Jeff Knight",

  "templateName": "Pump Out Service",
  "templateId": null,

  "customer": {
    "name": "Jane Doe",
    "email": "jane@example.com",
    "phone": "(555) 123-4567"
  },
  "serviceAddress": {
    "street": "123 Main St",
    "city": "Phoenix",
    "state": "AZ",
    "zip": "85001"
  },

  "scheduledFor": "2026-04-15T14:00:00Z",
  "initialNotes": "Customer reports slow drains."
}
```

### Field reference

| Field | Required | Notes |
|---|---|---|
| `externalId` | yes | Upstream job ID. Stored with a unique index, so retries are safe. |
| `title` | yes | Shown as the job title in the dashboard. |
| `assignedToEmail` | either/or | Looked up case-insensitively against `profiles.email`. |
| `assignedToName` | either/or | Case-insensitive trim match against `profiles.full_name`. Email wins if both provided. |
| `templateId` | optional | UUID of a checklist template. Wins over `templateName`. |
| `templateName` | optional | Case-insensitive name match against non-archived templates. |
| `customer.*` | optional | Any fields omitted save as `NULL`. |
| `serviceAddress.*` | optional | `state` defaults to `"AZ"`. |
| `scheduledFor` | optional | ISO 8601 timestamp. |
| `initialNotes` | optional | Seeds the job's General Notes. |

At least one of `assignedToEmail` / `assignedToName` is required.

### Responses

**201 Created** — new job created:

```json
{
  "jobId": "58f7c66a-7fe7-465b-9673-48e9a084e07c",
  "status": "open",
  "duplicate": false,
  "url": "https://your-app.vercel.app/jobs/58f7c66a-7fe7-465b-9673-48e9a084e07c",
  "assignedTo": {
    "id": "...",
    "fullName": "Jeff Knight",
    "email": "tech@sewertime.com"
  },
  "templateApplied": {
    "id": "...",
    "name": "Pump Out Service",
    "itemCount": 4
  }
}
```

`templateApplied` is `null` if no template was requested.

**200 OK** — idempotent duplicate:

```json
{
  "jobId": "58f7c66a-7fe7-465b-9673-48e9a084e07c",
  "status": "in_progress",
  "duplicate": true,
  "url": "https://your-app.vercel.app/jobs/58f7c66a-7fe7-465b-9673-48e9a084e07c"
}
```

n8n should treat this as success and skip any downstream "notify
dispatcher" steps.

**Errors**

| Code | Cause |
|---|---|
| 400 | Invalid JSON, Zod validation failed (see `details`) |
| 401 | Missing / wrong Bearer token |
| 404 | Tech or template not found |
| 500 | Server misconfigured (missing env var) or DB error |

---

## `GET /api/webhooks/jobs/[externalId]`

Lets n8n poll for the current state of a job. Use this to mirror status
back to the CRM without needing outbound webhooks (coming later).

### Request

```http
GET /api/webhooks/jobs/workiz_job_abc123
Authorization: Bearer <JOBS_WEBHOOK_SECRET>
```

### Response

**200 OK**:

```json
{
  "jobId": "...",
  "externalId": "workiz_job_abc123",
  "title": "Pump out service — 123 Main St",
  "status": "completed",
  "assignedTo": {
    "id": "...",
    "fullName": "Jeff Knight",
    "email": "tech@sewertime.com"
  },
  "customerSummary": "During today's pump-out service...",
  "finalizedPdfPath": "reports/jobs/.../report.pdf",
  "customerPdfPath":  "reports/jobs/.../report-customer.pdf",
  "publicSummaryUrl": "https://your-app.vercel.app/jobs/summary/Abc123xyz",
  "publicSummaryExpiresAt": "2026-07-08T...",
  "startedAt":  "2026-04-15T14:05:00.000Z",
  "completedAt":"2026-04-15T16:20:00.000Z",
  "createdAt":  "2026-04-15T13:00:00.000Z",
  "updatedAt":  "2026-04-15T16:20:00.000Z",
  "url": "https://your-app.vercel.app/jobs/...",
  "mediaCount": { "photos": 4, "videos": 1 },
  "checklist": [
    { "id": "...", "title": "Inspect lids", "status": "done", "isRequired": true, "requiredPhotoCount": 1, "requiresNote": true },
    ...
  ]
}
```

`finalizedPdfPath`, `customerPdfPath`, and `publicSummaryUrl` are only
populated once the job has been finalized / a tokenized link generated.

**404 Not Found** if the `externalId` is unknown.

---

## `POST /api/webhooks/jobs/[externalId]/status`

Transition a job between statuses.

### Request

```http
POST /api/webhooks/jobs/workiz_job_abc123/status
Authorization: Bearer <JOBS_WEBHOOK_SECRET>
Content-Type: application/json
```

```json
{
  "status": "in_progress",
  "finalize": false
}
```

### Rules

- `status` must be one of `"open"`, `"in_progress"`, `"completed"`.
- `status: "completed"` **requires** `finalize: true`. Setting completed
  without finalizing is rejected with 400 — there's no legitimate
  use case for a completed job with no PDF, and it would leave the
  dashboard inconsistent.
- `status: "in_progress"` sets `started_at` if it was null.
- `status: "open"` clears `started_at` (full reset).

### Finalize path

When `finalize: true` is set with `status: "completed"`, the route runs
the **full finalize pipeline**:

1. Completion gate — verifies every required checklist item is marked
   `done` with its required notes and photo count satisfied.
2. Builds two branded PDFs (staff + customer) via pdf-lib, skipping
   videos (they're web-only).
3. Uploads both to Supabase Storage.
4. Updates `jobs.status = 'completed'`, `completed_at = now()`,
   `finalized_pdf_path`, `customer_pdf_path`.

If the gate fails, returns `400` with a `details` array:

```json
{
  "error": "Cannot finalize: required items incomplete",
  "details": [
    "\"Inspect lids\" requires a technician note",
    "\"Confirm pump cycle\" requires 1 photo(s), has 0"
  ]
}
```

### Responses

**200 OK** — in_progress / open:

```json
{
  "jobId": "...",
  "status": "in_progress",
  "startedAt": "2026-04-15T14:05:00.000Z"
}
```

**200 OK** — completed + finalized:

```json
{
  "jobId": "...",
  "status": "completed",
  "finalizedPdfPath": "reports/jobs/.../report.pdf",
  "customerPdfPath":  "reports/jobs/.../report-customer.pdf",
  "completedAt": "2026-04-15T16:20:00.000Z"
}
```

**Errors**

| Code | Cause |
|---|---|
| 400 | Invalid JSON, invalid status, completed without finalize, or finalize gate failed |
| 401 | Missing / wrong Bearer token |
| 404 | No job with that `externalId` |
| 500 | Server error (PDF build or upload failure) |

---

## Example n8n workflow

### "Workiz → Jobs: create on new job"

1. **Workiz webhook trigger** — fire on "new job created".
2. **Function node** — reshape the Workiz payload:

   ```js
   return [
     {
       json: {
         externalId: `workiz_${$json.id}`,
         title: `${$json.jobType} — ${$json.address.street}`,
         assignedToName: $json.tech?.name,
         templateName: $json.jobType, // naive: job type == template name
         customer: {
           name: `${$json.client.firstName} ${$json.client.lastName}`,
           email: $json.client.email,
           phone: $json.client.phone,
         },
         serviceAddress: {
           street: $json.address.street,
           city: $json.address.city,
           state: $json.address.state || "AZ",
           zip: $json.address.zip,
         },
         scheduledFor: $json.scheduledAt,
       },
     },
   ];
   ```

3. **HTTP Request node**:

   - Method: `POST`
   - URL: `https://your-app.vercel.app/api/webhooks/jobs/create`
   - Authentication: `Generic Credential Type` → `Header Auth`
   - Name: `Authorization`, Value: `Bearer {{ $env.JOBS_WEBHOOK_SECRET }}`
   - Body: JSON, source = "Using Fields Below" → pass through the
     reshaped payload.
   - Response: Always output full response so you can branch on the
     status code and `duplicate` flag.

4. **IF node**: `{{ $json.duplicate === true }}` → stop; else continue
   to "store jobId back on Workiz custom field".

### "Workiz → Jobs: update status"

Trigger on Workiz job status change, POST to
`/api/webhooks/jobs/{{ externalId }}/status`.

### "Jobs → Workiz: sync completion" (until outbound webhooks ship)

Scheduled every 5 minutes. For each Workiz job in "in progress", `GET`
our webhook endpoint and mirror the status back to Workiz via its API.

---

## Local smoke test (curl)

```bash
SECRET=your-dev-secret
BASE=http://localhost:3000/api/webhooks/jobs
EXT=test-$(date +%s)

# Create
curl -X POST $BASE/create \
  -H "Authorization: Bearer $SECRET" -H "Content-Type: application/json" \
  -d "{\"externalId\":\"$EXT\",\"title\":\"Smoke test\",\"assignedToEmail\":\"test-tech@jobs-e2e.local\"}"

# Read
curl -H "Authorization: Bearer $SECRET" "$BASE/$EXT"

# In progress
curl -X POST "$BASE/$EXT/status" \
  -H "Authorization: Bearer $SECRET" -H "Content-Type: application/json" \
  -d '{"status":"in_progress"}'

# Finalize
curl -X POST "$BASE/$EXT/status" \
  -H "Authorization: Bearer $SECRET" -H "Content-Type: application/json" \
  -d '{"status":"completed","finalize":true}'
```

---

## Security notes

- **Always HTTPS in production.** The Bearer token is sent in the header
  on every request; a plaintext interception would compromise it.
- The webhook routes use the service-role Supabase client for DB ops and
  bypass RLS. Caller-level authorization is the Bearer token — don't
  expose the secret beyond n8n.
- Webhook-created jobs set `created_by = assignedTo` (the tech), since
  n8n is acting on their behalf. This keeps audit trails pointed at a
  real person instead of a synthetic system user.
- There is **no rate limiting** on these endpoints. n8n is the only
  expected caller; if you wire up an untrusted third party later, add
  rate limiting at the edge (Vercel config or middleware).
- Media upload is **not** supported via webhook. Techs upload photos and
  videos through the dashboard UI, which uses signed upload URLs and
  TUS for videos. Binary-over-JSON is impractical from n8n anyway.

---

## Out of scope (YAGNI)

These are intentionally **not** built in the current webhook:

- **Outbound webhooks** from the app to n8n. Poll via GET instead until
  polling becomes painful.
- **HMAC body signing**. Bearer token over HTTPS is sufficient for n8n.
- **Media upload** via webhook.
- **Tokenized customer link generation** via webhook. Admins create
  those from the dashboard.
- **Per-event webhook types** (`job.created`, `job.updated`). The three
  routes above cover the lifecycle.
