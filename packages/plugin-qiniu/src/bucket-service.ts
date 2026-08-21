import type * as qiniu from "qiniu";
import { ensureSuccess, normalizeError, type QiniuSdk } from "./driver";

export async function listBuckets(sdk: QiniuSdk): Promise<string[]> {
  try {
    return ensureSuccess(await sdk.bucketManager.listBucket(), "List buckets");
  } catch (error) {
    throw normalizeError(error, "Unable to list buckets");
  }
}

export async function getBucketInfo(sdk: QiniuSdk, bucket: string): Promise<Record<string, unknown>> {
  try {
    return ensureSuccess(await sdk.bucketManager.getBucketInfo(bucket), `Get bucket '${bucket}' info`);
  } catch (error) {
    throw normalizeError(error, `Unable to get bucket '${bucket}' info`);
  }
}

export async function listBucketDomains(sdk: QiniuSdk, bucket: string): Promise<Array<Record<string, unknown>>> {
  try {
    return ensureSuccess(await sdk.bucketManager.listBucketDomains(bucket), `List bucket '${bucket}' domains`);
  } catch (error) {
    throw normalizeError(error, `Unable to list bucket '${bucket}' domains`);
  }
}

export async function createBucket(sdk: QiniuSdk, bucket: string, regionId: string): Promise<void> {
  try {
    ensureSuccess(await sdk.bucketManager.createBucket(bucket, { regionId }), `Create bucket '${bucket}'`);
  } catch (error) {
    throw normalizeError(error, `Unable to create bucket '${bucket}'`);
  }
}

export async function deleteBucket(sdk: QiniuSdk, bucket: string): Promise<void> {
  try {
    ensureSuccess(await sdk.bucketManager.deleteBucket(bucket), `Delete bucket '${bucket}'`);
  } catch (error) {
    throw normalizeError(error, `Unable to delete bucket '${bucket}'`);
  }
}
