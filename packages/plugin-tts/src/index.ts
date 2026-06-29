import fs from "node:fs";
import path from "node:path";
import { definePlugin } from "@hua/plugin-sdk";
import { downloadFile, synthesizeSpeech } from "./api";
import { DEFAULT_CONFIG, getConfigPath, loadConfig, maskSecret, saveConfig } from "./config-store";
import { TtsConfig, TtsProvider, TtsRequestOptions } from "./types";

function readStringOption(options: Record<string, unknown>, key: string): string {
  const camelKey = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  const value = options[key] ?? options[camelKey];
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim();
  return "";
}

function readNumberOption(options: Record<string, unknown>, key: string): number | undefined {
  const value = readStringOption(options, key);
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readBooleanOption(options: Record<string, unknown>, key: string): boolean | undefined {
  const camelKey = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  const value = options[key] ?? options[camelKey];
  return typeof value === "boolean" ? value : undefined;
}

function readProvider(value: string): TtsProvider | undefined {
  return value === "qwen" || value === "cosyvoice" ? value : undefined;
}

function mergeConfig(existing: TtsConfig, options: Record<string, unknown>): TtsConfig {
  const provider = readProvider(readStringOption(options, "provider"));
  return {
    ...existing,
    apiKey: readStringOption(options, "api-key") || existing.apiKey,
    apiKeyEnv: readStringOption(options, "api-key-env") || existing.apiKeyEnv,
    provider: provider ?? existing.provider,
    model: readStringOption(options, "model") || existing.model,
    voice: readStringOption(options, "voice") || existing.voice,
    languageType: readStringOption(options, "language") || existing.languageType,
    baseUrl: readStringOption(options, "base-url") || existing.baseUrl,
    workspaceId: readStringOption(options, "workspace-id") || existing.workspaceId,
    region: readStringOption(options, "region") || existing.region,
    format: readStringOption(options, "format") || existing.format,
    sampleRate: readNumberOption(options, "sample-rate") ?? existing.sampleRate,
    timeout: readNumberOption(options, "timeout") ?? existing.timeout,
  };
}

function resolveApiKey(config: TtsConfig, options: Record<string, unknown>): string {
  const cliKey = readStringOption(options, "api-key");
  if (cliKey) return cliKey;

  const cliKeyEnv = readStringOption(options, "api-key-env");
  if (cliKeyEnv && process.env[cliKeyEnv]) return process.env[cliKeyEnv] as string;

  if (config.apiKey) return config.apiKey;
  if (config.apiKeyEnv && process.env[config.apiKeyEnv]) return process.env[config.apiKeyEnv] as string;
  if (process.env.DASHSCOPE_API_KEY) return process.env.DASHSCOPE_API_KEY;

  throw new Error("No API key configured. Run `hua tts config set --api-key sk-...` first.");
}

function effectiveProvider(config: TtsConfig, options: Record<string, unknown>): TtsProvider {
  const provider = readProvider(readStringOption(options, "provider"));
  return provider ?? config.provider ?? DEFAULT_CONFIG.provider;
}

function effectiveModel(config: TtsConfig, options: Record<string, unknown>, provider: TtsProvider): string {
  const explicit = readStringOption(options, "model");
  if (explicit) return explicit;
  if (config.model) return config.model;
  return provider === "cosyvoice" ? "cosyvoice-v3-flash" : "qwen3-tts-flash";
}

function readInputText(args: string[], options: Record<string, unknown>): string {
  const filePath = readStringOption(options, "file");
  if (filePath) {
    const resolved = path.resolve(process.cwd(), filePath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Input file not found: ${resolved}`);
    }
    return fs.readFileSync(resolved, "utf8").trim();
  }

  const text = args.join(" ").trim();
  if (!text) {
    throw new Error("Text is required. Use `hua tts gen \"hello\"` or `hua tts gen --file input.txt`.");
  }
  return text;
}

function buildRequestOptions(config: TtsConfig, args: string[], options: Record<string, unknown>): TtsRequestOptions {
  const provider = effectiveProvider(config, options);
  const optimizeInstructions = readBooleanOption(options, "optimize-instructions");
  return {
    apiKey: resolveApiKey(config, options),
    provider,
    model: effectiveModel(config, options, provider),
    voice: readStringOption(options, "voice") || config.voice || DEFAULT_CONFIG.voice,
    text: readInputText(args, options),
    languageType: readStringOption(options, "language") || config.languageType,
    instructions: readStringOption(options, "instructions") || undefined,
    optimizeInstructions,
    baseUrl: readStringOption(options, "base-url") || config.baseUrl,
    workspaceId: readStringOption(options, "workspace-id") || config.workspaceId,
    region: readStringOption(options, "region") || config.region,
    format: readStringOption(options, "format") || config.format,
    sampleRate: readNumberOption(options, "sample-rate") ?? config.sampleRate,
    ssml: readBooleanOption(options, "ssml") ?? false,
    timeout: readNumberOption(options, "timeout") ?? config.timeout ?? DEFAULT_CONFIG.timeout ?? 120000,
  };
}

function formatConfig(config: TtsConfig): string {
  const lines = [
    `config=${getConfigPath()}`,
    `apiKey=${maskSecret(config.apiKey)}`,
    `apiKeyEnv=${config.apiKeyEnv ?? "(not set)"}`,
    `provider=${config.provider}`,
    `model=${config.model}`,
    `voice=${config.voice}`,
    `language=${config.languageType ?? "(not set)"}`,
    `baseUrl=${config.baseUrl ?? "(auto)"}`,
    `workspaceId=${config.workspaceId ?? "(not set)"}`,
    `region=${config.region ?? "(not set)"}`,
    `format=${config.format ?? "(provider default)"}`,
    `sampleRate=${config.sampleRate ?? "(provider default)"}`,
    `timeout=${config.timeout ?? DEFAULT_CONFIG.timeout}ms`,
  ];
  return lines.join("\n");
}

export const ttsPlugin = definePlugin({
  name: "tts",
  description: "Aliyun Model Studio text-to-speech tools",
  commands: [
    {
      name: "gen",
      description: "Generate speech audio from text",
      arguments: ["[text...]"],
      options: [
        { flags: "-f, --file <path>", description: "Read input text from a file" },
        { flags: "-o, --output <path>", description: "Output audio path", defaultValue: "tts-output.wav" },
        { flags: "--print-url", description: "Print the generated audio URL without downloading" },
        { flags: "--json", description: "Print raw API response JSON" },
        { flags: "--provider <qwen|cosyvoice>", description: "TTS provider" },
        { flags: "--model <model>", description: "Model name" },
        { flags: "--voice <voice>", description: "Voice ID" },
        { flags: "--language <type>", description: "Qwen language_type, for example Chinese or English" },
        { flags: "--instructions <text>", description: "Qwen instruct model voice instructions" },
        { flags: "--optimize-instructions", description: "Ask Qwen instruct model to optimize instructions" },
        { flags: "--ssml", description: "Enable SSML for CosyVoice" },
        { flags: "--format <format>", description: "CosyVoice output format, for example mp3 or wav" },
        { flags: "--sample-rate <hz>", description: "CosyVoice sample rate" },
        { flags: "--api-key <key>", description: "Override configured API key" },
        { flags: "--api-key-env <name>", description: "Read API key from an environment variable" },
        { flags: "--base-url <url>", description: "Override API base URL" },
        { flags: "--workspace-id <id>", description: "Aliyun Model Studio workspace ID" },
        { flags: "--region <region>", description: "Workspace region, default cn-beijing" },
        { flags: "--timeout <ms>", description: "Request timeout in ms" },
      ],
      async action(context) {
        const config = loadConfig();
        const request = buildRequestOptions(config, context.args, context.options);
        const response = await synthesizeSpeech(request);

        if (context.options.json === true) {
          context.log(JSON.stringify(response.raw, null, 2));
        }

        if (context.options.printUrl === true) {
          context.log(response.audioUrl);
          return;
        }

        const output = readStringOption(context.options, "output") || "tts-output.wav";
        await downloadFile(response.audioUrl, output, request.timeout);
        const requestInfo = response.requestId ? ` request_id=${response.requestId}` : "";
        context.log(`Saved audio: ${path.resolve(process.cwd(), output)}${requestInfo}`);
      },
    },
    {
      name: "set",
      parentPath: ["config"],
      description: "Create or update TTS config",
      options: [
        { flags: "--api-key <key>", description: "Aliyun Model Studio API key" },
        { flags: "--api-key-env <name>", description: "Environment variable name for API key" },
        { flags: "--provider <qwen|cosyvoice>", description: "Default provider" },
        { flags: "--model <model>", description: "Default model" },
        { flags: "--voice <voice>", description: "Default voice ID" },
        { flags: "--language <type>", description: "Default Qwen language_type" },
        { flags: "--base-url <url>", description: "Default API base URL" },
        { flags: "--workspace-id <id>", description: "Aliyun Model Studio workspace ID" },
        { flags: "--region <region>", description: "Workspace region" },
        { flags: "--format <format>", description: "Default CosyVoice format" },
        { flags: "--sample-rate <hz>", description: "Default CosyVoice sample rate" },
        { flags: "--timeout <ms>", description: "Default request timeout in ms" },
      ],
      async action(context) {
        const nextConfig = mergeConfig(loadConfig(), context.options);
        saveConfig(nextConfig);
        context.log(`Saved TTS config: ${getConfigPath()}`);
        context.log(formatConfig(nextConfig));
      },
    },
    {
      name: "show",
      parentPath: ["config"],
      description: "Show TTS config",
      async action(context) {
        context.log(formatConfig(loadConfig()));
      },
    },
    {
      name: "path",
      parentPath: ["config"],
      description: "Show TTS config path",
      async action(context) {
        context.log(getConfigPath());
      },
    },
  ],
});

export type { TtsConfig, TtsProvider };
