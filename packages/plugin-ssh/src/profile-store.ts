import os from "node:os";
import path from "node:path";
import { ConfigManager, ProfileConfig } from "@hua/plugin-sdk";
import { SshProfile } from "./types";

/**
 * 验证并规范化 SSH profile
 */
function validateProfile(value: unknown): SshProfile | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const input = value as Record<string, unknown>;
  const host = typeof input.host === "string" ? input.host.trim() : "";
  const username = typeof input.username === "string" ? input.username.trim() : "";

  if (!host || !username) {
    return null;
  }

  const portValue = input.port;
  const port =
    typeof portValue === "number" && Number.isFinite(portValue)
      ? Math.trunc(portValue)
      : typeof portValue === "string" && portValue.trim()
        ? Number.parseInt(portValue, 10)
        : 22;

  const authMethod = input.authMethod === "key" ? "key" : "password";
  const password = typeof input.password === "string" ? input.password : undefined;
  const privateKeyPath = typeof input.privateKeyPath === "string" ? input.privateKeyPath : undefined;
  const passphrase = typeof input.passphrase === "string" ? input.passphrase : undefined;

  if (!Number.isInteger(port) || port <= 0) {
    return null;
  }

  return { host, port, username, authMethod, password, privateKeyPath, passphrase };
}

/**
 * 比较两个 SSH profile 是否相同
 */
function isProfileEqual(a: SshProfile, b: SshProfile): boolean {
  return (
    a.host === b.host &&
    a.port === b.port &&
    a.username === b.username &&
    a.authMethod === b.authMethod &&
    a.password === b.password &&
    a.privateKeyPath === b.privateKeyPath &&
    a.passphrase === b.passphrase
  );
}

const sshConfig: ProfileConfig<SshProfile> = {
  name: "ssh",
  strictValidation: true,
  atomicWrites: true,
  configPath: path.join(os.homedir(), ".hua", "ssh.json"),
  validateProfile,
  isProfileEqual,
};

const configManager = new ConfigManager(sshConfig);

// 导出统一接口
export const getConfigPath = () => configManager.getConfigPath();
export const listProfiles = () => configManager.listProfiles();
export const addOrUpdateProfile = (name: string, profile: SshProfile) => configManager.addOrUpdateProfile(name, profile);
export const removeProfile = (name: string) => configManager.removeProfile(name);
export const setDefaultProfile = (name: string) => configManager.setDefaultProfile(name);
export const getProfile = (name: string) => configManager.getProfile(name);
export const getDefaultProfileName = () => configManager.getDefaultProfileName();
export const resolveProfile = (name?: string) => configManager.resolveProfile(name);
export const findDuplicateProfile = (profile: SshProfile) => configManager.findDuplicateProfile(profile);

export function savePanelProfile(
  name: string,
  profile: SshProfile,
  originalName?: string,
): "saved" | "exists" | "missing" {
  const config = configManager.loadConfig();
  const hasProfile = (key: string) => Object.prototype.hasOwnProperty.call(config.profiles, key);
  if (originalName !== undefined && !hasProfile(originalName)) return "missing";
  if (name !== originalName && hasProfile(name)) return "exists";

  config.profiles[name] = profile;
  if (originalName !== undefined && originalName !== name) delete config.profiles[originalName];
  if (!config.defaultProfile || config.defaultProfile === originalName) config.defaultProfile = name;
  configManager.saveConfig(config);
  return "saved";
}
