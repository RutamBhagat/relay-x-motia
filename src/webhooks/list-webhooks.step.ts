import type { ApiRouteConfig, Handlers } from "motia";
import { z } from "zod";
import {
  StoredWebhookSchema,
  type StoredWebhook,
} from "../types/webhook.types";

export const config: ApiRouteConfig = {
  name: "ListWebhooks",
  type: "api",
  path: "/webhooks",
  method: "GET",
  description: "List all webhooks with optional filtering",
  emits: [],
  flows: ["webhook-relay"],
  queryParams: [
    { name: "projectId", description: "Filter by project ID" },
    { name: "limit", description: "Max results (default 50)" },
    { name: "offset", description: "Skip N results (default 0)" },
  ],
  responseSchema: {
    200: z.object({
      webhooks: z.array(StoredWebhookSchema),
      total: z.number(),
      limit: z.number(),
      offset: z.number(),
    }),
  },
};

export const handler: Handlers["ListWebhooks"] = async (
  req,
  { logger, state }
) => {
  const projectId = req.queryParams.projectId as string | undefined;
  const limit = parseInt(req.queryParams.limit as string) || 50;
  const offset = parseInt(req.queryParams.offset as string) || 0;

  logger.info("Listing webhooks", { projectId, limit, offset });

  // Get all webhooks from state
  const allWebhooks = await state.getGroup<StoredWebhook>("webhooks");

  // Filter by projectId if provided
  let filtered = allWebhooks;
  if (projectId) {
    filtered = allWebhooks.filter((wh) => wh.projectId === projectId);
  }

  // Sort by receivedAt descending (newest first)
  const sorted = filtered.sort(
    (a, b) =>
      new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime()
  );

  // Paginate
  const paginated = sorted.slice(offset, offset + limit);

  logger.info("Webhooks retrieved", {
    total: filtered.length,
    returned: paginated.length,
  });

  return {
    status: 200,
    body: {
      webhooks: paginated,
      total: filtered.length,
      limit,
      offset,
    },
  };
};
