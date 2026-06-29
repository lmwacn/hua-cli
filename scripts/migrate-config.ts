#!/usr/bin/env ts-node

/**
 * 配置迁移脚本
 *
 * 将旧的 ~/.hua/config.json 拆分为独立的配置文件：
 * - ~/.hua/sql.json
 * - ~/.hua/ssh.json
 * - ~/.hua/http.json
 *
 * 使用方式：pnpm run migrate-config
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HUA_DIR = path.join(os.homedir(), ".hua");
const OLD_CONFIG_PATH = path.join(HUA_DIR, "config.json");

interface OldConfig {
  sql?: {
    defaultProfile?: string;
    profiles?: Record<string, unknown>;
  };
  ssh?: {
    defaultProfile?: string;
    profiles?: Record<string, unknown>;
  };
  http?: {
    defaultProfile?: string;
    profiles?: Record<string, unknown>;
  };
}

function log(message: string): void {
  console.log(`[迁移] ${message}`);
}

function error(message: string): void {
  console.error(`[错误] ${message}`);
}

function migratePluginConfig(
  pluginName: string,
  config: { defaultProfile?: string; profiles?: Record<string, unknown> } | undefined
): boolean {
  const targetPath = path.join(HUA_DIR, `${pluginName}.json`);

  // 检查目标文件是否已存在
  if (fs.existsSync(targetPath)) {
    log(`${pluginName}.json 已存在，跳过迁移`);
    return false;
  }

  // 如果旧配置中没有该插件的配置，跳过
  if (!config || !config.profiles || Object.keys(config.profiles).length === 0) {
    log(`旧配置中没有 ${pluginName} 的配置，跳过`);
    return false;
  }

  // 写入新配置文件
  const newConfig = {
    defaultProfile: config.defaultProfile,
    profiles: config.profiles,
  };

  fs.writeFileSync(targetPath, `${JSON.stringify(newConfig, null, 2)}\n`, "utf8");
  log(`已创建 ${pluginName}.json，包含 ${Object.keys(config.profiles).length} 个 profile`);
  return true;
}

function main(): void {
  console.log("=".repeat(50));
  console.log("Hua CLI 配置迁移工具");
  console.log("=".repeat(50));
  console.log();

  // 检查旧配置文件是否存在
  if (!fs.existsSync(OLD_CONFIG_PATH)) {
    log("未找到旧配置文件 ~/.hua/config.json，无需迁移");
    return;
  }

  // 读取旧配置
  let oldConfig: OldConfig;
  try {
    const raw = fs.readFileSync(OLD_CONFIG_PATH, "utf8");
    oldConfig = JSON.parse(raw) as OldConfig;
  } catch (err) {
    error(`读取旧配置文件失败: ${err}`);
    return;
  }

  log(`找到旧配置文件: ${OLD_CONFIG_PATH}`);
  console.log();

  // 迁移各插件配置
  let migratedCount = 0;

  if (migratePluginConfig("sql", oldConfig.sql)) migratedCount++;
  if (migratePluginConfig("ssh", oldConfig.ssh)) migratedCount++;
  if (migratePluginConfig("http", oldConfig.http)) migratedCount++;

  console.log();

  if (migratedCount === 0) {
    log("没有配置需要迁移");
    return;
  }

  // 备份旧配置文件
  const backupPath = `${OLD_CONFIG_PATH}.bak`;
  try {
    fs.copyFileSync(OLD_CONFIG_PATH, backupPath);
    log(`已备份旧配置文件到: ${backupPath}`);
  } catch (err) {
    error(`备份旧配置文件失败: ${err}`);
    return;
  }

  // 删除旧配置文件
  try {
    fs.unlinkSync(OLD_CONFIG_PATH);
    log("已删除旧配置文件");
  } catch (err) {
    error(`删除旧配置文件失败: ${err}`);
    return;
  }

  console.log();
  console.log("=".repeat(50));
  log("迁移完成！");
  log(`已迁移 ${migratedCount} 个插件的配置`);
  console.log("=".repeat(50));
}

main();
