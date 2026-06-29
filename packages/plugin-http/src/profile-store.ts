import os from "node:os";
import path from "node:path";
import { ConfigManager, ProfileConfig } from "@hua/plugin-sdk";
import { HttpProfile } from "./types";

/**
 * 验证并规范化 HTTP profile
 */
function validateProfile(value: unknown): HttpProfile | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const input = value as Record<string, unknown>;
  const baseUrl = typeof input.baseUrl === "string" ? input.baseUrl.trim() : "";

  if (!baseUrl) {
    return null;
  }

  const headers = typeof input.headers === "object" && input.headers !== null
    ? input.headers as Record<string, string>
    : undefined;

  const timeout = typeof input.timeout === "number" ? input.timeout : undefined;

  const auth = typeof input.auth === "object" && input.auth !== null
    ? input.auth as HttpProfile["auth"]
    : undefined;

  return { baseUrl, headers, timeout, auth };
}

/**
 * 比较两个 HTTP profile 是否相同
 */
function isProfileEqual(a: HttpProfile, b: HttpProfile): boolean {
  // 比较 baseUrl
  if (a.baseUrl !== b.baseUrl) return false;

  // 比较 timeout
  if (a.timeout !== b.timeout) return false;

  // 比较 headers
  const aHeaders = a.headers ? JSON.stringify(Object.entries(a.headers).sort()) : "";
  const bHeaders = b.headers ? JSON.stringify(Object.entries(b.headers).sort()) : "";
  if (aHeaders !== bHeaders) return false;

  // 比较 auth
  const aAuth = a.auth ? JSON.stringify(a.auth) : "";
  const bAuth = b.auth ? JSON.stringify(b.auth) : "";
  if (aAuth !== bAuth) return false;

  return true;
}

const httpConfig: ProfileConfig<HttpProfile> = {
  name: "http",
  configPath: path.join(os.homedir(), ".hua", "http.json"),
  validateProfile,
  isProfileEqual,
};

const configManager = new ConfigManager(httpConfig);

// 导出统一接口
export const getConfigPath = () => configManager.getConfigPath();
export const listProfiles = () => configManager.listProfiles();
export const addOrUpdateProfile = (name: string, profile: HttpProfile) => configManager.addOrUpdateProfile(name, profile);
export const removeProfile = (name: string) => configManager.removeProfile(name);
export const setDefaultProfile = (name: string) => configManager.setDefaultProfile(name);
export const getProfile = (name: string) => configManager.getProfile(name);
export const getDefaultProfileName = () => configManager.getDefaultProfileName();
export const resolveProfile = (name?: string) => configManager.resolveProfile(name);
export const findDuplicateProfile = (profile: HttpProfile) => configManager.findDuplicateProfile(profile);
