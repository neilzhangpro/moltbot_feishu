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

    // 尝试获取机器人信息来验证凭证（使用 request 方式调用）
    const response = (await client.request({
      method: "GET",
      url: "/open-apis/bot/v3/info",
    })) as { code?: number; msg?: string };

    if (response.code !== 0) {
      return {
        ok: false,
        error: response.msg ?? "Unknown error",
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
      const response = (await client.im.v1.chat.list({
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

// ============ 群管理 API ============

/** 机器人信息缓存（避免重复请求） */
const botInfoCache = new Map<string, { openId: string; name?: string }>();

/**
 * 获取机器人自身信息（用于检测@机器人）
 * 结果会被缓存，避免重复调用
 */
export async function getBotInfo(account: ResolvedFeishuAccount): Promise<{
  openId?: string;
  name?: string;
  error?: string;
}> {
  const cacheKey = account.appId ?? "";

  // 检查缓存
  const cached = botInfoCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const client = getFeishuClient(account);
    // 使用 request 方式调用机器人信息 API
    const response = (await client.request({
      method: "GET",
      url: "/open-apis/bot/v3/info",
    })) as {
      code?: number;
      msg?: string;
      // bot 字段直接在响应体根级别
      bot?: {
        open_id?: string;
        app_name?: string;
      };
    };

    if (response.code !== 0) {
      return { error: response.msg ?? `Feishu API error: ${response.code}` };
    }

    const result = {
      openId: response.bot?.open_id,
      name: response.bot?.app_name,
    };

    // 缓存结果
    if (result.openId) {
      botInfoCache.set(cacheKey, { openId: result.openId, name: result.name });
    }

    return result;
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 获取群成员列表
 * 需要权限: im:chat:readonly
 */
export async function getGroupMembers(params: {
  account: ResolvedFeishuAccount;
  chatId: string;
}): Promise<{
  members: Array<{ memberId: string; name?: string; role?: string }>;
  error?: string;
}> {
  const { account, chatId } = params;
  const members: Array<{ memberId: string; name?: string; role?: string }> = [];
  let pageToken: string | undefined;

  try {
    const client = getFeishuClient(account);

    // 分页获取群成员
    do {
      const response = (await client.im.v1.chat.members.get({
        path: { chat_id: chatId },
        params: {
          member_id_type: "open_id",
          page_size: 100,
          page_token: pageToken,
        },
      })) as {
        code?: number;
        msg?: string;
        data?: {
          items?: Array<{
            member_id?: string;
            name?: string;
            member_id_type?: string;
          }>;
          member_list?: Array<{
            member_id?: string;
            name?: string;
            member_id_type?: string;
          }>;
          page_token?: string;
          has_more?: boolean;
        };
      };

      if (response.code !== 0) {
        return { members: [], error: response.msg ?? `Feishu API error: ${response.code}` };
      }

      // 飞书 API 可能返回 items 或 member_list
      const items = response.data?.items ?? response.data?.member_list ?? [];
      for (const item of items) {
        if (item.member_id) {
          members.push({
            memberId: item.member_id,
            name: item.name,
          });
        }
      }

      pageToken = response.data?.has_more ? response.data.page_token : undefined;
    } while (pageToken);

    return { members };
  } catch (err) {
    return { members: [], error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 获取群信息（包含群主 ID）
 * 需要权限: im:chat:readonly
 */
export async function getGroupInfo(params: {
  account: ResolvedFeishuAccount;
  chatId: string;
}): Promise<{
  ownerId?: string;
  name?: string;
  error?: string;
}> {
  const { account, chatId } = params;

  try {
    const client = getFeishuClient(account);
    const response = (await client.im.v1.chat.get({
      path: { chat_id: chatId },
      params: { user_id_type: "open_id" },
    })) as {
      code?: number;
      msg?: string;
      data?: {
        owner_id?: string;
        name?: string;
      };
    };

    if (response.code !== 0) {
      return { error: response.msg ?? `Feishu API error: ${response.code}` };
    }

    return {
      ownerId: response.data?.owner_id,
      name: response.data?.name,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 检查用户是否是群管理员或群主
 * 需要权限: im:chat:readonly
 */
export async function isUserGroupAdmin(params: {
  account: ResolvedFeishuAccount;
  chatId: string;
  userId: string;
}): Promise<{ isAdmin: boolean; isOwner: boolean; error?: string }> {
  const { account, chatId, userId } = params;

  try {
    // 获取群信息以判断群主
    const groupInfo = await getGroupInfo({ account, chatId });
    if (groupInfo.error) {
      return { isAdmin: false, isOwner: false, error: groupInfo.error };
    }

    const isOwner = groupInfo.ownerId === userId;

    // 如果是群主，直接返回
    if (isOwner) {
      return { isAdmin: true, isOwner: true };
    }

    // 获取群管理员列表
    const client = getFeishuClient(account);
    const response = (await client.im.v1.chat.managers.get({
      path: { chat_id: chatId },
      params: { user_id_type: "open_id" },
    })) as {
      code?: number;
      msg?: string;
      data?: {
        items?: Array<{ manager_id?: string }>;
      };
    };

    if (response.code !== 0) {
      // 如果获取管理员列表失败，仅返回群主判断结果
      return { isAdmin: false, isOwner: false, error: response.msg };
    }

    const managers = response.data?.items ?? [];
    const isAdmin = managers.some((m) => m.manager_id === userId);

    return { isAdmin, isOwner: false };
  } catch (err) {
    return { isAdmin: false, isOwner: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 将用户拉入群聊
 * 需要权限: im:chat:member（机器人需要在群内且有邀请权限）
 */
export async function addMembersToGroup(params: {
  account: ResolvedFeishuAccount;
  chatId: string;
  memberIds: string[];
}): Promise<{ success: boolean; invalidIds?: string[]; error?: string }> {
  const { account, chatId, memberIds } = params;

  if (memberIds.length === 0) {
    return { success: false, error: "没有指定要添加的用户" };
  }

  try {
    const client = getFeishuClient(account);
    const response = (await client.im.v1.chat.members.create({
      path: { chat_id: chatId },
      params: { member_id_type: "open_id" },
      data: { id_list: memberIds },
    })) as {
      code?: number;
      msg?: string;
      data?: {
        invalid_id_list?: string[];
        not_existed_id_list?: string[];
      };
    };

    if (response.code !== 0) {
      return { success: false, error: response.msg ?? `Feishu API error: ${response.code}` };
    }

    const invalidIds = [
      ...(response.data?.invalid_id_list ?? []),
      ...(response.data?.not_existed_id_list ?? []),
    ];

    return {
      success: true,
      invalidIds: invalidIds.length > 0 ? invalidIds : undefined,
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 移除群成员
 * 需要权限: im:chat:member（机器人需要是群主或管理员）
 */
export async function removeMembersFromGroup(params: {
  account: ResolvedFeishuAccount;
  chatId: string;
  memberIds: string[];
}): Promise<{ success: boolean; invalidIds?: string[]; error?: string }> {
  const { account, chatId, memberIds } = params;

  if (memberIds.length === 0) {
    return { success: false, error: "没有指定要移除的用户" };
  }

  try {
    const client = getFeishuClient(account);
    const response = (await client.im.v1.chat.members.delete({
      path: { chat_id: chatId },
      params: { member_id_type: "open_id" },
      data: { id_list: memberIds },
    })) as {
      code?: number;
      msg?: string;
      data?: {
        invalid_id_list?: string[];
      };
    };

    if (response.code !== 0) {
      return { success: false, error: response.msg ?? `Feishu API error: ${response.code}` };
    }

    return {
      success: true,
      invalidIds: response.data?.invalid_id_list,
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 更新群公告
 * 需要权限: im:chat（机器人需要是群主或管理员）
 */
export async function updateGroupAnnouncement(params: {
  account: ResolvedFeishuAccount;
  chatId: string;
  content: string;
}): Promise<{ success: boolean; error?: string }> {
  const { account, chatId, content } = params;

  if (!content.trim()) {
    return { success: false, error: "公告内容不能为空" };
  }

  try {
    const client = getFeishuClient(account);
    const response = (await client.im.v1.chat.announcement.patch({
      path: { chat_id: chatId },
      data: { content },
    })) as {
      code?: number;
      msg?: string;
    };

    if (response.code !== 0) {
      return { success: false, error: response.msg ?? `Feishu API error: ${response.code}` };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
