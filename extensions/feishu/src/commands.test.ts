import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { parseCommand, requiresAdminPermission, executeCommand } from "./commands.js";
import type { ResolvedFeishuAccount, CommandContext } from "./types.js";
import * as api from "./api.js";

// ============ parseCommand 测试 ============

describe("parseCommand", () => {
  const emptyMentions: Array<{ key?: string; id?: { open_id?: string }; name?: string }> = [];

  describe("公告命令", () => {
    it("解析 /公告 命令", () => {
      const result = parseCommand("/公告 明天下午3点开会", emptyMentions);
      expect(result).not.toBeNull();
      expect(result?.type).toBe("announcement");
      expect(result?.args).toBe("明天下午3点开会");
    });

    it("解析 /announcement 命令", () => {
      const result = parseCommand("/announcement Meeting at 3pm", emptyMentions);
      expect(result).not.toBeNull();
      expect(result?.type).toBe("announcement");
      expect(result?.args).toBe("Meeting at 3pm");
    });

    it("空内容的公告命令", () => {
      const result = parseCommand("/公告", emptyMentions);
      expect(result).not.toBeNull();
      expect(result?.type).toBe("announcement");
      expect(result?.args).toBe("");
    });
  });

  describe("拉人命令", () => {
    it("解析 /拉人 命令", () => {
      const mentions = [
        { key: "@_user_1", id: { open_id: "ou_user1" }, name: "张三" },
        { key: "@_user_2", id: { open_id: "ou_user2" }, name: "李四" },
      ];
      const result = parseCommand("/拉人 @_user_1 @_user_2", mentions);
      expect(result).not.toBeNull();
      expect(result?.type).toBe("add_member");
      expect(result?.mentionedUserIds).toContain("ou_user1");
      expect(result?.mentionedUserIds).toContain("ou_user2");
    });

    it("解析 /add 命令", () => {
      const mentions = [{ key: "@_user_1", id: { open_id: "ou_user1" }, name: "User" }];
      const result = parseCommand("/add @_user_1", mentions);
      expect(result).not.toBeNull();
      expect(result?.type).toBe("add_member");
    });
  });

  describe("踢人命令", () => {
    it("解析 /踢人 命令", () => {
      const mentions = [{ key: "@_user_1", id: { open_id: "ou_user1" }, name: "张三" }];
      const result = parseCommand("/踢人 @_user_1", mentions);
      expect(result).not.toBeNull();
      expect(result?.type).toBe("remove_member");
      expect(result?.mentionedUserIds).toContain("ou_user1");
    });

    it("解析 /kick 命令", () => {
      const mentions = [{ key: "@_user_1", id: { open_id: "ou_user1" }, name: "User" }];
      const result = parseCommand("/kick @_user_1", mentions);
      expect(result).not.toBeNull();
      expect(result?.type).toBe("remove_member");
    });

    it("解析 /remove 命令", () => {
      const mentions = [{ key: "@_user_1", id: { open_id: "ou_user1" }, name: "User" }];
      const result = parseCommand("/remove @_user_1", mentions);
      expect(result).not.toBeNull();
      expect(result?.type).toBe("remove_member");
    });
  });

  describe("成员列表命令", () => {
    it("解析 /成员 命令", () => {
      const result = parseCommand("/成员", emptyMentions);
      expect(result).not.toBeNull();
      expect(result?.type).toBe("list_members");
    });

    it("解析 /members 命令", () => {
      const result = parseCommand("/members", emptyMentions);
      expect(result).not.toBeNull();
      expect(result?.type).toBe("list_members");
    });
  });

  describe("非命令消息", () => {
    it("普通文本返回 null", () => {
      expect(parseCommand("你好", emptyMentions)).toBeNull();
      expect(parseCommand("这是一条普通消息", emptyMentions)).toBeNull();
    });

    it("类似命令但不完全匹配返回 null", () => {
      expect(parseCommand("公告内容", emptyMentions)).toBeNull();
      expect(parseCommand("拉人入群", emptyMentions)).toBeNull();
    });

    it("命令在中间位置返回 null", () => {
      expect(parseCommand("请/公告 xxx", emptyMentions)).toBeNull();
    });
  });
});

// ============ requiresAdminPermission 测试 ============

describe("requiresAdminPermission", () => {
  it("公告命令需要管理员权限", () => {
    expect(requiresAdminPermission("announcement")).toBe(true);
  });

  it("拉人命令需要管理员权限", () => {
    expect(requiresAdminPermission("add_member")).toBe(true);
  });

  it("踢人命令需要管理员权限", () => {
    expect(requiresAdminPermission("remove_member")).toBe(true);
  });

  it("成员列表命令不需要管理员权限", () => {
    expect(requiresAdminPermission("list_members")).toBe(false);
  });
});

// ============ executeCommand 测试 ============

describe("executeCommand", () => {
  const mockAccount: ResolvedFeishuAccount = {
    accountId: "test-account",
    enabled: true,
    appId: "cli_test",
    appSecret: "test_secret",
    config: {},
  };

  const mockContext: CommandContext = {
    chatId: "oc_test_chat",
    senderId: "ou_sender",
    messageId: "msg_test",
    mentions: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("权限检查", () => {
    it("非管理员执行公告命令被拒绝", async () => {
      vi.spyOn(api, "isUserGroupAdmin").mockResolvedValue({
        isAdmin: false,
        isOwner: false,
      });

      const result = await executeCommand({
        account: mockAccount,
        command: { type: "announcement", args: "测试公告", mentionedUserIds: [] },
        context: mockContext,
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain("只有群主或管理员");
    });

    it("非管理员执行拉人命令被拒绝", async () => {
      vi.spyOn(api, "isUserGroupAdmin").mockResolvedValue({
        isAdmin: false,
        isOwner: false,
      });

      const result = await executeCommand({
        account: mockAccount,
        command: { type: "add_member", args: "", mentionedUserIds: ["ou_user1"] },
        context: mockContext,
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain("只有群主或管理员");
    });

    it("非管理员执行踢人命令被拒绝", async () => {
      vi.spyOn(api, "isUserGroupAdmin").mockResolvedValue({
        isAdmin: false,
        isOwner: false,
      });

      const result = await executeCommand({
        account: mockAccount,
        command: { type: "remove_member", args: "", mentionedUserIds: ["ou_user1"] },
        context: mockContext,
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain("只有群主或管理员");
    });

    it("非管理员可以执行成员列表命令", async () => {
      vi.spyOn(api, "getGroupMembers").mockResolvedValue({
        members: [{ memberId: "ou_user1", name: "张三" }],
      });

      const result = await executeCommand({
        account: mockAccount,
        command: { type: "list_members", args: "", mentionedUserIds: [] },
        context: mockContext,
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain("群成员列表");
    });

    it("管理员可以执行公告命令", async () => {
      vi.spyOn(api, "isUserGroupAdmin").mockResolvedValue({
        isAdmin: true,
        isOwner: false,
      });
      vi.spyOn(api, "updateGroupAnnouncement").mockResolvedValue({
        success: true,
      });

      const result = await executeCommand({
        account: mockAccount,
        command: { type: "announcement", args: "测试公告", mentionedUserIds: [] },
        context: mockContext,
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain("已更新");
    });

    it("群主可以执行管理命令", async () => {
      vi.spyOn(api, "isUserGroupAdmin").mockResolvedValue({
        isAdmin: true,
        isOwner: true,
      });
      vi.spyOn(api, "updateGroupAnnouncement").mockResolvedValue({
        success: true,
      });

      const result = await executeCommand({
        account: mockAccount,
        command: { type: "announcement", args: "测试公告", mentionedUserIds: [] },
        context: mockContext,
      });

      expect(result.success).toBe(true);
    });
  });

  describe("公告命令", () => {
    beforeEach(() => {
      vi.spyOn(api, "isUserGroupAdmin").mockResolvedValue({
        isAdmin: true,
        isOwner: false,
      });
    });

    it("空内容时提示用法", async () => {
      const result = await executeCommand({
        account: mockAccount,
        command: { type: "announcement", args: "", mentionedUserIds: [] },
        context: mockContext,
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain("请提供公告内容");
    });

    it("更新成功返回成功消息", async () => {
      vi.spyOn(api, "updateGroupAnnouncement").mockResolvedValue({
        success: true,
      });

      const result = await executeCommand({
        account: mockAccount,
        command: { type: "announcement", args: "新公告内容", mentionedUserIds: [] },
        context: mockContext,
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain("已更新");
    });

    it("更新失败返回错误消息", async () => {
      vi.spyOn(api, "updateGroupAnnouncement").mockResolvedValue({
        success: false,
        error: "权限不足",
      });

      const result = await executeCommand({
        account: mockAccount,
        command: { type: "announcement", args: "新公告", mentionedUserIds: [] },
        context: mockContext,
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain("失败");
    });
  });

  describe("拉人命令", () => {
    beforeEach(() => {
      vi.spyOn(api, "isUserGroupAdmin").mockResolvedValue({
        isAdmin: true,
        isOwner: false,
      });
    });

    it("未@用户时提示用法", async () => {
      const result = await executeCommand({
        account: mockAccount,
        command: { type: "add_member", args: "", mentionedUserIds: [] },
        context: mockContext,
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain("请@要拉入");
    });

    it("拉人成功返回成功消息", async () => {
      vi.spyOn(api, "addMembersToGroup").mockResolvedValue({
        success: true,
      });

      const result = await executeCommand({
        account: mockAccount,
        command: { type: "add_member", args: "", mentionedUserIds: ["ou_user1", "ou_user2"] },
        context: mockContext,
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain("已拉入");
      expect(result.message).toContain("2");
    });
  });

  describe("踢人命令", () => {
    beforeEach(() => {
      vi.spyOn(api, "isUserGroupAdmin").mockResolvedValue({
        isAdmin: true,
        isOwner: false,
      });
    });

    it("未@用户时提示用法", async () => {
      const result = await executeCommand({
        account: mockAccount,
        command: { type: "remove_member", args: "", mentionedUserIds: [] },
        context: mockContext,
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain("请@要移除");
    });

    it("踢人成功返回成功消息", async () => {
      vi.spyOn(api, "removeMembersFromGroup").mockResolvedValue({
        success: true,
      });

      const result = await executeCommand({
        account: mockAccount,
        command: { type: "remove_member", args: "", mentionedUserIds: ["ou_user1"] },
        context: mockContext,
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain("已移除");
    });
  });

  describe("成员列表命令", () => {
    it("返回成员列表", async () => {
      vi.spyOn(api, "getGroupMembers").mockResolvedValue({
        members: [
          { memberId: "ou_user1", name: "张三" },
          { memberId: "ou_user2", name: "李四" },
        ],
      });

      const result = await executeCommand({
        account: mockAccount,
        command: { type: "list_members", args: "", mentionedUserIds: [] },
        context: mockContext,
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain("张三");
      expect(result.message).toContain("李四");
      expect(result.message).toContain("共 2 人");
    });

    it("空群返回提示", async () => {
      vi.spyOn(api, "getGroupMembers").mockResolvedValue({
        members: [],
      });

      const result = await executeCommand({
        account: mockAccount,
        command: { type: "list_members", args: "", mentionedUserIds: [] },
        context: mockContext,
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain("暂无成员");
    });

    it("获取失败返回错误", async () => {
      vi.spyOn(api, "getGroupMembers").mockResolvedValue({
        members: [],
        error: "网络错误",
      });

      const result = await executeCommand({
        account: mockAccount,
        command: { type: "list_members", args: "", mentionedUserIds: [] },
        context: mockContext,
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain("失败");
    });
  });
});
