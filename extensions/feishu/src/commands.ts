/**
 * 飞书群管理命令处理器
 * 支持：/公告、/拉人、/踢人、/成员
 */

import type { ResolvedFeishuAccount, CommandType, ParsedCommand, CommandContext, CommandResult } from "./types.js";
import {
  isUserGroupAdmin,
  updateGroupAnnouncement,
  addMembersToGroup,
  removeMembersFromGroup,
  getGroupMembers,
} from "./api.js";

// ============ 命令定义 ============

/** 命令前缀映射 */
const COMMAND_PREFIXES: Record<CommandType, string[]> = {
  announcement: ["/公告", "/announcement"],
  add_member: ["/拉人", "/add"],
  remove_member: ["/踢人", "/kick", "/remove"],
  list_members: ["/成员", "/members"],
};

/** 需要管理员权限的命令 */
const ADMIN_REQUIRED_COMMANDS: CommandType[] = ["announcement", "add_member", "remove_member"];

// ============ 命令解析 ============

/**
 * 解析消息文本，识别命令类型和参数
 * @param text 消息文本（已移除@机器人标记）
 * @param mentions 消息中的@提及列表
 * @returns 解析结果，如果不是命令则返回 null
 */
export function parseCommand(
  text: string,
  mentions: Array<{ key?: string; id?: { open_id?: string }; name?: string }>,
): ParsedCommand | null {
  const trimmedText = text.trim();

  // 遍历所有命令前缀，检查是否匹配
  for (const [cmdType, prefixes] of Object.entries(COMMAND_PREFIXES)) {
    for (const prefix of prefixes) {
      if (trimmedText.startsWith(prefix)) {
        // 提取命令参数（命令前缀后的内容）
        const args = trimmedText.slice(prefix.length).trim();

        // 提取@提及的用户 ID（排除机器人自身）
        const mentionedUserIds = mentions
          .filter((m) => m.id?.open_id)
          .map((m) => m.id!.open_id!);

        return {
          type: cmdType as CommandType,
          args,
          mentionedUserIds,
        };
      }
    }
  }

  return null;
}

/**
 * 检查命令是否需要管理员权限
 */
export function requiresAdminPermission(cmdType: CommandType): boolean {
  return ADMIN_REQUIRED_COMMANDS.includes(cmdType);
}

// ============ 命令执行 ============

/**
 * 执行命令（包含权限检查）
 */
export async function executeCommand(params: {
  account: ResolvedFeishuAccount;
  command: ParsedCommand;
  context: CommandContext;
}): Promise<CommandResult> {
  const { account, command, context } = params;
  const { type, args, mentionedUserIds } = command;
  const { chatId, senderId } = context;

  // 权限检查：需要管理员权限的命令
  if (requiresAdminPermission(type)) {
    const permResult = await isUserGroupAdmin({ account, chatId, userId: senderId });

    if (permResult.error) {
      return {
        success: false,
        message: `权限检查失败：${permResult.error}`,
      };
    }

    if (!permResult.isAdmin && !permResult.isOwner) {
      return {
        success: false,
        message: "抱歉，只有群主或管理员才能执行此操作。",
      };
    }
  }

  // 根据命令类型执行对应操作
  switch (type) {
    case "announcement":
      return executeAnnouncementCommand(account, chatId, args);
    case "add_member":
      return executeAddMemberCommand(account, chatId, mentionedUserIds);
    case "remove_member":
      return executeRemoveMemberCommand(account, chatId, mentionedUserIds);
    case "list_members":
      return executeListMembersCommand(account, chatId);
    default:
      return { success: false, message: "未知命令" };
  }
}

/**
 * 执行公告命令
 */
async function executeAnnouncementCommand(
  account: ResolvedFeishuAccount,
  chatId: string,
  content: string,
): Promise<CommandResult> {
  if (!content.trim()) {
    return { success: false, message: "请提供公告内容。用法：/公告 <公告内容>" };
  }

  const result = await updateGroupAnnouncement({ account, chatId, content });

  if (result.success) {
    return { success: true, message: "群公告已更新。" };
  }
  return { success: false, message: `更新公告失败：${result.error}` };
}

/**
 * 执行拉人命令
 */
async function executeAddMemberCommand(
  account: ResolvedFeishuAccount,
  chatId: string,
  memberIds: string[],
): Promise<CommandResult> {
  if (memberIds.length === 0) {
    return { success: false, message: "请@要拉入群聊的用户。用法：/拉人 @用户1 @用户2" };
  }

  const result = await addMembersToGroup({ account, chatId, memberIds });

  if (result.success) {
    const invalidNote =
      result.invalidIds && result.invalidIds.length > 0
        ? `（${result.invalidIds.length} 个用户无效或已在群内）`
        : "";
    return { success: true, message: `已拉入 ${memberIds.length} 个用户${invalidNote}` };
  }
  return { success: false, message: `拉人失败：${result.error}` };
}

/**
 * 执行踢人命令
 */
async function executeRemoveMemberCommand(
  account: ResolvedFeishuAccount,
  chatId: string,
  memberIds: string[],
): Promise<CommandResult> {
  if (memberIds.length === 0) {
    return { success: false, message: "请@要移除的用户。用法：/踢人 @用户" };
  }

  const result = await removeMembersFromGroup({ account, chatId, memberIds });

  if (result.success) {
    const invalidNote =
      result.invalidIds && result.invalidIds.length > 0
        ? `（${result.invalidIds.length} 个用户无效或不在群内）`
        : "";
    return { success: true, message: `已移除 ${memberIds.length} 个用户${invalidNote}` };
  }
  return { success: false, message: `移除用户失败：${result.error}` };
}

/**
 * 执行成员列表命令
 */
async function executeListMembersCommand(
  account: ResolvedFeishuAccount,
  chatId: string,
): Promise<CommandResult> {
  const result = await getGroupMembers({ account, chatId });

  if (result.error) {
    return { success: false, message: `获取成员列表失败：${result.error}` };
  }

  const members = result.members;
  if (members.length === 0) {
    return { success: true, message: "群内暂无成员信息。" };
  }

  // 格式化成员列表
  const memberList = members
    .slice(0, 50) // 限制显示前 50 个
    .map((m, i) => `${i + 1}. ${m.name ?? m.memberId}`)
    .join("\n");

  const moreNote = members.length > 50 ? `\n... 共 ${members.length} 人` : `\n共 ${members.length} 人`;

  return { success: true, message: `群成员列表：\n${memberList}${moreNote}` };
}
