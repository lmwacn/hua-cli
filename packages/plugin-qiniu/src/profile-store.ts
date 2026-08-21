import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { QiniuCredentials, QiniuProfile, StoredConfig } from "./types";

const CONFIG_PATH = path.join(os.homedir(), ".hua", "qiniu.json");

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeProfile(value: unknown): QiniuProfile | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const profile: QiniuProfile = {
    accessKey: readString(input.accessKey),
    secretKey: readString(input.secretKey),
    accessKeyEnv: readString(input.accessKeyEnv),
    secretKeyEnv: readString(input.secretKeyEnv),
    regionId: readString(input.regionId),
    defaultBucket: readString(input.defaultBucket),
    defaultDomain: readString(input.defaultDomain),
  };

  if ((!profile.accessKey && !profile.accessKeyEnv) || (!profile.secretKey && !profile.secretKeyEnv)) {
    return null;
  }
  return profile;
}

function normalizeConfig(value: unknown): StoredConfig {
  const result: StoredConfig = { profiles: {} };
  if (!value || typeof value !== "object") return result;
  const input = value as Record<string, unknown>;
  const profiles = input.profiles;
  if (profiles && typeof profiles === "object") {
    for (const [name, rawProfile] of Object.entries(profiles as Record<string, unknown>)) {
      const profile = normalizeProfile(rawProfile);
      if (profile && name.trim()) result.profiles[name.trim()] = profile;
    }
  }
  const defaultProfile = readString(input.defaultProfile);
  if (defaultProfile && result.profiles[defaultProfile]) result.defaultProfile = defaultProfile;
  return result;
}

export function getConfigPath(): string {
  return CONFIG_PATH;
}

export function loadConfig(): StoredConfig {
  if (!fs.existsSync(CONFIG_PATH)) return { profiles: {} };
  try {
    return normalizeConfig(JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as unknown);
  } catch {
    return { profiles: {} };
  }
}

function saveConfig(config: StoredConfig): void {
  const dir = path.dirname(CONFIG_PATH);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.chmodSync(CONFIG_PATH, 0o600);
}

export function listProfiles(): Array<{ name: string; profile: QiniuProfile; isDefault: boolean }> {
  const config = loadConfig();
  return Object.entries(config.profiles)
    .map(([name, profile]) => ({ name, profile, isDefault: name === config.defaultProfile }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function addOrUpdateProfile(name: string, profile: QiniuProfile): void {
  const normalized = normalizeProfile(profile);
  if (!normalized) throw new Error("Profile must define both access key and secret key sources.");
  const config = loadConfig();
  config.profiles[name] = normalized;
  config.defaultProfile ??= name;
  saveConfig(config);
}

export function removeProfile(name: string): boolean {
  const config = loadConfig();
  if (!config.profiles[name]) return false;
  delete config.profiles[name];
  if (config.defaultProfile === name) {
    config.defaultProfile = Object.keys(config.profiles).sort()[0];
  }
  saveConfig(config);
  return true;
}

export function setDefaultProfile(name: string): boolean {
  const config = loadConfig();
  if (!config.profiles[name]) return false;
  config.defaultProfile = name;
  saveConfig(config);
  return true;
}

export function getProfile(name?: string): { name: string; profile: QiniuProfile } | null {
  const config = loadConfig();
  const target = name?.trim() || config.defaultProfile;
  return target && config.profiles[target] ? { name: target, profile: config.profiles[target] } : null;
}

function resolveValue(direct: string | undefined, envName: string | undefined): string | undefined {
  return direct || (envName ? readString(process.env[envName]) : undefined);
}

export function resolveCredentials(name?: string): { name: string; credentials: QiniuCredentials } {
  const resolved = getProfile(name);
  if (!resolved) {
    const accessKey = readString(process.env.QINIU_ACCESS_KEY);
    const secretKey = readString(process.env.QINIU_SECRET_KEY);
    if (accessKey && secretKey) return { name: "environment", credentials: { accessKey, secretKey } };
    throw new Error(
      "No available Qiniu profile. Run `hua qiniu profile add <name>` or set QINIU_ACCESS_KEY and QINIU_SECRET_KEY.",
    );
  }

  const accessKey = resolveValue(resolved.profile.accessKey, resolved.profile.accessKeyEnv);
  const secretKey = resolveValue(resolved.profile.secretKey, resolved.profile.secretKeyEnv);
  if (!accessKey || !secretKey) {
    const missing = [
      !accessKey ? resolved.profile.accessKeyEnv ?? "access key" : "",
      !secretKey ? resolved.profile.secretKeyEnv ?? "secret key" : "",
    ].filter(Boolean);
    throw new Error(`Profile '${resolved.name}' is missing credential value(s): ${missing.join(", ")}.`);
  }
  return { name: resolved.name, credentials: { ...resolved.profile, accessKey, secretKey } };
}

export function maskSecret(value?: string): string {
  if (!value) return "(not stored)";
  if (value.length <= 8) return `${value.slice(0, 2)}***`;
  return `${value.slice(0, 5)}***${value.slice(-3)}`;
}
