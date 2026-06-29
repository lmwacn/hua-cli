import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TtsConfig, TtsProvider } from "./types";

const CONFIG_PATH = path.join(os.homedir(), ".hua", "tts.json");

export const DEFAULT_CONFIG: TtsConfig = {
  provider: "qwen",
  model: "qwen3-tts-flash",
  voice: "Chelsie",
  languageType: "Chinese",
  region: "cn-beijing",
  timeout: 120000,
};

function readString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNumber(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function readProvider(input: Record<string, unknown>): TtsProvider | undefined {
  const provider = readString(input, "provider");
  if (provider === "qwen" || provider === "cosyvoice") {
    return provider;
  }
  return undefined;
}

export function normalizeConfig(value: unknown): TtsConfig {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_CONFIG };
  }

  const input = value as Record<string, unknown>;
  return {
    ...DEFAULT_CONFIG,
    apiKey: readString(input, "apiKey"),
    apiKeyEnv: readString(input, "apiKeyEnv"),
    provider: readProvider(input) ?? DEFAULT_CONFIG.provider,
    model: readString(input, "model") ?? DEFAULT_CONFIG.model,
    voice: readString(input, "voice") ?? DEFAULT_CONFIG.voice,
    languageType: readString(input, "languageType") ?? DEFAULT_CONFIG.languageType,
    baseUrl: readString(input, "baseUrl") ?? DEFAULT_CONFIG.baseUrl,
    workspaceId: readString(input, "workspaceId"),
    region: readString(input, "region") ?? DEFAULT_CONFIG.region,
    format: readString(input, "format"),
    sampleRate: readNumber(input, "sampleRate"),
    timeout: readNumber(input, "timeout") ?? DEFAULT_CONFIG.timeout,
  };
}

export function getConfigPath(): string {
  return CONFIG_PATH;
}

export function loadConfig(): TtsConfig {
  if (!fs.existsSync(CONFIG_PATH)) {
    return { ...DEFAULT_CONFIG };
  }

  const raw = fs.readFileSync(CONFIG_PATH, "utf8");
  if (!raw.trim()) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    return normalizeConfig(JSON.parse(raw) as unknown);
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config: TtsConfig): void {
  const configDir = path.dirname(CONFIG_PATH);
  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(normalizeConfig(config), null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.chmodSync(CONFIG_PATH, 0o600);
}

export function maskSecret(value?: string): string {
  if (!value) return "(not set)";
  if (value.length <= 10) return `${value.slice(0, 2)}***`;
  return `${value.slice(0, 7)}***${value.slice(-4)}`;
}
