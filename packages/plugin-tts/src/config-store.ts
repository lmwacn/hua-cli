import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AudioRequest, SpeechDefaults, TtsConfig, TtsProvider } from "./types";

export const SPEECH_DEFAULTS: Record<TtsProvider, SpeechDefaults> = {
  "qwen-audio": { provider: "qwen-audio", model: "qwen-audio-3.1-tts-flash", voice: "longanhuan_v3.1" },
  qwen: { provider: "qwen", model: "qwen3-tts-flash", voice: "Chelsie" },
  cosyvoice: { provider: "cosyvoice", model: "cosyvoice-v3-flash", voice: "longanyang" },
};

export function getConfigPath(): string {
  return path.join(os.homedir(), ".hua", "tts.json");
}

export function providerForModel(model: string): TtsProvider {
  if (/^qwen-audio-3\.[01]-tts-(flash|plus)$/.test(model)) return "qwen-audio";
  if (/^cosyvoice-(v2|v3-(flash|plus)|v3\.5-(flash|plus))$/.test(model)) return "cosyvoice";
  if (/^qwen3-tts-(instruct-)?flash(?:-\d{4}-\d{2}-\d{2})?$/.test(model)) return "qwen";
  throw new Error(`不支持的语音合成模型：${model}；音频生成请使用 hua tts generate`);
}

export function normalizeConfig(value: unknown): TtsConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("语音配置必须是 JSON 对象");
  const data = value as Record<string, any>;
  const old = data.version !== 2;
  const speech = old ? data : data.speech ?? {};
  const provider = speech.provider ?? (speech.model ? providerForModel(speech.model) : "qwen-audio");
  if (!Object.prototype.hasOwnProperty.call(SPEECH_DEFAULTS, provider)) throw new Error(`未知 provider：${provider}`);
  const defaults = SPEECH_DEFAULTS[provider as TtsProvider];
  const model = speech.model || defaults.model;
  if (providerForModel(model) !== provider) throw new Error("配置的 provider 与 model 不匹配，请重新设置");
  const timeout = data.timeout ?? 300000;
  if (!Number.isInteger(timeout) || timeout <= 0) throw new Error("timeout 必须是正整数毫秒");
  return {
    version: 2, apiKey: data.apiKey, apiKeyEnv: data.apiKeyEnv,
    workspaceId: data.workspaceId, region: data.region || "cn-beijing", baseUrl: old && data.baseUrl === "https://dashscope.aliyuncs.com/api/v1" ? undefined : data.baseUrl,
    timeout, speech: { provider, model, voice: speech.voice || defaults.voice },
  };
}

export function loadConfig(): TtsConfig {
  if (!fs.existsSync(getConfigPath())) return normalizeConfig({ version: 2 });
  try { return normalizeConfig(JSON.parse(fs.readFileSync(getConfigPath(), "utf8"))); }
  catch (error) { throw new Error(`无法读取 ${getConfigPath()}：${(error as Error).message}`); }
}

export function saveConfig(config: TtsConfig): void {
  const normalized = normalizeConfig(config);
  const target = getConfigPath();
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, target);
  } finally { fs.rmSync(temporary, { force: true }); }
}

export function maskSecret(value?: string): string {
  return value ? "***" : "(not set)";
}

export function connection(config: TtsConfig, values: Record<string, any>): Omit<AudioRequest, "model" | "input"> {
  const credentials = oldCredentials(values.envFile);
  const registryFile = path.join(os.homedir(), ".hua-voice", "voices.json");
  const service = !values.workspaceId && !process.env.SFM_WORKSPACE_ID && !config.workspaceId && fs.existsSync(registryFile)
    ? JSON.parse(fs.readFileSync(registryFile, "utf8")).service ?? {} : {};
  const keyEnv = values.apiKeyEnv ?? config.apiKeyEnv ?? service.api_key_env;
  if (values.apiKeyEnv && !credentials[values.apiKeyEnv] && !values.apiKey) throw new Error(`环境变量未设置：${values.apiKeyEnv}`);
  const apiKey = values.apiKey ?? (keyEnv ? credentials[keyEnv] : undefined) ?? process.env.DASHSCOPE_API_KEY ?? config.apiKey ?? credentials.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error("请设置 DASHSCOPE_API_KEY 或 hua tts config set --api-key");
  const timeout = Number(values.timeout ?? config.timeout);
  if (!Number.isInteger(timeout) || timeout <= 0 || timeout > 2147483647) throw new Error("timeout 必须是正整数毫秒");
  return { apiKey, workspaceId: values.workspaceId ?? process.env.SFM_WORKSPACE_ID ?? config.workspaceId ?? service.workspace_id,
    region: values.region ?? config.region, baseUrl: values.baseUrl ?? config.baseUrl, timeout };
}

export function oldCredentials(envFile?: string): Record<string, any> {
  const values: Record<string, any> = {};
  for (const file of [path.join(os.homedir(), ".hua-avatar/config.json"), path.join(os.homedir(), ".hua-voice", "config.json")]) {
    if (!fs.existsSync(file)) continue;
    if (process.platform !== "win32" && fs.statSync(file).mode & 0o077) throw new Error(`凭据文件权限过宽：${file}；请设为 600`);
    const data = JSON.parse(fs.readFileSync(file, "utf8")); Object.assign(values, data.credentials ?? data);
  }
  if (envFile) for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = line.trim().match(/^([^#=\s]+)\s*=\s*(.*)$/);
    if (match) values[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
  return { ...values, ...process.env };
}
