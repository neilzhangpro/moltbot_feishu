import { describe, it, expect, beforeEach } from "vitest";

import { isEventProcessed, clearProcessedEventIds, isSenderAllowed } from "./monitor.js";

describe("isEventProcessed", () => {
  beforeEach(() => {
    // 每次测试前清理缓存
    clearProcessedEventIds();
  });

  it("returns false for undefined eventId", () => {
    expect(isEventProcessed(undefined)).toBe(false);
  });

  it("returns false for first occurrence of eventId", () => {
    expect(isEventProcessed("event-123")).toBe(false);
  });

  it("returns true for duplicate eventId", () => {
    expect(isEventProcessed("event-456")).toBe(false);
    expect(isEventProcessed("event-456")).toBe(true);
  });

  it("handles multiple different eventIds independently", () => {
    expect(isEventProcessed("event-a")).toBe(false);
    expect(isEventProcessed("event-b")).toBe(false);
    expect(isEventProcessed("event-a")).toBe(true);
    expect(isEventProcessed("event-b")).toBe(true);
    expect(isEventProcessed("event-c")).toBe(false);
  });
});

describe("isSenderAllowed", () => {
  it("allows all senders when allowFrom is undefined", () => {
    expect(isSenderAllowed("ou_123456", undefined)).toBe(true);
  });

  it("allows all senders when allowFrom is empty", () => {
    expect(isSenderAllowed("ou_123456", [])).toBe(true);
  });

  it("allows sender in allowFrom list", () => {
    expect(isSenderAllowed("ou_123456", ["ou_123456"])).toBe(true);
  });

  it("allows sender with case-insensitive matching", () => {
    expect(isSenderAllowed("ou_ABC123", ["ou_abc123"])).toBe(true);
    expect(isSenderAllowed("OU_abc123", ["ou_ABC123"])).toBe(true);
  });

  it("allows sender with prefix normalization", () => {
    expect(isSenderAllowed("ou_123456", ["feishu:ou_123456"])).toBe(true);
    expect(isSenderAllowed("feishu:ou_123456", ["ou_123456"])).toBe(true);
    expect(isSenderAllowed("user:ou_123456", ["ou_123456"])).toBe(true);
  });

  it("rejects sender not in allowFrom list", () => {
    expect(isSenderAllowed("ou_123456", ["ou_789012"])).toBe(false);
    expect(isSenderAllowed("ou_123456", ["ou_111111", "ou_222222"])).toBe(false);
  });

  it("allows sender when one of multiple entries matches", () => {
    expect(isSenderAllowed("ou_123456", ["ou_111111", "ou_123456", "ou_333333"])).toBe(true);
  });
});
