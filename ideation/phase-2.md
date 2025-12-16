# Phase 2 Implementation: Production-Ready Webhook Relay

## Goals

Transform Phase 1 prototype into production system:
1. **Real-time stream feed** - global + per-project subscription
2. **Persistent storage** - better-sqlite3 database
3. **Auto-retry logic** - BullMQ with exponential backoff
4. **Polish** - cleanup, testing, verification

---

## Architecture Changes

### Current (Phase 1)
- State: In-memory Motia state
- Storage: Lost on restart
- Retry: Manual try-catch
- Streaming: None

### Target (Phase 2)
- State: SQLite database (./data/webhooks.db)
- Storage: Persistent across restarts
- Retry: BullMQ auto-retry + DLQ for permanent failures
- Streaming: Real-time webhookFeed stream (global + per-project)

---

## Implementation Steps

### Step 1: Database Foundation

**Install:**
```bash
npm install better-sqlite3 @types/better-sqlite3
```

**Files to create:**

1. **`src/db/database.ts`** - SQLite connection singleton
   - DB path: `process.env.DATABASE_PATH || './data/webhooks.db'`
   - Initialize on first import (singleton pattern)
   - Ensure `./data/` directory exists
   - Handle Error serialization (extract message + stack when saving)
2. **`src/db/schema.sql`** - Table definitions with indexes
3. **`src/db/webhook-repository.ts`** - CRUD operations
   - `save(webhook)` - Insert/update
   - `findById(id)` - Get single webhook
   - `findAll(filters)` - List with filtering
   - `updateStatus(id, status, metadata)` - Status updates

**Schema:**
```sql
CREATE TABLE webhooks (
  id TEXT PRIMARY KEY,
  projectId TEXT NOT NULL,
  method TEXT NOT NULL,
  headers TEXT NOT NULL,
  body TEXT,
  receivedAt TEXT NOT NULL,
  status TEXT NOT NULL,
  forwardedAt TEXT,
  targetUrl TEXT,
  errorMessage TEXT,
  retryCount INTEGER DEFAULT 0,
  lastRetryAt TEXT
);
CREATE INDEX idx_projectId ON webhooks(projectId);
CREATE INDEX idx_status ON webhooks(status);
CREATE INDEX idx_receivedAt ON webhooks(receivedAt DESC);
```

---

### Step 2: Migrate State → Database

**Replace all `state.set/get("webhooks", ...)` with repository calls:**

**Files to modify:**
- src/webhooks/process-webhook.step.ts
- src/webhooks/forward-webhook.step.ts
- src/webhooks/get-webhook.step.ts
- src/webhooks/list-webhooks.step.ts
- src/webhooks/replay-webhook.step.ts

**Pattern:**
```typescript
// OLD
await state.set("webhooks", id, data)
const webhook = await state.get<StoredWebhook>("webhooks", id)

// NEW
await webhookRepository.save(data)
const webhook = await webhookRepository.findById(id)
```

---

### Step 3: Real-time Stream Feed

**Create: `src/webhooks/webhook-feed.stream.ts`**
```typescript
import { StreamConfig } from 'motia'
import { z } from 'zod'

export const config: StreamConfig = {
  name: 'webhookFeed',
  schema: z.object({
    id: z.string(),
    projectId: z.string(),
    method: z.string(),
    receivedAt: z.iso.datetime(),
    status: z.enum(['received', 'forwarded', 'failed', 'retrying']),
    targetUrl: z.url().optional(),
    errorMessage: z.string().optional(),
    retryCount: z.number().default(0),
  }),
  baseConfig: { storageType: 'default' },
}
```

**Modify: process-webhook.step.ts & forward-webhook.step.ts**

Add streams updates after DB operations:
```typescript
// Push to both global and per-project feeds
await streams.webhookFeed.set('global', webhookId, streamData)
await streams.webhookFeed.set(projectId, webhookId, streamData)
```

**Client subscription:**
- Global: Subscribe to groupId='global'
- Per-project: Subscribe to groupId='project-123'
- Workbench UI shows both feeds automatically

---

### Step 4: BullMQ Retry Logic

**CRITICAL: BullMQ Default Behavior**
- Type: **FIXED** backoff (NOT exponential)
- Delay: **2000ms** (2 seconds) per retry
- Attempts: **3 total** (1 initial + 2 retries)
- Source: Verified in `repos/motia/packages/adapter-bullmq-events/src/config-builder.ts:22-24`

Optional: Enable exponential backoff in `motia.config.ts`:
```typescript
bullmqPlugin({
  defaultJobOptions: {
    backoff: { type: 'exponential', delay: 1000 } // 1s, 2s, 4s
  }
})
```

**Update types: `src/types/webhook.types.ts`**
```typescript
export const WebhookStatus = z.enum([
  "received",
  "forwarded",
  "failed",
  "retrying",
  "dlq"  // Dead Letter Queue
])

// Add to StoredWebhookSchema:
retryCount: z.number().default(0),
lastRetryAt: z.iso.datetime().optional(),
dlqAt: z.iso.datetime().optional(),
```

**Modify: `src/webhooks/forward-webhook.step.ts`**

Smart retry strategy:
```typescript
const response = await fetch(targetUrl, {...})

// Permanent 4xx errors → DLQ (no retry)
if (response.status >= 400 && response.status < 500) {
  await emit({ topic: 'webhook-forward-dlq', data: {...} })
  await webhookRepository.updateStatus(webhookId, 'dlq', {...})
  return
}

// Transient 5xx/network errors → throw for BullMQ retry
if (!response.ok) {
  throw new Error(`HTTP ${response.status}`)
}
```

**Create: `src/webhooks/forward-webhook-dlq.step.ts`**
- Subscribes to: `webhook-forward-dlq`
- Logs permanently failed webhooks
- Future: Send alerts (Slack, email)

BullMQ handles exponential backoff automatically when handler throws error.

---

### Step 5: Retry Management API

**Create: `src/webhooks/retry-webhook.step.ts`**
- Endpoint: `POST /webhooks/:id/retry`
- Manually retry failed/DLQ webhook
- Re-emit to `webhook-forward` topic

**Create: `src/webhooks/list-failed-webhooks.step.ts`**
- Endpoint: `GET /webhooks/failed`
- List all webhooks with status='failed' or 'dlq'
- Use repository.findAll with filters

---

### Step 6: Cleanup & Testing

**Delete:**
- `src/hello/` (legacy example)

**Testing checklist:**
```
[ ] Capture webhook → verify DB persistence
[ ] Check global stream feed (Workbench)
[ ] Check project-specific stream
[ ] Replay with invalid URL → triggers retry
[ ] Verify fixed backoff in logs (2s delays, 3 attempts total)
[ ] After 3 attempts → check DLQ
[ ] GET /webhooks/failed → see failed webhook
[ ] POST /webhooks/:id/retry → re-attempt
[ ] Restart server → data persists
[ ] Load test: 100 webhooks → verify performance
```

---

## File Changes Summary

**New files (8):**
- src/db/database.ts
- src/db/schema.sql
- src/db/webhook-repository.ts
- src/webhooks/webhook-feed.stream.ts
- src/webhooks/forward-webhook-dlq.step.ts
- src/webhooks/retry-webhook.step.ts
- src/webhooks/list-failed-webhooks.step.ts

**Modified files (6):**
- src/types/webhook.types.ts (add retry fields)
- src/webhooks/process-webhook.step.ts (DB + streams)
- src/webhooks/forward-webhook.step.ts (DB + retry + streams)
- src/webhooks/get-webhook.step.ts (DB)
- src/webhooks/list-webhooks.step.ts (DB)
- src/webhooks/replay-webhook.step.ts (DB)

**Deleted:**
- src/hello/ (entire directory)

---

## Key Patterns

**Database pattern:**
```typescript
import * as webhookRepository from '../db/webhook-repository'

await webhookRepository.save(webhook)
const webhook = await webhookRepository.findById(id)
```

**Stream pattern:**
```typescript
await streams.webhookFeed.set('global', webhookId, streamData)
await streams.webhookFeed.set(projectId, webhookId, streamData)
```

**Retry pattern:**
```typescript
// Permanent failure → DLQ
if (4xx) { emit('webhook-forward-dlq'); return }

// Transient failure → BullMQ retry
if (!ok) { throw new Error('...') }
```

---

## References

**Motia examples:**
- Stream pattern: repos/motia-examples/examples/getting-started/realtime-todo-app/
- Retry pattern: repos/motia-examples/examples/getting-started/queue-example/steps/queue-tests/dlq/
- Meeting transcription stream: repos/motia-examples/examples/advanced-use-cases/meeting-transcription/

**Current implementation:**
- src/webhooks/forward-webhook.step.ts:22-81 (retry logic location)
- src/webhooks/process-webhook.step.ts:31-39 (state storage location)
- motia.config.ts:6 (BullMQ plugin already installed)

---

## Critique Responses

✅ **BullMQ backoff**: Corrected to FIXED 2s (verified from source code). Config option provided for exponential.
✅ **Stream API**: Pattern `streams.<name>.set(groupId, id, data)` verified correct from examples.
✅ **DB initialization**: Added env variable support + singleton pattern details.
✅ **Error serialization**: Added to database.ts requirements.

## Unresolved Questions

1. ✅ DB location: Use `process.env.DATABASE_PATH || './data/webhooks.db'`
2. Webhook retention: Auto-delete old webhooks? TTL?
3. Backoff strategy: Keep fixed 2s or switch to exponential?
4. DLQ alerts: Log only or Slack/email?
5. Stream history TTL: How long keep?
