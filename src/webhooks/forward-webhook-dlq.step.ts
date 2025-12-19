import type { EventConfig, Handlers } from "motia";
import { z } from "zod";

const inputSchema = z.object({
  webhookId: z.string(),
  targetUrl: z.string(),
  errorMessage: z.string(),
  statusCode: z.number(),
});

export const config: EventConfig = {
  name: "ForwardWebhookDLQ",
  type: "event",
  description: "Handle permanently failed webhooks (Dead Letter Queue)",
  subscribes: ["webhook-forward-dlq"],
  emits: [],
  flows: ["webhook-relay"],
  input: inputSchema,
};

export const handler: Handlers["ForwardWebhookDLQ"] = async (
  input,
  { logger }
) => {
  const { webhookId, targetUrl, errorMessage, statusCode } = input;

  logger.error("Webhook permanently failed - moved to DLQ", {
    webhookId,
    targetUrl,
    errorMessage,
    statusCode,
  });

  // Future: Send alerts (Slack, email, etc.)
  // Future: Store in separate DLQ collection for analysis
};
