import { StreamConfig } from "motia";
import { z } from "zod";

export const config: StreamConfig = {
  name: "webhookFeed",
  schema: z.object({
    id: z.string(),
    projectId: z.string(),
    method: z.string(),
    receivedAt: z.iso.datetime(),
    status: z.enum(["received", "forwarded", "failed", "retrying", "dlq"]),
    targetUrl: z.url().optional(),
    errorMessage: z.string().optional(),
    retryCount: z.number().default(0),
  }),
  baseConfig: { storageType: "default" },
};
