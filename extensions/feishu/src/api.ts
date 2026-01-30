import * as lark from "@larksuiteoapi/node-sdk";

import type { ResolvedFeishuAccount, FeishuSendMessageResponse } from "./types.js";

/** 缓存已创建的 lark client，避免重复创建 */
const clientCache = new Map<string, lark.Client>();

/**
 * 获取或创建飞书 API 客户端
 */
export function getFeishuClient(account: ResolvedFeishuAccount): lark.Client {
  const cacheKey = `${account.appId}`;
  let client = clientCache.get(cacheKey);

  if (!client) {
    if (!account.appId || !account.appSecret) {
      throw new Error("Feishu appId and appSecret are required");
    }
    client = new lark.Client({
      appId: account.appId,
      appSecret: account.appSecret,
      disableTokenCache: false,
    });
    clientCache.set(cacheKey, client);
  }

  return client;
}

/**
 * 清除客户端缓存（用于账户登出等场景）
 */
export function clearFeishuClientCache(appId?: string): void {
  if (appId) {
    clientCache.delete(appId);
  } else {
    clientCache.clear();
  }
}

/**
 * 发送文本消息到飞书
 * @param account 账户配置
 * @param chatId 会话 ID（chat_id 或 open_id）
 * @param text 消息文本
 * @param options 可选参数
 */
export async function sendFeishuMessage(params: {
  account: ResolvedFeishuAccount;
  chatId: string;
  text: string;
  receiveIdType?: "chat_id" | "open_id" | "user_id" | "union_id";
}): Promise<{ messageId?: string; success: boolean; error?: string }> {
  const { account, chatId, text, receiveIdType = "chat_id" } = params;

  try {
    const client = getFeishuClient(account);

    // 构建消息内容
    const content = JSON.stringify({ text });

    const response = await client.im.message.create({
      params: {
        receive_id_type: receiveIdType,
      },
      data: {
        receive_id: chatId,
        msg_type: "text",
        content,
      },
    });

    const data = response as FeishuSendMessageResponse;

    if (data.code !== 0) {
      return {
        success: false,
        error: data.msg ?? `Feishu API error: ${data.code}`,
      };
    }

    return {
      success: true,
      messageId: data.data?.message_id,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * 回复飞书消息（通过 message_id）
 */
export async function replyFeishuMessage(params: {
  account: ResolvedFeishuAccount;
  messageId: string;
  text: string;
}): Promise<{ messageId?: string; success: boolean; error?: string }> {
  const { account, messageId, text } = params;

  try {
    const client = getFeishuClient(account);
    const content = JSON.stringify({ text });

    const response = await client.im.message.reply({
      path: {
        message_id: messageId,
      },
      data: {
        msg_type: "text",
        content,
      },
    });

    const data = response as FeishuSendMessageResponse;

    if (data.code !== 0) {
      return {
        success: false,
        error: data.msg ?? `Feishu API error: ${data.code}`,
      };
    }

    return {
      success: true,
      messageId: data.data?.message_id,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * 探测飞书 API 连接状态
 */
export async function probeFeishu(
  account: ResolvedFeishuAccount,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const client = getFeishuClient(account);

    // 尝试获取机器人信息来验证凭证
    const response = await client.bot.v3.botInfo.get();

    if ((response as { code?: number }).code !== 0) {
      return {
        ok: false,
        error: (response as { msg?: string }).msg ?? "Unknown error",
      };
    }

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * 获取机器人所在的所有群列表
 * 需要 im:chat:readonly 权限
 */
export async function listBotGroups(account: ResolvedFeishuAccount): Promise<{
  groups: Array<{ chat_id: string; name?: string }>;
  error?: string;
}> {
  try {
    const client = getFeishuClient(account);
    const groups: Array<{ chat_id: string; name?: string }> = [];
    let pageToken: string | undefined;

    // 分页获取所有群
    do {
      const response = (await client.im.chat.list({
        params: {
          page_size: 100,
          page_token: pageToken,
        },
      })) as {
        code?: number;
        msg?: string;
        data?: {
          items?: Array<{ chat_id?: string; name?: string }>;
          page_token?: string;
          has_more?: boolean;
        };
      };

      if (response.code !== 0) {
        return {
          groups: [],
          error: response.msg ?? `Feishu API error: ${response.code}`,
        };
      }

      const items = response.data?.items ?? [];
      for (const item of items) {
        if (item.chat_id) {
          groups.push({
            chat_id: item.chat_id,
            name: item.name,
          });
        }
      }

      pageToken = response.data?.has_more ? response.data.page_token : undefined;
    } while (pageToken);

    return { groups };
  } catch (err) {
    return {
      groups: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * 发送带 @用户 的消息到群
 * 使用富文本格式实现 @功能
 */
export async function sendFeishuMentionMessage(params: {
  account: ResolvedFeishuAccount;
  chatId: string;
  text: string;
  mentionUserId: string;
  mentionName?: string;
}): Promise<{ messageId?: string; success: boolean; error?: string }> {
  const { account, chatId, text, mentionUserId, mentionName } = params;

  try {
    const client = getFeishuClient(account);

    // 构建富文本消息内容，包含 @用户
    const content = JSON.stringify({
      zh_cn: {
        title: "",
        content: [
          [
            {
              tag: "at",
              user_id: mentionUserId,
              user_name: mentionName ?? "",
            },
            {
              tag: "text",
              text: ` ${text}`,
            },
          ],
        ],
      },
    });

    const response = await client.im.message.create({
      params: {
        receive_id_type: "chat_id",
      },
      data: {
        receive_id: chatId,
        msg_type: "post",
        content,
      },
    });

    const data = response as FeishuSendMessageResponse;

    if (data.code !== 0) {
      return {
        success: false,
        error: data.msg ?? `Feishu API error: ${data.code}`,
      };
    }

    return {
      success: true,
      messageId: data.data?.message_id,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * 批量发送消息到多个群
 */
export async function broadcastToGroups(params: {
  account: ResolvedFeishuAccount;
  groupIds: string[];
  text: string;
}): Promise<{ successCount: number; failedCount: number; errors: string[] }> {
  const { account, groupIds, text } = params;
  let successCount = 0;
  let failedCount = 0;
  const errors: string[] = [];

  // 并发发送消息到所有群
  const results = await Promise.allSettled(
    groupIds.map((chatId) =>
      sendFeishuMessage({
        account,
        chatId,
        text,
        receiveIdType: "chat_id",
      }),
    ),
  );

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled" && result.value.success) {
      successCount++;
    } else {
      failedCount++;
      const errorMsg =
        result.status === "rejected"
          ? String(result.reason)
          : result.value.error ?? "Unknown error";
      errors.push(`${groupIds[i]}: ${errorMsg}`);
    }
  }

  return { successCount, failedCount, errors };
}
