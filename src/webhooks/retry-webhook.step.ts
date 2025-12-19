import type { ApiRouteConfig, Handlers } from "motia";
import { z } from "zod";
import type { StoredWebhook } from "../types/webhook.types";

export const config: ApiRouteConfig = {
  name: "RetryWebhook",
  type: "api",
  description: "Manually retry a failed or DLQ webhook",
  path: "/webhooks/:id/retry",
  method: "POST",
  emits: [{ topic: "webhook-forward", label: "Retry Webhook Forward" }],
  flows: ["webhook-relay"],
  responseSchema: {
    200: z.object({
      message: z.string(),
      webhookId: z.string(),
    }),
    404: z.object({
      error: z.string(),
    }),
    400: z.object({
      error: z.string(),
    }),
  },
};

export const handler: Handlers["RetryWebhook"] = async (
  req,
  { emit, logger, state }
) => {
  const { id } = req.pathParams;

  logger.info("Manual retry requested", { webhookId: id });

  const webhook = await state.get<StoredWebhook>("webhooks", id);

  if (!webhook) {
    logger.warn("Webhook not found", { webhookId: id });
    return {
      status: 404,
      body: {
        error: "Webhook not found",
      },
    };
  }

  if (!webhook.targetUrl) {
    logger.warn("Webhook has no target URL", { webhookId: id });
    return {
      status: 400,
      body: {
        error: "Webhook has no target URL to retry",
      },
    };
  }

  // Reset status for retry
  webhook.status = "retrying";
  webhook.retryCount = (webhook.retryCount || 0) + 1;
  webhook.lastRetryAt = new Date().toISOString();
  await state.set("webhooks", id, webhook);

  // Re-emit to webhook-forward topic
  await emit({
    topic: "webhook-forward",
    data: {
      webhookId: id,
      targetUrl: webhook.targetUrl,
      headers: webhook.headers,
      body: webhook.body,
    },
  });

  logger.info("Webhook retry initiated", { webhookId: id });

  return {
    status: 200,
    body: {
      message: "Webhook retry initiated",
      webhookId: id,
    },
  };
};
