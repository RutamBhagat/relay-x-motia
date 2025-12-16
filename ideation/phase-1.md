# Phase 1 Implementation Plan: Webhook Relay Core System

## Overview
Build webhook capture, storage, and replay system in existing Motia project. Replace hello/ example with webhook relay implementation.

**Duration**: Days 1-2
**Success Criteria**: Webhook arrives → stored → retrieved → replayed via curl
**Location**: `/home/voldemort/Downloads/Code/hackathons/relay-x-motia`

---

## Prerequisites (Already Complete)

✅ Motia project initialized
✅ All plugins configured (endpoint, states, logs, observability, bullmq)
✅ Dependencies installed (motia@0.17.6-beta.187, zod@4.1.12)
✅ TypeScript configured with strict mode

**No migration needed** - already on Motia.

---

## Step 1: Create Directory Structure

### 1.1 Remove Hello Example
```bash
cd /home/voldemort/Downloads/Code/hackathons/relay-x-motia
rm -rf src/hello/
```

### 1.2 Create Webhook Directories
```bash
mkdir -p src/webhooks
mkdir -p src/types
```

**Final structure:**
```
src/
├── webhooks/
│   ├── capture-webhook.step.ts
│   ├── list-webhooks.step.ts
│   ├── get-webhook.step.ts
│   ├── replay-webhook.step.ts
│   ├── process-webhook.step.ts
│   └── forward-webhook.step.ts
└── types/
    └── webhook.types.ts
```

---

## Step 2: Shared Type Definitions

**File**: `src/types/webhook.types.ts`

```typescript
import { z } from 'zod';

// Webhook status enum
export const WebhookStatus = z.enum(['received', 'forwarded', 'failed']);

// Stored webhook schema
export const StoredWebhookSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  method: z.string(),
  headers: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
  body: z.unknown(),
  receivedAt: z.iso.datetime(),
  status: WebhookStatus,
  forwardedAt: z.iso.datetime().optional(),
  targetUrl: z.url().optional(),
  errorMessage: z.string().optional(),
});

export type StoredWebhook = z.infer<typeof StoredWebhookSchema>;

// Helper to generate webhook IDs
export function generateWebhookId(): string {
  const timestamp = Date.now();
  const random = crypto.randomUUID();
  return `wh_${timestamp}_${random}`;
}
```

**Key Points**:
- Webhook ID format: `wh_{timestamp}_{random}`
- 3 status states: received, forwarded, failed
- Zod validation strategy: **Narrow internal metadata, loose external data**
  - `receivedAt`, `forwardedAt`: `.datetime()` (system-generated ISO)
  - `targetUrl`: `.url()` (validated URL format)
  - `body`, `headers`: Loose (`z.unknown()`, `z.record()`) for unpredictable webhook payloads
- TypeScript types for type safety

**Motia Best Practices Applied**:
- ✅ Object format for `emits` with descriptive labels (better Workbench UX)
- ✅ `traceId` in all event handlers (distributed tracing & observability)
- ✅ `state.getGroup()` for listing (verified correct pattern)
- ✅ 200 response for webhooks (not 202 - correct for webhook ack)
- ✅ Hardcoded POST for forwarding (semantically correct for replay)

---

## Step 3: API Steps (4 Endpoints)

### 3.1 Capture Webhook

**File**: `src/webhooks/capture-webhook.step.ts`

**Reference**: `repos/motia-examples/examples/integrations/payment/stripe-payment-demo/steps/api/stripe-webhook.step.ts`

```typescript
import type { ApiRouteConfig, Handlers } from 'motia';
import { z } from 'zod';
import { generateWebhookId } from '../types/webhook.types';

export const config: ApiRouteConfig = {
  name: 'CaptureWebhook',
  type: 'api',
  path: '/relay/:projectId',
  method: 'POST',
  description: 'Universal webhook capture endpoint',
  emits: [{ topic: 'webhook-captured', label: 'Webhook Captured' }],
  flows: ['webhook-relay'],
  responseSchema: {
    200: z.object({
      webhookId: z.string(),
      status: z.string(),
    }),
  },
};

export const handler: Handlers['CaptureWebhook'] = async (req, { emit, logger }) => {
  const { projectId } = req.pathParams;
  const webhookId = generateWebhookId();

  logger.info('Webhook captured', { webhookId, projectId });

  // Emit for async processing
  await emit({
    topic: 'webhook-captured',
    data: {
      webhookId,
      projectId,
      method: 'POST',
      headers: req.headers,
      body: req.body,
      receivedAt: new Date().toISOString(),
    },
  });

  return {
    status: 200,
    body: {
      webhookId,
      status: 'received',
    },
  };
};
```

---

### 3.2 List Webhooks

**File**: `src/webhooks/list-webhooks.step.ts`

```typescript
import type { ApiRouteConfig, Handlers } from 'motia';
import { z } from 'zod';
import { StoredWebhookSchema, type StoredWebhook } from '../types/webhook.types';

export const config: ApiRouteConfig = {
  name: 'ListWebhooks',
  type: 'api',
  path: '/webhooks',
  method: 'GET',
  description: 'List all webhooks with optional filtering',
  emits: [],
  flows: ['webhook-relay'],
  queryParams: [
    { name: 'projectId', description: 'Filter by project ID' },
    { name: 'limit', description: 'Max results (default 50)' },
    { name: 'offset', description: 'Skip N results (default 0)' },
  ],
  responseSchema: {
    200: z.object({
      webhooks: z.array(StoredWebhookSchema),
      total: z.number(),
      limit: z.number(),
      offset: z.number(),
    }),
  },
};

export const handler: Handlers['ListWebhooks'] = async (req, { logger, state }) => {
  const projectId = req.queryParams.projectId as string | undefined;
  const limit = parseInt(req.queryParams.limit as string) || 50;
  const offset = parseInt(req.queryParams.offset as string) || 0;

  logger.info('Listing webhooks', { projectId, limit, offset });

  // Get all webhooks from state
  const allWebhooks = await state.getGroup<StoredWebhook>('webhooks');

  // Filter by projectId if provided
  let filtered = allWebhooks;
  if (projectId) {
    filtered = allWebhooks.filter((wh) => wh.projectId === projectId);
  }

  // Sort by receivedAt descending (newest first)
  const sorted = filtered.sort(
    (a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime()
  );

  // Paginate
  const paginated = sorted.slice(offset, offset + limit);

  logger.info('Webhooks retrieved', { total: filtered.length, returned: paginated.length });

  return {
    status: 200,
    body: {
      webhooks: paginated,
      total: filtered.length,
      limit,
      offset,
    },
  };
};
```

---

### 3.3 Get Webhook Details

**File**: `src/webhooks/get-webhook.step.ts`

**Reference**: `repos/motia-examples/examples/getting-started/queue-example/steps/queue-tests/dlq/dlq-retry.step.ts`

```typescript
import type { ApiRouteConfig, Handlers } from 'motia';
import { z } from 'zod';
import { StoredWebhookSchema, type StoredWebhook } from '../types/webhook.types';

export const config: ApiRouteConfig = {
  name: 'GetWebhook',
  type: 'api',
  path: '/webhooks/:id',
  method: 'GET',
  description: 'Fetch single webhook details',
  emits: [],
  flows: ['webhook-relay'],
  responseSchema: {
    200: StoredWebhookSchema,
    404: z.object({ error: z.string() }),
  },
};

export const handler: Handlers['GetWebhook'] = async (req, { logger, state }) => {
  const { id } = req.pathParams;

  logger.info('Fetching webhook', { webhookId: id });

  const webhook = await state.get<StoredWebhook>('webhooks', id);

  if (!webhook) {
    logger.warn('Webhook not found', { webhookId: id });
    return {
      status: 404,
      body: { error: 'Webhook not found' },
    };
  }

  return {
    status: 200,
    body: webhook,
  };
};
```

---

### 3.4 Replay Webhook

**File**: `src/webhooks/replay-webhook.step.ts`

**Reference**: `repos/motia-examples/examples/getting-started/queue-example/steps/queue-tests/dlq/dlq-retry.step.ts`

```typescript
import type { ApiRouteConfig, Handlers } from 'motia';
import { z } from 'zod';
import type { StoredWebhook } from '../types/webhook.types';

const bodySchema = z.object({
  targetUrl: z.string().url(),
});

export const config: ApiRouteConfig = {
  name: 'ReplayWebhook',
  type: 'api',
  path: '/webhooks/:id/replay',
  method: 'POST',
  description: 'Replay webhook to target URL',
  emits: [{ topic: 'webhook-forward', label: 'Forward Webhook' }],
  flows: ['webhook-relay'],
  bodySchema,
  responseSchema: {
    200: z.object({
      webhookId: z.string(),
      status: z.string(),
    }),
    404: z.object({ error: z.string() }),
  },
};

export const handler: Handlers['ReplayWebhook'] = async (req, { emit, logger, state }) => {
  const { id } = req.pathParams;
  const { targetUrl } = bodySchema.parse(req.body);

  logger.info('Replaying webhook', { webhookId: id, targetUrl });

  // Check webhook exists
  const webhook = await state.get<StoredWebhook>('webhooks', id);
  if (!webhook) {
    logger.warn('Webhook not found for replay', { webhookId: id });
    return {
      status: 404,
      body: { error: 'Webhook not found' },
    };
  }

  // Emit for async forwarding
  await emit({
    topic: 'webhook-forward',
    data: {
      webhookId: id,
      targetUrl,
      headers: webhook.headers,
      body: webhook.body,
    },
  });

  return {
    status: 200,
    body: {
      webhookId: id,
      status: 'accepted',
    },
  };
};
```

---

## Step 4: Event Steps (2 Handlers)

### 4.1 Process Webhook

**File**: `src/webhooks/process-webhook.step.ts`

**Reference**: `repos/motia-examples/examples/getting-started/queue-example/steps/queue-tests/dlq/dlq-listener.step.ts`

```typescript
import type { EventConfig, Handlers } from 'motia';
import { z } from 'zod';
import type { StoredWebhook } from '../types/webhook.types';

const inputSchema = z.object({
  webhookId: z.string(),
  projectId: z.string(),
  method: z.string(),
  headers: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
  body: z.unknown(),
  receivedAt: z.string(),
});

export const config: EventConfig = {
  name: 'ProcessWebhook',
  type: 'event',
  description: 'Store captured webhook in state',
  subscribes: ['webhook-captured'],
  emits: [],
  flows: ['webhook-relay'],
  input: inputSchema,
};

export const handler: Handlers['ProcessWebhook'] = async (input, { traceId, logger, state }) => {
  const { webhookId, projectId, method, headers, body, receivedAt } = input;

  logger.info('Processing webhook', { traceId, webhookId, projectId });

  // Store in state: namespace='webhooks', key=webhookId
  const webhookData: StoredWebhook = {
    id: webhookId,
    projectId,
    method,
    headers,
    body,
    receivedAt,
    status: 'received',
  };

  await state.set('webhooks', webhookId, webhookData);

  logger.info('Webhook stored', { traceId, webhookId, projectId });
};
```

---

### 4.2 Forward Webhook

**File**: `src/webhooks/forward-webhook.step.ts`

```typescript
import type { EventConfig, Handlers } from 'motia';
import { z } from 'zod';
import type { StoredWebhook } from '../types/webhook.types';

const inputSchema = z.object({
  webhookId: z.string(),
  targetUrl: z.string(),
  headers: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
  body: z.unknown(),
});

export const config: EventConfig = {
  name: 'ForwardWebhook',
  type: 'event',
  description: 'Forward webhook to target URL',
  subscribes: ['webhook-forward'],
  emits: [],
  flows: ['webhook-relay'],
  input: inputSchema,
};

export const handler: Handlers['ForwardWebhook'] = async (input, { traceId, logger, state }) => {
  const { webhookId, targetUrl, headers, body } = input;

  logger.info('Forwarding webhook', { traceId, webhookId, targetUrl });

  try {
    // Forward only Content-Type header (clean forwarding)
    const forwardHeaders: Record<string, string> = {};
    const contentType = headers['content-type'];
    if (contentType) {
      forwardHeaders['Content-Type'] = Array.isArray(contentType) ? contentType[0] : contentType;
    }

    // Make HTTP request to target
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: forwardHeaders,
      body: JSON.stringify(body),
    });

    // Update webhook state
    const webhook = await state.get<StoredWebhook>('webhooks', webhookId);
    if (webhook) {
      webhook.status = response.ok ? 'forwarded' : 'failed';
      webhook.forwardedAt = new Date().toISOString();
      webhook.targetUrl = targetUrl;
      if (!response.ok) {
        webhook.errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      }
      await state.set('webhooks', webhookId, webhook);
    }

    logger.info('Webhook forwarded', { traceId, webhookId, targetUrl, status: response.status });
  } catch (error) {
    logger.error('Webhook forward failed', {
      traceId,
      webhookId,
      targetUrl,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    // Update webhook state to failed
    const webhook = await state.get<StoredWebhook>('webhooks', webhookId);
    if (webhook) {
      webhook.status = 'failed';
      webhook.forwardedAt = new Date().toISOString();
      webhook.targetUrl = targetUrl;
      webhook.errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await state.set('webhooks', webhookId, webhook);
    }
  }
};
```

**Key Patterns**:
- Clean header forwarding (only Content-Type)
  - Intentionally reduces `z.union([z.string(), z.array(z.string())])` to single `string`
  - Prevents header pollution (host, content-length, signatures)
- Defensive null checks before state updates
- Try-catch for error handling
- State updates for success/failure tracking

---

## Step 5: Type Generation & Testing

### 5.1 Generate Types
```bash
cd /home/voldemort/Downloads/Code/hackathons/relay-x-motia
npm run generate-types
```

Creates TypeScript types in `.motia/types/` for handler signatures.

---

### 5.2 Start Development Server
```bash
npm run dev
```

Server starts on `http://localhost:3000` (API + Workbench UI)

---

### 5.3 Test Webhook Capture
```bash
curl -X POST http://localhost:3000/relay/project123 \
  -H "Content-Type: application/json" \
  -d '{
    "event": "user.created",
    "userId": "123",
    "email": "test@example.com"
  }'
```

**Expected:**
```json
{
  "webhookId": "wh_1734261600000_abc123de",
  "status": "received"
}
```

**Note the webhookId** for subsequent tests.

---

### 5.4 Test List Webhooks
```bash
# All webhooks
curl http://localhost:3000/webhooks

# Filter by project
curl "http://localhost:3000/webhooks?projectId=project123"

# Pagination
curl "http://localhost:3000/webhooks?limit=10&offset=0"
```

**Expected:**
```json
{
  "webhooks": [
    {
      "id": "wh_1734261600000_abc123de",
      "projectId": "project123",
      "status": "received",
      ...
    }
  ],
  "total": 1,
  "limit": 50,
  "offset": 0
}
```

---

### 5.5 Test Get Webhook Details
```bash
# Replace with actual webhookId
curl http://localhost:3000/webhooks/wh_1734261600000_abc123de
```

**Expected:**
```json
{
  "id": "wh_1734261600000_abc123de",
  "projectId": "project123",
  "method": "POST",
  "headers": {
    "content-type": "application/json"
  },
  "body": {
    "event": "user.created",
    "userId": "123",
    "email": "test@example.com"
  },
  "receivedAt": "2025-12-16T10:30:42.123Z",
  "status": "received"
}
```

---

### 5.6 Test Replay

**Setup local test server** (new terminal):
```bash
python3 -c "
from http.server import BaseHTTPRequestHandler, HTTPServer
class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        content_length = int(self.headers['Content-Length'])
        body = self.rfile.read(content_length)
        print(f'Received: {body.decode()}')
        self.send_response(200)
        self.end_headers()
HTTPServer(('', 8080), Handler).serve_forever()
"
```

**Replay webhook**:
```bash
curl -X POST http://localhost:3000/webhooks/wh_1734261600000_abc123de/replay \
  -H "Content-Type: application/json" \
  -d '{"targetUrl": "http://localhost:8080"}'
```

**Expected:**
```json
{
  "webhookId": "wh_1734261600000_abc123de",
  "status": "accepted"
}
```

**Note**: `"accepted"` indicates replay request accepted for async processing. The stored webhook status will update to `"forwarded"` or `"failed"` after completion.

**Verify:**
- Python server prints received payload
- Get webhook details again to see status updated to "forwarded"

---

### 5.7 Verify in Workbench

1. Open `http://localhost:3000`
2. Navigate to "Flows" → "webhook-relay"
3. Verify flow visualization:
   - CaptureWebhook → ProcessWebhook (via webhook-captured event)
   - ReplayWebhook → ForwardWebhook (via webhook-forward event)
4. Check "Traces" for request execution details
5. View structured logs for each step

---

## Phase 1 Completion Checklist

- [ ] src/hello/ removed
- [ ] src/webhooks/ created with 6 step files
- [ ] src/types/webhook.types.ts created
- [ ] POST /relay/:projectId accepts webhooks
- [ ] GET /webhooks lists all webhooks
- [ ] GET /webhooks?projectId=X filters correctly
- [ ] GET /webhooks/:id retrieves stored webhooks
- [ ] POST /webhooks/:id/replay forwards to target
- [ ] Status updates to 'forwarded' after successful replay
- [ ] Status updates to 'failed' with error message on failure
- [ ] curl tests pass for capture → list → retrieve → replay
- [ ] Workbench shows flow visualization
- [ ] No crashes during testing
- [ ] Response time < 100ms for capture

---

## Files Created (Summary)

```
src/
├── types/
│   └── webhook.types.ts          # NEW - Shared schemas and helpers
└── webhooks/
    ├── capture-webhook.step.ts   # NEW - POST /relay/:projectId
    ├── list-webhooks.step.ts     # NEW - GET /webhooks
    ├── get-webhook.step.ts       # NEW - GET /webhooks/:id
    ├── replay-webhook.step.ts    # NEW - POST /webhooks/:id/replay
    ├── process-webhook.step.ts   # NEW - webhook-captured subscriber
    └── forward-webhook.step.ts   # NEW - webhook-forward subscriber
```

**No modifications needed** to:
- package.json (already configured)
- motia.config.ts (already configured)
- tsconfig.json (already configured)

---

## Critical References

**Webhook capture pattern**:
`repos/motia-examples/examples/integrations/payment/stripe-payment-demo/steps/api/stripe-webhook.step.ts`

**State management**:
`repos/motia-examples/examples/getting-started/queue-example/steps/queue-tests/dlq/dlq-retry.step.ts`

**Event subscribers**:
`repos/motia-examples/examples/getting-started/queue-example/steps/queue-tests/dlq/dlq-listener.step.ts`

---

## Defensive Patterns Applied

### A. Clean Header Forwarding
**Problem**: Blindly forwarding headers causes issues:
- `host` header points to relay, not target
- `content-length` may be incorrect
- Signature headers (e.g., `x-stripe-signature`) meant for relay
- `x-forwarded-*` headers create confusion

**Solution**: Only forward `Content-Type: application/json`
- Intentionally reduces header type from `union([string, array])` to single `string`
- Target receives clean, predictable request
- Prevents mysterious replay failures

### B. Defensive State Checks
**Problem**: State might be missing if webhook deleted between steps

**Solution**: Null checks before state updates:
```typescript
if (!webhook) {
  logger.error('Webhook missing', { webhookId });
  return;
}
```

### C. Try-Catch Error Handling
**Problem**: HTTP forwarding can fail (network, invalid URL, timeout)

**Solution**: Wrap fetch in try-catch, update state with error details

---

## Next Steps (Phase 2)

After Phase 1 validation:
- Real-time webhook feed stream (notification system)
- Workbench polish
- Error handling refinement
- Pagination optimization
- Search/filtering enhancements

---

## Troubleshooting

### Issue: Types not found
```bash
npm run generate-types
```

### Issue: Events not triggering
Verify topic names match exactly between config.emits and config.subscribes.

### Issue: State not persisting
Check Motia state plugin configured in motia.config.ts (already configured).

### Issue: Port already in use
Check if previous dev server still running, kill process and restart.
