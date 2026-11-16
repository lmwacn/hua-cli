import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { AudioRequest, TtsResponse } from "./types";

export function resolveBaseUrl(options: AudioRequest): string {
  if (options.baseUrl) {
    const url = new URL(options.baseUrl);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("无效的 base-url");
    return options.baseUrl.replace(/\/+$/, "");
  }
  if (options.legacyQwen && !options.workspaceId) return "https://dashscope.aliyuncs.com/api/v1";
  if (!/^[a-zA-Z0-9-]+$/.test(options.workspaceId || "")) throw new Error("请设置 --workspace-id 或 SFM_WORKSPACE_ID");
  if (!["cn-beijing", "ap-southeast-1"].includes(options.region)) throw new Error("支持的地域：cn-beijing、ap-southeast-1");
  return `https://${options.workspaceId}.${options.region}.maas.aliyuncs.com/api/v1`;
}

export async function requestAudioApi(options: AudioRequest, endpoint: string, payload: unknown): Promise<any> {
  const url = resolveBaseUrl(options) + endpoint;
  const response = await fetch(url, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(options.timeout),
    headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch((error: Error) => { throw new Error(`百炼请求中断，结果可能已提交，请勿自动重试：${error.message}`); });
  let data: any;
  try { data = await response.json(); }
  catch { throw new Error(`百炼返回非 JSON 数据：HTTP ${response.status}`); }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error(`百炼返回了无效响应：HTTP ${response.status}`);
  if (!response.ok || data.code) throw new Error(`百炼请求失败：HTTP ${response.status} ${data.code || ""} ${data.message || ""} request_id=${data.request_id || "unknown"}`);
  return data;
}

export async function synthesizeSpeech(options: AudioRequest): Promise<TtsResponse> {
  const endpoint = options.legacyQwen ? "/services/aigc/multimodal-generation/generation" : "/services/audio/tts/SpeechSynthesizer";
  const data = await requestAudioApi(options, endpoint, { model: options.model, input: options.input });
  const audioUrl = data.output?.audio?.url;
  if (typeof audioUrl !== "string" || !audioUrl) throw new Error(`百炼未返回 output.audio.url，request_id=${data.request_id || "unknown"}`);
  return { audioUrl, requestId: data.request_id, raw: data };
}

export async function downloadFile(url: string, outputPath: string, timeout: number, format: string): Promise<void> {
  const target = path.resolve(outputPath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.part`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeout) });
    if (!response.ok) throw new Error(`下载失败：HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const valid = format === "wav" ? bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WAVE" && bytes.length > 44
      : format === "mp3" ? bytes.subarray(0, 3).toString() === "ID3" || bytes[0] === 255 && (bytes[1] & 224) === 224
      : format === "opus" ? bytes.subarray(0, 4).toString() === "OggS" : bytes.length > 0;
    if (!valid) throw new Error(`下载结果不是有效的 ${format} 音频`);
    // 完整下载并检查后再替换，失败时保留原文件。
    await fs.writeFile(temporary, bytes, { flag: "wx" });
    await fs.rename(temporary, target);
  } finally { await fs.rm(temporary, { force: true }); }
}
