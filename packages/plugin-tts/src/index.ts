import fs from "node:fs";
import path from "node:path";
import { definePlugin, HuaCommand, CommandOption } from "@hua/plugin-sdk";
import { voiceCommands } from "./voice";
import { downloadFile, synthesizeSpeech } from "./api";
import { connection, getConfigPath, loadConfig, maskSecret, normalizeConfig, providerForModel, saveConfig, SPEECH_DEFAULTS } from "./config-store";
import { AudioRequest, TtsConfig, TtsProvider } from "./types";

type Options = Record<string, any>;
const opt = (flags: string, description: string): CommandOption => ({ flags, description });
const common = [
  opt("--api-key <key>", "百炼 API Key"), opt("--api-key-env <name>", "API Key 环境变量名"),
  opt("--workspace-id <id>", "百炼业务空间 ID"), opt("--region <region>", "cn-beijing 或 ap-southeast-1"),
  opt("--base-url <url>", "覆盖 API 基础地址（包含 /api/v1）"), opt("--timeout <ms>", "请求总超时毫秒"),
];
const outputOptions = [
  opt("-o, --output <path>", "保存音频文件"), opt("--format <format>", "wav、mp3、pcm；合成另支持 opus"),
  opt("--sample-rate <hz>", "输出采样率"), opt("--rate <number>", "语速，0.5–2"),
  opt("--volume <number>", "音量，0–100"), opt("--seed <number>", "随机种子"),
  opt("--print-url", "只打印音频 URL"), opt("--json", "打印原始响应 JSON，并保存音频"),
];
function number(value: unknown, label: string, fallback?: number): number | undefined {
  if (value === undefined) return fallback;
  const result = typeof value === "number" ? value : Number(value);
  if (typeof value === "string" && !value.trim() || !Number.isFinite(result)) throw new Error(`${label} 必须是数字`);
  return result;
}
function range(value: number | undefined, label: string, min: number, max: number, integer = false): void {
  if (value !== undefined && (value < min || value > max || integer && !Number.isInteger(value))) throw new Error(`${label} 范围为 ${min}–${max}${integer ? " 的整数" : ""}`);
}
function inputText(args: string[], values: Options, generation: boolean): string {
  const sources = [args.length ? args.join(" ") : undefined, values.file ? fs.readFileSync(values.file, "utf8") : undefined,
    values.text, values.textFile ? fs.readFileSync(values.textFile, "utf8") : undefined,
    ...(generation ? [values.prompt, values.promptFile ? fs.readFileSync(values.promptFile, "utf8") : undefined] : [])].filter(value => value !== undefined);
  if (sources.length !== 1) throw new Error("必须且只能指定一种输入：位置文本或输入文件");
  const text = String(sources[0]).replace(/^\uFEFF/, "").trim();
  if (!text) throw new Error("输入不能为空");
  return text;
}
function audioOptions(values: Options, generation: boolean): { format: string; input: Options } {
  const format = values.format ?? "wav";
  if (!(generation ? ["wav", "mp3", "pcm"] : ["wav", "mp3", "pcm", "opus"]).includes(format)) throw new Error(`不支持的输出格式：${format}`);
  const sampleRate = number(values.sampleRate, "sample-rate", generation ? 48000 : 24000)!;
  if (!(generation ? [8000, 16000, 24000, 44100, 48000] : format === "opus" ? [8000, 12000, 16000, 24000, 48000] : [8000, 12000, 16000, 22050, 24000, 44100, 48000]).includes(sampleRate)) throw new Error("不支持的 sample-rate");
  const rate = number(values.rate, "rate"), volume = number(values.volume, "volume"), seed = number(values.seed, "seed");
  range(rate, "rate", 0.5, 2); range(volume, "volume", 0, 100, true);
  range(seed, "seed", 0, generation ? Number.MAX_SAFE_INTEGER : 65535, true);
  return { format, input: { format, sample_rate: sampleRate, ...(rate === undefined ? {} : { rate }),
    ...(volume === undefined ? {} : { volume }), ...(seed === undefined ? {} : { seed }) } };
}
function references(values: string[] = []): Options[] {
  if (values.length > 3) throw new Error("最多提供 3 条参考音频");
  return values.map(value => {
    if (/^https?:\/\//.test(value)) return { audio_url: new URL(value).toString() };
    const mime: Record<string, string> = { ".wav": "audio/wav", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".opus": "audio/ogg" };
    const type = mime[path.extname(value).toLowerCase()];
    if (!type) throw new Error("参考音频仅支持 WAV、MP3、OGG Opus 或公网 URL");
    const size = fs.statSync(value).size;
    if (!size || size > 10 * 1024 * 1024) throw new Error("参考音频须非空且不超过 10 MiB");
    return { audio_data: `data:${type};base64,${fs.readFileSync(value).toString("base64")}` };
  });
}
export function buildRequest(config: TtsConfig, args: string[], values: Options, generation: boolean): { request: AudioRequest; format: string } {
  let text = inputText(args, values, generation);
  const audio = audioOptions(values, generation);
  const input = audio.input;
  let model: string;
  let legacyQwen = false;
  if (generation) {
    model = values.model ?? "qwen-audio-3.1-tts-next";
    if (model !== "qwen-audio-3.1-tts-next") throw new Error("音频生成使用 qwen-audio-3.1-tts-next；语音合成请用 synthesize");
    if (values.style) {
      if (values.prompt !== undefined || values.promptFile) throw new Error("完整 prompt 请直接包含风格描述");
      text = `${values.style}。全程是单人干声。逐字说：“${text}”`;
    }
    if (Array.from(text).length > 3000) throw new Error("完整提示词不得超过 3000 字符");
    const refs = references(values.reference);
    for (const match of text.matchAll(/@voice(\d+)/g)) if (Number(match[1]) < 1 || Number(match[1]) > refs.length) throw new Error(`${match[0]} 没有对应参考音频`);
    const channels = number(values.channels, "channels", 2)!;
    range(channels, "channels", 1, 2, true);
    Object.assign(input, { text_prompt: text, channels, ...(refs.length ? { references: refs } : {}) });
  } else {
    const requestedProvider = values.provider as TtsProvider | undefined;
    if (requestedProvider && !Object.prototype.hasOwnProperty.call(SPEECH_DEFAULTS, requestedProvider)) throw new Error(`未知 provider：${requestedProvider}`);
    model = values.model ?? (requestedProvider && requestedProvider !== config.speech.provider ? SPEECH_DEFAULTS[requestedProvider].model : config.speech.model);
    const provider = providerForModel(model);
    if (requestedProvider && provider !== requestedProvider) throw new Error("provider 与 model 不匹配");
    const voice = values.voice ?? (model === config.speech.model ? config.speech.voice : SPEECH_DEFAULTS[provider].voice);
    if (model.startsWith("cosyvoice-v3.5") && !values.voice && model !== config.speech.model) throw new Error("CosyVoice v3.5 无系统音色，请指定该模型的复刻或设计音色 --voice");
    legacyQwen = provider === "qwen";
    if (legacyQwen) {
      if (values.format && values.format !== "wav" || ["sampleRate", "rate", "volume", "seed", "ssml"].some(key => values[key] !== undefined)) throw new Error("旧 Qwen3 HTTP 接口仅支持默认 WAV；高级合成参数请使用 qwen-audio");
      for (const key of Object.keys(input)) delete input[key];
      Object.assign(input, { text, voice, ...(values.language ? { language_type: values.language } : {}),
        ...(values.instructions ? { instructions: values.instructions } : {}), ...(values.optimizeInstructions ? { optimize_instructions: true } : {}) });
    } else {
      if (values.optimizeInstructions) throw new Error("optimize-instructions 仅用于旧 Qwen instruct 模型");
      Object.assign(input, { text, voice, ...(values.instructions ? { instruction: values.instructions } : {}),
        ...(values.language ? { language_hints: [values.language] } : {}), ...(values.ssml ? { enable_ssml: true } : {}) });
    }
  }
  return { request: { ...connection(config, values), model, input, legacyQwen }, format: audio.format };
}
function audioCommand(generation: boolean): HuaCommand {
  return {
    name: generation ? "generate" : "synthesize", aliases: generation ? ["next"] : ["gen"],
    description: generation ? "音频生成：按提示词生成对话、音效和环境音" : "语音合成：将稿件转换为指定音色的人声",
    arguments: ["[text...]"],
    options: [...common, ...outputOptions, opt("-f, --file <path>", generation ? "提示词文件" : "稿件文件"), opt("--model <model>", "模型 ID"),
      ...(generation ? [opt("--prompt <text>", "完整声音场景提示词"), opt("--prompt-file <path>", "完整提示词文件"),
        opt("--text <text>", "单人配音稿件"), opt("--text-file <path>", "单人配音稿件文件"), opt("--style <text>", "单人配音风格"),
        opt("--channels <number>", "声道数：1 或 2"), { ...opt("--reference <path-or-url>", "参考音频，可重复，依次对应 @voice1–3"), processor: (value: string, previous: string[] = []) => [...previous, value] }]
        : [opt("--provider <provider>", "qwen-audio、cosyvoice 或旧 qwen"), opt("--voice <id>", "系统、复刻或设计音色 ID"),
          opt("--instructions <text>", "情感、方言、语气指令"), opt("--language <code>", "目标语言，例如 zh 或 en；旧 Qwen 使用 Chinese/English"),
          opt("--ssml", "启用 SSML"), opt("--optimize-instructions", "旧 Qwen instruct 模型优化指令")])],
    async action(context) {
      const { request, format } = buildRequest(loadConfig(), context.args, context.options, generation);
      const output = path.resolve(context.options.output as string || `${generation ? "generated-audio" : "speech"}.${format}`);
      if (!context.options.printUrl && path.extname(output).toLowerCase() !== `.${format}`) throw new Error("输出文件扩展名须与 --format 一致");
      const response = await synthesizeSpeech(request);
      if (context.options.printUrl) { context.log(response.audioUrl); return; }
      try { await downloadFile(response.audioUrl, output, request.timeout, format); }
      catch (error) { throw new Error(`${(error as Error).message}；合成已提交，请勿重新生成。request_id=${response.requestId || "unknown"}；下载地址：${response.audioUrl}`); }
      if (context.options.json) context.log(JSON.stringify(response.raw, null, 2));
      else context.log(`已保存：${output} request_id=${response.requestId || "unknown"}`);
    },
  };
}
export const ttsPlugin = definePlugin({
  name: "tts", description: "百炼语音合成与音频生成", commands: [audioCommand(false), audioCommand(true), ...voiceCommands,
    { name: "set", parentPath: ["config"], description: "设置共用连接与语音合成默认值", options: [...common,
      opt("--provider <provider>", "合成默认 provider"), opt("--model <model>", "合成默认模型"), opt("--voice <id>", "合成默认音色")],
      action(context) {
        const config = loadConfig(), values = context.options;
        const provider = values.provider ?? (values.model ? providerForModel(values.model as string) : config.speech.provider);
        if (!Object.prototype.hasOwnProperty.call(SPEECH_DEFAULTS, provider as string)) throw new Error(`未知 provider：${provider}`);
        const changed = provider !== config.speech.provider || values.model && values.model !== config.speech.model;
        const speech = { ...(changed ? SPEECH_DEFAULTS[provider as TtsProvider] : config.speech),
          ...(values.model ? { model: values.model as string } : {}), ...(values.voice ? { voice: values.voice as string } : {}) };
        if (speech.model.startsWith("cosyvoice-v3.5") && changed && !values.voice) throw new Error("CosyVoice v3.5 必须指定复刻或设计音色 --voice");
        const next = normalizeConfig({ ...config, ...values, timeout: number(values.timeout, "timeout", config.timeout), speech });
        saveConfig(next); context.log(`已保存：${getConfigPath()}`);
      } },
    { name: "show", parentPath: ["config"], description: "查看配置（隐藏密钥）", action(context) {
      const config = loadConfig(); context.log(JSON.stringify({ config: getConfigPath(), ...config, apiKey: maskSecret(config.apiKey) }, null, 2));
    } },
    { name: "path", parentPath: ["config"], description: "显示配置文件路径", action(context) { context.log(getConfigPath()); } },
  ],
});
export type { TtsConfig, TtsProvider };
