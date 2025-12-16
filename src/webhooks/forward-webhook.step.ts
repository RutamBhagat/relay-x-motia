import type { EventConfig, Handlers } from "motia";
import { z } from "zod";
import type { StoredWebhook } from "../types/webhook.types";

const inputSchema = z.object({
  webhookId: z.string(),
  targetUrl: z.string(),
  headers: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
  body: z.unknown(),
});

export const config: EventConfig = {
  name: "ForwardWebhook",
  type: "event",
  description: "Forward webhook to target URL",
  subscribes: ["webhook-forward"],
  emits: [],
  flows: ["webhook-relay"],
  input: inputSchema,
};

export const handler: Handlers["ForwardWebhook"] = async (
  input,
  { traceId, logger, state }
) => {
  const { webhookId, targetUrl, headers, body } = input;

  logger.info("Forwarding webhook", { traceId, webhookId, targetUrl });

  try {
    // NOTE: Forward only Content-Type header (clean forwarding)
    const forwardHeaders: Record<string, string> = {};
    const contentType = headers["content-type"];
    if (contentType) {
      forwardHeaders["Content-Type"] = Array.isArray(contentType)
        ? contentType[0]
        : contentType;
    }

    const response = await fetch(targetUrl, {
      method: "POST",
      headers: forwardHeaders,
      body: JSON.stringify(body),
    });

    const webhook = await state.get<StoredWebhook>("webhooks", webhookId);
    if (webhook) {
      webhook.status = response.ok ? "forwarded" : "failed";
      webhook.forwardedAt = new Date().toISOString();
      webhook.targetUrl = targetUrl;
      if (!response.ok) {
        webhook.errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      }
      await state.set("webhooks", webhookId, webhook);
    }

    logger.info("Webhook forwarded", {
      traceId,
      webhookId,
      targetUrl,
      status: response.status,
    });
  } catch (error) {
    logger.error("Webhook forward failed", {
      traceId,
      webhookId,
      targetUrl,
      error: error instanceof Error ? error.message : "Unknown error",
    });

    const webhook = await state.get<StoredWebhook>("webhooks", webhookId);
    if (webhook) {
      webhook.status = "failed";
      webhook.forwardedAt = new Date().toISOString();
      webhook.targetUrl = targetUrl;
      webhook.errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      await state.set("webhooks", webhookId, webhook);
    }
  }
};
