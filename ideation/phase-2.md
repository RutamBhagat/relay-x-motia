# Phase 2 Implementation: Production-Ready Webhook Relay

## Goals

Transform Phase 1 prototype into production system:
1. **Real-time stream feed** - global + per-project subscription
2. **Persistent storage** - Motia state (Redis-backed, already persistent)
3. **Auto-retry logic** - BullMQ with exponential backoff
4. **Polish** - cleanup, testing, verification

---

## Architecture Changes

### Current (Phase 1)
- State: Motia state collection (Redis-backed, persistent)
- Retry: Manual try-catch
- Streaming: None

### Target (Phase 2)
- State: Keep existing Motia state (already persistent across restarts)
- Retry: BullMQ auto-retry + DLQ for permanent failures
- Streaming: Real-time webhookFeed stream (global + per-project)

---

## Implementation Steps

### Step 1: Real-time Stream Feed

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

Add stream updates after state operations:
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

### Step 2: BullMQ Retry Logic

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

  const webhook = await state.get<StoredWebhook>("webhooks", webhookId)
  await state.set("webhooks", webhookId, {
    ...webhook,
    status: 'dlq',
    errorMessage,
    dlqAt: new Date().toISOString(),
  })

  await streams.webhookFeed.set('global', webhookId, streamData)
  await streams.webhookFeed.set(projectId, webhookId, streamData)
  return
}

// Transient 5xx/network errors → throw for BullMQ retry
if (!response.ok) {
  const webhook = await state.get<StoredWebhook>("webhooks", webhookId)
  await state.set("webhooks", webhookId, {
    ...webhook,
    status: 'retrying',
    retryCount: (webhook.retryCount || 0) + 1,
    lastRetryAt: new Date().toISOString(),
  })

  throw new Error(`HTTP ${response.status}`)
}
```

**Create: `src/webhooks/forward-webhook-dlq.step.ts`**
- Subscribes to: `webhook-forward-dlq`
- Logs permanently failed webhooks
- Future: Send alerts (Slack, email)

BullMQ handles exponential backoff automatically when handler throws error.

---

### Step 3: Retry Management API

**Create: `src/webhooks/retry-webhook.step.ts`**
- Endpoint: `POST /webhooks/:id/retry`
- Manually retry failed/DLQ webhook
- Re-emit to `webhook-forward` topic

**Create: `src/webhooks/list-failed-webhooks.step.ts`**
- Endpoint: `GET /webhooks/failed`
- List all webhooks with status='failed' or 'dlq'
- Use state.getGroup() with client-side filtering

---

### Step 4: Cleanup & Testing

**Delete:**
- `src/hello/` (legacy example)

**Testing checklist:**
```
[ ] Capture webhook → verify state persistence
[ ] Check global stream feed (Workbench)
[ ] Check project-specific stream
[ ] Replay with invalid URL → triggers retry
[ ] Verify backoff in logs
[ ] After max attempts → check DLQ
[ ] GET /webhooks/failed → see failed webhook
[ ] POST /webhooks/:id/retry → re-attempt
[ ] Restart server → data persists (Redis)
[ ] Load test: 100 webhooks → verify performance
```

---

## File Changes Summary

**New files (4):**
- src/webhooks/webhook-feed.stream.ts
- src/webhooks/forward-webhook-dlq.step.ts
- src/webhooks/retry-webhook.step.ts
- src/webhooks/list-failed-webhooks.step.ts

**Modified files (3):**
- src/types/webhook.types.ts (add retry/dlq fields)
- src/webhooks/process-webhook.step.ts (add streams)
- src/webhooks/forward-webhook.step.ts (retry logic + DLQ + streams)

**Deleted:**
- src/hello/ (entire directory)

---

## Key Patterns

**State pattern (keep existing):**
```typescript
await state.set("webhooks", webhookId, webhook)
const webhook = await state.get<StoredWebhook>("webhooks", webhookId)
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
- Stream: repos/motia-examples/examples/getting-started/realtime-todo-app/
- Retry/DLQ: repos/motia-examples/examples/getting-started/queue-example/steps/queue-tests/dlq/
- State management: .cursor/rules/motia/state-management.mdc

**Current implementation:**
- src/webhooks/forward-webhook.step.ts:22-81 (retry logic location)
- src/webhooks/process-webhook.step.ts:31-39 (state storage location)
- motia.config.ts:6 (BullMQ plugin already installed)

---

## Unresolved Questions

1. Exponential vs fixed backoff?
2. DLQ alerts - log only or Slack/email?
3. Webhook retention - auto-delete old webhooks? TTL?
4. Stream history TTL?
