import type { ApiRouteConfig, Handlers } from "motia";
import { z } from "zod";
import type { StoredWebhook } from "../types/webhook.types";

export const config: ApiRouteConfig = {
  name: "ListFailedWebhooks",
  type: "api",
  description: "List all failed and DLQ webhooks",
  path: "/webhooks/failed",
  method: "GET",
  emits: [],
  flows: ["webhook-relay"],
  responseSchema: {
    200: z.object({
      webhooks: z.array(
        z.object({
          id: z.string(),
          projectId: z.string(),
          status: z.enum(["failed", "dlq", "retrying"]),
          receivedAt: z.iso.datetime(),
          targetUrl: z.url().optional(),
          errorMessage: z.string().optional(),
          retryCount: z.number(),
          lastRetryAt: z.iso.datetime().optional(),
          dlqAt: z.iso.datetime().optional(),
        })
      ),
      total: z.number(),
    }),
  },
};

// Type guard for failed webhooks
const isFailedWebhook = (
  webhook: StoredWebhook
): webhook is StoredWebhook & { status: "failed" | "dlq" | "retrying" } => {
  return (
    webhook.status === "failed" ||
    webhook.status === "dlq" ||
    webhook.status === "retrying"
  );
};

export const handler: Handlers["ListFailedWebhooks"] = async (
  req,
  { logger, state }
) => {
  logger.info("Listing failed webhooks");

  // Get all webhooks from state
  const allWebhooks = await state.getGroup<StoredWebhook>("webhooks");

  // Filter for failed, retrying, and DLQ webhooks
  const failedWebhooks = allWebhooks.filter(isFailedWebhook);

  // Map to response format
  const webhooks = failedWebhooks.map((webhook) => ({
    id: webhook.id,
    projectId: webhook.projectId,
    status: webhook.status,
    receivedAt: webhook.receivedAt,
    targetUrl: webhook.targetUrl,
    errorMessage: webhook.errorMessage,
    retryCount: webhook.retryCount || 0,
    lastRetryAt: webhook.lastRetryAt,
    dlqAt: webhook.dlqAt,
  }));

  logger.info("Failed webhooks retrieved", { count: webhooks.length });

  return {
    status: 200,
    body: {
      webhooks,
      total: webhooks.length,
    },
  };
};
