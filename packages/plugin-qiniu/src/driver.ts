import * as qiniu from "qiniu";
import type { QiniuCredentials } from "./types";

export interface QiniuSdk {
  mac: qiniu.auth.digest.Mac;
  config: qiniu.conf.Config;
  bucketManager: qiniu.rs.BucketManager;
  cdnManager: qiniu.cdn.CdnManager;
}

export function createSdk(credentials: QiniuCredentials): QiniuSdk {
  const mac = new qiniu.auth.digest.Mac(credentials.accessKey, credentials.secretKey);
  const config = new qiniu.conf.Config();
  config.useHttpsDomain = true;
  if (credentials.regionId) {
    config.regionsProvider = qiniu.httpc.Region.fromRegionId(credentials.regionId);
  }
  return {
    mac,
    config,
    bucketManager: new qiniu.rs.BucketManager(mac, config),
    cdnManager: new qiniu.cdn.CdnManager(mac),
  };
}

export function ensureSuccess<T>(result: { data: T; resp: { statusCode?: number } }, action: string): T {
  const status = result.resp.statusCode ?? 0;
  if (status >= 200 && status < 300) return result.data;
  const detail = typeof result.data === "string" ? result.data : JSON.stringify(result.data);
  throw new Error(`${action} failed with HTTP ${status || "unknown"}${detail ? `: ${detail}` : ""}`);
}

export function normalizeError(error: unknown, action: string): Error {
  if (error instanceof Error) return new Error(`${action}: ${error.message}`);
  if (error && typeof error === "object") {
    const input = error as Record<string, unknown>;
    const message = input.error ?? input.message ?? JSON.stringify(input);
    return new Error(`${action}: ${String(message)}`);
  }
  return new Error(`${action}: ${String(error)}`);
}
