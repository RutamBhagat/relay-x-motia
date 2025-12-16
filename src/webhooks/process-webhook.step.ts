import type { EventConfig, Handlers } from "motia";
import { z } from "zod";

const inputSchema = z.object({
  webhookId: z.string(),
  projectId: z.string(),
  method: z.string(),
  headers: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
  body: z.unknown(),
  receivedAt: z.iso.datetime(),
});

export const config: EventConfig = {
  name: "ProcessWebhook",
  type: "event",
  description: "Process captured webhook and store in state",
  subscribes: ["webhook-captured"],
  emits: [],
  flows: ["webhook-relay"],
  input: inputSchema,
};

export const handler: Handlers["ProcessWebhook"] = async (
  input,
  { logger, state }
) => {
  const { webhookId, projectId, method, headers, body, receivedAt } = input;

  logger.info("Processing webhook", { webhookId, projectId });

  await state.set("webhooks", webhookId, {
    id: webhookId,
    projectId,
    method,
    headers,
    body,
    receivedAt,
    status: "received",
  });

  logger.info("Webhook stored in state", { webhookId });
};
