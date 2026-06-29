import os from "node:os";
import path from "node:path";
import { ConfigManager, ProfileConfig } from "@hua/plugin-sdk";

export interface SqlProfile {
  driver: "mysql";
  host: string;
  port: number;
  user: string;
  password?: string;
  database: string;
}

/**
 * 验证并规范化 SQL profile
 */
function validateProfile(value: unknown): SqlProfile | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const input = value as Record<string, unknown>;
  const host = typeof input.host === "string" ? input.host.trim() : "";
  const user = typeof input.user === "string" ? input.user.trim() : "";
  const database = typeof input.database === "string" ? input.database.trim() : "";
  const driver = input.driver === "mysql" ? "mysql" : "mysql";
  const portValue = input.port;
  const port =
    typeof portValue === "number" && Number.isFinite(portValue)
      ? Math.trunc(portValue)
      : typeof portValue === "string" && portValue.trim()
        ? Number.parseInt(portValue, 10)
        : 3306;
  const password = typeof input.password === "string" ? input.password : undefined;

  if (!host || !user || !database || !Number.isInteger(port) || port <= 0) {
    return null;
  }

  return { driver, host, port, user, password, database };
}

/**
 * 比较两个 SQL profile 是否相同
 */
function isProfileEqual(a: SqlProfile, b: SqlProfile): boolean {
  return (
    a.host === b.host &&
    a.port === b.port &&
    a.user === b.user &&
    a.password === b.password &&
    a.database === b.database
  );
}

const sqlConfig: ProfileConfig<SqlProfile> = {
  name: "sql",
  configPath: path.join(os.homedir(), ".hua", "sql.json"),
  validateProfile,
  isProfileEqual,
};

const configManager = new ConfigManager(sqlConfig);

// 导出统一接口
export const getConfigPath = () => configManager.getConfigPath();
export const listProfiles = () => configManager.listProfiles();
export const addOrUpdateProfile = (name: string, profile: SqlProfile) => configManager.addOrUpdateProfile(name, profile);
export const removeProfile = (name: string) => configManager.removeProfile(name);
export const setDefaultProfile = (name: string) => configManager.setDefaultProfile(name);
export const getProfile = (name: string) => configManager.getProfile(name);
export const getDefaultProfileName = () => configManager.getDefaultProfileName();
export const resolveProfile = (name?: string) => configManager.resolveProfile(name);
export const findDuplicateProfile = (profile: SqlProfile) => configManager.findDuplicateProfile(profile);
