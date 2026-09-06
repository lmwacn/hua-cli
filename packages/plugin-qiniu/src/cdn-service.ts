import fs from "node:fs";
import path from "node:path";
import * as qiniu from "qiniu";
import { normalizeError, type QiniuSdk } from "./driver";

const DOMAIN_API_BASE = "https://api.qiniu.com";

export const DOMAIN_CONFIG_SECTIONS = [
  "geocover",
  "source",
  "range",
  "sourcetimeout",
  "cache",
  "respheader",
  "sslize",
  "httpsconf",
  "referer",
  "ipacl",
  "uaacl",
  "timeacl",
  "bsauth",
] as const;

export type DomainConfigSection = (typeof DOMAIN_CONFIG_SECTIONS)[number];

interface DomainListResponse {
  domains?: Array<Record<string, unknown>>;
  marker?: string;
}

interface CdnCallbackResponse {
  statusCode?: number;
}

function formatQiniuDate(date = new Date()): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function domainPath(domain: string): string {
  const normalized = domain.trim().toLowerCase();
  if (!normalized || normalized.includes("/") || normalized.includes(":")) {
    throw new Error(`Invalid CDN domain: '${domain}'.`);
  }
  return `/domain/${encodeURIComponent(normalized)}`;
}

async function domainApiRequest<T>(
  sdk: QiniuSdk,
  method: "GET" | "POST" | "PUT" | "DELETE",
  requestPath: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const url = `${DOMAIN_API_BASE}${requestPath}`;
  const contentType = method === "GET" || method === "DELETE"
    ? "application/x-www-form-urlencoded"
    : "application/json";
  const requestBody = body ? JSON.stringify(body) : "";
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "X-Qiniu-Date": formatQiniuDate(),
  };
  headers.Authorization = qiniu.util.generateAccessTokenV2(
    sdk.mac,
    url,
    method,
    contentType,
    requestBody,
    headers,
  );

  const response = await fetch(url, {
    method,
    headers,
    body: body ? requestBody : undefined,
  });
  const text = await response.text();
  let data: unknown = {};
  if (text.trim()) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      data = text;
    }
  }
  if (!response.ok) {
    const detail = data && typeof data === "object"
      ? String((data as Record<string, unknown>).error ?? (data as Record<string, unknown>).message ?? JSON.stringify(data))
      : String(data);
    throw new Error(`HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }
  return data as T;
}

export async function listCdnDomains(
  sdk: QiniuSdk,
  options: { limit: number; marker?: string; type?: string; sourceBucket?: string },
): Promise<{ domains: Array<Record<string, unknown>>; nextMarker?: string }> {
  const domains: Array<Record<string, unknown>> = [];
  let marker = options.marker;

  try {
    do {
      const params = new URLSearchParams();
      params.set("limit", String(Math.min(1000, options.limit - domains.length)));
      if (marker) params.set("marker", marker);
      if (options.type) params.append("types", options.type);
      if (options.sourceBucket) {
        params.append("sourceTypes", "qiniuBucket");
        params.set("sourceQiniuBucket", options.sourceBucket);
      }
      const data = await domainApiRequest<DomainListResponse>(sdk, "GET", `/domain?${params}`);
      domains.push(...(data.domains ?? []).slice(0, options.limit - domains.length));
      marker = data.marker || undefined;
    } while (marker && domains.length < options.limit);
    return { domains, nextMarker: marker };
  } catch (error) {
    throw normalizeError(error, "Unable to list CDN domains");
  }
}

export async function getCdnDomain(sdk: QiniuSdk, domain: string): Promise<Record<string, unknown>> {
  try {
    return await domainApiRequest<Record<string, unknown>>(sdk, "GET", domainPath(domain));
  } catch (error) {
    throw normalizeError(error, `Unable to get CDN domain '${domain}'`);
  }
}

export async function createCdnDomain(
  sdk: QiniuSdk,
  domain: string,
  config: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  try {
    return await domainApiRequest(sdk, "POST", domainPath(domain), config);
  } catch (error) {
    throw normalizeError(error, `Unable to create CDN domain '${domain}'`);
  }
}

export async function changeCdnDomainState(
  sdk: QiniuSdk,
  domain: string,
  state: "online" | "offline",
): Promise<Record<string, unknown>> {
  try {
    return await domainApiRequest(sdk, "POST", `${domainPath(domain)}/${state}`);
  } catch (error) {
    throw normalizeError(error, `Unable to set CDN domain '${domain}' ${state}`);
  }
}

export async function deleteCdnDomain(sdk: QiniuSdk, domain: string): Promise<Record<string, unknown>> {
  try {
    return await domainApiRequest(sdk, "DELETE", domainPath(domain));
  } catch (error) {
    throw normalizeError(error, `Unable to delete CDN domain '${domain}'`);
  }
}

export async function updateCdnDomainConfig(
  sdk: QiniuSdk,
  domain: string,
  section: DomainConfigSection,
  config: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  try {
    return await domainApiRequest(sdk, "PUT", `${domainPath(domain)}/${section}`, config);
  } catch (error) {
    throw normalizeError(error, `Unable to update CDN domain '${domain}' section '${section}'`);
  }
}

export function readJsonConfig(filePath: string): Record<string, unknown> {
  const absolutePath = path.resolve(filePath);
  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(absolutePath, "utf8")) as unknown;
  } catch (error) {
    throw normalizeError(error, `Unable to read JSON config '${absolutePath}'`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`JSON config must contain an object: ${absolutePath}`);
  }
  return value as Record<string, unknown>;
}

function callCdnManager<T>(
  action: string,
  invoke: (callback: (error?: Error, body?: T, response?: CdnCallbackResponse) => void) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    invoke((error, body, response) => {
      if (error) {
        reject(normalizeError(error, action));
        return;
      }
      const status = response?.statusCode ?? 0;
      if (status < 200 || status >= 300) {
        reject(new Error(`${action} failed with HTTP ${status || "unknown"}: ${JSON.stringify(body ?? {})}`));
        return;
      }
      resolve(body as T);
    });
  });
}

export function refreshCdnUrls(sdk: QiniuSdk, urls: string[]): Promise<unknown> {
  return callCdnManager("Refresh CDN URLs", (callback) => sdk.cdnManager.refreshUrls(urls, callback));
}

export function refreshCdnDirs(sdk: QiniuSdk, dirs: string[]): Promise<unknown> {
  return callCdnManager("Refresh CDN directories", (callback) => sdk.cdnManager.refreshDirs(dirs, callback));
}

export function prefetchCdnUrls(sdk: QiniuSdk, urls: string[]): Promise<unknown> {
  return callCdnManager("Prefetch CDN URLs", (callback) => sdk.cdnManager.prefetchUrls(urls, callback));
}

export function getCdnTraffic(
  sdk: QiniuSdk,
  domain: string,
  from: string,
  to: string,
  granularity: string,
): Promise<unknown> {
  return callCdnManager("Query CDN traffic", (callback) =>
    sdk.cdnManager.getFluxData(from, to, granularity, [domain], callback));
}

export function getCdnBandwidth(
  sdk: QiniuSdk,
  domain: string,
  from: string,
  to: string,
  granularity: string,
): Promise<unknown> {
  return callCdnManager("Query CDN bandwidth", (callback) =>
    sdk.cdnManager.getBandwidthData(from, to, granularity, [domain], callback));
}

export function getCdnLogs(sdk: QiniuSdk, domain: string, date: string): Promise<unknown> {
  return callCdnManager("Query CDN logs", (callback) => sdk.cdnManager.getCdnLogList([domain], date, callback));
}

export function validateHttpUrls(values: string[], kind: "url" | "directory"): string[] {
  if (!values.length) throw new Error(`At least one CDN ${kind} is required.`);
  return values.map((value) => {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error(`Invalid CDN ${kind}: '${value}'.`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`CDN ${kind} must use http or https: '${value}'.`);
    }
    if (kind === "directory" && !parsed.pathname.endsWith("/")) {
      throw new Error(`CDN directory must end with '/': '${value}'.`);
    }
    return parsed.toString();
  });
}

export function validateDate(value: string, optionName: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`${optionName} must use YYYY-MM-DD format.`);
  }
  return value;
}

export function validateGranularity(value: string): string {
  if (!["5min", "hour", "day"].includes(value)) {
    throw new Error("--granularity must be one of: 5min, hour, day.");
  }
  return value;
}

export function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    result[key] = /(?:secret|password|token|accesskey|authkey|timeaclkeys|privatekey)/i.test(key)
      ? "***"
      : redactSensitive(item);
  }
  return result;
}
