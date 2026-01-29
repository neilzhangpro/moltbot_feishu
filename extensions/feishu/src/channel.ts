import type { ChannelPlugin, MoltbotConfig } from "clawdbot/plugin-sdk";
import { DEFAULT_ACCOUNT_ID } from "clawdbot/plugin-sdk";

import {
  listFeishuAccountIds,
  resolveDefaultFeishuAccountId,
  resolveFeishuAccount,
  isFeishuAccountConfigured,
} from "./accounts.js";
import { sendFeishuMessage, probeFeishu } from "./api.js";
import { monitorFeishuProvider, stopFeishuMonitor } from "./monitor.js";
import { feishuOnboardingAdapter } from "./onboarding.js";
import type { ResolvedFeishuAccount } from "./types.js";

/** 频道元信息 */
const meta = {
  id: "feishu",
  label: "飞书",
  selectionLabel: "Feishu/Lark",
  docsPath: "/channels/feishu",
  docsLabel: "feishu",
  blurb: "飞书/Lark 企业通讯平台",
  aliases: ["lark"],
  order: 80,
} as const;

/**
 * 飞书频道插件
 */
export const feishuPlugin: ChannelPlugin<ResolvedFeishuAccount> = {
  id: "feishu",
  meta: {
    ...meta,
  },
  capabilities: {
    chatTypes: ["direct", "group"],
    reactions: false,
    threads: false,
    media: false,
    nativeCommands: false,
    blockStreaming: true,
  },
  reload: { configPrefixes: ["channels.feishu"] },
  // 直接提供 JSON Schema（避免 zod toJSONSchema 兼容性问题）
  configSchema: {
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        enabled: { type: "boolean" },
        appId: { type: "string" },
        appSecret: { type: "string" },
        dmPolicy: { type: "string", enum: ["open", "pairing", "allowlist"] },
        allowFrom: { type: "array", items: { type: "string" } },
        accounts: {
          type: "object",
          additionalProperties: {
            type: "object",
            properties: {
              enabled: { type: "boolean" },
              appId: { type: "string" },
              appSecret: { type: "string" },
              dmPolicy: { type: "string", enum: ["open", "pairing", "allowlist"] },
              allowFrom: { type: "array", items: { type: "string" } },
            },
          },
        },
      },
    },
    uiHints: {
      enabled: { label: "启用" },
      appId: { label: "App ID", placeholder: "cli_xxxxxxxx" },
      appSecret: { label: "App Secret", sensitive: true },
      dmPolicy: { label: "DM 策略" },
      allowFrom: { label: "允许列表" },
    },
  },

  // =========================================================================
  // 配置适配器
  // =========================================================================
  config: {
    listAccountIds: (cfg) => listFeishuAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveFeishuAccount({ cfg, accountId }),
    defaultAccountId: (cfg) => resolveDefaultFeishuAccountId(cfg),
    setAccountEnabled: ({ cfg, accountId, enabled }) => {
      const resolvedAccountId = accountId ?? DEFAULT_ACCOUNT_ID;
      if (resolvedAccountId === DEFAULT_ACCOUNT_ID) {
        return {
          ...cfg,
          channels: {
            ...cfg.channels,
            feishu: {
              ...cfg.channels?.feishu,
              enabled,
            },
          },
        };
      }
      return {
        ...cfg,
        channels: {
          ...cfg.channels,
          feishu: {
            ...cfg.channels?.feishu,
            accounts: {
              ...(cfg.channels?.feishu as Record<string, unknown>)?.accounts,
              [resolvedAccountId]: {
                ...((cfg.channels?.feishu as Record<string, unknown>)?.accounts as Record<
                  string,
                  unknown
                >)?.[resolvedAccountId],
                enabled,
              },
            },
          },
        },
      };
    },
    deleteAccount: ({ cfg, accountId }) => {
      const next = { ...cfg } as MoltbotConfig;
      const nextChannels = { ...cfg.channels };
      if (accountId === DEFAULT_ACCOUNT_ID) {
        delete nextChannels.feishu;
      } else {
        const feishu = { ...(nextChannels.feishu as Record<string, unknown>) };
        const accounts = { ...(feishu.accounts as Record<string, unknown>) };
        delete accounts[accountId];
        if (Object.keys(accounts).length === 0) {
          delete feishu.accounts;
        } else {
          feishu.accounts = accounts;
        }
        nextChannels.feishu = feishu;
      }
      if (Object.keys(nextChannels).length > 0) {
        next.channels = nextChannels;
      } else {
        delete next.channels;
      }
      return next;
    },
    isConfigured: (account) => isFeishuAccountConfigured(account),
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: isFeishuAccountConfigured(account),
    }),
    resolveAllowFrom: ({ cfg, accountId }) =>
      resolveFeishuAccount({ cfg, accountId }).config.allowFrom ?? [],
    formatAllowFrom: ({ allowFrom }) =>
      allowFrom
        .map((entry) => String(entry).trim())
        .filter(Boolean)
        .map((entry) => entry.toLowerCase()),
  },

  // =========================================================================
  // 安全适配器
  // =========================================================================
  security: {
    resolveDmPolicy: ({ cfg, accountId, account }) => {
      const resolvedAccountId = accountId ?? account.accountId ?? DEFAULT_ACCOUNT_ID;
      const useAccountPath = Boolean(
        (cfg.channels?.feishu as Record<string, unknown>)?.accounts?.[resolvedAccountId],
      );
      const basePath = useAccountPath
        ? `channels.feishu.accounts.${resolvedAccountId}.`
        : "channels.feishu.";
      return {
        policy: account.config.dmPolicy ?? "open",
        allowFrom: account.config.allowFrom ?? [],
        policyPath: `${basePath}dmPolicy`,
        allowFromPath: basePath,
        approveHint: 'Add user open_id to channels.feishu.allowFrom: ["ou_xxx"]',
        normalizeEntry: (raw) => raw.replace(/^(feishu|user):/i, ""),
      };
    },
  },

  // =========================================================================
  // Onboarding 适配器
  // =========================================================================
  onboarding: feishuOnboardingAdapter,

  // =========================================================================
  // 设置适配器
  // =========================================================================
  setup: {
    resolveAccountId: () => DEFAULT_ACCOUNT_ID,
    applyAccountConfig: ({ cfg, accountId, input }) => {
      const resolvedAccountId = accountId ?? DEFAULT_ACCOUNT_ID;
      if (resolvedAccountId === DEFAULT_ACCOUNT_ID) {
        return {
          ...cfg,
          channels: {
            ...cfg.channels,
            feishu: {
              ...cfg.channels?.feishu,
              enabled: true,
              ...(input.token ? { appId: input.token } : {}),
            },
          },
        };
      }
      return {
        ...cfg,
        channels: {
          ...cfg.channels,
          feishu: {
            ...cfg.channels?.feishu,
            enabled: true,
            accounts: {
              ...(cfg.channels?.feishu as Record<string, unknown>)?.accounts,
              [resolvedAccountId]: {
                ...((cfg.channels?.feishu as Record<string, unknown>)?.accounts as Record<
                  string,
                  unknown
                >)?.[resolvedAccountId],
                enabled: true,
              },
            },
          },
        },
      };
    },
  },

  // =========================================================================
  // 出站适配器
  // =========================================================================
  outbound: {
    deliveryMode: "direct",
    textChunkLimit: 2000,
    sendText: async ({ to, text, accountId, cfg }) => {
      const account = resolveFeishuAccount({ cfg, accountId });
      const result = await sendFeishuMessage({
        account,
        chatId: to,
        text,
        receiveIdType: "chat_id",
      });
      return {
        channel: "feishu",
        messageId: result.messageId,
        ok: result.success,
        error: result.error ? new Error(result.error) : undefined,
      };
    },
    sendMedia: async ({ to, text, accountId, cfg }) => {
      // 暂不支持媒体，先发送文本
      const account = resolveFeishuAccount({ cfg, accountId });
      const result = await sendFeishuMessage({
        account,
        chatId: to,
        text: text || "[媒体消息暂不支持]",
        receiveIdType: "chat_id",
      });
      return {
        channel: "feishu",
        messageId: result.messageId,
        ok: result.success,
        error: result.error ? new Error(result.error) : undefined,
      };
    },
  },

  // =========================================================================
  // 状态适配器
  // =========================================================================
  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    buildChannelSummary: ({ snapshot }) => ({
      configured: snapshot.configured ?? false,
      running: snapshot.running ?? false,
      lastStartAt: snapshot.lastStartAt ?? null,
      lastStopAt: snapshot.lastStopAt ?? null,
      lastError: snapshot.lastError ?? null,
      probe: snapshot.probe,
      lastProbeAt: snapshot.lastProbeAt ?? null,
    }),
    probeAccount: async ({ account }) => {
      if (!isFeishuAccountConfigured(account)) {
        return { ok: false, error: "missing appId or appSecret" };
      }
      return await probeFeishu(account);
    },
    buildAccountSnapshot: ({ account, runtime, probe }) => {
      const configured = isFeishuAccountConfigured(account);
      return {
        accountId: account.accountId,
        name: account.name,
        enabled: account.enabled,
        configured,
        running: runtime?.running ?? false,
        lastStartAt: runtime?.lastStartAt ?? null,
        lastStopAt: runtime?.lastStopAt ?? null,
        lastError: runtime?.lastError ?? null,
        probe,
        lastInboundAt: runtime?.lastInboundAt ?? null,
        lastOutboundAt: runtime?.lastOutboundAt ?? null,
      };
    },
  },

  // =========================================================================
  // 网关适配器
  // =========================================================================
  gateway: {
    startAccount: async (ctx) => {
      const { account, cfg, abortSignal, log } = ctx;

      if (!isFeishuAccountConfigured(account)) {
        throw new Error("Feishu appId and appSecret are required");
      }

      log?.info(`[${account.accountId}] starting Feishu provider`);

      // 启动监控并返回监控器对象
      return monitorFeishuProvider({
        account,
        config: cfg,
        runtime: {
          log: (msg) => log?.info(msg),
          error: (msg) => log?.error(msg),
        },
        abortSignal,
      });
    },
    stopAccount: async (ctx) => {
      const { account, log } = ctx;
      log?.info(`[${account.accountId}] stopping Feishu provider`);
      // 停止由返回的监控器对象的 stop() 方法处理
      stopFeishuMonitor(account.accountId);
    },
  },
};
