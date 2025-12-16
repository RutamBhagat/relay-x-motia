import type { ApiRouteConfig, Handlers } from "motia";
import { z } from "zod";
import type { StoredWebhook } from "../types/webhook.types";

const bodySchema = z.object({
  targetUrl: z.url(),
});

export const config: ApiRouteConfig = {
  name: "ReplayWebhook",
  type: "api",
  path: "/webhooks/:id/replay",
  method: "POST",
  description: "Replay webhook to target URL",
  emits: [{ topic: "webhook-forward", label: "Forward Webhook" }],
  flows: ["webhook-relay"],
  bodySchema,
  responseSchema: {
    200: z.object({
      webhookId: z.string(),
      status: z.string(),
    }),
    404: z.object({ error: z.string() }),
  },
};

export const handler: Handlers["ReplayWebhook"] = async (
  req,
  { emit, logger, state }
) => {
  const { id } = req.pathParams;
  const { targetUrl } = bodySchema.parse(req.body);

  logger.info("Replaying webhook", { webhookId: id, targetUrl });

  const webhook = await state.get<StoredWebhook>("webhooks", id);
  if (!webhook) {
    logger.warn("Webhook not found for replay", { webhookId: id });
    return {
      status: 404,
      body: { error: "Webhook not found" },
    };
  }

  await emit({
    topic: "webhook-forward",
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
      status: "accepted",
    },
  };
};
