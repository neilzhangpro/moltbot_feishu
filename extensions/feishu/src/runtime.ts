import type { PluginRuntime } from "clawdbot/plugin-sdk";

let runtime: PluginRuntime | null = null;

/**
 * 设置飞书插件运行时
 */
export function setFeishuRuntime(next: PluginRuntime) {
  runtime = next;
}

/**
 * 获取飞书插件运行时，如果未初始化则抛出错误
 */
export function getFeishuRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("Feishu runtime not initialized");
  }
  return runtime;
}
