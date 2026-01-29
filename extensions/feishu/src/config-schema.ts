import { z } from "zod";

/**
 * 飞书频道配置 Zod Schema
 */
export const FeishuConfigSchema = z.object({
  enabled: z.boolean().optional(),
  appId: z.string().optional(),
  appSecret: z.string().optional(),
  dmPolicy: z.enum(["open", "pairing", "allowlist"]).optional(),
  allowFrom: z.array(z.string()).optional(),
  groups: z.record(z.any()).optional(),
  accounts: z
    .record(
      z.object({
        enabled: z.boolean().optional(),
        appId: z.string().optional(),
        appSecret: z.string().optional(),
        dmPolicy: z.enum(["open", "pairing", "allowlist"]).optional(),
        allowFrom: z.array(z.string()).optional(),
        groups: z.record(z.any()).optional(),
      }),
    )
    .optional(),
});

export type FeishuConfig = z.infer<typeof FeishuConfigSchema>;
