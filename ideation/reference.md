# Webhook Relay & Debugger - Implementation Reference

## Quick Reference Guide for LLM Assistants

This file contains all critical references, file paths, and code snippets needed for implementing the Webhook Relay & Debugger project.

---

## Table of Contents

1. [Critical Files from Motia Examples](#critical-files-from-motia-examples)
2. [Pattern 1: API Webhook Receiver](#pattern-1-api-webhook-receiver)
3. [Pattern 2: State Storage & Retrieval](#pattern-2-state-storage--retrieval)
4. [Pattern 3: Event Subscriber Processing](#pattern-3-event-subscriber-processing)
5. [Pattern 4: Real-time Streams](#pattern-4-real-time-streams)
6. [Pattern 5: Replay/Retry Logic](#pattern-5-replayretry-logic)
7. [Configuration Examples](#configuration-examples)
8. [Project Structure](#project-structure)
9. [Testing Patterns](#testing-patterns)

---

## Critical Files from Motia Examples

### Must Read (Implementation Order)

1. **Stripe Webhook Handler**
   ```
   repos/motia-examples/examples/integrations/payment/stripe-payment-demo/steps/api/stripe-webhook.step.ts
   ```
   - API route configuration
   - Event emission pattern
   - Response schemas

2. **DLQ Retry System**
   ```
   repos/motia-examples/examples/getting-started/queue-example/steps/queue-tests/dlq/dlq-retry.step.ts
   ```
   - State storage pattern
   - Data retrieval
   - Re-emission logic for replay

3. **DLQ Listener**
   ```
   repos/motia-examples/examples/getting-started/queue-example/steps/queue-tests/dlq/dlq-listener.step.ts
   ```
   - Event subscriber config
   - State updates
   - Error handling

4. **Meeting Transcription Stream**
   ```
   repos/motia-examples/examples/advanced-use-cases/meeting-transcription/meeting_transcript_example/steps/meeting-transcription.stream.ts
   ```
   - Stream schema design
   - Status enum pattern
   - Storage config

### Optional Reference

5. **GitHub Webhook Handler**
   ```
   repos/motia-examples/examples/integrations/github/github-integration-workflow/steps/issue-triage/github-webhook.step.ts
   ```
   - Multiple event types handling
   - Signature verification (if implementing)

6. **Trello Webhook**
   ```
   repos/motia-examples/examples/integrations/communication/trello-flow/steps/trello-webhook.step.ts
   ```
   - Alternative webhook pattern

---

## Pattern 1: API Webhook Receiver

### File Reference
`repos/motia-examples/examples/integrations/payment/stripe-payment-demo/steps/api/stripe-webhook.step.ts`

### Complete Example

```typescript
import { ApiRouteConfig, Handlers } from 'motia';
import { z } from 'zod';

export const config: ApiRouteConfig = {
  name: 'StripeWebhook',
  type: 'api',
  description: 'Handle Stripe webhook events for payment updates',
  path: '/webhooks/stripe',
  method: 'POST',
  emits: [
    { topic: 'payment-succeeded', label: 'Payment Succeeded' },
    { topic: 'payment-failed', label: 'Payment Failed' },
  ],
  flows: ['payment-processing'],
  responseSchema: {
    200: z.object({ received: z.boolean() }),
    400: z.object({ error: z.string() }),
  },
};

export const handler: Handlers['StripeWebhook'] = async (req, { emit, logger }) => {
  try {
    const signature = req.headers['stripe-signature'] as string;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test';

    const event = stripeService.verifyWebhookSignature(
      JSON.stringify(req.body),
      signature || 'test_signature',
      webhookSecret
    );

    logger.info('Webhook received', { eventType: event.type });

    switch (event.type) {
      case 'payment_intent.succeeded':
        await emit({
          topic: 'payment-succeeded',
          data: {
            paymentIntentId: event.data.object.id,
            amount: event.data.object.amount,
            currency: event.data.object.currency,
            customerId: event.data.object.customer,
          },
        });
        break;

      case 'payment_intent.payment_failed':
        await emit({
          topic: 'payment-failed',
          data: {
            paymentIntentId: event.data.object.id,
            amount: event.data.object.amount,
            currency: event.data.object.currency,
            customerId: event.data.object.customer,
            errorMessage: event.data.object.last_payment_error?.message,
          },
        });
        break;
    }

    return {
      status: 200,
      body: { received: true },
    };
  } catch (error) {
    logger.error('Webhook failed', { error });
    return {
      status: 400,
      body: { error: 'Webhook processing failed' },
    };
  }
};
```

### Adapt for Webhook Relay

```typescript
import { ApiRouteConfig, Handlers } from 'motia';
import { z } from 'zod';
import { randomUUID } from 'crypto';

export const config: ApiRouteConfig = {
  name: 'CaptureWebhook',
  type: 'api',
  description: 'Catch-all webhook receiver for any webhook',
  path: '/relay/:projectId',
  method: 'POST',
  emits: [{ topic: 'webhook-captured' }],
  flows: ['webhook-relay'],
  responseSchema: {
    200: z.object({
      webhookId: z.string(),
      received: z.boolean()
    }),
  },
};

export const handler: Handlers['CaptureWebhook'] = async (req, { emit, logger }) => {
  const webhookId = `wh_${Date.now()}_${randomUUID()}`;
  const { projectId } = req.pathParams;

  logger.info('Webhook captured', {
    webhookId,
    projectId,
    method: req.method
  });

  await emit({
    topic: 'webhook-captured',
    data: {
      webhookId,
      projectId,
      headers: req.headers,
      body: req.body,
      method: req.method,
      capturedAt: new Date().toISOString(),
    },
  });

  return {
    status: 200,
    body: { webhookId, received: true },
  };
};
```

---

## Pattern 2: State Storage & Retrieval

### File Reference
`repos/motia-examples/examples/getting-started/queue-example/steps/queue-tests/dlq/dlq-retry.step.ts`

### Key Patterns

#### Storing Data
```typescript
await state.set('queue-test-dlq', id, {
  id: dlqEntryId,
  originalTopic: input.originalTopic,
  originalData: input.originalData,
  traceId: input.traceId,
  status: 'received',
  capturedAt: new Date().toISOString(),
  attemptCount: input.attemptCount,
  failureReason: input.failureReason,
});
```

#### Retrieving Data
```typescript
const entry = await state.get<{
  id: string
  originalTopic: string
  originalData: any
  traceId: string
  failureReason: string
  attemptCount: number
  status: string
  capturedAt: string
  canRetry: boolean
}>('queue-test-dlq', id);

if (!entry) {
  return {
    status: 404,
    body: { error: `Entry not found: ${id}` },
  };
}
```

#### Updating State
```typescript
await state.set('queue-test-dlq', id, {
  ...entry,
  status: 'retrying',
  retryInitiatedAt: new Date().toISOString(),
});
```

#### Deleting State
```typescript
await state.delete('queue-test-attempts', attemptKey);
```

### Adapt for Webhook Relay

#### Store Webhook
```typescript
export const handler: Handlers['ProcessWebhook'] = async (input, { state, logger, streams }) => {
  const { webhookId, projectId, headers, body, capturedAt } = input;

  await state.set('webhooks', webhookId, {
    id: webhookId,
    projectId,
    headers,
    body,
    method: 'POST',
    status: 'received',
    capturedAt,
    forwardedAt: null,
    replayCount: 0,
  });

  logger.info('Webhook stored', { webhookId, projectId });

  // Update stream
  await streams.webhookFeed.update({
    webhookId,
    status: 'received',
    timestamp: capturedAt,
  });
};
```

#### Retrieve Webhook
```typescript
export const config: ApiRouteConfig = {
  name: 'GetWebhook',
  type: 'api',
  path: '/webhooks/:id',
  method: 'GET',
  responseSchema: {
    200: z.object({
      id: z.string(),
      projectId: z.string(),
      headers: z.record(z.string()),
      body: z.any(),
      status: z.enum(['received', 'forwarded', 'failed']),
      capturedAt: z.string(),
      forwardedAt: z.string().nullable(),
    }),
    404: z.object({ error: z.string() }),
  },
};

export const handler: Handlers['GetWebhook'] = async (req, { state, logger }) => {
  const { id } = req.pathParams;

  const webhook = await state.get('webhooks', id);

  if (!webhook) {
    return {
      status: 404,
      body: { error: `Webhook not found: ${id}` },
    };
  }

  return {
    status: 200,
    body: webhook,
  };
};
```

---

## Pattern 3: Event Subscriber Processing

### File Reference
`repos/motia-examples/examples/getting-started/queue-example/steps/queue-tests/dlq/dlq-listener.step.ts`

### Complete Example

```typescript
import { EventConfig, Handlers } from 'motia';
import { z } from 'zod';

const listenerInputSchema = z.object({
  originalTopic: z.string(),
  originalData: z.any(),
  traceId: z.string(),
  failureReason: z.string(),
  attemptCount: z.number(),
  failedAt: z.string(),
});

export const config: EventConfig = {
  type: 'event',
  name: 'DeadLetterQueueListener',
  description: 'Automatically processes messages from Dead Letter Queue',
  flows: ['queue-tests'],
  subscribes: ['queue-test.dlq.processed'],
  emits: ['queue-test.simple'],
  input: listenerInputSchema,
};

export const handler: Handlers['DeadLetterQueueListener'] = async (input, { logger, state, emit }) => {
  logger.info('Processing event', {
    originalTopic: input.originalTopic,
    traceId: input.traceId,
  });

  const dlqEntryId = `dlq-${input.traceId}-${Date.now()}`;

  await state.set('queue-test-dlq', dlqEntryId, {
    id: dlqEntryId,
    originalTopic: input.originalTopic,
    originalData: input.originalData,
    traceId: input.traceId,
    failureReason: input.failureReason,
    attemptCount: input.attemptCount,
    status: 'pending-review',
    arrivedInDlqAt: new Date().toISOString(),
  });

  // Can re-emit if needed
  await emit({
    topic: 'queue-test.simple',
    data: { ...input.originalData },
  });
};
```

### Adapt for Webhook Relay

#### Process Captured Webhook
```typescript
const webhookCapturedSchema = z.object({
  webhookId: z.string(),
  projectId: z.string(),
  headers: z.record(z.string()),
  body: z.any(),
  method: z.string(),
  capturedAt: z.string(),
});

export const config: EventConfig = {
  type: 'event',
  name: 'ProcessWebhook',
  description: 'Store captured webhook in state',
  flows: ['webhook-relay'],
  subscribes: ['webhook-captured'],
  input: webhookCapturedSchema,
};

export const handler: Handlers['ProcessWebhook'] = async (input, { state, logger, streams }) => {
  const { webhookId, projectId, headers, body, capturedAt } = input;

  await state.set('webhooks', webhookId, {
    id: webhookId,
    projectId,
    headers,
    body,
    status: 'received',
    capturedAt,
    replayCount: 0,
  });

  logger.info('Webhook stored', { webhookId, projectId });

  await streams.webhookFeed.update({
    webhookId,
    status: 'received',
    timestamp: capturedAt,
  });
};
```

#### Forward Webhook
```typescript
const webhookForwardSchema = z.object({
  webhookId: z.string(),
  targetUrl: z.string(),
  headers: z.record(z.string()),
  body: z.any(),
});

export const config: EventConfig = {
  type: 'event',
  name: 'ForwardWebhook',
  description: 'Forward webhook to target URL',
  flows: ['webhook-relay'],
  subscribes: ['webhook-forward'],
  input: webhookForwardSchema,
};

export const handler: Handlers['ForwardWebhook'] = async (input, { state, logger, streams }) => {
  const { webhookId, targetUrl, headers, body } = input;

  try {
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
    });

    const webhook = await state.get('webhooks', webhookId);

    await state.set('webhooks', webhookId, {
      ...webhook,
      status: 'forwarded',
      forwardedAt: new Date().toISOString(),
      targetUrl,
      responseStatus: response.status,
    });

    await streams.webhookFeed.update({
      webhookId,
      status: 'forwarded',
      timestamp: new Date().toISOString(),
    });

    logger.info('Webhook forwarded', { webhookId, targetUrl, status: response.status });

  } catch (error: any) {
    const webhook = await state.get('webhooks', webhookId);

    await state.set('webhooks', webhookId, {
      ...webhook,
      status: 'failed',
      error: error.message,
      failedAt: new Date().toISOString(),
    });

    await streams.webhookFeed.update({
      webhookId,
      status: 'failed',
      timestamp: new Date().toISOString(),
    });

    logger.error('Webhook forward failed', { webhookId, error: error.message });
  }
};
```

---

## Pattern 4: Real-time Streams

### File Reference
`repos/motia-examples/examples/advanced-use-cases/meeting-transcription/meeting_transcript_example/steps/meeting-transcription.stream.ts`

### Complete Example

```typescript
import { StreamConfig } from 'motia';
import { z } from 'zod';

export const config: StreamConfig = {
  name: 'meetingTranscription',

  schema: z.object({
    status: z.enum(['uploading', 'transcribing', 'processing', 'completed', 'failed']),
    progress: z.number().min(0).max(100),
    filename: z.string(),
    duration: z.number().optional(),
    transcript: z.string().optional(),
    error: z.string().optional(),
    timestamp: z.string(),
  }),

  baseConfig: {
    storageType: 'default',
  },
};
```

### Adapt for Webhook Relay (Simplified)

```typescript
import { StreamConfig } from 'motia';
import { z } from 'zod';

export const config: StreamConfig = {
  name: 'webhookFeed',

  // CRITICAL: Simple notification only, NOT source of truth
  schema: z.object({
    webhookId: z.string(),
    status: z.enum(['received', 'forwarded', 'failed']),
    timestamp: z.string(),
  }),

  baseConfig: {
    storageType: 'default',
  },
};
```

**Key Points:**
- Stream is FYI only, state holds real data
- No progress %, no complex UI logic
- UI receives update → re-fetches from state API
- If stream fails, GET /webhooks/:id still works

---

## Pattern 5: Replay/Retry Logic

### File Reference
`repos/motia-examples/examples/getting-started/queue-example/steps/queue-tests/dlq/dlq-retry.step.ts`

### Replay API Endpoint

```typescript
import { ApiRouteConfig, Handlers } from 'motia';
import { z } from 'zod';

export const config: ApiRouteConfig = {
  type: 'api',
  name: 'ReplayWebhook',
  description: 'Replay a stored webhook to target URL',
  path: '/webhooks/:id/replay',
  method: 'POST',
  bodySchema: z.object({
    targetUrl: z.string().url(),
  }),
  responseSchema: {
    200: z.object({
      success: z.boolean(),
      webhookId: z.string(),
      message: z.string(),
    }),
    404: z.object({ error: z.string() }),
  },
  emits: ['webhook-forward'],
};

export const handler: Handlers['ReplayWebhook'] = async (req, { state, logger, emit }) => {
  const { id } = req.pathParams;
  const { targetUrl } = req.body;

  const webhook = await state.get('webhooks', id);

  if (!webhook) {
    return {
      status: 404,
      body: { error: `Webhook not found: ${id}` },
    };
  }

  logger.info('Replaying webhook', { webhookId: id, targetUrl });

  // Update replay count
  await state.set('webhooks', id, {
    ...webhook,
    replayCount: (webhook.replayCount || 0) + 1,
  });

  // Emit for forwarding
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
      success: true,
      webhookId: id,
      message: `Webhook replaying to ${targetUrl}`,
    },
  };
};
```

---

## Configuration Examples

### motia.config.ts

```typescript
import { config } from 'motia';
import { endpointPlugin } from '@motiadev/plugin-endpoint';
import { statesPlugin } from '@motiadev/plugin-states';
import { logsPlugin } from '@motiadev/plugin-logs';
import { observabilityPlugin } from '@motiadev/plugin-observability';

export default config({
  plugins: [
    endpointPlugin,
    statesPlugin,
    logsPlugin,
    observabilityPlugin,
  ],
});
```

### package.json

```json
{
  "name": "webhook-relay",
  "version": "1.0.0",
  "scripts": {
    "postinstall": "motia install",
    "dev": "motia dev",
    "build": "motia build",
    "generate-types": "motia generate-types"
  },
  "dependencies": {
    "motia": "latest",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0"
  }
}
```

---

## Project Structure

```
webhook-relay/
├── steps/
│   ├── api/
│   │   ├── capture-webhook.step.ts       # POST /relay/:projectId
│   │   ├── get-webhook.step.ts           # GET /webhooks/:id
│   │   └── replay-webhook.step.ts        # POST /webhooks/:id/replay
│   ├── events/
│   │   ├── process-webhook.step.ts       # webhook-captured subscriber
│   │   └── forward-webhook.step.ts       # webhook-forward subscriber
│   └── streams/
│       └── webhook-feed.stream.ts        # Real-time feed
├── motia.config.ts
├── package.json
├── tsconfig.json
└── README.md
```

---

## Testing Patterns

### Testing with curl

#### Send Test Webhook
```bash
curl -X POST http://localhost:3001/relay/project123 \
  -H "Content-Type: application/json" \
  -d '{"event": "test", "data": "hello"}'
```

#### Get Webhook Details
```bash
curl http://localhost:3001/webhooks/wh_1234567890_abc
```

#### Replay Webhook
```bash
curl -X POST http://localhost:3001/webhooks/wh_1234567890_abc/replay \
  -H "Content-Type: application/json" \
  -d '{"targetUrl": "http://localhost:8080/webhook"}'
```

### Integration Test Example

Reference: `repos/motia-examples/examples/integrations/github/github-integration-workflow/__tests__/steps/github-webhook.test.ts`

```typescript
import { describe, it, expect } from 'vitest';

describe('Webhook Capture', () => {
  it('should capture and store webhook', async () => {
    const webhook = {
      event: 'test',
      data: 'hello',
    };

    const response = await fetch('http://localhost:3001/relay/test-project', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(webhook),
    });

    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result.received).toBe(true);
    expect(result.webhookId).toBeDefined();
  });
});
```

---

## Important Notes

### State Management
- State is the SINGLE SOURCE OF TRUTH
- Always use `state.get()` before `state.set()` to preserve existing data
- Use typed interfaces for state objects

### Streams
- ONE stream only: `webhookFeed`
- Stream is notification, NOT data storage
- Simple payload: `{ webhookId, status, timestamp }`
- UI re-fetches from state API after receiving stream update

### Status States
- Exactly 3 states: `received`, `forwarded`, `failed`
- Do NOT add: `processing`, `retrying`, `queued`

### Error Handling
- Always try-catch async operations
- Log errors with context
- Return appropriate HTTP status codes
- Update state and stream on failure

### Logging
- Use structured logging: `logger.info('message', { metadata })`
- Include webhookId, projectId in all logs
- Log before and after state changes

---

## Quick Start Commands

```bash
# Initialize project
npx motia init webhook-relay
cd webhook-relay

# Install dependencies
npm install

# Generate types
npm run generate-types

# Start dev server
npm run dev

# View Workbench
# Open http://localhost:3000
```

---

## Common Pitfalls to Avoid

1. **Do NOT** store webhook data in streams (use state)
2. **Do NOT** add complex status transitions
3. **Do NOT** use Python (TypeScript only)
4. **Do NOT** add exponential backoff (simple counter only)
5. **Do NOT** implement multiple signature providers
6. **Do NOT** create batch operations
7. **Do NOT** add analytics/search in MVP
8. **Do NOT** forget to update both state AND stream

---

## Success Checklist

- [ ] Webhook captured in < 100ms
- [ ] State persistence works
- [ ] Stream updates in real-time
- [ ] Replay forwards correctly
- [ ] Error handling graceful
- [ ] Logging comprehensive
- [ ] Workbench shows flows
- [ ] Zero crashes in demo

---

## Additional References

### Motia Documentation
- Official docs: https://www.motia.dev/docs
- GitHub repo: https://github.com/MotiaDev/motia
- Examples repo: https://github.com/MotiaDev/motia-examples

### Related Examples to Study
1. Queue example (DLQ patterns)
2. Stripe payment (webhook handling)
3. GitHub integration (event routing)
4. Meeting transcription (streaming)

---

**Last Updated:** 2025-12-15
**For Hackathon:** Backend Reloaded (Dec 15-21, 2025)
