import os from "node:os";
import path from "node:path";
import { ConfigManager, ProfileConfig } from "@hua/plugin-sdk";

export type SqlDriver = "mysql" | "postgres";

export function parseDriver(value: unknown): SqlDriver {
  if (value === undefined || value === "mysql") return "mysql";
  if (value === "postgres" || value === "postgresql" || value === "pgsql") return "postgres";
  throw new Error(`Unsupported SQL driver: ${String(value)}`);
}

export function defaultPort(driver: SqlDriver): number {
  return driver === "postgres" ? 5432 : 3306;
}

export interface SqlProfile {
  driver: SqlDriver;
  host: string;
  port: number;
  user: string;
  password?: string;
  database: string;
  ssl?: boolean;
  sslCa?: string;
}

/**
 * 验证并规范化 SQL profile
 */
export function validateProfile(value: unknown): SqlProfile | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const input = value as Record<string, unknown>;
  const host = typeof input.host === "string" ? input.host.trim() : "";
  const user = typeof input.user === "string" ? input.user.trim() : "";
  const database = typeof input.database === "string" ? input.database.trim() : "";
  const driver = parseDriver(input.driver);
  const portValue = input.port;
  const port =
    typeof portValue === "number" && Number.isFinite(portValue)
      ? Math.trunc(portValue)
      : typeof portValue === "string" && portValue.trim()
        ? Number.parseInt(portValue, 10)
        : defaultPort(driver);
  const password = typeof input.password === "string" ? input.password : undefined;

  if (!host || !user || !database || !Number.isInteger(port) || port <= 0 || port > 65535) {
    return null;
  }

  if (input.ssl !== undefined && typeof input.ssl !== "boolean") throw new Error("ssl must be a boolean");
  if (input.sslCa !== undefined && (typeof input.sslCa !== "string" || !input.sslCa.trim())) throw new Error("sslCa must be a non-empty file path");
  if (input.sslCa && input.ssl === false) throw new Error("sslCa requires TLS");
  const sslCa = typeof input.sslCa === "string" ? input.sslCa : undefined;
  return { driver, host, port, user, password, database, ssl: !!(input.ssl || sslCa), sslCa };
}

/**
 * 比较两个 SQL profile 是否相同
 */
function isProfileEqual(a: SqlProfile, b: SqlProfile): boolean {
  return (
    a.driver === b.driver &&
    !!a.ssl === !!b.ssl &&
    a.sslCa === b.sslCa &&
    a.host === b.host &&
    a.port === b.port &&
    a.user === b.user &&
    a.password === b.password &&
    a.database === b.database
  );
}

export function createProfileStore(configPath = path.join(os.homedir(), ".hua", "sql.json")): ConfigManager<SqlProfile> {
  const sqlConfig: ProfileConfig<SqlProfile> = {
    name: "sql",
    strictValidation: true,
    configPath,
    validateProfile,
    isProfileEqual,
  };

  return new ConfigManager(sqlConfig);
}

const configManager = createProfileStore();

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
