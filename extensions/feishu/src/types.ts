/**
 * 飞书配置类型定义
 */

/** 飞书账户配置 */
export type FeishuAccountConfig = {
  enabled?: boolean;
  appId?: string;
  appSecret?: string;
  /** DM 策略：open=开放, pairing=配对, allowlist=白名单 */
  dmPolicy?: "open" | "pairing" | "allowlist";
  /** 允许的用户 ID 列表（open_id 或 user_id） */
  allowFrom?: string[];
  /** 群组配置 */
  groups?: Record<string, unknown>;
};

/** 飞书频道配置（在 channels.feishu 下） */
export type FeishuChannelConfig = FeishuAccountConfig & {
  /** 多账户支持 */
  accounts?: Record<string, FeishuAccountConfig>;
};

/** 解析后的飞书账户 */
export type ResolvedFeishuAccount = {
  accountId: string;
  name?: string;
  enabled: boolean;
  appId?: string;
  appSecret?: string;
  config: FeishuAccountConfig;
};

/** 飞书事件消息类型 */
export type FeishuMessageEvent = {
  schema?: string;
  header?: {
    event_id?: string;
    event_type?: string;
    create_time?: string;
    token?: string;
    app_id?: string;
    tenant_key?: string;
  };
  event?: {
    sender?: {
      sender_id?: {
        open_id?: string;
        user_id?: string;
        union_id?: string;
      };
      sender_type?: string;
      tenant_key?: string;
    };
    message?: {
      message_id?: string;
      root_id?: string;
      parent_id?: string;
      create_time?: string;
      chat_id?: string;
      chat_type?: string; // "p2p" | "group"
      message_type?: string; // "text" | "image" | ...
      content?: string; // JSON string
      mentions?: Array<{
        key?: string;
        id?: {
          open_id?: string;
          user_id?: string;
          union_id?: string;
        };
        name?: string;
        tenant_key?: string;
      }>;
    };
  };
};

/** 飞书消息内容（解析后的 content JSON） */
export type FeishuTextContent = {
  text?: string;
};

/** 飞书发送消息请求 */
export type FeishuSendMessageRequest = {
  receive_id: string;
  msg_type: "text" | "interactive" | "image" | "post";
  content: string;
};

/** 飞书发送消息响应 */
export type FeishuSendMessageResponse = {
  code?: number;
  msg?: string;
  data?: {
    message_id?: string;
    root_id?: string;
    parent_id?: string;
    create_time?: string;
    chat_id?: string;
    sender?: {
      id?: string;
      id_type?: string;
      sender_type?: string;
      tenant_key?: string;
    };
  };
};

// ============ 事件数据类型 ============

/** 用户进入与机器人会话事件 (im.chat.access_event.bot_p2p_chat_entered_v1) */
export type FeishuUserEnteredChatEvent = {
  chat_id?: string;
  operator_id?: {
    open_id?: string;
    user_id?: string;
    union_id?: string;
  };
};

/** 用户进群事件 (im.chat.member.user.added_v1) */
export type FeishuUserAddedToGroupEvent = {
  chat_id?: string;
  operator_id?: {
    open_id?: string;
    user_id?: string;
    union_id?: string;
  };
  users?: Array<{
    user_id?: {
      open_id?: string;
      user_id?: string;
      union_id?: string;
    };
    name?: string;
    tenant_key?: string;
  }>;
};

/** 文件事件 (drive.file.*) */
export type FeishuFileEvent = {
  file_token?: string;
  file_type?: string;
  folder_token?: string;
  operator_id?: {
    open_id?: string;
    user_id?: string;
    union_id?: string;
  };
};

/** 日历事件 (calendar.calendar.*) */
export type FeishuCalendarEvent = {
  calendar_id?: string;
  user_id_list?: Array<{
    open_id?: string;
    user_id?: string;
    union_id?: string;
  }>;
};

// ============ 命令系统类型 ============

/** 支持的命令类型 */
export type CommandType = "announcement" | "add_member" | "remove_member" | "list_members";

/** 解析后的命令 */
export type ParsedCommand = {
  /** 命令类型 */
  type: CommandType;
  /** 命令参数（去除命令前缀后的文本） */
  args: string;
  /** 命令中@提及的用户 open_id 列表 */
  mentionedUserIds: string[];
};

/** 群成员信息 */
export type GroupMember = {
  /** 成员 open_id */
  memberId: string;
  /** 成员名称 */
  name?: string;
  /** 成员角色：群主、管理员、普通成员 */
  role?: "owner" | "admin" | "member";
};

/** 命令执行上下文 */
export type CommandContext = {
  /** 群 ID */
  chatId: string;
  /** 发起者 open_id */
  senderId: string;
  /** 原始消息 ID（用于回复） */
  messageId: string;
  /** 消息中的@提及列表 */
  mentions: Array<{
    key?: string;
    id?: { open_id?: string };
    name?: string;
  }>;
};

/** 命令执行结果 */
export type CommandResult = {
  /** 是否执行成功 */
  success: boolean;
  /** 返回给用户的消息 */
  message: string;
};
