import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import * as TOML from "@iarna/toml";
import { HuaCommand, CommandOption } from "@hua/plugin-sdk";
import { connection, oldCredentials, loadConfig, providerForModel } from "./config-store";
import { downloadFile, requestAudioApi, resolveBaseUrl, synthesizeSpeech } from "./api";
import { AudioRequest } from "./types";

type Data = Record<string, any>;
const stateRoot = () => path.join(os.homedir(), ".hua-voice");
function readJson(file: string): Data {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
}
function saveJson(file: string, data: Data): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, file);
  } finally { fs.rmSync(temporary, { force: true }); }
}
function resolveVoice(registry: Data, selector?: string): [string, Data] {
  const matches = Object.entries(registry.voices as Data).filter(([key, voice]) => key === selector || voice.display_name === selector || voice.aliases?.includes(selector));
  const entry = Object.prototype.hasOwnProperty.call(registry.voices, selector || "") ? [selector!, registry.voices[selector!]] as [string, Data] : matches.length === 1 ? matches[0] : undefined;
  if (!entry) throw new Error("音色名称不存在或不唯一，请运行 clone list 并使用 name");
  if (entry[1].enabled === false) throw new Error(`音色已停用：${entry[0]}`);
  return entry;
}
function clientFor(service: Data, values: Data, options: Data): AudioRequest {
  const config = loadConfig();
  const envName = service.api_key_env || config.apiKeyEnv || "DASHSCOPE_API_KEY";
  const conn = connection(config, { ...options, workspaceId: options.workspaceId ?? service.workspace_id ?? values.SFM_WORKSPACE_ID,
    region: options.region ?? service.region ?? config.region,
    apiKey: options.apiKey ?? values[options.apiKeyEnv || envName] ?? config.apiKey });
  return { ...conn, model: "voice-enrollment", input: {} };
}
async function enrollment(client: AudioRequest, action: string, fields: Data): Promise<Data> {
  const data = await requestAudioApi(client, "/services/audio/tts/customization", { model: "voice-enrollment", input: { action, ...fields } });
  if (!data.output || typeof data.output !== "object") throw new Error("百炼未返回有效 output，请勿自动重复提交");
  return data.output;
}
async function status(client: AudioRequest, id: string, model: string, wait: number): Promise<Data> {
  const deadline = Date.now() + wait * 1000;
  while (true) {
    const result = await enrollment(client, "query_voice", { voice_id: id });
    if (result.target_model && result.target_model !== model) throw new Error("远程音色绑定模型与本地配置不一致");
    if (result.status === "OK" || result.status === "DEPLOYING" && Date.now() >= deadline) return { status: result.status, model };
    if (result.status !== "DEPLOYING") throw new Error(`音色不可用：${result.status}`);
    await new Promise(resolve => setTimeout(resolve, Math.min(2000, deadline - Date.now())));
  }
}
function audioSource(options: Data): string {
  if (!!options.audioFile === !!options.audioUrl) throw new Error("必须且只能指定 --audio-file 或 --audio-url");
  if (options.audioUrl) {
    if (new URL(options.audioUrl).protocol !== "https:") throw new Error("参考音频 URL 必须使用 HTTPS");
    return options.audioUrl;
  }
  const file = options.audioFile;
  const mime: Data = { ".wav": "audio/wav", ".mp3": "audio/mpeg", ".m4a": "audio/mp4" };
  const type = mime[path.extname(file).toLowerCase()];
  const size = fs.statSync(file).size;
  if (!type || size <= 0 || size > 10 * 1024 * 1024) throw new Error("样本须为非空且不超过 10 MiB 的 WAV、MP3、M4A");
  return `data:${type};base64,${fs.readFileSync(file).toString("base64")}`;
}
async function run(name: string, options: Data, args: string[]): Promise<unknown> {
  const file = path.resolve(options.registry || path.join(stateRoot(), "voices.json"));
  const registry = readJson(file);
  registry.version ??= 1; registry.voices ??= {};
  if (name === "list") return Object.entries(registry.voices as Data).map(([key, voice]) => ({ name: key, display_name: voice.display_name, model: voice.model, status: voice.status || "not_checked", enabled: voice.enabled !== false }));
  if (name === "import-avatar") {
    if (args.length !== 1) throw new Error("请指定旧 TOML 配置文件");
    const data = TOML.parse(fs.readFileSync(args[0], "utf8")) as Data;
    const service = data.services?.bailian;
    if (!service) throw new Error("源文件缺少 services.bailian");
    let count = 0;
    for (const [id, persona] of Object.entries(data.personas || {}) as [string, Data][]) for (const [key, voice] of Object.entries(persona.voices || {}) as [string, Data][]) {
      const selector = key === "main" ? id : `${id}-${key}`;
      if (voice.provider !== "bailian" || Object.prototype.hasOwnProperty.call(registry.voices, selector)) continue;
      registry.voices[selector] = { display_name: persona.display_name + (key === "main" ? "" : `/${key}`), aliases: key === "main" ? persona.aliases || [] : [],
        enabled: persona.enabled !== false, model: voice.model, service, ...(voice.voice_id ? { voice_id: voice.voice_id } : {}), ...(voice.voice_id_env ? { voice_id_env: voice.voice_id_env } : {}) }; count++;
    }
    registry.service ??= service; saveJson(file, registry); return { imported: count, registry: file };
  }
  const values = oldCredentials(options.envFile);
  if (name === "doctor") return { voices: Object.keys(registry.voices).length, service_configured: !!(options.workspaceId || values.SFM_WORKSPACE_ID || loadConfig().workspaceId || registry.service?.workspace_id),
    api_key_configured: !!(options.apiKey || values.DASHSCOPE_API_KEY || loadConfig().apiKey), online_checked: false };
  const wait = Number(options.wait ?? (name === "create" ? 30 : 0));
  if (!Number.isInteger(wait) || wait < 0 || wait > 60) throw new Error("wait 须为 0–60 秒整数");
  if (name === "create") {
    if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(options.name || "")) throw new Error("name 使用 2–63 位小写字母、数字、短横线");
    if (Object.prototype.hasOwnProperty.call(registry.voices, options.name)) throw new Error("音色名称已存在，不能覆盖或重复创建");
    if (!/^[a-zA-Z0-9]{1,10}$/.test(options.prefix || "")) throw new Error("prefix 须为 1–10 位英文字母或数字");
    const model = options.model || "cosyvoice-v3.5-plus";
    if (providerForModel(model) === "qwen") throw new Error("克隆使用 Qwen-Audio 或 CosyVoice 模型");
    const client = clientFor(registry.service || {}, values, options);
    const service = { workspace_id: client.workspaceId, region: client.region, api_key_env: options.apiKeyEnv || registry.service?.api_key_env || loadConfig().apiKeyEnv || "DASHSCOPE_API_KEY" };
    const audio = audioSource(options);
    resolveBaseUrl(client);
    const voice = { display_name: options.displayName || options.name, model, service, status: "submission_unknown" } as Data;
    registry.voices[options.name] = voice; registry.service ??= service;
    // 提交前占位；结果不明时阻止同名重复创建。
    saveJson(file, registry);
    const output = await enrollment(client, "create_voice", { target_model: model, prefix: options.prefix, audio });
    if (typeof output.voice_id !== "string" || !output.voice_id) throw new Error("创建接口未返回 voice_id；请先 discover 恢复，勿重复提交");
    voice.voice_id = output.voice_id; voice.status = "DEPLOYING"; saveJson(file, registry);
    Object.assign(voice, await status(client, voice.voice_id, model, wait)); saveJson(file, registry);
    return { name: options.name, status: voice.status, model };
  }
  if (name === "discover") {
    const page = Number(options.page ?? 0);
    if (!Number.isInteger(page) || page < 0 || !options.prefix) throw new Error("请指定 prefix 和非负整数 page");
    const output = await enrollment(clientFor(registry.service || {}, values, options), "list_voice", { prefix: options.prefix, page_index: page, page_size: 100 });
    const target = path.join(path.dirname(file), `discovered-${randomUUID().slice(0, 8)}.json`);
    saveJson(target, output); return { saved_to: target, count: output.voice_list?.length || 0, page };
  }
  const [selector, voice] = resolveVoice(registry, options.voice || options.name);
  const client = clientFor(voice.service || registry.service || {}, values, options);
  let id = voice.voice_id || values[voice.voice_id_env] || (voice.voice_id_env === "BAILIAN_VOICE_DA_TIE_CHUI" ? values.BAILIAN_VOICE_TECH_ROAST : undefined);
  if (name === "bind") {
    if (voice.voice_id || voice.voice_id_env) throw new Error("已有音色绑定，不允许覆盖");
    if (!options.sourceJson) throw new Error("请指定 source-json");
    id = readJson(options.sourceJson).voice_id;
    if (typeof id !== "string" || !id) throw new Error("source-json 须含 voice_id 字符串");
  }
  if (!id) throw new Error("未配置该音色的 voice_id 或对应环境变量");
  if (name === "status" || name === "bind") {
    const result = await status(client, id, voice.model, wait);
    if (name === "bind") voice.voice_id = id;
    voice.status = result.status; saveJson(file, registry); return { name: selector, ...result };
  }
  if ((options.text === undefined) === !options.textFile) throw new Error("必须且只能指定 text 或 text-file");
  const text = String(options.text ?? fs.readFileSync(options.textFile, "utf8")).replace(/^\uFEFF/, "").trim();
  if (!text || Array.from(text).length > 15000) throw new Error("文案须为 1–15000 字符");
  if ((await status(client, id, voice.model, 0)).status !== "OK") throw new Error("音色仍在部署，请稍后查询 status");
  const format = options.format || "wav";
  if (!["wav", "mp3"].includes(format)) throw new Error("克隆配音支持 wav 或 mp3");
  const title = String(options.title || voice.display_name).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 100).trim() || "配音";
  const directory = path.resolve(options.outputRoot || "Voice", `${title}-${randomUUID().slice(0, 8)}`);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "script.txt"), text + "\n");
  const manifest: Data = { status: "synthesizing", name: selector, model: voice.model, outputs: {} };
  saveJson(path.join(directory, "manifest.json"), manifest);
  try {
    const response = await synthesizeSpeech({ ...client, model: voice.model, input: { text, voice: id, format, sample_rate: 24000 } });
    manifest.request_id = response.requestId;
    const output = path.join(directory, `audio.${format}`);
    try { await downloadFile(response.audioUrl, output, client.timeout, format); }
    catch (error) { throw new Error(`${(error as Error).message}；请勿重新合成，下载地址：${response.audioUrl}`); }
    Object.assign(manifest, { status: "completed", outputs: { audio: output } });
  } catch (error) { manifest.status = "failed_or_unknown"; throw error; }
  finally { saveJson(path.join(directory, "manifest.json"), manifest); }
  return { directory, ...manifest };
}
const descriptions: Record<string, string> = {
  registry: "音色注册表路径", "env-file": "旧凭据环境文件", name: "本地音色名称", "display-name": "显示名称", prefix: "远程音色前缀", model: "绑定的语音合成模型",
  "workspace-id": "百炼业务空间 ID", region: "调用地域", "base-url": "API 基础地址", "api-key": "百炼 API Key", "api-key-env": "API Key 环境变量名", timeout: "请求超时毫秒",
  "audio-file": "本地录音样本", "audio-url": "公网 HTTPS 录音 URL", wait: "等待部署秒数，0–60", voice: "本地音色名称", text: "配音稿件", "text-file": "稿件文件",
  title: "输出目录标题", format: "wav 或 mp3", "output-root": "输出目录，默认 Voice", page: "页码，从 0 开始", "source-json": "含 voice_id 的 JSON 文件",
};
const definitions = [
  ["list", "列出已登记音色", []], ["doctor", "检查本地配置，不调用远程 API", []],
  ["import-avatar", "从旧 TOML 文件导入百炼音色", []],
  ["create", "从录音样本创建克隆音色", ["name", "display-name", "prefix", "model", "audio-file", "audio-url", "wait"]],
  ["status", "查询音色部署状态", ["voice", "wait"]],
  ["audio", "使用已登记音色合成配音", ["voice", "text", "text-file", "title", "format", "output-root"]],
  ["discover", "按前缀查询远程音色，用于恢复创建结果", ["prefix", "page"]],
  ["bind", "将恢复的音色 ID 绑定到本地占位", ["name", "source-json"]],
] as const;
export const voiceCommands: HuaCommand[] = definitions.map(([name, description, flags]) => ({
  name, description, parentPath: ["clone"], arguments: name === "import-avatar" ? ["<source>"] : undefined,
  options: [...flags, "registry", "env-file", "workspace-id", "region", "base-url", "api-key", "api-key-env", "timeout"].map(flag => ({ flags: `--${flag} <value>`, description: descriptions[flag] }) as CommandOption),
  async action(context) { context.log(JSON.stringify(await run(name, context.options, context.args), null, 2)); },
}));
