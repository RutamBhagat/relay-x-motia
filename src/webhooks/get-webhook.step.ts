import type { ApiRouteConfig, Handlers } from "motia";
import { z } from "zod";
import {
  StoredWebhookSchema,
  type StoredWebhook,
} from "../types/webhook.types";

export const config: ApiRouteConfig = {
  name: "GetWebhook",
  type: "api",
  path: "/webhooks/:id",
  method: "GET",
  description: "Fetch single webhook details",
  emits: [],
  flows: ["webhook-relay"],
  responseSchema: {
    200: StoredWebhookSchema,
    404: z.object({ error: z.string() }),
  },
};

export const handler: Handlers["GetWebhook"] = async (
  req,
  { logger, state }
) => {
  const { id } = req.pathParams;

  logger.info("Fetching webhook", { webhookId: id });

  const webhook = await state.get<StoredWebhook>("webhooks", id);

  if (!webhook) {
    logger.warn("Webhook not found", { webhookId: id });
    return {
      status: 404,
      body: { error: "Webhook not found" },
    };
  }

  return {
    status: 200,
    body: webhook,
  };
};
