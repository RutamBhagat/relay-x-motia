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
  emits: [{ topic: "webhook-forward-dlq", label: "Forward Failed (DLQ)" }],
  flows: ["webhook-relay"],
  input: inputSchema,
};

export const handler: Handlers["ForwardWebhook"] = async (
  input,
  { traceId, logger, state, emit, streams }
) => {
  const { webhookId, targetUrl, headers, body } = input;

  logger.info("Forwarding webhook", { traceId, webhookId, targetUrl });

  let webhook = await state.get<StoredWebhook>("webhooks", webhookId);
  if (!webhook) {
    logger.error("Webhook not found in state", { webhookId });
    return;
  }

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

    // Permanent 4xx errors -> DLQ (no retry)
    if (response.status >= 400 && response.status < 500) {
      const errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      logger.warn("Permanent error - moving to DLQ", {
        webhookId,
        status: response.status,
      });

      await emit({
        topic: "webhook-forward-dlq",
        data: {
          webhookId,
          targetUrl,
          errorMessage,
          statusCode: response.status,
        },
      });

      webhook.status = "dlq";
      webhook.forwardedAt = new Date().toISOString();
      webhook.targetUrl = targetUrl;
      webhook.errorMessage = errorMessage;
      webhook.dlqAt = new Date().toISOString();
      await state.set("webhooks", webhookId, webhook);

      // Update stream feeds
      const streamData = {
        id: webhookId,
        projectId: webhook.projectId,
        method: webhook.method,
        receivedAt: webhook.receivedAt,
        status: "dlq" as const,
        targetUrl,
        errorMessage,
        retryCount: webhook.retryCount,
      };
      await streams.webhookFeed.set("global", webhookId, streamData);
      await streams.webhookFeed.set(webhook.projectId, webhookId, streamData);

      return;
    }

    // Transient 5xx/network errors -> throw for BullMQ retry
    if (!response.ok) {
      const errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      logger.warn("Transient error - will retry", {
        webhookId,
        status: response.status,
        retryCount: webhook.retryCount,
      });

      webhook.status = "retrying";
      webhook.retryCount = (webhook.retryCount || 0) + 1;
      webhook.lastRetryAt = new Date().toISOString();
      webhook.targetUrl = targetUrl;
      webhook.errorMessage = errorMessage;
      await state.set("webhooks", webhookId, webhook);

      // Update stream feeds
      const streamData = {
        id: webhookId,
        projectId: webhook.projectId,
        method: webhook.method,
        receivedAt: webhook.receivedAt,
        status: "retrying" as const,
        targetUrl,
        errorMessage,
        retryCount: webhook.retryCount,
      };
      await streams.webhookFeed.set("global", webhookId, streamData);
      await streams.webhookFeed.set(webhook.projectId, webhookId, streamData);

      throw new Error(errorMessage);
    }

    // Success
    webhook.status = "forwarded";
    webhook.forwardedAt = new Date().toISOString();
    webhook.targetUrl = targetUrl;
    await state.set("webhooks", webhookId, webhook);

    // Update stream feeds
    const streamData = {
      id: webhookId,
      projectId: webhook.projectId,
      method: webhook.method,
      receivedAt: webhook.receivedAt,
      status: "forwarded" as const,
      targetUrl,
      retryCount: webhook.retryCount,
    };
    await streams.webhookFeed.set("global", webhookId, streamData);
    await streams.webhookFeed.set(webhook.projectId, webhookId, streamData);

    logger.info("Webhook forwarded successfully", {
      traceId,
      webhookId,
      targetUrl,
      status: response.status,
    });
  } catch (error) {
    // Network errors or explicit throws from above
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    logger.error("Webhook forward failed", {
      traceId,
      webhookId,
      targetUrl,
      error: errorMessage,
    });

    webhook.status = "retrying";
    webhook.retryCount = (webhook.retryCount || 0) + 1;
    webhook.lastRetryAt = new Date().toISOString();
    webhook.targetUrl = targetUrl;
    webhook.errorMessage = errorMessage;
    await state.set("webhooks", webhookId, webhook);

    // Update stream feeds
    const streamData = {
      id: webhookId,
      projectId: webhook.projectId,
      method: webhook.method,
      receivedAt: webhook.receivedAt,
      status: "retrying" as const,
      targetUrl,
      errorMessage,
      retryCount: webhook.retryCount,
    };

    await streams.webhookFeed.set("global", webhookId, streamData);
    await streams.webhookFeed.set(webhook.projectId, webhookId, streamData);

    throw error;
  }
};
