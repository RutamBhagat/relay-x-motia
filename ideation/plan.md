# Hackathon Project Idea

## Webhook Relay & Debugger

**Tagline:** Production-ready webhook inspection, storage, and replay system with real-time streaming

---

## Instructions for LLM Assistant

**IMPORTANT:** As you complete each subsection of the implementation plan below, mark it complete by changing `[ ]` to `[x]`. This tracks progress and helps identify what remains.

Update checkboxes immediately after completing each task. Do not batch updates.

---

## Problem Statement

Developers debugging webhooks face critical challenges:
- Webhooks arrive at unpredictable times
- Local development environments unreachable from internet
- No persistent audit trail of webhook payloads
- Cannot replay webhooks to test bug fixes
- Difficult to inspect full request details (headers, body, metadata)

Current solutions like ngrok or webhook.site solve parts but require multiple tools and lack programmatic replay.

---

## Solution

Motia-powered webhook relay that captures, persists, displays in real-time, and enables replay to any target URL. Single unified tool for complete webhook debugging workflow.

**Core Flow:**
1. Point webhook provider to relay endpoint
2. Webhooks captured and stored instantly
3. Real-time feed shows new arrivals
4. Inspect full request details
5. Replay to local/staging environment on demand

---

## Must-Have Features (MVP)

### 1. Universal Webhook Capture
- [ ] `POST /relay/:projectId` - catch-all endpoint
- [ ] Returns 200 immediately
- [ ] Generates unique webhook ID
- [ ] Accepts any JSON/form payload

### 2. Persistent Storage
- [ ] Full request data (headers, body, metadata)
- [ ] Timestamp tracking
- [ ] Status tracking (received, forwarded, failed)
- [ ] Stored in Motia state management

### 3. List Webhooks API
- [ ] `GET /webhooks` - list all captured webhooks
- [ ] Filter by projectId
- [ ] Paginated results (simple limit/offset)

### 4. Webhook Detail API
- [ ] `GET /webhooks/:id` - fetch single webhook
- [ ] Returns complete request data
- [ ] View headers, body, timestamps

### 5. Replay Functionality
- [ ] `POST /webhooks/:id/replay` - resend webhook
- [ ] Specify target URL in request
- [ ] Tracks replay attempts and results
- [ ] Updates status on success/failure

---

## Motia Superpowers Leveraged

### Event-Driven Architecture
```
Webhook API → emit('webhook-captured')
            → Process Event
            → Forward Event
            → Stream Update
```

### State Management
```typescript
// Persistent storage across steps
await state.set('webhooks', id, { headers, body, status })
const webhook = await state.get('webhooks', id)
```

### Real-Time Streaming
```typescript
// Live updates (notification only, state is truth)
await streams.webhookFeed.update({ webhookId, status, timestamp })
```

### Built-in Observability
- End-to-end request tracing
- Workbench flow visualization
- Structured logging

---

## Technical Architecture

### 5 Steps Total

**API Steps (4):**
- Capture webhook endpoint
- List webhooks
- Get webhook details
- Replay webhook

**Event Steps (2):**
- Process captured webhook
- Forward to target URL

**No Streams (MVP):**
- Workbench provides observability

### Data Flow

**Capture:**
```
POST /relay/123
  → Capture API
  → emit('webhook-captured')
  → Process Event: store in state
  → Stream update
```

**Replay:**
```
POST /webhooks/abc123/replay
  → Replay API
  → emit('webhook-forward')
  → Forward Event: HTTP POST to target
  → Update state with result
  → Stream update
```

---

## Implementation Patterns (from Motia Examples)

### Pattern 1: Webhook Receiver
Reference: `repos/motia-examples/examples/integrations/payment/stripe-payment-demo/steps/api/stripe-webhook.step.ts`

- API route configuration
- Event emission pattern
- Response schemas with Zod

### Pattern 2: State Storage & Replay
Reference: `repos/motia-examples/examples/getting-started/queue-example/steps/queue-tests/dlq/dlq-retry.step.ts`

- Persistent state storage
- Data retrieval patterns
- Re-emission for replay logic

### Pattern 3: Real-time Streams
Reference: `repos/motia-examples/examples/advanced-use-cases/meeting-transcription/meeting_transcript_example/steps/meeting-transcription.stream.ts`

- Stream schema design
- Status enum patterns
- Simple notification payloads

---

## Why This Wins (Technical Excellence)

### 1. Solves Real Developer Problem
- Addresses actual pain point in webhook-heavy applications
- Clear before/after improvement story
- Immediately understandable use case

### 2. Deterministic & Reliable
- Pure logic, no LLM unpredictability
- Predictable outcomes
- Easy to test and demonstrate

### 3. Shows Motia's Core Strengths
- Event-driven workflows (capture → process → forward)
- State persistence across steps
- Real-time streaming capabilities
- Built-in observability and tracing

### 4. Clean Demo Narrative
```
1. Send test webhook via curl
2. Shows up in live feed instantly
3. Inspect full details
4. Replay to local server
5. See Workbench flow visualization
```

### 5. Extensible Architecture
- Easy to explain future additions
- Clean separation of concerns
- Production-ready patterns

---

## 5-Day Implementation Plan

### Phase 1 (Day 1-2): Core System
- [ ] Init Motia project (motia init, install plugins)
- [ ] Webhook capture endpoint (POST /relay/:projectId)
- [ ] State storage implementation
- [ ] Detail fetch API (GET /webhooks/:id)
- [ ] Basic replay forwarding (fetch to targetUrl)
- [ ] Test with curl (send webhook, verify storage)

**Stop check: If these work, valid project exists**

### Phase 2 (Day 3): List & Polish
- [ ] List webhooks API (GET /webhooks)
- [ ] Error handling cleanup
- [ ] Workbench verification (visualize flows)

**Stop check: Backend now visible to judges**

### Phase 3 (Day 4): Testing & Hardening
- [ ] End-to-end testing (capture → retrieve → replay)
- [ ] Edge case handling (invalid URLs, missing webhooks)
- [ ] Logging refinement

### Day 5: Demo Prep
- [ ] README documentation with architecture
- [ ] Demo script (capture → list → view → replay)
- [ ] Screenshots of Workbench flows
- [ ] Presentation practice
- [ ] Test demo flow 3+ times

---

## Tech Stack

**Backend:**
- TypeScript only (no Python)
- Zod for validation
- Native fetch() for HTTP forwarding

**Plugins:**
- @motiadev/plugin-endpoint
- @motiadev/plugin-states
- @motiadev/plugin-logs
- @motiadev/plugin-observability

**Frontend:**
- None (backend-only demo with curl/Postman)
- Workbench provides visualization

---

## Extensions (If Time Permits)

### Tier 1 (only if core is rock-solid)
- [ ] Simple retry counter (no backoff logic)
- [ ] Export webhook as JSON file

### Skip Entirely (out of scope)
- [ ] Signature verification (Stripe/GitHub)
- [ ] Real-time streams
- [ ] Batch replay
- [ ] Analytics/metrics
- [ ] Rate limiting
- [ ] Frontend UI

---

## Success Criteria

- [ ] Webhook arrives → stored instantly (< 100ms)
- [ ] Full request data viewable
- [ ] Replay works to any URL
- [ ] Real-time feed updates
- [ ] Clean Workbench flow visualization
- [ ] Zero crashes during demo

---

## Scope Constraints (Locked)

- **Multi-tenancy:** Simple projectId in URL
- **Target URL:** Per-replay input, not config
- **Status states:** Exactly 3 (received, forwarded, failed)
- **Retry:** Out of scope for MVP
- **Streams:** Not in MVP (Workbench provides observability)
- **State:** Single source of truth for all data

---

## Critical Files to Reference

1. **Stripe webhook handler:**
   `repos/motia-examples/examples/integrations/payment/stripe-payment-demo/steps/api/stripe-webhook.step.ts`

2. **DLQ retry system:**
   `repos/motia-examples/examples/getting-started/queue-example/steps/queue-tests/dlq/dlq-retry.step.ts`

3. **DLQ listener:**
   `repos/motia-examples/examples/getting-started/queue-example/steps/queue-tests/dlq/dlq-listener.step.ts`

4. **Meeting transcription stream:**
   `repos/motia-examples/examples/advanced-use-cases/meeting-transcription/meeting_transcript_example/steps/meeting-transcription.stream.ts`

---

## Open Questions

- [x] Decide: Frontend or backend-only demo? → **Backend-only with curl**
- [x] Decide: Which signature provider? → **None (out of scope)**

---

## Competitive Edge

- Not in existing Motia examples
- Intermediate complexity (not too simple for competition)
- Achievable in 6 days solo
- Deterministic and demo-friendly
- Shows technical depth without overengineering
