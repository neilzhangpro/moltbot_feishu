import * as lark from "@larksuiteoapi/node-sdk";

import type { MoltbotConfig } from "clawdbot/plugin-sdk";

import type {
  ResolvedFeishuAccount,
  FeishuTextContent,
  FeishuUserEnteredChatEvent,
  FeishuUserAddedToGroupEvent,
  FeishuFileEvent,
  FeishuCalendarEvent,
} from "./types.js";
import {
  replyFeishuMessage,
  sendFeishuMessage,
  sendFeishuMentionMessage,
  listBotGroups,
  broadcastToGroups,
} from "./api.js";
import { getFeishuRuntime } from "./runtime.js";

/**
 * 已处理事件 ID 缓存（用于去重）
 * 飞书长连接模式下，如果事件处理超过 3 秒，会触发超时重推
 * 通过 event_id 去重避免重复处理
 */
const processedEventIds = new Map<string, number>();
const EVENT_DEDUP_TTL = 60_000; // 60 秒后过期

/** 清理过期的事件 ID */
function cleanupExpiredEventIds(): void {
  const now = Date.now();
  for (const [id, timestamp] of processedEventIds) {
    if (now - timestamp > EVENT_DEDUP_TTL) {
      processedEventIds.delete(id);
    }
  }
}

/**
 * 检查事件是否已处理过（用于去重）
 * 如果已处理返回 true，否则记录并返回 false
 */
export function isEventProcessed(eventId: string | undefined): boolean {
  if (!eventId) return false;

  if (processedEventIds.has(eventId)) {
    return true;
  }

  processedEventIds.set(eventId, Date.now());
  cleanupExpiredEventIds();
  return false;
}

/**
 * 清除事件处理缓存（用于测试）
 */
export function clearProcessedEventIds(): void {
  processedEventIds.clear();
}

/**
 * 检查发送者是否在白名单中
 * @param senderId 发送者 ID（open_id 或 user_id）
 * @param allowFrom 白名单列表
 * @returns 如果白名单为空或发送者在白名单中返回 true
 */
export function isSenderAllowed(senderId: string, allowFrom: string[] | undefined): boolean {
  // 如果没有白名单限制，允许所有
  if (!allowFrom || allowFrom.length === 0) {
    return true;
  }

  // 规范化发送者 ID（移除前缀，转小写）
  const normalizedSenderId = senderId.toLowerCase().replace(/^(feishu|user|ou_):/i, "");

  // 检查是否在白名单中
  return allowFrom.some((entry) => {
    const normalizedEntry = entry.toLowerCase().replace(/^(feishu|user|ou_):/i, "");
    return normalizedEntry === normalizedSenderId;
  });
}

/** 飞书监控运行时环境 */
export type FeishuMonitorRuntimeEnv = {
  log?: (message: string) => void;
  error?: (message: string) => void;
};

/** 飞书监控选项 */
export type FeishuMonitorOptions = {
  account: ResolvedFeishuAccount;
  config: MoltbotConfig;
  runtime: FeishuMonitorRuntimeEnv;
  abortSignal: AbortSignal;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
};

/** 飞书 Provider 监控器返回类型 */
export interface FeishuProviderMonitor {
  account: ResolvedFeishuAccount;
  stop: () => void;
}

/** 活跃的 WebSocket 客户端 */
const activeClients = new Map<string, lark.WSClient>();

/**
 * 启动飞书消息监听（长连接模式）
 * 返回一个监控器对象，包含 stop 方法
 */
export async function monitorFeishuProvider(options: FeishuMonitorOptions): Promise<FeishuProviderMonitor> {
  const { account, config, runtime, abortSignal, statusSink } = options;

  if (!account.appId || !account.appSecret) {
    throw new Error("Feishu appId and appSecret are required");
  }

  const clientKey = `${account.accountId}:${account.appId}`;

  // 如果已有客户端在运行，先停止
  const existingClient = activeClients.get(clientKey);
  if (existingClient) {
    runtime.log?.(`[feishu:${account.accountId}] stopping existing client`);
    existingClient.stop();
    activeClients.delete(clientKey);
  }

  runtime.log?.(`[feishu:${account.accountId}] starting WebSocket client`);

  // 事件处理上下文
  const eventContext = { account, config, runtime, statusSink };

  // 错误处理函数
  const handleEventError = (eventType: string, err: unknown) => {
    runtime.error?.(
      `[feishu:${account.accountId}] error handling ${eventType}: ${err instanceof Error ? err.message : String(err)}`,
    );
  };

  // 创建事件分发器
  // 重要：飞书长连接模式要求事件处理在 3 秒内完成，否则会触发超时重推
  // 因此这里不等待事件处理完成，立即返回让 SDK 发送 ACK
  const eventDispatcher = new lark.EventDispatcher({}).register({
    // ============ 消息事件 ============
    "im.message.receive_v1": (data) => {
      runtime.log?.(`[feishu:${account.accountId}] *** RECEIVED EVENT im.message.receive_v1 ***`);
      runtime.log?.(`[feishu:${account.accountId}] event data: ${JSON.stringify(data).slice(0, 500)}`);

      // 异步处理消息，不等待完成（避免超过 3 秒超时）
      handleMessageEvent(data, eventContext).catch((err) => handleEventError("im.message.receive_v1", err));
    },

    // ============ 用户进入与机器人会话 ============
    "im.chat.access_event.bot_p2p_chat_entered_v1": (data) => {
      runtime.log?.(`[feishu:${account.accountId}] *** RECEIVED EVENT bot_p2p_chat_entered_v1 ***`);
      runtime.log?.(`[feishu:${account.accountId}] event data: ${JSON.stringify(data).slice(0, 500)}`);

      handleUserEnteredChat(data, eventContext).catch((err) =>
        handleEventError("bot_p2p_chat_entered_v1", err),
      );
    },

    // ============ 用户进群 ============
    "im.chat.member.user.added_v1": (data) => {
      runtime.log?.(`[feishu:${account.accountId}] *** RECEIVED EVENT user.added_v1 ***`);
      runtime.log?.(`[feishu:${account.accountId}] event data: ${JSON.stringify(data).slice(0, 500)}`);

      handleUserAddedToGroup(data, eventContext).catch((err) =>
        handleEventError("user.added_v1", err),
      );
    },

    // ============ 文件事件 ============
    "drive.file.created_in_folder_v1": (data) => {
      runtime.log?.(`[feishu:${account.accountId}] *** RECEIVED EVENT file.created_in_folder_v1 ***`);
      runtime.log?.(`[feishu:${account.accountId}] event data: ${JSON.stringify(data).slice(0, 500)}`);

      handleFileEvent("created", data, eventContext).catch((err) =>
        handleEventError("file.created_in_folder_v1", err),
      );
    },

    "drive.file.deleted_v1": (data) => {
      runtime.log?.(`[feishu:${account.accountId}] *** RECEIVED EVENT file.deleted_v1 ***`);
      runtime.log?.(`[feishu:${account.accountId}] event data: ${JSON.stringify(data).slice(0, 500)}`);

      handleFileEvent("deleted", data, eventContext).catch((err) =>
        handleEventError("file.deleted_v1", err),
      );
    },

    "drive.file.edit_v1": (data) => {
      runtime.log?.(`[feishu:${account.accountId}] *** RECEIVED EVENT file.edit_v1 ***`);
      runtime.log?.(`[feishu:${account.accountId}] event data: ${JSON.stringify(data).slice(0, 500)}`);

      handleFileEvent("edited", data, eventContext).catch((err) =>
        handleEventError("file.edit_v1", err),
      );
    },

    // ============ 日历事件 ============
    "calendar.calendar.changed_v4": (data) => {
      runtime.log?.(`[feishu:${account.accountId}] *** RECEIVED EVENT calendar.changed_v4 ***`);
      runtime.log?.(`[feishu:${account.accountId}] event data: ${JSON.stringify(data).slice(0, 500)}`);

      handleCalendarEvent("calendar_changed", data, eventContext).catch((err) =>
        handleEventError("calendar.changed_v4", err),
      );
    },

    "calendar.calendar.event.changed_v4": (data) => {
      runtime.log?.(`[feishu:${account.accountId}] *** RECEIVED EVENT calendar.event.changed_v4 ***`);
      runtime.log?.(`[feishu:${account.accountId}] event data: ${JSON.stringify(data).slice(0, 500)}`);

      handleCalendarEvent("event_changed", data, eventContext).catch((err) =>
        handleEventError("calendar.event.changed_v4", err),
      );
    },
  });

  runtime.log?.(`[feishu:${account.accountId}] event dispatcher created and registered`);

  // 创建 WebSocket 客户端（使用 info 级别日志以便调试）
  const wsClient = new lark.WSClient({
    appId: account.appId,
    appSecret: account.appSecret,
    loggerLevel: lark.LoggerLevel.info,
  });

  runtime.log?.(`[feishu:${account.accountId}] WebSocket client created with appId: ${account.appId?.slice(0, 10)}...`);

  activeClients.set(clientKey, wsClient);

  // 启动客户端（新版 SDK 需要在 start() 中传入 eventDispatcher）
  wsClient.start({ eventDispatcher });

  runtime.log?.(`[feishu:${account.accountId}] WebSocket client started`);

  // 停止函数
  const stop = () => {
    runtime.log?.(`[feishu:${account.accountId}] stopping WebSocket client`);
    wsClient.stop();
    activeClients.delete(clientKey);
  };

  // 监听 abort 信号
  abortSignal.addEventListener("abort", () => {
    runtime.log?.(`[feishu:${account.accountId}] stopping due to abort signal`);
    stop();
  });

  // 返回监控器对象
  return {
    account,
    stop,
  };
}

/**
 * 处理消息事件
 */
async function handleMessageEvent(
  data: unknown,
  context: {
    account: ResolvedFeishuAccount;
    config: MoltbotConfig;
    runtime: FeishuMonitorRuntimeEnv;
    statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
  },
): Promise<void> {
  const { account, config, runtime, statusSink } = context;

  // 事件去重：检查 event_id 是否已处理过
  const eventData = data as { event_id?: string };
  const eventId = eventData.event_id;

  if (isEventProcessed(eventId)) {
    runtime.log?.(`[feishu:${account.accountId}] skipping duplicate event: ${eventId}`);
    return;
  }

  const coreRuntime = getFeishuRuntime();

  // 解析事件数据
  const event = data as {
    sender?: {
      sender_id?: {
        open_id?: string;
        user_id?: string;
        union_id?: string;
      };
      sender_type?: string;
    };
    message?: {
      message_id?: string;
      chat_id?: string;
      chat_type?: string;
      message_type?: string;
      content?: string;
      mentions?: Array<{
        key?: string;
        id?: { open_id?: string };
        name?: string;
      }>;
    };
  };

  const sender = event.sender;
  const message = event.message;

  if (!message || !sender) {
    runtime.log?.(`[feishu:${account.accountId}] received event without message or sender`);
    return;
  }

  // 忽略非文本消息（暂时）
  if (message.message_type !== "text") {
    runtime.log?.(
      `[feishu:${account.accountId}] ignoring non-text message: ${message.message_type}`,
    );
    return;
  }

  // 解析消息内容
  let textContent = "";
  try {
    const content = JSON.parse(message.content ?? "{}") as FeishuTextContent;
    textContent = content.text ?? "";
  } catch {
    runtime.log?.(`[feishu:${account.accountId}] failed to parse message content`);
    return;
  }

  if (!textContent.trim()) {
    return;
  }

  const senderId = sender.sender_id?.open_id ?? sender.sender_id?.user_id ?? "unknown";
  const chatId = message.chat_id ?? "";
  const messageId = message.message_id ?? "";
  const chatType = message.chat_type === "group" ? "group" : "direct";

  runtime.log?.(
    `[feishu:${account.accountId}] received message from ${senderId}: ${textContent.slice(0, 50)}...`,
  );

  // 更新入站时间
  statusSink?.({ lastInboundAt: Date.now() });

  // 构建入站上下文（使用核心系统期望的字段名）
  const inboundContext = coreRuntime.channel.reply.finalizeInboundContext({
    Provider: "feishu",
    Surface: "feishu",
    From: senderId,
    To: chatId,
    ChatType: chatType,
    ReplyToId: messageId,
    Body: textContent,
    AccountId: account.accountId,
  });

  // 创建 reply dispatcher（用于正确处理消息分发）
  const { dispatcher, replyOptions, markDispatchIdle } =
    coreRuntime.channel.reply.createReplyDispatcherWithTyping({
      humanDelay: coreRuntime.channel.reply.resolveHumanDelayConfig(config, "main"),
      deliver: async (payload) => {
        // 使用 reply API 回复消息
        const text = payload.text ?? "";
        if (!text.trim()) return;

        const sendResult = await replyFeishuMessage({
          account,
          messageId,
          text,
        });

        if (sendResult.success) {
          statusSink?.({ lastOutboundAt: Date.now() });
          runtime.log?.(`[feishu:${account.accountId}] reply sent: ${text.slice(0, 50)}...`);
        } else {
          runtime.error?.(
            `[feishu:${account.accountId}] failed to send message: ${sendResult.error}`,
          );
        }
      },
    });

  // 调用核心分发逻辑
  try {
    await coreRuntime.channel.reply.dispatchReplyFromConfig({
      cfg: config,
      ctx: inboundContext,
      dispatcher,
      replyOptions,
    });

    // 等待所有回复发送完成
    await dispatcher.waitForIdle();
  } finally {
    // 标记分发完成
    markDispatchIdle();
  }
}

/**
 * 停止飞书监控
 */
export function stopFeishuMonitor(accountId: string): void {
  for (const [key, client] of activeClients.entries()) {
    if (key.startsWith(`${accountId}:`)) {
      client.stop();
      activeClients.delete(key);
    }
  }
}

/**
 * 停止所有飞书监控
 */
export function stopAllFeishuMonitors(): void {
  for (const [key, client] of activeClients.entries()) {
    client.stop();
    activeClients.delete(key);
  }
}

// ============ 新增事件处理函数 ============

/** 事件处理上下文类型 */
type EventHandlerContext = {
  account: ResolvedFeishuAccount;
  config: MoltbotConfig;
  runtime: FeishuMonitorRuntimeEnv;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
};

/**
 * 处理用户进入与机器人会话事件
 * 发送问候消息
 */
async function handleUserEnteredChat(
  data: unknown,
  context: EventHandlerContext,
): Promise<void> {
  const { account, runtime } = context;

  // 事件去重
  const eventData = data as { event_id?: string };
  if (isEventProcessed(eventData.event_id)) {
    runtime.log?.(`[feishu:${account.accountId}] skipping duplicate user entered event`);
    return;
  }

  const event = data as FeishuUserEnteredChatEvent;
  const chatId = event.chat_id;
  const userId = event.operator_id?.open_id;

  if (!chatId) {
    runtime.log?.(`[feishu:${account.accountId}] user entered event missing chat_id`);
    return;
  }

  runtime.log?.(`[feishu:${account.accountId}] user ${userId} entered chat ${chatId}`);

  // 发送问候消息
  const greetingMessage = "你好！我是 Moltbot 助手，有什么可以帮助你的吗？";
  const result = await sendFeishuMessage({
    account,
    chatId,
    text: greetingMessage,
    receiveIdType: "chat_id",
  });

  if (result.success) {
    runtime.log?.(`[feishu:${account.accountId}] greeting sent to chat ${chatId}`);
  } else {
    runtime.error?.(`[feishu:${account.accountId}] failed to send greeting: ${result.error}`);
  }
}

/**
 * 处理用户进群事件
 * @用户并发送欢迎语
 */
async function handleUserAddedToGroup(
  data: unknown,
  context: EventHandlerContext,
): Promise<void> {
  const { account, runtime } = context;

  // 事件去重
  const eventData = data as { event_id?: string };
  if (isEventProcessed(eventData.event_id)) {
    runtime.log?.(`[feishu:${account.accountId}] skipping duplicate user added event`);
    return;
  }

  const event = data as FeishuUserAddedToGroupEvent;
  const chatId = event.chat_id;
  const users = event.users ?? [];

  if (!chatId) {
    runtime.log?.(`[feishu:${account.accountId}] user added event missing chat_id`);
    return;
  }

  if (users.length === 0) {
    runtime.log?.(`[feishu:${account.accountId}] user added event has no users`);
    return;
  }

  runtime.log?.(`[feishu:${account.accountId}] ${users.length} user(s) added to group ${chatId}`);

  // 为每个新用户发送欢迎消息
  for (const user of users) {
    const userId = user.user_id?.open_id;
    const userName = user.name ?? "同学";

    if (!userId) {
      runtime.log?.(`[feishu:${account.accountId}] user has no open_id, skipping`);
      continue;
    }

    const welcomeMessage = "欢迎加入学习群！如有课程问题随时提问。";
    const result = await sendFeishuMentionMessage({
      account,
      chatId,
      text: welcomeMessage,
      mentionUserId: userId,
      mentionName: userName,
    });

    if (result.success) {
      runtime.log?.(`[feishu:${account.accountId}] welcome message sent to ${userName} in group ${chatId}`);
    } else {
      runtime.error?.(`[feishu:${account.accountId}] failed to send welcome: ${result.error}`);
    }
  }
}

/**
 * 处理文件事件
 * 通知到机器人所在的所有群
 */
async function handleFileEvent(
  eventType: "created" | "deleted" | "edited",
  data: unknown,
  context: EventHandlerContext,
): Promise<void> {
  const { account, runtime } = context;

  // 事件去重
  const eventData = data as { event_id?: string };
  if (isEventProcessed(eventData.event_id)) {
    runtime.log?.(`[feishu:${account.accountId}] skipping duplicate file ${eventType} event`);
    return;
  }

  const event = data as FeishuFileEvent;
  const fileToken = event.file_token ?? "未知文件";
  const fileType = event.file_type ?? "";

  runtime.log?.(`[feishu:${account.accountId}] file ${eventType}: ${fileToken} (${fileType})`);

  // 构建通知消息
  let message: string;
  switch (eventType) {
    case "created":
      message = `📄 新文件已创建：${fileToken}`;
      break;
    case "deleted":
      message = `🗑️ 文件已删除：${fileToken}`;
      break;
    case "edited":
      message = `✏️ 文件已更新：${fileToken}`;
      break;
  }

  // 获取机器人所在的所有群
  const groupsResult = await listBotGroups(account);
  if (groupsResult.error) {
    runtime.error?.(`[feishu:${account.accountId}] failed to list groups: ${groupsResult.error}`);
    return;
  }

  if (groupsResult.groups.length === 0) {
    runtime.log?.(`[feishu:${account.accountId}] no groups found for file notification`);
    return;
  }

  runtime.log?.(`[feishu:${account.accountId}] broadcasting file event to ${groupsResult.groups.length} groups`);

  // 广播到所有群
  const groupIds = groupsResult.groups.map((g) => g.chat_id);
  const broadcastResult = await broadcastToGroups({
    account,
    groupIds,
    text: message,
  });

  runtime.log?.(
    `[feishu:${account.accountId}] file event broadcast complete: ${broadcastResult.successCount} success, ${broadcastResult.failedCount} failed`,
  );
}

/**
 * 处理日历事件
 * 私聊通知相关用户
 */
async function handleCalendarEvent(
  eventType: "calendar_changed" | "event_changed",
  data: unknown,
  context: EventHandlerContext,
): Promise<void> {
  const { account, runtime } = context;

  // 事件去重
  const eventData = data as { event_id?: string };
  if (isEventProcessed(eventData.event_id)) {
    runtime.log?.(`[feishu:${account.accountId}] skipping duplicate calendar ${eventType} event`);
    return;
  }

  const event = data as FeishuCalendarEvent;
  const calendarId = event.calendar_id ?? "未知日历";
  const userIdList = event.user_id_list ?? [];

  runtime.log?.(`[feishu:${account.accountId}] calendar ${eventType}: ${calendarId}, users: ${userIdList.length}`);

  // 构建通知消息
  let message: string;
  switch (eventType) {
    case "calendar_changed":
      message = "📅 日历已更新，请查看最新日程安排。";
      break;
    case "event_changed":
      message = "📅 日程已变更，请注意时间调整。";
      break;
  }

  if (userIdList.length === 0) {
    runtime.log?.(`[feishu:${account.accountId}] no users to notify for calendar event`);
    return;
  }

  // 私聊通知每个相关用户
  for (const user of userIdList) {
    const userId = user.open_id;
    if (!userId) {
      continue;
    }

    const result = await sendFeishuMessage({
      account,
      chatId: userId,
      text: message,
      receiveIdType: "open_id",
    });

    if (result.success) {
      runtime.log?.(`[feishu:${account.accountId}] calendar notification sent to ${userId}`);
    } else {
      runtime.error?.(`[feishu:${account.accountId}] failed to notify ${userId}: ${result.error}`);
    }
  }
}
