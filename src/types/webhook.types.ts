import { z } from "zod";

export const WebhookStatus = z.enum(["received", "forwarded", "failed"]);

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

export function generateWebhookId(): string {
  const timestamp = Date.now();
  const random = crypto.randomUUID();
  return `wh_${timestamp}_${random}`;
}
