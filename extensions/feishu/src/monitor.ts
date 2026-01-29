import * as lark from "@larksuiteoapi/node-sdk";

import type { MoltbotConfig } from "clawdbot/plugin-sdk";

import type { ResolvedFeishuAccount, FeishuTextContent } from "./types.js";
import { replyFeishuMessage } from "./api.js";
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

  // 创建事件分发器
  // 重要：飞书长连接模式要求事件处理在 3 秒内完成，否则会触发超时重推
  // 因此这里不等待 handleMessageEvent 完成，立即返回让 SDK 发送 ACK
  const eventDispatcher = new lark.EventDispatcher({}).register({
    "im.message.receive_v1": (data) => {
      runtime.log?.(`[feishu:${account.accountId}] *** RECEIVED EVENT im.message.receive_v1 ***`);
      runtime.log?.(`[feishu:${account.accountId}] event data: ${JSON.stringify(data).slice(0, 500)}`);

      // 异步处理消息，不等待完成（避免超过 3 秒超时）
      handleMessageEvent(data, { account, config, runtime, statusSink }).catch((err) => {
        runtime.error?.(
          `[feishu:${account.accountId}] error handling message: ${err instanceof Error ? err.message : String(err)}`,
        );
      });

      // 立即返回，让 SDK 发送 ACK 确认
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
