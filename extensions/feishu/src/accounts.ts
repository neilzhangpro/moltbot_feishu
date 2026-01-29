import type { MoltbotConfig } from "clawdbot/plugin-sdk";
import { DEFAULT_ACCOUNT_ID } from "clawdbot/plugin-sdk";

import type { FeishuChannelConfig, ResolvedFeishuAccount } from "./types.js";

/**
 * 获取飞书频道配置
 */
function getFeishuConfig(cfg: MoltbotConfig): FeishuChannelConfig | undefined {
  return cfg.channels?.feishu as FeishuChannelConfig | undefined;
}

/**
 * 列出所有飞书账户 ID
 */
export function listFeishuAccountIds(cfg: MoltbotConfig): string[] {
  const feishu = getFeishuConfig(cfg);
  if (!feishu) return [];

  const ids = new Set<string>();

  // 如果有顶级配置（appId），添加默认账户
  if (feishu.appId) {
    ids.add(DEFAULT_ACCOUNT_ID);
  }

  // 添加 accounts 下的所有账户
  if (feishu.accounts) {
    for (const id of Object.keys(feishu.accounts)) {
      ids.add(id);
    }
  }

  return Array.from(ids);
}

/**
 * 解析默认账户 ID
 */
export function resolveDefaultFeishuAccountId(cfg: MoltbotConfig): string {
  const ids = listFeishuAccountIds(cfg);
  if (ids.includes(DEFAULT_ACCOUNT_ID)) return DEFAULT_ACCOUNT_ID;
  return ids[0] ?? DEFAULT_ACCOUNT_ID;
}

/**
 * 解析飞书账户配置
 */
export function resolveFeishuAccount(params: {
  cfg: MoltbotConfig;
  accountId?: string | null;
}): ResolvedFeishuAccount {
  const { cfg, accountId } = params;
  const feishu = getFeishuConfig(cfg);
  const resolvedId = accountId ?? DEFAULT_ACCOUNT_ID;

  // 尝试从 accounts 获取
  const accountConfig = feishu?.accounts?.[resolvedId];

  // 如果是默认账户或没有找到特定账户配置，使用顶级配置
  const useTopLevel = resolvedId === DEFAULT_ACCOUNT_ID || !accountConfig;
  const baseConfig = useTopLevel ? feishu : accountConfig;

  const appId = baseConfig?.appId?.trim() || undefined;
  const appSecret = baseConfig?.appSecret?.trim() || undefined;

  return {
    accountId: resolvedId,
    enabled: baseConfig?.enabled !== false,
    appId,
    appSecret,
    config: {
      enabled: baseConfig?.enabled,
      appId,
      appSecret,
      dmPolicy: baseConfig?.dmPolicy,
      allowFrom: baseConfig?.allowFrom,
      groups: baseConfig?.groups,
    },
  };
}

/**
 * 检查账户是否已配置（有 appId 和 appSecret）
 */
export function isFeishuAccountConfigured(account: ResolvedFeishuAccount): boolean {
  return Boolean(account.appId && account.appSecret);
}
