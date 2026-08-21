import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as qiniu from "qiniu";
import { ensureSuccess, normalizeError, type QiniuSdk } from "./driver";
import type { ObjectListResult } from "./types";

export async function listObjects(
  sdk: QiniuSdk,
  bucket: string,
  options: { prefix?: string; marker?: string; delimiter?: string; limit: number },
): Promise<ObjectListResult> {
  const items: ObjectListResult["items"] = [];
  const prefixes = new Set<string>();
  let marker = options.marker;

  try {
    do {
      const remaining = options.limit - items.length;
      const data = ensureSuccess(
        await sdk.bucketManager.listPrefix(bucket, {
          prefix: options.prefix,
          delimiter: options.delimiter,
          marker,
          limit: Math.min(1000, remaining),
        }),
        `List objects in '${bucket}'`,
      );
      for (const item of data.items ?? []) {
        items.push({
          key: item.key,
          size: item.fsize ?? 0,
          mimeType: item.mimeType,
          putTime: item.putTime,
          storageType: item.type,
        });
        if (items.length >= options.limit) break;
      }
      for (const prefix of data.commonPrefixes ?? []) prefixes.add(prefix);
      marker = data.marker || undefined;
    } while (marker && items.length < options.limit);
  } catch (error) {
    throw normalizeError(error, `Unable to list objects in '${bucket}'`);
  }

  return { items, commonPrefixes: [...prefixes], nextMarker: marker };
}

export async function statObject(sdk: QiniuSdk, bucket: string, key: string): Promise<Record<string, unknown>> {
  try {
    return ensureSuccess(await sdk.bucketManager.stat(bucket, key), `Stat '${bucket}:${key}'`);
  } catch (error) {
    throw normalizeError(error, `Unable to stat '${bucket}:${key}'`);
  }
}

export async function uploadObject(
  sdk: QiniuSdk,
  bucket: string,
  localPath: string,
  key: string,
  force: boolean,
): Promise<Record<string, unknown>> {
  const absolutePath = path.resolve(localPath);
  const stat = fs.statSync(absolutePath, { throwIfNoEntry: false });
  if (!stat?.isFile()) throw new Error(`Local file not found: ${absolutePath}`);

  const scope = force ? `${bucket}:${key}` : bucket;
  const token = new qiniu.rs.PutPolicy({ scope }).uploadToken(sdk.mac);
  const uploader = new qiniu.resume_up.ResumeUploader(sdk.config);
  const putExtra = new qiniu.resume_up.PutExtra();
  putExtra.version = "v2";

  try {
    return ensureSuccess(await uploader.putFileV2(token, key, absolutePath, putExtra), `Upload '${key}'`);
  } catch (error) {
    throw normalizeError(error, `Unable to upload '${absolutePath}' to '${bucket}:${key}'`);
  }
}

export async function copyObject(
  sdk: QiniuSdk,
  sourceBucket: string,
  sourceKey: string,
  targetBucket: string,
  targetKey: string,
  force: boolean,
): Promise<void> {
  try {
    ensureSuccess(
      await sdk.bucketManager.copy(sourceBucket, sourceKey, targetBucket, targetKey, { force }),
      "Copy object",
    );
  } catch (error) {
    throw normalizeError(error, `Unable to copy '${sourceBucket}:${sourceKey}' to '${targetBucket}:${targetKey}'`);
  }
}

export async function moveObject(
  sdk: QiniuSdk,
  sourceBucket: string,
  sourceKey: string,
  targetBucket: string,
  targetKey: string,
  force: boolean,
): Promise<void> {
  try {
    ensureSuccess(
      await sdk.bucketManager.move(sourceBucket, sourceKey, targetBucket, targetKey, { force }),
      "Move object",
    );
  } catch (error) {
    throw normalizeError(error, `Unable to move '${sourceBucket}:${sourceKey}' to '${targetBucket}:${targetKey}'`);
  }
}

export async function deleteObject(sdk: QiniuSdk, bucket: string, key: string): Promise<void> {
  try {
    ensureSuccess(await sdk.bucketManager.delete(bucket, key), `Delete '${bucket}:${key}'`);
  } catch (error) {
    throw normalizeError(error, `Unable to delete '${bucket}:${key}'`);
  }
}

function normalizeDomain(domain: string): string {
  return /^https?:\/\//i.test(domain) ? domain.replace(/\/+$/, "") : `https://${domain.replace(/\/+$/, "")}`;
}

export async function resolveObjectUrl(
  sdk: QiniuSdk,
  bucket: string,
  key: string,
  domain: string | undefined,
  expires: number,
): Promise<string> {
  let targetDomain = domain;
  if (!targetDomain) {
    const domains = ensureSuccess(await sdk.bucketManager.listBucketDomains(bucket), `List bucket '${bucket}' domains`);
    targetDomain = domains.find((item) => typeof item.domain === "string" && item.domain)?.domain;
  }
  if (!targetDomain) throw new Error(`No available domain for bucket '${bucket}'. Pass --domain <domain>.`);

  const normalized = normalizeDomain(targetDomain);
  const info = ensureSuccess(await sdk.bucketManager.getBucketInfo(bucket), `Get bucket '${bucket}' info`);
  if (info.private === 1) {
    return sdk.bucketManager.privateDownloadUrl(normalized, key, Math.floor(Date.now() / 1000) + expires);
  }
  return sdk.bucketManager.publicDownloadUrl(normalized, key);
}

export async function downloadObject(url: string, outputPath: string, force: boolean): Promise<string> {
  const absolutePath = path.resolve(outputPath);
  if (fs.existsSync(absolutePath) && !force) {
    throw new Error(`Output file already exists: ${absolutePath}. Use --force to overwrite it.`);
  }
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Download failed with HTTP ${response.status}: ${response.statusText}`);
  }
  const temporaryPath = `${absolutePath}.hua-download-${process.pid}-${Date.now()}`;
  try {
    const body = response.body as unknown as import("node:stream/web").ReadableStream;
    await pipeline(Readable.fromWeb(body), fs.createWriteStream(temporaryPath, { flags: "wx" }));
    if (force && fs.existsSync(absolutePath)) fs.unlinkSync(absolutePath);
    fs.renameSync(temporaryPath, absolutePath);
  } catch (error) {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    throw error;
  }
  return absolutePath;
}
