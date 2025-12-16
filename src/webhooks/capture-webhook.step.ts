import type { ApiRouteConfig, Handlers } from "motia";
import { generateWebhookId } from "../types/webhook.types";
import { z } from "zod";

export const config: ApiRouteConfig = {
  name: "CaptureWebhook",
  type: "api",
  description: "Universal webhook capture endpoint",
  path: "/relay/:projectId",
  method: "POST",
  emits: [{ topic: "webhook-captured", label: "Webhook Captured" }],
  flows: ["webhook-relay"],
  responseSchema: {
    200: z.object({
      webhookId: z.string(),
      status: z.string(),
    }),
  },
};

export const handler: Handlers["CaptureWebhook"] = async (
  req,
  { emit, logger }
) => {
  const { projectId } = req.pathParams;
  const webhookId = generateWebhookId();

  logger.info("Webhook captured", { webhookId, projectId });

  await emit({
    topic: "webhook-captured",
    data: {
      webhookId,
      projectId,
      method: "POST",
      headers: req.headers,
      body: req.body,
      receivedAt: new Date().toISOString(),
    },
  });

  return {
    status: 200,
    body: {
      webhookId,
      status: "received",
    },
  };
};
