import type { MoltbotConfig, DmPolicy } from "clawdbot/plugin-sdk";
import {
  addWildcardAllowFrom,
  formatDocsLink,
  type ChannelOnboardingAdapter,
  type ChannelOnboardingDmPolicy,
  type WizardPrompter,
  DEFAULT_ACCOUNT_ID,
} from "clawdbot/plugin-sdk";

import {
  listFeishuAccountIds,
  resolveDefaultFeishuAccountId,
  resolveFeishuAccount,
} from "./accounts.js";

const channel = "feishu" as const;

/**
 * 设置飞书 DM 策略
 */
function setFeishuDmPolicy(cfg: MoltbotConfig, policy: DmPolicy): MoltbotConfig {
  const allowFrom =
    policy === "open"
      ? addWildcardAllowFrom(cfg.channels?.["feishu"]?.allowFrom as string[] | undefined)
      : undefined;
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      feishu: {
        ...(cfg.channels?.["feishu"] ?? {}),
        dmPolicy: policy,
        ...(allowFrom ? { allowFrom } : {}),
      },
    },
  };
}

/**
 * 解析用户输入的白名单
 */
function parseAllowFromInput(raw: string): string[] {
  return raw
    .split(/[\n,;]+/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * 引导用户输入白名单
 */
async function promptAllowFrom(params: {
  cfg: MoltbotConfig;
  prompter: WizardPrompter;
}): Promise<MoltbotConfig> {
  const current = (params.cfg.channels?.["feishu"] as Record<string, unknown>)?.allowFrom as
    | string[]
    | undefined;
  const entry = await params.prompter.text({
    message: "飞书 allowFrom（用户 open_id）",
    placeholder: "ou_xxxxxxxx, ou_yyyyyyyy",
    defaultValue: current?.join(", ") ?? "",
  });

  if (!entry) {
    return params.cfg;
  }

  const allowFrom = parseAllowFromInput(entry);
  return {
    ...params.cfg,
    channels: {
      ...params.cfg.channels,
      feishu: {
        ...(params.cfg.channels?.["feishu"] ?? {}),
        allowFrom,
      },
    },
  };
}

/**
 * 飞书频道 Onboarding 适配器
 */
export const feishuOnboardingAdapter: ChannelOnboardingAdapter = {
  channel,

  listAccountIds: (cfg) => listFeishuAccountIds(cfg),

  defaultAccountId: (cfg) => resolveDefaultFeishuAccountId(cfg),

  async promptCredentials(params) {
    const { cfg, prompter, accountId: rawAccountId } = params;
    const accountId = rawAccountId ?? DEFAULT_ACCOUNT_ID;

    prompter.intro?.(`配置飞书频道 (${accountId})`);
    prompter.note?.(
      `需要在飞书开放平台创建企业自建应用。\n详见: ${formatDocsLink("/channels/feishu")}`,
    );

    // 获取当前配置
    const existing = resolveFeishuAccount({ cfg, accountId });

    // 引导输入 App ID
    const appId = await prompter.text({
      message: "App ID",
      placeholder: "cli_xxxxxxxxxxxxxxxx",
      defaultValue: existing.appId ?? "",
      validate: (val) => {
        if (!val?.trim()) return "App ID 是必填项";
        if (!val.startsWith("cli_")) return "App ID 应该以 cli_ 开头";
        return undefined;
      },
    });

    if (!appId) {
      return { cfg, cancelled: true };
    }

    // 引导输入 App Secret
    const appSecret = await prompter.password({
      message: "App Secret",
      validate: (val) => {
        if (!val?.trim()) return "App Secret 是必填项";
        return undefined;
      },
    });

    if (!appSecret) {
      return { cfg, cancelled: true };
    }

    // 构建新配置
    const nextCfg: MoltbotConfig = {
      ...cfg,
      channels: {
        ...cfg.channels,
        feishu: {
          ...(cfg.channels?.["feishu"] ?? {}),
          enabled: true,
          appId: appId.trim(),
          appSecret: appSecret.trim(),
        },
      },
    };

    return { cfg: nextCfg };
  },

  async promptDmPolicy(params) {
    const { cfg, prompter, accountId } = params;
    const account = resolveFeishuAccount({ cfg, accountId });
    const currentPolicy = account.config.dmPolicy ?? "open";

    const options: ChannelOnboardingDmPolicy[] = [
      { label: "开放（允许所有人）", value: "open", hint: "任何人都可以发送消息" },
      {
        label: "白名单（仅允许指定用户）",
        value: "allowlist",
        hint: "只有 allowFrom 中的用户可以发送消息",
      },
      { label: "配对模式（需要审批）", value: "pairing", hint: "新用户需要通过配对审批" },
    ];

    const policyChoice = await prompter.select({
      message: "DM 策略",
      options: options.map((o) => ({ label: o.label, value: o.value, hint: o.hint })),
      initialValue: currentPolicy,
    });

    if (!policyChoice) {
      return { cfg };
    }

    let nextCfg = setFeishuDmPolicy(cfg, policyChoice as DmPolicy);

    // 如果选择白名单模式，引导输入白名单
    if (policyChoice === "allowlist") {
      nextCfg = await promptAllowFrom({ cfg: nextCfg, prompter });
    }

    return { cfg: nextCfg };
  },

  resolveAccountName: (params) => {
    const account = resolveFeishuAccount({ cfg: params.cfg, accountId: params.accountId });
    return account.appId ? `飞书 (${account.appId.slice(0, 10)}...)` : "飞书";
  },

  isConfigured: (params) => {
    const account = resolveFeishuAccount({ cfg: params.cfg, accountId: params.accountId });
    return Boolean(account.appId && account.appSecret);
  },
};
