import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { TtsRequestOptions, TtsResponse } from "./types";

interface JsonHttpResponse {
  statusCode: number;
  statusMessage: string;
  body: string;
}

function joinUrl(baseUrl: string, endpoint: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${endpoint.replace(/^\/+/, "")}`;
}

function workspaceBaseUrl(workspaceId?: string, region?: string): string | null {
  if (!workspaceId) return null;
  const normalizedRegion = region?.trim() || "cn-beijing";
  return `https://${workspaceId}.${normalizedRegion}.maas.aliyuncs.com/api/v1`;
}

function resolveBaseUrl(options: TtsRequestOptions): string {
  const workspaceUrl = workspaceBaseUrl(options.workspaceId, options.region);
  if (workspaceUrl && (!options.baseUrl || options.baseUrl === "https://dashscope.aliyuncs.com/api/v1")) {
    return workspaceUrl;
  }
  return options.baseUrl || workspaceUrl || "https://dashscope.aliyuncs.com/api/v1";
}

function endpointForProvider(provider: TtsRequestOptions["provider"]): string {
  if (provider === "cosyvoice") {
    return "/services/audio/tts/SpeechSynthesizer";
  }
  return "/services/aigc/multimodal-generation/generation";
}

function buildPayload(options: TtsRequestOptions): unknown {
  if (options.provider === "cosyvoice") {
    return {
      model: options.model,
      input: {
        text: options.text,
        voice: options.voice,
        ...(options.format ? { format: options.format } : {}),
        ...(options.sampleRate ? { sample_rate: options.sampleRate } : {}),
        ...(options.ssml ? { enable_ssml: true } : {}),
      },
    };
  }

  return {
    model: options.model,
    input: {
      text: options.text,
      voice: options.voice,
      ...(options.languageType ? { language_type: options.languageType } : {}),
      ...(options.instructions ? { instructions: options.instructions } : {}),
      ...(options.optimizeInstructions !== undefined ? { optimize_instructions: options.optimizeInstructions } : {}),
    },
  };
}

function requestJson(url: string, apiKey: string, body: unknown, timeout: number): Promise<JsonHttpResponse> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === "https:";
    const transport = isHttps ? https : http;

    const req = transport.request({
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: "POST",
      timeout,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          statusCode: res.statusCode ?? 0,
          statusMessage: res.statusMessage ?? "",
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });

    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Request timed out after ${timeout}ms`));
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function getNestedString(root: unknown, pathParts: string[]): string | undefined {
  let current: unknown = root;
  for (const part of pathParts) {
    const obj = readObject(current);
    if (!obj) return undefined;
    current = obj[part];
  }
  return typeof current === "string" && current ? current : undefined;
}

function extractErrorMessage(parsed: unknown, fallback: string): string {
  const code = getNestedString(parsed, ["code"]);
  const message = getNestedString(parsed, ["message"]) ?? getNestedString(parsed, ["msg"]);
  const requestId = getNestedString(parsed, ["request_id"]) ?? getNestedString(parsed, ["requestId"]);
  const pieces = [code, message].filter(Boolean);
  if (requestId) pieces.push(`request_id=${requestId}`);
  return pieces.length > 0 ? pieces.join(" ") : fallback;
}

function parseTtsResponse(response: JsonHttpResponse): TtsResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.body) as unknown;
  } catch {
    throw new Error(`TTS API returned non-JSON response (${response.statusCode} ${response.statusMessage})`);
  }

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`TTS API failed (${response.statusCode} ${response.statusMessage}): ${extractErrorMessage(parsed, response.body)}`);
  }

  const audioUrl =
    getNestedString(parsed, ["output", "audio", "url"]) ??
    getNestedString(parsed, ["output", "url"]) ??
    getNestedString(parsed, ["audio", "url"]);

  if (!audioUrl) {
    throw new Error(`TTS API response did not contain output.audio.url: ${JSON.stringify(parsed)}`);
  }

  return {
    requestId: getNestedString(parsed, ["request_id"]) ?? getNestedString(parsed, ["requestId"]),
    audioUrl,
    raw: parsed,
  };
}

export async function synthesizeSpeech(options: TtsRequestOptions): Promise<TtsResponse> {
  const baseUrl = resolveBaseUrl(options);
  const url = joinUrl(baseUrl, endpointForProvider(options.provider));
  const response = await requestJson(url, options.apiKey, buildPayload(options), options.timeout);
  return parseTtsResponse(response);
}

export function downloadFile(url: string, outputPath: string, timeout: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const resolvedOutput = path.resolve(process.cwd(), outputPath);
    fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });

    const file = fs.createWriteStream(resolvedOutput);
    const parsedUrl = new URL(url);
    const transport = parsedUrl.protocol === "https:" ? https : http;

    const req = transport.get(parsedUrl, { timeout }, (res) => {
      if ((res.statusCode ?? 0) >= 300 && (res.statusCode ?? 0) < 400 && res.headers.location) {
        file.close();
        fs.unlinkSync(resolvedOutput);
        downloadFile(new URL(res.headers.location, url).toString(), outputPath, timeout).then(resolve, reject);
        return;
      }

      if ((res.statusCode ?? 0) < 200 || (res.statusCode ?? 0) >= 300) {
        file.close();
        fs.unlinkSync(resolvedOutput);
        reject(new Error(`Download failed (${res.statusCode} ${res.statusMessage})`));
        return;
      }

      res.pipe(file);
      file.on("finish", () => {
        file.close();
        resolve();
      });
    });

    req.on("timeout", () => {
      req.destroy();
      file.close();
      try { fs.unlinkSync(resolvedOutput); } catch {}
      reject(new Error(`Download timed out after ${timeout}ms`));
    });
    req.on("error", (err) => {
      file.close();
      try { fs.unlinkSync(resolvedOutput); } catch {}
      reject(err);
    });
    file.on("error", reject);
  });
}
