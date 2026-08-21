export interface QiniuProfile {
  accessKey?: string;
  secretKey?: string;
  accessKeyEnv?: string;
  secretKeyEnv?: string;
  regionId?: string;
  defaultBucket?: string;
  defaultDomain?: string;
}

export interface QiniuCredentials {
  accessKey: string;
  secretKey: string;
  regionId?: string;
  defaultBucket?: string;
  defaultDomain?: string;
}

export interface StoredConfig {
  defaultProfile?: string;
  profiles: Record<string, QiniuProfile>;
}

export interface ObjectListItem {
  key: string;
  size: number;
  mimeType: string;
  putTime: number;
  storageType?: number;
}

export interface ObjectListResult {
  items: ObjectListItem[];
  commonPrefixes: string[];
  nextMarker?: string;
}
