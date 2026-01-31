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

    // 分页获取所有群（使用 request 方式调用）
    do {
      const url = pageToken
        ? `/open-apis/im/v1/chats?page_size=100&page_token=${pageToken}`
        : "/open-apis/im/v1/chats?page_size=100";

      const response = (await client.request({
        method: "GET",
        url,
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

    // 分页获取群成员（使用 request 方式调用）
    do {
      const urlParams = new URLSearchParams({
        member_id_type: "open_id",
        page_size: "100",
      });
      if (pageToken) {
        urlParams.set("page_token", pageToken);
      }

      const response = (await client.request({
        method: "GET",
        url: `/open-apis/im/v1/chats/${chatId}/members?${urlParams.toString()}`,
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
    // 使用 request 方式调用获取群信息 API
    const response = (await client.request({
      method: "GET",
      url: `/open-apis/im/v1/chats/${chatId}?user_id_type=open_id`,
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

    // 获取群管理员列表（使用 request 方式调用）
    const client = getFeishuClient(account);
    const response = (await client.request({
      method: "GET",
      url: `/open-apis/im/v1/chats/${chatId}/managers?user_id_type=open_id`,
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
    // 使用 request 方式调用添加群成员 API
    const response = (await client.request({
      method: "POST",
      url: `/open-apis/im/v1/chats/${chatId}/members?member_id_type=open_id`,
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
    // 使用 request 方式调用移除群成员 API
    const response = (await client.request({
      method: "DELETE",
      url: `/open-apis/im/v1/chats/${chatId}/members?member_id_type=open_id`,
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
 * 从 Axios 错误中提取飞书 API 错误信息
 */
function extractFeishuError(err: unknown): string {
  if (err && typeof err === "object") {
    // Axios 错误响应中可能包含飞书 API 返回的详细错误
    const axiosErr = err as {
      response?: {
        data?: { code?: number; msg?: string };
        status?: number;
      };
      message?: string;
    };
    if (axiosErr.response?.data?.msg) {
      return `${axiosErr.response.data.msg} (code: ${axiosErr.response.data.code})`;
    }
    if (axiosErr.response?.status) {
      return `HTTP ${axiosErr.response.status}: ${axiosErr.message}`;
    }
    if (axiosErr.message) {
      return axiosErr.message;
    }
  }
  return String(err);
}

/**
 * 获取群公告（旧版 API，仅适用于未升级的群组）
 * 需要权限: im:chat:readonly
 */
export async function getGroupAnnouncement(params: {
  account: ResolvedFeishuAccount;
  chatId: string;
}): Promise<{ revision?: string; content?: string; isDocxType?: boolean; error?: string }> {
  const { account, chatId } = params;

  try {
    const client = getFeishuClient(account);
    const response = (await client.request({
      method: "GET",
      url: `/open-apis/im/v1/chats/${chatId}/announcement?user_id_type=open_id`,
    })) as {
      code?: number;
      msg?: string;
      data?: {
        revision?: string;
        content?: string;
      };
    };

    if (response.code !== 0) {
      return { error: response.msg ?? `Feishu API error: ${response.code}` };
    }

    return {
      revision: response.data?.revision,
      content: response.data?.content,
    };
  } catch (err) {
    const errorMsg = extractFeishuError(err);
    // 检测是否为 docx 类型群公告（升级版）
    if (errorMsg.includes("docx type") || errorMsg.includes("232097")) {
      return { isDocxType: true, error: errorMsg };
    }
    return { error: errorMsg };
  }
}

/**
 * 更新升级版群公告（docx 类型）
 * 使用新版 docx/v1 block-based API
 * 参考文档：https://open.feishu.cn/document/ukTMukTMukTM/uUDN04SN0QjL1QDN/document-docx/docx-v1/chat-announcement-block/list
 * 需要权限: im:chat（机器人需要是群主或管理员）
 */
async function updateDocxAnnouncement(params: {
  account: ResolvedFeishuAccount;
  chatId: string;
  content: string;
}): Promise<{ success: boolean; error?: string }> {
  const { account, chatId, content } = params;
  const client = getFeishuClient(account);

  try {
    // 升级版群公告使用 docx/v1 block-based API
    // 先获取当前公告的 blocks 以获取根 block_id
    const getBlocksResponse = (await client.request({
      method: "GET",
      url: `/open-apis/docx/v1/chat_announcements/${chatId}/blocks?page_size=50`,
    })) as {
      code?: number;
      msg?: string;
      data?: {
        items?: Array<{ block_id?: string; block_type?: number; parent_id?: string }>;
      };
    };

    if (getBlocksResponse.code !== 0) {
      return { success: false, error: getBlocksResponse.msg ?? `获取公告失败: ${getBlocksResponse.code}` };
    }

    // 构建段落 block 数据结构（block_type: 2 = text/paragraph）
    const paragraphBlock = {
      block_type: 2,
      text: {
        elements: [
          {
            text_run: {
              content: content,
            },
          },
        ],
      },
    };

    const existingBlocks = getBlocksResponse.data?.items ?? [];
    // 查找第一个 page block (block_type: 1) 作为父级
    const pageBlock = existingBlocks.find((b) => b.block_type === 1);

    if (pageBlock && pageBlock.block_id) {
      // 在 page block 下创建子 block
      const createResponse = (await client.request({
        method: "POST",
        url: `/open-apis/docx/v1/chat_announcements/${chatId}/blocks/${pageBlock.block_id}/children`,
        data: {
          children: [paragraphBlock],
          index: 0, // 插入到开头
        },
      })) as {
        code?: number;
        msg?: string;
      };

      if (createResponse.code !== 0) {
        return { success: false, error: createResponse.msg ?? `创建公告失败: ${createResponse.code}` };
      }
    } else {
      // 没有找到 page block，尝试直接创建
      // 根据飞书文档，可能需要先获取根 block
      return {
        success: false,
        error: "无法找到群公告的根 block，请确保群公告已初始化",
      };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: extractFeishuError(err) };
  }
}

/**
 * 更新群公告（自动检测版本）
 * 需要权限: im:chat（机器人需要是群主或管理员）
 * 自动检测群组是否使用升级版(docx)群公告，并使用对应的 API
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

  // 先尝试获取旧版公告，检测是否为 docx 类型
  const currentAnnouncement = await getGroupAnnouncement({ account, chatId });

  // 如果是 docx 类型（升级版群公告），使用新版 API
  if (currentAnnouncement.isDocxType) {
    return updateDocxAnnouncement({ account, chatId, content });
  }

  // 如果获取旧版公告失败（非 docx 类型错误），返回错误
  if (currentAnnouncement.error && !currentAnnouncement.isDocxType) {
    return { success: false, error: `获取当前公告失败：${currentAnnouncement.error}` };
  }

  // 使用旧版 API 更新
  try {
    const client = getFeishuClient(account);
    const response = (await client.request({
      method: "PATCH",
      url: `/open-apis/im/v1/chats/${chatId}/announcement`,
      data: {
        revision: currentAnnouncement.revision ?? "0",
        content,
      },
    })) as {
      code?: number;
      msg?: string;
    };

    if (response.code !== 0) {
      return { success: false, error: response.msg ?? `Feishu API error: ${response.code}` };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: extractFeishuError(err) };
  }
}
